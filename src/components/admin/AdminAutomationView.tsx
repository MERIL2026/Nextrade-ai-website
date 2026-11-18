import React, { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  Pause,
  Play,
  Plus,
  PowerOff,
  ShieldAlert,
  Workflow,
} from 'lucide-react';
import type { AutomationActionType, AutomationTriggerType } from '../../admin/types';
import { PERMISSIONS } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import { adminApi, type AutomationOverviewResponse } from '../../lib/adminApi';
import { AdminReauthModal } from './AdminReauthModal';

const ACTION_OPTIONS: AutomationActionType[] = [
  'CREATE_ALERT',
  'ACKNOWLEDGE_ELIGIBLE_ALERT',
  'CREATE_INCIDENT',
  'ADD_INCIDENT_EVENT',
  'PAUSE_WORKER_QUEUE',
  'RESUME_WORKER_QUEUE',
  'DISABLE_FEATURE_FLAG',
  'GENERATE_GOVERNANCE_REMINDER',
  'RECORD_OPERATIONAL_EVENT',
];

const TRIGGER_OPTIONS: AutomationTriggerType[] = [
  'MANUAL',
  'SCHEDULED',
  'OPERATIONAL_EVENT',
  'ALERT_THRESHOLD',
  'JOB_FAILURE',
  'SECURITY_EVENT',
];

