import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Flag,
  Loader2,
  Plus,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import type { FeatureEnvScope, FeatureFlagDto, FeatureFlagHistoryDto } from '../../admin/types';
import type { UserRole } from '../../auth/db';
import { PERMISSIONS } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import { adminApi } from '../../lib/adminApi';

const TARGETABLE_ROLES: UserRole[] = [
  'user',
  'viewer',
  'support_admin',
  'data_admin',
  'ai_admin',
  'security_admin',
  'admin',
  'super_admin',
];

export const AdminFeaturesView: React.FC = () => {
  const { user } = useAuth();
  const perms = new Set<string>(user?.permissions ?? []);
  const canManage = perms.has(PERMISSIONS.ADMIN_FEATURES_MANAGE);

  const [environment, setEnvironment] = useState('development');
  const [flags, setFlags] = useState<FeatureFlagDto[]>([]);
  const [history, setHistory] = useState<FeatureFlagHistoryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Create form state
  const [flagKey, setFlagKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [envScope, setEnvScope] = useState<FeatureEnvScope>('all');
  const [rolloutPct, setRolloutPct] = useState(100);
  const [selectedRoles, setSelectedRoles] = useState<UserRole[]>([]);
  const [isKillSwitch, setIsKillSwitch] = useState(false);
  const [clientExposed, setClientExposed] = useState(false);
  const [enabled, setEnabled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.listFeatureFlags();
      setEnvironment(res.environment);
      setFlags(res.flags);
      setHistory(res.history);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load feature flags.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleRoleTarget = (role: UserRole) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyId('create');
    setError(null);
    setFeedback(null);
    try {
      await adminApi.createFeatureFlag({
        flagKey: flagKey.trim(),
        name: name.trim(),
        description: description.trim(),
        enabled,
        environmentScope: envScope,
        rolloutPercentage: rolloutPct,
        targetRoles: selectedRoles,
        isKillSwitch,
        clientExposed,
        reason: 'Created via Feature Flags Control Centre',
      });
      setFlagKey('');
      setName('');
      setDescription('');
      setSelectedRoles([]);
      setFeedback('Feature flag created and recorded in governance audit log.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create feature flag.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleFlag = async (flag: FeatureFlagDto) => {
    setBusyId(flag.id);
    setError(null);
    setFeedback(null);
    try {
      await adminApi.updateFeatureFlag(flag.id, {
        enabled: !flag.enabled,
        reason: !flag.enabled ? 'Enabled feature flag' : 'Disabled feature flag / kill switch',
      });
      setFeedback(`Updated "${flag.flagKey}" to ${!flag.enabled ? 'ENABLED' : 'DISABLED'}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update flag.');
    } finally {
      setBusyId(null);
    }
  };

  const handleStepRollout = async (flag: FeatureFlagDto, nextPct: number) => {
    setBusyId(flag.id);
    setError(null);
    try {
      await adminApi.updateFeatureFlag(flag.id, {
        rolloutPercentage: nextPct,
        reason: `Adjusted rollout percentage to ${nextPct}%`,
      });
      setFeedback(`Adjusted rollout for "${flag.flagKey}" to ${nextPct}%.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to adjust rollout.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRollback = async (historyId: string) => {
    setBusyId(historyId);
    setError(null);
    setFeedback(null);
    try {
      const res = await adminApi.rollbackFeatureFlag(historyId);
      setFeedback(`Rolled back "${res.flag.flagKey}" cleanly.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollback failed.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading && flags.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] text-xs text-[#667085]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#2D46E6]" />
        Loading Feature Flags & Rollout Controls...
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

      {/* Create Feature Flag */}
      {canManage && (
        <form
          onSubmit={handleCreate}
          className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              <Plus className="h-4 w-4 text-[#2D46E6]" />
              <span>Register Feature Flag / Rollout Gate</span>
            </div>
            <span className="font-mono text-[10px] uppercase text-[#667085]">
              Active Env: {environment}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input
              type="text"
              value={flagKey}
              onChange={(e) => setFlagKey(e.target.value)}
              placeholder="flag.key (e.g. ai.explain_v2)"
              required
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 font-mono text-xs text-[#080B12]"
            />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display Name"
              required
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs text-[#080B12]"
            />
            <div className="flex gap-2">
              <select
                value={envScope}
                onChange={(e) => setEnvScope(e.target.value as FeatureEnvScope)}
                aria-label="Environment Scope"
                className="h-9 flex-1 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono text-xs text-[#080B12]"
              >
                <option value="all">env: all</option>
                <option value="production">env: production</option>
                <option value="development">env: development</option>
                <option value="staging">env: staging</option>
              </select>
              <input
                type="number"
                min={0}
                max={100}
                value={rolloutPct}
                onChange={(e) => setRolloutPct(Number(e.target.value))}
                aria-label="Rollout Percentage"
                className="h-9 w-20 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono text-xs text-[#080B12]"
              />
            </div>
          </div>

          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Operational description & blast-radius notes..."
            className="h-9 w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs text-[#080B12]"
          />

          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 accent-[#2D46E6]"
              />
              <span>Enabled Immediately</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={clientExposed}
                onChange={(e) => setClientExposed(e.target.checked)}
                className="h-4 w-4 accent-[#2D46E6]"
              />
              <span>Expose via /api/features/evaluated (non-internal)</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={isKillSwitch}
                onChange={(e) => setIsKillSwitch(e.target.checked)}
                className="h-4 w-4 accent-[#DC2626]"
              />
              <span className="text-[#DC2626] font-semibold">Emergency Kill Switch</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-[#667085] mr-1">Target Roles (optional):</span>
            {TARGETABLE_ROLES.map((r) => {
              const selected = selectedRoles.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => toggleRoleTarget(r)}
                  className={`rounded border px-2 py-0.5 font-mono text-[10px] cursor-pointer ${
                    selected
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
            disabled={busyId === 'create'}
            className="h-9 rounded-md bg-[#2D46E6] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer disabled:opacity-50"
          >
            {busyId === 'create' ? 'Saving Flag...' : 'Create Feature Flag'}
          </button>
        </form>
      )}

      {/* Active Feature Flags Table */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="flex items-center justify-between border-b border-[#E4E8F2] px-4 py-3">
          <span className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            <Flag className="h-4 w-4 text-[#2D46E6]" />
            <span>Controlled Rollout Flags ({flags.length})</span>
          </span>
          <span className="font-mono text-[10px] text-[#667085]">
            Deterministic SHA-256 User Bucketing · Operational Governance Only
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                <th className="px-4 py-2">Flag Key</th>
                <th className="px-3 py-2">Scope & Visibility</th>
                <th className="px-3 py-2">Rollout %</th>
                <th className="px-3 py-2">Targets</th>
                <th className="px-4 py-2 text-right">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {flags.map((f) => (
                <tr key={f.id} className="h-12 hover:bg-[#F7F8FA]">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-[#080B12]">
                      {f.isKillSwitch && <ShieldAlert className="h-3.5 w-3.5 text-[#DC2626]" />}
                      <span>{f.flagKey}</span>
                    </div>
                    <div className="text-[11px] text-[#667085]">{f.name}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px]">
                    <span className="rounded border border-[#E4E8F2] bg-[#F7F8FA] px-1.5 py-0.5 text-[#475467] mr-1.5">
                      {f.environmentScope}
                    </span>
                    <span
                      className={`rounded border px-1.5 py-0.5 ${
                        f.clientExposed
                          ? 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]'
                          : 'border-[#E2E8F0] bg-[#F1F5F9] text-[#475467]'
                      }`}
                    >
                      {f.clientExposed ? 'CLIENT_EXPOSED' : 'INTERNAL_ONLY'}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-[#080B12]">{f.rolloutPercentage}%</span>
                      {canManage && (
                        <div className="inline-flex gap-1">
                          {[0, 25, 50, 100].map((pct) => (
                            <button
                              key={pct}
                              type="button"
                              disabled={busyId === f.id || f.rolloutPercentage === pct}
                              onClick={() => void handleStepRollout(f, pct)}
                              className="rounded border border-[#E4E8F2] px-1.5 py-0.5 text-[10px] hover:border-[#2D46E6] disabled:opacity-40 cursor-pointer"
                            >
                              {pct}%
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-[#475467]">
                    {f.targetRoles.length > 0 ? f.targetRoles.join(', ') : 'All roles'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {canManage ? (
                      <button
                        type="button"
                        disabled={busyId === f.id}
                        onClick={() => void handleToggleFlag(f)}
                        className={`rounded px-3 py-1 font-mono text-[11px] font-semibold text-[#FFFFFF] cursor-pointer disabled:opacity-50 ${
                          f.enabled
                            ? 'bg-[#15803D] hover:bg-[#166534]'
                            : 'bg-[#64748B] hover:bg-[#475569]'
                        }`}
                      >
                        {f.enabled ? 'ENABLED' : 'DISABLED'}
                      </button>
                    ) : (
                      <span className="font-mono text-[11px] font-semibold">
                        {f.enabled ? 'ENABLED' : 'DISABLED'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Change History & One-Click Rollback */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="border-b border-[#E4E8F2] px-4 py-3">
          <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            Feature Flag Change History & Rollback ({history.length})
          </h2>
        </div>
        <div className="divide-y divide-[#F1F5F9] max-h-64 overflow-y-auto">
          {history.length === 0 ? (
            <div className="p-4 text-xs text-[#667085]">No feature flag change history yet.</div>
          ) : (
            history.map((h) => (
              <div key={h.id} className="px-4 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="font-mono text-[11px] font-semibold text-[#080B12]">
                    {h.flagKey}{' '}
                    <span className="font-normal text-[#667085]">by {h.actorEmail}</span>
                  </div>
                  <div className="text-[#475467]">{h.reason || 'Flag snapshot saved'}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-[#667085]">
                    {new Date(h.createdAt).toLocaleString()}
                  </span>
                  {canManage && h.previousSnapshot && (
                    <button
                      type="button"
                      disabled={busyId === h.id}
                      onClick={() => void handleRollback(h.id)}
                      className="inline-flex items-center gap-1 rounded border border-[#E4E8F2] px-2 py-0.5 text-[11px] font-semibold text-[#2D46E6] hover:border-[#2D46E6] cursor-pointer"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>Rollback</span>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
