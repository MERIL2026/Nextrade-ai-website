import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { createAuthDatabase, resolvePostgresConnectionUrl } from './db';
import { hashToken } from './crypto';
import {
  AuthEmailSender,
  OutboundAuthEmail,
  buildPasswordResetEmailContent,
  buildVerificationEmailContent,
  createAuthEmailSender,
} from './email';
import { createAuthService } from './service';
import { createAuthRouter } from './router';

function createMockEmailSender(configured = true): {
  sender: AuthEmailSender;
  sent: OutboundAuthEmail[];
  extractToken: (to: string, kind: OutboundAuthEmail['kind']) => string;
} {
  const sent: OutboundAuthEmail[] = [];
  return {
    sender: {
      isConfigured: () => configured,
      getProviderName: () => (configured ? 'emailjs' : 'unconfigured'),
      send: async (email) => {
        sent.push(email);
        return {
          delivered: configured,
          mode: configured ? 'provider' : 'unconfigured',
          provider: configured ? 'emailjs' : 'unconfigured',
          messageId: configured ? `msg_${sent.length}` : undefined,
        };
      },
    },
    sent,
    extractToken: (to, kind) => {
      const match = [...sent]
        .reverse()
        .find((item) => item.to === to.toLowerCase() && item.kind === kind);
      assert.ok(match?.actionUrl, `Expected outbound ${kind} email for ${to}`);
      const tok = new URL(match.actionUrl).searchParams.get('token');
      assert.ok(tok, 'Expected token query param in email actionUrl');
      return tok;
    },
  };
}

async function startTestAuthApp(options?: {
  configuredEmail?: boolean;
  rateLimits?: Parameters<typeof createAuthRouter>[0]['rateLimits'];
}) {
  const db = await createAuthDatabase(':memory:');
  const mockMail = createMockEmailSender(options?.configuredEmail ?? true);
  const service = createAuthService({
    db,
    emailSender: mockMail.sender,
    getBaseUrl: () => 'http://127.0.0.1:3000',
  });

  const app = express();
  app.use(express.json({ limit: '32kb' }));
  app.use(
    '/api/auth',
    createAuthRouter({
      authService: service,
      emailSender: mockMail.sender,
      authDatabase: 'sqlite',
      rateLimits: options?.rateLimits,
    }),
  );

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    db,
    mockMail,
    service,
    baseUrl,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await db.close();
    },
  };
}

function extractCookieValue(res: Response): string {
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = /nextrade_session=([^;]+)/.exec(setCookie);
  assert.ok(match, `Expected Set-Cookie header with nextrade_session, got: ${setCookie}`);
  return `nextrade_session=${match[1]}`;
}

