import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  ShieldCheck,
  UserCheck,
  XCircle,
} from 'lucide-react';
import type { PrivilegedActionType } from '../../admin/types';
import { PERMISSIONS } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import { adminApi, type AccessGovernanceOverviewResponse } from '../../lib/adminApi';
import { AdminReauthModal } from './AdminReauthModal';

export const AdminAccessReviewsView: React.FC = () => {
  const { user } = useAuth();
  const perms = new Set<string>(user?.permissions ?? []);
  const canReview = perms.has(PERMISSIONS.ADMIN_ACCESS_REVIEW_MANAGE);
  const canRequest = perms.has(PERMISSIONS.ADMIN_PRIVILEGED_ACTIONS_REQUEST);
  const canApprove = perms.has(PERMISSIONS.ADMIN_PRIVILEGED_ACTIONS_APPROVE);
  const canGrantEmergency = perms.has(PERMISSIONS.ADMIN_EMERGENCY_MANAGE);

  const [data, setData] = useState<AccessGovernanceOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Review state
  const [reviewUserId, setReviewUserId] = useState('');
  const [reviewStatus, setReviewStatus] = useState<'APPROVED' | 'REJECTED' | 'REVOKED' | 'PENDING'>('APPROVED');
  const [reviewNote, setReviewNote] = useState('');

  // Privileged action request form
  const [reqActionType, setReqActionType] = useState<PrivilegedActionType>('SECURITY_POLICY_CHANGE');
  const [reqTargetType, setReqTargetType] = useState('platform_settings');
  const [reqTargetId, setReqTargetId] = useState('');
  const [reqReason, setReqReason] = useState('');

  // Emergency access grant form
  const [grantUserId, setGrantUserId] = useState('');
  const [grantMinutes, setGrantMinutes] = useState(60);
  const [grantJustification, setGrantJustification] = useState('');

  const [reauthAction, setReauthAction] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    danger?: boolean;
    requireReason?: boolean;
    onConfirm: (p: { confirmPassword: string; reason: string }) => Promise<void>;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getAccessGovernanceOverview();
      setData(res);
      if (!reviewUserId && res.accounts.length > 0) setReviewUserId(res.accounts[0].userId);
      if (!grantUserId && res.accounts.length > 0) setGrantUserId(res.accounts[0].userId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load privileged access governance.');
    } finally {
      setLoading(false);
    }
  }, [reviewUserId, grantUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    try {
      await adminApi.submitAccessReview({
        targetUserId: reviewUserId,
        status: reviewStatus,
        note: reviewNote,
      });
      setReviewNote('');
      setFeedback('Access review recorded in immutable governance log.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Access review submission failed.');
    }
  };

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    try {
      await adminApi.createPrivilegedRequest({
        actionType: reqActionType,
        targetResourceType: reqTargetType.trim(),
        targetResourceId: reqTargetId.trim(),
        reason: reqReason.trim(),
      });
      setReqTargetId('');
      setReqReason('');
      setFeedback('High-impact action request queued for independent peer approval.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create privileged request.');
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-12 text-xs text-[#667085]">
        <Loader2 className="h-4 w-4 animate-spin text-[#2D46E6]" />
        <span>Inspecting privileged accounts and access approvals...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {data?.mfaImplementationNote && (
        <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-xs text-[#92400E]">
          <strong>MFA Transparency:</strong> {data.mfaImplementationNote}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-2.5 text-xs text-[#B91C1C]">
          {error}
        </div>
      )}
      {feedback && (
        <div className="rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-2.5 text-xs text-[#15803D]">
          {feedback}
        </div>
      )}

      {/* Privileged Account Inspection Table */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="flex items-center gap-2 border-b border-[#E4E8F2] px-4 py-3">
          <UserCheck className="h-4 w-4 text-[#2D46E6]" />
          <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            Privileged Accounts & Posture
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-xs">
            <thead>
              <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                <th className="px-4 py-2">Administrator</th>
                <th className="px-4 py-2">Role / Perms</th>
                <th className="px-4 py-2">Sessions</th>
                <th className="px-4 py-2">MFA Status</th>
                <th className="px-4 py-2">Last Action</th>
                <th className="px-4 py-2">Latest Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {(data?.accounts ?? []).map((acc) => (
                <tr key={acc.userId} className="hover:bg-[#F7F8FA]">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-[#080B12]">{acc.fullName}</div>
                    <div className="font-mono text-[11px] text-[#667085]">{acc.email}</div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px]">
                    <span className="rounded border border-[#C7D2FE] bg-[#EFF2FA] px-1.5 py-0.5 font-semibold text-[#2D46E6]">
                      {acc.role}
                    </span>{' '}
                    <span className="text-[#667085]">({acc.grantedPermissionsCount})</span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-[#080B12]">
                    {acc.activeSessionCount} active
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-[#B45309]">
                    {acc.mfaStatus}
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-[#475467]">
                    {acc.lastPrivilegedAction || 'None recorded'}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-[#475467]">
                    {acc.latestReview ? `${acc.latestReview.reviewStatus}` : 'UNREVIEWED'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Forms: Access Review & High-Impact Request */}
      <div className="grid gap-4 lg:grid-cols-2">
        {canReview && (
          <form onSubmit={handleReviewSubmit} className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#2D46E6]" />
              <h3 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                Submit Privileged Access Review (No Self-Approval)
              </h3>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <select
                value={reviewUserId}
                onChange={(e) => setReviewUserId(e.target.value)}
                className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 text-xs"
              >
                {(data?.accounts ?? []).map((a) => (
                  <option key={a.userId} value={a.userId}>
                    {a.email} ({a.role})
                  </option>
                ))}
              </select>
              <select
                value={reviewStatus}
                onChange={(e) => setReviewStatus(e.target.value as 'APPROVED' | 'REJECTED' | 'REVOKED' | 'PENDING')}
                className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 text-xs"
              >
                <option value="APPROVED">APPROVED</option>
                <option value="PENDING">PENDING</option>
                <option value="REJECTED">REJECTED</option>
                <option value="REVOKED">REVOKED</option>
              </select>
            </div>
            <input
              type="text"
              required
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="Review rationale & scope verification note..."
              className="w-full h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs"
            />
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-md bg-[#2D46E6] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer"
            >
              Record Access Review
            </button>
          </form>
        )}

        {canRequest && (
          <form onSubmit={handleRequestSubmit} className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[#2D46E6]" />
              <h3 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                Request Peer-Approved Privileged Action
              </h3>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-3">
              <select
                value={reqActionType}
                onChange={(e) => setReqActionType(e.target.value as PrivilegedActionType)}
                className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2 text-xs"
              >
                <option value="SECURITY_POLICY_CHANGE">SECURITY_POLICY_CHANGE</option>
                <option value="AI_POLICY_CRITICAL">AI_POLICY_CRITICAL</option>
                <option value="PRODUCTION_RESTORE">PRODUCTION_RESTORE</option>
                <option value="AUTOMATION_HIGH_IMPACT">AUTOMATION_HIGH_IMPACT</option>
                <option value="ROLE_PROMOTION">ROLE_PROMOTION</option>
                <option value="HIGH_IMPACT_OPERATION">HIGH_IMPACT_OPERATION</option>
              </select>
              <input
                type="text"
                required
                value={reqTargetType}
                onChange={(e) => setReqTargetType(e.target.value)}
                placeholder="Resource type"
                className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs"
              />
              <input
                type="text"
                required
                value={reqTargetId}
                onChange={(e) => setReqTargetId(e.target.value)}
                placeholder="Target ID or key"
                className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 font-mono text-xs"
              />
            </div>
            <input
              type="text"
              required
              value={reqReason}
              onChange={(e) => setReqReason(e.target.value)}
              placeholder="Business justification (min 5 chars)..."
              className="w-full h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs"
            />
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-md bg-[#2D46E6] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer"
            >
              Submit Approval Request
            </button>
          </form>
        )}
      </div>

      {/* Approval Queue */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="border-b border-[#E4E8F2] px-4 py-3 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
          Privileged Action Approval Queue (Separation of Duties Enforced)
        </div>
        <div className="divide-y divide-[#F1F5F9]">
          {(data?.requests ?? []).length === 0 ? (
            <div className="p-6 text-center text-xs text-[#667085]">No privileged action requests recorded.</div>
          ) : (
            (data?.requests ?? []).map((req) => (
              <div key={req.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-[#080B12]">{req.actionType}</span>
                    <span className="rounded border border-[#E4E8F2] bg-[#F7F8FA] px-1.5 py-0.5 font-mono text-[10px]">
                      {req.status}
                    </span>
                    <span className="font-mono text-[11px] text-[#667085]">
                      {req.targetResourceType}:{req.targetResourceId}
                    </span>
                  </div>
                  <div className="text-xs text-[#475467]">
                    Requested by <strong>{req.requestedByEmail}</strong> · {req.reason}
                  </div>
                </div>
                {canApprove && (
                  <div className="flex items-center gap-2">
                    {req.status === 'PENDING' && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setReauthAction({
                              title: 'Approve Privileged Action',
                              description: `Approve ${req.actionType} requested by ${req.requestedByEmail}. Self-approval is blocked server-side.`,
                              confirmLabel: 'Approve Request',
                              requireReason: true,
                              onConfirm: async ({ confirmPassword, reason }) => {
                                await adminApi.decidePrivilegedRequest(req.id, 'APPROVE', reason, confirmPassword);
                                setReauthAction(null);
                                setFeedback('Request approved.');
                                await load();
                              },
                            })
                          }
                          className="inline-flex h-8 items-center gap-1 rounded-md bg-[#15803D] px-3 text-xs font-semibold text-[#FFFFFF] hover:bg-[#166534] cursor-pointer"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Approve</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setReauthAction({
                              title: 'Reject Privileged Action',
                              description: `Reject ${req.actionType} requested by ${req.requestedByEmail}.`,
                              confirmLabel: 'Reject Request',
                              danger: true,
                              requireReason: true,
                              onConfirm: async ({ confirmPassword, reason }) => {
                                await adminApi.decidePrivilegedRequest(req.id, 'REJECT', reason, confirmPassword);
                                setReauthAction(null);
                                setFeedback('Request rejected.');
                                await load();
                              },
                            })
                          }
                          className="inline-flex h-8 items-center gap-1 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 text-xs font-semibold text-[#DC2626] hover:bg-[#FEE2E2] cursor-pointer"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          <span>Reject</span>
                        </button>
                      </>
                    )}
                    {req.status === 'APPROVED' && (
                      <button
                        type="button"
                        onClick={() =>
                          setReauthAction({
                            title: 'Execute Approved Privileged Action',
                            description: `Execute ${req.actionType} on ${req.targetResourceId}.`,
                            confirmLabel: 'Execute Action',
                            onConfirm: async ({ confirmPassword }) => {
                              const res = await adminApi.executePrivilegedRequest(req.id, confirmPassword);
                              setReauthAction(null);
                              setFeedback(res.detail);
                              await load();
                            },
                          })
                        }
                        className="inline-flex h-8 items-center rounded-md bg-[#2D46E6] px-3 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer"
                      >
                        Execute Approved Action
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Time-Limited Emergency Access */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-4">
        <div className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
          Time-Limited Emergency Access Grants
        </div>
        {canGrantEmergency && (
          <div className="grid gap-2.5 sm:grid-cols-4">
            <select
              value={grantUserId}
              onChange={(e) => setGrantUserId(e.target.value)}
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 text-xs"
            >
              {(data?.accounts ?? []).map((a) => (
                <option key={a.userId} value={a.userId}>{a.email}</option>
              ))}
            </select>
            <input
              type="number"
              min={15}
              max={240}
              value={grantMinutes}
              onChange={(e) => setGrantMinutes(Number(e.target.value) || 60)}
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 font-mono text-xs"
            />
            <input
              type="text"
              value={grantJustification}
              onChange={(e) => setGrantJustification(e.target.value)}
              placeholder="Emergency incident justification (min 10 chars)"
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs sm:col-span-2"
            />
            <button
              type="button"
              disabled={grantJustification.trim().length < 10}
              onClick={() =>
                setReauthAction({
                  title: 'Grant Time-Limited Emergency Access',
                  description: `Issue ${grantMinutes}-minute scoped emergency read/triage grant.`,
                  confirmLabel: 'Issue Grant',
                  danger: true,
                  onConfirm: async ({ confirmPassword }) => {
                    await adminApi.grantEmergencyAccess({
                      targetUserId: grantUserId,
                      durationMinutes: grantMinutes,
                      justification: grantJustification.trim(),
                      confirmPassword,
                    });
                    setGrantJustification('');
                    setReauthAction(null);
                    setFeedback('Time-limited emergency grant issued.');
                    await load();
                  },
                })
              }
              className="inline-flex h-9 items-center justify-center rounded-md bg-[#DC2626] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#B91C1C] cursor-pointer disabled:opacity-50"
            >
              Grant Emergency Access
            </button>
          </div>
        )}

        <div className="divide-y divide-[#F1F5F9]">
          {(data?.emergencyGrants ?? []).map((g) => (
            <div key={g.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div>
                <span className="font-semibold text-[#080B12]">{g.userEmail}</span> ·{' '}
                <span className="font-mono text-[10px] font-bold text-[#2D46E6]">{g.status}</span> ·{' '}
                <span className="text-[#475467]">{g.justification}</span>
                <div className="text-[11px] text-[#667085]">
                  Expires {new Date(g.expiresAt).toLocaleString()} · Granted by {g.grantedByEmail}
                </div>
              </div>
              {canReview && (
                <div className="flex items-center gap-2">
                  {g.status === 'ACTIVE' && (
                    <button
                      type="button"
                      onClick={() =>
                        setReauthAction({
                          title: 'Revoke Emergency Grant',
                          description: `Immediately revoke emergency access for ${g.userEmail}.`,
                          confirmLabel: 'Revoke Grant',
                          danger: true,
                          requireReason: true,
                          onConfirm: async ({ confirmPassword, reason }) => {
                            await adminApi.actOnEmergencyAccessGrant(g.id, 'revoke', {
                              note: reason,
                              confirmPassword,
                            });
                            setReauthAction(null);
                            setFeedback('Emergency access grant revoked.');
                            await load();
                          },
                        })
                      }
                      className="h-8 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-2.5 text-xs font-semibold text-[#DC2626] cursor-pointer"
                    >
                      Revoke
                    </button>
                  )}
                  {g.status !== 'REVIEWED' && (
                    <button
                      type="button"
                      onClick={async () => {
                        await adminApi.actOnEmergencyAccessGrant(g.id, 'review', {
                          note: 'Post-incident access review signed off.',
                        });
                        setFeedback('Post-incident review completed.');
                        await load();
                      }}
                      className="h-8 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 text-xs font-semibold text-[#080B12] cursor-pointer"
                    >
                      Mark Reviewed
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <AdminReauthModal
        open={Boolean(reauthAction)}
        title={reauthAction?.title ?? ''}
        description={reauthAction?.description ?? ''}
        confirmLabel={reauthAction?.confirmLabel ?? 'Confirm'}
        danger={reauthAction?.danger}
        requireReason={reauthAction?.requireReason}
        onCancel={() => setReauthAction(null)}
        onConfirm={async (payload) => {
          if (reauthAction) await reauthAction.onConfirm(payload);
        }}
      />
    </div>
  );
};
