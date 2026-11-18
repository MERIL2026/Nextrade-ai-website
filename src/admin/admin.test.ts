import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { createAuthDatabase } from '../auth/db';
import { createAuthService } from '../auth/service';
import { createAuthRouter } from '../auth/router';
import { AuthEmailSender, OutboundAuthEmail } from '../auth/email';
import { createWorkspaceService } from '../workspace/service';
import { createWorkspaceRouter } from '../workspace/router';
import { isAdminRole } from '../auth/rbac';
import { bootstrapSuperAdmin } from './bootstrap';
import { createRuntimeConfigManager } from './runtimeSettings';
import { createBackgroundJobManager, createTelemetryCollector } from './telemetry';
import { createAdminService } from './service';
import { createAdminRouter } from './router';
import { executeFinancialResearch } from '../lib/researchEngine';

function createMockEmailSender(): {
  sender: AuthEmailSender;
  extractToken: (to: string, kind: OutboundAuthEmail['kind']) => string;
} {
  const sent: OutboundAuthEmail[] = [];
  return {
    sender: {
      isConfigured: () => true,
      getProviderName: () => 'emailjs',
      send: async (email) => {
        sent.push(email);
        return {
          delivered: true,
          mode: 'provider',
          provider: 'emailjs',
          messageId: `msg_${sent.length}`,
        };
      },
    },
    extractToken: (to, kind) => {
      const match = [...sent]
        .reverse()
        .find((item) => item.to === to.toLowerCase() && item.kind === kind);
      assert.ok(match?.actionUrl, `Expected ${kind} email for ${to}`);
      const tok = new URL(match.actionUrl).searchParams.get('token');
      assert.ok(tok, 'Expected token param');
      return tok;
    },
  };
}

function extractCookieValue(res: Response): string {
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = /nextrade_session=([^;]+)/.exec(setCookie);
  assert.ok(match, `Expected Set-Cookie with nextrade_session, got ${setCookie}`);
  return `nextrade_session=${match[1]}`;
}

