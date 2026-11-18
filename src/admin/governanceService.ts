import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type AuthDatabase, type UserRole, toBool } from '../auth/db';
import { hashToken } from '../auth/crypto';
import { normalizeUserRole } from '../auth/rbacShared';
import type { AuthEmailSender } from '../auth/email';
import type { AuthService } from '../auth/service';
import { stripControlChars } from '../lib/security';
import {
  buildCsvDocument,
  buildSafeUserDataExport,
  buildTenCategoryConfigInventory,
  canCancelDeletionStatus,
  containsForbiddenExportKeys,
  evaluateFeatureFlag,
  evaluateMaintenanceState,
  isValidFlagKey,
  resolveEffectiveLifecycleState,
} from './governanceMath';
import type { RuntimeConfigManager } from './runtimeSettings';
import type {
  AdminUserLifecycleDetailDto,
  BackupRecordDto,
  BackupStatus,
  BackupVerificationEventDto,
  DataDeletionRequestDto,
  DataDeletionStatus,
  DataExportRequestDto,
  DataExportStatus,
  FeatureEnvScope,
  FeatureFlagDto,
  FeatureFlagHistoryDto,
  GovernanceEventSummaryDto,
  MaintenanceWindowDto,
  MaintenanceWindowStatus,
  PlatformConfigBundle,
  ReleaseRecordDto,
  UserAdminNoteDto,
  UserLifecycleEventDto,
  UserLifecycleState,
} from './types';
import type { AdminActor, AdminOutcome } from './service';

export interface GovernanceServiceOptions {
  db: AuthDatabase;
  authService: AuthService;
  emailSender: AuthEmailSender;
  runtimeConfigManager: RuntimeConfigManager;
  projectRoot: string;
  writeAuditLog: (params: {
    actor: AdminActor | { userId: string | null; email: string; ipAddress?: string; userAgent?: string };
    action: string;
    resourceType: string;
    resourceId?: string | null;
    previousValue?: unknown;
    newValue?: unknown;
    result?: 'SUCCESS' | 'DENIED' | 'ERROR';
  }) => Promise<unknown>;
  countActiveSuperAdmins: () => Promise<number>;
}

const VALID_ROLES_SET = new Set<UserRole>([
  'user',
  'viewer',
  'support_admin',
  'data_admin',
  'ai_admin',
  'security_admin',
  'admin',
  'super_admin',
]);

