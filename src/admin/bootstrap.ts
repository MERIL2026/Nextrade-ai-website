import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { AuthDatabase } from '../auth/db';
import { createAuthDatabase } from '../auth/db';
import { hashPassword } from '../auth/crypto';
import {
  evaluatePasswordStrength,
  normalizeEmail,
  validateEmailAddress,
  validateFullName,
} from '../lib/authValidation';
import { stripControlChars } from '../lib/security';

export interface BootstrapSuperAdminOptions {
  email?: string;
  password?: string;
  fullName?: string;
  allowCreate?: boolean;
}

export interface BootstrapSuperAdminResult {
  executed: boolean;
  action: 'skipped_existing_super_admin' | 'skipped_no_email' | 'promoted_existing' | 'created_new';
  email?: string;
  userId?: string;
  reason: string;
}

/**
 * Controlled server-side Super Admin bootstrap mechanism.
 * - Never creates a hardcoded or default password.
 * - Will not silently overwrite or elevate accounts once a super_admin exists.
 * - Can promote an already verified active user matching ADMIN_BOOTSTRAP_EMAIL,
 *   or create one if a strong ADMIN_BOOTSTRAP_PASSWORD is supplied.
 */
export async function bootstrapSuperAdmin(
  db: AuthDatabase,
  options: BootstrapSuperAdminOptions = {},
): Promise<BootstrapSuperAdminResult> {
  const isPg = db.dialect === 'postgres';
  const boolVal = (v: boolean) => (isPg ? v : v ? 1 : 0);

  const existingSuperAdmins = await db.queryOne<{ cnt: number | string }>(
    "SELECT COUNT(*) AS cnt FROM users WHERE role = 'super_admin' AND account_status = 'active'",
    "SELECT COUNT(*) AS cnt FROM users WHERE role = 'super_admin' AND account_status = 'active'",
  );
  const superAdminCount = Number(existingSuperAdmins?.cnt ?? 0);
  if (superAdminCount > 0) {
    return {
      executed: false,
      action: 'skipped_existing_super_admin',
      reason: 'An active super_admin already exists; bootstrap skipped.',
    };
  }

  const rawEmail = options.email ?? process.env.ADMIN_BOOTSTRAP_EMAIL ?? '';
  const email = normalizeEmail(rawEmail);
  if (!email) {
    return {
      executed: false,
      action: 'skipped_no_email',
      reason: 'ADMIN_BOOTSTRAP_EMAIL is not configured.',
    };
  }

  const emailCheck = validateEmailAddress(email);
  if (!emailCheck.valid) {
    throw new Error(`Invalid ADMIN_BOOTSTRAP_EMAIL: ${emailCheck.error}`);
  }

  const nowIso = new Date().toISOString();

  return db.withTransaction(async (tx) => {
    const existing = await tx.queryOne<{
      id: string;
      full_name: string;
      email: string;
      role: string;
      email_verified: number | boolean;
      account_status: string;
    }>(
      'SELECT id, full_name, email, role, email_verified, account_status FROM users WHERE email = ?',
      'SELECT id, full_name, email, role, email_verified, account_status FROM users WHERE LOWER(email) = LOWER($1)',
      [email],
    );

    if (existing) {
      if (existing.account_status !== 'active') {
        throw new Error(`Cannot bootstrap non-active user ${email} (status=${existing.account_status}).`);
      }

      await tx.execute(
        "UPDATE users SET role = 'super_admin', email_verified = ?, updated_at = ? WHERE id = ?",
        "UPDATE users SET role = 'super_admin', email_verified = $1, updated_at = $2::timestamptz WHERE id = $3",
        [boolVal(true), nowIso, existing.id],
      );

      await tx.execute(
        `INSERT INTO admin_role_assignments (id, user_id, previous_role, assigned_role, assigned_by, reason, created_at)
         VALUES (?, ?, ?, 'super_admin', NULL, ?, ?)`,
        `INSERT INTO admin_role_assignments (id, user_id, previous_role, assigned_role, assigned_by, reason, created_at)
         VALUES ($1, $2, $3, 'super_admin', NULL, $4, $5::timestamptz)`,
        [
          crypto.randomUUID(),
          existing.id,
          existing.role,
          'Controlled server-side initial Super Admin bootstrap',
          nowIso,
        ],
      );

      await tx.execute(
        `INSERT INTO admin_audit_logs (id, admin_id, admin_email, action, resource_type, resource_id, previous_value_redacted, new_value_redacted, ip_address, user_agent, result, correlation_id, created_at)
         VALUES (?, NULL, 'system-bootstrap', 'BOOTSTRAP_SUPER_ADMIN', 'user', ?, ?, ?, '127.0.0.1', 'server-bootstrap', 'SUCCESS', ?, ?)`,
        `INSERT INTO admin_audit_logs (id, admin_id, admin_email, action, resource_type, resource_id, previous_value_redacted, new_value_redacted, ip_address, user_agent, result, correlation_id, created_at)
         VALUES ($1, NULL, 'system-bootstrap', 'BOOTSTRAP_SUPER_ADMIN', 'user', $2, $3, $4, '127.0.0.1', 'server-bootstrap', 'SUCCESS', $5, $6::timestamptz)`,
        [
          crypto.randomUUID(),
          existing.id,
          JSON.stringify({ role: existing.role }),
          JSON.stringify({ role: 'super_admin' }),
          crypto.randomUUID(),
          nowIso,
        ],
      );

      return {
        executed: true,
        action: 'promoted_existing',
        email: existing.email,
        userId: existing.id,
        reason: `Promoted existing account ${existing.email} to super_admin.`,
      };
    }

    const rawPassword = options.password ?? process.env.ADMIN_BOOTSTRAP_PASSWORD ?? '';
    if (!rawPassword) {
      return {
        executed: false,
        action: 'skipped_no_email',
        email,
        reason:
          'ADMIN_BOOTSTRAP_EMAIL account does not exist yet and ADMIN_BOOTSTRAP_PASSWORD was not provided.',
      };
    }

    const rawName = options.fullName ?? process.env.ADMIN_BOOTSTRAP_NAME ?? 'Platform Owner';
    const nameCheck = validateFullName(stripControlChars(rawName, 100) || 'Platform Owner');
    const cleanName = nameCheck.valid ? nameCheck.cleaned : 'Platform Owner';
    const strength = evaluatePasswordStrength(rawPassword, { email, fullName: cleanName });
    if (!strength.valid) {
      throw new Error(`ADMIN_BOOTSTRAP_PASSWORD failed password strength policy: ${strength.error}`);
    }

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(rawPassword);

    await tx.execute(
      `INSERT INTO users (id, full_name, email, password_hash, email_verified, account_status, role, created_at, updated_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, 'active', 'super_admin', ?, ?, NULL)`,
      `INSERT INTO users (id, full_name, email, password_hash, email_verified, account_status, role, created_at, updated_at, last_login_at)
       VALUES ($1, $2, $3, $4, $5, 'active', 'super_admin', $6::timestamptz, $7::timestamptz, NULL)`,
      [userId, cleanName, email, passwordHash, boolVal(true), nowIso, nowIso],
    );

    await tx.execute(
      `INSERT INTO admin_role_assignments (id, user_id, previous_role, assigned_role, assigned_by, reason, created_at)
       VALUES (?, ?, 'none', 'super_admin', NULL, ?, ?)`,
      `INSERT INTO admin_role_assignments (id, user_id, previous_role, assigned_role, assigned_by, reason, created_at)
       VALUES ($1, $2, 'none', 'super_admin', NULL, $3, $4::timestamptz)`,
      [
        crypto.randomUUID(),
        userId,
        'Controlled server-side initial Super Admin bootstrap',
        nowIso,
      ],
    );

    await tx.execute(
      `INSERT INTO admin_audit_logs (id, admin_id, admin_email, action, resource_type, resource_id, previous_value_redacted, new_value_redacted, ip_address, user_agent, result, correlation_id, created_at)
       VALUES (?, NULL, 'system-bootstrap', 'BOOTSTRAP_SUPER_ADMIN', 'user', ?, NULL, ?, '127.0.0.1', 'server-bootstrap', 'SUCCESS', ?, ?)`,
      `INSERT INTO admin_audit_logs (id, admin_id, admin_email, action, resource_type, resource_id, previous_value_redacted, new_value_redacted, ip_address, user_agent, result, correlation_id, created_at)
       VALUES ($1, NULL, 'system-bootstrap', 'BOOTSTRAP_SUPER_ADMIN', 'user', $2, NULL, $3, '127.0.0.1', 'server-bootstrap', 'SUCCESS', $4, $5::timestamptz)`,
      [
        crypto.randomUUID(),
        userId,
        JSON.stringify({ email, role: 'super_admin' }),
        crypto.randomUUID(),
        nowIso,
      ],
    );

    return {
      executed: true,
      action: 'created_new',
      email,
      userId,
      reason: `Created verified super_admin account for ${email}.`,
    };
  });
}

// Direct CLI execution support: npx tsx src/admin/bootstrap.ts
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    await import('dotenv/config');
    const db = await createAuthDatabase();
    try {
      const args = process.argv.slice(2);
      const emailArgIdx = args.indexOf('--email');
      const nameArgIdx = args.indexOf('--name');
      const email = emailArgIdx >= 0 ? args[emailArgIdx + 1] : undefined;
      const fullName = nameArgIdx >= 0 ? args[nameArgIdx + 1] : undefined;
      const result = await bootstrapSuperAdmin(db, { email, fullName });
      console.log('[Nextrade Admin Bootstrap]', JSON.stringify(result));
    } finally {
      await db.close();
    }
  })().catch((err) => {
    console.error('[Nextrade Admin Bootstrap Error]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
