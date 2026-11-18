import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import { createAuthDatabase } from '../auth/db';
import { createAuthService } from '../auth/service';
import { createAuthRouter, extractSessionToken } from '../auth/router';
import type { AuthEmailSender, OutboundAuthEmail } from '../auth/email';
import { createWorkspaceService } from '../workspace/service';
import { createWorkspaceRouter } from '../workspace/router';
import { createRuntimeConfigManager } from './runtimeSettings';
import { createBackgroundJobManager, createTelemetryCollector } from './telemetry';
import { createAdminService } from './service';
import { createAdminRouter } from './router';
import { createPrivacyRouter } from './privacyRouter';
import {
  buildCsvDocument,
  buildSafeUserDataExport,
  buildTenCategoryConfigInventory,
  canCancelDeletionStatus,
  computeRolloutBucket,
  containsForbiddenExportKeys,
  escapeCsvFormulaSafe,
  evaluateFeatureFlag,
  evaluateMaintenanceState,
  isValidFlagKey,
  resolveEffectiveLifecycleState,
} from './governanceMath';
import { DEFAULT_PLATFORM_CONFIG } from './types';

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

async function startPhase5Harness(options?: { fileBackedDb?: boolean }) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextrade-p5-'));
  const dbTarget = options?.fileBackedDb ? path.join(tmpDir, 'test-runtime.sqlite') : ':memory:';
  const db = await createAuthDatabase(dbTarget);
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
  const workspaceService = createWorkspaceService({ db, runtimeConfigManager });
  const adminService = createAdminService({
    db,
    authService,
    emailSender: mockMail.sender,
    runtimeConfigManager,
    telemetryCollector,
    jobManager,
    projectRoot: tmpDir,
  });

  const app = express();
  app.use(express.json());
  app.use(
    '/api/auth',
    createAuthRouter({
      authService,
      emailSender: mockMail.sender,
      authDatabase: 'sqlite',
      rateLimits: { loginIpMax: 100, loginAccountMax: 100, signupIpMax: 100 },
    }),
  );

  const maintenanceGate: express.RequestHandler = async (req, res, next) => {
    const base = await adminService.governance.getEffectiveMaintenanceStatus(null);
    if (base.active) {
      const token = extractSessionToken(req);
      const verified = token ? await authService.authenticateSessionToken(token) : null;
      const roleAware = verified
        ? await adminService.governance.getEffectiveMaintenanceStatus(verified.user.role)
        : base;
      if (roleAware.active && !roleAware.bypassed) {
        res.status(503).json({
          error: roleAware.message,
          code: 'MAINTENANCE_MODE',
          expectedCompletionNote: roleAware.expectedCompletionNote,
        });
        return;
      }
    }
    next();
  };

  app.use('/api/workspace', maintenanceGate, createWorkspaceRouter({ authService, workspaceService }));
  app.use('/api/privacy', createPrivacyRouter({ authService, adminService }));
  app.get('/api/features/evaluated', async (req, res) => {
    const token = extractSessionToken(req);
    const verified = token ? await authService.authenticateSessionToken(token) : null;
    const data = await adminService.governance.evaluateClientFeatureFlags({
      userId: verified?.user.id ?? null,
      userRole: verified?.user.role ?? null,
    });
    res.json({ ok: true, ...data });
  });
  app.use(
    '/api/admin',
    createAdminRouter({
      authService,
      adminService,
      jobManager,
      rateLimits: { mutationMax: 300, sensitiveMax: 100 },
    }),
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  async function signupAndVerify(
    fullName: string,
    email: string,
    password: string,
    role?: string,
  ): Promise<{ userId: string; cookie: string }> {
    const sRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({
        fullName,
        email,
        password,
        confirmPassword: password,
        acceptTerms: true,
        acceptPrivacy: true,
      }),
    });
    assert.equal(sRes.status, 201, `Signup failed for ${email}: ${sRes.status} ${await sRes.clone().text()}`);
    const tok = mockMail.extractToken(email, 'verification');
    const vRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ token: tok }),
    });
    assert.equal(vRes.status, 200);
    const uRow = await db.queryOne<{ id: string }>(
      'SELECT id FROM users WHERE LOWER(email) = LOWER(?)',
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [email],
    );
    assert.ok(uRow);
    if (role) {
      await db.execute(
        'UPDATE users SET role = ? WHERE id = ?',
        'UPDATE users SET role = $1 WHERE id = $2',
        [role, uRow.id],
      );
    }
    const lRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(lRes.status, 200);
    return { userId: uRow.id, cookie: extractCookieValue(lRes) };
  }

  return {
    db,
    tmpDir,
    server,
    baseUrl,
    adminService,
    runtimeConfigManager,
    signupAndVerify,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

// ---- PURE LOGIC TESTS ----

test('Phase 5 Pure Logic: lifecycle resolver, secret scan & CSV formula escaping', () => {
  assert.equal(
    resolveEffectiveLifecycleState({
      storedState: null,
      accountStatus: 'active',
      emailVerified: true,
      email: 'alice@example.com',
    }),
    'active',
  );
  assert.equal(
    resolveEffectiveLifecycleState({
      storedState: null,
      accountStatus: 'active',
      emailVerified: false,
      email: 'pending@example.com',
    }),
    'pending_verification',
  );
  assert.equal(
    resolveEffectiveLifecycleState({
      storedState: 'deletion_scheduled',
      accountStatus: 'active',
      emailVerified: true,
      email: 'deleted-1234@deleted.local',
    }),
    'deleted_anonymized',
  );
  assert.equal(canCancelDeletionStatus('PENDING_REVIEW'), true);
  assert.equal(canCancelDeletionStatus('SCHEDULED'), true);
  assert.equal(canCancelDeletionStatus('COMPLETED'), false);

  const exportObj = buildSafeUserDataExport({
    exportId: 'exp-1',
    generatedAt: '2026-11-16T00:00:00.000Z',
    user: {
      id: 'u1',
      fullName: 'Alice',
      email: 'alice@example.com',
      emailVerified: true,
      accountStatus: 'active',
      lifecycleState: 'active',
      role: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastLoginAt: null,
    },
    preferences: null,
    portfolios: [],
    watchlists: [],
    paperAccount: null,
    paperOrders: [],
    paperTransactions: [],
    aiResearchHistory: [],
    savedReports: [],
    sessionsSummary: [],
    securityEvents: [],
  });
  assert.deepEqual(containsForbiddenExportKeys(exportObj), []);
  assert.deepEqual(containsForbiddenExportKeys({ nested: { passwordHash: 'abc', token_hash: 'xyz' } }), [
    'nested.passwordHash',
    'nested.token_hash',
  ]);

  assert.equal(escapeCsvFormulaSafe('=cmd|calc'), `'=cmd|calc`);
  assert.equal(escapeCsvFormulaSafe('+123'), `'+123`);
  const csv = buildCsvDocument(['col1', 'col2'], [['=SUM(A1,B1)', 'ok']]);
  assert.ok(csv.includes(`"'=SUM(A1,B1)"`));
});

test('Phase 5 Pure Logic: deterministic feature flags, rollout buckets & 10-category config matrix', () => {
  assert.equal(isValidFlagKey('ai.explainable_briefs'), true);
  assert.equal(isValidFlagKey('BAD KEY!'), false);

  const bucketA = computeRolloutBucket('user-123', 'feature.alpha');
  const bucketB = computeRolloutBucket('user-123', 'feature.alpha');
  assert.equal(bucketA, bucketB);
  assert.ok(bucketA >= 0 && bucketA <= 99);

  const now = new Date('2026-11-16T12:00:00.000Z');
  const flagBase = {
    id: 'f1',
    flagKey: 'feature.alpha',
    name: 'Alpha',
    description: '',
    enabled: true,
    environmentScope: 'production' as const,
    rolloutPercentage: 100,
    targetRoles: [] as Array<'admin'>,
    isKillSwitch: false,
    clientExposed: true,
    startsAt: null,
    endsAt: null,
    updatedBy: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  const nowMs = now.getTime();
  assert.equal(
    evaluateFeatureFlag(flagBase, { environment: 'development', userId: 'u1', nowMs }).active,
    false,
  );
  assert.equal(
    evaluateFeatureFlag({ ...flagBase, environmentScope: 'all', targetRoles: ['admin'] }, { environment: 'production', userId: 'u1', userRole: 'user', nowMs }).active,
    false,
  );
  assert.equal(
    evaluateFeatureFlag({ ...flagBase, environmentScope: 'all', targetRoles: ['admin'] }, { environment: 'production', userId: 'u1', userRole: 'admin', nowMs }).active,
    true,
  );

  const maint = evaluateMaintenanceState({
    manualConfig: { enabled: false, message: 'Off', allowAdminRecovery: true },
    windows: [
      {
        id: 'w1',
        title: 'DB Maintenance',
        message: 'Upgrading storage',
        status: 'SCHEDULED',
        startsAt: '2026-11-16T11:30:00.000Z',
        endsAt: '2026-11-16T12:30:00.000Z',
        expectedCompletionNote: '12:30 UTC',
        bypassRoles: ['super_admin'],
        createdBy: null,
        createdByEmail: 'admin@test',
        activatedAt: null,
        endedAt: null,
        createdAt: '2026-11-16T10:00:00.000Z',
        updatedAt: '2026-11-16T10:00:00.000Z',
      },
    ],
    userRole: 'user',
    nowMs: now.getTime(),
  });
  assert.equal(maint.inMaintenance, true);
  assert.equal(maint.bypassAllowed, false);

  const maintAdmin = evaluateMaintenanceState({
    manualConfig: { enabled: false, message: 'Off', allowAdminRecovery: true },
    windows: [
      {
        id: 'w1',
        title: 'DB Maintenance',
        message: 'Upgrading storage',
        status: 'ACTIVE',
        startsAt: '2026-11-16T11:30:00.000Z',
        endsAt: null,
        expectedCompletionNote: 'Shortly',
        bypassRoles: ['super_admin'],
        createdBy: null,
        createdByEmail: 'admin@test',
        activatedAt: '2026-11-16T11:30:00.000Z',
        endedAt: null,
        createdAt: '2026-11-16T10:00:00.000Z',
        updatedAt: '2026-11-16T10:00:00.000Z',
      },
    ],
    userRole: 'super_admin',
    nowMs: now.getTime(),
  });
  assert.equal(maintAdmin.inMaintenance, true);
  assert.equal(maintAdmin.bypassAllowed, true);

  const entries = buildTenCategoryConfigInventory({
    config: DEFAULT_PLATFORM_CONFIG,
    envStatus: {
      geminiConfigured: false,
      emailConfigured: true,
      databaseDialect: 'postgres',
      backupProviderConfigured: false,
    },
  });
  const categories = new Set(entries.map((e) => e.category));
  assert.equal(categories.size, 10);
  const secretEntries = entries.filter((e) => e.valueType === 'secret_status');
  assert.ok(secretEntries.length >= 2);
  for (const s of secretEntries) {
    assert.ok(s.value === 'CONFIGURED' || s.value === 'NOT_CONFIGURED');
  }
});

// ---- INTEGRATION TESTS ----

test('Phase 5 Lifecycle: suspend, notes, deletion scheduling, grace cancellation, last super_admin & self guards', async () => {
  const h = await startPhase5Harness();
  try {
    const sa = await h.signupAndVerify('Platform Operator', 'sa@nextrade.example', 'NxtOps!9482#Zx', 'super_admin');
    const secAdmin = await h.signupAndVerify('Security Officer', 'sec@nextrade.example', 'NxtSec!7391#Qm', 'security_admin');
    const alice = await h.signupAndVerify('Alice Trader', 'alice@nextrade.example', 'Vanguard!6184#Kp', 'user');

    // Last super_admin cannot be deletion-scheduled
    const selfGuard = await fetch(`${h.baseUrl}/api/admin/users/${sa.userId}/lifecycle/deletion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: h.baseUrl, Cookie: sa.cookie },
      body: JSON.stringify({ mode: 'schedule', graceDays: 5 }),
    });
    assert.equal(selfGuard.status, 400);

    const lastSaGuard = await fetch(`${h.baseUrl}/api/admin/users/${sa.userId}/lifecycle/deletion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: h.baseUrl, Cookie: secAdmin.cookie },
      body: JSON.stringify({ mode: 'schedule', graceDays: 5 }),
    });
    assert.equal(lastSaGuard.status, 403);

    // Add internal admin note
    const noteRes = await fetch(`${h.baseUrl}/api/admin/users/${alice.userId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: h.baseUrl, Cookie: secAdmin.cookie },
      body: JSON.stringify({ note: 'Verified KYC check complete.' }),
    });
    assert.equal(noteRes.status, 201);

    // Schedule deletion with grace period
    const schedRes = await fetch(`${h.baseUrl}/api/admin/users/${alice.userId}/lifecycle/deletion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: h.baseUrl, Cookie: secAdmin.cookie },
      body: JSON.stringify({ mode: 'schedule', graceDays: 10, reason: 'User ticket N-12' }),
    });
    assert.equal(schedRes.status, 200);
    const schedBody = (await schedRes.json()) as { lifecycleState: string };
    assert.equal(schedBody.lifecycleState, 'deletion_scheduled');

    // Cancel scheduled deletion
    const cancelRes = await fetch(`${h.baseUrl}/api/admin/users/${alice.userId}/lifecycle/deletion/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: h.baseUrl, Cookie: secAdmin.cookie },
      body: JSON.stringify({ reason: 'User decided to keep account' }),
    });
    assert.equal(cancelRes.status, 200);

    // Non-super_admin cannot perform immediate anonymization
    const secAnonDenied = await fetch(`${h.baseUrl}/api/admin/users/${alice.userId}/lifecycle/deletion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: h.baseUrl, Cookie: secAdmin.cookie },
      body: JSON.stringify({ mode: 'anonymize_now', confirmPassword: 'NxtSec!7391#Qm' }),
    });
    assert.equal(secAnonDenied.status, 403);

    // Super admin immediate anonymization requires password re-auth and wipes PII
    const saNoPw = await fetch(`${h.baseUrl}/api/admin/users/${alice.userId}/lifecycle/deletion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: h.baseUrl, Cookie: sa.cookie },
      body: JSON.stringify({ mode: 'anonymize_now' }),
    });
    assert.equal(saNoPw.status, 428);

    const saAnonOk = await fetch(`${h.baseUrl}/api/admin/users/${alice.userId}/lifecycle/deletion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: h.baseUrl, Cookie: sa.cookie },
      body: JSON.stringify({ mode: 'anonymize_now', confirmPassword: 'NxtOps!9482#Zx', reason: 'GDPR Art 17 closure' }),
    });
    assert.equal(saAnonOk.status, 200);

    const lcDetailRes = await fetch(`${h.baseUrl}/api/admin/users/${alice.userId}/lifecycle`, {
      headers: { Cookie: sa.cookie },
    });
    assert.equal(lcDetailRes.status, 200);
    const lcBody = (await lcDetailRes.json()) as { lifecycle: { lifecycleState: string; notes: unknown[]; events: unknown[] } };
    assert.equal(lcBody.lifecycle.lifecycleState, 'deleted_anonymized');
    assert.equal(lcBody.lifecycle.notes.length, 1);
    assert.ok(lcBody.lifecycle.events.length >= 3);
  } finally {
    await h.close();
  }
});

