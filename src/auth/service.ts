import crypto from 'node:crypto';
import {
  evaluatePasswordStrength,
  normalizeEmail,
  validateEmailAddress,
  validateFullName,
} from '../lib/authValidation';
import { stripControlChars } from '../lib/security';
import {
  generateOpaqueToken,
  hashPassword,
  hashToken,
  verifyDummyPasswordTiming,
  verifyPassword,
} from './crypto';
import {
  AuthDatabase,
  AuthQueryRunner,
  DbSessionRow,
  DbTokenRow,
  DbUserRow,
  UserRole,
  isUniqueConstraintError,
  toBool,
  toIsoTimestamp,
} from './db';
import type { RuntimeConfigManager } from '../admin/runtimeSettings';
import {
  AuthEmailSender,
  buildPasswordResetEmailContent,
  buildSecurityNotificationEmailContent,
  buildVerificationEmailContent,
} from './email';
import { normalizeUserRole, Permission, resolveUserPermissions } from './rbac';

export interface PublicAuthUser {
  id: string;
  fullName: string;
  email: string;
  emailVerified: boolean;
  accountStatus: string;
  role: UserRole;
  permissions: Permission[];
  createdAt: string;
  lastLoginAt: string | null;
}

export interface PublicSessionInfo {
  id: string;
  current: boolean;
  userAgent: string;
  ipAddress: string;
  rememberMe: boolean;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface AuthServiceOptions {
  db: AuthDatabase;
  emailSender: AuthEmailSender;
  getBaseUrl: () => string;
  runtimeConfigManager?: RuntimeConfigManager;
  verificationTtlMs?: number;
  passwordResetTtlMs?: number;
  sessionTtlMs?: number;
  rememberMeSessionTtlMs?: number;
}

export type ServiceOutcome<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; code?: string; fieldErrors?: Record<string, string> };

function toPublicUser(row: DbUserRow): PublicAuthUser {
  const role = normalizeUserRole(row.role);
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    emailVerified: toBool(row.email_verified),
    accountStatus: row.account_status,
    role,
    permissions: resolveUserPermissions(role),
    createdAt: toIsoTimestamp(row.created_at) ?? '',
    lastLoginAt: toIsoTimestamp(row.last_login_at),
  };
}

function toPublicSession(row: DbSessionRow, currentSessionId?: string): PublicSessionInfo {
  return {
    id: row.id,
    current: Boolean(currentSessionId && row.id === currentSessionId),
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
    rememberMe: toBool(row.remember_me),
    createdAt: toIsoTimestamp(row.created_at) ?? '',
    lastActiveAt: toIsoTimestamp(row.last_active_at) ?? '',
    expiresAt: toIsoTimestamp(row.expires_at) ?? '',
    revokedAt: toIsoTimestamp(row.revoked_at),
  };
}

