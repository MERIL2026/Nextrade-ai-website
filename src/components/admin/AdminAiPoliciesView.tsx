import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Loader2,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import { PERMISSIONS } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import { adminApi, type AiPolicyOverviewResponse } from '../../lib/adminApi';
import { AdminReauthModal } from './AdminReauthModal';

export const AdminAiPoliciesView: React.FC = () => {
  const { user } = useAuth();
  const perms = new Set<string>(user?.permissions ?? []);
  const canManage = perms.has(PERMISSIONS.ADMIN_AI_POLICY_MANAGE);

  const [data, setData] = useState<AiPolicyOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Create Policy Form
  const [name, setName] = useState('');
  const [defaultModel, setDefaultModel] = useState('gemini-2.5-flash');
  const [fallbackModel, setFallbackModel] = useState('gemini-2.5-flash-lite');
  const [maxInputChars, setMaxInputChars] = useState(800);
  const [maxOutputTokens, setMaxOutputTokens] = useState(2048);
  const [timeoutMs, setTimeoutMs] = useState(20000);
  const [safetyMode, setSafetyMode] = useState<'STANDARD' | 'STRICT'>('STRICT');
  const [redactSensitive, setRedactSensitive] = useState(true);
  const [blockInjection, setBlockInjection] = useState(true);
  const [fallbackEnabled, setFallbackEnabled] = useState(true);
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);

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
      const res = await adminApi.getAiPoliciesOverview();
      setData(res);
      if (res.activePolicy) {
        setDefaultModel(res.activePolicy.defaultModel);
        setFallbackModel(res.activePolicy.fallbackModel);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load AI Operations Governance.');
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
      const models = Array.from(new Set([defaultModel, fallbackModel, ...(data?.approvedModels ?? [])]));
      const res = await adminApi.createAiPolicyVersion({
        name: name.trim(),
        allowedModels: models,
        defaultModel,
        fallbackModel,
        fallbackEnabled,
        maxInputChars,
        maxOutputTokens,
        timeoutMs,
        safetyMode,
        redactSensitiveInputs: redactSensitive,
        blockPromptInjection: blockInjection,
        notes: notes.trim(),
        activateNow: false,
      });
      setName('');
      setNotes('');
      setFeedback(`Created draft AI Policy v${res.policy.versionNumber} (${res.policy.name}).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create AI policy version.');
    } finally {
      setCreating(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-12 text-xs text-[#667085]">
        <Loader2 className="h-4 w-4 animate-spin text-[#2D46E6]" />
        <span>Loading AI Operations Governance...</span>
      </div>
    );
  }

  const pg = data?.providerGovernance;

  return (
    <div className="space-y-5">
      {data?.nonAdvisoryDisclaimer && (
        <div className="flex items-start gap-2.5 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3.5 text-xs text-[#92400E]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <strong>Informational AI Notice:</strong> {data.nonAdvisoryDisclaimer}
          </div>
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

      {/* Provider Governance Summary */}
      {pg && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: 'Gemini API Secret', value: pg.geminiSecretStatus },
            { label: 'AI Execution Gate', value: pg.aiEnabled ? 'ENABLED' : 'DISABLED' },
            { label: 'Default Model', value: pg.activeModel },
            { label: 'Fallback Policy', value: pg.fallbackEnabled ? 'ON' : 'OFF' },
            { label: '24h Blocked', value: pg.recentBlockedCount },
            { label: '24h Fallbacks', value: pg.recentFallbackCount },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3">
              <div className="text-[11px] text-[#667085]">{item.label}</div>
              <div className="mt-1 font-mono text-sm font-bold text-[#080B12] truncate">
                {item.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Emergency AI Controls */}
      {canManage && pg && (
        <div className="rounded-lg border border-[#FECACA] bg-[#FFFFFF] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[#DC2626]" />
            <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              Emergency AI Provider & Capability Controls
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                setReauthAction({
                  title: pg.aiEnabled ? 'Emergency Disable AI Provider' : 'Re-Enable AI Provider',
                  description: pg.aiEnabled
                    ? 'Immediately disables live AI research provider calls server-side.'
                    : 'Re-enables server-side AI research execution.',
                  confirmLabel: pg.aiEnabled ? 'Disable Provider' : 'Enable Provider',
                  danger: pg.aiEnabled,
                  requireReason: true,
                  onConfirm: async ({ confirmPassword, reason }) => {
                    const res = await adminApi.executeAiEmergencyControl({
                      control: pg.aiEnabled ? 'DISABLE_PROVIDER' : 'ENABLE_PROVIDER',
                      reason,
                      confirmPassword,
                    });
                    setReauthAction(null);
                    setFeedback(res.detail);
                    await load();
                  },
                })
              }
              className={`h-8 rounded-md px-3 text-xs font-semibold text-[#FFFFFF] cursor-pointer ${
                pg.aiEnabled ? 'bg-[#DC2626] hover:bg-[#B91C1C]' : 'bg-[#15803D] hover:bg-[#166534]'
              }`}
            >
              {pg.aiEnabled ? 'Emergency Disable AI Provider' : 'Enable AI Provider'}
            </button>

            <button
              type="button"
              onClick={() =>
                setReauthAction({
                  title: 'Enforce AI Building Mode on Error',
                  description: 'Surfaces honest AI Building Mode notices instead of raw failures when Gemini is unavailable.',
                  confirmLabel: 'Activate Building Mode',
                  requireReason: true,
                  onConfirm: async ({ confirmPassword, reason }) => {
                    const res = await adminApi.executeAiEmergencyControl({
                      control: 'ACTIVATE_SAFE_FALLBACK',
                      reason,
                      confirmPassword,
                    });
                    setReauthAction(null);
                    setFeedback(res.detail);
                    await load();
                  },
                })
              }
              className="h-8 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] cursor-pointer"
            >
              Enforce Safe Fallback
            </button>

            <button
              type="button"
              onClick={() => {
                const isDisabled = data?.activePolicy?.disabledCapabilities.includes('public_research');
                setReauthAction({
                  title: isDisabled ? 'Enable Public Research AI' : 'Disable Public Research AI',
                  description: 'Toggles the public_research capability inside the active AI policy version.',
                  confirmLabel: isDisabled ? 'Enable Capability' : 'Disable Capability',
                  danger: !isDisabled,
                  requireReason: true,
                  onConfirm: async ({ confirmPassword, reason }) => {
                    const res = await adminApi.executeAiEmergencyControl({
                      control: isDisabled ? 'ENABLE_CAPABILITY' : 'DISABLE_CAPABILITY',
                      targetValue: 'public_research',
                      reason,
                      confirmPassword,
                    });
                    setReauthAction(null);
                    setFeedback(res.detail);
                    await load();
                  },
                });
              }}
              className="h-8 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] cursor-pointer"
            >
              {data?.activePolicy?.disabledCapabilities.includes('public_research')
                ? 'Enable "public_research"'
                : 'Disable "public_research"'}
            </button>
          </div>
        </div>
      )}

      {/* Create Policy Version */}
      {canManage && data && (
        <form onSubmit={handleCreate} className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-[#2D46E6]" />
            <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              Author New AI Operations Policy Version
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Policy version name..."
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs"
            />
            <select
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 text-xs"
            >
              {data.approvedModels.map((m) => (
                <option key={m} value={m}>Default: {m}</option>
              ))}
            </select>
            <select
              value={fallbackModel}
              onChange={(e) => setFallbackModel(e.target.value)}
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 text-xs"
            >
              {data.approvedModels.map((m) => (
                <option key={m} value={m}>Fallback: {m}</option>
              ))}
            </select>
            <select
              value={safetyMode}
              onChange={(e) => setSafetyMode(e.target.value as 'STANDARD' | 'STRICT')}
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 text-xs"
            >
              <option value="STRICT">Safety: STRICT</option>
              <option value="STANDARD">Safety: STANDARD</option>
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-[11px] text-[#667085] space-y-1">
              <span>Max Input Chars</span>
              <input
                type="number"
                min={100}
                max={4000}
                value={maxInputChars}
                onChange={(e) => setMaxInputChars(Number(e.target.value) || 800)}
                className="w-full h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono text-xs text-[#080B12]"
              />
            </label>
            <label className="text-[11px] text-[#667085] space-y-1">
              <span>Max Output Tokens</span>
              <input
                type="number"
                min={256}
                max={8192}
                value={maxOutputTokens}
                onChange={(e) => setMaxOutputTokens(Number(e.target.value) || 2048)}
                className="w-full h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono text-xs text-[#080B12]"
              />
            </label>
            <label className="text-[11px] text-[#667085] space-y-1">
              <span>Timeout (ms)</span>
              <input
                type="number"
                min={2000}
                max={60000}
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(Number(e.target.value) || 20000)}
                className="w-full h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono text-xs text-[#080B12]"
              />
            </label>
            <label className="text-[11px] text-[#667085] space-y-1">
              <span>Change Notes</span>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Reason for new policy draft"
                className="w-full h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 text-xs text-[#080B12]"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-4 text-xs text-[#475467]">
              <label className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={blockInjection} onChange={(e) => setBlockInjection(e.target.checked)} />
                <span>Block prompt injection</span>
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={redactSensitive} onChange={(e) => setRedactSensitive(e.target.checked)} />
                <span>Redact financial PII & keys</span>
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={fallbackEnabled} onChange={(e) => setFallbackEnabled(e.target.checked)} />
                <span>Allow Building Mode degradation flag</span>
              </label>
            </div>
            <button
              type="submit"
              disabled={creating}
              className="inline-flex h-9 items-center rounded-md bg-[#2D46E6] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer disabled:opacity-50"
            >
              Save Policy Draft
            </button>
          </div>
        </form>
      )}

      {/* Version Ledger */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="border-b border-[#E4E8F2] px-4 py-3 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
          Versioned AI Policy History
        </div>
        <div className="divide-y divide-[#F1F5F9]">
          {(data?.versions ?? []).map((v) => (
            <div key={v.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold text-[#080B12]">v{v.versionNumber}</span>
                  <span className="font-semibold text-xs text-[#080B12]">{v.name}</span>
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
                      v.status === 'ACTIVE'
                        ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                        : 'border-[#E4E8F2] bg-[#F7F8FA] text-[#475467]'
                    }`}
                  >
                    {v.status}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-[#667085]">
                  model={v.defaultModel} · maxIn={v.maxInputChars} · maxTok={v.maxOutputTokens} · timeout={v.timeoutMs}ms · safety={v.safetyMode}
                </div>
              </div>
              {canManage && v.status !== 'ACTIVE' && (
                <button
                  type="button"
                  onClick={() =>
                    setReauthAction({
                      title: v.status === 'ARCHIVED' ? `Rollback to AI Policy v${v.versionNumber}` : `Activate AI Policy v${v.versionNumber}`,
                      description: `Replaces current active policy enforcement across executeFinancialResearch with "${v.name}".`,
                      confirmLabel: v.status === 'ARCHIVED' ? 'Rollback Policy' : 'Activate Policy',
                      onConfirm: async ({ confirmPassword }) => {
                        await adminApi.activateOrRollbackAiPolicy(
                          v.id,
                          v.status === 'ARCHIVED' ? 'rollback' : 'activate',
                          confirmPassword,
                        );
                        setReauthAction(null);
                        setFeedback(`AI Policy v${v.versionNumber} is now ACTIVE.`);
                        await load();
                      },
                    })
                  }
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] cursor-pointer"
                >
                  {v.status === 'ARCHIVED' ? <RotateCcw className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  <span>{v.status === 'ARCHIVED' ? 'Rollback' : 'Activate'}</span>
                </button>
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
        onConfirm={async (p) => {
          if (reauthAction) await reauthAction.onConfirm(p);
        }}
      />
    </div>
  );
};
