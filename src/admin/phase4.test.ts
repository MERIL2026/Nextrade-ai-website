import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { createAuthDatabase } from '../auth/db';
import { createAuthService } from '../auth/service';
import { createAuthRouter } from '../auth/router';
import type { AuthEmailSender, OutboundAuthEmail } from '../auth/email';
import { createRuntimeConfigManager } from './runtimeSettings';
import { createBackgroundJobManager, createTelemetryCollector } from './telemetry';
import { createAdminService } from './service';
import { createAdminRouter } from './router';
import {
  classifySecurityEventSeverity,
  computeLatencyStats,
  computePeriodDeltaPct,
  evaluateAlertCandidates,
  isJobStuck,
  maskUserPromptSummary,
  redactSensitiveText,
  resolveObservabilityWindow,
  sanitizeRoutePath,
  shouldBypassCooldownOnSeverityEscalation,
} from './observabilityMath';
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

async function startPhase4Harness() {
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

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, status: 'healthy' });
  });

  app.get('/api/slow-test', async (_req, res) => {
    await new Promise((r) => setTimeout(r, 15));
    res.status(503).json({ ok: false, error: 'Simulated upstream timeout' });
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

  app.use(
    '/api/admin',
    createAdminRouter({
      authService,
      adminService,
      jobManager,
      rateLimits: { mutationMax: 300, sensitiveMax: 100 },
    }),
  );

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
    assert.equal(signupOut.ok, true, `Signup failed: ${signupOut.ok ? '' : signupOut.error}`);
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

// ---------------------------------------------------------------------------
// 1. PURE UNIT TESTS (observabilityMath.ts)
// ---------------------------------------------------------------------------

test('Phase 4 pure math: time windows, percentiles, period deltas, and redaction', () => {
  const fixedNow = Date.parse('2026-11-15T12:00:00.000Z');

  const w15m = resolveObservabilityWindow('15m', undefined, undefined, fixedNow);
  assert.equal(w15m.range, '15m');
  assert.equal(w15m.durationMs, 15 * 60 * 1000);
  assert.equal(w15m.fromIso, '2026-11-15T11:45:00.000Z');
  assert.equal(w15m.previousFromIso, '2026-11-15T11:30:00.000Z');

  const wCustom = resolveObservabilityWindow(
    'custom',
    '2026-11-14T00:00:00.000Z',
    '2026-11-15T00:00:00.000Z',
    fixedNow,
  );
  assert.equal(wCustom.range, 'custom');
  assert.equal(wCustom.durationMs, 24 * 60 * 60 * 1000);

  const wAll = resolveObservabilityWindow('all', undefined, undefined, fixedNow);
  assert.equal(wAll.fromIso, null);
  assert.equal(wAll.previousFromIso, null);

  const stats = computeLatencyStats([10, 20, 30, 40, 50, 100, 250, 800, 1200, 2400]);
  assert.equal(stats.count, 10);
  assert.equal(stats.p50Ms, 50);
  assert.equal(stats.p95Ms, 2400);
  assert.equal(stats.p99Ms, 2400);
  assert.equal(stats.maxMs, 2400);

  assert.equal(computeLatencyStats([]).count, 0);
  assert.equal(computePeriodDeltaPct(150, 100), 50);
  assert.equal(computePeriodDeltaPct(50, 100), -50);
  assert.equal(computePeriodDeltaPct(0, 0), 0);
  assert.equal(computePeriodDeltaPct(10, 0), 100);
  assert.equal(computePeriodDeltaPct(10, null), null);

  const cleanRoute = sanitizeRoutePath(
    '/api/admin/users/550e8400-e29b-41d4-a716-446655440000?token=supersecret&email=alice@example.com',
  );
  assert.equal(cleanRoute, '/api/admin/users/:id');
  assert.equal(cleanRoute.includes('supersecret'), false);

  const redacted = redactSensitiveText(
    'User alice@example.com sent Bearer abc.def.ghi and AIzaSyD_exampleSecretKey12345 with card 4111222233334444',
  );
  assert.equal(redacted.includes('alice@example.com'), false);
  assert.equal(redacted.includes('abc.def.ghi'), false);
  assert.equal(redacted.includes('AIzaSyD_exampleSecretKey12345'), false);
  assert.equal(redacted.includes('4111222233334444'), false);

  const masked = maskUserPromptSummary('Analyze alice@example.com AAPL thesis', 'AAPL');
  assert.ok(masked.startsWith('[Redacted Preview · AAPL]'));
  assert.equal(masked.includes('alice@example.com'), false);

  assert.equal(classifySecurityEventSeverity('csrf_origin_mismatch', ''), 'CRITICAL');
  assert.equal(classifySecurityEventSeverity('login_blocked', ''), 'HIGH');
  assert.equal(classifySecurityEventSeverity('login_failed', ''), 'MEDIUM');
  assert.equal(classifySecurityEventSeverity('session_created', ''), 'LOW');

  assert.equal(
    isJobStuck(
      { status: 'RUNNING', updatedAt: '2026-11-15T11:00:00.000Z', lastRunAt: null },
      15,
      fixedNow,
    ),
    true,
  );
  assert.equal(
    isJobStuck(
      { status: 'SUCCEEDED', updatedAt: '2026-11-15T11:00:00.000Z', lastRunAt: null },
      15,
      fixedNow,
    ),
    false,
  );

  const alerts = evaluateAlertCandidates(
    {
      apiTotal: 20,
      api5xxCount: 6,
      apiErrorRatePct: 30,
      apiP95LatencyMs: 2500,
      apiRateLimitCount: 2,
      aiTotal: 5,
      aiFailedCount: 3,
      aiErrorRatePct: 60,
      failedLoginsWindow: 8,
      marketLastSyncAgeMinutes: 2000,
      marketLastSyncStatus: 'SUCCEEDED',
      stuckJobsCount: 1,
      failedJobsCount: 1,
      stuckJobIds: ['health-probe'],
      failedJobIds: ['market-catalog-sync'],
    },
    DEFAULT_PLATFORM_CONFIG.alert_thresholds,
  );
  assert.equal(alerts.length, 7);
  assert.equal(shouldBypassCooldownOnSeverityEscalation('MEDIUM', 'CRITICAL'), true);
  assert.equal(shouldBypassCooldownOnSeverityEscalation('HIGH', 'MEDIUM'), false);
});

// ---------------------------------------------------------------------------
// 2. MIGRATION PARITY & ROLLBACK VERIFICATION (0004 up -> down)
// ---------------------------------------------------------------------------

test('Phase 4 migration 0004 executes cleanly up and rolls back cleanly down on SQLite', async () => {
  const tmpDbPath = path.join(
    '/tmp',
    `nextrade-p4-rb-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
  const authDb = await createAuthDatabase(tmpDbPath);
  try {
    // Verify Phase 4 tables & columns exist after up migration
    const p4Tables = await authDb.queryAll<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
        'service_health_checks', 'market_data_health', 'worker_heartbeats',
        'operational_alerts', 'alert_history', 'incident_events'
      )`,
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    );
    assert.equal(p4Tables.length, 6);

    // Seed one incident with MONITORING status to test rollback status mapping
    const nowIso = new Date().toISOString();
    await authDb.execute(
      `INSERT INTO admin_incidents (id, title, description, severity, status, source, owner_email, resolution_notes, created_at, updated_at)
       VALUES (?, 'Rollback Test', 'Verify preservation on down migration', 'MEDIUM', 'MONITORING', 'manual', 'ops@nextrade.local', '', ?, ?)`,
      `INSERT INTO admin_incidents VALUES ($1)`,
      ['inc-rb-1', nowIso, nowIso],
    );
    await authDb.close();

    // Execute down migration SQL directly using DatabaseSync
    const downSql = fs.readFileSync(
      path.join(process.cwd(), 'migrations/0004_phase4_observability.down.sql'),
      'utf8',
    );
    const raw = new DatabaseSync(tmpDbPath);
    raw.exec(downSql);

    const remainingP4 = raw
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
          'service_health_checks', 'market_data_health', 'worker_heartbeats',
          'operational_alerts', 'alert_history', 'incident_events'
        )`,
      )
      .all();
    assert.equal(remainingP4.length, 0);

    const preservedIncident = raw
      .prepare(`SELECT status FROM admin_incidents WHERE id = 'inc-rb-1'`)
      .get() as { status: string } | undefined;
    assert.equal(preservedIncident?.status, 'INVESTIGATING');

    const migrationRow = raw
      .prepare(`SELECT version FROM schema_migrations WHERE version = '0004_phase4_observability'`)
      .get();
    assert.equal(migrationRow, undefined);
    raw.close();
  } finally {
    if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
  }
});

// ---------------------------------------------------------------------------
// 3. END-TO-END RBAC, TELEMETRY, AI INSPECT, MARKETS, JOBS, ALERTS & INCIDENTS
// ---------------------------------------------------------------------------

test('Phase 4 end-to-end RBAC, observability telemetry, alerts engine, and incident workflows', async () => {
  const h = await startPhase4Harness();
  try {
    const regularUser = await h.registerAndLogin({
      fullName: 'Regular User',
      email: 'regular-p4@nextrade.test',
      password: 'HeliosPolaris#2026!Vault',
      role: 'user',
    });
    const viewerAdmin = await h.registerAndLogin({
      fullName: 'Viewer Admin',
      email: 'viewer-p4@nextrade.test',
      password: 'MeridianCobalt#2026!Vault',
      role: 'viewer',
    });
    const aiAdmin = await h.registerAndLogin({
      fullName: 'AI Specialist',
      email: 'ai-p4@nextrade.test',
      password: 'ZenithCatalyst#2026!Vault',
      role: 'ai_admin',
    });
    const superAdmin = await h.registerAndLogin({
      fullName: 'Super Admin',
      email: 'super-p4@nextrade.test',
      password: 'KestrelQuantum#2026!Vault',
      role: 'super_admin',
    });

    // Generate API telemetry including sensitive query params & a 503 slow call
    await fetch(`${h.baseUrl}/api/health?token=secret_token_9999&email=leak@example.com`);
    await fetch(`${h.baseUrl}/api/slow-test`);
    await h.telemetryCollector.flushNow();

    // Seed AI telemetry containing sensitive credentials to validate redaction + masking
    await h.runtimeConfigManager.recordAiRequest({
      userId: regularUser.user.id,
      symbol: 'NVDA',
      queryPreview: 'Analyze NVDA for alice@example.com Bearer tok_secret_123456',
      feature: 'workspace_research',
      provider: 'gemini',
      model: 'gemini-4-hydrogen',
      status: 'SUCCESS',
      latencyMs: 145,
      promptTokens: 120,
      completionTokens: 280,
      totalTokens: 400,
      errorMessage: null,
    });

    // A. RBAC boundary verification
    const userBlockedRes = await fetch(`${h.baseUrl}/api/admin/observability/overview`, {
      headers: { Cookie: regularUser.cookie },
    });
    assert.equal(userBlockedRes.status, 403);

    const viewerOverviewRes = await fetch(`${h.baseUrl}/api/admin/observability/overview?range=15m`, {
      headers: { Cookie: viewerAdmin.cookie },
    });
    assert.equal(viewerOverviewRes.status, 200);
    const viewerOverview = (await viewerOverviewRes.json()) as {
      overallPlatformHealth: string;
      apiMetrics: { p50LatencyMs: number | null; p95LatencyMs: number | null };
      serviceHealth: Array<{ id: string }>;
    };
    assert.ok(['HEALTHY', 'DEGRADED', 'UNAVAILABLE'].includes(viewerOverview.overallPlatformHealth));
    assert.ok(viewerOverview.serviceHealth.length >= 6);

    // Viewer cannot mutate thresholds, pause jobs, create incidents, or inspect raw prompts
    const viewerMutateAlerts = await fetch(`${h.baseUrl}/api/admin/alerts/evaluate`, {
      method: 'POST',
      headers: { Cookie: viewerAdmin.cookie, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(viewerMutateAlerts.status, 403);

    const viewerPauseQueue = await fetch(`${h.baseUrl}/api/admin/jobs/queue/pause`, {
      method: 'POST',
      headers: { Cookie: viewerAdmin.cookie, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(viewerPauseQueue.status, 403);

    // B. API Observability & Query/Token Sanitization
    const apiObsRes = await fetch(
      `${h.baseUrl}/api/admin/observability/api?range=1h&method=GET`,
      { headers: { Cookie: superAdmin.cookie } },
    );
    assert.equal(apiObsRes.status, 200);
    const apiObs = (await apiObsRes.json()) as {
      summary: { totalVolume: number; p95LatencyMs: number | null };
      endpoints: Array<{ routePath: string; p95LatencyMs: number }>;
    };
    assert.ok(apiObs.summary.totalVolume >= 2);
    assert.equal(
      apiObs.endpoints.some((e) => e.routePath.includes('secret_token_9999')),
      false,
    );

    const loggedHealth = await h.db.queryOne<{ route_path: string }>(
      `SELECT route_path FROM api_request_logs WHERE route_path LIKE '%health%' LIMIT 1`,
      `SELECT route_path FROM api_request_logs WHERE route_path LIKE '%health%' LIMIT 1`,
    );
    assert.equal(loggedHealth?.route_path, '/api/health');

    // C. AI Observability: Masked list + Audited Sensitive Inspect
    const aiObsRes = await fetch(`${h.baseUrl}/api/admin/observability/ai?range=24h`, {
      headers: { Cookie: viewerAdmin.cookie },
    });
    assert.equal(aiObsRes.status, 200);
    const aiObs = (await aiObsRes.json()) as {
      summary: { totalRequests: number; totalTokensMeasured: number | null };
      requests: Array<{ id: string; queryPreview: string; promptRedacted: boolean }>;
      modelBreakdown: Array<{ model: string; requestCount: number }>;
    };
    assert.equal(aiObs.summary.totalRequests, 1);
    assert.equal(aiObs.summary.totalTokensMeasured, 400);
    assert.equal(aiObs.requests[0].promptRedacted, true);
    assert.equal(aiObs.requests[0].queryPreview.includes('alice@example.com'), false);

    const aiReqId = aiObs.requests[0].id;
    // Viewer lacks ADMIN_AI_INSPECT_SENSITIVE
    const viewerInspectRes = await fetch(
      `${h.baseUrl}/api/admin/observability/ai/requests/${aiReqId}/inspect`,
      { headers: { Cookie: viewerAdmin.cookie } },
    );
    assert.equal(viewerInspectRes.status, 403);

    // AI Admin has ADMIN_AI_INSPECT_SENSITIVE and audit log is recorded
    const aiInspectRes = await fetch(
      `${h.baseUrl}/api/admin/observability/ai/requests/${aiReqId}/inspect`,
      { headers: { Cookie: aiAdmin.cookie } },
    );
    assert.equal(aiInspectRes.status, 200);
    const inspectBody = (await aiInspectRes.json()) as {
      request: { queryPreviewSanitized: string };
    };
    assert.equal(inspectBody.request.queryPreviewSanitized.includes('alice@example.com'), false);
    assert.equal(inspectBody.request.queryPreviewSanitized.includes('tok_secret_123456'), false);

    const inspectAudit = await h.db.queryOne<{ action: string }>(
      `SELECT action FROM admin_audit_logs WHERE action = 'ADMIN_AI_SENSITIVE_INSPECT' AND resource_id = ?`,
      `SELECT action FROM admin_audit_logs WHERE action = 'ADMIN_AI_SENSITIVE_INSPECT' AND resource_id = $1`,
      [aiReqId],
    );
    assert.equal(inspectAudit?.action, 'ADMIN_AI_SENSITIVE_INSPECT');

    // D. Market Data Sync Health & Freshness
    const mdSyncRes = await fetch(`${h.baseUrl}/api/admin/markets/sync`, {
      method: 'POST',
      headers: { Cookie: superAdmin.cookie, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(mdSyncRes.status, 200);

    const mdObsRes = await fetch(`${h.baseUrl}/api/admin/observability/market-data`, {
      headers: { Cookie: viewerAdmin.cookie },
    });
    assert.equal(mdObsRes.status, 200);
    const mdObs = (await mdObsRes.json()) as {
      freshness: { status: string };
      history: Array<{ providerId: string; status: string }>;
    };
    assert.equal(mdObs.freshness.status, 'FRESH');
    assert.ok(mdObs.history.length >= 1);

    // E. Background Jobs Queue Pause/Resume, Health Probe & Telemetry Retention Prune
    const pauseRes = await fetch(`${h.baseUrl}/api/admin/jobs/queue/pause`, {
      method: 'POST',
      headers: { Cookie: superAdmin.cookie, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(pauseRes.status, 200);
    const pausedPayload = (await pauseRes.json()) as { workerHeartbeat: { queuePaused: boolean } };
    assert.equal(pausedPayload.workerHeartbeat.queuePaused, true);

    const blockedJobRes = await fetch(`${h.baseUrl}/api/admin/jobs/health-probe/retry`, {
      method: 'POST',
      headers: { Cookie: superAdmin.cookie, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(blockedJobRes.status, 409);
    const blockedBody = (await blockedJobRes.json()) as { code?: string };
    assert.equal(blockedBody.code, 'QUEUE_PAUSED');

    const resumeRes = await fetch(`${h.baseUrl}/api/admin/jobs/queue/resume`, {
      method: 'POST',
      headers: { Cookie: superAdmin.cookie, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(resumeRes.status, 200);

    // Seed an old telemetry row (90 days ago) and verify telemetry-prune deletes it
    const oldDateIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    await h.db.execute(
      `INSERT INTO api_request_logs (id, method, route_path, status_code, latency_ms, rate_limited, user_id, ip_address, error_code, created_at)
       VALUES (?, 'GET', '/api/old-route', 200, 12, 0, NULL, '127.0.0.1', NULL, ?)`,
      `INSERT INTO api_request_logs VALUES ($1)`,
      ['old-api-row-1', oldDateIso],
    );

    const pruneRes = await fetch(`${h.baseUrl}/api/admin/jobs/telemetry-prune/retry`, {
      method: 'POST',
      headers: { Cookie: superAdmin.cookie, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(pruneRes.status, 200);

    const prunedRow = await h.db.queryOne<{ id: string }>(
      `SELECT id FROM api_request_logs WHERE id = 'old-api-row-1'`,
      `SELECT id FROM api_request_logs WHERE id = 'old-api-row-1'`,
    );
    assert.equal(prunedRow ?? null, null);

    // F. Security Telemetry + Repeated Failures + Threshold Alerting + Deduplication + Lifecycle
    const nowIso = new Date().toISOString();
    for (let i = 0; i < 4; i++) {
      await h.db.execute(
        `INSERT INTO auth_security_events (id, user_id, event_type, ip_address, user_agent, detail, created_at)
         VALUES (?, ?, 'login_failed', '203.0.113.77', 'TestAgent/1.0', 'Invalid credentials attempt', ?)`,
        `INSERT INTO auth_security_events VALUES ($1)`,
        [crypto.randomUUID(), regularUser.user.id, nowIso],
      );
    }

    const secObsRes = await fetch(`${h.baseUrl}/api/admin/observability/security?range=24h`, {
      headers: { Cookie: viewerAdmin.cookie },
    });
    assert.equal(secObsRes.status, 200);
    const secObs = (await secObsRes.json()) as {
      summary: {
        repeatedFailureSources: Array<{ ipAddress: string; failedAttempts: number }>;
      };
    };
    assert.equal(secObs.summary.repeatedFailureSources[0]?.ipAddress, '203.0.113.77');
    assert.equal(secObs.summary.repeatedFailureSources[0]?.failedAttempts, 4);

    // Lower failedLoginsBurstThreshold to 3 -> evaluate alerts twice to prove deduplication
    const patchThreshRes = await fetch(`${h.baseUrl}/api/admin/alerts/thresholds`, {
      method: 'PATCH',
      headers: { Cookie: superAdmin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ failedLoginsBurstThreshold: 3 }),
    });
    assert.equal(patchThreshRes.status, 200);

    const eval1Res = await fetch(`${h.baseUrl}/api/admin/alerts/evaluate`, {
      method: 'POST',
      headers: { Cookie: superAdmin.cookie, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(eval1Res.status, 200);
    const eval1 = (await eval1Res.json()) as { createdCount: number; created: Array<{ id: string; fingerprint: string }> };
    assert.ok(eval1.createdCount >= 1);
    const loginBurstAlert = eval1.created.find((a) => a.fingerprint === 'security:failed-login-burst');
    assert.ok(loginBurstAlert);

    const eval2Res = await fetch(`${h.baseUrl}/api/admin/alerts/evaluate`, {
      method: 'POST',
      headers: { Cookie: superAdmin.cookie, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(eval2Res.status, 200);
    const eval2 = (await eval2Res.json()) as {
      createdCount: number;
      updated: Array<{ id: string; occurrenceCount: number }>;
    };
    assert.equal(eval2.createdCount, 0);
    const deduped = eval2.updated.find((a) => a.id === loginBurstAlert.id);
    assert.equal(deduped?.occurrenceCount, 2);

    // Verify notification summary surfaces active operational alert
    const notifRes = await fetch(`${h.baseUrl}/api/admin/notifications`, {
      headers: { Cookie: viewerAdmin.cookie },
    });
    assert.equal(notifRes.status, 200);
    const notif = (await notifRes.json()) as {
      totalCount: number;
      items: Array<{ kind: string; href: string }>;
    };
    assert.ok(notif.items.some((i) => i.kind === 'ALERT' && i.href === '/admin/alerts'));

    // Alert lifecycle: ACKNOWLEDGE -> SUPPRESS -> RESOLVE
    const ackRes = await fetch(`${h.baseUrl}/api/admin/alerts/${loginBurstAlert.id}`, {
      method: 'PATCH',
      headers: { Cookie: superAdmin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ACKNOWLEDGE', note: 'Investigating IP 203.0.113.77' }),
    });
    assert.equal(ackRes.status, 200);

    const supRes = await fetch(`${h.baseUrl}/api/admin/alerts/${loginBurstAlert.id}`, {
      method: 'PATCH',
      headers: { Cookie: superAdmin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'SUPPRESS', suppressMinutes: 15 }),
    });
    assert.equal(supRes.status, 200);

    const resolveAlertRes = await fetch(`${h.baseUrl}/api/admin/alerts/${loginBurstAlert.id}`, {
      method: 'PATCH',
      headers: { Cookie: superAdmin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'RESOLVE', note: 'Mitigated' }),
    });
    assert.equal(resolveAlertRes.status, 200);

    const alertDetailRes = await fetch(`${h.baseUrl}/api/admin/alerts/${loginBurstAlert.id}`, {
      headers: { Cookie: viewerAdmin.cookie },
    });
    const alertDetail = (await alertDetailRes.json()) as {
      alert: { status: string };
      history: Array<{ newStatus: string }>;
    };
    assert.equal(alertDetail.alert.status, 'RESOLVED');
    assert.ok(alertDetail.history.length >= 4);

    // G. Incident Management & Chronological Timeline
    const createIncRes = await fetch(`${h.baseUrl}/api/admin/incidents`, {
      method: 'POST',
      headers: { Cookie: superAdmin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Credential stuffing burst on login endpoint',
        description: 'Triggered from repeated auth failures on 203.0.113.77',
        severity: 'HIGH',
        source: 'operational_alert',
        linkedAlertIds: [loginBurstAlert.id],
      }),
    });
    assert.equal(createIncRes.status, 201);
    const createdInc = (await createIncRes.json()) as { incident: { id: string; status: string } };
    assert.equal(createdInc.incident.status, 'OPEN');

    const updateIncRes = await fetch(`${h.baseUrl}/api/admin/incidents/${createdInc.incident.id}`, {
      method: 'PATCH',
      headers: { Cookie: superAdmin.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'INVESTIGATING',
        ownerEmail: 'security-lead@nextrade.local',
        linkEventRef: 'auth_security_events:203.0.113.77',
        note: 'Escalated to security on-call',
      }),
    });
    assert.equal(updateIncRes.status, 200);

    const incDetailRes = await fetch(`${h.baseUrl}/api/admin/incidents/${createdInc.incident.id}`, {
      headers: { Cookie: viewerAdmin.cookie },
    });
    assert.equal(incDetailRes.status, 200);
    const incDetail = (await incDetailRes.json()) as {
      incident: { status: string; ownerEmail: string; linkedEventRefs: string[] };
      timeline: Array<{ eventType: string }>;
    };
    assert.equal(incDetail.incident.status, 'INVESTIGATING');
    assert.equal(incDetail.incident.ownerEmail, 'security-lead@nextrade.local');
    assert.ok(incDetail.incident.linkedEventRefs.includes('auth_security_events:203.0.113.77'));
    assert.ok(incDetail.timeline.some((e) => e.eventType === 'CREATED'));
    assert.ok(incDetail.timeline.some((e) => e.eventType === 'STATUS_CHANGED'));
    assert.ok(incDetail.timeline.some((e) => e.eventType === 'OWNER_ASSIGNED'));
    assert.ok(incDetail.timeline.some((e) => e.eventType === 'TELEMETRY_LINKED'));
  } finally {
    await h.close();
  }
});