function toIso(v: unknown): string {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function toBoolField(v: unknown): boolean {
  if (typeof v === 'boolean' || typeof v === 'number') return toBool(v);
  if (typeof v === 'string') return v === 'true' || v === '1';
  return false;
}

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function createGovernanceService(options: GovernanceServiceOptions) {
  const {
    db,
    authService,
    emailSender,
    runtimeConfigManager,
    projectRoot,
    writeAuditLog,
    countActiveSuperAdmins,
  } = options;

  const isPg = db.dialect === 'postgres';
  const boolVal = (v: boolean) => (isPg ? v : v ? 1 : 0);

  const exportDir = path.join(projectRoot, '.data', 'privacy-exports');
  const backupDir = path.join(projectRoot, '.data', 'backups');
  const exportSigningSecret = crypto
    .createHash('sha256')
    .update(
      process.env.EXPORT_SIGNING_SECRET ||
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        `${projectRoot}:${db.dbPath}:nextrade-export-signing`,
    )
    .digest('hex');

  function getRuntimeEnvironment(): 'production' | 'development' | 'staging' {
    const raw = (process.env.NODE_ENV || 'development').trim().toLowerCase();
    if (raw === 'production') return 'production';
    if (raw === 'staging') return 'staging';
    return 'development';
  }

  function signExportDownloadToken(input: {
    exportId: string;
    userId: string;
    expiresAt: string;
    checksum: string;
  }): string {
    return crypto
      .createHmac('sha256', exportSigningSecret)
      .update(`${input.exportId}:${input.userId}:${input.expiresAt}:${input.checksum}`)
      .digest('hex');
  }

  function verifyExportDownloadToken(
    provided: string,
    expected: { exportId: string; userId: string; expiresAt: string; checksum: string },
  ): boolean {
    if (!provided || typeof provided !== 'string') return false;
    const target = signExportDownloadToken(expected);
    const bufA = Buffer.from(provided, 'utf8');
    const bufB = Buffer.from(target, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  // ---- 1. USER & ORGANIZATION LIFECYCLE MANAGEMENT ----

  async function recordLifecycleTransition(params: {
    userId: string;
    previousState: string | null;
    newState: UserLifecycleState;
    actorId: string | null;
    actorEmail: string;
    reason: string;
    deletionRequestedAt?: string | null;
    deletionScheduledFor?: string | null;
    anonymizedAt?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const nowIso = new Date().toISOString();
    const existing = await db.queryOne<{
      user_id: string;
      deletion_requested_at: unknown;
      deletion_scheduled_for: unknown;
      anonymized_at: unknown;
    }>(
      'SELECT user_id, deletion_requested_at, deletion_scheduled_for, anonymized_at FROM user_lifecycle_states WHERE user_id = ?',
      'SELECT user_id, deletion_requested_at, deletion_scheduled_for, anonymized_at FROM user_lifecycle_states WHERE user_id = $1',
      [params.userId],
    );

    const nextReqAt =
      params.deletionRequestedAt !== undefined
        ? params.deletionRequestedAt
        : existing?.deletion_requested_at
          ? toIso(existing.deletion_requested_at)
          : null;
    const nextSchedAt =
      params.deletionScheduledFor !== undefined
        ? params.deletionScheduledFor
        : existing?.deletion_scheduled_for
          ? toIso(existing.deletion_scheduled_for)
          : null;
    const nextAnonAt =
      params.anonymizedAt !== undefined
        ? params.anonymizedAt
        : existing?.anonymized_at
          ? toIso(existing.anonymized_at)
          : null;

    await db.execute(
      `INSERT INTO user_lifecycle_states (user_id, lifecycle_state, reason, deletion_requested_at, deletion_scheduled_for, anonymized_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         lifecycle_state = excluded.lifecycle_state,
         reason = excluded.reason,
         deletion_requested_at = excluded.deletion_requested_at,
         deletion_scheduled_for = excluded.deletion_scheduled_for,
         anonymized_at = excluded.anonymized_at,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
      `INSERT INTO user_lifecycle_states (user_id, lifecycle_state, reason, deletion_requested_at, deletion_scheduled_for, anonymized_at, updated_by, updated_at)
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::timestamptz, $7, $8::timestamptz)
       ON CONFLICT (user_id) DO UPDATE SET
         lifecycle_state = EXCLUDED.lifecycle_state,
         reason = EXCLUDED.reason,
         deletion_requested_at = EXCLUDED.deletion_requested_at,
         deletion_scheduled_for = EXCLUDED.deletion_scheduled_for,
         anonymized_at = EXCLUDED.anonymized_at,
         updated_by = EXCLUDED.updated_by,
         updated_at = EXCLUDED.updated_at`,
      [
        params.userId,
        params.newState,
        stripControlChars(params.reason, 280),
        nextReqAt,
        nextSchedAt,
        nextAnonAt,
        params.actorId,
        nowIso,
      ],
    );

    await db.execute(
      `INSERT INTO user_lifecycle_events (id, user_id, previous_state, new_state, actor_id, actor_email, reason, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `INSERT INTO user_lifecycle_events (id, user_id, previous_state, new_state, actor_id, actor_email, reason, metadata_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)`,
      [
        crypto.randomUUID(),
        params.userId,
        params.previousState,
        params.newState,
        params.actorId,
        params.actorEmail,
        stripControlChars(params.reason, 280),
        JSON.stringify(params.metadata ?? {}),
        nowIso,
      ],
    );
  }

  async function getUserLifecycleDetail(
    userId: string,
  ): Promise<AdminOutcome<AdminUserLifecycleDetailDto>> {
    const userRow = await db.queryOne<{
      id: string;
      email: string;
      account_status: string;
      email_verified: number | boolean;
      updated_at: unknown;
    }>(
      'SELECT id, email, account_status, email_verified, updated_at FROM users WHERE id = ?',
      'SELECT id, email, account_status, email_verified, updated_at FROM users WHERE id = $1',
      [userId],
    );
    if (!userRow) {
      return { ok: false, status: 404, error: 'User account not found.', code: 'NOT_FOUND' };
    }

    const [stateRow, eventRows, noteRows] = await Promise.all([
      db.queryOne<Record<string, unknown>>(
        'SELECT * FROM user_lifecycle_states WHERE user_id = ?',
        'SELECT * FROM user_lifecycle_states WHERE user_id = $1',
        [userId],
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM user_lifecycle_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 40',
        'SELECT * FROM user_lifecycle_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 40',
        [userId],
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM user_admin_notes WHERE user_id = ? ORDER BY created_at DESC LIMIT 30',
        'SELECT * FROM user_admin_notes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30',
        [userId],
      ),
    ]);

    const effectiveState = resolveEffectiveLifecycleState({
      storedState: stateRow ? String(stateRow.lifecycle_state) : null,
      accountStatus: String(userRow.account_status),
      emailVerified: toBool(userRow.email_verified),
      email: String(userRow.email),
    });

    const events: UserLifecycleEventDto[] = eventRows.map((e) => ({
      id: String(e.id),
      userId: String(e.user_id),
      previousState: e.previous_state ? String(e.previous_state) : null,
      newState: String(e.new_state),
      actorId: e.actor_id ? String(e.actor_id) : null,
      actorEmail: String(e.actor_email),
      reason: String(e.reason ?? ''),
      metadata: safeJsonParse<Record<string, unknown>>(e.metadata_json, {}),
      createdAt: toIso(e.created_at),
    }));

    const notes: UserAdminNoteDto[] = noteRows.map((n) => ({
      id: String(n.id),
      userId: String(n.user_id),
      authorId: n.author_id ? String(n.author_id) : null,
      authorEmail: String(n.author_email),
      note: String(n.note),
      createdAt: toIso(n.created_at),
    }));

    return {
      ok: true,
      status: 200,
      data: {
        userId,
        lifecycleState: effectiveState,
        reason: stateRow ? String(stateRow.reason ?? '') : '',
        deletionRequestedAt: stateRow?.deletion_requested_at
          ? toIso(stateRow.deletion_requested_at)
          : null,
        deletionScheduledFor: stateRow?.deletion_scheduled_for
          ? toIso(stateRow.deletion_scheduled_for)
          : null,
        anonymizedAt: stateRow?.anonymized_at ? toIso(stateRow.anonymized_at) : null,
        updatedBy: stateRow?.updated_by ? String(stateRow.updated_by) : null,
        updatedAt: stateRow?.updated_at ? toIso(stateRow.updated_at) : toIso(userRow.updated_at),
        events,
        notes,
      },
    };
  }

  async function addUserAdminNote(
    actor: AdminActor,
    targetUserId: string,
    rawNote: unknown,
  ): Promise<AdminOutcome<{ note: UserAdminNoteDto }>> {
    const cleanNote = stripControlChars(typeof rawNote === 'string' ? rawNote : '', 800, {
      allowNewlines: true,
    });
    if (cleanNote.length < 3) {
      return { ok: false, status: 400, error: 'Administrative note must be at least 3 characters.' };
    }
    const target = await db.queryOne<{ id: string }>(
      'SELECT id FROM users WHERE id = ?',
      'SELECT id FROM users WHERE id = $1',
      [targetUserId],
    );
    if (!target) return { ok: false, status: 404, error: 'User account not found.' };

    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    await db.execute(
      `INSERT INTO user_admin_notes (id, user_id, author_id, author_email, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      `INSERT INTO user_admin_notes (id, user_id, author_id, author_email, note, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
      [id, targetUserId, actor.userId, actor.email, cleanNote, nowIso],
    );

    await writeAuditLog({
      actor,
      action: 'USER_ADMIN_NOTE_ADD',
      resourceType: 'user_admin_note',
      resourceId: targetUserId,
      newValue: { noteLength: cleanNote.length },
    });

    return {
      ok: true,
      status: 201,
      data: {
        note: {
          id,
          userId: targetUserId,
          authorId: actor.userId,
          authorEmail: actor.email,
          note: cleanNote,
          createdAt: nowIso,
        },
      },
    };
  }

  async function initiateDeletionWorkflow(
    actor: AdminActor,
    targetUserId: string,
    input: { mode?: unknown; graceDays?: unknown; reason?: unknown },
  ): Promise<AdminOutcome<{ lifecycleState: UserLifecycleState; scheduledFor: string | null }>> {
    if (actor.userId === targetUserId) {
      return {
        ok: false,
        status: 400,
        error: 'Administrators cannot delete or schedule deletion of their own active admin account here.',
        code: 'SELF_ACTION_FORBIDDEN',
      };
    }

    const target = await db.queryOne<{
      id: string;
      email: string;
      role: string;
      account_status: string;
      email_verified: number | boolean;
    }>(
      'SELECT id, email, role, account_status, email_verified FROM users WHERE id = ?',
      'SELECT id, email, role, account_status, email_verified FROM users WHERE id = $1',
      [targetUserId],
    );
    if (!target) {
      return { ok: false, status: 404, error: 'User account not found.' };
    }

    const targetRole = normalizeUserRole(target.role);
    if (targetRole === 'super_admin' && actor.role !== 'super_admin') {
      return {
        ok: false,
        status: 403,
        error: 'Only a Super Admin can manage deletion lifecycle for another Super Admin.',
        code: 'FORBIDDEN_TARGET_ADMIN',
      };
    }
    if (targetRole === 'super_admin' && (await countActiveSuperAdmins()) <= 1) {
      return {
        ok: false,
        status: 409,
        error: 'Cannot delete or disable the last active Super Admin account.',
        code: 'LAST_SUPER_ADMIN_GUARD',
      };
    }

    const mode = input.mode === 'anonymize_now' ? 'anonymize_now' : 'schedule';
    if (mode === 'anonymize_now' && actor.role !== 'super_admin') {
      return {
        ok: false,
        status: 403,
        error: 'Immediate anonymization requires Super Admin authority.',
        code: 'SUPER_ADMIN_REQUIRED',
      };
    }

    const cfg = await runtimeConfigManager.getConfig();
    const defaultGrace = cfg.governance_policies.deletionGracePeriodDays;
    const graceDays =
      input.graceDays !== undefined && Number.isInteger(Number(input.graceDays))
        ? Math.max(1, Math.min(90, Number(input.graceDays)))
        : defaultGrace;
    const cleanReason =
      stripControlChars(typeof input.reason === 'string' ? input.reason : '', 280) ||
      'Administrative lifecycle workflow';

    const prevStateRow = await db.queryOne<{ lifecycle_state: string }>(
      'SELECT lifecycle_state FROM user_lifecycle_states WHERE user_id = ?',
      'SELECT lifecycle_state FROM user_lifecycle_states WHERE user_id = $1',
      [targetUserId],
    );
    const prevState = resolveEffectiveLifecycleState({
      storedState: prevStateRow?.lifecycle_state ?? null,
      accountStatus: target.account_status,
      emailVerified: toBool(target.email_verified),
      email: target.email,
    });

    const nowIso = new Date().toISOString();

    if (mode === 'anonymize_now') {
      const anonymizedEmail = `deleted-${targetUserId.slice(0, 8)}@deleted.local`;
      await db.withTransaction(async (tx) => {
        await tx.execute(
          `UPDATE users SET full_name = 'Deleted User', email = ?, account_status = 'disabled', email_verified = ?, updated_at = ? WHERE id = ?`,
          `UPDATE users SET full_name = 'Deleted User', email = $1, account_status = 'disabled', email_verified = $2, updated_at = $3::timestamptz WHERE id = $4`,
          [anonymizedEmail, boolVal(false), nowIso, targetUserId],
        );
        await tx.execute(
          'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
          'UPDATE sessions SET revoked_at = $1::timestamptz WHERE user_id = $2 AND revoked_at IS NULL',
          [nowIso, targetUserId],
        );
        await tx.execute(
          `UPDATE data_deletion_requests
           SET status = 'COMPLETED', completed_at = ?, decided_by = ?, decided_at = ?, decision_note = ?, updated_at = ?
           WHERE user_id = ? AND status IN ('PENDING_REVIEW', 'SCHEDULED')`,
          `UPDATE data_deletion_requests
           SET status = 'COMPLETED', completed_at = $1::timestamptz, decided_by = $2, decided_at = $3::timestamptz, decision_note = $4, updated_at = $5::timestamptz
           WHERE user_id = $6 AND status IN ('PENDING_REVIEW', 'SCHEDULED')`,
          [nowIso, actor.userId, nowIso, cleanReason, nowIso, targetUserId],
        );
      });

      await recordLifecycleTransition({
        userId: targetUserId,
        previousState: prevState,
        newState: 'deleted_anonymized',
        actorId: actor.userId,
        actorEmail: actor.email,
        reason: cleanReason,
        anonymizedAt: nowIso,
        metadata: { mode: 'anonymize_now', previousEmail: target.email },
      });

      await authService.recordSecurityEvent({
        userId: targetUserId,
        eventType: 'account_anonymized',
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        detail: `Account anonymized by ${actor.email}: ${cleanReason}`,
      });

      await writeAuditLog({
        actor,
        action: 'USER_LIFECYCLE_ANONYMIZE',
        resourceType: 'user',
        resourceId: targetUserId,
        previousValue: { lifecycleState: prevState, email: target.email },
        newValue: { lifecycleState: 'deleted_anonymized', reason: cleanReason },
      });

      return {
        ok: true,
        status: 200,
        data: { lifecycleState: 'deleted_anonymized', scheduledFor: null },
      };
    }

    // Scheduled deletion with grace period
    const scheduledForIso = new Date(Date.now() + graceDays * 24 * 60 * 60 * 1000).toISOString();
    const existingDelReq = await db.queryOne<{ id: string }>(
      "SELECT id FROM data_deletion_requests WHERE user_id = ? AND status IN ('PENDING_REVIEW', 'SCHEDULED') ORDER BY created_at DESC LIMIT 1",
      "SELECT id FROM data_deletion_requests WHERE user_id = $1 AND status IN ('PENDING_REVIEW', 'SCHEDULED') ORDER BY created_at DESC LIMIT 1",
      [targetUserId],
    );

    if (existingDelReq) {
      await db.execute(
        `UPDATE data_deletion_requests SET status = 'SCHEDULED', scheduled_for = ?, grace_period_ends_at = ?, decided_by = ?, decided_at = ?, decision_note = ?, updated_at = ? WHERE id = ?`,
        `UPDATE data_deletion_requests SET status = 'SCHEDULED', scheduled_for = $1::timestamptz, grace_period_ends_at = $2::timestamptz, decided_by = $3, decided_at = $4::timestamptz, decision_note = $5, updated_at = $6::timestamptz WHERE id = $7`,
        [scheduledForIso, scheduledForIso, actor.userId, nowIso, cleanReason, nowIso, existingDelReq.id],
      );
    } else {
      await db.execute(
        `INSERT INTO data_deletion_requests (id, user_id, requested_by_user_id, requested_by_email, status, reason, scheduled_for, grace_period_ends_at, decision_note, decided_by, decided_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'SCHEDULED', ?, ?, ?, ?, ?, ?, ?, ?)`,
        `INSERT INTO data_deletion_requests (id, user_id, requested_by_user_id, requested_by_email, status, reason, scheduled_for, grace_period_ends_at, decision_note, decided_by, decided_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'SCHEDULED', $5, $6::timestamptz, $7::timestamptz, $8, $9, $10::timestamptz, $11::timestamptz, $12::timestamptz)`,
        [
          crypto.randomUUID(),
          targetUserId,
          actor.userId,
          actor.email,
          cleanReason,
          scheduledForIso,
          scheduledForIso,
          cleanReason,
          actor.userId,
          nowIso,
          nowIso,
          nowIso,
        ],
      );
    }

    await recordLifecycleTransition({
      userId: targetUserId,
      previousState: prevState,
      newState: 'deletion_scheduled',
      actorId: actor.userId,
      actorEmail: actor.email,
      reason: cleanReason,
      deletionRequestedAt: nowIso,
      deletionScheduledFor: scheduledForIso,
      metadata: { graceDays },
    });

    await authService.recordSecurityEvent({
      userId: targetUserId,
      eventType: 'account_deletion_scheduled',
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      detail: `Deletion scheduled for ${scheduledForIso} by ${actor.email}.`,
    });

    await writeAuditLog({
      actor,
      action: 'USER_LIFECYCLE_DELETION_SCHEDULED',
      resourceType: 'user',
      resourceId: targetUserId,
      previousValue: { lifecycleState: prevState },
      newValue: { lifecycleState: 'deletion_scheduled', scheduledFor: scheduledForIso, graceDays },
    });

    return {
      ok: true,
      status: 200,
      data: { lifecycleState: 'deletion_scheduled', scheduledFor: scheduledForIso },
    };
  }

  async function cancelUserDeletionWorkflow(
    actor: AdminActor,
    targetUserId: string,
    reason = 'Deletion request cancelled by administrator.',
  ): Promise<AdminOutcome<{ lifecycleState: UserLifecycleState }>> {
    const target = await db.queryOne<{
      id: string;
      email: string;
      account_status: string;
      email_verified: number | boolean;
    }>(
      'SELECT id, email, account_status, email_verified FROM users WHERE id = ?',
      'SELECT id, email, account_status, email_verified FROM users WHERE id = $1',
      [targetUserId],
    );
    if (!target) return { ok: false, status: 404, error: 'User account not found.' };

    const cleanReason = stripControlChars(reason, 280) || 'Deletion request cancelled.';
    const nowIso = new Date().toISOString();

    const activeReq = await db.queryOne<{ id: string; status: string }>(
      "SELECT id, status FROM data_deletion_requests WHERE user_id = ? AND status IN ('PENDING_REVIEW', 'SCHEDULED') ORDER BY created_at DESC LIMIT 1",
      "SELECT id, status FROM data_deletion_requests WHERE user_id = $1 AND status IN ('PENDING_REVIEW', 'SCHEDULED') ORDER BY created_at DESC LIMIT 1",
      [targetUserId],
    );
    if (!activeReq) {
      return {
        ok: false,
        status: 404,
        error: 'No cancellable deletion request is active for this user.',
        code: 'NO_ACTIVE_DELETION_REQUEST',
      };
    }

    await db.execute(
      `UPDATE data_deletion_requests
       SET status = 'CANCELLED', cancelled_at = ?, decided_by = ?, decided_at = ?, decision_note = ?, updated_at = ?
       WHERE id = ?`,
      `UPDATE data_deletion_requests
       SET status = 'CANCELLED', cancelled_at = $1::timestamptz, decided_by = $2, decided_at = $3::timestamptz, decision_note = $4, updated_at = $5::timestamptz
       WHERE id = $6`,
      [nowIso, actor.userId, nowIso, cleanReason, nowIso, activeReq.id],
    );

    const nextState: UserLifecycleState =
      target.account_status === 'suspended'
        ? 'suspended'
        : toBool(target.email_verified)
          ? 'active'
          : 'pending_verification';

    await recordLifecycleTransition({
      userId: targetUserId,
      previousState: activeReq.status === 'SCHEDULED' ? 'deletion_scheduled' : 'deletion_requested',
      newState: nextState,
      actorId: actor.userId,
      actorEmail: actor.email,
      reason: cleanReason,
      deletionScheduledFor: null,
    });

    await writeAuditLog({
      actor,
      action: 'USER_LIFECYCLE_DELETION_CANCELLED',
      resourceType: 'user',
      resourceId: targetUserId,
      newValue: { lifecycleState: nextState, reason: cleanReason },
    });

    return { ok: true, status: 200, data: { lifecycleState: nextState } };
  }

  // ---- 2. DATA GOVERNANCE & PRIVACY CENTRE ----

  function mapExportRow(r: Record<string, unknown>, includeTokenSigForUserId?: string): DataExportRequestDto {
    const id = String(r.id);
    const userId = String(r.user_id);
    const rawStatus = String(r.status) as DataExportStatus;
    const expiresAt = r.expires_at ? toIso(r.expires_at) : null;
    const checksum = r.artifact_checksum_sha256 ? String(r.artifact_checksum_sha256) : null;
    const isExpired = Boolean(expiresAt && Date.parse(expiresAt) < Date.now());
    const status: DataExportStatus = rawStatus === 'READY' && isExpired ? 'EXPIRED' : rawStatus;
    const downloadAvailable =
      status === 'READY' &&
      Boolean(r.artifact_path) &&
      fs.existsSync(String(r.artifact_path)) &&
      Boolean(expiresAt && Date.parse(expiresAt) > Date.now());

    return {
      id,
      userId,
      userEmail: r.user_email ? String(r.user_email) : undefined,
      requestedByUserId: r.requested_by_user_id ? String(r.requested_by_user_id) : null,
      requestedByEmail: String(r.requested_by_email),
      status,
      format: 'json',
      expiresAt,
      artifactChecksumSha256: checksum,
      byteSize: r.byte_size !== null && r.byte_size !== undefined ? Number(r.byte_size) : null,
      decisionNote: String(r.decision_note ?? ''),
      decidedBy: r.decided_by ? String(r.decided_by) : null,
      decidedAt: r.decided_at ? toIso(r.decided_at) : null,
      downloadAvailable,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
      ...(downloadAvailable &&
      includeTokenSigForUserId === userId &&
      expiresAt &&
      checksum
        ? (() => {
            const sig = signExportDownloadToken({
              exportId: id,
              userId,
              expiresAt,
              checksum,
            });
            return {
              downloadSig: sig,
              downloadUrl: `/api/privacy/export/${encodeURIComponent(id)}/download?sig=${encodeURIComponent(sig)}`,
            };
          })()
        : {}),
    };
  }

  function mapDeletionRow(r: Record<string, unknown>): DataDeletionRequestDto {
    return {
      id: String(r.id),
      userId: String(r.user_id),
      userEmail: r.user_email ? String(r.user_email) : undefined,
      requestedByUserId: r.requested_by_user_id ? String(r.requested_by_user_id) : null,
      requestedByEmail: String(r.requested_by_email),
      status: String(r.status) as DataDeletionStatus,
      reason: String(r.reason ?? ''),
      scheduledFor: r.scheduled_for ? toIso(r.scheduled_for) : null,
      gracePeriodEndsAt: r.grace_period_ends_at ? toIso(r.grace_period_ends_at) : null,
      decisionNote: String(r.decision_note ?? ''),
      decidedBy: r.decided_by ? String(r.decided_by) : null,
      decidedAt: r.decided_at ? toIso(r.decided_at) : null,
      completedAt: r.completed_at ? toIso(r.completed_at) : null,
      cancelledAt: r.cancelled_at ? toIso(r.cancelled_at) : null,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    };
  }

  async function buildSanitizedUserExportArtifact(exportId: string, userId: string) {
    const userRow = await db.queryOne<Record<string, unknown>>(
      'SELECT id, full_name, email, email_verified, account_status, role, created_at, last_login_at FROM users WHERE id = ?',
      'SELECT id, full_name, email, email_verified, account_status, role, created_at, last_login_at FROM users WHERE id = $1',
      [userId],
    );
    if (!userRow) return null;

    const [
      lifecycleRow,
      prefRow,
      portfolioRows,
      holdingRows,
      watchlistRows,
      wlItemRows,
      paperAcctRow,
      paperOrders,
      paperTxs,
      researchRows,
      reportRows,
      sessionRows,
      secEventRows,
    ] = await Promise.all([
      db.queryOne<{ lifecycle_state: string }>(
        'SELECT lifecycle_state FROM user_lifecycle_states WHERE user_id = ?',
        'SELECT lifecycle_state FROM user_lifecycle_states WHERE user_id = $1',
        [userId],
      ),
      db.queryOne<{ preferences_json: string }>(
        'SELECT preferences_json FROM user_preferences WHERE user_id = ?',
        'SELECT preferences_json FROM user_preferences WHERE user_id = $1',
        [userId],
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT id, name, base_currency, initial_balance_cents, cash_balance_cents, realized_pnl_cents, is_default, created_at, updated_at FROM portfolios WHERE user_id = ?',
        'SELECT id, name, base_currency, initial_balance_cents, cash_balance_cents, realized_pnl_cents, is_default, created_at, updated_at FROM portfolios WHERE user_id = $1',
        [userId],
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT portfolio_id, symbol, exchange, region, name, quantity_units, avg_cost_minor, currency FROM portfolio_holdings WHERE user_id = ?',
        'SELECT portfolio_id, symbol, exchange, region, name, quantity_units, avg_cost_minor, currency FROM portfolio_holdings WHERE user_id = $1',
        [userId],
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT id, name, is_default, created_at, updated_at FROM watchlists WHERE user_id = ?',
        'SELECT id, name, is_default, created_at, updated_at FROM watchlists WHERE user_id = $1',
        [userId],
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT watchlist_id, symbol, exchange, added_at FROM watchlist_items WHERE user_id = ?',
        'SELECT watchlist_id, symbol, exchange, added_at FROM watchlist_items WHERE user_id = $1',
        [userId],
      ),
      db.queryOne<Record<string, unknown>>(
        'SELECT id, portfolio_id, starting_balance_cents, cash_balance_cents, realized_pnl_cents, currency, created_at FROM paper_trading_accounts WHERE user_id = ?',
        'SELECT id, portfolio_id, starting_balance_cents, cash_balance_cents, realized_pnl_cents, currency, created_at FROM paper_trading_accounts WHERE user_id = $1',
        [userId],
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT id, symbol, exchange, side, order_type, quantity_units, execution_price_minor, currency, total_usd_cents, realized_pnl_cents, status, created_at FROM paper_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 200',
        'SELECT id, symbol, exchange, side, order_type, quantity_units, execution_price_minor, currency, total_usd_cents, realized_pnl_cents, status, created_at FROM paper_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200',
        [userId],
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT id, symbol, side, quantity_units, price_minor, total_usd_cents, realized_pnl_cents, currency, created_at FROM paper_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 200',
        'SELECT id, symbol, side, quantity_units, price_minor, total_usd_cents, realized_pnl_cents, currency, created_at FROM paper_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200',
        [userId],
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT id, symbol, query, research_result_json, source, model, created_at FROM ai_research_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 200',
        'SELECT id, symbol, query, research_result_json, source, model, created_at FROM ai_research_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200',
        [userId],
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT id, title, report_type, symbol, report_content_json, created_at, updated_at FROM saved_reports WHERE user_id = ? ORDER BY created_at DESC LIMIT 200',
        'SELECT id, title, report_type, symbol, report_content_json, created_at, updated_at FROM saved_reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200',
        [userId],
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT id, user_agent, ip_address, remember_me, created_at, last_active_at, expires_at, revoked_at FROM sessions WHERE user_id = ? ORDER BY last_active_at DESC LIMIT 50',
        'SELECT id, user_agent, ip_address, remember_me, created_at, last_active_at, expires_at, revoked_at FROM sessions WHERE user_id = $1 ORDER BY last_active_at DESC LIMIT 50',
        [userId],
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT id, event_type, ip_address, detail, created_at FROM auth_security_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
        'SELECT id, event_type, ip_address, detail, created_at FROM auth_security_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
        [userId],
      ),
    ]);

    const lifecycleState = resolveEffectiveLifecycleState({
      storedState: lifecycleRow?.lifecycle_state ?? null,
      accountStatus: String(userRow.account_status),
      emailVerified: toBoolField(userRow.email_verified),
      email: String(userRow.email),
    });

    const bundle = buildSafeUserDataExport({
      exportId,
      generatedAt: new Date().toISOString(),
      user: {
        id: String(userRow.id),
        fullName: String(userRow.full_name),
        email: String(userRow.email),
        emailVerified: toBoolField(userRow.email_verified),
        accountStatus: String(userRow.account_status),
        lifecycleState,
        role: normalizeUserRole(userRow.role),
        createdAt: toIso(userRow.created_at),
        lastLoginAt: userRow.last_login_at ? toIso(userRow.last_login_at) : null,
      },
      preferences: prefRow ? safeJsonParse(prefRow.preferences_json, null) : null,
      portfolios: portfolioRows.map((p) => ({
        id: String(p.id),
        name: String(p.name),
        baseCurrency: String(p.base_currency),
        cashBalanceUsd: Number(p.cash_balance_cents ?? 0) / 100,
        realizedPnlUsd: Number(p.realized_pnl_cents ?? 0) / 100,
        isDefault: toBoolField(p.is_default),
        createdAt: toIso(p.created_at),
        holdings: holdingRows
          .filter((h) => String(h.portfolio_id) === String(p.id))
          .map((h) => ({
            symbol: String(h.symbol),
            exchange: String(h.exchange),
            region: String(h.region),
            name: String(h.name),
            quantity: Number(h.quantity_units),
            avgCostMinor: Number(h.avg_cost_minor),
            currency: String(h.currency),
          })),
      })),
      watchlists: watchlistRows.map((w) => ({
        id: String(w.id),
        name: String(w.name),
        isDefault: toBoolField(w.is_default),
        createdAt: toIso(w.created_at),
        items: wlItemRows
          .filter((i) => String(i.watchlist_id) === String(w.id))
          .map((i) => ({
            symbol: String(i.symbol),
            exchange: String(i.exchange),
            addedAt: toIso(i.added_at),
          })),
      })),
      paperAccount: paperAcctRow
        ? {
            id: String(paperAcctRow.id),
            portfolioId: String(paperAcctRow.portfolio_id),
            startingBalanceUsd: Number(paperAcctRow.starting_balance_cents ?? 0) / 100,
            cashBalanceUsd: Number(paperAcctRow.cash_balance_cents ?? 0) / 100,
            realizedPnlUsd: Number(paperAcctRow.realized_pnl_cents ?? 0) / 100,
            currency: String(paperAcctRow.currency),
            createdAt: toIso(paperAcctRow.created_at),
          }
        : null,
      paperOrders: paperOrders.map((o) => ({
        id: String(o.id),
        symbol: String(o.symbol),
        side: String(o.side),
        quantity: Number(o.quantity_units),
        currency: String(o.currency),
        status: String(o.status),
        createdAt: toIso(o.created_at),
      })),
      paperTransactions: paperTxs.map((t) => ({
        id: String(t.id),
        symbol: String(t.symbol),
        side: String(t.side),
        quantity: Number(t.quantity_units),
        currency: String(t.currency),
        createdAt: toIso(t.created_at),
      })),
      aiResearchHistory: researchRows.map((r) => ({
        id: String(r.id),
        symbol: String(r.symbol),
        query: String(r.query),
        result: safeJsonParse(r.research_result_json, {}),
        source: String(r.source),
        model: String(r.model),
        createdAt: toIso(r.created_at),
      })),
      savedReports: reportRows.map((rep) => ({
        id: String(rep.id),
        title: String(rep.title),
        reportType: String(rep.report_type),
        symbol: String(rep.symbol),
        content: safeJsonParse(rep.report_content_json, {}),
        createdAt: toIso(rep.created_at),
      })),
      sessionsSummary: sessionRows.map((s) => ({
        id: String(s.id),
        userAgent: String(s.user_agent),
        ipAddress: String(s.ip_address),
        rememberMe: toBoolField(s.remember_me),
        createdAt: toIso(s.created_at),
        lastActiveAt: toIso(s.last_active_at),
        expiresAt: toIso(s.expires_at),
        revokedAt: s.revoked_at ? toIso(s.revoked_at) : null,
      })),
      securityEvents: secEventRows.map((e) => ({
        id: String(e.id),
        eventType: String(e.event_type),
        ipAddress: String(e.ip_address),
        detail: String(e.detail),
        createdAt: toIso(e.created_at),
      })),
    });

    const forbiddenHits = containsForbiddenExportKeys(bundle);
    if (forbiddenHits.length > 0) {
      throw new Error(`Export invariant violated: forbidden keys detected (${forbiddenHits.join(', ')})`);
    }
    return bundle;
  }

  async function requestPersonalExport(params: {
    targetUserId: string;
    requestedByUserId: string;
    requestedByEmail: string;
    autoProcess?: boolean;
  }): Promise<AdminOutcome<{ request: DataExportRequestDto }>> {
    const existingPending = await db.queryOne<{ id: string }>(
      "SELECT id FROM data_export_requests WHERE user_id = ? AND status IN ('PENDING', 'APPROVED', 'PROCESSING') ORDER BY created_at DESC LIMIT 1",
      "SELECT id FROM data_export_requests WHERE user_id = $1 AND status IN ('PENDING', 'APPROVED', 'PROCESSING') ORDER BY created_at DESC LIMIT 1",
      [params.targetUserId],
    );
    if (existingPending) {
      return {
        ok: false,
        status: 409,
        error: 'An active data export request is already in progress for this account.',
        code: 'EXPORT_ALREADY_IN_PROGRESS',
      };
    }

    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    await db.execute(
      `INSERT INTO data_export_requests (id, user_id, requested_by_user_id, requested_by_email, status, format, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'PENDING', 'json', ?, ?)`,
      `INSERT INTO data_export_requests (id, user_id, requested_by_user_id, requested_by_email, status, format, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'PENDING', 'json', $5::timestamptz, $6::timestamptz)`,
      [id, params.targetUserId, params.requestedByUserId, params.requestedByEmail, nowIso, nowIso],
    );

    await authService.recordSecurityEvent({
      userId: params.targetUserId,
      eventType: 'privacy_export_requested',
      detail: `Personal data export requested by ${params.requestedByEmail}.`,
    });

    if (params.autoProcess) {
      const processed = await processExportRequest(
        {
          userId: params.requestedByUserId,
          email: params.requestedByEmail,
          role: 'admin',
          ipAddress: 'internal',
          userAgent: 'nextrade-privacy',
        },
        id,
        'Processed immediately',
      );
      if (processed.ok) {
        return { ok: true, status: 201, data: { request: processed.data.request } };
      }
    }

    const createdRow = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM data_export_requests WHERE id = ?',
      'SELECT * FROM data_export_requests WHERE id = $1',
      [id],
    );
    return {
      ok: true,
      status: 201,
      data: { request: mapExportRow(createdRow!, params.requestedByUserId) },
    };
  }

  async function processExportRequest(
    actor: AdminActor,
    exportId: string,
    note = 'Approved & generated JSON export bundle',
  ): Promise<AdminOutcome<{ request: DataExportRequestDto }>> {
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM data_export_requests WHERE id = ?',
      'SELECT * FROM data_export_requests WHERE id = $1',
      [exportId],
    );
    if (!row) {
      return { ok: false, status: 404, error: 'Data export request not found.' };
    }
    const targetUserId = String(row.user_id);
    const nowIso = new Date().toISOString();

    await db.execute(
      "UPDATE data_export_requests SET status = 'PROCESSING', updated_at = ? WHERE id = ?",
      "UPDATE data_export_requests SET status = 'PROCESSING', updated_at = $1::timestamptz WHERE id = $2",
      [nowIso, exportId],
    );

    const bundle = await buildSanitizedUserExportArtifact(exportId, targetUserId);
    if (!bundle) {
      await db.execute(
        "UPDATE data_export_requests SET status = 'FAILED', decision_note = ?, updated_at = ? WHERE id = ?",
        "UPDATE data_export_requests SET status = 'FAILED', decision_note = $1, updated_at = $2::timestamptz WHERE id = $3",
        ['Target user account no longer exists.', nowIso, exportId],
      );
      return { ok: false, status: 404, error: 'Target user account not found.' };
    }

    fs.mkdirSync(exportDir, { recursive: true });
    const artifactPath = path.join(exportDir, `${exportId}.json`);
    const jsonText = JSON.stringify(bundle, null, 2);
    fs.writeFileSync(artifactPath, jsonText, 'utf8');
    const checksum = crypto.createHash('sha256').update(jsonText).digest('hex');
    const byteSize = Buffer.byteLength(jsonText, 'utf8');

    const cfg = await runtimeConfigManager.getConfig();
    const expiryHours = Math.max(1, Math.min(168, cfg.governance_policies.exportLinkExpiryHours || 24));
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();
    const expectedSig = signExportDownloadToken({
      exportId,
      userId: targetUserId,
      expiresAt,
      checksum,
    });
    const tokenHash = hashToken(expectedSig);

    const finishIso = new Date().toISOString();
    await db.execute(
      `UPDATE data_export_requests
       SET status = 'READY', download_token_hash = ?, expires_at = ?, artifact_path = ?, artifact_checksum_sha256 = ?, byte_size = ?, decision_note = ?, decided_by = ?, decided_at = ?, updated_at = ?
       WHERE id = ?`,
      `UPDATE data_export_requests
       SET status = 'READY', download_token_hash = $1, expires_at = $2::timestamptz, artifact_path = $3, artifact_checksum_sha256 = $4, byte_size = $5, decision_note = $6, decided_by = $7, decided_at = $8::timestamptz, updated_at = $9::timestamptz
       WHERE id = $10`,
      [
        tokenHash,
        expiresAt,
        artifactPath,
        checksum,
        byteSize,
        stripControlChars(note, 240),
        actor.userId,
        finishIso,
        finishIso,
        exportId,
      ],
    );

    await writeAuditLog({
      actor,
      action: 'PRIVACY_EXPORT_PROCESSED',
      resourceType: 'data_export_request',
      resourceId: exportId,
      newValue: { targetUserId, byteSize, expiresAt },
    });

    const updated = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM data_export_requests WHERE id = ?',
      'SELECT * FROM data_export_requests WHERE id = $1',
      [exportId],
    );
    return {
      ok: true,
      status: 200,
      data: { request: mapExportRow(updated!, actor.userId) },
    };
  }

  async function rejectExportRequest(
    actor: AdminActor,
    exportId: string,
    reason = 'Rejected by administrator.',
  ): Promise<AdminOutcome<{ request: DataExportRequestDto }>> {
    const existing = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM data_export_requests WHERE id = ?',
      'SELECT * FROM data_export_requests WHERE id = $1',
      [exportId],
    );
    if (!existing) return { ok: false, status: 404, error: 'Export request not found.' };

    const nowIso = new Date().toISOString();
    const cleanReason = stripControlChars(reason, 240) || 'Rejected by administrator.';
    await db.execute(
      `UPDATE data_export_requests SET status = 'REJECTED', decision_note = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?`,
      `UPDATE data_export_requests SET status = 'REJECTED', decision_note = $1, decided_by = $2, decided_at = $3::timestamptz, updated_at = $4::timestamptz WHERE id = $5`,
      [cleanReason, actor.userId, nowIso, nowIso, exportId],
    );

    await writeAuditLog({
      actor,
      action: 'PRIVACY_EXPORT_REJECTED',
      resourceType: 'data_export_request',
      resourceId: exportId,
      newValue: { reason: cleanReason },
    });

    const updated = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM data_export_requests WHERE id = ?',
      'SELECT * FROM data_export_requests WHERE id = $1',
      [exportId],
    );
    return { ok: true, status: 200, data: { request: mapExportRow(updated!) } };
  }

  async function downloadUserExportArtifact(params: {
    requestingUserId: string;
    exportId: string;
    sig?: string;
  }): Promise<AdminOutcome<{ filename: string; jsonContent: string }>> {
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM data_export_requests WHERE id = ?',
      'SELECT * FROM data_export_requests WHERE id = $1',
      [params.exportId],
    );
    if (!row) return { ok: false, status: 404, error: 'Export request not found.' };

    const ownerId = String(row.user_id);
    if (ownerId !== params.requestingUserId) {
      return {
        ok: false,
        status: 403,
        error: 'Access denied. You may only download your own personal data exports.',
        code: 'EXPORT_OWNERSHIP_FORBIDDEN',
      };
    }

    const status = String(row.status);
    if (status === 'EXPIRED') {
      return { ok: false, status: 410, error: 'This export link has expired.', code: 'EXPORT_EXPIRED' };
    }
    if (status !== 'READY' || !row.artifact_path) {
      return {
        ok: false,
        status: 409,
        error: 'Export bundle is not ready for download.',
        code: 'EXPORT_NOT_READY',
      };
    }

    const expiresAt = row.expires_at ? toIso(row.expires_at) : '';
    const checksum = row.artifact_checksum_sha256 ? String(row.artifact_checksum_sha256) : '';
    if (!expiresAt || Date.parse(expiresAt) < Date.now()) {
      await db.execute(
        "UPDATE data_export_requests SET status = 'EXPIRED', updated_at = ? WHERE id = ?",
        "UPDATE data_export_requests SET status = 'EXPIRED', updated_at = $1::timestamptz WHERE id = $2",
        [new Date().toISOString(), params.exportId],
      );
      return { ok: false, status: 410, error: 'This export download link has expired.', code: 'EXPORT_EXPIRED' };
    }

    if (
      !params.sig ||
      !verifyExportDownloadToken(params.sig, {
        exportId: params.exportId,
        userId: ownerId,
        expiresAt,
        checksum,
      })
    ) {
      return {
        ok: false,
        status: 403,
        error: 'Invalid or missing expiring download token.',
        code: 'EXPORT_TOKEN_INVALID',
      };
    }

    const artifactPath = String(row.artifact_path);
    if (!fs.existsSync(artifactPath)) {
      return {
        ok: false,
        status: 404,
        error: 'Export artifact file has been purged or is unavailable.',
        code: 'EXPORT_FILE_MISSING',
      };
    }

    const jsonContent = fs.readFileSync(artifactPath, 'utf8');
    await authService.recordSecurityEvent({
      userId: ownerId,
      eventType: 'privacy_export_downloaded',
      detail: `Personal data export ${params.exportId.slice(0, 8)} downloaded by account owner.`,
    });

    return {
      ok: true,
      status: 200,
      data: {
        filename: `nextrade-personal-data-${params.exportId.slice(0, 8)}.json`,
        jsonContent,
      },
    };
  }

  async function requestSelfDeletion(params: {
    userId: string;
    email: string;
    role: string;
    reason?: unknown;
  }): Promise<AdminOutcome<{ request: DataDeletionRequestDto }>> {
    if (normalizeUserRole(params.role) === 'super_admin' && (await countActiveSuperAdmins()) <= 1) {
      return {
        ok: false,
        status: 409,
        error: 'The final active Super Admin account cannot be scheduled for deletion until another Super Admin exists.',
        code: 'LAST_SUPER_ADMIN_GUARD',
      };
    }

    const existing = await db.queryOne<{ id: string }>(
      "SELECT id FROM data_deletion_requests WHERE user_id = ? AND status IN ('PENDING_REVIEW', 'SCHEDULED') ORDER BY created_at DESC LIMIT 1",
      "SELECT id FROM data_deletion_requests WHERE user_id = $1 AND status IN ('PENDING_REVIEW', 'SCHEDULED') ORDER BY created_at DESC LIMIT 1",
      [params.userId],
    );
    if (existing) {
      return {
        ok: false,
        status: 409,
        error: 'An account deletion request is already pending or scheduled.',
        code: 'DELETION_ALREADY_PENDING',
      };
    }

    const cfg = await runtimeConfigManager.getConfig();
    const graceDays = cfg.governance_policies.deletionGracePeriodDays || 7;
    const nowIso = new Date().toISOString();
    const graceEndsIso = new Date(Date.now() + graceDays * 24 * 60 * 60 * 1000).toISOString();
    const cleanReason =
      stripControlChars(typeof params.reason === 'string' ? params.reason : '', 280) ||
      'User requested account deletion';
    const id = crypto.randomUUID();

    await db.execute(
      `INSERT INTO data_deletion_requests (id, user_id, requested_by_user_id, requested_by_email, status, reason, grace_period_ends_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'PENDING_REVIEW', ?, ?, ?, ?)`,
      `INSERT INTO data_deletion_requests (id, user_id, requested_by_user_id, requested_by_email, status, reason, grace_period_ends_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'PENDING_REVIEW', $5, $6::timestamptz, $7::timestamptz, $8::timestamptz)`,
      [id, params.userId, params.userId, params.email, cleanReason, graceEndsIso, nowIso, nowIso],
    );

    await recordLifecycleTransition({
      userId: params.userId,
      previousState: 'active',
      newState: 'deletion_requested',
      actorId: params.userId,
      actorEmail: params.email,
      reason: cleanReason,
      deletionRequestedAt: nowIso,
    });

    await authService.recordSecurityEvent({
      userId: params.userId,
      eventType: 'privacy_deletion_requested',
      detail: `Account deletion requested by owner. Grace window ends ${graceEndsIso}.`,
    });

    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM data_deletion_requests WHERE id = ?',
      'SELECT * FROM data_deletion_requests WHERE id = $1',
      [id],
    );
    return { ok: true, status: 201, data: { request: mapDeletionRow(row!) } };
  }

  async function cancelSelfDeletionRequest(params: {
    userId: string;
    email: string;
    deletionRequestId: string;
  }): Promise<AdminOutcome<{ request: DataDeletionRequestDto }>> {
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM data_deletion_requests WHERE id = ?',
      'SELECT * FROM data_deletion_requests WHERE id = $1',
      [params.deletionRequestId],
    );
    if (!row) return { ok: false, status: 404, error: 'Deletion request not found.' };
    if (String(row.user_id) !== params.userId) {
      return { ok: false, status: 403, error: 'Forbidden: you cannot modify another user’s deletion request.' };
    }
    if (!canCancelDeletionStatus(String(row.status))) {
      return {
        ok: false,
        status: 409,
        error: `Deletion request with status "${row.status}" can no longer be cancelled.`,
      };
    }

    const nowIso = new Date().toISOString();
    await db.execute(
      `UPDATE data_deletion_requests SET status = 'CANCELLED', cancelled_at = ?, decision_note = 'Cancelled by account owner.', updated_at = ? WHERE id = ?`,
      `UPDATE data_deletion_requests SET status = 'CANCELLED', cancelled_at = $1::timestamptz, decision_note = 'Cancelled by account owner.', updated_at = $2::timestamptz WHERE id = $3`,
      [nowIso, nowIso, params.deletionRequestId],
    );

    await recordLifecycleTransition({
      userId: params.userId,
      previousState: String(row.status) === 'SCHEDULED' ? 'deletion_scheduled' : 'deletion_requested',
      newState: 'active',
      actorId: params.userId,
      actorEmail: params.email,
      reason: 'Deletion request cancelled by owner during grace period.',
      deletionScheduledFor: null,
    });

    await authService.recordSecurityEvent({
      userId: params.userId,
      eventType: 'privacy_deletion_cancelled',
      detail: 'User cancelled pending/scheduled account deletion request.',
    });

    const updated = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM data_deletion_requests WHERE id = ?',
      'SELECT * FROM data_deletion_requests WHERE id = $1',
      [params.deletionRequestId],
    );
    return { ok: true, status: 200, data: { request: mapDeletionRow(updated!) } };
  }

  async function getUserPrivacySummary(userId: string) {
    const cfg = await runtimeConfigManager.getConfig();
    const [
      exportsRows,
      deletionRows,
      secEvents,
      portfoliosCnt,
      watchlistsCnt,
      ordersCnt,
      researchCnt,
      reportsCnt,
    ] = await Promise.all([
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM data_export_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
        'SELECT * FROM data_export_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
        [userId],
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM data_deletion_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
        'SELECT * FROM data_deletion_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
        [userId],
      ),
      db.queryAll<Record<string, unknown>>(
        "SELECT id, event_type, ip_address, detail, created_at FROM auth_security_events WHERE user_id = ? AND (event_type LIKE 'privacy_%' OR event_type LIKE 'account_%') ORDER BY created_at DESC LIMIT 25",
        "SELECT id, event_type, ip_address, detail, created_at FROM auth_security_events WHERE user_id = $1 AND (event_type LIKE 'privacy_%' OR event_type LIKE 'account_%') ORDER BY created_at DESC LIMIT 25",
        [userId],
      ),
      db.queryOne<{ cnt: number | string }>(
        'SELECT COUNT(*) AS cnt FROM portfolios WHERE user_id = ?',
        'SELECT COUNT(*) AS cnt FROM portfolios WHERE user_id = $1',
        [userId],
      ),
      db.queryOne<{ cnt: number | string }>(
        'SELECT COUNT(*) AS cnt FROM watchlists WHERE user_id = ?',
        'SELECT COUNT(*) AS cnt FROM watchlists WHERE user_id = $1',
        [userId],
      ),
      db.queryOne<{ cnt: number | string }>(
        'SELECT COUNT(*) AS cnt FROM paper_orders WHERE user_id = ?',
        'SELECT COUNT(*) AS cnt FROM paper_orders WHERE user_id = $1',
        [userId],
      ),
      db.queryOne<{ cnt: number | string }>(
        'SELECT COUNT(*) AS cnt FROM ai_research_history WHERE user_id = ?',
        'SELECT COUNT(*) AS cnt FROM ai_research_history WHERE user_id = $1',
        [userId],
      ),
      db.queryOne<{ cnt: number | string }>(
        'SELECT COUNT(*) AS cnt FROM saved_reports WHERE user_id = ?',
        'SELECT COUNT(*) AS cnt FROM saved_reports WHERE user_id = $1',
        [userId],
      ),
    ]);

    return {
      dataInventory: {
        portfolios: Number(portfoliosCnt?.cnt ?? 0),
        watchlists: Number(watchlistsCnt?.cnt ?? 0),
        paperOrders: Number(ordersCnt?.cnt ?? 0),
        aiResearchRuns: Number(researchCnt?.cnt ?? 0),
        savedReports: Number(reportsCnt?.cnt ?? 0),
      },
      retentionPolicies: {
        exportLinkExpiryHours: cfg.governance_policies.exportLinkExpiryHours,
        deletionGracePeriodDays: cfg.governance_policies.deletionGracePeriodDays,
        telemetryRetentionDays: cfg.governance_policies.telemetryRetentionDays,
        auditRetentionDays: cfg.governance_policies.auditRetentionDays,
        backupRetentionCaveat:
          'Historical infrastructure backups (if enabled by hosting platform) retain point-in-time records until backup rotation completes and cannot be individually edited.',
      },
      exportRequests: exportsRows.map((r) => mapExportRow(r, userId)),
      deletionRequests: deletionRows.map(mapDeletionRow),
      privacyActivity: secEvents.map((e) => ({
        id: String(e.id),
        eventType: String(e.event_type),
        ipAddress: String(e.ip_address),
        detail: String(e.detail),
        createdAt: toIso(e.created_at),
      })),
    };
  }

  async function listAdminPrivacyQueue() {
    const cfg = await runtimeConfigManager.getConfig();
    const [exportRows, deletionRows] = await Promise.all([
      db.queryAll<Record<string, unknown>>(
        `SELECT r.*, u.email AS user_email
         FROM data_export_requests r
         LEFT JOIN users u ON u.id = r.user_id
         ORDER BY r.created_at DESC LIMIT 80`,
        `SELECT r.*, u.email AS user_email
         FROM data_export_requests r
         LEFT JOIN users u ON u.id = r.user_id
         ORDER BY r.created_at DESC LIMIT 80`,
      ),
      db.queryAll<Record<string, unknown>>(
        `SELECT d.*, u.email AS user_email
         FROM data_deletion_requests d
         LEFT JOIN users u ON u.id = d.user_id
         ORDER BY d.created_at DESC LIMIT 80`,
        `SELECT d.*, u.email AS user_email
         FROM data_deletion_requests d
         LEFT JOIN users u ON u.id = d.user_id
         ORDER BY d.created_at DESC LIMIT 80`,
      ),
    ]);

    return {
      exportRequests: exportRows.map((r) => mapExportRow(r)),
      deletionRequests: deletionRows.map(mapDeletionRow),
      retentionPolicies: {
        exportLinkExpiryHours: cfg.governance_policies.exportLinkExpiryHours,
        deletionGracePeriodDays: cfg.governance_policies.deletionGracePeriodDays,
        telemetryRetentionDays: cfg.governance_policies.telemetryRetentionDays,
        auditRetentionDays: cfg.governance_policies.auditRetentionDays,
        backupRetentionCaveat:
          'Deleted or anonymized accounts remove direct PII from active operational tables; immutable audit entries preserve redacted references and infrastructure backups expire via scheduled rotation.',
      },
    };
  }

  async function handleAdminDeletionAction(
    actor: AdminActor,
    deletionId: string,
    action: 'SCHEDULE' | 'COMPLETE' | 'REJECT' | 'CANCEL',
    input: { graceDays?: unknown; reason?: unknown },
  ): Promise<AdminOutcome<{ request: DataDeletionRequestDto }>> {
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM data_deletion_requests WHERE id = ?',
      'SELECT * FROM data_deletion_requests WHERE id = $1',
      [deletionId],
    );
    if (!row) return { ok: false, status: 404, error: 'Deletion request not found.' };
    const targetUserId = String(row.user_id);

    if (action === 'SCHEDULE') {
      const res = await initiateDeletionWorkflow(actor, targetUserId, {
        mode: 'schedule',
        graceDays: input.graceDays,
        reason: input.reason ?? row.reason,
      });
      if (!res.ok) return res;
    } else if (action === 'COMPLETE') {
      const res = await initiateDeletionWorkflow(actor, targetUserId, {
        mode: 'anonymize_now',
        reason: input.reason ?? row.reason,
      });
      if (!res.ok) return res;
    } else if (action === 'CANCEL') {
      const res = await cancelUserDeletionWorkflow(
        actor,
        targetUserId,
        typeof input.reason === 'string' ? input.reason : 'Cancelled via Privacy Centre',
      );
      if (!res.ok) return res;
    } else {
      const nowIso = new Date().toISOString();
      const cleanNote =
        stripControlChars(typeof input.reason === 'string' ? input.reason : '', 240) ||
        'Deletion request rejected after review.';
      await db.execute(
        `UPDATE data_deletion_requests SET status = 'REJECTED', decided_by = ?, decided_at = ?, decision_note = ?, updated_at = ? WHERE id = ?`,
        `UPDATE data_deletion_requests SET status = 'REJECTED', decided_by = $1, decided_at = $2::timestamptz, decision_note = $3, updated_at = $4::timestamptz WHERE id = $5`,
        [actor.userId, nowIso, cleanNote, nowIso, deletionId],
      );
      await recordLifecycleTransition({
        userId: targetUserId,
        previousState: 'deletion_requested',
        newState: 'active',
        actorId: actor.userId,
        actorEmail: actor.email,
        reason: cleanNote,
      });
      await writeAuditLog({
        actor,
        action: 'PRIVACY_DELETION_REJECTED',
        resourceType: 'data_deletion_request',
        resourceId: deletionId,
        newValue: { reason: cleanNote },
      });
    }

    const updated = await db.queryOne<Record<string, unknown>>(
      `SELECT d.*, u.email AS user_email FROM data_deletion_requests d LEFT JOIN users u ON u.id = d.user_id WHERE d.id = ?`,
      `SELECT d.*, u.email AS user_email FROM data_deletion_requests d LEFT JOIN users u ON u.id = d.user_id WHERE d.id = $1`,
      [deletionId],
    );
    return { ok: true, status: 200, data: { request: mapDeletionRow(updated!) } };
  }

  // ---- 3. BACKUP & DISASTER RECOVERY ----

  function getBackupCapabilities() {
    const isSqliteFile =
      db.dialect === 'sqlite' && Boolean(db.sqliteDb) && db.dbPath && db.dbPath !== ':memory:';
    const hasSupabaseBackupToken = Boolean(process.env.SUPABASE_ACCESS_TOKEN?.trim());
    const fullDatabaseBackupSupported = isSqliteFile;
    const configSnapshotSupported = true;
    return {
      dialect: db.dialect,
      environment: getRuntimeEnvironment(),
      isSqliteFile,
      fullDatabaseBackupSupported,
      fullDatabaseBackupStatus: fullDatabaseBackupSupported ? 'AVAILABLE' : 'NOT_CONFIGURED',
      fullDatabaseReason: fullDatabaseBackupSupported
        ? `Local SQLite snapshot backups enabled at .data/backups/ (source: ${path.basename(db.dbPath)}).`
        : hasSupabaseBackupToken
          ? 'pg_dump binary is unavailable in runtime container; manage physical backups via Supabase Dashboard PITR.'
          : 'PostgreSQL physical dump/restore is NOT CONFIGURED in this runtime (pg_dump binary and remote backup provider credentials are absent). Manage full database PITR/snapshots directly in Supabase Dashboard.',
      configSnapshotSupported,
      configSnapshotNote:
        'Application-level Governance & Configuration Snapshots (settings, feature flags, prompts) are supported with SHA-256 verification and strictly exclude credentials/secrets.',
    };
  }

  function mapBackupRow(r: Record<string, unknown>): BackupRecordDto {
    return {
      id: String(r.id),
      backupType: String(r.backup_type) as BackupRecordDto['backupType'],
      environment: String(r.environment),
      dialect: String(r.dialect),
      status: String(r.status) as BackupStatus,
      storageLocation: String(r.storage_location),
      checksumSha256: r.checksum_sha256 ? String(r.checksum_sha256) : null,
      byteSize: r.byte_size !== null && r.byte_size !== undefined ? Number(r.byte_size) : null,
      verifiedAt: r.verified_at ? toIso(r.verified_at) : null,
      verificationDetail: String(r.verification_detail ?? ''),
      failureReason: r.failure_reason ? String(r.failure_reason) : null,
      triggeredBy: r.triggered_by ? String(r.triggered_by) : null,
      triggeredByEmail: String(r.triggered_by_email ?? 'system'),
      metadata: safeJsonParse<Record<string, unknown>>(r.metadata_json, {}),
      createdAt: toIso(r.created_at),
    };
  }

  async function recordBackupEvent(params: {
    backupId: string;
    action: BackupVerificationEventDto['action'];
    status: BackupVerificationEventDto['status'];
    actor: AdminActor;
    detail: string;
  }) {
    await db.execute(
      `INSERT INTO backup_verification_events (id, backup_id, action, status, actor_id, actor_email, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      `INSERT INTO backup_verification_events (id, backup_id, action, status, actor_id, actor_email, detail, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
      [
        crypto.randomUUID(),
        params.backupId,
        params.action,
        params.status,
        params.actor.userId,
        params.actor.email,
        stripControlChars(params.detail, 320),
        new Date().toISOString(),
      ],
    );
  }

  async function listBackupsOverview() {
    const [records, events] = await Promise.all([
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM backup_records ORDER BY created_at DESC LIMIT 50',
        'SELECT * FROM backup_records ORDER BY created_at DESC LIMIT 50',
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM backup_verification_events ORDER BY created_at DESC LIMIT 60',
        'SELECT * FROM backup_verification_events ORDER BY created_at DESC LIMIT 60',
      ),
    ]);

    return {
      capabilities: getBackupCapabilities(),
      backups: records.map(mapBackupRow),
      events: events.map((e) => ({
        id: String(e.id),
        backupId: String(e.backup_id),
        action: String(e.action) as BackupVerificationEventDto['action'],
        status: String(e.status) as BackupVerificationEventDto['status'],
        actorId: e.actor_id ? String(e.actor_id) : null,
        actorEmail: String(e.actor_email),
        detail: String(e.detail ?? ''),
        createdAt: toIso(e.created_at),
      })),
    };
  }

  async function createBackup(
    actor: AdminActor,
    rawType?: unknown,
  ): Promise<AdminOutcome<{ backup: BackupRecordDto }>> {
    const caps = getBackupCapabilities();
    const requested = typeof rawType === 'string' ? rawType : caps.fullDatabaseBackupSupported ? 'SQLITE_SNAPSHOT' : 'CONFIG_SNAPSHOT';
    const env = getRuntimeEnvironment();
    const nowIso = new Date().toISOString();
    const id = crypto.randomUUID();

    if (requested === 'FULL_DATABASE' || requested === 'SQLITE_SNAPSHOT') {
      if (!caps.fullDatabaseBackupSupported || !db.sqliteDb) {
        // Honestly record NOT_CONFIGURED rather than fabricating a backup!
        await db.execute(
          `INSERT INTO backup_records (id, backup_type, environment, dialect, status, storage_location, failure_reason, triggered_by, triggered_by_email, metadata_json, created_at)
           VALUES (?, 'FULL_DATABASE_UNAVAILABLE', ?, ?, 'NOT_CONFIGURED', 'none', ?, ?, ?, ?, ?)`,
          `INSERT INTO backup_records (id, backup_type, environment, dialect, status, storage_location, failure_reason, triggered_by, triggered_by_email, metadata_json, created_at)
           VALUES ($1, 'FULL_DATABASE_UNAVAILABLE', $2, $3, 'NOT_CONFIGURED', 'none', $4, $5, $6, $7, $8::timestamptz)`,
          [
            id,
            env,
            db.dialect,
            caps.fullDatabaseReason,
            actor.userId,
            actor.email,
            JSON.stringify({ requestedType: requested }),
            nowIso,
          ],
        );
        await recordBackupEvent({
          backupId: id,
          action: 'CREATE',
          status: 'NOT_CONFIGURED',
          actor,
          detail: caps.fullDatabaseReason,
        });
        await writeAuditLog({
          actor,
          action: 'BACKUP_CREATE_NOT_CONFIGURED',
          resourceType: 'backup_record',
          resourceId: id,
          newValue: { requested, reason: caps.fullDatabaseReason },
          result: 'ERROR',
        });
        return {
          ok: false,
          status: 409,
          error: caps.fullDatabaseReason,
          code: 'BACKUP_PROVIDER_NOT_CONFIGURED',
        };
      }

      // Real SQLite atomic snapshot using VACUUM INTO
      fs.mkdirSync(backupDir, { recursive: true });
      const filePath = path.join(backupDir, `nextrade-${id.slice(0, 8)}.sqlite`);
      try {
        const escapedPath = filePath.replace(/'/g, "''");
        db.sqliteDb.exec(`VACUUM INTO '${escapedPath}'`);
        const buf = fs.readFileSync(filePath);
        const checksum = crypto.createHash('sha256').update(buf).digest('hex');
        const byteSize = buf.byteLength;

        const verifyConn = new DatabaseSync(filePath, { readOnly: true });
        let integrityResult = 'failed';
        try {
          const checkRow = verifyConn.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
          integrityResult = checkRow?.integrity_check ?? 'unknown';
        } finally {
          verifyConn.close();
        }

        const verified = integrityResult.toLowerCase() === 'ok';
        const status: BackupStatus = verified ? 'VERIFIED' : 'FAILED';
        const verificationDetail = verified
          ? `PRAGMA integrity_check=ok · SHA-256 verified (${byteSize} bytes)`
          : `Integrity check returned: ${integrityResult}`;

        await db.execute(
          `INSERT INTO backup_records (id, backup_type, environment, dialect, status, storage_location, file_path, checksum_sha256, byte_size, verified_at, verification_detail, failure_reason, triggered_by, triggered_by_email, metadata_json, created_at)
           VALUES (?, 'SQLITE_SNAPSHOT', ?, 'sqlite', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          `INSERT INTO backup_records (id, backup_type, environment, dialect, status, storage_location, file_path, checksum_sha256, byte_size, verified_at, verification_detail, failure_reason, triggered_by, triggered_by_email, metadata_json, created_at)
           VALUES ($1, 'SQLITE_SNAPSHOT', $2, 'sqlite', $3, $4, $5, $6, $7, $8::timestamptz, $9, $10, $11, $12, $13, $14::timestamptz)`,
          [
            id,
            env,
            status,
            '.data/backups',
            filePath,
            checksum,
            byteSize,
            verified ? nowIso : null,
            verificationDetail,
            verified ? null : verificationDetail,
            actor.userId,
            actor.email,
            JSON.stringify({ sourceDb: path.basename(db.dbPath) }),
            nowIso,
          ],
        );

        await recordBackupEvent({
          backupId: id,
          action: 'CREATE',
          status: verified ? 'SUCCESS' : 'FAILED',
          actor,
          detail: verificationDetail,
        });
        await writeAuditLog({
          actor,
          action: 'BACKUP_CREATE_SQLITE',
          resourceType: 'backup_record',
          resourceId: id,
          newValue: { status, byteSize, checksumPrefix: checksum.slice(0, 12) },
        });

        const row = await db.queryOne<Record<string, unknown>>(
          'SELECT * FROM backup_records WHERE id = ?',
          'SELECT * FROM backup_records WHERE id = $1',
          [id],
        );
        return { ok: true, status: 201, data: { backup: mapBackupRow(row!) } };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'SQLite snapshot failed';
        await db.execute(
          `INSERT INTO backup_records (id, backup_type, environment, dialect, status, storage_location, failure_reason, triggered_by, triggered_by_email, created_at)
           VALUES (?, 'SQLITE_SNAPSHOT', ?, 'sqlite', 'FAILED', '.data/backups', ?, ?, ?, ?)`,
          `INSERT INTO backup_records (id, backup_type, environment, dialect, status, storage_location, failure_reason, triggered_by, triggered_by_email, created_at)
           VALUES ($1, 'SQLITE_SNAPSHOT', $2, 'sqlite', 'FAILED', '.data/backups', $3, $4, $5, $6::timestamptz)`,
          [id, env, msg.slice(0, 300), actor.userId, actor.email, nowIso],
        );
        return { ok: false, status: 500, error: msg };
      }
    }

    // CONFIG_SNAPSHOT (safe, secret-free application governance configuration + feature flags snapshot)
    fs.mkdirSync(backupDir, { recursive: true });
    const cfgBundle = await runtimeConfigManager.getConfig();
    const flagRows = await db.queryAll<Record<string, unknown>>(
      'SELECT * FROM feature_flags ORDER BY flag_key ASC',
      'SELECT * FROM feature_flags ORDER BY flag_key ASC',
    );
    const snapshotObj = {
      schemaVersion: 'nextrade-config-snapshot-v1',
      capturedAt: nowIso,
      environment: env,
      dialect: db.dialect,
      note: 'Governance settings and feature flags only. Database credentials, API secrets, password hashes, and user PII are excluded.',
      platformSettings: cfgBundle,
      featureFlags: flagRows.map(mapFeatureFlagRow),
    };
    const jsonText = JSON.stringify(snapshotObj, null, 2);
    const filePath = path.join(backupDir, `nextrade-config-${id.slice(0, 8)}.json`);
    fs.writeFileSync(filePath, jsonText, 'utf8');
    const checksum = crypto.createHash('sha256').update(jsonText).digest('hex');
    const byteSize = Buffer.byteLength(jsonText, 'utf8');

    await db.execute(
      `INSERT INTO backup_records (id, backup_type, environment, dialect, status, storage_location, file_path, checksum_sha256, byte_size, verified_at, verification_detail, triggered_by, triggered_by_email, metadata_json, created_at)
       VALUES (?, 'CONFIG_SNAPSHOT', ?, ?, 'VERIFIED', '.data/backups', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `INSERT INTO backup_records (id, backup_type, environment, dialect, status, storage_location, file_path, checksum_sha256, byte_size, verified_at, verification_detail, triggered_by, triggered_by_email, metadata_json, created_at)
       VALUES ($1, 'CONFIG_SNAPSHOT', $2, $3, 'VERIFIED', '.data/backups', $4, $5, $6, $7::timestamptz, $8, $9, $10, $11, $12::timestamptz)`,
      [
        id,
        env,
        db.dialect,
        filePath,
        checksum,
        byteSize,
        nowIso,
        `SHA-256 verified (${byteSize} bytes · ${flagRows.length} feature flags)`,
        actor.userId,
        actor.email,
        JSON.stringify({ featureFlagsCount: flagRows.length }),
        nowIso,
      ],
    );

    await recordBackupEvent({
      backupId: id,
      action: 'CREATE',
      status: 'SUCCESS',
      actor,
      detail: `Created verified configuration snapshot (${byteSize} bytes).`,
    });
    await writeAuditLog({
      actor,
      action: 'BACKUP_CREATE_CONFIG_SNAPSHOT',
      resourceType: 'backup_record',
      resourceId: id,
      newValue: { byteSize, checksumPrefix: checksum.slice(0, 12) },
    });

    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM backup_records WHERE id = ?',
      'SELECT * FROM backup_records WHERE id = $1',
      [id],
    );
    return { ok: true, status: 201, data: { backup: mapBackupRow(row!) } };
  }

  async function verifyBackup(
    actor: AdminActor,
    backupId: string,
  ): Promise<AdminOutcome<{ backup: BackupRecordDto }>> {
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM backup_records WHERE id = ?',
      'SELECT * FROM backup_records WHERE id = $1',
      [backupId],
    );
    if (!row) return { ok: false, status: 404, error: 'Backup record not found.' };

    if (String(row.backup_type) === 'FULL_DATABASE_UNAVAILABLE' || String(row.status) === 'NOT_CONFIGURED') {
      return {
        ok: false,
        status: 409,
        error: 'Physical PostgreSQL backup provider is not configured; nothing to verify.',
        code: 'BACKUP_PROVIDER_NOT_CONFIGURED',
      };
    }

    const filePath = row.file_path ? String(row.file_path) : '';
    const expectedChecksum = row.checksum_sha256 ? String(row.checksum_sha256) : '';
    const nowIso = new Date().toISOString();

    if (!filePath || !fs.existsSync(filePath)) {
      await db.execute(
        "UPDATE backup_records SET status = 'FAILED', failure_reason = 'Snapshot file missing on disk.' WHERE id = ?",
        "UPDATE backup_records SET status = 'FAILED', failure_reason = 'Snapshot file missing on disk.' WHERE id = $1",
        [backupId],
      );
      await recordBackupEvent({
        backupId,
        action: 'VERIFY',
        status: 'FAILED',
        actor,
        detail: 'Snapshot file missing on disk.',
      });
      return { ok: false, status: 404, error: 'Backup snapshot file missing on disk.' };
    }

    const buf = fs.readFileSync(filePath);
    const actualChecksum = crypto.createHash('sha256').update(buf).digest('hex');
    if (expectedChecksum && actualChecksum !== expectedChecksum) {
      await db.execute(
        "UPDATE backup_records SET status = 'FAILED', failure_reason = 'SHA-256 checksum mismatch.' WHERE id = ?",
        "UPDATE backup_records SET status = 'FAILED', failure_reason = 'SHA-256 checksum mismatch.' WHERE id = $1",
        [backupId],
      );
      await recordBackupEvent({
        backupId,
        action: 'VERIFY',
        status: 'FAILED',
        actor,
        detail: 'SHA-256 checksum mismatch detected.',
      });
      return { ok: false, status: 409, error: 'Backup SHA-256 checksum verification failed.' };
    }

    let extraDetail = 'Checksum verified';
    if (String(row.backup_type) === 'SQLITE_SNAPSHOT') {
      const verifyConn = new DatabaseSync(filePath, { readOnly: true });
      try {
        const res = verifyConn.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
        if (res?.integrity_check?.toLowerCase() !== 'ok') {
          await db.execute(
            "UPDATE backup_records SET status = 'FAILED', failure_reason = ? WHERE id = ?",
            "UPDATE backup_records SET status = 'FAILED', failure_reason = $1 WHERE id = $2",
            [`SQLite integrity check failed: ${res?.integrity_check}`, backupId],
          );
          return { ok: false, status: 409, error: 'SQLite integrity_check failed.' };
        }
        extraDetail = 'SHA-256 & PRAGMA integrity_check=ok verified';
      } finally {
        verifyConn.close();
      }
    } else {
      const parsed = safeJsonParse<Record<string, unknown>>(buf.toString('utf8'), {});
      if (!parsed.platformSettings) {
        return { ok: false, status: 409, error: 'Config snapshot JSON is missing platformSettings.' };
      }
      extraDetail = 'SHA-256 & config snapshot structure verified';
    }

    await db.execute(
      "UPDATE backup_records SET status = 'VERIFIED', verified_at = ?, verification_detail = ?, failure_reason = NULL WHERE id = ?",
      "UPDATE backup_records SET status = 'VERIFIED', verified_at = $1::timestamptz, verification_detail = $2, failure_reason = NULL WHERE id = $3",
      [nowIso, extraDetail, backupId],
    );
    await recordBackupEvent({
      backupId,
      action: 'VERIFY',
      status: 'SUCCESS',
      actor,
      detail: extraDetail,
    });
    await writeAuditLog({
      actor,
      action: 'BACKUP_VERIFY',
      resourceType: 'backup_record',
      resourceId: backupId,
      newValue: { detail: extraDetail },
    });

    const updated = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM backup_records WHERE id = ?',
      'SELECT * FROM backup_records WHERE id = $1',
      [backupId],
    );
    return { ok: true, status: 200, data: { backup: mapBackupRow(updated!) } };
  }

  async function restoreBackup(
    actor: AdminActor,
    backupId: string,
    confirmPhrase: unknown,
  ): Promise<AdminOutcome<{ restoredType: string; detail: string }>> {
    if (actor.role !== 'super_admin') {
      await writeAuditLog({
        actor,
        action: 'BACKUP_RESTORE_DENIED',
        resourceType: 'backup_record',
        resourceId: backupId,
        result: 'DENIED',
      });
      return {
        ok: false,
        status: 403,
        error: 'Only a Super Admin may initiate recovery/restore operations.',
        code: 'SUPER_ADMIN_REQUIRED',
      };
    }

    if (typeof confirmPhrase !== 'string' || confirmPhrase.trim() !== 'RESTORE BACKUP') {
      return {
        ok: false,
        status: 400,
        error: 'Explicit confirmation phrase "RESTORE BACKUP" is required.',
        code: 'CONFIRMATION_MISMATCH',
      };
    }

    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM backup_records WHERE id = ?',
      'SELECT * FROM backup_records WHERE id = $1',
      [backupId],
    );
    if (!row) return { ok: false, status: 404, error: 'Backup record not found.' };

    const bType = String(row.backup_type);
    const status = String(row.status);
    if (bType === 'FULL_DATABASE_UNAVAILABLE' || status === 'NOT_CONFIGURED') {
      await recordBackupEvent({
        backupId,
        action: 'RESTORE_ATTEMPT',
        status: 'NOT_CONFIGURED',
        actor,
        detail: 'Blocked restore attempt: physical DB provider not configured.',
      });
      return {
        ok: false,
        status: 409,
        error: 'Physical PostgreSQL restore is not configured in this environment. Use Supabase PITR recovery.',
        code: 'RESTORE_NOT_CONFIGURED',
      };
    }

    if (status !== 'VERIFIED' && status !== 'RESTORED') {
      return {
        ok: false,
        status: 409,
        error: 'Only VERIFIED backups can be restored. Run integrity verification first.',
        code: 'BACKUP_NOT_VERIFIED',
      };
    }

    const filePath = row.file_path ? String(row.file_path) : '';
    if (!filePath || !fs.existsSync(filePath)) {
      return { ok: false, status: 404, error: 'Backup snapshot file missing on disk.' };
    }

    const buf = fs.readFileSync(filePath);
    const actualChecksum = crypto.createHash('sha256').update(buf).digest('hex');
    if (row.checksum_sha256 && actualChecksum !== String(row.checksum_sha256)) {
      return { ok: false, status: 409, error: 'Checksum verification failed prior to restore.' };
    }

    if (bType === 'CONFIG_SNAPSHOT') {
      const snapshot = safeJsonParse<{
        platformSettings?: Partial<PlatformConfigBundle>;
        featureFlags?: Array<Partial<FeatureFlagDto>>;
      }>(buf.toString('utf8'), {});
      if (!snapshot.platformSettings) {
        return { ok: false, status: 400, error: 'Invalid configuration snapshot payload.' };
      }

      for (const [k, val] of Object.entries(snapshot.platformSettings)) {
        if (val && typeof val === 'object') {
          await runtimeConfigManager.updateSetting(
            k as keyof PlatformConfigBundle,
            val as PlatformConfigBundle[keyof PlatformConfigBundle],
            actor.userId,
            `Restored from CONFIG_SNAPSHOT ${backupId.slice(0, 8)}`,
          );
        }
      }

      await db.execute(
        "UPDATE backup_records SET status = 'RESTORED' WHERE id = ?",
        "UPDATE backup_records SET status = 'RESTORED' WHERE id = $1",
        [backupId],
      );
      await recordBackupEvent({
        backupId,
        action: 'RESTORE_COMPLETED',
        status: 'SUCCESS',
        actor,
        detail: `Restored platform settings from configuration snapshot ${backupId.slice(0, 8)}.`,
      });
      await writeAuditLog({
        actor,
        action: 'BACKUP_RESTORE_CONFIG',
        resourceType: 'backup_record',
        resourceId: backupId,
        newValue: { environment: getRuntimeEnvironment(), dialect: db.dialect },
      });
      return {
        ok: true,
        status: 200,
        data: {
          restoredType: 'CONFIG_SNAPSHOT',
          detail: `Configuration settings restored cleanly from snapshot ${backupId.slice(0, 8)}.`,
        },
      };
    }

    // SQLITE_SNAPSHOT live recovery for file-backed SQLite
    if (db.dialect !== 'sqlite' || !db.sqliteDb || db.dbPath === ':memory:') {
      return {
        ok: false,
        status: 409,
        error: 'SQLite file restore cannot target a non-file database.',
      };
    }

    // Attach snapshot DB and restore key application tables transactionally without dropping active handle
    const escaped = filePath.replace(/'/g, "''");
    const preSafetyPath = path.join(backupDir, `pre-restore-safety-${Date.now()}.sqlite`);
    db.sqliteDb.exec(`VACUUM INTO '${preSafetyPath.replace(/'/g, "''")}'`);
    db.sqliteDb.exec(`ATTACH DATABASE '${escaped}' AS restore_src`);
    try {
      db.sqliteDb.exec('BEGIN IMMEDIATE');
      db.sqliteDb.exec('DELETE FROM platform_settings');
      db.sqliteDb.exec('INSERT INTO platform_settings SELECT * FROM restore_src.platform_settings');
      db.sqliteDb.exec('DELETE FROM feature_flags');
      db.sqliteDb.exec('INSERT INTO feature_flags SELECT * FROM restore_src.feature_flags');
      db.sqliteDb.exec('COMMIT');
    } catch (err) {
      db.sqliteDb.exec('ROLLBACK');
      db.sqliteDb.exec('DETACH DATABASE restore_src');
      throw err;
    }
    db.sqliteDb.exec('DETACH DATABASE restore_src');
    runtimeConfigManager.invalidateCache();

    await db.execute(
      "UPDATE backup_records SET status = 'RESTORED' WHERE id = ?",
      "UPDATE backup_records SET status = 'RESTORED' WHERE id = $1",
      [backupId],
    );
    await recordBackupEvent({
      backupId,
      action: 'RESTORE_COMPLETED',
      status: 'SUCCESS',
      actor,
      detail: `Restored SQLite runtime tables from verified snapshot (pre-restore safety saved).`,
    });
    await writeAuditLog({
      actor,
      action: 'BACKUP_RESTORE_SQLITE',
      resourceType: 'backup_record',
      resourceId: backupId,
      newValue: { preSafetyBackup: path.basename(preSafetyPath) },
    });

    return {
      ok: true,
      status: 200,
      data: {
        restoredType: 'SQLITE_SNAPSHOT',
        detail: `Verified SQLite snapshot restored cleanly (pre-restore safety snapshot saved as ${path.basename(preSafetyPath)}).`,
      },
    };
  }

  // ---- 4. FEATURE FLAGS & CONTROLLED ROLLOUTS ----

  function mapFeatureFlagRow(r: Record<string, unknown>): FeatureFlagDto {
    const rawRoles = safeJsonParse<unknown[]>(r.target_roles_json, []);
    const targetRoles = rawRoles.filter((x): x is UserRole => VALID_ROLES_SET.has(x as UserRole));
    return {
      id: String(r.id),
      flagKey: String(r.flag_key),
      name: String(r.name),
      description: String(r.description ?? ''),
      enabled: toBoolField(r.enabled),
      environmentScope: (String(r.environment_scope || 'all') as FeatureEnvScope),
      rolloutPercentage: Number(r.rollout_percentage ?? 100),
      targetRoles,
      isKillSwitch: toBoolField(r.is_kill_switch),
      clientExposed: toBoolField(r.client_exposed),
      startsAt: r.starts_at ? toIso(r.starts_at) : null,
      endsAt: r.ends_at ? toIso(r.ends_at) : null,
      updatedBy: r.updated_by ? String(r.updated_by) : null,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    };
  }

  async function ensureSeededFlags() {
    const existing = await db.queryOne<{ cnt: number | string }>(
      'SELECT COUNT(*) AS cnt FROM feature_flags',
      'SELECT COUNT(*) AS cnt FROM feature_flags',
    );
    if (Number(existing?.cnt ?? 0) > 0) return;

    const nowIso = new Date().toISOString();
    const seeds: Array<{
      flagKey: string;
      name: string;
      description: string;
      enabled: boolean;
      rolloutPercentage: number;
      targetRoles: UserRole[];
      isKillSwitch: boolean;
      clientExposed: boolean;
    }> = [
      {
        flagKey: 'ai.explainable_briefs',
        name: 'Explainable AI Research Briefs',
        description: 'Controls structured driver/risk breakdown synthesis across workspace and public research.',
        enabled: true,
        rolloutPercentage: 100,
        targetRoles: [],
        isKillSwitch: true,
        clientExposed: true,
      },
      {
        flagKey: 'trading.paper_execution',
        name: 'Simulated Paper Order Execution',
        description: 'Controls zero-risk simulated paper trading order placement across user portfolios.',
        enabled: true,
        rolloutPercentage: 100,
        targetRoles: [],
        isKillSwitch: true,
        clientExposed: true,
      },
      {
        flagKey: 'workspace.risk_dispersion_preview',
        name: 'Portfolio Risk Dispersion Matrix',
        description: 'Gradual rollout of enhanced portfolio concentration and drawdown comparison widgets.',
        enabled: true,
        rolloutPercentage: 100,
        targetRoles: [],
        isKillSwitch: false,
        clientExposed: true,
      },
      {
        flagKey: 'ops.strict_audit_export_watermark',
        name: 'Internal Governance Export Checksums',
        description: 'Internal administrative flag attaching verification metadata headers to governance reports.',
        enabled: true,
        rolloutPercentage: 100,
        targetRoles: ['admin', 'super_admin', 'security_admin'],
        isKillSwitch: false,
        clientExposed: false,
      },
    ];

    for (const s of seeds) {
      await db.execute(
        `INSERT INTO feature_flags (id, flag_key, name, description, enabled, environment_scope, rollout_percentage, target_roles_json, is_kill_switch, client_exposed, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'all', ?, ?, ?, ?, NULL, ?, ?)`,
        `INSERT INTO feature_flags (id, flag_key, name, description, enabled, environment_scope, rollout_percentage, target_roles_json, is_kill_switch, client_exposed, updated_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'all', $6, $7, $8, $9, NULL, $10::timestamptz, $11::timestamptz)
         ON CONFLICT (flag_key) DO NOTHING`,
        [
          crypto.randomUUID(),
          s.flagKey,
          s.name,
          s.description,
          boolVal(s.enabled),
          s.rolloutPercentage,
          JSON.stringify(s.targetRoles),
          boolVal(s.isKillSwitch),
          boolVal(s.clientExposed),
          nowIso,
          nowIso,
        ],
      );
    }
  }

  async function listFeatureFlagsOverview() {
    await ensureSeededFlags();
    const [flagRows, historyRows] = await Promise.all([
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM feature_flags ORDER BY flag_key ASC',
        'SELECT * FROM feature_flags ORDER BY flag_key ASC',
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM feature_flag_history ORDER BY created_at DESC LIMIT 60',
        'SELECT * FROM feature_flag_history ORDER BY created_at DESC LIMIT 60',
      ),
    ]);

    return {
      environment: getRuntimeEnvironment(),
      flags: flagRows.map(mapFeatureFlagRow),
      history: historyRows.map((h) => ({
        id: String(h.id),
        flagId: String(h.flag_id),
        flagKey: String(h.flag_key),
        previousSnapshot: safeJsonParse<Record<string, unknown> | null>(h.previous_snapshot_json, null),
        newSnapshot: safeJsonParse<Record<string, unknown>>(h.new_snapshot_json, {}),
        actorId: h.actor_id ? String(h.actor_id) : null,
        actorEmail: String(h.actor_email),
        reason: String(h.reason ?? ''),
        createdAt: toIso(h.created_at),
      })),
    };
  }

  async function createFeatureFlag(
    actor: AdminActor,
    input: {
      flagKey: unknown;
      name: unknown;
      description?: unknown;
      enabled?: unknown;
      environmentScope?: unknown;
      rolloutPercentage?: unknown;
      targetRoles?: unknown;
      isKillSwitch?: unknown;
      clientExposed?: unknown;
      startsAt?: unknown;
      endsAt?: unknown;
      reason?: unknown;
    },
  ): Promise<AdminOutcome<{ flag: FeatureFlagDto }>> {
    await ensureSeededFlags();
    const rawKey = typeof input.flagKey === 'string' ? input.flagKey.trim().toLowerCase() : '';
    if (!isValidFlagKey(rawKey)) {
      return {
        ok: false,
        status: 400,
        error: 'flagKey must be 3–64 lowercase chars (letters, digits, dot, underscore, hyphen).',
      };
    }
    const name = stripControlChars(typeof input.name === 'string' ? input.name : '', 120);
    if (name.length < 3) {
      return { ok: false, status: 400, error: 'Feature flag name must be at least 3 characters.' };
    }
    const existing = await db.queryOne<{ id: string }>(
      'SELECT id FROM feature_flags WHERE flag_key = ?',
      'SELECT id FROM feature_flags WHERE flag_key = $1',
      [rawKey],
    );
    if (existing) {
      return { ok: false, status: 409, error: `Feature flag "${rawKey}" already exists.`, code: 'DUPLICATE_FLAG_KEY' };
    }

    const rollout =
      input.rolloutPercentage !== undefined ? Number(input.rolloutPercentage) : 100;
    if (!Number.isInteger(rollout) || rollout < 0 || rollout > 100) {
      return { ok: false, status: 400, error: 'rolloutPercentage must be an integer between 0 and 100.' };
    }

    const envScope: FeatureEnvScope =
      input.environmentScope === 'production' ||
      input.environmentScope === 'development' ||
      input.environmentScope === 'staging'
        ? input.environmentScope
        : 'all';

    const targetRoles = Array.isArray(input.targetRoles)
      ? Array.from(new Set(input.targetRoles.filter((r): r is UserRole => VALID_ROLES_SET.has(r as UserRole))))
      : [];

    const startsAt =
      typeof input.startsAt === 'string' && input.startsAt.trim() && Number.isFinite(Date.parse(input.startsAt))
        ? new Date(input.startsAt).toISOString()
        : null;
    const endsAt =
      typeof input.endsAt === 'string' && input.endsAt.trim() && Number.isFinite(Date.parse(input.endsAt))
        ? new Date(input.endsAt).toISOString()
        : null;
    if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) {
      return { ok: false, status: 400, error: 'Schedule endsAt must be after startsAt.' };
    }

    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const description = stripControlChars(typeof input.description === 'string' ? input.description : '', 400);
    const enabled = Boolean(input.enabled);
    const isKillSwitch = Boolean(input.isKillSwitch);
    const clientExposed = Boolean(input.clientExposed);

    await db.execute(
      `INSERT INTO feature_flags (id, flag_key, name, description, enabled, environment_scope, rollout_percentage, target_roles_json, is_kill_switch, client_exposed, starts_at, ends_at, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `INSERT INTO feature_flags (id, flag_key, name, description, enabled, environment_scope, rollout_percentage, target_roles_json, is_kill_switch, client_exposed, starts_at, ends_at, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12::timestamptz, $13, $14::timestamptz, $15::timestamptz)`,
      [
        id,
        rawKey,
        name,
        description,
        boolVal(enabled),
        envScope,
        rollout,
        JSON.stringify(targetRoles),
        boolVal(isKillSwitch),
        boolVal(clientExposed),
        startsAt,
        endsAt,
        actor.userId,
        nowIso,
        nowIso,
      ],
    );

    const createdRow = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM feature_flags WHERE id = ?',
      'SELECT * FROM feature_flags WHERE id = $1',
      [id],
    );
    const createdDto = mapFeatureFlagRow(createdRow!);

    await db.execute(
      `INSERT INTO feature_flag_history (id, flag_id, flag_key, previous_snapshot_json, new_snapshot_json, actor_id, actor_email, reason, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      `INSERT INTO feature_flag_history (id, flag_id, flag_key, previous_snapshot_json, new_snapshot_json, actor_id, actor_email, reason, created_at)
       VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8::timestamptz)`,
      [
        crypto.randomUUID(),
        id,
        rawKey,
        JSON.stringify(createdDto),
        actor.userId,
        actor.email,
        stripControlChars(typeof input.reason === 'string' ? input.reason : '', 240) || 'Created feature flag',
        nowIso,
      ],
    );

    await writeAuditLog({
      actor,
      action: 'FEATURE_FLAG_CREATE',
      resourceType: 'feature_flag',
      resourceId: rawKey,
      newValue: { enabled, rolloutPercentage: rollout, envScope, clientExposed, isKillSwitch },
    });

    return { ok: true, status: 201, data: { flag: createdDto } };
  }

  async function updateFeatureFlag(
    actor: AdminActor,
    flagId: string,
    patch: {
      name?: unknown;
      description?: unknown;
      enabled?: unknown;
      environmentScope?: unknown;
      rolloutPercentage?: unknown;
      targetRoles?: unknown;
      isKillSwitch?: unknown;
      clientExposed?: unknown;
      startsAt?: unknown;
      endsAt?: unknown;
      reason?: unknown;
    },
  ): Promise<AdminOutcome<{ flag: FeatureFlagDto }>> {
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM feature_flags WHERE id = ?',
      'SELECT * FROM feature_flags WHERE id = $1',
      [flagId],
    );
    if (!row) return { ok: false, status: 404, error: 'Feature flag not found.' };
    const prevDto = mapFeatureFlagRow(row);

    const name =
      typeof patch.name === 'string' && patch.name.trim().length >= 3
        ? stripControlChars(patch.name, 120)
        : prevDto.name;
    const description =
      typeof patch.description === 'string'
        ? stripControlChars(patch.description, 400)
        : prevDto.description;
    const enabled = typeof patch.enabled === 'boolean' ? patch.enabled : prevDto.enabled;
    const envScope: FeatureEnvScope =
      patch.environmentScope === 'all' ||
      patch.environmentScope === 'production' ||
      patch.environmentScope === 'development' ||
      patch.environmentScope === 'staging'
        ? patch.environmentScope
        : prevDto.environmentScope;
    const rollout =
      patch.rolloutPercentage !== undefined
        ? Number(patch.rolloutPercentage)
        : prevDto.rolloutPercentage;
    if (!Number.isInteger(rollout) || rollout < 0 || rollout > 100) {
      return { ok: false, status: 400, error: 'rolloutPercentage must be an integer between 0 and 100.' };
    }
    const targetRoles = Array.isArray(patch.targetRoles)
      ? Array.from(new Set(patch.targetRoles.filter((r): r is UserRole => VALID_ROLES_SET.has(r as UserRole))))
      : prevDto.targetRoles;
    const isKillSwitch =
      typeof patch.isKillSwitch === 'boolean' ? patch.isKillSwitch : prevDto.isKillSwitch;
    const clientExposed =
      typeof patch.clientExposed === 'boolean' ? patch.clientExposed : prevDto.clientExposed;

    const startsAt =
      patch.startsAt === null
        ? null
        : typeof patch.startsAt === 'string' && patch.startsAt.trim()
          ? new Date(patch.startsAt).toISOString()
          : prevDto.startsAt;
    const endsAt =
      patch.endsAt === null
        ? null
        : typeof patch.endsAt === 'string' && patch.endsAt.trim()
          ? new Date(patch.endsAt).toISOString()
          : prevDto.endsAt;
    if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) {
      return { ok: false, status: 400, error: 'Schedule endsAt must be after startsAt.' };
    }

    const nowIso = new Date().toISOString();
    await db.execute(
      `UPDATE feature_flags
       SET name = ?, description = ?, enabled = ?, environment_scope = ?, rollout_percentage = ?, target_roles_json = ?, is_kill_switch = ?, client_exposed = ?, starts_at = ?, ends_at = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
      `UPDATE feature_flags
       SET name = $1, description = $2, enabled = $3, environment_scope = $4, rollout_percentage = $5, target_roles_json = $6, is_kill_switch = $7, client_exposed = $8, starts_at = $9::timestamptz, ends_at = $10::timestamptz, updated_by = $11, updated_at = $12::timestamptz
       WHERE id = $13`,
      [
        name,
        description,
        boolVal(enabled),
        envScope,
        rollout,
        JSON.stringify(targetRoles),
        boolVal(isKillSwitch),
        boolVal(clientExposed),
        startsAt,
        endsAt,
        actor.userId,
        nowIso,
        flagId,
      ],
    );

    const updatedRow = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM feature_flags WHERE id = ?',
      'SELECT * FROM feature_flags WHERE id = $1',
      [flagId],
    );
    const nextDto = mapFeatureFlagRow(updatedRow!);
    const cleanReason =
      stripControlChars(typeof patch.reason === 'string' ? patch.reason : '', 240) ||
      'Feature flag configuration updated';

    await db.execute(
      `INSERT INTO feature_flag_history (id, flag_id, flag_key, previous_snapshot_json, new_snapshot_json, actor_id, actor_email, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `INSERT INTO feature_flag_history (id, flag_id, flag_key, previous_snapshot_json, new_snapshot_json, actor_id, actor_email, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)`,
      [
        crypto.randomUUID(),
        flagId,
        nextDto.flagKey,
        JSON.stringify(prevDto),
        JSON.stringify(nextDto),
        actor.userId,
        actor.email,
        cleanReason,
        nowIso,
      ],
    );

    await writeAuditLog({
      actor,
      action: 'FEATURE_FLAG_UPDATE',
      resourceType: 'feature_flag',
      resourceId: nextDto.flagKey,
      previousValue: { enabled: prevDto.enabled, rolloutPercentage: prevDto.rolloutPercentage },
      newValue: { enabled: nextDto.enabled, rolloutPercentage: nextDto.rolloutPercentage, reason: cleanReason },
    });

    return { ok: true, status: 200, data: { flag: nextDto } };
  }

  async function rollbackFeatureFlag(
    actor: AdminActor,
    historyId: string,
  ): Promise<AdminOutcome<{ flag: FeatureFlagDto }>> {
    const histRow = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM feature_flag_history WHERE id = ?',
      'SELECT * FROM feature_flag_history WHERE id = $1',
      [historyId],
    );
    if (!histRow || !histRow.previous_snapshot_json) {
      return { ok: false, status: 404, error: 'Rollback target snapshot not found for this history entry.' };
    }
    const prevSnap = safeJsonParse<Partial<FeatureFlagDto>>(histRow.previous_snapshot_json, {});
    return updateFeatureFlag(actor, String(histRow.flag_id), {
      ...prevSnap,
      reason: `Rollback to history entry ${historyId.slice(0, 8)}`,
    });
  }

  async function evaluateClientFeatureFlags(context: {
    userId?: string | null;
    userRole?: UserRole | null;
  }) {
    await ensureSeededFlags();
    const flagRows = await db.queryAll<Record<string, unknown>>(
      'SELECT * FROM feature_flags WHERE client_exposed = ? ORDER BY flag_key ASC',
      'SELECT * FROM feature_flags WHERE client_exposed = $1 ORDER BY flag_key ASC',
      [boolVal(true)],
    );
    const env = getRuntimeEnvironment();
    const flags: Record<string, { enabled: boolean; reason: string }> = {};
    for (const r of flagRows) {
      const dto = mapFeatureFlagRow(r);
      const res = evaluateFeatureFlag(dto, {
        environment: env,
        userId: context.userId,
        userRole: context.userRole,
      });
      flags[dto.flagKey] = { enabled: res.active, reason: res.reason };
    }
    return { environment: env, flags };
  }

  // ---- 5. RELEASE & MAINTENANCE MANAGEMENT ----

  function getPackageMetadata() {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
      ) as { name?: string; version?: string };
      return {
        appName: pkg.name ?? 'nextrade-ai',
        version: pkg.version ?? '1.0.0',
      };
    } catch {
      return { appName: 'nextrade-ai', version: '1.0.0' };
    }
  }

  function mapMaintenanceWindow(r: Record<string, unknown>): MaintenanceWindowDto {
    const rawBypass = safeJsonParse<unknown[]>(r.bypass_roles_json, ['super_admin', 'admin']);
    const bypassRoles = Array.from(
      new Set<UserRole>([
        'super_admin',
        ...rawBypass.filter((x): x is UserRole => VALID_ROLES_SET.has(x as UserRole)),
      ]),
    );
    return {
      id: String(r.id),
      title: String(r.title),
      message: String(r.message),
      status: String(r.status) as MaintenanceWindowStatus,
      startsAt: toIso(r.starts_at),
      endsAt: r.ends_at ? toIso(r.ends_at) : null,
      expectedCompletionNote: String(r.expected_completion_note ?? ''),
      bypassRoles,
      createdBy: r.created_by ? String(r.created_by) : null,
      createdByEmail: String(r.created_by_email ?? 'system'),
      activatedAt: r.activated_at ? toIso(r.activated_at) : null,
      endedAt: r.ended_at ? toIso(r.ended_at) : null,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    };
  }

  async function ensureBaselineReleaseSeeded() {
    const pkg = getPackageMetadata();
    const countRow = await db.queryOne<{ cnt: number | string }>(
      'SELECT COUNT(*) AS cnt FROM release_records',
      'SELECT COUNT(*) AS cnt FROM release_records',
    );
    if (Number(countRow?.cnt ?? 0) > 0) return;

    const nowIso = new Date().toISOString();
    await db.execute(
      `INSERT INTO release_records (id, version, release_type, environment, status, summary, commit_ref, notes, deployed_by, deployed_by_email, deployed_at, created_at)
       VALUES (?, ?, 'RUNTIME_BASELINE', ?, 'ACTIVE', ?, ?, ?, NULL, 'system', ?, ?)`,
      `INSERT INTO release_records (id, version, release_type, environment, status, summary, commit_ref, notes, deployed_by, deployed_by_email, deployed_at, created_at)
       VALUES ($1, $2, 'RUNTIME_BASELINE', $3, 'ACTIVE', $4, $5, $6, NULL, 'system', $7::timestamptz, $8::timestamptz)`,
      [
        crypto.randomUUID(),
        `v${pkg.version}`,
        getRuntimeEnvironment(),
        'Initial runtime baseline inspected from package.json (no automated CI/CD webhook configured).',
        (process.env.GIT_COMMIT_SHA || '').slice(0, 64),
        'Phase 5 governance, lifecycle, privacy, and recovery management online.',
        nowIso,
        nowIso,
      ],
    );
  }

  async function getEffectiveMaintenanceStatus(userRole?: UserRole | null) {
    const cfg = await runtimeConfigManager.getConfig();
    const rows = await db.queryAll<Record<string, unknown>>(
      "SELECT * FROM maintenance_windows WHERE status IN ('SCHEDULED', 'ACTIVE') ORDER BY starts_at DESC LIMIT 20",
      "SELECT * FROM maintenance_windows WHERE status IN ('SCHEDULED', 'ACTIVE') ORDER BY starts_at DESC LIMIT 20",
    );
    const windows = rows.map(mapMaintenanceWindow);
    const state = evaluateMaintenanceState({
      manualConfig: cfg.maintenance_mode,
      windows,
      userRole,
    });
    return {
      active: state.inMaintenance,
      bypassed: state.bypassAllowed,
      source:
        state.source === 'MANUAL_FLAG'
          ? ('manual' as const)
          : state.source === 'SCHEDULED_WINDOW'
            ? ('window' as const)
            : ('none' as const),
      message: state.message,
      expectedCompletionNote: state.expectedCompletionNote,
      endsAt: state.endsAt,
      windowId: state.activeWindowId,
    };
  }

  async function getReleasesAndMaintenanceOverview() {
    await ensureBaselineReleaseSeeded();
    const pkg = getPackageMetadata();
    const [releases, windows, effective] = await Promise.all([
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM release_records ORDER BY deployed_at DESC LIMIT 40',
        'SELECT * FROM release_records ORDER BY deployed_at DESC LIMIT 40',
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM maintenance_windows ORDER BY created_at DESC LIMIT 40',
        'SELECT * FROM maintenance_windows ORDER BY created_at DESC LIMIT 40',
      ),
      getEffectiveMaintenanceStatus('super_admin'),
    ]);

    return {
      runtimeMetadata: {
        appName: pkg.appName,
        version: pkg.version,
        nodeVersion: process.version,
        environment: getRuntimeEnvironment(),
        dialect: db.dialect,
        latestMigration: '0005_phase5_governance',
        ciCdWebhookConfigured: false,
        ciCdNote: 'No external CI/CD deploy webhook is configured; release records represent runtime baseline metadata and manual admin releases.',
      },
      effectiveMaintenance: effective,
      releases: releases.map(
        (r): ReleaseRecordDto => ({
          id: String(r.id),
          version: String(r.version),
          releaseType: String(r.release_type) as ReleaseRecordDto['releaseType'],
          environment: String(r.environment),
          status: String(r.status) as ReleaseRecordDto['status'],
          summary: String(r.summary),
          commitRef: String(r.commit_ref ?? ''),
          notes: String(r.notes ?? ''),
          deployedBy: r.deployed_by ? String(r.deployed_by) : null,
          deployedByEmail: String(r.deployed_by_email ?? 'system'),
          deployedAt: toIso(r.deployed_at),
          createdAt: toIso(r.created_at),
        }),
      ),
      maintenanceWindows: windows.map(mapMaintenanceWindow),
    };
  }

  async function createManualRelease(
    actor: AdminActor,
    input: { version: unknown; summary: unknown; commitRef?: unknown; notes?: unknown },
  ): Promise<AdminOutcome<{ release: ReleaseRecordDto }>> {
    const version = stripControlChars(typeof input.version === 'string' ? input.version : '', 48);
    const summary = stripControlChars(typeof input.summary === 'string' ? input.summary : '', 400);
    if (version.length < 2 || summary.length < 5) {
      return { ok: false, status: 400, error: 'Version (>=2 chars) and summary (>=5 chars) are required.' };
    }
    const commitRef = stripControlChars(typeof input.commitRef === 'string' ? input.commitRef : '', 80);
    const notes = stripControlChars(typeof input.notes === 'string' ? input.notes : '', 1000, {
      allowNewlines: true,
    });
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const env = getRuntimeEnvironment();

    await db.withTransaction(async (tx) => {
      await tx.execute(
        "UPDATE release_records SET status = 'SUPERSEDED' WHERE status = 'ACTIVE'",
        "UPDATE release_records SET status = 'SUPERSEDED' WHERE status = 'ACTIVE'",
      );
      await tx.execute(
        `INSERT INTO release_records (id, version, release_type, environment, status, summary, commit_ref, notes, deployed_by, deployed_by_email, deployed_at, created_at)
         VALUES (?, ?, 'MANUAL', ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?)`,
        `INSERT INTO release_records (id, version, release_type, environment, status, summary, commit_ref, notes, deployed_by, deployed_by_email, deployed_at, created_at)
         VALUES ($1, $2, 'MANUAL', $3, 'ACTIVE', $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz)`,
        [id, version, env, summary, commitRef, notes, actor.userId, actor.email, nowIso, nowIso],
      );
    });

    await writeAuditLog({
      actor,
      action: 'RELEASE_RECORD_CREATE',
      resourceType: 'release_record',
      resourceId: id,
      newValue: { version, environment: env, summary },
    });

    return {
      ok: true,
      status: 201,
      data: {
        release: {
          id,
          version,
          releaseType: 'MANUAL',
          environment: env,
          status: 'ACTIVE',
          summary,
          commitRef,
          notes,
          deployedBy: actor.userId,
          deployedByEmail: actor.email,
          deployedAt: nowIso,
          createdAt: nowIso,
        },
      },
    };
  }

  async function createMaintenanceWindow(
    actor: AdminActor,
    input: {
      title: unknown;
      message: unknown;
      startsAt?: unknown;
      endsAt?: unknown;
      expectedCompletionNote?: unknown;
      bypassRoles?: unknown;
      activateImmediately?: unknown;
    },
  ): Promise<AdminOutcome<{ window: MaintenanceWindowDto }>> {
    const title = stripControlChars(typeof input.title === 'string' ? input.title : '', 140);
    const message = stripControlChars(typeof input.message === 'string' ? input.message : '', 600);
    if (title.length < 3 || message.length < 5) {
      return { ok: false, status: 400, error: 'Title and maintenance announcement message are required.' };
    }

    const nowIso = new Date().toISOString();
    const startsAt =
      typeof input.startsAt === 'string' && input.startsAt.trim() && Number.isFinite(Date.parse(input.startsAt))
        ? new Date(input.startsAt).toISOString()
        : nowIso;
    const endsAt =
      typeof input.endsAt === 'string' && input.endsAt.trim() && Number.isFinite(Date.parse(input.endsAt))
        ? new Date(input.endsAt).toISOString()
        : null;
    if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
      return { ok: false, status: 400, error: 'Maintenance window endsAt must be after startsAt.' };
    }

    const rawBypass = Array.isArray(input.bypassRoles) ? input.bypassRoles : ['super_admin', 'admin'];
    const bypassRoles = Array.from(
      new Set<UserRole>([
        'super_admin',
        ...rawBypass.filter((r): r is UserRole => VALID_ROLES_SET.has(r as UserRole)),
      ]),
    );
    const expectedCompletionNote = stripControlChars(
      typeof input.expectedCompletionNote === 'string' ? input.expectedCompletionNote : '',
      240,
    );
    const activeNow = Boolean(input.activateImmediately);
    const status: MaintenanceWindowStatus = activeNow ? 'ACTIVE' : 'SCHEDULED';
    const id = crypto.randomUUID();

    await db.execute(
      `INSERT INTO maintenance_windows (id, title, message, status, starts_at, ends_at, expected_completion_note, bypass_roles_json, created_by, created_by_email, activated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `INSERT INTO maintenance_windows (id, title, message, status, starts_at, ends_at, expected_completion_note, bypass_roles_json, created_by, created_by_email, activated_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8, $9, $10, $11::timestamptz, $12::timestamptz, $13::timestamptz)`,
      [
        id,
        title,
        message,
        status,
        startsAt,
        endsAt,
        expectedCompletionNote,
        JSON.stringify(bypassRoles),
        actor.userId,
        actor.email,
        activeNow ? nowIso : null,
        nowIso,
        nowIso,
      ],
    );

    await writeAuditLog({
      actor,
      action: 'MAINTENANCE_WINDOW_CREATE',
      resourceType: 'maintenance_window',
      resourceId: id,
      newValue: { title, status, startsAt, endsAt, bypassRoles },
    });

    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM maintenance_windows WHERE id = ?',
      'SELECT * FROM maintenance_windows WHERE id = $1',
      [id],
    );
    return { ok: true, status: 201, data: { window: mapMaintenanceWindow(row!) } };
  }

  async function updateMaintenanceWindow(
    actor: AdminActor,
    windowId: string,
    action: 'ACTIVATE' | 'COMPLETE' | 'CANCEL',
  ): Promise<AdminOutcome<{ window: MaintenanceWindowDto }>> {
    const existing = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM maintenance_windows WHERE id = ?',
      'SELECT * FROM maintenance_windows WHERE id = $1',
      [windowId],
    );
    if (!existing) return { ok: false, status: 404, error: 'Maintenance window not found.' };

    const nowIso = new Date().toISOString();
    const nextStatus: MaintenanceWindowStatus =
      action === 'ACTIVATE' ? 'ACTIVE' : action === 'COMPLETE' ? 'COMPLETED' : 'CANCELLED';

    await db.execute(
      `UPDATE maintenance_windows
       SET status = ?, activated_at = CASE WHEN ? = 'ACTIVE' THEN COALESCE(activated_at, ?) ELSE activated_at END,
           ended_at = CASE WHEN ? IN ('COMPLETED', 'CANCELLED') THEN ? ELSE NULL END, updated_at = ?
       WHERE id = ?`,
      `UPDATE maintenance_windows
       SET status = $1, activated_at = CASE WHEN $2 = 'ACTIVE' THEN COALESCE(activated_at, $3::timestamptz) ELSE activated_at END,
           ended_at = CASE WHEN $4 IN ('COMPLETED', 'CANCELLED') THEN $5::timestamptz ELSE NULL END, updated_at = $6::timestamptz
       WHERE id = $7`,
      [nextStatus, nextStatus, nowIso, nextStatus, nowIso, nowIso, windowId],
    );

    await writeAuditLog({
      actor,
      action: `MAINTENANCE_WINDOW_${action}`,
      resourceType: 'maintenance_window',
      resourceId: windowId,
      previousValue: { status: existing.status },
      newValue: { status: nextStatus },
    });

    const updated = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM maintenance_windows WHERE id = ?',
      'SELECT * FROM maintenance_windows WHERE id = $1',
      [windowId],
    );
    return { ok: true, status: 200, data: { window: mapMaintenanceWindow(updated!) } };
  }

  // ---- 6. PLATFORM CONFIGURATION GOVERNANCE (10 CATEGORIES) ----

  async function getTenCategoryGovernanceConfig() {
    const cfg = await runtimeConfigManager.getConfig();
    const caps = getBackupCapabilities();
    const geminiConfigured = Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY',
    );
    const items = buildTenCategoryConfigInventory({
      config: cfg,
      envStatus: {
        geminiConfigured,
        emailConfigured: emailSender.isConfigured(),
        databaseDialect: db.dialect,
        backupProviderConfigured: Boolean(caps.fullDatabaseBackupSupported),
      },
    });
    return {
      categories: [
        'Platform',
        'Authentication',
        'Security',
        'AI',
        'Market Data',
        'API',
        'Background Jobs',
        'Maintenance',
        'Privacy',
        'Notifications',
      ] as const,
      entries: items,
      governancePolicies: cfg.governance_policies,
    };
  }

  async function updateGovernancePolicies(
    actor: AdminActor,
    patch: Record<string, unknown>,
    reason = 'Governance policy update',
  ): Promise<AdminOutcome<{ governancePolicies: PlatformConfigBundle['governance_policies'] }>> {
    const current = await runtimeConfigManager.getConfig();
    const next = { ...current.governance_policies };

    if (typeof patch.platformDisplayName === 'string' && patch.platformDisplayName.trim().length >= 2) {
      next.platformDisplayName = stripControlChars(patch.platformDisplayName, 80);
    }
    if (typeof patch.environmentLabel === 'string' && patch.environmentLabel.trim().length >= 2) {
      next.environmentLabel = stripControlChars(patch.environmentLabel, 32);
    }
    if (typeof patch.requireEmailVerificationForLogin === 'boolean') {
      next.requireEmailVerificationForLogin = patch.requireEmailVerificationForLogin;
    }
    if (patch.sessionTtlHours !== undefined) {
      const n = Number(patch.sessionTtlHours);
      if (!Number.isInteger(n) || n < 1 || n > 168) {
        return { ok: false, status: 400, error: 'sessionTtlHours must be an integer between 1 and 168.' };
      }
      next.sessionTtlHours = n;
    }
    if (patch.rememberMeDays !== undefined) {
      const n = Number(patch.rememberMeDays);
      if (!Number.isInteger(n) || n < 1 || n > 90) {
        return { ok: false, status: 400, error: 'rememberMeDays must be an integer between 1 and 90.' };
      }
      next.rememberMeDays = n;
    }
    if (patch.exportLinkExpiryHours !== undefined) {
      const n = Number(patch.exportLinkExpiryHours);
      if (!Number.isInteger(n) || n < 1 || n > 168) {
        return { ok: false, status: 400, error: 'exportLinkExpiryHours must be an integer between 1 and 168.' };
      }
      next.exportLinkExpiryHours = n;
    }
    if (patch.deletionGracePeriodDays !== undefined) {
      const n = Number(patch.deletionGracePeriodDays);
      if (!Number.isInteger(n) || n < 1 || n > 90) {
        return { ok: false, status: 400, error: 'deletionGracePeriodDays must be an integer between 1 and 90.' };
      }
      next.deletionGracePeriodDays = n;
    }
    if (patch.telemetryRetentionDays !== undefined) {
      const n = Number(patch.telemetryRetentionDays);
      if (!Number.isInteger(n) || n < 7 || n > 365) {
        return { ok: false, status: 400, error: 'telemetryRetentionDays must be an integer between 7 and 365.' };
      }
      next.telemetryRetentionDays = n;
    }
    if (patch.auditRetentionDays !== undefined) {
      const n = Number(patch.auditRetentionDays);
      if (!Number.isInteger(n) || n < 30 || n > 3650) {
        return { ok: false, status: 400, error: 'auditRetentionDays must be an integer between 30 and 3650.' };
      }
      next.auditRetentionDays = n;
    }
    if (typeof patch.securityDigestEnabled === 'boolean') {
      next.securityDigestEnabled = patch.securityDigestEnabled;
    }
    if (typeof patch.alertEscalationEmailEnabled === 'boolean') {
      next.alertEscalationEmailEnabled = patch.alertEscalationEmailEnabled;
    }

    const { previous } = await runtimeConfigManager.updateSetting(
      'governance_policies',
      next,
      actor.userId,
      stripControlChars(reason, 240),
    );
    await writeAuditLog({
      actor,
      action: 'GOVERNANCE_POLICY_UPDATE',
      resourceType: 'platform_settings',
      resourceId: 'governance_policies',
      previousValue: previous,
      newValue: next,
    });
    return { ok: true, status: 200, data: { governancePolicies: next } };
  }

  // ---- 7. COMPLIANCE & GOVERNANCE REPORTING ----

  function classifyAuditCategory(action: string, resourceType: string): GovernanceEventSummaryDto['category'] {
    if (action.includes('LIFECYCLE') || action.includes('SUSPEND') || action.includes('RESTORE') || action.includes('USER_DELETE')) {
      return 'LIFECYCLE';
    }
    if (action.includes('PRIVACY') || resourceType.includes('export') || resourceType.includes('deletion')) {
      return 'PRIVACY';
    }
    if (action.includes('BACKUP') || resourceType.includes('backup')) return 'BACKUP';
    if (action.includes('FEATURE_FLAG') || resourceType === 'feature_flag') return 'FEATURE_FLAG';
    if (action.includes('MAINTENANCE') || resourceType === 'maintenance_window') return 'MAINTENANCE';
    if (action.includes('ROLE_') || action.includes('RBAC')) return 'RBAC';
    if (action.includes('CONFIG') || resourceType === 'platform_settings' || resourceType === 'ai_config') {
      return 'CONFIG';
    }
    return 'SECURITY';
  }

  async function getGovernanceReport(params: {
    category?: string;
    actor?: string;
    from?: string;
    to?: string;
    limit?: number;
  }) {
    const limit = Math.max(1, Math.min(200, Number(params.limit) || 100));
    const [
      usersCount,
      lifecycleRows,
      exportRows,
      deletionRows,
      backupRows,
      auditRows,
      flagsRows,
      maintenanceRows,
    ] = await Promise.all([
      db.queryOne<{ cnt: number | string }>('SELECT COUNT(*) AS cnt FROM users', 'SELECT COUNT(*) AS cnt FROM users'),
      db.queryAll<Record<string, unknown>>(
        'SELECT lifecycle_state FROM user_lifecycle_states',
        'SELECT lifecycle_state FROM user_lifecycle_states',
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT status FROM data_export_requests',
        'SELECT status FROM data_export_requests',
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT status FROM data_deletion_requests',
        'SELECT status FROM data_deletion_requests',
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT id, status, backup_type, created_at FROM backup_records ORDER BY created_at DESC LIMIT 30',
        'SELECT id, status, backup_type, created_at FROM backup_records ORDER BY created_at DESC LIMIT 30',
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT id, admin_email, action, resource_type, resource_id, result, created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT 250',
        'SELECT id, admin_email, action, resource_type, resource_id, result, created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT 250',
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT enabled FROM feature_flags',
        'SELECT enabled FROM feature_flags',
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT status FROM maintenance_windows',
        'SELECT status FROM maintenance_windows',
      ),
    ]);

    const fromMs = params.from && Number.isFinite(Date.parse(params.from)) ? Date.parse(params.from) : null;
    const toMs = params.to && Number.isFinite(Date.parse(params.to)) ? Date.parse(params.to) : null;
    const actorFilter = (params.actor ?? '').trim().toLowerCase();
    const catFilter = (params.category ?? 'ALL').trim().toUpperCase();

    const mappedEvents: GovernanceEventSummaryDto[] = auditRows
      .map((r) => ({
        id: String(r.id),
        category: classifyAuditCategory(String(r.action), String(r.resource_type)),
        action: String(r.action),
        actorEmail: String(r.admin_email),
        target: `${String(r.resource_type)}${r.resource_id ? `:${String(r.resource_id)}` : ''}`,
        result: String(r.result),
        createdAt: toIso(r.created_at),
      }))
      .filter((ev) => {
        if (catFilter !== 'ALL' && ev.category !== catFilter) return false;
        if (actorFilter && !ev.actorEmail.toLowerCase().includes(actorFilter)) return false;
        const ts = Date.parse(ev.createdAt);
        if (fromMs !== null && Number.isFinite(ts) && ts < fromMs) return false;
        if (toMs !== null && Number.isFinite(ts) && ts > toMs) return false;
        return true;
      })
      .slice(0, limit);

    const caps = getBackupCapabilities();

    return {
      summary: {
        totalUsers: Number(usersCount?.cnt ?? 0),
        deletionScheduledCount: lifecycleRows.filter((r) => String(r.lifecycle_state) === 'deletion_scheduled').length,
        anonymizedAccountsCount: lifecycleRows.filter((r) => String(r.lifecycle_state) === 'deleted_anonymized').length,
        exportRequestsTotal: exportRows.length,
        exportPendingCount: exportRows.filter((r) => String(r.status) === 'PENDING').length,
        exportReadyCount: exportRows.filter((r) => String(r.status) === 'READY').length,
        deletionRequestsTotal: deletionRows.length,
        deletionPendingCount: deletionRows.filter((r) => String(r.status) === 'PENDING_REVIEW').length,
        verifiedBackupsCount: backupRows.filter((r) => String(r.status) === 'VERIFIED').length,
        failedBackupsCount: backupRows.filter((r) => String(r.status) === 'FAILED').length,
        featureFlagsTotal: flagsRows.length,
        featureFlagsEnabled: flagsRows.filter((r) => toBoolField(r.enabled)).length,
        activeMaintenanceWindows: maintenanceRows.filter((r) => String(r.status) === 'ACTIVE').length,
      },
      readinessDisclaimer:
        'Operational governance readiness metrics track enforced technical controls in Nextrade AI. They do NOT represent formal GDPR, SOC 2, ISO 27001, SEBI, or FINRA legal certification.',
      controlMatrix: [
        {
          control: 'RBAC Least Privilege & Re-Authentication',
          status: 'IMPLEMENTED',
          evidence: '8 roles enforced server-side + password re-auth (HTTP 428/403) + last super_admin guard.',
        },
        {
          control: 'Personal Data Export & Secret Exclusion',
          status: 'IMPLEMENTED',
          evidence: 'Expiring signed downloads with ownership checks; zero credential/session hash leakage.',
        },
        {
          control: 'Controlled Account Deletion & Anonymization',
          status: 'IMPLEMENTED',
          evidence: 'Grace period workflow, owner cancellation, session revocation, immutable audit trail.',
        },
        {
          control: 'Immutable Append-Only Audit Ledger',
          status: 'IMPLEMENTED',
          evidence: 'admin_audit_logs blocks PUT/PATCH/DELETE (HTTP 405) with secret redaction.',
        },
        {
          control: 'Automated Physical Database Backups',
          status: caps.fullDatabaseBackupSupported ? 'IMPLEMENTED' : 'NOT_CONFIGURED',
          evidence: caps.fullDatabaseBackupSupported
            ? 'Atomic SQLite snapshot + SHA-256 + PRAGMA integrity_check verified.'
            : 'Supabase Managed PITR / pg_dump automation not configured in app runtime; config snapshots verified.',
        },
      ],
      events: mappedEvents,
    };
  }

  async function exportGovernanceCsv(
    actor: AdminActor,
    params: { category?: string; actor?: string; from?: string; to?: string },
  ) {
    const report = await getGovernanceReport({ ...params, limit: 200 });
    const csv = buildCsvDocument(
      ['id', 'category', 'action', 'actorEmail', 'target', 'result', 'createdAt'],
      report.events.map((e) => [e.id, e.category, e.action, e.actorEmail, e.target, e.result, e.createdAt]),
    );
    await writeAuditLog({
      actor,
      action: 'GOVERNANCE_REPORT_EXPORT_CSV',
      resourceType: 'governance_report',
      newValue: { exportedCount: report.events.length, category: params.category ?? 'ALL' },
    });
    return csv;
  }

  return {
    recordLifecycleTransition,
    getUserLifecycleDetail,
    addUserAdminNote,
    initiateDeletionWorkflow,
    cancelUserDeletionWorkflow,
    requestPersonalExport,
    processExportRequest,
    rejectExportRequest,
    downloadUserExportArtifact,
    requestSelfDeletion,
    cancelSelfDeletionRequest,
    getUserPrivacySummary,
    listAdminPrivacyQueue,
    handleAdminDeletionAction,
    getBackupCapabilities,
    listBackupsOverview,
    createBackup,
    verifyBackup,
    restoreBackup,
    listFeatureFlagsOverview,
    createFeatureFlag,
    updateFeatureFlag,
    rollbackFeatureFlag,
    evaluateClientFeatureFlags,
    getReleasesAndMaintenanceOverview,
    createManualRelease,
    createMaintenanceWindow,
    updateMaintenanceWindow,
    getEffectiveMaintenanceStatus,
    getTenCategoryGovernanceConfig,
    updateGovernancePolicies,
    getGovernanceReport,
    exportGovernanceCsv,
  };
}

export type GovernanceService = ReturnType<typeof createGovernanceService>;