test('Phase 5 Privacy: export secret exclusion, signed URL ownership IDOR protection, expired link & self deletion', async () => {
  const h = await startPhase5Harness();
  try {
    const alice = await h.signupAndVerify('Alice Owner', 'alice.priv@nextrade.example', 'Vanguard!6184#Kp', 'user');
    const bob = await h.signupAndVerify('Bob Intruder', 'bob.priv@nextrade.example', 'Horizon!5247#Wn', 'user');

    // Alice requests personal export
    const expRes = await fetch(`${h.baseUrl}/api/privacy/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: h.baseUrl, Cookie: alice.cookie },
      body: JSON.stringify({}),
    });
    assert.equal(expRes.status, 201);
    const expData = (await expRes.json()) as {
      request: { id: string; status: string; downloadUrl: string | null };
    };
    assert.equal(expData.request.status, 'READY');
    assert.ok(expData.request.downloadUrl);

    // Bob attempts IDOR download with Alice's signed URL -> 403
    const idorRes = await fetch(`${h.baseUrl}${expData.request.downloadUrl}`, {
      headers: { Cookie: bob.cookie },
    });
    assert.equal(idorRes.status, 403);

    // Alice downloads cleanly and JSON contains zero secrets/hashes
    const dlRes = await fetch(`${h.baseUrl}${expData.request.downloadUrl}`, {
      headers: { Cookie: alice.cookie },
    });
    assert.equal(dlRes.status, 200);
    const rawJson = await dlRes.text();
    const parsedExport = JSON.parse(rawJson);
    assert.equal(parsedExport.account.email, 'alice.priv@nextrade.example');
    assert.deepEqual(containsForbiddenExportKeys(parsedExport), []);
    assert.equal(rawJson.includes('password_hash'), false);
    assert.equal(rawJson.includes('$argon2'), false);

    // Tampered signature rejected
    const tamperedRes = await fetch(`${h.baseUrl}/api/privacy/export/${expData.request.id}/download?sig=deadbeef`, {
      headers: { Cookie: alice.cookie },
    });
    assert.equal(tamperedRes.status, 403);

    // Force expiration in DB -> HTTP 410 Gone
    await h.db.execute(
      'UPDATE data_export_requests SET expires_at = ? WHERE id = ?',
      'UPDATE data_export_requests SET expires_at = $1::timestamptz WHERE id = $2',
      ['2020-01-01T00:00:00.000Z', expData.request.id],
    );
    const expiredRes = await fetch(`${h.baseUrl}${expData.request.downloadUrl}`, {
      headers: { Cookie: alice.cookie },
    });
    assert.equal(expiredRes.status, 410);

    // Self-service deletion request + cancellation during grace period
    const delReqRes = await fetch(`${h.baseUrl}/api/privacy/deletion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: h.baseUrl, Cookie: alice.cookie },
      body: JSON.stringify({ reason: 'Closing account temporarily' }),
    });
    assert.equal(delReqRes.status, 201);
    const delBody = (await delReqRes.json()) as { request: { id: string; status: string } };
    assert.equal(delBody.request.status, 'PENDING_REVIEW');

    // Bob cannot cancel Alice's deletion request
    const bobCancel = await fetch(`${h.baseUrl}/api/privacy/deletion/${delBody.request.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: h.baseUrl, Cookie: bob.cookie },
      body: JSON.stringify({}),
    });
    assert.equal(bobCancel.status, 403);

    // Alice cancels own request cleanly
    const aliceCancel = await fetch(`${h.baseUrl}/api/privacy/deletion/${delBody.request.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: h.baseUrl, Cookie: alice.cookie },
      body: JSON.stringify({}),
    });
    assert.equal(aliceCancel.status, 200);
  } finally {
    await h.close();
  }
});