export const AdminAutomationView: React.FC = () => {
  const { user } = useAuth();
  const perms = new Set<string>(user?.permissions ?? []);
  const canManage = perms.has(PERMISSIONS.ADMIN_AUTOMATION_MANAGE);
  const canExecute = perms.has(PERMISSIONS.ADMIN_AUTOMATION_EXECUTE);

  const [data, setData] = useState<AutomationOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Create form
  const [workflowKey, setWorkflowKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>('MANUAL');
  const [actionType, setActionType] = useState<AutomationActionType>('GENERATE_GOVERNANCE_REMINDER');
  const [flagKey, setFlagKey] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [creating, setCreating] = useState(false);

  // Kill switch reauth
  const [killModalOpen, setKillModalOpen] = useState(false);
  const [idempotencyInputs, setIdempotencyInputs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getAutomationOverview();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load automation engine.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await adminApi.createAutomationWorkflow({
        workflowKey: workflowKey.trim(),
        name: name.trim(),
        description: description.trim(),
        triggerType,
        actionType,
        actionConfig: actionType === 'DISABLE_FEATURE_FLAG' && flagKey.trim() ? { flagKey: flagKey.trim() } : {},
        requiresApproval,
      });
      setWorkflowKey('');
      setName('');
      setDescription('');
      setFlagKey('');
      setFeedback(`Created governed workflow "${res.workflow.name}" (${res.workflow.workflowKey}).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Workflow creation failed.');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleState = async (id: string, patch: { enabled?: boolean; isPaused?: boolean }) => {
    setBusyId(id);
    setError(null);
    setFeedback(null);
    try {
      await adminApi.updateAutomationWorkflowState(id, patch);
      setFeedback('Updated workflow operational state.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update workflow state.');
    } finally {
      setBusyId(null);
    }
  };

  const handleExecute = async (id: string) => {
    setBusyId(id);
    setError(null);
    setFeedback(null);
    try {
      const key = idempotencyInputs[id]?.trim() || undefined;
      const res = await adminApi.executeAutomationWorkflow(id, { idempotencyKey: key });
      setFeedback(
        res.approvalRequestId
          ? `Workflow queued for independent peer approval (Request ${res.approvalRequestId.slice(0, 8)}).`
          : `Run ${res.run.status}: ${res.run.summary}`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Workflow execution failed.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-12 text-xs text-[#667085]">
        <Loader2 className="h-4 w-4 animate-spin text-[#2D46E6]" />
        <span>Loading Governed Automation Engine...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Kill Switch & Monitoring Strip */}
      {data && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 ${
            data.killSwitchActive
              ? 'border-[#FECACA] bg-[#FEF2F2]'
              : 'border-[#E4E8F2] bg-[#FFFFFF]'
          }`}
        >
          <div className="flex items-center gap-3">
            <ShieldAlert
              className={`h-5 w-5 ${data.killSwitchActive ? 'text-[#DC2626]' : 'text-[#2D46E6]'}`}
            />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-sm font-bold text-[#080B12]">
                  Governed Automation Global Kill Switch
                </h2>
                <span
                  className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                    data.killSwitchActive
                      ? 'border-[#FECACA] bg-[#FFFFFF] text-[#DC2626]'
                      : 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                  }`}
                >
                  {data.killSwitchActive ? 'ACTIVE — ALL RUNS BLOCKED' : 'DISARMED'}
                </span>
              </div>
              <p className="text-xs text-[#475467]">
                Executions are strictly restricted to vetted predefined platform actions (no arbitrary shell, SQL, or external HTTP calls).
              </p>
            </div>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => setKillModalOpen(true)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3.5 text-xs font-semibold text-[#FFFFFF] cursor-pointer ${
                data.killSwitchActive ? 'bg-[#15803D] hover:bg-[#166534]' : 'bg-[#DC2626] hover:bg-[#B91C1C]'
              }`}
            >
              <PowerOff className="h-3.5 w-3.5" />
              <span>{data.killSwitchActive ? 'Disarm Kill Switch' : 'Activate Kill Switch'}</span>
            </button>
          )}
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

      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: 'Workflows', value: data.workflows.length },
            { label: 'Succeeded Runs', value: data.monitoring.successfulExecutions },
            { label: 'Failed / Timeout', value: data.monitoring.failedExecutions },
            { label: 'Skipped / Blocked', value: data.monitoring.skippedOrBlockedExecutions },
            { label: 'Pending / Running', value: data.monitoring.queuedExecutions },
            { label: 'Avg Duration', value: `${data.monitoring.avgDurationMs}ms` },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3">
              <div className="text-[11px] text-[#667085]">{m.label}</div>
              <div className="font-mono text-lg font-bold tabular-nums text-[#080B12]">{m.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Create Governed Workflow */}
      {canManage && (
        <form onSubmit={handleCreate} className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-[#2D46E6]" />
            <h3 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              Register Governed Automation Playbook
            </h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input
              type="text"
              required
              value={workflowKey}
              onChange={(e) => setWorkflowKey(e.target.value)}
              placeholder="workflow-key (e.g. hygiene-scan)"
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 font-mono text-xs"
            />
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display Name"
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs"
            />
            <select
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value as AutomationTriggerType)}
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 text-xs"
            >
              {TRIGGER_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value as AutomationActionType)}
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 text-xs"
            >
              {ACTION_OPTIONS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Operational purpose and bounded scope..."
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs sm:col-span-2"
            />
            {actionType === 'DISABLE_FEATURE_FLAG' && (
              <input
                type="text"
                value={flagKey}
                onChange={(e) => setFlagKey(e.target.value)}
                placeholder="Target flagKey (optional)"
                className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 font-mono text-xs"
              />
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-[#475467]">
              <input
                type="checkbox"
                checked={requiresApproval}
                onChange={(e) => setRequiresApproval(e.target.checked)}
              />
              <span>Require peer approval before execution (high-impact gate)</span>
            </label>
            <button
              type="submit"
              disabled={creating}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2D46E6] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer disabled:opacity-50"
            >
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Create Workflow</span>
            </button>
          </div>
        </form>
      )}

      {/* Workflows Table */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="flex items-center gap-2 border-b border-[#E4E8F2] px-4 py-3">
          <Workflow className="h-4 w-4 text-[#2D46E6]" />
          <h3 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            Registered Automation Workflows
          </h3>
        </div>
        <div className="divide-y divide-[#F1F5F9]">
          {(data?.workflows ?? []).map((wf) => (
            <div key={wf.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 max-w-xl space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-xs font-bold text-[#080B12]">{wf.name}</span>
                  <span className="rounded border border-[#E4E8F2] bg-[#F7F8FA] px-1.5 py-0.5 font-mono text-[10px] text-[#475467]">
                    {wf.workflowKey}
                  </span>
                  <span className="rounded border border-[#C7D2FE] bg-[#EFF2FA] px-1.5 py-0.5 font-mono text-[10px] text-[#2D46E6]">
                    {wf.actionType}
                  </span>
                  {wf.requiresApproval && (
                    <span className="rounded border border-[#FDE68A] bg-[#FFFBEB] px-1.5 py-0.5 font-mono text-[10px] text-[#B45309]">
                      APPROVAL GATE
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-[#667085]">
                    {wf.enabled ? (wf.isPaused ? 'PAUSED' : 'ENABLED') : 'DISABLED'} · Last: {wf.lastStatus}
                  </span>
                </div>
                <p className="text-xs text-[#667085]">{wf.description}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canExecute && (
                  <>
                    <input
                      type="text"
                      value={idempotencyInputs[wf.id] ?? ''}
                      onChange={(e) =>
                        setIdempotencyInputs((prev) => ({ ...prev, [wf.id]: e.target.value }))
                      }
                      placeholder="Idempotency key"
                      aria-label={`Idempotency key for ${wf.name}`}
                      className="h-8 w-44 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono text-[11px] sm:w-48"
                    />
                    <button
                      type="button"
                      disabled={busyId === wf.id}
                      onClick={() => void handleExecute(wf.id)}
                      className="inline-flex h-8 items-center gap-1 rounded-md bg-[#2D46E6] px-3 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer disabled:opacity-50"
                    >
                      <Play className="h-3 w-3" />
                      <span>Execute</span>
                    </button>
                  </>
                )}
                {canManage && (
                  <>
                    <button
                      type="button"
                      disabled={busyId === wf.id}
                      onClick={() => void handleToggleState(wf.id, { isPaused: !wf.isPaused })}
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 text-xs font-semibold text-[#080B12] hover:bg-[#F7F8FA] cursor-pointer"
                    >
                      <Pause className="h-3 w-3" />
                      <span>{wf.isPaused ? 'Resume' : 'Pause'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyId === wf.id}
                      onClick={() => void handleToggleState(wf.id, { enabled: !wf.enabled })}
                      className="inline-flex h-8 items-center rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 text-xs font-semibold text-[#475467] hover:bg-[#F7F8FA] cursor-pointer"
                    >
                      {wf.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Execution Runs */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="border-b border-[#E4E8F2] px-4 py-3 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
          Recent Execution Runs
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-xs">
            <thead>
              <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                <th className="px-4 py-2">Started</th>
                <th className="px-4 py-2">Workflow</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Actor</th>
                <th className="px-4 py-2">Duration</th>
                <th className="px-4 py-2">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {(data?.runs ?? []).slice(0, 20).map((run) => (
                <tr key={run.id} className="hover:bg-[#F7F8FA]">
                  <td className="px-4 py-2 font-mono text-[11px] text-[#667085]">
                    {new Date(run.startedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 font-medium text-[#080B12]">{run.workflowName || run.workflowKey}</td>
                  <td className="px-4 py-2 font-mono text-[10px] font-bold text-[#2D46E6]">{run.status}</td>
                  <td className="px-4 py-2 text-[#475467]">{run.triggeredByEmail}</td>
                  <td className="px-4 py-2 font-mono text-[11px] text-[#667085]">{run.durationMs}ms</td>
                  <td className="px-4 py-2 text-[#475467]">{run.summary || run.errorMessage || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AdminReauthModal
        open={killModalOpen}
        title={data?.killSwitchActive ? 'Disarm Automation Kill Switch' : 'Activate Automation Kill Switch'}
        description="Toggling the global automation kill switch immediately gates all automated workflow runs across Nextrade AI."
        confirmLabel={data?.killSwitchActive ? 'Disarm Kill Switch' : 'Activate Kill Switch'}
        danger={!data?.killSwitchActive}
        requireReason
        onCancel={() => setKillModalOpen(false)}
        onConfirm={async ({ confirmPassword, reason }) => {
          await adminApi.setAutomationKillSwitch(!data?.killSwitchActive, reason, confirmPassword);
          setKillModalOpen(false);
          setFeedback(
            !data?.killSwitchActive
              ? 'Global automation kill switch activated.'
              : 'Global automation kill switch disarmed.',
          );
          await load();
        }}
      />
    </div>
  );
};