export function createAuthService(options: AuthServiceOptions) {
  const {
    db: authDb,
    emailSender,
    getBaseUrl,
    runtimeConfigManager,
    verificationTtlMs = 24 * 60 * 60 * 1000,
    passwordResetTtlMs = 30 * 60 * 1000,
    sessionTtlMs = 24 * 60 * 60 * 1000,
    rememberMeSessionTtlMs = 14 * 24 * 60 * 60 * 1000,
  } = options;

  const isPg = authDb.dialect === 'postgres';
  const boolVal = (v: boolean) => (isPg ? v : v ? 1 : 0);

  const logSecurityEvent = async (
    runner: AuthQueryRunner,
    params: {
      userId: string | null;
      eventType: string;
      ipAddress?: string;
      userAgent?: string;
      detail?: string;
    },
  ) => {
    await runner.execute(
      `INSERT INTO auth_security_events (id, user_id, event_type, ip_address, user_agent, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      `INSERT INTO auth_security_events (id, user_id, event_type, ip_address, user_agent, detail, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)`,
      [
        crypto.randomUUID(),
        params.userId,
        stripControlChars(params.eventType, 64),
        stripControlChars(params.ipAddress ?? 'unknown', 64) || 'unknown',
        stripControlChars(params.userAgent ?? 'unknown', 240) || 'unknown',
        stripControlChars(params.detail ?? '', 400),
        new Date().toISOString(),
      ],
    );
  };

  async function signup(input: {
    fullName: unknown;
    email: unknown;
    password: unknown;
    confirmPassword: unknown;
    acceptTerms: unknown;
    acceptPrivacy: unknown;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<
    ServiceOutcome<{
      verificationPending: true;
      emailDeliveryConfigured: boolean;
      emailDelivered: boolean;
      deliveryMode: string;
      message: string;
      user: PublicAuthUser;
    }>
  > {
    if (runtimeConfigManager) {
      try {
        const cfg = await runtimeConfigManager.getConfig();
        if (!cfg.feature_flags.publicRegistrationEnabled) {
          return {
            ok: false,
            status: 403,
            error: 'New public account registration is currently disabled by platform administration.',
            code: 'REGISTRATION_DISABLED',
          };
        }
      } catch {
        // fail open on config lookup error so signup stays resilient
      }
    }

    const fieldErrors: Record<string, string> = {};
    const nameCheck = validateFullName(input.fullName);
    if (!nameCheck.valid) {
      fieldErrors.fullName = nameCheck.error!;
    }

    const email = normalizeEmail(input.email);
    const emailCheck = validateEmailAddress(email);
    if (!emailCheck.valid) {
      fieldErrors.email = emailCheck.error!;
    }

    const password = typeof input.password === 'string' ? input.password : '';
    const confirmPassword = typeof input.confirmPassword === 'string' ? input.confirmPassword : '';
    const strength = evaluatePasswordStrength(password, {
      email,
      fullName: nameCheck.cleaned,
    });
    if (!strength.valid) {
      fieldErrors.password = strength.error!;
    }
    if (password !== confirmPassword) {
      fieldErrors.confirmPassword = 'Password confirmation does not match.';
    }
    if (input.acceptTerms !== true) {
      fieldErrors.acceptTerms = 'You must accept the Terms of Service to create an account.';
    }
    if (input.acceptPrivacy !== true) {
      fieldErrors.acceptPrivacy = 'You must accept the Privacy Policy to create an account.';
    }

    if (Object.keys(fieldErrors).length > 0) {
      return {
        ok: false,
        status: 400,
        error: Object.values(fieldErrors)[0],
        fieldErrors,
      };
    }

    const existing = await authDb.queryOne<{ id: string }>(
      'SELECT id FROM users WHERE email = ?',
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [email],
    );
    if (existing) {
      return {
        ok: false,
        status: 409,
        error: 'An account with this email address already exists.',
        code: 'EMAIL_EXISTS',
        fieldErrors: {
          email: 'An account with this email address already exists. Sign in or reset your password.',
        },
      };
    }

    const passwordHash = await hashPassword(password);
    const verificationToken = generateOpaqueToken();
    const verificationTokenHash = hashToken(verificationToken);
    const nowIso = new Date().toISOString();
    const expiresIso = new Date(Date.now() + verificationTtlMs).toISOString();
    const userId = crypto.randomUUID();

    let createdUserRow: DbUserRow;
    try {
      createdUserRow = await authDb.withTransaction(async (tx) => {
        await tx.execute(
          `INSERT INTO users (id, full_name, email, password_hash, email_verified, account_status, role, created_at, updated_at, last_login_at)
           VALUES (?, ?, ?, ?, ?, 'active', 'user', ?, ?, NULL)`,
          `INSERT INTO users (id, full_name, email, password_hash, email_verified, account_status, role, created_at, updated_at, last_login_at)
           VALUES ($1, $2, $3, $4, $5, 'active', 'user', $6::timestamptz, $7::timestamptz, NULL)`,
          [userId, nameCheck.cleaned, email, passwordHash, boolVal(false), nowIso, nowIso],
        );

        await tx.execute(
          `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
           VALUES (?, ?, ?, ?, NULL, ?)`,
          `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
           VALUES ($1, $2, $3, $4::timestamptz, NULL, $5::timestamptz)`,
          [crypto.randomUUID(), userId, verificationTokenHash, expiresIso, nowIso],
        );

        await logSecurityEvent(tx, {
          userId,
          eventType: 'signup_created',
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          detail: 'Account created awaiting email verification.',
        });

        const row = await tx.queryOne<DbUserRow>(
          'SELECT * FROM users WHERE id = ?',
          'SELECT * FROM users WHERE id = $1',
          [userId],
        );
        if (!row) throw new Error('Failed to load newly created user.');
        return row;
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return {
          ok: false,
          status: 409,
          error: 'An account with this email address already exists.',
          code: 'EMAIL_EXISTS',
        };
      }
      throw err;
    }

    const verifyUrl = `${getBaseUrl()}/verify-email?token=${encodeURIComponent(verificationToken)}`;
    const delivery = await emailSender.send(
      buildVerificationEmailContent({
        fullName: createdUserRow.full_name,
        to: createdUserRow.email,
        verifyUrl,
        expiresHours: Math.round(verificationTtlMs / (60 * 60 * 1000)),
      }),
    );

    const configured = emailSender.isConfigured();
    const message = delivery.delivered
      ? 'Account created. Check your inbox for a single-use verification link before signing in.'
      : configured
        ? 'Account created, but verification email dispatch failed. Use Resend Verification on the login or verification page.'
        : 'Account created, but transactional email delivery is not configured yet. Add your EmailJS or Resend credentials in .env to deliver verification emails automatically.';

    return {
      ok: true,
      status: 201,
      data: {
        verificationPending: true,
        emailDeliveryConfigured: configured,
        emailDelivered: delivery.delivered,
        deliveryMode: delivery.mode,
        message,
        user: toPublicUser(createdUserRow),
      },
    };
  }

  async function login(input: {
    email: unknown;
    password: unknown;
    rememberMe?: unknown;
    existingSessionToken?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<
    ServiceOutcome<{
      sessionToken: string;
      maxAgeSeconds: number;
      user: PublicAuthUser;
      session: PublicSessionInfo;
    }>
  > {
    const email = normalizeEmail(input.email);
    const password = typeof input.password === 'string' ? input.password : '';
    const rememberMe = input.rememberMe === true;

    const emailCheck = validateEmailAddress(email);
    if (!emailCheck.valid || !password || password.length > 128) {
      return {
        ok: false,
        status: 400,
        error: 'Enter both a valid email address and your password.',
      };
    }

    const userRow = await authDb.queryOne<DbUserRow>(
      'SELECT * FROM users WHERE email = ?',
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
      [email],
    );

    if (!userRow) {
      await verifyDummyPasswordTiming(password);
      await logSecurityEvent(authDb, {
        userId: null,
        eventType: 'login_failed',
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        detail: 'Unknown account sign-in attempt.',
      });
      return {
        ok: false,
        status: 401,
        error: 'Invalid email or password.',
        code: 'INVALID_CREDENTIALS',
      };
    }

    const passwordMatches = await verifyPassword(userRow.password_hash, password);
    if (!passwordMatches) {
      await logSecurityEvent(authDb, {
        userId: userRow.id,
        eventType: 'login_failed',
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        detail: 'Invalid password attempt.',
      });
      return {
        ok: false,
        status: 401,
        error: 'Invalid email or password.',
        code: 'INVALID_CREDENTIALS',
      };
    }

    if (userRow.account_status !== 'active') {
      await logSecurityEvent(authDb, {
        userId: userRow.id,
        eventType: 'login_blocked_status',
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        detail: `Account status is ${userRow.account_status}.`,
      });
      return {
        ok: false,
        status: 403,
        error: 'This account is currently disabled or suspended.',
        code: 'ACCOUNT_DISABLED',
      };
    }

    if (!toBool(userRow.email_verified)) {
      await logSecurityEvent(authDb, {
        userId: userRow.id,
        eventType: 'login_blocked_unverified',
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        detail: 'Sign-in blocked because email is not verified.',
      });
      return {
        ok: false,
        status: 403,
        error: 'Verify your email address before signing in.',
        code: 'EMAIL_NOT_VERIFIED',
      };
    }

    const sessionToken = generateOpaqueToken();
    const sessionTokenHash = hashToken(sessionToken);
    const ttlMs = rememberMe ? rememberMeSessionTtlMs : sessionTtlMs;
    const nowIso = new Date().toISOString();
    const expiresIso = new Date(Date.now() + ttlMs).toISOString();
    const sessionId = crypto.randomUUID();
    const safeUa = stripControlChars(input.userAgent ?? 'unknown', 240) || 'unknown';
    const safeIp = stripControlChars(input.ipAddress ?? 'unknown', 64) || 'unknown';

    const { sessionRow, updatedUserRow } = await authDb.withTransaction(async (tx) => {
      if (input.existingSessionToken) {
        const oldHash = hashToken(input.existingSessionToken);
        await tx.execute(
          'UPDATE sessions SET revoked_at = ? WHERE session_token_hash = ? AND revoked_at IS NULL',
          'UPDATE sessions SET revoked_at = $1::timestamptz WHERE session_token_hash = $2 AND revoked_at IS NULL',
          [nowIso, oldHash],
        );
      }

      await tx.execute(
        `INSERT INTO sessions (id, user_id, session_token_hash, user_agent, ip_address, remember_me, expires_at, created_at, last_active_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        `INSERT INTO sessions (id, user_id, session_token_hash, user_agent, ip_address, remember_me, expires_at, created_at, last_active_at, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9::timestamptz, NULL)`,
        [
          sessionId,
          userRow.id,
          sessionTokenHash,
          safeUa,
          safeIp,
          boolVal(rememberMe),
          expiresIso,
          nowIso,
          nowIso,
        ],
      );

      await tx.execute(
        'UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?',
        'UPDATE users SET last_login_at = $1::timestamptz, updated_at = $2::timestamptz WHERE id = $3',
        [nowIso, nowIso, userRow.id],
      );

      await logSecurityEvent(tx, {
        userId: userRow.id,
        eventType: 'login_success',
        ipAddress: safeIp,
        userAgent: safeUa,
        detail: rememberMe ? 'Authenticated with extended session.' : 'Authenticated.',
      });

      const sRow = await tx.queryOne<DbSessionRow>(
        'SELECT * FROM sessions WHERE id = ?',
        'SELECT * FROM sessions WHERE id = $1',
        [sessionId],
      );
      const uRow = await tx.queryOne<DbUserRow>(
        'SELECT * FROM users WHERE id = ?',
        'SELECT * FROM users WHERE id = $1',
        [userRow.id],
      );
      if (!sRow || !uRow) throw new Error('Failed to load authenticated session.');
      return { sessionRow: sRow, updatedUserRow: uRow };
    });

    return {
      ok: true,
      status: 200,
      data: {
        sessionToken,
        maxAgeSeconds: Math.floor(ttlMs / 1000),
        user: toPublicUser(updatedUserRow),
        session: toPublicSession(sessionRow, sessionRow.id),
      },
    };
  }

  async function authenticateSessionToken(rawToken: string | undefined): Promise<{
    user: PublicAuthUser;
    session: PublicSessionInfo;
  } | null> {
    if (!rawToken || rawToken.length < 16 || rawToken.length > 256) return null;
    const tokenHash = hashToken(rawToken);
    const nowIso = new Date().toISOString();

    const sessionRow = await authDb.queryOne<DbSessionRow>(
      'SELECT * FROM sessions WHERE session_token_hash = ?',
      'SELECT * FROM sessions WHERE session_token_hash = $1',
      [tokenHash],
    );

    if (!sessionRow) return null;
    if (sessionRow.revoked_at !== null) return null;
    const expiresAtIso = toIsoTimestamp(sessionRow.expires_at);
    if (!expiresAtIso || expiresAtIso <= nowIso) return null;

    const userRow = await authDb.queryOne<DbUserRow>(
      'SELECT * FROM users WHERE id = ?',
      'SELECT * FROM users WHERE id = $1',
      [sessionRow.user_id],
    );

    if (!userRow || userRow.account_status !== 'active' || !toBool(userRow.email_verified)) {
      return null;
    }

    const lastActiveIso = toIsoTimestamp(sessionRow.last_active_at) ?? '';
    const lastActiveMs = Date.parse(lastActiveIso);
    if (!Number.isFinite(lastActiveMs) || Date.now() - lastActiveMs > 5 * 60 * 1000) {
      await authDb.execute(
        'UPDATE sessions SET last_active_at = ? WHERE id = ?',
        'UPDATE sessions SET last_active_at = $1::timestamptz WHERE id = $2',
        [nowIso, sessionRow.id],
      );
      sessionRow.last_active_at = nowIso;
    }

    return {
      user: toPublicUser(userRow),
      session: toPublicSession(sessionRow, sessionRow.id),
    };
  }

  async function logout(
    rawToken: string | undefined,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    if (!rawToken) return;
    const tokenHash = hashToken(rawToken);
    const nowIso = new Date().toISOString();
    const sessionRow = await authDb.queryOne<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM sessions WHERE session_token_hash = ? AND revoked_at IS NULL',
      'SELECT id, user_id FROM sessions WHERE session_token_hash = $1 AND revoked_at IS NULL',
      [tokenHash],
    );

    if (sessionRow) {
      await authDb.execute(
        'UPDATE sessions SET revoked_at = ? WHERE id = ?',
        'UPDATE sessions SET revoked_at = $1::timestamptz WHERE id = $2',
        [nowIso, sessionRow.id],
      );
      await logSecurityEvent(authDb, {
        userId: sessionRow.user_id,
        eventType: 'logout',
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
        detail: 'Session revoked by sign-out.',
      });
    }
  }

  async function verifyEmail(input: {
    token: unknown;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<ServiceOutcome<{ verified: true; message: string }>> {
    const rawToken = typeof input.token === 'string' ? input.token.trim() : '';
    if (!rawToken || rawToken.length < 16 || rawToken.length > 256) {
      return {
        ok: false,
        status: 400,
        error: 'Verification token is missing or invalid.',
        code: 'TOKEN_INVALID',
      };
    }

    const tokenHash = hashToken(rawToken);
    const tokenRow = await authDb.queryOne<DbTokenRow>(
      'SELECT * FROM email_verification_tokens WHERE token_hash = ?',
      'SELECT * FROM email_verification_tokens WHERE token_hash = $1',
      [tokenHash],
    );

    if (!tokenRow) {
      return {
        ok: false,
        status: 400,
        error: 'This verification link is invalid or unrecognized.',
        code: 'TOKEN_INVALID',
      };
    }

    if (tokenRow.used_at !== null) {
      return {
        ok: false,
        status: 400,
        error: 'This verification link has already been used.',
        code: 'TOKEN_USED',
      };
    }

    const nowIso = new Date().toISOString();
    const expiresIso = toIsoTimestamp(tokenRow.expires_at) ?? '';
    if (expiresIso <= nowIso) {
      return {
        ok: false,
        status: 400,
        error: 'This verification link has expired. Request a fresh verification email.',
        code: 'TOKEN_EXPIRED',
      };
    }

    const applied = await authDb.withTransaction(async (tx) => {
      const updateToken = await tx.execute(
        'UPDATE email_verification_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?',
        'UPDATE email_verification_tokens SET used_at = $1::timestamptz WHERE id = $2 AND used_at IS NULL AND expires_at > $3::timestamptz',
        [nowIso, tokenRow.id, nowIso],
      );
      if (updateToken.changes !== 1) {
        return false;
      }

      await tx.execute(
        'UPDATE email_verification_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL AND id != ?',
        'UPDATE email_verification_tokens SET used_at = $1::timestamptz WHERE user_id = $2 AND used_at IS NULL AND id != $3',
        [nowIso, tokenRow.user_id, tokenRow.id],
      );

      await tx.execute(
        'UPDATE users SET email_verified = ?, updated_at = ? WHERE id = ?',
        'UPDATE users SET email_verified = $1, updated_at = $2::timestamptz WHERE id = $3',
        [boolVal(true), nowIso, tokenRow.user_id],
      );

      await logSecurityEvent(tx, {
        userId: tokenRow.user_id,
        eventType: 'email_verified',
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        detail: 'Email address verified via single-use token.',
      });
      return true;
    });

    if (!applied) {
      return {
        ok: false,
        status: 400,
        error: 'This verification link is no longer valid.',
        code: 'TOKEN_INVALID',
      };
    }

    return {
      ok: true,
      status: 200,
      data: {
        verified: true,
        message: 'Email verified successfully. You can now sign in to your Nextrade AI workspace.',
      },
    };
  }

  async function resendVerification(input: {
    email: unknown;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<
    ServiceOutcome<{
      emailDeliveryConfigured: boolean;
      message: string;
    }>
  > {
    const email = normalizeEmail(input.email);
    const emailCheck = validateEmailAddress(email);
    if (!emailCheck.valid) {
      return {
        ok: false,
        status: 400,
        error: emailCheck.error!,
      };
    }

    const userRow = await authDb.queryOne<DbUserRow>(
      'SELECT * FROM users WHERE email = ?',
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
      [email],
    );

    if (userRow && userRow.account_status === 'active' && !toBool(userRow.email_verified)) {
      const newToken = generateOpaqueToken();
      const newHash = hashToken(newToken);
      const nowIso = new Date().toISOString();
      const expiresIso = new Date(Date.now() + verificationTtlMs).toISOString();

      await authDb.withTransaction(async (tx) => {
        await tx.execute(
          'UPDATE email_verification_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL',
          'UPDATE email_verification_tokens SET used_at = $1::timestamptz WHERE user_id = $2 AND used_at IS NULL',
          [nowIso, userRow.id],
        );

        await tx.execute(
          `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
           VALUES (?, ?, ?, ?, NULL, ?)`,
          `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
           VALUES ($1, $2, $3, $4::timestamptz, NULL, $5::timestamptz)`,
          [crypto.randomUUID(), userRow.id, newHash, expiresIso, nowIso],
        );

        await logSecurityEvent(tx, {
          userId: userRow.id,
          eventType: 'verification_resent',
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          detail: 'Verification token reissued.',
        });
      });

      const verifyUrl = `${getBaseUrl()}/verify-email?token=${encodeURIComponent(newToken)}`;
      await emailSender.send(
        buildVerificationEmailContent({
          fullName: userRow.full_name,
          to: userRow.email,
          verifyUrl,
          expiresHours: Math.round(verificationTtlMs / (60 * 60 * 1000)),
        }),
      );
    }

    const configured = emailSender.isConfigured();
    return {
      ok: true,
      status: 200,
      data: {
        emailDeliveryConfigured: configured,
        message: configured
          ? 'If an unverified account matches that email, a fresh verification link has been sent.'
          : 'Verification request processed, but transactional email delivery is not configured in this environment.',
      },
    };
  }

  async function forgotPassword(input: {
    email: unknown;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<
    ServiceOutcome<{
      emailDeliveryConfigured: boolean;
      message: string;
    }>
  > {
    const email = normalizeEmail(input.email);
    const emailCheck = validateEmailAddress(email);
    if (!emailCheck.valid) {
      return {
        ok: false,
        status: 400,
        error: emailCheck.error!,
      };
    }

    const userRow = await authDb.queryOne<DbUserRow>(
      'SELECT * FROM users WHERE email = ?',
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
      [email],
    );

    if (userRow && userRow.account_status === 'active') {
      const resetToken = generateOpaqueToken();
      const resetTokenHash = hashToken(resetToken);
      const nowIso = new Date().toISOString();
      const expiresIso = new Date(Date.now() + passwordResetTtlMs).toISOString();

      await authDb.withTransaction(async (tx) => {
        await tx.execute(
          'UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL',
          'UPDATE password_reset_tokens SET used_at = $1::timestamptz WHERE user_id = $2 AND used_at IS NULL',
          [nowIso, userRow.id],
        );

        await tx.execute(
          `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
           VALUES (?, ?, ?, ?, NULL, ?)`,
          `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
           VALUES ($1, $2, $3, $4::timestamptz, NULL, $5::timestamptz)`,
          [crypto.randomUUID(), userRow.id, resetTokenHash, expiresIso, nowIso],
        );

        await logSecurityEvent(tx, {
          userId: userRow.id,
          eventType: 'password_reset_requested',
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          detail: 'Single-use password reset token created.',
        });
      });

      const resetUrl = `${getBaseUrl()}/reset-password?token=${encodeURIComponent(resetToken)}`;
      await emailSender.send(
        buildPasswordResetEmailContent({
          fullName: userRow.full_name,
          to: userRow.email,
          resetUrl,
          expiresMinutes: Math.round(passwordResetTtlMs / (60 * 1000)),
        }),
      );
    }

    const configured = emailSender.isConfigured();
    return {
      ok: true,
      status: 200,
      data: {
        emailDeliveryConfigured: configured,
        message: configured
          ? 'If an account matches that email address, password reset instructions have been sent.'
          : 'Password reset request processed, but transactional email delivery is not configured in this environment.',
      },
    };
  }

  async function resetPassword(input: {
    token: unknown;
    password: unknown;
    confirmPassword: unknown;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<ServiceOutcome<{ reset: true; message: string }>> {
    const rawToken = typeof input.token === 'string' ? input.token.trim() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const confirmPassword = typeof input.confirmPassword === 'string' ? input.confirmPassword : '';

    if (!rawToken || rawToken.length < 16 || rawToken.length > 256) {
      return {
        ok: false,
        status: 400,
        error: 'Password reset token is missing or invalid.',
        code: 'TOKEN_INVALID',
      };
    }

    if (password !== confirmPassword) {
      return {
        ok: false,
        status: 400,
        error: 'Password confirmation does not match.',
        fieldErrors: { confirmPassword: 'Password confirmation does not match.' },
      };
    }

    const tokenHash = hashToken(rawToken);
    const tokenRow = await authDb.queryOne<DbTokenRow>(
      'SELECT * FROM password_reset_tokens WHERE token_hash = ?',
      'SELECT * FROM password_reset_tokens WHERE token_hash = $1',
      [tokenHash],
    );

    if (!tokenRow) {
      return {
        ok: false,
        status: 400,
        error: 'This password reset link is invalid.',
        code: 'TOKEN_INVALID',
      };
    }
    if (tokenRow.used_at !== null) {
      return {
        ok: false,
        status: 400,
        error: 'This password reset link has already been used.',
        code: 'TOKEN_USED',
      };
    }

    const nowIso = new Date().toISOString();
    const expiresIso = toIsoTimestamp(tokenRow.expires_at) ?? '';
    if (expiresIso <= nowIso) {
      return {
        ok: false,
        status: 400,
        error: 'This password reset link has expired. Request a new reset link.',
        code: 'TOKEN_EXPIRED',
      };
    }

    const userRow = await authDb.queryOne<DbUserRow>(
      'SELECT * FROM users WHERE id = ?',
      'SELECT * FROM users WHERE id = $1',
      [tokenRow.user_id],
    );

    if (!userRow || userRow.account_status !== 'active') {
      return {
        ok: false,
        status: 400,
        error: 'This account is unavailable for password reset.',
      };
    }

    const strength = evaluatePasswordStrength(password, {
      email: userRow.email,
      fullName: userRow.full_name,
    });
    if (!strength.valid) {
      return {
        ok: false,
        status: 400,
        error: strength.error!,
        fieldErrors: { password: strength.error! },
      };
    }

    const newPasswordHash = await hashPassword(password);
    const completedAtIso = new Date().toISOString();

    const applied = await authDb.withTransaction(async (tx) => {
      const consume = await tx.execute(
        'UPDATE password_reset_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?',
        'UPDATE password_reset_tokens SET used_at = $1::timestamptz WHERE id = $2 AND used_at IS NULL AND expires_at > $3::timestamptz',
        [completedAtIso, tokenRow.id, completedAtIso],
      );
      if (consume.changes !== 1) return false;

      await tx.execute(
        'UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL AND id != ?',
        'UPDATE password_reset_tokens SET used_at = $1::timestamptz WHERE user_id = $2 AND used_at IS NULL AND id != $3',
        [completedAtIso, userRow.id, tokenRow.id],
      );

      await tx.execute(
        'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
        'UPDATE users SET password_hash = $1, updated_at = $2::timestamptz WHERE id = $3',
        [newPasswordHash, completedAtIso, userRow.id],
      );

      await tx.execute(
        'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
        'UPDATE sessions SET revoked_at = $1::timestamptz WHERE user_id = $2 AND revoked_at IS NULL',
        [completedAtIso, userRow.id],
      );

      await logSecurityEvent(tx, {
        userId: userRow.id,
        eventType: 'password_reset_completed',
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        detail: 'Password replaced and all active sessions revoked.',
      });

      return true;
    });

    if (!applied) {
      return {
        ok: false,
        status: 400,
        error: 'This password reset link is no longer valid.',
        code: 'TOKEN_INVALID',
      };
    }

    if (emailSender.isConfigured()) {
      await emailSender
        .send(
          buildSecurityNotificationEmailContent({
            fullName: userRow.full_name,
            to: userRow.email,
            eventSummary: 'Your Nextrade AI account password was reset.',
            occurredAtIso: completedAtIso,
          }),
        )
        .catch(() => undefined);
    }

    return {
      ok: true,
      status: 200,
      data: {
        reset: true,
        message: 'Your password has been updated and all prior sessions were signed out.',
      },
    };
  }

  async function updateAccountProfile(input: {
    userId: string;
    fullName: unknown;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<ServiceOutcome<{ user: PublicAuthUser }>> {
    const nameCheck = validateFullName(input.fullName);
    if (!nameCheck.valid) {
      return {
        ok: false,
        status: 400,
        error: nameCheck.error!,
        fieldErrors: { fullName: nameCheck.error! },
      };
    }

    const nowIso = new Date().toISOString();
    await authDb.execute(
      'UPDATE users SET full_name = ?, updated_at = ? WHERE id = ?',
      'UPDATE users SET full_name = $1, updated_at = $2::timestamptz WHERE id = $3',
      [nameCheck.cleaned, nowIso, input.userId],
    );

    await logSecurityEvent(authDb, {
      userId: input.userId,
      eventType: 'account_updated',
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      detail: 'Profile display name updated.',
    });

    const updated = await authDb.queryOne<DbUserRow>(
      'SELECT * FROM users WHERE id = ?',
      'SELECT * FROM users WHERE id = $1',
      [input.userId],
    );
    if (!updated) {
      return { ok: false, status: 404, error: 'Account not found.' };
    }
    return {
      ok: true,
      status: 200,
      data: { user: toPublicUser(updated) },
    };
  }

  async function listSessions(userId: string, currentSessionId?: string): Promise<PublicSessionInfo[]> {
    const rows = await authDb.queryAll<DbSessionRow>(
      `SELECT * FROM sessions
       WHERE user_id = ?
       ORDER BY CASE WHEN revoked_at IS NULL THEN 0 ELSE 1 END, last_active_at DESC
       LIMIT 25`,
      `SELECT * FROM sessions
       WHERE user_id = $1
       ORDER BY CASE WHEN revoked_at IS NULL THEN 0 ELSE 1 END, last_active_at DESC
       LIMIT 25`,
      [userId],
    );
    return rows.map((r) => toPublicSession(r, currentSessionId));
  }

  async function revokeSession(input: {
    userId: string;
    sessionId: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<ServiceOutcome<{ revoked: true; sessionId: string }>> {
    const cleanId = stripControlChars(input.sessionId, 64);
    if (!cleanId) {
      return { ok: false, status: 400, error: 'Invalid session identifier.' };
    }

    const existing = await authDb.queryOne<{
      id: string;
      user_id: string;
      revoked_at: string | Date | null;
    }>(
      'SELECT id, user_id, revoked_at FROM sessions WHERE id = ? AND user_id = ?',
      'SELECT id, user_id, revoked_at FROM sessions WHERE id = $1 AND user_id = $2',
      [cleanId, input.userId],
    );

    if (!existing) {
      return { ok: false, status: 404, error: 'Session not found.' };
    }

    if (!existing.revoked_at) {
      const nowIso = new Date().toISOString();
      await authDb.execute(
        'UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ?',
        'UPDATE sessions SET revoked_at = $1::timestamptz WHERE id = $2 AND user_id = $3',
        [nowIso, cleanId, input.userId],
      );
      await logSecurityEvent(authDb, {
        userId: input.userId,
        eventType: 'session_revoked',
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        detail: `Revoked session ${cleanId.slice(0, 8)}.`,
      });
    }

    return {
      ok: true,
      status: 200,
      data: { revoked: true, sessionId: cleanId },
    };
  }

  async function recordSecurityEvent(params: {
    userId: string | null;
    eventType: string;
    ipAddress?: string;
    userAgent?: string;
    detail?: string;
  }): Promise<void> {
    await logSecurityEvent(authDb, params);
  }

  async function verifyUserPassword(userId: string, candidatePassword: string): Promise<boolean> {
    if (typeof candidatePassword !== 'string' || !candidatePassword) return false;
    const row = await authDb.queryOne<{ password_hash: string; account_status: string }>(
      'SELECT password_hash, account_status FROM users WHERE id = ?',
      'SELECT password_hash, account_status FROM users WHERE id = $1',
      [userId],
    );
    if (!row || row.account_status !== 'active') return false;
    return verifyPassword(row.password_hash, candidatePassword);
  }

  return {
    signup,
    login,
    authenticateSessionToken,
    logout,
    verifyEmail,
    resendVerification,
    forgotPassword,
    resetPassword,
    updateAccountProfile,
    listSessions,
    revokeSession,
    recordSecurityEvent,
    verifyUserPassword,
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
