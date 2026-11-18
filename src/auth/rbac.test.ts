import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import {
  PERMISSIONS,
  ROLES,
  hasAllPermissions,
  hasPermission,
  hasRole,
  normalizeUserRole,
  requireAuthenticatedUser,
  requirePermission,
  requireRole,
  resolveUserPermissions,
} from './rbac';
import { createAuthDatabase } from './db';
import { createAuthService } from './service';
import { createAuthRouter } from './router';
import type { AuthEmailSender } from './email';

function createStubEmailSender(): { sender: AuthEmailSender; tokens: Map<string, string> } {
  const tokens = new Map<string, string>();
  return {
    tokens,
    sender: {
      isConfigured: () => true,
      getProviderName: () => 'emailjs',
      send: async (email) => {
        if (email.actionUrl) {
          const tok = new URL(email.actionUrl).searchParams.get('token');
          if (tok) tokens.set(email.to.toLowerCase(), tok);
        }
        return { delivered: true, mode: 'provider', provider: 'emailjs', messageId: 'stub-1' };
      },
    },
  };
}

test('RBAC role normalization and permission matrix isolate USER, ADMIN, and SUPER_ADMIN', () => {
  assert.equal(normalizeUserRole('USER'), ROLES.USER);
  assert.equal(normalizeUserRole('ADMIN'), ROLES.ADMIN);
  assert.equal(normalizeUserRole('SUPER_ADMIN'), ROLES.SUPER_ADMIN);
  assert.equal(normalizeUserRole('super_admin'), ROLES.SUPER_ADMIN);
  assert.equal(normalizeUserRole('untrusted_garbage'), ROLES.USER);

  assert.equal(hasPermission(ROLES.USER, PERMISSIONS.PORTFOLIO_WRITE), true);
  assert.equal(hasPermission(ROLES.USER, PERMISSIONS.ADMIN_USERS_READ), false);
  assert.equal(hasPermission(ROLES.USER, PERMISSIONS.SUPER_ADMIN_ROLES_ASSIGN), false);

  assert.equal(hasPermission(ROLES.ADMIN, PERMISSIONS.ADMIN_USERS_READ), true);
  assert.equal(hasPermission(ROLES.ADMIN, PERMISSIONS.SUPER_ADMIN_ROLES_ASSIGN), false);

  assert.equal(hasPermission(ROLES.SUPER_ADMIN, PERMISSIONS.SUPER_ADMIN_ROLES_ASSIGN), true);
  assert.equal(
    hasAllPermissions(ROLES.ADMIN, [PERMISSIONS.WORKSPACE_READ, PERMISSIONS.ADMIN_AUDIT_READ]),
    true,
  );
  assert.equal(hasRole(ROLES.USER, [ROLES.ADMIN, ROLES.SUPER_ADMIN]), false);
  assert.ok(resolveUserPermissions(ROLES.SUPER_ADMIN).length > resolveUserPermissions(ROLES.USER).length);
});

test('RBAC middleware enforces 401/403 and signup/account endpoints block privilege escalation', async () => {
  const db = await createAuthDatabase(':memory:');
  const { sender, tokens } = createStubEmailSender();
  const authService = createAuthService({
    db,
    emailSender: sender,
    getBaseUrl: () => 'http://127.0.0.1:3000',
  });

  const app = express();
  app.use(express.json({ limit: '32kb' }));
  app.use('/api/auth', createAuthRouter({ authService, emailSender: sender }));
  app.get(
    '/api/test-user-area',
    requireAuthenticatedUser(authService),
    requirePermission(PERMISSIONS.WORKSPACE_READ),
    (_req, res) => res.json({ ok: true }),
  );
  app.get(
    '/api/test-admin-area',
    requireAuthenticatedUser(authService),
    requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN),
    (_req, res) => res.json({ ok: true }),
  );
  app.get(
    '/api/test-superadmin-area',
    requireAuthenticatedUser(authService),
    requirePermission(PERMISSIONS.SUPER_ADMIN_ROLES_ASSIGN),
    (_req, res) => res.json({ ok: true }),
  );

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // Anonymous check
    assert.equal((await fetch(`${baseUrl}/api/test-user-area`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/test-admin-area`)).status, 401);

    // Attempt role escalation on signup
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Privilege Tester',
        email: 'privtest@example.com',
        password: 'StrongPassword#2026!',
        confirmPassword: 'StrongPassword#2026!',
        acceptTerms: true,
        acceptPrivacy: true,
        role: 'SUPER_ADMIN',
      }),
    });
    assert.equal(signupRes.status, 201);
    const signupData = (await signupRes.json()) as { user: { role: string } };
    assert.equal(signupData.user.role, ROLES.USER);

    const verifyTok = tokens.get('privtest@example.com');
    assert.ok(verifyTok);
    await authService.verifyEmail({ token: verifyTok });

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'privtest@example.com', password: 'StrongPassword#2026!' }),
    });
    assert.equal(loginRes.status, 200);
    const cookieMatch = /nextrade_session=([^;]+)/.exec(loginRes.headers.get('set-cookie') ?? '');
    assert.ok(cookieMatch);
    const userCookie = `nextrade_session=${cookieMatch[1]}`;

    // Ordinary user allowed in user area, blocked in admin/superadmin areas
    assert.equal(
      (await fetch(`${baseUrl}/api/test-user-area`, { headers: { Cookie: userCookie } })).status,
      200,
    );
    assert.equal(
      (await fetch(`${baseUrl}/api/test-admin-area`, { headers: { Cookie: userCookie } })).status,
      403,
    );
    assert.equal(
      (await fetch(`${baseUrl}/api/test-superadmin-area`, { headers: { Cookie: userCookie } }))
        .status,
      403,
    );

    // Attempt privilege escalation via PATCH /api/auth/account
    const tamperRes = await fetch(`${baseUrl}/api/auth/account`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: userCookie },
      body: JSON.stringify({ fullName: 'Privilege Tester', role: 'admin' }),
    });
    assert.equal(tamperRes.status, 403);

    // Promote user to ADMIN in DB and verify access
    db.sqliteDb!
      .prepare("UPDATE users SET role = 'admin' WHERE email = ?")
      .run('privtest@example.com');
    assert.equal(
      (await fetch(`${baseUrl}/api/test-admin-area`, { headers: { Cookie: userCookie } })).status,
      200,
    );
    assert.equal(
      (await fetch(`${baseUrl}/api/test-superadmin-area`, { headers: { Cookie: userCookie } }))
        .status,
      403,
    );

    // Promote to SUPER_ADMIN and verify super_admin permission
    db.sqliteDb!
      .prepare("UPDATE users SET role = 'super_admin' WHERE email = ?")
      .run('privtest@example.com');
    assert.equal(
      (await fetch(`${baseUrl}/api/test-superadmin-area`, { headers: { Cookie: userCookie } }))
        .status,
      200,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    await db.close();
  }
});
