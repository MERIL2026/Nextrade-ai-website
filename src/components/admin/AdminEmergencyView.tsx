import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertOctagon,
  BookOpen,
  Loader2,
  ShieldAlert,
  Siren,
} from 'lucide-react';
import type { EmergencyPlaybookDto } from '../../admin/types';
import { PERMISSIONS } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import { adminApi, type EmergencyOverviewResponse } from '../../lib/adminApi';
import { AdminReauthModal } from './AdminReauthModal';

const EMERGENCY_ACTIONS = [
  { key: 'ACTIVATE_MAINTENANCE', label: 'Activate Maintenance Mode', reauth: true, danger: true },
  { key: 'DEACTIVATE_MAINTENANCE', label: 'Disable Maintenance Mode', reauth: true, danger: false },
  { key: 'DISABLE_AI_PROVIDER', label: 'Disable AI Provider', reauth: true, danger: true },
  { key: 'ENABLE_AI_PROVIDER', label: 'Enable AI Provider', reauth: true, danger: false },
  { key: 'PAUSE_WORKER_QUEUE', label: 'Pause Worker Queue', reauth: false, danger: true },
  { key: 'RESUME_WORKER_QUEUE', label: 'Resume Worker Queue', reauth: false, danger: false },
  { key: 'DISABLE_FEATURE_FLAG', label: 'Disable Feature Flag (by key)', reauth: false, danger: true },
  { key: 'REVOKE_USER_SESSIONS', label: 'Revoke Sessions (Target User or Other Admins)', reauth: true, danger: true },
  { key: 'ESCALATE_INCIDENT', label: 'Escalate New Incident', reauth: false, danger: false },
];