test('SQLite auth and workspace migrations create schema and stepwise rollback drops tables cleanly', async () => {
  const authDb = await createAuthDatabase(':memory:');
  const sqlite = authDb.sqliteDb!;
  const tablesBefore = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  const tableNames = tablesBefore.map((t) => t.name);

  assert.ok(tableNames.includes('users'));
  assert.ok(tableNames.includes('sessions'));
  assert.ok(tableNames.includes('email_verification_tokens'));
  assert.ok(tableNames.includes('password_reset_tokens'));
  assert.ok(tableNames.includes('auth_security_events'));
  assert.ok(tableNames.includes('schema_migrations'));
  assert.ok(tableNames.includes('portfolios'));
  assert.ok(tableNames.includes('portfolio_holdings'));
  assert.ok(tableNames.includes('watchlists'));
  assert.ok(tableNames.includes('watchlist_items'));
  assert.ok(tableNames.includes('paper_trading_accounts'));
  assert.ok(tableNames.includes('paper_orders'));
  assert.ok(tableNames.includes('paper_transactions'));
  assert.ok(tableNames.includes('ai_research_history'));
  assert.ok(tableNames.includes('saved_reports'));
  assert.ok(tableNames.includes('user_preferences'));
  assert.ok(tableNames.includes('admin_audit_logs'));
  assert.ok(tableNames.includes('platform_settings'));
  assert.ok(tableNames.includes('ai_prompt_versions'));
  assert.ok(tableNames.includes('background_jobs'));
  assert.ok(tableNames.includes('background_job_runs'));
  assert.ok(tableNames.includes('admin_incidents'));
  assert.ok(tableNames.includes('admin_announcements'));
  assert.ok(tableNames.includes('support_tickets'));
  assert.ok(tableNames.includes('operational_alerts'));
  assert.ok(tableNames.includes('alert_history'));
  assert.ok(tableNames.includes('incident_events'));
  assert.ok(tableNames.includes('service_health_checks'));
  assert.ok(tableNames.includes('market_data_health'));
  assert.ok(tableNames.includes('worker_heartbeats'));
  assert.ok(tableNames.includes('user_lifecycle_states'));
  assert.ok(tableNames.includes('user_lifecycle_events'));
  assert.ok(tableNames.includes('user_admin_notes'));
  assert.ok(tableNames.includes('data_export_requests'));
  assert.ok(tableNames.includes('data_deletion_requests'));
  assert.ok(tableNames.includes('backup_records'));
  assert.ok(tableNames.includes('backup_verification_events'));
  assert.ok(tableNames.includes('feature_flags'));
  assert.ok(tableNames.includes('feature_flag_history'));
  assert.ok(tableNames.includes('release_records'));
  assert.ok(tableNames.includes('maintenance_windows'));
  assert.ok(tableNames.includes('admin_automation_workflows'));
  assert.ok(tableNames.includes('admin_automation_runs'));
  assert.ok(tableNames.includes('privileged_access_reviews'));
  assert.ok(tableNames.includes('privileged_action_requests'));
  assert.ok(tableNames.includes('emergency_access_grants'));
  assert.ok(tableNames.includes('ai_policy_versions'));
  assert.ok(tableNames.includes('emergency_playbooks'));
  assert.ok(tableNames.includes('emergency_events'));
  assert.ok(tableNames.includes('market_quote_cache'));
  assert.ok(tableNames.includes('market_history_cache'));
  assert.ok(tableNames.includes('market_fx_cache'));

  // Roll back migration 0007 market data cache first
  await authDb.rollbackLastMigration();
  const tablesAfterMarketCacheRollback = (
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
  ).map((t) => t.name);
  assert.equal(tablesAfterMarketCacheRollback.includes('market_quote_cache'), false);
  assert.equal(tablesAfterMarketCacheRollback.includes('market_history_cache'), false);
  assert.equal(tablesAfterMarketCacheRollback.includes('market_fx_cache'), false);
  assert.equal(tablesAfterMarketCacheRollback.includes('admin_automation_workflows'), true);

  // Roll back Phase 6 super ops schema second
  await authDb.rollbackLastMigration();
  const tablesAfterPhase6Rollback = (
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
  ).map((t) => t.name);
  assert.equal(tablesAfterPhase6Rollback.includes('admin_automation_workflows'), false);
  assert.equal(tablesAfterPhase6Rollback.includes('ai_policy_versions'), false);
  assert.equal(tablesAfterPhase6Rollback.includes('feature_flags'), true);

  // Roll back Phase 5 governance schema second
  await authDb.rollbackLastMigration();
  const tablesAfterPhase5Rollback = (
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
  ).map((t) => t.name);
  assert.equal(tablesAfterPhase5Rollback.includes('feature_flags'), false);
  assert.equal(tablesAfterPhase5Rollback.includes('backup_records'), false);
  assert.equal(tablesAfterPhase5Rollback.includes('operational_alerts'), true);

  // Roll back Phase 4 observability schema second
  await authDb.rollbackLastMigration();
  const tablesAfterPhase4Rollback = (
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
  ).map((t) => t.name);
  assert.equal(tablesAfterPhase4Rollback.includes('operational_alerts'), false);
  assert.equal(tablesAfterPhase4Rollback.includes('admin_audit_logs'), true);
  assert.equal(tablesAfterPhase4Rollback.includes('portfolios'), true);
  assert.equal(tablesAfterPhase4Rollback.includes('users'), true);

  // Roll back Phase 3 admin schema second
  await authDb.rollbackLastMigration();
  const tablesAfterPhase3Rollback = (
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
  ).map((t) => t.name);
  assert.equal(tablesAfterPhase3Rollback.includes('admin_audit_logs'), false);
  assert.equal(tablesAfterPhase3Rollback.includes('portfolios'), true);
  assert.equal(tablesAfterPhase3Rollback.includes('users'), true);

  // Roll back Phase 2 workspace schema third
  await authDb.rollbackLastMigration();
  const tablesAfterPhase2Rollback = (
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
  ).map((t) => t.name);
  assert.equal(tablesAfterPhase2Rollback.includes('portfolios'), false);
  assert.equal(tablesAfterPhase2Rollback.includes('users'), true);

  // Roll back Phase 1 auth schema fourth
  await authDb.rollbackLastMigration();
  const tablesAfterAllRollbacks = (
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
  ).map((t) => t.name);
  assert.deepEqual(tablesAfterAllRollbacks, ['schema_migrations']);
  const appliedCount = sqlite
    .prepare('SELECT COUNT(*) as cnt FROM schema_migrations')
    .get() as { cnt: number };
  assert.equal(appliedCount.cnt, 0);

  await authDb.runMigrations();
  const tablesAfterReapply = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as { name: string }[];
  assert.ok(tablesAfterReapply.some((t) => t.name === 'users'));
  assert.ok(tablesAfterReapply.some((t) => t.name === 'portfolios'));
  assert.ok(tablesAfterReapply.some((t) => t.name === 'admin_audit_logs'));
  await authDb.close();
});

