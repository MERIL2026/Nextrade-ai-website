import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Play,
  Rocket,
  Server,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { MaintenanceWindowDto, ReleaseRecordDto } from '../../admin/types';
import type { UserRole } from '../../auth/db';
import { PERMISSIONS } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import { adminApi } from '../../lib/adminApi';

const BYPASS_ROLE_OPTIONS: UserRole[] = ['super_admin', 'admin', 'security_admin', 'support_admin'];

export const AdminReleasesView: React.FC<{ onMaintenanceUpdated?: (enabled: boolean) => void }> = ({
  onMaintenanceUpdated,
}) => {
  const { user } = useAuth();
  const perms = new Set<string>(user?.permissions ?? []);
  const canManageReleases = perms.has(PERMISSIONS.ADMIN_RELEASES_MANAGE);
  const canManageMaint = perms.has(PERMISSIONS.ADMIN_MAINTENANCE_MANAGE);

  const [runtimeMetadata, setRuntimeMetadata] = useState<{
    appName: string;
    version: string;
    nodeVersion: string;
    environment: string;
    dialect: string;
    latestMigration: string;
    ciCdWebhookConfigured: boolean;
    ciCdNote: string;
  } | null>(null);
  const [effectiveMaint, setEffectiveMaint] = useState<{
    active: boolean;
    bypassed: boolean;
    source: string;
    message: string;
    expectedCompletionNote: string;
    endsAt: string | null;
  } | null>(null);
  const [releases, setReleases] = useState<ReleaseRecordDto[]>([]);
  const [windows, setWindows] = useState<MaintenanceWindowDto[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Manual release form
  const [relVersion, setRelVersion] = useState('');
  const [relSummary, setRelSummary] = useState('');
  const [relCommit, setRelCommit] = useState('');

  // Maintenance window form
  const [mwTitle, setMwTitle] = useState('');
  const [mwMessage, setMwMessage] = useState('');
  const [mwExpectedNote, setMwExpectedNote] = useState('');
  const [mwBypassRoles, setMwBypassRoles] = useState<UserRole[]>(['super_admin', 'admin']);
  const [mwActivateNow, setMwActivateNow] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getReleasesAndMaintenance();
      setRuntimeMetadata(res.runtimeMetadata);
      setEffectiveMaint(res.effectiveMaintenance);
      setReleases(res.releases);
      setWindows(res.maintenanceWindows);
      onMaintenanceUpdated?.(res.effectiveMaintenance.active);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load release & maintenance telemetry.');
    } finally {
      setLoading(false);
    }
  }, [onMaintenanceUpdated]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreateRelease = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('release');
    setError(null);
    setFeedback(null);
    try {
      await adminApi.createManualRelease({
        version: relVersion.trim(),
        summary: relSummary.trim(),
        commitRef: relCommit.trim() || undefined,
      });
      setRelVersion('');
      setRelSummary('');
      setRelCommit('');
      setFeedback('Manual release recorded cleanly.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create release record.');
    } finally {
      setBusy(null);
    }
  };

  const handleCreateWindow = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('window');
    setError(null);
    setFeedback(null);
    try {
      await adminApi.createMaintenanceWindow({
        title: mwTitle.trim(),
        message: mwMessage.trim(),
        expectedCompletionNote: mwExpectedNote.trim() || undefined,
        bypassRoles: mwBypassRoles,
        activateImmediately: mwActivateNow,
      });
      setMwTitle('');
      setMwMessage('');
      setMwExpectedNote('');
      setMwActivateNow(false);
      setFeedback('Maintenance window created.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule maintenance window.');
    } finally {
      setBusy(null);
    }
  };

  const handleWindowAction = async (id: string, action: 'activate' | 'complete' | 'cancel') => {
    setBusy(id);
    setError(null);
    setFeedback(null);
    try {
      await adminApi.updateMaintenanceWindow(id, action);
      setFeedback(`Maintenance window action "${action}" applied.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update maintenance window.');
    } finally {
      setBusy(null);
    }
  };

  if (loading && !runtimeMetadata) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] text-xs text-[#667085]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#2D46E6]" />
        Loading Releases & Maintenance Controls...
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

      {/* Runtime Metadata */}
      {runtimeMetadata && (
        <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
          <div className="flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            <Server className="h-4 w-4 text-[#2D46E6]" />
            <span>Runtime Metadata (Live Process Inspection)</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              { label: 'App Version', val: `v${runtimeMetadata.version}` },
              { label: 'Environment', val: runtimeMetadata.environment },
              { label: 'DB Dialect', val: runtimeMetadata.dialect },
              { label: 'Node Runtime', val: runtimeMetadata.nodeVersion },
              { label: 'Schema Migration', val: runtimeMetadata.latestMigration },
            ].map((item) => (
              <div key={item.label} className="rounded-md border border-[#E4E8F2] bg-[#F7F8FA] p-3">
                <div className="text-[11px] text-[#667085]">{item.label}</div>
                <div className="font-mono text-xs font-bold text-[#080B12] truncate">{item.val}</div>
              </div>
            ))}
          </div>
          <div className="rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 py-2 text-[11px] text-[#475467]">
            {runtimeMetadata.ciCdNote}
          </div>
        </div>
      )}

      {/* Effective Maintenance Status */}
      {effectiveMaint && (
        <div
          className={`rounded-lg border p-4 text-xs ${
            effectiveMaint.active
              ? 'border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]'
              : 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
          }`}
        >
          <div className="font-mono text-[11px] font-bold uppercase">
            Effective Platform Gate: {effectiveMaint.active ? `MAINTENANCE ACTIVE (${effectiveMaint.source})` : 'OPERATIONAL (NORMAL TRAFFIC)'}
          </div>
          {effectiveMaint.active && (
            <div className="mt-1 space-y-0.5 text-[11px]">
              <div>Notice: {effectiveMaint.message}</div>
              {effectiveMaint.expectedCompletionNote && (
                <div>Expected completion: {effectiveMaint.expectedCompletionNote}</div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Manual Release Ledger Form */}
        {canManageReleases && (
          <form
            onSubmit={handleCreateRelease}
            className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3"
          >
            <div className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              <Rocket className="h-4 w-4 text-[#2D46E6]" />
              <span>Record Manual Release</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <input
                type="text"
                value={relVersion}
                onChange={(e) => setRelVersion(e.target.value)}
                placeholder="Version (e.g. v1.5.1)"
                required
                className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 font-mono text-xs text-[#080B12]"
              />
              <input
                type="text"
                value={relCommit}
                onChange={(e) => setRelCommit(e.target.value)}
                placeholder="Commit SHA (optional)"
                className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 font-mono text-xs text-[#080B12]"
              />
            </div>
            <input
              type="text"
              value={relSummary}
              onChange={(e) => setRelSummary(e.target.value)}
              placeholder="Release summary (e.g. Phase 5 Governance rollout)..."
              required
              className="h-9 w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs text-[#080B12]"
            />
            <button
              type="submit"
              disabled={busy === 'release'}
              className="h-9 rounded-md bg-[#2D46E6] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer disabled:opacity-50"
            >
              {busy === 'release' ? 'Recording...' : 'Record Release'}
            </button>
          </form>
        )}

        {/* Schedule Maintenance Window Form */}
        {canManageMaint && (
          <form
            onSubmit={handleCreateWindow}
            className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3"
          >
            <div className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              <Wrench className="h-4 w-4 text-[#D97706]" />
              <span>Schedule / Activate Maintenance Window</span>
            </div>
            <input
              type="text"
              value={mwTitle}
              onChange={(e) => setMwTitle(e.target.value)}
              placeholder="Window title (e.g. Ledger Index Upgrade)"
              required
              className="h-9 w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs text-[#080B12]"
            />
            <textarea
              rows={2}
              value={mwMessage}
              onChange={(e) => setMwMessage(e.target.value)}
              placeholder="Public maintenance notice displayed to blocked users..."
              required
              className="w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] p-2.5 text-xs text-[#080B12]"
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="text"
                value={mwExpectedNote}
                onChange={(e) => setMwExpectedNote(e.target.value)}
                placeholder="Expected completion (e.g. ~15 mins)"
                className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs text-[#080B12]"
              />
              <label className="flex items-center gap-2 text-xs text-[#080B12] px-1">
                <input
                  type="checkbox"
                  checked={mwActivateNow}
                  onChange={(e) => setMwActivateNow(e.target.checked)}
                  className="h-4 w-4 accent-[#D97706]"
                />
                <span>Activate immediately</span>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-[#667085] mr-1">Bypass Roles:</span>
              {BYPASS_ROLE_OPTIONS.map((r) => {
                const active = mwBypassRoles.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() =>
                      setMwBypassRoles((prev) =>
                        prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
                      )
                    }
                    className={`rounded border px-2 py-0.5 font-mono text-[10px] cursor-pointer ${
                      active
                        ? 'border-[#2D46E6] bg-[#EFF2FA] font-semibold text-[#2D46E6]'
                        : 'border-[#E4E8F2] bg-[#F7F8FA] text-[#667085]'
                    }`}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
            <button
              type="submit"
              disabled={busy === 'window'}
              className="h-9 rounded-md bg-[#080B12] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#1E293B] cursor-pointer disabled:opacity-50"
            >
              {busy === 'window' ? 'Saving...' : 'Save Maintenance Window'}
            </button>
          </form>
        )}
      </div>

      {/* Maintenance Windows Table */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="border-b border-[#E4E8F2] px-4 py-3">
          <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            Maintenance Windows & History ({windows.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                <th className="px-4 py-2">Window</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Bypass Roles</th>
                <th className="px-3 py-2">Schedule</th>
                <th className="px-4 py-2 text-right">Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {windows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-[#667085]">
                    No maintenance windows recorded.
                  </td>
                </tr>
              ) : (
                windows.map((w) => (
                  <tr key={w.id} className="h-12 hover:bg-[#F7F8FA]">
                    <td className="px-4 py-2">
                      <div className="font-semibold text-[#080B12]">{w.title}</div>
                      <div className="text-[11px] text-[#667085] max-w-xs truncate">{w.message}</div>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] font-semibold">
                      <span
                        className={`rounded border px-2 py-0.5 ${
                          w.status === 'ACTIVE'
                            ? 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]'
                            : w.status === 'COMPLETED'
                              ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                              : 'border-[#CBD5E1] bg-[#F8FAFC] text-[#475467]'
                        }`}
                      >
                        {w.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-[#475467]">
                      {w.bypassRoles.join(', ')}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-[#667085]">
                      {new Date(w.startsAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {canManageMaint && (w.status === 'SCHEDULED' || w.status === 'ACTIVE') && (
                        <div className="inline-flex gap-1.5">
                          {w.status === 'SCHEDULED' && (
                            <button
                              type="button"
                              disabled={busy === w.id}
                              onClick={() => void handleWindowAction(w.id, 'activate')}
                              className="inline-flex items-center gap-1 rounded bg-[#D97706] px-2.5 py-1 text-[11px] font-semibold text-[#FFFFFF] cursor-pointer"
                            >
                              <Play className="h-3 w-3" />
                              <span>Activate</span>
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy === w.id}
                            onClick={() => void handleWindowAction(w.id, 'complete')}
                            className="inline-flex items-center gap-1 rounded bg-[#15803D] px-2.5 py-1 text-[11px] font-semibold text-[#FFFFFF] cursor-pointer"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            <span>Complete</span>
                          </button>
                          <button
                            type="button"
                            disabled={busy === w.id}
                            onClick={() => void handleWindowAction(w.id, 'cancel')}
                            className="inline-flex items-center gap-1 rounded border border-[#E4E8F2] px-2 py-1 text-[11px] font-semibold text-[#64748B] cursor-pointer"
                          >
                            <XCircle className="h-3 w-3" />
                            <span>Cancel</span>
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

      {/* Release Ledger */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="border-b border-[#E4E8F2] px-4 py-3">
          <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            Release Records ({releases.length})
          </h2>
        </div>
        <div className="divide-y divide-[#F1F5F9]">
          {releases.map((r) => (
            <div key={r.id} className="px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-[#2D46E6]">{r.version}</span>
                  <span className="rounded border border-[#E4E8F2] bg-[#F7F8FA] px-1.5 py-0.5 font-mono text-[10px]">
                    {r.releaseType}
                  </span>
                  <span className="rounded border border-[#E4E8F2] bg-[#F7F8FA] px-1.5 py-0.5 font-mono text-[10px]">
                    {r.status}
                  </span>
                </div>
                <div className="text-[#080B12]">{r.summary}</div>
              </div>
              <div className="font-mono text-[10px] text-[#667085] text-right">
                <div>{r.deployedByEmail}</div>
                <div>{new Date(r.deployedAt).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