export const AdminEmergencyView: React.FC = () => {
  const { user } = useAuth();
  const perms = new Set<string>(user?.permissions ?? []);
  const canManage = perms.has(PERMISSIONS.ADMIN_EMERGENCY_MANAGE);

  const [data, setData] = useState<EmergencyOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selectedPlaybook, setSelectedPlaybook] = useState<EmergencyPlaybookDto | null>(null);

  // Action builder
  const [action, setAction] = useState('PAUSE_WORKER_QUEUE');
  const [targetId, setTargetId] = useState('');
  const [reason, setReason] = useState('');
  const [playbookKey, setPlaybookKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getEmergencyOverview();
      setData(res);
      if (!selectedPlaybook && res.playbooks.length > 0) {
        setSelectedPlaybook(res.playbooks[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Emergency Response Centre.');
    } finally {
      setLoading(false);
    }
  }, [selectedPlaybook]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedMeta = EMERGENCY_ACTIONS.find((a) => a.key === action);

  const executeDirect = async (confirmPassword?: string) => {
    setSubmitting(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await adminApi.executeEmergencyCentreAction({
        action,
        reason: reason.trim(),
        targetId: targetId.trim() || undefined,
        playbookKey: playbookKey.trim() || undefined,
        confirmPassword,
      });
      setReason('');
      setTargetId('');
      setFeedback(res.detail);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Emergency action failed.');
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-12 text-xs text-[#667085]">
        <Loader2 className="h-4 w-4 animate-spin text-[#2D46E6]" />
        <span>Loading Emergency Response Centre...</span>
      </div>
    );
  }

  const ov = data?.overview;

  return (
    <div className="space-y-5">
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

      {/* Live Crisis Posture */}
      {ov && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: 'Critical/High Alerts', value: ov.activeCriticalAlerts.length, warn: ov.activeCriticalAlerts.length > 0 },
            { label: 'Open Incidents', value: ov.openCriticalIncidents.length, warn: ov.openCriticalIncidents.length > 0 },
            { label: 'Degraded Services', value: ov.unhealthyServices.length, warn: ov.unhealthyServices.length > 0 },
            { label: 'Failed/Stuck Jobs', value: ov.failedOrStuckJobs.length, warn: ov.failedOrStuckJobs.length > 0 },
            { label: 'Worker Queue', value: ov.workerHeartbeat.status },
            { label: 'Maintenance Mode', value: ov.maintenanceActive ? 'ACTIVE' : 'OFF', warn: ov.maintenanceActive },
          ].map((k) => (
            <div key={k.label} className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3">
              <div className="text-[11px] text-[#667085]">{k.label}</div>
              <div className={`mt-1 font-mono text-lg font-bold ${k.warn ? 'text-[#DC2626]' : 'text-[#080B12]'}`}>
                {k.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Audited Reversible Emergency Controls */}
      {canManage && (
        <div className="rounded-lg border border-[#FECACA] bg-[#FFFFFF] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Siren className="h-4 w-4 text-[#DC2626]" />
            <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              Reversible Emergency Controls (Self-Lockout Protected)
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 text-xs"
            >
              {EMERGENCY_ACTIONS.map((a) => (
                <option key={a.key} value={a.key}>{a.label}</option>
              ))}
            </select>
            <input
              type="text"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              placeholder="Target ID / flagKey / userId (if applicable)"
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 font-mono text-xs"
            />
            <select
              value={playbookKey}
              onChange={(e) => setPlaybookKey(e.target.value)}
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 text-xs"
            >
              <option value="">Link Runbook (Optional)</option>
              {(data?.playbooks ?? []).map((pb) => (
                <option key={pb.playbookKey} value={pb.playbookKey}>{pb.title}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Mandatory emergency justification (min 5 chars)..."
              className="flex-1 min-w-[240px] h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs"
            />
            <button
              type="button"
              disabled={submitting || reason.trim().length < 5}
              onClick={() => {
                if (selectedMeta?.reauth) {
                  setReauthOpen(true);
                } else {
                  void executeDirect();
                }
              }}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-xs font-semibold text-[#FFFFFF] cursor-pointer disabled:opacity-50 ${
                selectedMeta?.danger ? 'bg-[#DC2626] hover:bg-[#B91C1C]' : 'bg-[#2D46E6] hover:bg-[#2238C9]'
              }`}
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>Execute Control</span>
            </button>
          </div>
        </div>
      )}

      {/* Documented Playbooks Library */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] divide-y divide-[#F1F5F9]">
          <div className="flex items-center gap-2 px-4 py-3">
            <BookOpen className="h-4 w-4 text-[#2D46E6]" />
            <h3 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              Emergency Playbooks ({data?.playbooks.length ?? 0})
            </h3>
          </div>
          {(data?.playbooks ?? []).map((pb) => (
            <button
              key={pb.playbookKey}
              type="button"
              onClick={() => {
                setSelectedPlaybook(pb);
                setPlaybookKey(pb.playbookKey);
              }}
              className={`w-full px-4 py-2.5 text-left hover:bg-[#F7F8FA] cursor-pointer ${
                selectedPlaybook?.playbookKey === pb.playbookKey ? 'bg-[#EFF2FA]' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#080B12]">{pb.title}</span>
                <span className="font-mono text-[10px] font-bold text-[#DC2626]">{pb.severity}</span>
              </div>
              <div className="font-mono text-[10px] text-[#667085]">{pb.playbookKey}</div>
            </button>
          ))}
        </div>

        <div className="lg:col-span-2 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
          {selectedPlaybook ? (
            <>
              <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-2.5">
                <div>
                  <h3 className="font-display text-sm font-bold text-[#080B12]">{selectedPlaybook.title}</h3>
                  <p className="font-mono text-[10px] text-[#667085]">
                    {selectedPlaybook.category} · {selectedPlaybook.severity}
                  </p>
                </div>
              </div>
              <div className="text-xs text-[#475467]">
                <strong className="text-[#080B12]">Trigger Conditions:</strong> {selectedPlaybook.triggerConditions}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 text-xs">
                <div className="rounded-md border border-[#F1F5F9] bg-[#F7F8FA] p-3 space-y-1">
                  <div className="font-mono text-[10px] font-bold uppercase text-[#2D46E6]">
                    Investigation Steps
                  </div>
                  <ul className="list-disc pl-4 space-y-1 text-[#475467]">
                    {selectedPlaybook.investigationSteps.map((st, idx) => (
                      <li key={idx}>{st}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-md border border-[#F1F5F9] bg-[#F7F8FA] p-3 space-y-1">
                  <div className="font-mono text-[10px] font-bold uppercase text-[#15803D]">
                    Safe Actions
                  </div>
                  <ul className="list-disc pl-4 space-y-1 text-[#475467]">
                    {selectedPlaybook.safeActions.map((act, idx) => (
                      <li key={idx}>{act}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="text-xs text-[#475467] space-y-1">
                <div><strong className="text-[#080B12]">Escalation:</strong> {selectedPlaybook.escalationRequirements}</div>
                <div><strong className="text-[#080B12]">Recovery Validation:</strong> {selectedPlaybook.recoveryValidation}</div>
                <div><strong className="text-[#080B12]">Resolution Criteria:</strong> {selectedPlaybook.resolutionCriteria}</div>
              </div>
            </>
          ) : (
            <div className="text-xs text-[#667085]">Select a playbook to view response steps.</div>
          )}
        </div>
      </div>

      {/* Emergency Event Timeline */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="flex items-center gap-2 border-b border-[#E4E8F2] px-4 py-3">
          <AlertOctagon className="h-4 w-4 text-[#2D46E6]" />
          <h3 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            Audited Emergency Events & Recovery Guidance
          </h3>
        </div>
        <div className="divide-y divide-[#F1F5F9]">
          {(data?.events ?? []).length === 0 ? (
            <div className="p-6 text-center text-xs text-[#667085]">No emergency events recorded.</div>
          ) : (
            (data?.events ?? []).map((ev) => (
              <div key={ev.id} className="p-3.5 text-xs space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] font-bold text-[#DC2626]">{ev.eventType}</span>
                    <span className="font-semibold text-[#080B12]">{ev.title}</span>
                  </div>
                  <span className="font-mono text-[10px] text-[#667085]">
                    {new Date(ev.createdAt).toLocaleString()} · {ev.actorEmail}
                  </span>
                </div>
                <p className="text-[#475467]">{ev.summary}</p>
                {ev.rollbackHint && (
                  <p className="font-mono text-[11px] text-[#2D46E6]">Rollback: {ev.rollbackHint}</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <AdminReauthModal
        open={reauthOpen}
        title={`Confirm ${selectedMeta?.label ?? action}`}
        description={`Reason: "${reason.trim()}". Enter your administrator password to authorize this reversible emergency control.`}
        confirmLabel="Confirm Emergency Control"
        danger={selectedMeta?.danger}
        onCancel={() => setReauthOpen(false)}
        onConfirm={async ({ confirmPassword }) => {
          await executeDirect(confirmPassword);
          setReauthOpen(false);
        }}
      />
    </div>
  );
};