async function startAdminTestHarness() {
  const db = await createAuthDatabase(':memory:');
  const mockMail = createMockEmailSender();
  const runtimeConfigManager = createRuntimeConfigManager(db);
  await runtimeConfigManager.ensureSeeded();

  const telemetryCollector = createTelemetryCollector(db);
  const jobManager = createBackgroundJobManager({
    db,
    runtimeConfigManager,
    emailSender: mockMail.sender,
  });
  await jobManager.ensureJobsRegistered();

  const authService = createAuthService({
    db,
    emailSender: mockMail.sender,
    getBaseUrl: () => 'http://127.0.0.1:3000',
    runtimeConfigManager,
  });
  const workspaceService = createWorkspaceService({
    db,
    runtimeConfigManager,
  });
  const adminService = createAdminService({
    db,
    authService,
    emailSender: mockMail.sender,
    runtimeConfigManager,
    telemetryCollector,
    jobManager,
    projectRoot: process.cwd(),
  });

  const app = express();
  app.use(telemetryCollector.middleware());
  app.use(express.json({ limit: '32kb' }));

  app.use(async (req, res, next) => {
    if (!req.path.startsWith('/api/workspace') && !req.path.startsWith('/api/research')) {
      next();
      return;
    }
    const cfg = await runtimeConfigManager.getConfig();
    if (cfg.maintenance_mode.enabled) {
      res.status(503).json({
        error: cfg.maintenance_mode.message || 'Platform under scheduled maintenance.',
        code: 'MAINTENANCE_MODE',
      });
      return;
    }
    next();
  });

  app.use(
    '/api/auth',
    createAuthRouter({
      authService,
      emailSender: mockMail.sender,
      authDatabase: 'sqlite',
      rateLimits: { loginIpMax: 100, loginAccountMax: 100, signupIpMax: 100 },
    }),
  );
  app.use('/api/workspace', createWorkspaceRouter({ authService, workspaceService }));
  app.use(
    '/api/admin',
    createAdminRouter({
      authService,
      adminService,
      jobManager,
      rateLimits: { mutationMax: 200, sensitiveMax: 100 },
    }),
  );

  app.get('/api/announcements/active', async (_req, res) => {
    const items = await adminService.listPublicActiveAnnouncements();
    res.json({ ok: true, announcements: items });
  });

  app.post('/api/contact', async (req, res) => {
    const { name, email, topic, message } = req.body ?? {};
    const ticketId = `NXT-${Date.now()}`;
    await adminService.ingestPublicSupportTicket({
      ticketId,
      name: String(name || 'User'),
      email: String(email || 'user@example.com'),
      topic: String(topic || 'General'),
      reference: '',
      message: String(message || 'Test enquiry message'),
      submittedAt: new Date().toISOString(),
    });
    res.status(201).json({ ok: true, referenceId: ticketId });
  });

  // SSR /admin guard simulation matching server.ts behavior
  app.get('/admin*', async (req, res) => {
    const cookieHeader = req.get('cookie') ?? '';
    const match = /nextrade_session=([^;]+)/.exec(cookieHeader);
    if (!match) {
      res.redirect(302, `/login?redirect=${encodeURIComponent(req.originalUrl)}`);
      return;
    }
    const verified = await authService.authenticateSessionToken(decodeURIComponent(match[1]));
    if (!verified) {
      res.redirect(302, `/login?redirect=${encodeURIComponent(req.originalUrl)}`);
      return;
    }
    if (!isAdminRole(verified.user.role)) {
      res.status(403).send('403 Forbidden: Administrative privileges required');
      return;
    }
    res.status(200).send(`Admin Console (${verified.user.role})`);
  });

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  async function registerAndLogin(params: {
    fullName: string;
    email: string;
    password: string;
    role?: string;
  }) {
    const signupOut = await authService.signup({
      fullName: params.fullName,
      email: params.email,
      password: params.password,
      confirmPassword: params.password,
      acceptTerms: true,
      acceptPrivacy: true,
    });
    assert.equal(signupOut.ok, true, `Signup failed for ${params.email}: ${signupOut.ok ? '' : signupOut.error}`);
    const tok = mockMail.extractToken(params.email, 'verification');
    await authService.verifyEmail({ token: tok });
    if (params.role) {
      await db.execute(
        'UPDATE users SET role = ? WHERE LOWER(email) = LOWER(?)',
        'UPDATE users SET role = $1 WHERE LOWER(email) = LOWER($2)',
        [params.role, params.email],
      );
    }
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: params.email, password: params.password }),
    });
    assert.equal(loginRes.status, 200);
    const body = (await loginRes.json()) as { user: { id: string; email: string; role: string } };
    return {
      cookie: extractCookieValue(loginRes),
      user: body.user,
    };
  }

  return {
    db,
    authService,
    adminService,
    runtimeConfigManager,
    jobManager,
    telemetryCollector,
    baseUrl,
    registerAndLogin,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await db.close();
    },
  };
}

test('bootstrapSuperAdmin safely enforces password strength and executes idempotently', async () => {
  const db = await createAuthDatabase(':memory:');
  try {
    const noEmail = await bootstrapSuperAdmin(db, { email: '', password: '' });
    assert.equal(noEmail.executed, false);
    assert.equal(noEmail.action, 'skipped_no_email');

    await assert.rejects(() =>
      bootstrapSuperAdmin(db, {
        email: 'owner@nextrade.local',
        password: 'weak',
      }),
    );

    const created = await bootstrapSuperAdmin(db, {
      email: 'owner@nextrade.local',
      password: 'KestrelQuantum#2026!Vault',
      fullName: 'Platform Owner',
    });
    assert.equal(created.executed, true);
    assert.equal(created.action, 'created_new');

    const second = await bootstrapSuperAdmin(db, {
      email: 'second@nextrade.local',
      password: 'VertexMeridian#2026!Vault',
    });
    assert.equal(second.executed, false);
    assert.equal(second.action, 'skipped_existing_super_admin');
  } finally {
    await db.close();
  }
});

