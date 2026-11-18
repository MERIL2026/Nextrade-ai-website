import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileDown,
  Loader2,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { DataDeletionRequestDto, DataExportRequestDto } from '../../admin/types';
import { PERMISSIONS } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import { adminApi } from '../../lib/adminApi';
import { AdminReauthModal } from './AdminReauthModal';

export const AdminPrivacyView: React.FC = () => {
  const { user } = useAuth();
  const perms = new Set<string>(user?.permissions ?? []);
  const canManagePrivacy = perms.has(PERMISSIONS.ADMIN_PRIVACY_MANAGE);
  const canCompleteDeletion = user?.role === 'super_admin' || perms.has(PERMISSIONS.ADMIN_PRIVACY_MANAGE);

  const [exportRequests, setExportRequests] = useState<DataExportRequestDto[]>([]);
  const [deletionRequests, setDeletionRequests] = useState<DataDeletionRequestDto[]>([]);
  const [retentionPolicies, setRetentionPolicies] = useState<{
    exportLinkExpiryHours: number;
    deletionGracePeriodDays: number;
    telemetryRetentionDays: number;
    auditRetentionDays: number;
    backupRetentionCaveat: string;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [graceDaysInput, setGraceDaysInput] = useState('7');
  const [decisionReason, setDecisionReason] = useState('');
  const [reauthDeletionId, setReauthDeletionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getPrivacyQueue();
      setExportRequests(res.exportRequests);
      setDeletionRequests(res.deletionRequests);
      setRetentionPolicies(res.retentionPolicies);
      setGraceDaysInput(String(res.retentionPolicies.deletionGracePeriodDays));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load privacy governance queue.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleProcessExport = async (id: string) => {
    setBusyId(id);
    setError(null);
    setFeedback(null);
    try {
      await adminApi.processExportRequest(id, decisionReason.trim() || 'Processed by privacy administrator');
      setFeedback('Export bundle generated with HMAC-signed expiring download link (secrets excluded).');
      setDecisionReason('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process export request.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRejectExport = async (id: string) => {
    setBusyId(id);
    setError(null);
    setFeedback(null);
    try {
      await adminApi.rejectExportRequest(
        id,
        decisionReason.trim() || 'Export request rejected by privacy administrator.',
      );
      setFeedback('Export request rejected.');
      setDecisionReason('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject export request.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeletionAction = async (
    id: string,
    action: 'SCHEDULE' | 'CANCEL' | 'REJECT',
  ) => {
    setBusyId(id);
    setError(null);
    setFeedback(null);
    try {
      const graceNum = Math.max(1, Math.min(90, Number(graceDaysInput) || 7));
      await adminApi.handleDeletionAction(id, {
        action,
        graceDays: action === 'SCHEDULE' ? graceNum : undefined,
        reason: decisionReason.trim() || `Administrator executed ${action}`,
      });
      setFeedback(`Deletion request updated (${action}).`);
      setDecisionReason('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update deletion request.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading && !retentionPolicies) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] text-xs text-[#667085]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#2D46E6]" />
        Loading Data Governance & Privacy Centre...
      </div>
    );
  }

  return (
    <div className="space-y-5">
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

      {/* Retention Policies & Backup Caveat */}
      {retentionPolicies && (
        <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
          <div className="flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            <ShieldCheck className="h-4 w-4 text-[#2D46E6]" />
            <span>Active Data Retention & Privacy Rules</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-md border border-[#E4E8F2] bg-[#F7F8FA] p-3">
              <div className="text-[11px] text-[#667085]">Export Link Expiry</div>
              <div className="font-mono text-base font-bold text-[#080B12]">
                {retentionPolicies.exportLinkExpiryHours}h
              </div>
            </div>
            <div className="rounded-md border border-[#E4E8F2] bg-[#F7F8FA] p-3">
              <div className="text-[11px] text-[#667085]">Deletion Grace Window</div>
              <div className="font-mono text-base font-bold text-[#080B12]">
                {retentionPolicies.deletionGracePeriodDays} days
              </div>
            </div>
            <div className="rounded-md border border-[#E4E8F2] bg-[#F7F8FA] p-3">
              <div className="text-[11px] text-[#667085]">API Telemetry Retention</div>
              <div className="font-mono text-base font-bold text-[#080B12]">
                {retentionPolicies.telemetryRetentionDays} days
              </div>
            </div>
            <div className="rounded-md border border-[#E4E8F2] bg-[#F7F8FA] p-3">
              <div className="text-[11px] text-[#667085]">Audit Log Retention Target</div>
              <div className="font-mono text-base font-bold text-[#080B12]">
                {retentionPolicies.auditRetentionDays} days
              </div>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-[11px] text-[#92400E]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{retentionPolicies.backupRetentionCaveat}</span>
          </div>
        </div>
      )}

      {/* Triage Controls */}
      {canManagePrivacy && (
        <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-[10px] font-mono uppercase text-[#667085] mb-1">
              Administrator Decision Note / Reason
            </label>
            <input
              type="text"
              value={decisionReason}
              onChange={(e) => setDecisionReason(e.target.value)}
              placeholder="Optional decision rationale recorded in audit logs..."
              className="h-9 w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs text-[#080B12]"
            />
          </div>
          <div className="w-36">
            <label className="block text-[10px] font-mono uppercase text-[#667085] mb-1">
              Schedule Grace (Days)
            </label>
            <input
              type="number"
              min={1}
              max={90}
              value={graceDaysInput}
              onChange={(e) => setGraceDaysInput(e.target.value)}
              className="h-9 w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 font-mono text-xs text-[#080B12]"
            />
          </div>
        </div>
      )}

      {/* Data Export Requests */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="flex items-center justify-between border-b border-[#E4E8F2] px-4 py-3">
          <span className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            <FileDown className="h-4 w-4 text-[#2D46E6]" />
            <span>Personal Data Export Requests ({exportRequests.length})</span>
          </span>
          <span className="font-mono text-[10px] text-[#667085]">
            Hashes &amp; Secrets Permanently Excluded
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                <th className="px-4 py-2">User</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Size / Checksum</th>
                <th className="px-3 py-2">Expires At</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {exportRequests.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-[#667085]">
                    No user data export requests submitted.
                  </td>
                </tr>
              ) : (
                exportRequests.map((req) => (
                  <tr key={req.id} className="h-11 hover:bg-[#F7F8FA]">
                    <td className="px-4 py-2">
                      <div className="font-medium text-[#080B12]">{req.userEmail || req.requestedByEmail}</div>
                      <div className="font-mono text-[10px] text-[#667085]">{req.id.slice(0, 12)}</div>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] font-semibold">
                      <span
                        className={`rounded border px-2 py-0.5 ${
                          req.status === 'READY'
                            ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                            : req.status === 'REJECTED' || req.status === 'FAILED'
                              ? 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]'
                              : 'border-[#CBD5E1] bg-[#F8FAFC] text-[#475467]'
                        }`}
                      >
                        {req.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-[#475467]">
                      {req.byteSize ? `${req.byteSize} B` : '—'}
                      {req.artifactChecksumSha256 && ` · ${req.artifactChecksumSha256.slice(0, 10)}`}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-[#667085]">
                      {req.expiresAt ? new Date(req.expiresAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {canManagePrivacy && (req.status === 'PENDING' || req.status === 'APPROVED') && (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={busyId === req.id}
                            onClick={() => void handleProcessExport(req.id)}
                            className="rounded bg-[#2D46E6] px-2.5 py-1 text-[11px] font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer disabled:opacity-50"
                          >
                            Process
                          </button>
                          <button
                            type="button"
                            disabled={busyId === req.id}
                            onClick={() => void handleRejectExport(req.id)}
                            className="rounded border border-[#FECACA] bg-[#FEF2F2] px-2.5 py-1 text-[11px] font-semibold text-[#DC2626] hover:bg-[#FEE2E2] cursor-pointer disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Account Deletion Requests */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="flex items-center justify-between border-b border-[#E4E8F2] px-4 py-3">
          <span className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            <Trash2 className="h-4 w-4 text-[#DC2626]" />
            <span>Account Deletion & Anonymization Queue ({deletionRequests.length})</span>
          </span>
          <span className="font-mono text-[10px] text-[#667085]">
            Controlled Grace Workflow · Finalize Requires Re-Auth
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                <th className="px-4 py-2">Account</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Scheduled / Grace</th>
                <th className="px-4 py-2 text-right">Workflow Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {deletionRequests.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-[#667085]">
                    No account deletion requests queued.
                  </td>
                </tr>
              ) : (
                deletionRequests.map((req) => {
                  const active = req.status === 'PENDING_REVIEW' || req.status === 'SCHEDULED';
                  return (
                    <tr key={req.id} className="h-12 hover:bg-[#F7F8FA]">
                      <td className="px-4 py-2">
                        <div className="font-medium text-[#080B12]">{req.userEmail || req.requestedByEmail}</div>
                        <div className="font-mono text-[10px] text-[#667085]">{req.id.slice(0, 12)}</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] font-semibold">
                        <span
                          className={`rounded border px-2 py-0.5 ${
                            req.status === 'COMPLETED'
                              ? 'border-[#E2E8F0] bg-[#F1F5F9] text-[#475467]'
                              : req.status === 'SCHEDULED'
                                ? 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]'
                                : req.status === 'CANCELLED' || req.status === 'REJECTED'
                                  ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                                  : 'border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]'
                          }`}
                        >
                          {req.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[#475467] max-w-[220px] truncate">{req.reason || '—'}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-[#667085]">
                        {req.scheduledFor
                          ? new Date(req.scheduledFor).toLocaleString()
                          : req.gracePeriodEndsAt
                            ? `Grace: ${new Date(req.gracePeriodEndsAt).toLocaleDateString()}`
                            : '—'}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {canManagePrivacy && active && (
                          <div className="inline-flex flex-wrap justify-end gap-1.5">
                            {req.status === 'PENDING_REVIEW' && (
                              <button
                                type="button"
                                disabled={busyId === req.id}
                                onClick={() => void handleDeletionAction(req.id, 'SCHEDULE')}
                                className="inline-flex items-center gap-1 rounded border border-[#FDE68A] bg-[#FFFBEB] px-2 py-1 text-[11px] font-semibold text-[#B45309] hover:bg-[#FEF3C7] cursor-pointer"
                              >
                                <Clock className="h-3 w-3" />
                                <span>Schedule</span>
                              </button>
                            )}
                            {canCompleteDeletion && (
                              <button
                                type="button"
                                disabled={busyId === req.id}
                                onClick={() => setReauthDeletionId(req.id)}
                                className="rounded bg-[#DC2626] px-2.5 py-1 text-[11px] font-semibold text-[#FFFFFF] hover:bg-[#B91C1C] cursor-pointer"
                              >
                                Complete & Anonymize
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={busyId === req.id}
                              onClick={() => void handleDeletionAction(req.id, 'CANCEL')}
                              className="inline-flex items-center gap-1 rounded border border-[#E4E8F2] bg-[#FFFFFF] px-2 py-1 text-[11px] font-semibold text-[#080B12] hover:border-[#2D46E6] cursor-pointer"
                            >
                              <XCircle className="h-3 w-3" />
                              <span>Cancel</span>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AdminReauthModal
        open={Boolean(reauthDeletionId)}
        title="Finalize Account Anonymization"
        description="Completing this deletion request anonymizes the user profile, revokes all active sessions, disables sign-in, and preserves audit ledger integrity. Password re-authentication is required."
        confirmLabel="Finalize Anonymization"
        danger
        requireReason
        onCancel={() => setReauthDeletionId(null)}
        onConfirm={async ({ confirmPassword, reason }) => {
          if (!reauthDeletionId) return;
          await adminApi.handleDeletionAction(reauthDeletionId, {
            action: 'COMPLETE',
            reason,
            confirmPassword,
          });
          setReauthDeletionId(null);
          setFeedback('Deletion request completed and account PII anonymized.');
          await load();
        }}
      />
    </div>
  );
};
