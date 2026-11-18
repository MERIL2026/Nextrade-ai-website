import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertOctagon,
  CheckCircle2,
  Download,
  FileText,
  KeyRound,
  Loader2,
  RotateCcw,
  Search,
  ShieldCheck,
  Sliders,
} from 'lucide-react';
import type {
  AdminAuditLogDto,
  GovernanceConfigEntryView,
  PlatformConfigBundle,
} from '../../admin/types';
import { PERMISSIONS } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import { adminApi, type AdminSystemConfigResponse } from '../../lib/adminApi';
import { AdminReauthModal } from './AdminReauthModal';

interface AdminConfigViewProps {
  onMaintenanceUpdated?: (enabled: boolean) => void;
}

export const AdminConfigView: React.FC<AdminConfigViewProps> = ({ onMaintenanceUpdated }) => {
  const { user } = useAuth();
  const perms = new Set<string>(user?.permissions ?? []);
  const canManageConfig = perms.has(PERMISSIONS.ADMIN_SYSTEM_MANAGE);
  const canEmergency = perms.has(PERMISSIONS.ADMIN_EMERGENCY_EXECUTE);

  const [data, setData] = useState<AdminSystemConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Editable draft mirrors
  const [flags, setFlags] = useState<PlatformConfigBundle['feature_flags'] | null>(null);
  const [maintenance, setMaintenance] = useState<PlatformConfigBundle['maintenance_mode'] | null>(null);
  const [wsDefaults, setWsDefaults] = useState<PlatformConfigBundle['workspace_defaults'] | null>(null);

  // Phase 5 10-Category Governance & Policies
  const [govCategories, setGovCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [govEntries, setGovEntries] = useState<GovernanceConfigEntryView[]>([]);
  const [policiesDraft, setPoliciesDraft] = useState<PlatformConfigBundle['governance_policies'] | null>(null);
  const [reauthGovPolicies, setReauthGovPolicies] = useState(false);

  const [rollbackAuditId, setRollbackAuditId] = useState<string | null>(null);
  const [emergencyOp, setEmergencyOp] = useState<
    'ENABLE_MAINTENANCE' | 'DISABLE_AI' | 'REVOKE_ALL_NON_ADMIN_SESSIONS' | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, govRes] = await Promise.all([
        adminApi.getSystemConfig(),
        adminApi.getTenCategoryConfig().catch(() => null),
      ]);
      setData(res);
      setFlags(res.config.feature_flags);
      setMaintenance(res.config.maintenance_mode);
      setWsDefaults(res.config.workspace_defaults);
      if (govRes) {
        setGovCategories(govRes.categories);
        setGovEntries(govRes.entries);
        setPoliciesDraft(govRes.governancePolicies);
      } else {
        setPoliciesDraft(res.config.governance_policies);
      }
      onMaintenanceUpdated?.(res.config.maintenance_mode.enabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load system configuration.');
    } finally {
      setLoading(false);
    }
  }, [onMaintenanceUpdated]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSaveSection = async <K extends keyof PlatformConfigBundle>(
    key: K,
    value: PlatformConfigBundle[K],
    reason: string,
  ) => {
    setSavingKey(key);
    setError(null);
    setFeedback(null);
    try {
      const res = await adminApi.updateSystemConfig(key, value, reason);
      onMaintenanceUpdated?.(res.config.maintenance_mode.enabled);
      setFeedback(`Updated configuration "${key}".`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to update "${key}".`);
    } finally {
      setSavingKey(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] text-xs text-[#667085]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#2D46E6]" />
        Loading System Configuration...
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

      {flags && maintenance && wsDefaults && data && (
        <>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Feature Flags */}
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
              <div className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                <Sliders className="h-4 w-4 text-[#2D46E6]" />
                <span>Feature Flags</span>
              </div>
              <div className="space-y-2 text-xs">
                {(
                  [
                    ['aiResearchEnabled', 'AI Financial Research'],
                    ['paperTradingEnabled', 'Simulated Paper Trading'],
                    ['publicRegistrationEnabled', 'Public Account Registration'],
                    ['announcementsBannerEnabled', 'Workspace Announcements Banner'],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="flex items-center justify-between py-1">
                    <span className="text-[#080B12]">{label}</span>
                    <input
                      type="checkbox"
                      disabled={!canManageConfig}
                      checked={flags[k]}
                      onChange={(e) => setFlags({ ...flags, [k]: e.target.checked })}
                      className="h-4 w-4 accent-[#2D46E6]"
                    />
                  </label>
                ))}
              </div>
              {canManageConfig && (
                <button
                  type="button"
                  disabled={savingKey === 'feature_flags'}
                  onClick={() =>
                    void handleSaveSection('feature_flags', flags, 'Admin feature flag update')
                  }
                  className="h-9 w-full rounded-md bg-[#2D46E6] text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer disabled:opacity-50"
                >
                  {savingKey === 'feature_flags' ? 'Saving...' : 'Save Feature Flags'}
                </button>
              )}
            </div>

            {/* Maintenance Mode */}
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
              <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                Maintenance Mode Gate
              </h2>
              <label className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#080B12]">Enable Maintenance Mode</span>
                <input
                  type="checkbox"
                  disabled={!canManageConfig}
                  checked={maintenance.enabled}
                  onChange={(e) => setMaintenance({ ...maintenance, enabled: e.target.checked })}
                  className="h-4 w-4 accent-[#D97706]"
                />
              </label>
              <textarea
                rows={3}
                disabled={!canManageConfig}
                value={maintenance.message}
                onChange={(e) => setMaintenance({ ...maintenance, message: e.target.value })}
                className="w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] p-2.5 text-xs"
              />
              <p className="text-[11px] text-[#667085]">
                Admin recovery routes (<code className="font-mono">/admin</code>,{' '}
                <code className="font-mono">/api/admin</code>, <code className="font-mono">/api/auth</code>) always remain open.
              </p>
              {canManageConfig && (
                <button
                  type="button"
                  disabled={savingKey === 'maintenance_mode'}
                  onClick={() =>
                    void handleSaveSection(
                      'maintenance_mode',
                      maintenance,
                      maintenance.enabled ? 'Enabled maintenance mode' : 'Disabled maintenance mode',
                    )
                  }
                  className="h-9 w-full rounded-md bg-[#080B12] text-xs font-semibold text-[#FFFFFF] hover:bg-[#1E293B] cursor-pointer disabled:opacity-50"
                >
                  {savingKey === 'maintenance_mode' ? 'Saving...' : 'Apply Maintenance Gate'}
                </button>
              )}
            </div>

            {/* Workspace Defaults */}
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
              <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                Workspace Defaults
              </h2>
              <div className="space-y-2 text-xs">
                <label className="block space-y-1">
                  <span className="text-[11px] text-[#475467]">Default Market Region</span>
                  <select
                    disabled={!canManageConfig}
                    value={wsDefaults.defaultRegion}
                    onChange={(e) =>
                      setWsDefaults({
                        ...wsDefaults,
                        defaultRegion: e.target.value as PlatformConfigBundle['workspace_defaults']['defaultRegion'],
                      })
                    }
                    className="h-9 w-full rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5"
                  >
                    <option value="ALL">ALL (India + US)</option>
                    <option value="IN">IN (NSE / BSE)</option>
                    <option value="US">US (NYSE / NASDAQ)</option>
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] text-[#475467]">Default Display Currency</span>
                  <select
                    disabled={!canManageConfig}
                    value={wsDefaults.defaultCurrency}
                    onChange={(e) =>
                      setWsDefaults({
                        ...wsDefaults,
                        defaultCurrency: e.target.value as 'USD' | 'INR',
                      })
                    }
                    className="h-9 w-full rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5"
                  >
                    <option value="USD">USD ($)</option>
                    <option value="INR">INR (₹)</option>
                  </select>
                </label>
              </div>
              {canManageConfig && (
                <button
                  type="button"
                  disabled={savingKey === 'workspace_defaults'}
                  onClick={() =>
                    void handleSaveSection(
                      'workspace_defaults',
                      wsDefaults,
                      'Updated workspace defaults',
                    )
                  }
                  className="h-9 w-full rounded-md border border-[#E4E8F2] bg-[#FFFFFF] text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] cursor-pointer"
                >
                  Save Workspace Defaults
                </button>
              )}
            </div>
          </div>

          {/* Emergency Operations (Super Admin + Reauth) */}
          {canEmergency && (
            <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2]/60 p-4 space-y-3">
              <div className="flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#B91C1C]">
                <AlertOctagon className="h-4 w-4" />
                <span>Emergency Operations (Super Admin + Re-Authentication)</span>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setEmergencyOp('ENABLE_MAINTENANCE')}
                  className="h-9 rounded-md bg-[#DC2626] px-3.5 text-xs font-semibold text-[#FFFFFF] hover:bg-[#B91C1C] cursor-pointer"
                >
                  Emergency Maintenance Lock
                </button>
                <button
                  type="button"
                  onClick={() => setEmergencyOp('DISABLE_AI')}
                  className="h-9 rounded-md border border-[#FECACA] bg-[#FFFFFF] px-3.5 text-xs font-semibold text-[#B91C1C] hover:bg-[#FEE2E2] cursor-pointer"
                >
                  Emergency Kill-Switch AI
                </button>
                <button
                  type="button"
                  onClick={() => setEmergencyOp('REVOKE_ALL_NON_ADMIN_SESSIONS')}
                  className="h-9 rounded-md border border-[#FECACA] bg-[#FFFFFF] px-3.5 text-xs font-semibold text-[#B91C1C] hover:bg-[#FEE2E2] cursor-pointer"
                >
                  Revoke All Non-Admin Sessions
                </button>
              </div>
            </div>
          )}

          {/* Phase 5: Governance Policies (Re-Authenticated) */}
          {policiesDraft && (
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F5F9] pb-3">
                <div>
                  <h2 className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                    <ShieldCheck className="h-4 w-4 text-[#2D46E6]" />
                    <span>Platform Governance Policies (Re-Auth Required)</span>
                  </h2>
                  <p className="text-[11px] text-[#667085] mt-0.5">
                    Retention windows, privacy export TTLs, authentication session lifetimes, and alert escalation defaults.
                  </p>
                </div>
                {canManageConfig && (
                  <button
                    type="button"
                    onClick={() => setReauthGovPolicies(true)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2D46E6] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    <span>Save Governance Policies</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
                <label className="space-y-1">
                  <span className="text-[11px] text-[#475467]">Export Link TTL (hrs)</span>
                  <input
                    type="number"
                    min={1}
                    max={168}
                    disabled={!canManageConfig}
                    value={policiesDraft.exportLinkExpiryHours}
                    onChange={(e) =>
                      setPoliciesDraft({
                        ...policiesDraft,
                        exportLinkExpiryHours: Number(e.target.value) || 24,
                      })
                    }
                    className="h-9 w-full rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-[#475467]">Deletion Grace (days)</span>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    disabled={!canManageConfig}
                    value={policiesDraft.deletionGracePeriodDays}
                    onChange={(e) =>
                      setPoliciesDraft({
                        ...policiesDraft,
                        deletionGracePeriodDays: Number(e.target.value) || 7,
                      })
                    }
                    className="h-9 w-full rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-[#475467]">Telemetry Retention (d)</span>
                  <input
                    type="number"
                    min={7}
                    max={365}
                    disabled={!canManageConfig}
                    value={policiesDraft.telemetryRetentionDays}
                    onChange={(e) =>
                      setPoliciesDraft({
                        ...policiesDraft,
                        telemetryRetentionDays: Number(e.target.value) || 30,
                      })
                    }
                    className="h-9 w-full rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-[#475467]">Audit Retention (d)</span>
                  <input
                    type="number"
                    min={30}
                    max={3650}
                    disabled={!canManageConfig}
                    value={policiesDraft.auditRetentionDays}
                    onChange={(e) =>
                      setPoliciesDraft({
                        ...policiesDraft,
                        auditRetentionDays: Number(e.target.value) || 365,
                      })
                    }
                    className="h-9 w-full rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-[#475467]">Session TTL (hrs)</span>
                  <input
                    type="number"
                    min={1}
                    max={720}
                    disabled={!canManageConfig}
                    value={policiesDraft.sessionTtlHours}
                    onChange={(e) =>
                      setPoliciesDraft({
                        ...policiesDraft,
                        sessionTtlHours: Number(e.target.value) || 24,
                      })
                    }
                    className="h-9 w-full rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-[#475467]">Remember Me (days)</span>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    disabled={!canManageConfig}
                    value={policiesDraft.rememberMeDays}
                    onChange={(e) =>
                      setPoliciesDraft({
                        ...policiesDraft,
                        rememberMeDays: Number(e.target.value) || 14,
                      })
                    }
                    className="h-9 w-full rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono"
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-5 text-xs pt-1">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={!canManageConfig}
                    checked={policiesDraft.requireEmailVerificationForLogin}
                    onChange={(e) =>
                      setPoliciesDraft({
                        ...policiesDraft,
                        requireEmailVerificationForLogin: e.target.checked,
                      })
                    }
                    className="h-4 w-4 accent-[#2D46E6]"
                  />
                  <span>Require Email Verification for Login</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={!canManageConfig}
                    checked={policiesDraft.securityDigestEnabled}
                    onChange={(e) =>
                      setPoliciesDraft({
                        ...policiesDraft,
                        securityDigestEnabled: e.target.checked,
                      })
                    }
                    className="h-4 w-4 accent-[#2D46E6]"
                  />
                  <span>Security Digest Notifications Enabled</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={!canManageConfig}
                    checked={policiesDraft.alertEscalationEmailEnabled}
                    onChange={(e) =>
                      setPoliciesDraft({
                        ...policiesDraft,
                        alertEscalationEmailEnabled: e.target.checked,
                      })
                    }
                    className="h-4 w-4 accent-[#2D46E6]"
                  />
                  <span>Alert Escalation Email Routing</span>
                </label>
              </div>
            </div>
          )}

          {/* Phase 5: 10-Category Platform Configuration Governance Inventory */}
          {govEntries.length > 0 && (
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E4E8F2] px-4 py-3">
                <div>
                  <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                    10-Category Configuration Governance Matrix ({govEntries.length} Controls)
                  </h2>
                  <p className="text-[11px] text-[#667085]">
                    Secrets display status only (<code className="font-mono">CONFIGURED</code> /{' '}
                    <code className="font-mono">NOT_CONFIGURED</code>); raw credentials are never rendered.
                  </p>
                </div>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  aria-label="Filter configuration category"
                  className="h-8 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono text-xs"
                >
                  <option value="ALL">All Categories ({govCategories.length})</option>
                  {govCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                      <th className="px-4 py-2">Category</th>
                      <th className="px-3 py-2">Control / Key</th>
                      <th className="px-3 py-2">Classification</th>
                      <th className="px-4 py-2">Value / Secret Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9]">
                    {govEntries
                      .filter((entry) => selectedCategory === 'ALL' || entry.category === selectedCategory)
                      .map((entry) => {
                        const displayVal =
                          typeof entry.value === 'boolean'
                            ? entry.value
                              ? 'ENABLED'
                              : 'DISABLED'
                            : typeof entry.value === 'object' && entry.value !== null
                              ? JSON.stringify(entry.value)
                              : String(entry.value ?? '—');
                        return (
                          <tr key={`${entry.category}:${entry.key}`} className="h-9 hover:bg-[#F7F8FA]">
                            <td className="px-4 py-2 font-mono text-[11px] font-semibold text-[#2D46E6]">
                              {entry.category}
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-medium text-[#080B12]">{entry.label}</div>
                              <div className="font-mono text-[10px] text-[#94A3B8]">{entry.key}</div>
                            </td>
                            <td className="px-3 py-2 font-mono text-[10px]">
                              <span
                                className={`rounded border px-2 py-0.5 font-semibold ${
                                  entry.classification === 'PRIVATE'
                                    ? 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]'
                                    : 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                                }`}
                              >
                                {entry.classification}
                              </span>
                            </td>
                            <td className="px-4 py-2 font-mono text-[11px] text-[#080B12] max-w-[280px] truncate">
                              {entry.valueType === 'secret_status' ? (
                                <span
                                  className={
                                    displayVal === 'CONFIGURED'
                                      ? 'font-semibold text-[#15803D]'
                                      : 'font-semibold text-[#64748B]'
                                  }
                                >
                                  {displayVal}
                                </span>
                              ) : (
                                displayVal
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Config Revision Audit & Rollback */}
          <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
            <div className="border-b border-[#E4E8F2] px-4 py-3">
              <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                Configuration Revision History & Rollback
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                    <th className="px-4 py-2">Key</th>
                    <th className="px-3 py-2">Reason</th>
                    <th className="px-3 py-2">Timestamp</th>
                    <th className="px-4 py-2 text-right">Rollback</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {data.configAudit.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-[#667085]">
                        No configuration changes audited yet.
                      </td>
                    </tr>
                  ) : (
                    data.configAudit.map((row) => (
                      <tr key={row.id} className="h-10 hover:bg-[#F7F8FA]">
                        <td className="px-4 py-2 font-mono font-semibold text-[#080B12]">
                          {row.configKey}
                        </td>
                        <td className="px-3 py-2 text-[#475467]">{row.reason || '—'}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-[#667085]">
                          {new Date(row.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {canManageConfig && row.previousValueRedacted && (
                            <button
                              type="button"
                              onClick={() => setRollbackAuditId(row.id)}
                              className="inline-flex items-center gap-1 rounded border border-[#E4E8F2] px-2.5 py-0.5 text-[11px] font-semibold text-[#2D46E6] hover:border-[#2D46E6] cursor-pointer"
                            >
                              <RotateCcw className="h-3 w-3" />
                              <span>Restore Previous</span>
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
        </>
      )}

      <AdminReauthModal
        open={Boolean(rollbackAuditId)}
        title="Rollback Configuration Snapshot"
        description="Restoring a previous configuration snapshot overwrites current runtime settings for that key and writes a new audit entry."
        confirmLabel="Confirm Rollback"
        onCancel={() => setRollbackAuditId(null)}
        onConfirm={async ({ confirmPassword }) => {
          if (!rollbackAuditId) return;
          await adminApi.rollbackSystemConfig(rollbackAuditId, confirmPassword);
          setRollbackAuditId(null);
          setFeedback('Configuration snapshot rolled back.');
          await load();
        }}
      />

      <AdminReauthModal
        open={Boolean(emergencyOp)}
        title={`Execute Emergency Action: ${emergencyOp}`}
        description="Emergency platform operations immediately affect user traffic or active sessions and are permanently recorded in admin_audit_logs."
        confirmLabel="Execute Emergency Action"
        danger
        requireReason
        onCancel={() => setEmergencyOp(null)}
        onConfirm={async ({ confirmPassword, reason }) => {
          if (!emergencyOp) return;
          const res = await adminApi.executeEmergency(emergencyOp, reason, confirmPassword);
          setEmergencyOp(null);
          setFeedback(res.detail);
          await load();
        }}
      />

      <AdminReauthModal
        open={reauthGovPolicies}
        title="Confirm Governance Policy Update"
        description="Modifying retention windows, deletion grace periods, or authentication session TTLs affects platform governance controls and writes an immutable audit record."
        confirmLabel="Apply Governance Policies"
        requireReason
        onCancel={() => setReauthGovPolicies(false)}
        onConfirm={async ({ confirmPassword, reason }) => {
          if (!policiesDraft) return;
          await adminApi.updateGovernancePolicies(
            policiesDraft,
            reason || 'Governance policy update',
            confirmPassword,
          );
          setReauthGovPolicies(false);
          setFeedback('Governance policies updated and audited.');
          await load();
        }}
      />
    </div>
  );
};

export const AdminAuditLogsView: React.FC = () => {
  const [search, setSearch] = useState('');
  const [resultFilter, setResultFilter] = useState('ALL');
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const [logs, setLogs] = useState<AdminAuditLogDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.listAuditLogs({
        search: search.trim() || undefined,
        result: resultFilter,
        limit,
        offset,
      });
      setLogs(res.logs);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load audit logs.');
    } finally {
      setLoading(false);
    }
  }, [search, resultFilter, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative min-w-[220px] flex-1 max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#667085]" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setOffset(0);
                setSearch(e.target.value);
              }}
              placeholder="Search actor email, action, or target..."
              className="h-9 w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] pl-8 pr-3 text-xs"
            />
          </div>
          <select
            value={resultFilter}
            onChange={(e) => {
              setOffset(0);
              setResultFilter(e.target.value);
            }}
            className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono text-xs"
          >
            <option value="ALL">All Results</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="DENIED">DENIED</option>
            <option value="ERROR">ERROR</option>
          </select>
        </div>

        <a
          href="/api/admin/audit-logs/export"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6]"
        >
          <Download className="h-3.5 w-3.5" />
          <span>Export Audit CSV</span>
        </a>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-2.5 text-xs text-[#B91C1C]">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="flex items-center justify-between border-b border-[#E4E8F2] px-4 py-3">
          <span className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            <FileText className="h-4 w-4 text-[#2D46E6]" />
            <span>Append-Only Immutable Audit Stream ({total})</span>
          </span>
          <span className="font-mono text-[10px] uppercase text-[#667085]">PUT / PATCH / DELETE Blocked (405)</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                <th className="px-4 py-2">Timestamp</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Resource</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-4 py-2">Redacted State Diff</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[#667085]">
                    <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin text-[#2D46E6]" />
                    Loading audit log...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[#667085]">
                    No audit log records matched.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-[#F7F8FA] align-top">
                    <td className="px-4 py-2.5 font-mono text-[11px] whitespace-nowrap text-[#667085]">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-[#080B12]">
                      <div className="font-medium">{log.adminEmail}</div>
                      <div className="font-mono text-[10px] text-[#94A3B8]">{log.ipAddress}</div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] font-semibold text-[#080B12]">
                      {log.action}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-[#475467]">
                      {log.resourceType}
                      {log.resourceId ? `:${log.resourceId.slice(0, 12)}` : ''}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[10px] font-semibold">
                      <span
                        className={
                          log.result === 'SUCCESS'
                            ? 'text-[#15803D]'
                            : log.result === 'DENIED'
                              ? 'text-[#B91C1C]'
                              : 'text-[#B45309]'
                        }
                      >
                        {log.result}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[10px] text-[#475467] max-w-[320px] break-all">
                      {log.previousValueRedacted && <div>− {log.previousValueRedacted}</div>}
                      {log.newValueRedacted && <div className="text-[#080B12]">+ {log.newValueRedacted}</div>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-[#E4E8F2] px-4 py-2.5 text-xs">
          <span className="font-mono text-[11px] text-[#667085]">
            {total === 0 ? 0 : offset + 1}–{Math.min(offset + limit, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
              className="h-8 rounded border border-[#E4E8F2] px-3 text-xs font-semibold disabled:opacity-40 cursor-pointer"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={offset + limit >= total}
              onClick={() => setOffset(offset + limit)}
              className="h-8 rounded border border-[#E4E8F2] px-3 text-xs font-semibold disabled:opacity-40 cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