test('EmailJS email sender validates config and sends structured REST payload', async () => {
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  try {
    process.env.EMAIL_PROVIDER = 'emailjs';
    process.env.EMAILJS_SERVICE_ID = '';
    process.env.EMAILJS_TEMPLATE_ID = '';
    process.env.EMAILJS_PUBLIC_KEY = '';
    process.env.EMAILJS_PRIVATE_KEY = '';
    process.env.EMAIL_API_KEY = '';
    process.env.EMAIL_FROM = '';

    const unconfiguredSender = createAuthEmailSender();
    assert.equal(unconfiguredSender.isConfigured(), false);
    assert.equal(unconfiguredSender.getProviderName(), 'unconfigured');

    process.env.EMAILJS_SERVICE_ID = 'service_nextrade_test';
    process.env.EMAILJS_TEMPLATE_ID = 'template_verify_test';
    process.env.EMAILJS_RESET_TEMPLATE_ID = 'template_reset_test';
    process.env.EMAILJS_PUBLIC_KEY = 'pub_test_key_123';
    process.env.EMAILJS_PRIVATE_KEY = 'priv_test_key_456';

    const capturedCalls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      capturedCalls.push({ url: String(input), init: init ?? {} });
      return new Response('OK', { status: 200 });
    }) as typeof fetch;

    const emailjsSender = createAuthEmailSender();
    assert.equal(emailjsSender.isConfigured(), true);
    assert.equal(emailjsSender.getProviderName(), 'emailjs');

    const verifyRes = await emailjsSender.send(
      buildVerificationEmailContent({
        fullName: 'Priya Nair',
        to: 'priya@example.com',
        verifyUrl: 'https://nextrade.example/verify-email?token=tok123',
        expiresHours: 24,
      }),
    );
    assert.equal(verifyRes.delivered, true);
    assert.equal(verifyRes.provider, 'emailjs');
    assert.equal(capturedCalls.length, 1);
    assert.equal(capturedCalls[0].url, 'https://api.emailjs.com/api/v1.0/email/send');

    const verifyPayload = JSON.parse(String(capturedCalls[0].init.body)) as Record<string, any>;
    assert.equal(verifyPayload.service_id, 'service_nextrade_test');
    assert.equal(verifyPayload.template_id, 'template_verify_test');
    assert.equal(verifyPayload.user_id, 'pub_test_key_123');
    assert.equal(verifyPayload.accessToken, 'priv_test_key_456');
    assert.equal(verifyPayload.template_params.to_email, 'priya@example.com');
    assert.equal(
      verifyPayload.template_params.verify_url,
      'https://nextrade.example/verify-email?token=tok123',
    );

    const resetRes = await emailjsSender.send(
      buildPasswordResetEmailContent({
        fullName: 'Priya Nair',
        to: 'priya@example.com',
        resetUrl: 'https://nextrade.example/reset-password?token=rst456',
        expiresMinutes: 30,
      }),
    );
    assert.equal(resetRes.delivered, true);
    const resetPayload = JSON.parse(String(capturedCalls[1].init.body)) as Record<string, any>;
    assert.equal(resetPayload.template_id, 'template_reset_test');
    assert.equal(
      resetPayload.template_params.reset_url,
      'https://nextrade.example/reset-password?token=rst456',
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.env = savedEnv;
  }
});