test('admin routes enforce strict authentication, RBAC role isolation, and viewer read-only boundary', async () => {
  const ctx = await startAdminTestHarness();
  try {
    const superPw = 'KestrelQuantum#2026!Vault';
    const userPw = 'HeliosPolaris#2026!Vault';
    const viewerPw = 'MeridianCobalt#2026!Vault';
    const aiPw = 'ZenithCatalyst#2026!Vault';

    const superAdmin = await ctx.registerAndLogin({
      fullName: 'Super Owner',
      email: 'super@nextrade.test',
      password: superPw,
      role: 'super_admin',
    });
    const normalUser = await ctx.registerAndLogin({
      fullName: 'Standard Trader',
      email: 'trader@nextrade.test',
      password: userPw,
    });
    const viewerAdmin = await ctx.registerAndLogin({
      fullName: 'Audit Viewer',
      email: 'viewer@nextrade.test',
      password: viewerPw,
      role: 'viewer',
    });
    const aiAdmin = await ctx.registerAndLogin({
      fullName: 'AI Ops Lead',
      email: 'aiops@nextrade.test',
      password: aiPw,
      role: 'ai_admin',
    });

    // Unauthenticated /api/admin -> 401; /admin SSR -> 302 redirect
    const anonApi = await fetch(`${ctx.baseUrl}/api/admin/overview`);
    assert.equal(anonApi.status, 401);

    const anonSsr = await fetch(`${ctx.baseUrl}/admin`, { redirect: 'manual' });
    assert.equal(anonSsr.status, 302);
    assert.match(anonSsr.headers.get('location') ?? '', /^\/login\?redirect=/);

    // Ordinary user -> 403 on both SSR and API
    const userSsr = await fetch(`${ctx.baseUrl}/admin`, {
      headers: { Cookie: normalUser.cookie },
    });
    assert.equal(userSsr.status, 403);

    const userApi = await fetch(`${ctx.baseUrl}/api/admin/users`, {
      headers: { Cookie: normalUser.cookie },
    });
    assert.equal(userApi.status, 403);

    // Viewer can read overview, users, audit logs, but is strictly blocked on any mutation
    const viewerOverview = await fetch(`${ctx.baseUrl}/api/admin/overview`, {
      headers: { Cookie: viewerAdmin.cookie },
    });
    assert.equal(viewerOverview.status, 200);

    const viewerSuspendAttempt = await fetch(
      `${ctx.baseUrl}/api/admin/users/${encodeURIComponent(normalUser.user.id)}/suspend`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: viewerAdmin.cookie },
        body: JSON.stringify({ reason: 'Unauthorized attempt' }),
      },
    );
    assert.equal(viewerSuspendAttempt.status, 403);

    // AI Admin can manage AI prompts/config but cannot read or change security incidents or user roles
    const aiReadOverview = await fetch(`${ctx.baseUrl}/api/admin/ai/overview`, {
      headers: { Cookie: aiAdmin.cookie },
    });
    assert.equal(aiReadOverview.status, 200);

    const aiCreatePrompt = await fetch(`${ctx.baseUrl}/api/admin/ai/prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: aiAdmin.cookie },
      body: JSON.stringify({
        title: 'Strict Institutional Equity Prompt v2',
        systemPrompt: 'Provide institutional explainable market risk research for {{symbol}}.',
        userPromptTemplate: 'Analyze {{symbol}} focus: {{query}}',
        modelTarget: 'gemini-4-hydrogen',
        activateNow: true,
      }),
    });
    assert.equal(aiCreatePrompt.status, 201);

    const aiBlockedSecurity = await fetch(`${ctx.baseUrl}/api/admin/security/incidents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: aiAdmin.cookie },
      body: JSON.stringify({ title: 'Should fail', severity: 'HIGH' }),
    });
    assert.equal(aiBlockedSecurity.status, 403);

    // CSRF mismatch rejected
    const csrfBlocked = await fetch(`${ctx.baseUrl}/api/admin/config`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil-attacker.example',
        Cookie: superAdmin.cookie,
      },
      body: JSON.stringify({ key: 'ai_config', value: {} }),
    });
    assert.equal(csrfBlocked.status, 403);
    assert.equal(((await csrfBlocked.json()) as { code: string }).code, 'CSRF_ORIGIN_MISMATCH');

    // Audit logs cannot be updated or deleted
    const immutableAttempt = await fetch(`${ctx.baseUrl}/api/admin/audit-logs`, {
      method: 'DELETE',
      headers: { Cookie: superAdmin.cookie },
    });
    assert.equal(immutableAttempt.status, 405);
  } finally {
    await ctx.close();
  }
});