test('Phase 5 Backups: real SQLite VACUUM INTO + verification + re-auth restore & honest in-memory NOT_CONFIGURED', async () => {
  const fileHarness = await startPhase5Harness({ fileBackedDb: true });
  try {
    const sa = await fileHarness.signupAndVerify('Lead Operator', 'sa.bk@nextrade.example', 'NxtOps!9482#Zx', 'super_admin');
    const admin = await fileHarness.signupAndVerify('Platform Admin', 'adm.bk@nextrade.example', 'Citadel!8314#Rv', 'admin');

    // File-backed SQLite advertises fullDatabaseBackupSupported = true
    const listRes = await fetch(`${fileHarness.baseUrl}/api/admin/backups`, {
      headers: { Cookie: sa.cookie },
    });
    assert.equal(listRes.status, 200);
    const listBody = (await listRes.json()) as {
      capabilities: { fullDatabaseBackupSupported: boolean };
    };
    assert.equal(listBody.capabilities.fullDatabaseBackupSupported, true);

    // Create SQLITE_SNAPSHOT & CONFIG_SNAPSHOT
    const snapRes = await fetch(`${fileHarness.baseUrl}/api/admin/backups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: fileHarness.baseUrl, Cookie: admin.cookie },
      body: JSON.stringify({ backupType: 'SQLITE_SNAPSHOT' }),
    });
    assert.equal(snapRes.status, 201);
    const snapBody = (await snapRes.json()) as { backup: { id: string; status: string; checksumSha256: string } };
    assert.equal(snapBody.backup.status, 'VERIFIED');
    assert.ok(snapBody.backup.checksumSha256);

    const cfgSnapRes = await fetch(`${fileHarness.baseUrl}/api/admin/backups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: fileHarness.baseUrl, Cookie: admin.cookie },
      body: JSON.stringify({ backupType: 'CONFIG_SNAPSHOT' }),
    });
    assert.equal(cfgSnapRes.status, 201);
    const cfgSnapBody = (await cfgSnapRes.json()) as { backup: { id: string } };

    // Simulate unverified CREATED backup -> Restore fails until VERIFIED (409)
    await fileHarness.db.execute(
      "UPDATE backup_records SET status = 'CREATED', verified_at = NULL WHERE id = ?",
      "UPDATE backup_records SET status = 'CREATED', verified_at = NULL WHERE id = $1",
      [cfgSnapBody.backup.id],
    );
    const unverifiedRestore = await fetch(`${fileHarness.baseUrl}/api/admin/backups/${cfgSnapBody.backup.id}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: fileHarness.baseUrl, Cookie: sa.cookie },
      body: JSON.stringify({ confirmPassword: 'NxtOps!9482#Zx', confirmPhrase: 'RESTORE BACKUP' }),
    });
    assert.equal(unverifiedRestore.status, 409);

    // Verify both backups
    const verify1 = await fetch(`${fileHarness.baseUrl}/api/admin/backups/${snapBody.backup.id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: fileHarness.baseUrl, Cookie: admin.cookie },
      body: JSON.stringify({}),
    });
    assert.equal(verify1.status, 200);

    const verify2 = await fetch(`${fileHarness.baseUrl}/api/admin/backups/${cfgSnapBody.backup.id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: fileHarness.baseUrl, Cookie: admin.cookie },
      body: JSON.stringify({}),
    });
    assert.equal(verify2.status, 200);

    // Regular admin cannot restore (only super_admin holds ADMIN_BACKUP_RESTORE)
    const adminRestoreDenied = await fetch(`${fileHarness.baseUrl}/api/admin/backups/${cfgSnapBody.backup.id}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: fileHarness.baseUrl, Cookie: admin.cookie },
      body: JSON.stringify({ confirmPassword: 'Citadel!8314#Rv', confirmPhrase: 'RESTORE BACKUP' }),
    });
    assert.equal(adminRestoreDenied.status, 403);

    // Wrong confirmation phrase fails for super_admin
    const badPhraseRes = await fetch(`${fileHarness.baseUrl}/api/admin/backups/${cfgSnapBody.backup.id}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: fileHarness.baseUrl, Cookie: sa.cookie },
      body: JSON.stringify({ confirmPassword: 'NxtOps!9482#Zx', confirmPhrase: 'nope' }),
    });
    assert.equal(badPhraseRes.status, 400);

    // Valid restore succeeds for both CONFIG_SNAPSHOT and SQLITE_SNAPSHOT
    const restoreCfgOk = await fetch(`${fileHarness.baseUrl}/api/admin/backups/${cfgSnapBody.backup.id}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: fileHarness.baseUrl, Cookie: sa.cookie },
      body: JSON.stringify({ confirmPassword: 'NxtOps!9482#Zx', confirmPhrase: 'RESTORE BACKUP' }),
    });
    assert.equal(restoreCfgOk.status, 200);

    const restoreSqlOk = await fetch(`${fileHarness.baseUrl}/api/admin/backups/${snapBody.backup.id}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: fileHarness.baseUrl, Cookie: sa.cookie },
      body: JSON.stringify({ confirmPassword: 'NxtOps!9482#Zx', confirmPhrase: 'RESTORE BACKUP' }),
    });
    assert.equal(restoreSqlOk.status, 200);
  } finally {
    await fileHarness.close();
  }

  // Verify :memory: / non-file runtime fails honestly with NOT_CONFIGURED for FULL_DATABASE
  const memHarness = await startPhase5Harness({ fileBackedDb: false });
  try {
    const sa = await memHarness.signupAndVerify('Memory Operator', 'sa.mem@nextrade.example', 'NxtOps!9482#Zx', 'super_admin');
    const badFull = await fetch(`${memHarness.baseUrl}/api/admin/backups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: memHarness.baseUrl, Cookie: sa.cookie },
      body: JSON.stringify({ backupType: 'FULL_DATABASE' }),
    });
    assert.equal(badFull.status, 409);
    const errBody = (await badFull.json()) as { code: string };
    assert.equal(errBody.code, 'BACKUP_PROVIDER_NOT_CONFIGURED');
  } finally {
    await memHarness.close();
  }
});