test('resolvePostgresConnectionUrl accepts Supabase Postgres URIs and rejects blanks/placeholders', () => {
  const savedDbUrl = process.env.DATABASE_URL;
  const savedSupaDbUrl = process.env.SUPABASE_DB_URL;
  try {
    process.env.DATABASE_URL = '';
    process.env.SUPABASE_DB_URL = '';
    assert.equal(resolvePostgresConnectionUrl(), '');

    process.env.DATABASE_URL =
      'postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';
    assert.equal(resolvePostgresConnectionUrl(), '');

    process.env.DATABASE_URL =
      'postgresql://postgres.abcd1234:secretpass@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';
    assert.equal(
      resolvePostgresConnectionUrl(),
      'postgresql://postgres.abcd1234:secretpass@aws-0-ap-south-1.pooler.supabase.com:6543/postgres',
    );
  } finally {
    process.env.DATABASE_URL = savedDbUrl;
    process.env.SUPABASE_DB_URL = savedSupaDbUrl;
  }
});

test('expired verification and password reset tokens are rejected', async () => {
  const ctx = await startTestAuthApp();
  try {
    await ctx.service.signup({
      fullName: 'Expired Token User',
      email: 'expired@example.com',
      password: 'QuantumLedger#2026!',
      confirmPassword: 'QuantumLedger#2026!',
      acceptTerms: true,
      acceptPrivacy: true,
    });
    const vTok = ctx.mockMail.extractToken('expired@example.com', 'verification');
    ctx.db.sqliteDb!
      .prepare('UPDATE email_verification_tokens SET expires_at = ?')
      .run(new Date(Date.now() - 60_000).toISOString());

    const expiredVerifyRes = await fetch(`${ctx.baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: vTok }),
    });
    assert.equal(expiredVerifyRes.status, 400);
    const expiredVerifyBody = (await expiredVerifyRes.json()) as { code: string };
    assert.equal(expiredVerifyBody.code, 'TOKEN_EXPIRED');

    await ctx.service.forgotPassword({ email: 'expired@example.com' });
    const rTok = ctx.mockMail.extractToken('expired@example.com', 'password-reset');
    ctx.db.sqliteDb!
      .prepare('UPDATE password_reset_tokens SET expires_at = ?')
      .run(new Date(Date.now() - 60_000).toISOString());

    const expiredResetRes = await fetch(`${ctx.baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: rTok,
        password: 'AnotherStrongPassword#99',
        confirmPassword: 'AnotherStrongPassword#99',
      }),
    });
    assert.equal(expiredResetRes.status, 400);
    const expiredResetBody = (await expiredResetRes.json()) as { code: string };
    assert.equal(expiredResetBody.code, 'TOKEN_EXPIRED');
  } finally {
    await ctx.close();
  }
});

