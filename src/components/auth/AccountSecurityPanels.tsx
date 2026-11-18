import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  KeyRound,
  Laptop,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { PublicAuthUser, PublicSessionInfo, useAuth } from '../../lib/authContext';
import { privacyApi, type UserPrivacySummaryResponse } from '../../lib/adminApi';

function formatIsoDisplay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function summarizeUserAgent(ua: string): string {
  if (!ua || ua === 'unknown') return 'Unknown client';
  if (/Playwright|HeadlessChrome/i.test(ua)) return 'Automated Browser Session';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'HTTP Client';
  const os = /Mac OS X/.test(ua)
    ? 'macOS'
    : /Windows/.test(ua)
      ? 'Windows'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Desktop';
  return `${browser} · ${os}`;
}

export const AccountSettingsPanel: React.FC<{ onNavigate: (path: string) => void }> = ({
  onNavigate,
}) => {
  const { user, session, setAuthenticatedState, clearAuthState } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Phase 5 Self-Service Privacy & Data Lifecycle Controls
  const [privacySummary, setPrivacySummary] = useState<UserPrivacySummaryResponse | null>(null);
  const [privacyLoading, setPrivacyLoading] = useState(true);
  const [privacyBusy, setPrivacyBusy] = useState<string | null>(null);
  const [privacyFeedback, setPrivacyFeedback] = useState<string | null>(null);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState('');

  const loadPrivacy = useCallback(async () => {
    setPrivacyLoading(true);
    try {
      const data = await privacyApi.getSummary();
      setPrivacySummary(data);
    } catch {
      // Non-blocking if session expired; handled by save/action paths
    } finally {
      setPrivacyLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.fullName) {
      setFullName(user.fullName);
    }
  }, [user?.fullName]);

  useEffect(() => {
    if (user?.id) {
      void loadPrivacy();
    }
  }, [loadPrivacy, user?.id]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    setErrorMsg(null);

    if (fullName.trim().length < 2) {
      setErrorMsg('Full name must be at least 2 characters.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/auth/account', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: fullName.trim() }),
      });

      if (res.status === 401) {
        clearAuthState();
        onNavigate('/login?redirect=/app/account');
        return;
      }

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        user?: PublicAuthUser;
      };
      if (!res.ok || !data.ok || !data.user) {
        setErrorMsg(data.error ?? 'Failed to update account profile.');
        return;
      }

      setAuthenticatedState(data.user, session);
      setStatusMsg('Account profile saved cleanly.');
    } catch {
      setErrorMsg('Network error while saving account profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleRequestExport = async () => {
    setPrivacyBusy('export');
    setPrivacyFeedback(null);
    setPrivacyError(null);
    try {
      await privacyApi.requestExport();
      setPrivacyFeedback('Personal data export package prepared with an expiring signed download URL.');
      await loadPrivacy();
    } catch (err) {
      setPrivacyError(err instanceof Error ? err.message : 'Unable to request personal data export.');
    } finally {
      setPrivacyBusy(null);
    }
  };

  const handleRequestDeletion = async (e: React.FormEvent) => {
    e.preventDefault();
    setPrivacyBusy('delete');
    setPrivacyFeedback(null);
    setPrivacyError(null);
    try {
      const res = await privacyApi.requestDeletion(
        deleteReason.trim() || 'User-initiated account deletion request',
      );
      setDeleteReason('');
      setPrivacyFeedback(
        `Account deletion workflow initiated (${res.request.status}). You may cancel within the grace window.`,
      );
      await loadPrivacy();
    } catch (err) {
      setPrivacyError(err instanceof Error ? err.message : 'Unable to submit deletion request.');
    } finally {
      setPrivacyBusy(null);
    }
  };

  const handleCancelDeletion = async (reqId: string) => {
    setPrivacyBusy(reqId);
    setPrivacyFeedback(null);
    setPrivacyError(null);
    try {
      await privacyApi.cancelDeletion(reqId);
      setPrivacyFeedback('Scheduled account deletion request cancelled.');
      await loadPrivacy();
    } catch (err) {
      setPrivacyError(err instanceof Error ? err.message : 'Unable to cancel deletion request.');
    } finally {
      setPrivacyBusy(null);
    }
  };

  if (!user) return null;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#080B12]">Account Settings</h1>
        <p className="mt-1 text-sm text-[#667085]">
          Manage your verified Nextrade AI identity and review workspace storage boundaries.
        </p>
      </div>

      <form
        onSubmit={handleSaveProfile}
        className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-5 shadow-[0_8px_24px_rgba(15,23,42,0.03)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E4E8F2] pb-4">
          <div>
            <h2 className="font-display text-base font-bold text-[#080B12]">Profile Identity</h2>
            <p className="text-xs text-[#667085]">
              Stored in server-side relational storage (Supabase PostgreSQL / SQLite) with role-based access readiness.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-[#BBF7D0] bg-[#F0FDF4] px-2.5 py-1 text-xs font-semibold text-[#15803D]">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{user.emailVerified ? 'Verified Account' : 'Unverified'}</span>
          </span>
        </div>

        {statusMsg && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] p-3 text-xs font-medium text-[#15803D]"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{statusMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs font-medium text-[#B91C1C]"
          >
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="account-full-name" className="block text-xs font-semibold text-[#080B12]">
              Full Name
            </label>
            <input
              id="account-full-name"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="h-10 w-full rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] px-3.5 text-sm text-[#080B12] focus:border-[#2D46E6] focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="account-email" className="block text-xs font-semibold text-[#080B12]">
              Email Address
            </label>
            <input
              id="account-email"
              type="email"
              value={user.email}
              disabled
              className="h-10 w-full rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] px-3.5 text-sm text-[#667085] cursor-not-allowed"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-4 text-xs">
          <div>
            <div className="text-[#667085]">Account Role</div>
            <div className="mt-1 font-mono font-semibold text-[#080B12] uppercase">{user.role}</div>
          </div>
          <div>
            <div className="text-[#667085]">Status</div>
            <div className="mt-1 font-mono font-semibold text-[#080B12] capitalize">
              {user.accountStatus}
            </div>
          </div>
          <div>
            <div className="text-[#667085]">Member Since</div>
            <div className="mt-1 font-mono text-[11px] font-medium text-[#080B12]">
              {formatIsoDisplay(user.createdAt)}
            </div>
          </div>
          <div>
            <div className="text-[#667085]">Last Sign-In</div>
            <div className="mt-1 font-mono text-[11px] font-medium text-[#080B12]">
              {formatIsoDisplay(user.lastLoginAt)}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={() => onNavigate('/app/security')}
            className="text-xs font-semibold text-[#2D46E6] hover:underline cursor-pointer"
          >
            Manage Security &amp; Active Sessions →
          </button>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-[#2D46E6] px-5 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] disabled:opacity-60 transition-colors cursor-pointer"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            <span>{saving ? 'Saving...' : 'Save Changes'}</span>
          </button>
        </div>
      </form>

      <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-5 space-y-2">
        <div className="text-xs font-semibold uppercase tracking-[0.06em] text-[#2D46E6] font-mono">
          Multi-User Data Isolation Active
        </div>
        <p className="text-xs leading-relaxed text-[#667085]">
          Your identity, active sessions, portfolios, watchlists, simulated paper-trading ledger, AI research history, saved reports, and workspace preferences are persisted server-side and strictly isolated to your authenticated user ID.
        </p>
      </div>

      {/* Phase 5: Your Data & Privacy Controls */}
      <section
        aria-label="Your Data and Privacy Controls"
        className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-5 shadow-[0_8px_24px_rgba(15,23,42,0.03)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E4E8F2] pb-4">
          <div className="flex-1 min-w-[240px]">
            <h2 className="font-display text-base font-bold text-[#080B12]">
              Your Data &amp; Privacy Controls
            </h2>
            <p className="text-xs text-[#667085]">
              Inspect stored data counts, download a sanitized personal data export (excluding password hashes &amp; secrets), or manage account deletion.
            </p>
          </div>
          <button
            type="button"
            disabled={privacyBusy === 'export'}
            onClick={() => void handleRequestExport()}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-[#2D46E6] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] disabled:opacity-60 cursor-pointer"
          >
            {privacyBusy === 'export' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            <span>Export My Data (JSON)</span>
          </button>
        </div>

        {privacyFeedback && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] p-3 text-xs font-medium text-[#15803D]"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{privacyFeedback}</span>
          </div>
        )}
        {privacyError && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs font-medium text-[#B91C1C]"
          >
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{privacyError}</span>
          </div>
        )}

        {privacyLoading && !privacySummary ? (
          <div className="py-6 text-center text-xs text-[#667085]">
            <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin text-[#2D46E6]" />
            Loading your data inventory...
          </div>
        ) : privacySummary ? (
          <>
            {/* Inventory Counts */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: 'Portfolios', val: privacySummary.dataInventory.portfolios },
                { label: 'Watchlists', val: privacySummary.dataInventory.watchlists },
                { label: 'Paper Orders', val: privacySummary.dataInventory.paperOrders },
                { label: 'AI Research Runs', val: privacySummary.dataInventory.aiResearchRuns },
                { label: 'Saved Reports', val: privacySummary.dataInventory.savedReports },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-3">
                  <div className="text-[11px] text-[#667085]">{item.label}</div>
                  <div className="font-mono text-base font-bold text-[#080B12]">{item.val}</div>
                </div>
              ))}
            </div>

            {/* Retention Policies & Backup Caveat */}
            <div className="rounded-lg border border-[#E4E8F2] bg-[#F8FAFC] p-3.5 text-xs space-y-1.5">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#475467]">
                Retention Policy &amp; Backup Caveat
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px] text-[#080B12]">
                <span>Export Link TTL: {privacySummary.retentionPolicies.exportLinkExpiryHours}h</span>
                <span>Deletion Grace: {privacySummary.retentionPolicies.deletionGracePeriodDays}d</span>
                <span>Telemetry: {privacySummary.retentionPolicies.telemetryRetentionDays}d</span>
                <span>Audit Logs: {privacySummary.retentionPolicies.auditRetentionDays}d</span>
              </div>
              <p className="text-[11px] text-[#667085]">
                {privacySummary.retentionPolicies.backupRetentionCaveat}
              </p>
            </div>

            {/* Export Requests */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#080B12]">
                <FileText className="h-3.5 w-3.5 text-[#2D46E6]" />
                <span>Personal Data Export History ({privacySummary.exportRequests.length})</span>
              </div>
              {privacySummary.exportRequests.length === 0 ? (
                <div className="rounded-lg border border-[#E4E8F2] p-3 text-xs text-[#667085]">
                  No data exports requested yet.
                </div>
              ) : (
                <div className="divide-y divide-[#E4E8F2] rounded-lg border border-[#E4E8F2]">
                  {privacySummary.exportRequests.slice(0, 5).map((exp) => (
                    <div
                      key={exp.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="font-mono text-[11px] font-semibold text-[#080B12]">
                          {exp.status}
                          {exp.byteSize ? ` · ${(exp.byteSize / 1024).toFixed(1)} KB` : ''}
                        </div>
                        <div className="font-mono text-[10px] text-[#667085]">
                          Requested {formatIsoDisplay(exp.createdAt)}
                          {exp.expiresAt ? ` · Expires ${formatIsoDisplay(exp.expiresAt)}` : ''}
                        </div>
                      </div>
                      {exp.downloadAvailable && exp.downloadUrl ? (
                        <a
                          href={exp.downloadUrl}
                          download
                          className="inline-flex h-8 items-center gap-1.5 rounded border border-[#2D46E6] bg-[#EFF2FA] px-3 text-[11px] font-semibold text-[#2D46E6] hover:bg-[#2D46E6] hover:text-[#FFFFFF]"
                        >
                          <Download className="h-3 w-3" />
                          <span>Download JSON</span>
                        </a>
                      ) : (
                        <span className="font-mono text-[10px] text-[#94A3B8]">
                          {exp.status === 'EXPIRED' ? 'Link Expired' : 'Unavailable'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Account Deletion Self-Service */}
            <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2]/60 p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-[#991B1B]">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Account Deletion &amp; Grace Period Workflow</span>
              </div>

              {privacySummary.deletionRequests
                .filter((d) => d.status === 'PENDING_REVIEW' || d.status === 'SCHEDULED')
                .map((req) => (
                  <div
                    key={req.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3 text-xs text-[#92400E]"
                  >
                    <div className="space-y-0.5">
                      <div className="inline-flex items-center gap-1.5 font-semibold">
                        <Clock className="h-3.5 w-3.5" />
                        <span>Active Deletion Request ({req.status})</span>
                      </div>
                      <div className="font-mono text-[11px]">
                        {req.scheduledFor
                          ? `Scheduled for ${formatIsoDisplay(req.scheduledFor)}`
                          : 'Pending review / grace window'}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={privacyBusy === req.id}
                      onClick={() => void handleCancelDeletion(req.id)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#BBF7D0] bg-[#FFFFFF] px-3 text-xs font-semibold text-[#15803D] hover:bg-[#F0FDF4] cursor-pointer"
                    >
                      <span>Cancel Request</span>
                    </button>
                  </div>
                ))}

              {!privacySummary.deletionRequests.some(
                (d) => d.status === 'PENDING_REVIEW' || d.status === 'SCHEDULED',
              ) && (
                <form onSubmit={handleRequestDeletion} className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={deleteReason}
                    onChange={(e) => setDeleteReason(e.target.value)}
                    placeholder="Optional reason for account deletion request..."
                    className="h-9 flex-1 min-w-[200px] rounded-md border border-[#FECACA] bg-[#FFFFFF] px-3 text-xs text-[#080B12]"
                  />
                  <button
                    type="submit"
                    disabled={privacyBusy === 'delete'}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#DC2626] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#B91C1C] disabled:opacity-60 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Request Account Deletion</span>
                  </button>
                </form>
              )}
            </div>

            {/* Recent Privacy Activity */}
            {privacySummary.privacyActivity.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
                  Recent Privacy Activity
                </div>
                <div className="divide-y divide-[#F1F5F9] rounded-lg border border-[#E4E8F2]">
                  {privacySummary.privacyActivity.slice(0, 5).map((act) => (
                    <div
                      key={act.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 text-[11px]"
                    >
                      <span className="font-mono font-semibold text-[#080B12]">{act.eventType}</span>
                      <span className="text-[#475467] truncate max-w-[320px]">{act.detail}</span>
                      <span className="font-mono text-[#667085]">{formatIsoDisplay(act.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
};

export const SecuritySessionsPanel: React.FC<{ onNavigate: (path: string) => void }> = ({
  onNavigate,
}) => {
  const { user, clearAuthState, logout } = useAuth();
  const [sessions, setSessions] = useState<PublicSessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [sendingReset, setSendingReset] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/auth/sessions', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (res.status === 401) {
        clearAuthState();
        onNavigate('/login?redirect=/app/security');
        return;
      }
      const data = (await res.json()) as {
        ok?: boolean;
        sessions?: PublicSessionInfo[];
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error ?? 'Failed to load sessions.');
        return;
      }
      setSessions(data.sessions ?? []);
    } catch {
      setErrorMsg('Network error while loading active sessions.');
    } finally {
      setLoading(false);
    }
  }, [clearAuthState, onNavigate]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const handleRevokeSession = async (sessionId: string, isCurrent: boolean) => {
    setRevokingId(sessionId);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (res.status === 401 || isCurrent) {
        clearAuthState();
        onNavigate('/login');
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMsg(data.error ?? 'Unable to revoke session.');
        return;
      }
      await loadSessions();
    } catch {
      setErrorMsg('Network error while revoking session.');
    } finally {
      setRevokingId(null);
    }
  };

  const handleRequestPasswordReset = async () => {
    if (!user?.email) return;
    setSendingReset(true);
    setResetMessage(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setErrorMsg(data.error ?? 'Unable to initiate password reset.');
        return;
      }
      setResetMessage(data.message ?? 'Password reset instructions requested.');
    } catch {
      setErrorMsg('Network error while requesting password reset.');
    } finally {
      setSendingReset(false);
    }
  };

  const activeSessions = sessions.filter((s) => !s.revokedAt);
  const revokedSessions = sessions.filter((s) => Boolean(s.revokedAt)).slice(0, 5);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#080B12]">
            Security &amp; Active Sessions
          </h1>
          <p className="mt-1 text-sm text-[#667085]">
            Inspect authenticated devices, revoke stale browser sessions, or rotate your credentials.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadSessions()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3.5 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Refresh Sessions</span>
        </button>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs font-medium text-[#B91C1C]"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      {resetMessage && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] p-3 text-xs font-medium text-[#15803D]"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{resetMessage}</span>
        </div>
      )}

      {/* Active Sessions List */}
      <div className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] overflow-hidden shadow-[0_8px_24px_rgba(15,23,42,0.03)]">
        <div className="border-b border-[#E4E8F2] px-6 py-4 flex items-center justify-between">
          <div className="text-sm font-bold text-[#080B12]">
            Active Sessions ({activeSessions.length})
          </div>
          <button
            type="button"
            onClick={async () => {
              await logout();
              onNavigate('/login');
            }}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#667085] hover:text-[#DC2626] cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Sign Out Current Device</span>
          </button>
        </div>

        {loading && sessions.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#667085]">Loading active sessions...</div>
        ) : activeSessions.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#667085]">No active sessions found.</div>
        ) : (
          <div className="divide-y divide-[#E4E8F2]">
            {activeSessions.map((s) => (
              <div
                key={s.id}
                className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-2 text-[#080B12]">
                    <Laptop className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[#080B12]">
                        {summarizeUserAgent(s.userAgent)}
                      </span>
                      {s.current && (
                        <span className="rounded bg-[#EFF2FA] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-[#2D46E6]">
                          Current Session
                        </span>
                      )}
                      {s.rememberMe && (
                        <span className="rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2 py-0.5 font-mono text-[10px] font-medium text-[#667085]">
                          14-Day Remember Me
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[11px] text-[#667085]">
                      IP: {s.ipAddress} · Last active: {formatIsoDisplay(s.lastActiveAt)} · Expires:{' '}
                      {formatIsoDisplay(s.expiresAt)}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={revokingId === s.id}
                  onClick={() => void handleRevokeSession(s.id, s.current)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3 text-xs font-semibold text-[#DC2626] hover:border-[#FECACA] hover:bg-[#FEF2F2] disabled:opacity-50 transition-colors cursor-pointer shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{s.current ? 'Revoke & Sign Out' : 'Revoke Session'}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Password Rotation */}
      <div className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-[0_8px_24px_rgba(15,23,42,0.03)]">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-bold text-[#080B12]">
            <KeyRound className="h-4 w-4 text-[#2D46E6]" aria-hidden="true" />
            <span>Password &amp; Global Session Revocation</span>
          </div>
          <p className="text-xs text-[#667085] leading-relaxed">
            Request a single-use password recovery link for <span className="font-mono text-[#080B12]">{user?.email}</span>. Resetting your password revokes all active sessions immediately.
          </p>
        </div>

        <button
          type="button"
          disabled={sendingReset}
          onClick={handleRequestPasswordReset}
          className="inline-flex h-10 items-center justify-center rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-4 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] disabled:opacity-60 transition-colors cursor-pointer shrink-0"
        >
          {sendingReset ? 'Requesting...' : 'Send Password Reset Link'}
        </button>
      </div>

      {revokedSessions.length > 0 && (
        <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-5 space-y-3">
          <div className="text-xs font-semibold text-[#667085] uppercase tracking-[0.05em]">
            Recent Revoked Sessions
          </div>
          <div className="space-y-2 text-xs text-[#667085]">
            {revokedSessions.map((rs) => (
              <div key={rs.id} className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                <span>
                  {summarizeUserAgent(rs.userAgent)} ({rs.ipAddress})
                </span>
                <span>Revoked {formatIsoDisplay(rs.revokedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