test('Phase 5 Features, Releases, Scheduled Maintenance, 10-Category Config & Governance CSV', async () => {
  const h = await startPhase5Harness();
  try {
    const sa = await h.signupAndVerify('Lead Operator', 'sa.gov@nextrade.example', 'NxtOps!9482#Zx', 'super_admin');
    const viewer = await h.signupAndVerify('Marcus Trader', 'user.gov@nextrade.example', 'Summit!3920#Lt', 'user');

    // Create client-exposed feature flag + internal flag
    const flagRes = await fetch(`${h.baseUrl}/api/admin/features`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: h.baseUrl, Cookie: sa.cookie },
      body: JSON.stringify({
        flagKey: 'workspace.alpha_tool',
        name: 'Alpha Tool',
        enabled: true,
        rolloutPercentage: 100,
        clientExposed: true,
      }),
    });
    assert.equal(flagRes.status, 201);
    const flagBody = (await flagRes.json()) as { flag: { id: string } };

    // Evaluated endpoint exposes client_exposed only and excludes internal ops.strict_audit_export_watermark
    const evalRes = await fetch(`${h.baseUrl}/api/features/evaluated`, {
      headers: { Cookie: viewer.cookie },
    });
    assert.equal(evalRes.status, 200);
    const evalBody = (await evalRes.json()) as { flags: Record<string, { enabled: boolean }> };
    assert.equal(evalBody.flags['workspace.alpha_tool']?.enabled, true);
    assert.equal(evalBody.flags['ops.strict_audit_export_watermark'], undefined);

    // Update flag then rollback via history
    const updFlag = await fetch(`${h.baseUrl}/api/admin/features/${flagBody.flag.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: h.baseUrl, Cookie: sa.cookie },
      body: JSON.stringify({ enabled: false, reason: 'Testing kill switch' }),
    });
    assert.equal(updFlag.status, 200);

    const featList = await fetch(`${h.baseUrl}/api/admin/features`, { headers: { Cookie: sa.cookie } });
    const featBody = (await featList.json()) as { history: Array<{ id: string; flagId: string }> };
    const latestHist = featBody.history.find((item) => item.flagId === flagBody.flag.id);
    assert.ok(latestHist);

    const rbFlag = await fetch(`${h.baseUrl}/api/admin/features/rollback/${latestHist.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: h.baseUrl, Cookie: sa.cookie },
      body: JSON.stringify({}),
    });
    assert.equal(rbFlag.status, 200);
    const rbData = (await rbFlag.json()) as { flag: { enabled: boolean } };
    assert.equal(rbData.flag.enabled, true);

    // Create manual release and activate maintenance window with bypassRoles=['super_admin']
    const relRes = await fetch(`${h.baseUrl}/api/admin/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: h.baseUrl, Cookie: sa.cookie },
      body: JSON.stringify({ version: 'v1.5.0-gov', summary: 'Phase 5 verification release' }),
    });
    assert.equal(relRes.status, 201);

    const mwRes = await fetch(`${h.baseUrl}/api/admin/maintenance-windows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: h.baseUrl, Cookie: sa.cookie },
      body: JSON.stringify({
        title: 'Scheduled Ledger Upgrade',
        message: 'Workspace temporarily paused for ledger maintenance.',
        expectedCompletionNote: 'Expected back in 15 mins',
        bypassRoles: ['super_admin'],
        activateImmediately: true,
      }),
    });
    assert.equal(mwRes.status, 201);
    const mwData = (await mwRes.json()) as { window: { id: string } };

    // Regular user hits 503 MAINTENANCE_MODE on workspace, Super Admin bypasses!
    const userWs = await fetch(`${h.baseUrl}/api/workspace/profile`, { headers: { Cookie: viewer.cookie } });
    assert.equal(userWs.status, 503);
    const saWs = await fetch(`${h.baseUrl}/api/workspace/profile`, { headers: { Cookie: sa.cookie } });
    assert.equal(saWs.status, 200);

    // Complete window -> regular user succeeds again
    const compMw = await fetch(`${h.baseUrl}/api/admin/maintenance-windows/${mwData.window.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: h.baseUrl, Cookie: sa.cookie },
      body: JSON.stringify({}),
    });
    assert.equal(compMw.status, 200);
    const userWsAfter = await fetch(`${h.baseUrl}/api/workspace/profile`, { headers: { Cookie: viewer.cookie } });
    assert.equal(userWsAfter.status, 200);

    // 10-category config & re-auth policy update + governance CSV export
    const cfgGovRes = await fetch(`${h.baseUrl}/api/admin/config/governance`, { headers: { Cookie: sa.cookie } });
    assert.equal(cfgGovRes.status, 200);
    const cfgGovBody = (await cfgGovRes.json()) as { categories: string[]; entries: unknown[] };
    assert.equal(cfgGovBody.categories.length, 10);

    const updGov = await fetch(`${h.baseUrl}/api/admin/config/governance`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: h.baseUrl, Cookie: sa.cookie },
      body: JSON.stringify({
        confirmPassword: 'NxtOps!9482#Zx',
        policies: { deletionGracePeriodDays: 14 },
        reason: 'Extended privacy grace period to 14 days',
      }),
    });
    assert.equal(updGov.status, 200);

    const reportRes = await fetch(`${h.baseUrl}/api/admin/governance/report`, { headers: { Cookie: sa.cookie } });
    assert.equal(reportRes.status, 200);
    const reportBody = (await reportRes.json()) as { readinessDisclaimer: string; controlMatrix: unknown[] };
    assert.ok(reportBody.readinessDisclaimer.includes('do NOT represent formal GDPR'));
    assert.ok(reportBody.controlMatrix.length >= 4);

    const csvRes = await fetch(`${h.baseUrl}/api/admin/governance/export`, { headers: { Cookie: sa.cookie } });
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    assert.ok(csvText.startsWith('id,category,action,actorEmail,target,result,createdAt'));
  } finally {
    await h.close();
  }
});