test('full signup, duplicate guard, email verification single-use, login, cookie session, profile update, and logout lifecycle', async () => {
  const ctx = await startTestAuthApp();
  try {
    const weakRes = await fetch(`${ctx.baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Aarav Mehta',
        email: 'aarav@example.com',
        password: 'weak',
        confirmPassword: 'different',
        acceptTerms: false,
        acceptPrivacy: true,
      }),
    });
    assert.equal(weakRes.status, 400);

    const signupRes = await fetch(`${ctx.baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Aarav Mehta',
        email: 'Aarav.Mehta@Example.com',
        password: 'QuantumLedger#2026!',
        confirmPassword: 'QuantumLedger#2026!',
        acceptTerms: true,
        acceptPrivacy: true,
      }),
    });
    assert.equal(signupRes.status, 201);
    const signupJsonText = await signupRes.text();
    const signupJson = JSON.parse(signupJsonText) as {
      ok: boolean;
      verificationPending: boolean;
      user: { id: string; email: string; emailVerified: boolean };
    };
    assert.equal(signupJson.ok, true);
    assert.equal(signupJson.verificationPending, true);
    assert.equal(signupJson.user.email, 'aarav.mehta@example.com');
    assert.equal(signupJson.user.emailVerified, false);
    assert.equal(signupJsonText.includes('argon2'), false);
    assert.equal(signupJsonText.includes('password_hash'), false);

    const dbUser = ctx.db.sqliteDb!
      .prepare('SELECT password_hash FROM users WHERE email = ?')
      .get('aarav.mehta@example.com') as { password_hash: string };
    assert.match(dbUser.password_hash, /^\$argon2id\$/);

    const verifyToken = ctx.mockMail.extractToken('aarav.mehta@example.com', 'verification');
    assert.equal(signupJsonText.includes(verifyToken), false);
    const dbTokenRow = ctx.db.sqliteDb!
      .prepare('SELECT token_hash FROM email_verification_tokens WHERE user_id = ?')
      .get(signupJson.user.id) as { token_hash: string };
    assert.equal(dbTokenRow.token_hash, hashToken(verifyToken));

    const dupRes = await fetch(`${ctx.baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Duplicate User',
        email: 'aarav.mehta@example.com',
        password: 'QuantumLedger#2026!',
        confirmPassword: 'QuantumLedger#2026!',
        acceptTerms: true,
        acceptPrivacy: true,
      }),
    });
    assert.equal(dupRes.status, 409);

    const unverifiedLoginRes = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'aarav.mehta@example.com',
        password: 'QuantumLedger#2026!',
      }),
    });
    assert.equal(unverifiedLoginRes.status, 403);
    const unverifiedBody = (await unverifiedLoginRes.json()) as { code: string };
    assert.equal(unverifiedBody.code, 'EMAIL_NOT_VERIFIED');

    const verifyRes = await fetch(`${ctx.baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: verifyToken }),
    });
    assert.equal(verifyRes.status, 200);

    const replayVerifyRes = await fetch(`${ctx.baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: verifyToken }),
    });
    assert.equal(replayVerifyRes.status, 400);

    const badPwRes = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'aarav.mehta@example.com',
        password: 'WrongPassword#2026!',
      }),
    });
    assert.equal(badPwRes.status, 401);

    const loginRes = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'aarav.mehta@example.com',
        password: 'QuantumLedger#2026!',
        rememberMe: true,
      }),
    });
    assert.equal(loginRes.status, 200);
    const setCookieHeader = loginRes.headers.get('set-cookie') ?? '';
    assert.match(setCookieHeader, /HttpOnly/);
    assert.match(setCookieHeader, /SameSite=Lax/);
    const sessionCookie = extractCookieValue(loginRes);

    const anonMeRes = await fetch(`${ctx.baseUrl}/api/auth/me`);
    assert.equal(anonMeRes.status, 401);

    const authedMeRes = await fetch(`${ctx.baseUrl}/api/auth/me`, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(authedMeRes.status, 200);
    const authedMe = (await authedMeRes.json()) as {
      authenticated: boolean;
      user: { fullName: string; emailVerified: boolean };
    };
    assert.equal(authedMe.authenticated, true);
    assert.equal(authedMe.user.emailVerified, true);

    const patchRes = await fetch(`${ctx.baseUrl}/api/auth/account`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ fullName: 'Aarav K. Mehta' }),
    });
    assert.equal(patchRes.status, 200);
    const patchJson = (await patchRes.json()) as { user: { fullName: string } };
    assert.equal(patchJson.user.fullName, 'Aarav K. Mehta');

    const login2Res = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        email: 'aarav.mehta@example.com',
        password: 'QuantumLedger#2026!',
      }),
    });
    assert.equal(login2Res.status, 200);
    const newCookie = extractCookieValue(login2Res);
    assert.notEqual(newCookie, sessionCookie);

    const oldCookieMe = await fetch(`${ctx.baseUrl}/api/auth/me`, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(oldCookieMe.status, 401);

    const logoutRes = await fetch(`${ctx.baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: newCookie },
    });
    assert.equal(logoutRes.status, 200);

    const postLogoutMe = await fetch(`${ctx.baseUrl}/api/auth/me`, {
      headers: { Cookie: newCookie },
    });
    assert.equal(postLogoutMe.status, 401);
  } finally {
    await ctx.close();
  }
});

