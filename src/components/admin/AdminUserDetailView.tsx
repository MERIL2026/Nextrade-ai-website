import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  History,
  KeyRound,
  Loader2,
  MessageSquarePlus,
  RotateCcw,
  ShieldAlert,
  ShieldOff,
  Trash2,
  UserCheck,
} from 'lucide-react';
import type {
  AdminUserDetailDto,
  AdminUserLifecycleDetailDto,
  UserLifecycleState,
} from '../../admin/types';
import type { UserRole } from '../../auth/db';
import { PERMISSIONS } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import { adminApi } from '../../lib/adminApi';
import { AdminReauthModal } from './AdminReauthModal';

interface AdminUserDetailViewProps {
  userId: string;
  onNavigate: (href: string) => void;
}

const ALL_ROLES: UserRole[] = [
  'user',
  'viewer',
  'support_admin',
  'data_admin',
  'ai_admin',
  'security_admin',
  'admin',
  'super_admin',
];

export const AdminUserDetailView: React.FC<AdminUserDetailViewProps> = ({
  userId,
  onNavigate,
}) => {
  const { user: currentAdmin } = useAuth();
  const perms = new Set<string>(currentAdmin?.permissions ?? []);
  const canManageUsers = perms.has(PERMISSIONS.ADMIN_USERS_MANAGE);
  const canManageSessions = perms.has(PERMISSIONS.ADMIN_SESSIONS_MANAGE);
  const canAssignRole = perms.has(PERMISSIONS.ADMIN_ROLES_ASSIGN);
  const canDeleteUser = perms.has(PERMISSIONS.ADMIN_USERS_DELETE);
  const canManageLifecycle = perms.has(PERMISSIONS.ADMIN_USERS_LIFECYCLE);

  const [detail, setDetail] = useState<AdminUserDetailDto | null>(null);
  const [lifecycle, setLifecycle] = useState<AdminUserLifecycleDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [editName, setEditName] = useState('');
  const [editVerified, setEditVerified] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [suspendReason, setSuspendReason] = useState('');
  const [selectedRole, setSelectedRole] = useState<UserRole>('user');

  const [deletionGraceDays, setDeletionGraceDays] = useState('7');
  const [deletionReason, setDeletionReason] = useState('');
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  const [newNoteText, setNewNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const [reauthMode, setReauthMode] = useState<'role' | 'delete' | 'anonymize' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, lcRes] = await Promise.all([
        adminApi.getUserDetail(userId),
        adminApi.getUserLifecycle(userId).catch(() => null),
      ]);
      setDetail(res);
      setLifecycle(lcRes?.lifecycle ?? null);
      setEditName(res.user.fullName);
      setEditVerified(res.user.emailVerified);
      setSelectedRole(res.user.role);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load user details.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setError(null);
    setFeedback(null);
    try {
      await adminApi.updateUserProfile(userId, {
        fullName: editName.trim(),
        emailVerified: editVerified,
      });
      setFeedback('User profile metadata updated.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update user.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSuspendOrRestore = async () => {
    if (!detail) return;
    setError(null);
    setFeedback(null);
    try {
      if (detail.user.accountStatus === 'suspended') {
        await adminApi.restoreUser(userId, suspendReason.trim() || 'Administrative restoration');
        setFeedback('Account restored to active status.');
      } else {
        await adminApi.suspendUser(
          userId,
          suspendReason.trim() || 'Administrative suspension',
        );
        setFeedback('Account suspended and active sessions revoked.');
      }
      setSuspendReason('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update account status.');
    }
  };

  const handleRevokeSessions = async (sessionId?: string) => {
    setError(null);
    setFeedback(null);
    try {
      const res = await adminApi.revokeUserSession(userId, sessionId);
      setFeedback(`Revoked ${res.revokedCount} session(s).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to revoke sessions.');
    }
  };

  const handleScheduleDeletion = async () => {
    setLifecycleBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const graceDaysNum = Math.max(1, Math.min(90, Number(deletionGraceDays) || 7));
      const res = await adminApi.initiateUserDeletion(userId, {
        mode: 'schedule',
        graceDays: graceDaysNum,
        reason: deletionReason.trim() || 'Administrative scheduled deletion',
      });
      setDeletionReason('');
      setFeedback(
        `Deletion scheduled (${res.lifecycleState})${res.scheduledFor ? ` for ${new Date(res.scheduledFor).toLocaleString()}` : ''}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to schedule deletion.');
    } finally {
      setLifecycleBusy(false);
    }
  };

  const handleCancelDeletion = async () => {
    setLifecycleBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await adminApi.cancelUserDeletion(
        userId,
        deletionReason.trim() || 'Administrator cancelled scheduled deletion',
      );
      setDeletionReason('');
      setFeedback(`Deletion workflow cancelled. Lifecycle state restored to ${res.lifecycleState}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel scheduled deletion.');
    } finally {
      setLifecycleBusy(false);
    }
  };

  const handleAddAdminNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteText.trim()) return;
    setAddingNote(true);
    setError(null);
    setFeedback(null);
    try {
      await adminApi.addUserAdminNote(userId, newNoteText.trim());
      setNewNoteText('');
      setFeedback('Internal administrative note recorded.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save administrative note.');
    } finally {
      setAddingNote(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] text-xs text-[#667085]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#2D46E6]" />
        Loading user inspector...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => onNavigate('/admin/users')}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2D46E6] hover:underline cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Users</span>
        </button>
        <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-4 text-xs text-[#B91C1C]">
          {error || 'User account not found.'}
        </div>
      </div>
    );
  }

  const u = detail.user;
  const lcState: UserLifecycleState = lifecycle?.lifecycleState ?? 'active';
  const isDeletionPendingOrScheduled =
    lcState === 'deletion_requested' || lcState === 'deletion_scheduled';
  const isAnonymized = lcState === 'deleted_anonymized' || u.email.endsWith('@deleted.local');

  const lifecycleBadgeClass =
    lcState === 'active'
      ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
      : lcState === 'pending_verification'
        ? 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]'
        : lcState === 'suspended' || lcState === 'deletion_requested' || lcState === 'deletion_scheduled'
          ? 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]'
          : 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onNavigate('/admin/users')}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3 py-1.5 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>All Users</span>
        </button>
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <span className="rounded border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 py-1 text-[#475467]">
            ID: {u.id}
          </span>
          <span className="rounded border border-[#CBD5E1] bg-[#F8FAFC] px-2.5 py-1 font-semibold uppercase text-[#080B12]">
            {u.role}
          </span>
          <span
            className={`rounded border px-2.5 py-1 font-semibold uppercase ${
              u.accountStatus === 'active'
                ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                : 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]'
            }`}
          >
            {u.accountStatus}
          </span>
          <span className={`rounded border px-2.5 py-1 font-semibold uppercase ${lifecycleBadgeClass}`}>
            Lifecycle: {lcState}
          </span>
        </div>
      </div>

      {feedback && (
        <div className="flex items-center gap-2 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-2.5 text-xs text-[#15803D]">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-2.5 text-xs text-[#B91C1C]">
          {error}
        </div>
      )}

      {/* Workspace Summary Counts */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: 'Portfolios', val: detail.workspaceSummary.portfolioCount },
          { label: 'Watchlists', val: detail.workspaceSummary.watchlistCount },
          { label: 'Paper Orders', val: detail.workspaceSummary.ordersCount },
          { label: 'AI Research Runs', val: detail.workspaceSummary.researchCount },
          { label: 'Saved Reports', val: detail.workspaceSummary.savedReportsCount },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3">
            <div className="text-[11px] text-[#667085]">{item.label}</div>
            <div className="font-mono text-lg font-bold tabular-nums text-[#080B12]">
              {item.val}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Profile Edit */}
        <form
          onSubmit={handleSaveProfile}
          className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3"
        >
          <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            Identity & Verification
          </h2>
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-[#475467]">Full Name</label>
            <input
              type="text"
              value={editName}
              disabled={!canManageUsers}
              onChange={(e) => setEditName(e.target.value)}
              className="h-9 w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs text-[#080B12] disabled:opacity-60"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-[#475467]">Email Address</label>
            <input
              type="text"
              value={u.email}
              disabled
              className="h-9 w-full rounded-md border border-[#E4E8F2] bg-[#F1F5F9] px-3 font-mono text-xs text-[#64748B]"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-[#080B12]">
            <input
              type="checkbox"
              checked={editVerified}
              disabled={!canManageUsers}
              onChange={(e) => setEditVerified(e.target.checked)}
              className="h-4 w-4 accent-[#2D46E6]"
            />
            <span>Email verification confirmed</span>
          </label>
          {canManageUsers && (
            <button
              type="submit"
              disabled={savingProfile}
              className="h-9 rounded-md bg-[#2D46E6] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer disabled:opacity-50"
            >
              {savingProfile ? 'Saving...' : 'Update Profile Metadata'}
            </button>
          )}
        </form>

        {/* Governance Actions: Suspend / Role / Delete */}
        <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-4">
          <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            Account Controls & RBAC
          </h2>

          {canManageUsers && !u.email.endsWith('@deleted.local') && (
            <div className="space-y-2 border-b border-[#F1F5F9] pb-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  placeholder="Reason for suspend/restore (audit logged)..."
                  className="h-9 flex-1 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs text-[#080B12]"
                />
                <button
                  type="button"
                  onClick={() => void handleSuspendOrRestore()}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-[#FFFFFF] cursor-pointer ${
                    u.accountStatus === 'suspended'
                      ? 'bg-[#15803D] hover:bg-[#166534]'
                      : 'bg-[#D97706] hover:bg-[#B45309]'
                  }`}
                >
                  {u.accountStatus === 'suspended' ? (
                    <>
                      <UserCheck className="h-3.5 w-3.5" />
                      <span>Restore</span>
                    </>
                  ) : (
                    <>
                      <ShieldOff className="h-3.5 w-3.5" />
                      <span>Suspend</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {canAssignRole && (
            <div className="space-y-2 border-b border-[#F1F5F9] pb-3">
              <label className="block text-[11px] font-semibold text-[#475467]">
                Role Assignment (Super Admin + Re-Auth)
              </label>
              <div className="flex gap-2">
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as UserRole)}
                  aria-label="Select target user role"
                  className="h-9 flex-1 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono text-xs text-[#080B12]"
                >
                  {ALL_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={selectedRole === u.role}
                  onClick={() => setReauthMode('role')}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#080B12] px-3 text-xs font-semibold text-[#FFFFFF] hover:bg-[#1E293B] disabled:opacity-40 cursor-pointer"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  <span>Assign Role</span>
                </button>
              </div>
            </div>
          )}

          {canDeleteUser && !u.email.endsWith('@deleted.local') && (
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="text-[11px] text-[#667085]">
                Anonymizes & disables account, revokes sessions, preserves ledger integrity.
              </div>
              <button
                type="button"
                onClick={() => setReauthMode('delete')}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 text-xs font-semibold text-[#DC2626] hover:bg-[#FEE2E2] cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete Account</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Sessions */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="flex items-center justify-between border-b border-[#E4E8F2] px-4 py-3">
          <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            Sessions ({detail.sessions.length})
          </h2>
          {canManageSessions && detail.sessions.some((s) => !s.revokedAt) && (
            <button
              type="button"
              onClick={() => void handleRevokeSessions()}
              className="rounded border border-[#FECACA] bg-[#FEF2F2] px-2.5 py-1 text-[11px] font-semibold text-[#DC2626] hover:bg-[#FEE2E2] cursor-pointer"
            >
              Revoke All Active Sessions
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                <th className="px-4 py-2">IP Address</th>
                <th className="px-3 py-2">User Agent</th>
                <th className="px-3 py-2">Last Active</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-4 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {detail.sessions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-[#667085]">
                    No session history for this account.
                  </td>
                </tr>
              ) : (
                detail.sessions.map((s) => (
                  <tr key={s.id} className="h-10">
                    <td className="px-4 py-2 font-mono text-[11px] text-[#080B12]">{s.ipAddress}</td>
                    <td className="px-3 py-2 max-w-[260px] truncate text-[#475467]">{s.userAgent}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-[#667085]">
                      {new Date(s.lastActiveAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px]">
                      {s.revokedAt ? (
                        <span className="text-[#64748B]">REVOKED</span>
                      ) : (
                        <span className="font-semibold text-[#15803D]">ACTIVE</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {canManageSessions && !s.revokedAt && (
                        <button
                          type="button"
                          onClick={() => void handleRevokeSessions(s.id)}
                          className="text-[11px] font-semibold text-[#DC2626] hover:underline cursor-pointer"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Role History & Security Events */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
          <div className="border-b border-[#E4E8F2] px-4 py-3">
            <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              Role Assignment History
            </h2>
          </div>
          <div className="divide-y divide-[#F1F5F9] max-h-64 overflow-y-auto">
            {detail.roleAssignments.length === 0 ? (
              <div className="p-4 text-xs text-[#667085]">No role mutations recorded.</div>
            ) : (
              detail.roleAssignments.map((r) => (
                <div key={r.id} className="p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span>
                      {r.previousRole} → <strong className="text-[#2D46E6]">{r.assignedRole}</strong>
                    </span>
                    <span className="text-[#667085]">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="text-[#475467]">{r.reason}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
          <div className="border-b border-[#E4E8F2] px-4 py-3 flex items-center gap-2">
            <ShieldAlert className="h-3.5 w-3.5 text-[#2D46E6]" />
            <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              Recent Account Security Events
            </h2>
          </div>
          <div className="divide-y divide-[#F1F5F9] max-h-64 overflow-y-auto">
            {detail.securityEvents.length === 0 ? (
              <div className="p-4 text-xs text-[#667085]">No security events logged.</div>
            ) : (
              detail.securityEvents.map((ev) => (
                <div key={ev.id} className="p-3 text-xs space-y-0.5">
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="font-semibold text-[#080B12]">{ev.eventType}</span>
                    <span className="text-[#667085]">{new Date(ev.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="text-[#475467]">{ev.detail}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Phase 5: Lifecycle & Deletion Workflow + Administrative Notes */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              <CalendarClock className="h-4 w-4 text-[#2D46E6]" />
              <span>Lifecycle &amp; Controlled Deletion Workflow</span>
            </h2>
            <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${lifecycleBadgeClass}`}>
              {lcState}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] p-3 font-mono text-[11px]">
            <div>
              <div className="text-[#667085]">Deletion Requested</div>
              <div className="text-[#080B12]">
                {lifecycle?.deletionRequestedAt
                  ? new Date(lifecycle.deletionRequestedAt).toLocaleString()
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-[#667085]">Scheduled Execution</div>
              <div className="text-[#080B12]">
                {lifecycle?.deletionScheduledFor
                  ? new Date(lifecycle.deletionScheduledFor).toLocaleString()
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-[#667085]">Anonymized At</div>
              <div className="text-[#080B12]">
                {lifecycle?.anonymizedAt ? new Date(lifecycle.anonymizedAt).toLocaleString() : '—'}
              </div>
            </div>
            <div>
              <div className="text-[#667085]">Last State Reason</div>
              <div className="truncate text-[#080B12]" title={lifecycle?.reason || ''}>
                {lifecycle?.reason || '—'}
              </div>
            </div>
          </div>

          {canManageLifecycle && !isAnonymized && (
            <div className="space-y-3 pt-1">
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={deletionReason}
                  onChange={(e) => setDeletionReason(e.target.value)}
                  placeholder="Lifecycle reason / ticket reference..."
                  className="h-9 flex-1 min-w-[180px] rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs text-[#080B12]"
                />
                {!isDeletionPendingOrScheduled && (
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-[#475467]">
                    <span>Grace Days</span>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={deletionGraceDays}
                      onChange={(e) => setDeletionGraceDays(e.target.value)}
                      className="h-9 w-16 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2 font-mono text-xs text-[#080B12]"
                    />
                  </label>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {isDeletionPendingOrScheduled ? (
                  <button
                    type="button"
                    disabled={lifecycleBusy}
                    onClick={() => void handleCancelDeletion()}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#BBF7D0] bg-[#F0FDF4] px-3 text-xs font-semibold text-[#15803D] hover:bg-[#DCFCE7] cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Cancel Scheduled Deletion</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={lifecycleBusy}
                    onClick={() => void handleScheduleDeletion()}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#D97706] px-3 text-xs font-semibold text-[#FFFFFF] hover:bg-[#B45309] cursor-pointer disabled:opacity-50"
                  >
                    <CalendarClock className="h-3.5 w-3.5" />
                    <span>Schedule Deletion</span>
                  </button>
                )}

                {currentAdmin?.role === 'super_admin' && (
                  <button
                    type="button"
                    disabled={lifecycleBusy}
                    onClick={() => setReauthMode('anonymize')}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 text-xs font-semibold text-[#DC2626] hover:bg-[#FEE2E2] cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Immediate Anonymize (Re-Auth)</span>
                  </button>
                )}
              </div>
              <p className="text-[11px] text-[#667085]">
                Server guards prevent self-deletion or removing the final active Super Admin account.
              </p>
            </div>
          )}
        </div>

        {/* Administrative Notes */}
        <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] flex flex-col">
          <div className="border-b border-[#E4E8F2] px-4 py-3 flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              <MessageSquarePlus className="h-4 w-4 text-[#2D46E6]" />
              <span>Internal Administrative Notes ({lifecycle?.notes.length ?? 0})</span>
            </h2>
          </div>
          {canManageLifecycle && (
            <form onSubmit={handleAddAdminNote} className="border-b border-[#F1F5F9] p-3 flex gap-2">
              <input
                type="text"
                value={newNoteText}
                onChange={(e) => setNewNoteText(e.target.value)}
                placeholder="Add internal governance or support note..."
                className="h-9 flex-1 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs text-[#080B12]"
              />
              <button
                type="submit"
                disabled={addingNote || !newNoteText.trim()}
                className="h-9 rounded-md bg-[#2D46E6] px-3 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] disabled:opacity-50 cursor-pointer"
              >
                {addingNote ? 'Saving...' : 'Add Note'}
              </button>
            </form>
          )}
          <div className="divide-y divide-[#F1F5F9] max-h-56 overflow-y-auto">
            {!lifecycle || lifecycle.notes.length === 0 ? (
              <div className="p-4 text-xs text-[#667085]">No internal administrative notes recorded.</div>
            ) : (
              lifecycle.notes.map((n) => (
                <div key={n.id} className="p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between font-mono text-[10px] text-[#667085]">
                    <span className="font-semibold text-[#080B12]">{n.authorEmail}</span>
                    <span>{new Date(n.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="text-[#334155]">{n.note}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Lifecycle Event History */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="border-b border-[#E4E8F2] px-4 py-3 flex items-center gap-2">
          <History className="h-3.5 w-3.5 text-[#2D46E6]" />
          <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            User Lifecycle Event Timeline ({lifecycle?.events.length ?? 0})
          </h2>
        </div>
        <div className="divide-y divide-[#F1F5F9] max-h-60 overflow-y-auto">
          {!lifecycle || lifecycle.events.length === 0 ? (
            <div className="p-4 text-xs text-[#667085]">No lifecycle state transitions recorded yet.</div>
          ) : (
            lifecycle.events.map((ev) => (
              <div key={ev.id} className="px-4 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="font-mono text-[11px]">
                    <span className="text-[#64748B]">{ev.previousState || 'initial'}</span>
                    {' → '}
                    <strong className="text-[#2D46E6]">{ev.newState}</strong>
                    <span className="ml-2 text-[#475467]">by {ev.actorEmail}</span>
                  </div>
                  {ev.reason && <div className="text-[#475467]">{ev.reason}</div>}
                </div>
                <div className="font-mono text-[10px] text-[#667085]">
                  {new Date(ev.createdAt).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Modals */}
      <AdminReauthModal
        open={reauthMode === 'role'}
        title={`Change Role to "${selectedRole}"`}
        description={`Confirm password re-authentication to assign role "${selectedRole}" to ${u.email}. Self-demotion or removing the final active Super Admin is blocked server-side.`}
        confirmLabel="Confirm Role Change"
        requireReason
        onCancel={() => setReauthMode(null)}
        onConfirm={async ({ confirmPassword, reason }) => {
          await adminApi.assignUserRole(u.id, selectedRole, reason, confirmPassword);
          setReauthMode(null);
          setFeedback(`User role updated to ${selectedRole}.`);
          await load();
        }}
      />

      <AdminReauthModal
        open={reauthMode === 'delete'}
        title="Delete User Account"
        description={`This anonymizes ${u.email}, disables sign-in, and revokes active sessions. Admins cannot delete themselves or the final Super Admin.`}
        confirmLabel="Delete User"
        danger
        requireTypedMatch={u.email}
        requireTypedLabel={`Type exact email (${u.email}) to confirm`}
        onCancel={() => setReauthMode(null)}
        onConfirm={async ({ confirmPassword, typedMatch }) => {
          await adminApi.deleteUser(u.id, typedMatch, confirmPassword);
          setReauthMode(null);
          setFeedback('User account safely deleted & anonymized.');
          await load();
        }}
      />

      <AdminReauthModal
        open={reauthMode === 'anonymize'}
        title="Immediate Lifecycle Anonymization"
        description={`Confirm Super Admin password to immediately anonymize ${u.email}, revoke all sessions, and mark lifecycle state as deleted_anonymized.`}
        confirmLabel="Anonymize Account Now"
        danger
        requireReason
        onCancel={() => setReauthMode(null)}
        onConfirm={async ({ confirmPassword, reason }) => {
          await adminApi.initiateUserDeletion(u.id, {
            mode: 'anonymize_now',
            reason: reason || 'Super Admin immediate anonymization',
            confirmPassword,
          });
          setReauthMode(null);
          setFeedback('User account immediately anonymized and logged.');
          await load();
        }}
      />
    </div>
  );
};