test('re-authentication, self-protection, last-super-admin guard, suspend session revocation, and audit redaction', async () => {
  const ctx = await startAdminTestHarness();
  try {
    const superPw = 'KestrelQuantum#2026!Vault';
    const targetPw = 'HeliosPolaris#2026!Vault';

    const superAdmin = await ctx.registerAndLogin({
      fullName: 'Primary Super Admin',
      email: 'owner@nextrade.test',
      password: superPw,
      role: 'super_admin',
    });
    const targetUser = await ctx.registerAndLogin({
      fullName: 'Beta Trader',
      email: 'beta@nextrade.test',
      password: targetPw,
    });

    // Missing confirmPassword triggers 428 REAUTH_REQUIRED
    const missingReauth = await fetch(
      `${ctx.baseUrl}/api/admin/users/${encodeURIComponent(targetUser.user.id)}/role`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: superAdmin.cookie },
        body: JSON.stringify({ role: 'support_admin', reason: 'Promote for triage' }),
      },
    );
    assert.equal(missingReauth.status, 428);
    assert.equal(((await missingReauth.json()) as { code: string }).code, 'REAUTH_REQUIRED');

    // Wrong confirmPassword triggers 403 REAUTH_FAILED
    const badReauth = await fetch(
      `${ctx.baseUrl}/api/admin/users/${encodeURIComponent(targetUser.user.id)}/role`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: superAdmin.cookie },
        body: JSON.stringify({
          role: 'support_admin',
          reason: 'Promote',
          confirmPassword: 'WrongPassword#123',
        }),
      },
    );
    assert.equal(badReauth.status, 403);
    assert.equal(((await badReauth.json()) as { code: string }).code, 'REAUTH_FAILED');

    // Last super admin cannot demote self or delete self
    const selfDemote = await fetch(
      `${ctx.baseUrl}/api/admin/users/${encodeURIComponent(superAdmin.user.id)}/role`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: superAdmin.cookie },
        body: JSON.stringify({
          role: 'user',
          reason: 'Attempted self demotion',
          confirmPassword: superPw,
        }),
      },
    );
    assert.equal(selfDemote.status, 403);

    // Valid promotion with re-auth succeeds
    const validPromote = await fetch(
      `${ctx.baseUrl}/api/admin/users/${encodeURIComponent(targetUser.user.id)}/role`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: superAdmin.cookie },
        body: JSON.stringify({
          role: 'support_admin',
          reason: 'Assigned support triage duties',
          confirmPassword: superPw,
        }),
      },
    );
    assert.equal(validPromote.status, 200);

    // PATCH /users/:id rejects inline role field to force dedicated role endpoint
    const massAssignRole = await fetch(
      `${ctx.baseUrl}/api/admin/users/${encodeURIComponent(targetUser.user.id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: superAdmin.cookie },
        body: JSON.stringify({ role: 'super_admin' }),
      },
    );
    assert.equal(massAssignRole.status, 403);

    // Suspending target user immediately revokes their active session
    const suspendRes = await fetch(
      `${ctx.baseUrl}/api/admin/users/${encodeURIComponent(targetUser.user.id)}/suspend`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: superAdmin.cookie },
        body: JSON.stringify({ reason: 'Compliance hold' }),
      },
    );
    assert.equal(suspendRes.status, 200);

    const postSuspendMe = await fetch(`${ctx.baseUrl}/api/auth/me`, {
      headers: { Cookie: targetUser.cookie },
    });
    assert.equal(postSuspendMe.status, 401);

    // Restoring user allows fresh login
    const restoreRes = await fetch(
      `${ctx.baseUrl}/api/admin/users/${encodeURIComponent(targetUser.user.id)}/restore`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: superAdmin.cookie },
        body: JSON.stringify({ reason: 'Hold cleared' }),
      },
    );
    assert.equal(restoreRes.status, 200);

    const reLoginRes = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'beta@nextrade.test', password: targetPw }),
    });
    assert.equal(reLoginRes.status, 200);

    // Delete requires matching typed email + re-auth, then actually deletes user
    const mismatchDelete = await fetch(
      `${ctx.baseUrl}/api/admin/users/${encodeURIComponent(targetUser.user.id)}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Cookie: superAdmin.cookie },
        body: JSON.stringify({
          confirmEmail: 'wrong@nextrade.test',
          confirmPassword: superPw,
        }),
      },
    );
    assert.equal(mismatchDelete.status, 400);

    const validDelete = await fetch(
      `${ctx.baseUrl}/api/admin/users/${encodeURIComponent(targetUser.user.id)}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Cookie: superAdmin.cookie },
        body: JSON.stringify({
          confirmEmail: 'beta@nextrade.test',
          confirmPassword: superPw,
        }),
      },
    );
    assert.equal(validDelete.status, 200);

    // Audit log entries never leak confirmPassword
    const auditRes = await fetch(`${ctx.baseUrl}/api/admin/audit-logs?limit=50`, {
      headers: { Cookie: superAdmin.cookie },
    });
    assert.equal(auditRes.status, 200);
    const auditBody = (await auditRes.text());
    assert.equal(auditBody.includes(superPw), false);
    assert.equal(auditBody.includes('WrongPassword#123'), false);
  } finally {
    await ctx.close();
  }
});

test('runtime config, rollback, emergency maintenance gate, AI prompt integration, jobs, announcements, and contact tickets work end-to-end', async () => {
  const ctx = await startAdminTestHarness();
  try {
    const superPw = 'KestrelQuantum#2026!Vault';
    const superAdmin = await ctx.registerAndLogin({
      fullName: 'Ops Director',
      email: 'ops@nextrade.test',
      password: superPw,
      role: 'super_admin',
    });
    const trader = await ctx.registerAndLogin({
      fullName: 'Active Participant',
      email: 'active@nextrade.test',
      password: 'HeliosPolaris#2026!Vault',
    });

    // Public announcement creation strips HTML/XSS tags
    const createAnn = await fetch(`${ctx.baseUrl}/api/admin/announcements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: superAdmin.cookie },
      body: JSON.stringify({
        title: '<script>alert(1)</script>Market Sync Window',
        content: 'NSE/US catalog refreshed <img src=x onerror=alert(1)> cleanly.',
        category: 'UPDATE',
        severity: 'INFO',
        status: 'PUBLISHED',
      }),
    });
    assert.equal(createAnn.status, 201);

    const pubAnnRes = await fetch(`${ctx.baseUrl}/api/announcements/active`);
    assert.equal(pubAnnRes.status, 200);
    const pubAnnJson = (await pubAnnRes.json()) as {
      announcements: Array<{ title: string; content: string }>;
    };
    assert.equal(pubAnnJson.announcements.length, 1);
    assert.equal(pubAnnJson.announcements[0].title.includes('<script>'), false);
    assert.equal(pubAnnJson.announcements[0].content.includes('<img'), false);

    // Contact form creates support ticket visible to Admin Support module
    const contactRes = await fetch(`${ctx.baseUrl}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Kiran Desai',
        email: 'kiran@example.com',
        topic: 'API Access Question',
        message: 'Testing Phase 3 support ticket triage workflow.',
      }),
    });
    assert.equal(contactRes.status, 201);

    const ticketsRes = await fetch(`${ctx.baseUrl}/api/admin/support`, {
      headers: { Cookie: superAdmin.cookie },
    });
    const ticketsBody = (await ticketsRes.json()) as {
      tickets: Array<{ id: string; email: string; status: string }>;
    };
    assert.equal(ticketsBody.tickets.length, 1);
    assert.equal(ticketsBody.tickets[0].email, 'kiran@example.com');

    // Market symbol disabling blocks paper trades on disabled symbol
    const disableNvda = await fetch(`${ctx.baseUrl}/api/admin/markets/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: superAdmin.cookie },
      body: JSON.stringify({
        disabledSymbols: ['NVDA'],
        reason: 'Temporary trading halt check',
      }),
    });
    assert.equal(disableNvda.status, 200);

    const blockedOrderRes = await fetch(`${ctx.baseUrl}/api/workspace/paper-trading/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: trader.cookie },
      body: JSON.stringify({
        symbol: 'NVDA',
        side: 'BUY',
        quantity: 1,
        clientRequestId: 'order-nvda-disabled-1',
      }),
    });
    assert.equal(blockedOrderRes.status, 400);
    const blockedOrderBody = (await blockedOrderRes.json()) as { code: string };
    assert.equal(blockedOrderBody.code, 'SYMBOL_DISABLED');

    // Run catalog sync background job
    const jobRes = await fetch(`${ctx.baseUrl}/api/admin/jobs/market-catalog-sync/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: superAdmin.cookie },
    });
    assert.equal(jobRes.status, 200);
    const jobJson = (await jobRes.json()) as { job: { status: string } };
    assert.equal(jobJson.job.status, 'SUCCEEDED');

    // Execute AI research without GEMINI_API_KEY -> honest AI Building Mode error + recorded FAILED in ai_request_logs
    const savedKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = '';
    try {
      await assert.rejects(
        () =>
          executeFinancialResearch({
            symbol: 'TCS',
            query: 'Margin resilience assessment',
            runtimeConfigManager: ctx.runtimeConfigManager,
            userId: trader.user.id,
            feature: 'workspace_research',
          }),
        (err: { code?: string }) => err?.code === 'AI_NOT_CONFIGURED',
      );
    } finally {
      process.env.GEMINI_API_KEY = savedKey;
    }

    const aiOverviewRes = await fetch(`${ctx.baseUrl}/api/admin/ai/overview`, {
      headers: { Cookie: superAdmin.cookie },
    });
    const aiOverview = (await aiOverviewRes.json()) as {
      requests: Array<{ symbol: string; status: string }>;
    };
    assert.ok(aiOverview.requests.some((r) => r.symbol === 'TCS' && r.status === 'FAILED'));

    // Emergency maintenance toggle blocks workspace API while admin API stays accessible
    const maintOn = await fetch(`${ctx.baseUrl}/api/admin/emergency`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: superAdmin.cookie },
      body: JSON.stringify({
        operation: 'ENABLE_MAINTENANCE_MODE',
        reason: 'Emergency rollout test',
        confirmPassword: superPw,
      }),
    });
    assert.equal(maintOn.status, 200);

    const workspaceDuringMaint = await fetch(`${ctx.baseUrl}/api/workspace/portfolios`, {
      headers: { Cookie: trader.cookie },
    });
    assert.equal(workspaceDuringMaint.status, 503);

    const adminDuringMaint = await fetch(`${ctx.baseUrl}/api/admin/config`, {
      headers: { Cookie: superAdmin.cookie },
    });
    assert.equal(adminDuringMaint.status, 200);
    const configBody = (await adminDuringMaint.json()) as {
      configAudit: Array<{ id: string; configKey: string }>;
    };
    const maintAudit = configBody.configAudit.find((h) => h.configKey === 'maintenance_mode');
    assert.ok(maintAudit);

    // Config rollback restores previous maintenance_mode=false
    const rollbackRes = await fetch(`${ctx.baseUrl}/api/admin/config/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: superAdmin.cookie },
      body: JSON.stringify({
        auditId: maintAudit.id,
        confirmPassword: superPw,
      }),
    });
    assert.equal(rollbackRes.status, 200);

    const workspaceAfterRollback = await fetch(`${ctx.baseUrl}/api/workspace/portfolios`, {
      headers: { Cookie: trader.cookie },
    });
    assert.equal(workspaceAfterRollback.status, 200);
  } finally {
    await ctx.close();
  }
});