test('password reset is non-enumerating, single-use, rejects expired tokens, and revokes all active sessions', async () => {
  const ctx = await startTestAuthApp();
  try {
    await ctx.service.signup({
      fullName: 'Riya Sharma',
      email: 'riya@example.com',
      password: 'OldStrongPassword#99',
      confirmPassword: 'OldStrongPassword#99',
      acceptTerms: true,
      acceptPrivacy: true,
    });
    const vTok = ctx.mockMail.extractToken('riya@example.com', 'verification');
    await ctx.service.verifyEmail({ token: vTok });

    const loginA = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Device-A' },
      body: JSON.stringify({ email: 'riya@example.com', password: 'OldStrongPassword#99' }),
    });
    const cookieA = extractCookieValue(loginA);

    const loginB = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Device-B' },
      body: JSON.stringify({ email: 'riya@example.com', password: 'OldStrongPassword#99' }),
    });
    const cookieB = extractCookieValue(loginB);

    const unknownForgot = await fetch(`${ctx.baseUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com' }),
    });
    const knownForgot = await fetch(`${ctx.baseUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'riya@example.com' }),
    });
    assert.equal(unknownForgot.status, 200);
    assert.equal(knownForgot.status, 200);
    assert.equal(await unknownForgot.text(), await knownForgot.text());

    const resetToken = ctx.mockMail.extractToken('riya@example.com', 'password-reset');

    const resetRes = await fetch(`${ctx.baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: resetToken,
        password: 'NewRotatedVault#2027!',
        confirmPassword: 'NewRotatedVault#2027!',
      }),
    });
    assert.equal(resetRes.status, 200);

    const replayReset = await fetch(`${ctx.baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: resetToken,
        password: 'AnotherPassword#2027!',
        confirmPassword: 'AnotherPassword#2027!',
      }),
    });
    assert.equal(replayReset.status, 400);

    assert.equal(
      (await fetch(`${ctx.baseUrl}/api/auth/me`, { headers: { Cookie: cookieA } })).status,
      401,
    );
    assert.equal(
      (await fetch(`${ctx.baseUrl}/api/auth/me`, { headers: { Cookie: cookieB } })).status,
      401,
    );

    const oldPwLogin = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'riya@example.com', password: 'OldStrongPassword#99' }),
    });
    assert.equal(oldPwLogin.status, 401);

    const newPwLogin = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'riya@example.com', password: 'NewRotatedVault#2027!' }),
    });
    assert.equal(newPwLogin.status, 200);
  } finally {
    await ctx.close();
  }
});

test('cross-user session revocation is blocked, expired tokens fail, disabled accounts blocked, CSRF origin checked, and rate limiting returns 429', async () => {
  const ctx = await startTestAuthApp({
    rateLimits: { loginIpMax: 4, loginAccountMax: 4, signupIpMax: 5 },
  });
  try {
    await ctx.service.signup({
      fullName: 'User One',
      email: 'one@example.com',
      password: 'AlphaVault#2026!',
      confirmPassword: 'AlphaVault#2026!',
      acceptTerms: true,
      acceptPrivacy: true,
    });
    await ctx.service.verifyEmail({
      token: ctx.mockMail.extractToken('one@example.com', 'verification'),
    });
    const login1 = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'one@example.com', password: 'AlphaVault#2026!' }),
    });
    const cookie1 = extractCookieValue(login1);
    const sessions1Res = await fetch(`${ctx.baseUrl}/api/auth/sessions`, {
      headers: { Cookie: cookie1 },
    });
    const sessions1 = (await sessions1Res.json()) as { sessions: { id: string }[] };
    const session1Id = sessions1.sessions[0].id;

    await ctx.service.signup({
      fullName: 'User Two',
      email: 'two@example.com',
      password: 'BetaVault#2026!',
      confirmPassword: 'BetaVault#2026!',
      acceptTerms: true,
      acceptPrivacy: true,
    });
    await ctx.service.verifyEmail({
      token: ctx.mockMail.extractToken('two@example.com', 'verification'),
    });
    const login2 = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'two@example.com', password: 'BetaVault#2026!' }),
    });
    const cookie2 = extractCookieValue(login2);

    const crossRevokeRes = await fetch(
      `${ctx.baseUrl}/api/auth/sessions/${encodeURIComponent(session1Id)}`,
      { method: 'DELETE', headers: { Cookie: cookie2 } },
    );
    assert.equal(crossRevokeRes.status, 404);

    ctx.db.sqliteDb!
      .prepare("UPDATE users SET account_status = 'disabled' WHERE email = ?")
      .run('one@example.com');
    const disabledMeRes = await fetch(`${ctx.baseUrl}/api/auth/me`, {
      headers: { Cookie: cookie1 },
    });
    assert.equal(disabledMeRes.status, 401);

    const csrfRes = await fetch(`${ctx.baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Origin: 'https://malicious.example', Cookie: cookie2 },
    });
    assert.equal(csrfRes.status, 403);

    for (let i = 0; i < 2; i++) {
      await fetch(`${ctx.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'two@example.com', password: 'WrongPassword#2026!' }),
      });
    }
    const rateLimitedRes = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'two@example.com', password: 'WrongPassword#2026!' }),
    });
    assert.equal(rateLimitedRes.status, 429);
    assert.ok(rateLimitedRes.headers.get('retry-after'));

    const badVerify = await fetch(`${ctx.baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'nonexistent-token-1234567890' }),
    });
    assert.equal(badVerify.status, 400);

    const badReset = await fetch(`${ctx.baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'nonexistent-reset-token-12345',
        password: 'ValidNewPassword#2026!',
        confirmPassword: 'ValidNewPassword#2026!',
      }),
    });
    assert.equal(badReset.status, 400);

    const malformedSignup = await fetch(`${ctx.baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });
    assert.equal(malformedSignup.status, 400);

    ctx.db.sqliteDb!
      .prepare('UPDATE sessions SET expires_at = ?')
      .run(new Date(Date.now() - 60_000).toISOString());
    const expiredSessionMe = await fetch(`${ctx.baseUrl}/api/auth/me`, {
      headers: { Cookie: cookie2 },
    });
    assert.equal(expiredSessionMe.status, 401);
    assert.match(expiredSessionMe.headers.get('set-cookie') ?? '', /Max-Age=0/);
  } finally {
    await ctx.close();
  }
});

test('resend verification enforces rate limits and non-enumeration', async () => {
  const ctx = await startTestAuthApp({
    rateLimits: { resendIpMax: 10, resendAccountMax: 2 },
  });
  try {
    await ctx.service.signup({
      fullName: 'Resend Test User',
      email: 'resend@example.com',
      password: 'ResendVault#2026!',
      confirmPassword: 'ResendVault#2026!',
      acceptTerms: true,
      acceptPrivacy: true,
    });

    for (let i = 0; i < 2; i++) {
      const r = await fetch(`${ctx.baseUrl}/api/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'resend@example.com' }),
      });
      assert.equal(r.status, 200);
    }

    const throttled = await fetch(`${ctx.baseUrl}/api/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'resend@example.com' }),
    });
    assert.equal(throttled.status, 429);
    assert.ok(throttled.headers.get('retry-after'));
  } finally {
    await ctx.close();
  }
});

test('HTTPS requests set SameSite=None; Secure; Partitioned session cookies for cross-site iframe compatibility', async () => {
  const ctx = await startTestAuthApp();
  try {
    const signupOutcome = await ctx.service.signup({
      fullName: 'Alice Mercer',
      email: 'alice.mercer@example.com',
      password: 'QuantumLedger#2026!',
      confirmPassword: 'QuantumLedger#2026!',
      acceptTerms: true,
      acceptPrivacy: true,
    });
    assert.equal(signupOutcome.ok, true);
    const verifyTok = ctx.mockMail.extractToken('alice.mercer@example.com', 'verification');
    await ctx.service.verifyEmail({ token: verifyTok });

    const loginRes = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({
        email: 'alice.mercer@example.com',
        password: 'QuantumLedger#2026!',
      }),
    });
    assert.equal(loginRes.status, 200);
    const setCookieHeader = loginRes.headers.get('set-cookie') ?? '';
    assert.match(setCookieHeader, /HttpOnly/);
    assert.match(setCookieHeader, /SameSite=None/);
    assert.match(setCookieHeader, /Secure/);
    assert.match(setCookieHeader, /Partitioned/);

    const cookie = extractCookieValue(loginRes);
    const logoutRes = await fetch(`${ctx.baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-Forwarded-Proto': 'https',
      },
    });
    assert.equal(logoutRes.status, 200);
    const clearCookieHeader = logoutRes.headers.get('set-cookie') ?? '';
    assert.match(clearCookieHeader, /SameSite=None/);
    assert.match(clearCookieHeader, /Secure/);
    assert.match(clearCookieHeader, /Partitioned/);
    assert.match(clearCookieHeader, /Max-Age=0/);
  } finally {
    await ctx.close();
  }
});
