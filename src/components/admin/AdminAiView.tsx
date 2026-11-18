import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Cpu, Eye, Loader2, Plus, RotateCcw } from 'lucide-react';
import type { AiPromptVersionDto, ObservabilityRangeKey } from '../../admin/types';
import { PERMISSIONS } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import {
  adminApi,
  type AdminAiOverviewResponse,
  type ObservabilityAiResponse,
} from '../../lib/adminApi';
import { AdminBarChart } from './AdminCharts';

export const AdminAiView: React.FC = () => {
  const { user } = useAuth();
  const perms = new Set<string>(user?.permissions ?? []);
  const canManage = perms.has(PERMISSIONS.ADMIN_AI_MANAGE);
  const canInspectSensitive = perms.has(PERMISSIONS.ADMIN_AI_INSPECT_SENSITIVE);

  const [range, setRange] = useState<ObservabilityRangeKey>('7d');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const [overview, setOverview] = useState<AdminAiOverviewResponse | null>(null);
  const [obsAi, setObsAi] = useState<ObservabilityAiResponse | null>(null);
  const [prompts, setPrompts] = useState<AiPromptVersionDto[]>([]);
  const [inspectedRecord, setInspectedRecord] = useState<{
    id: string;
    symbol: string;
    queryPreviewSanitized: string;
    model: string;
    status: string;
    errorMessage: string | null;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [modelInput, setModelInput] = useState('');
  const [aiEnabled, setAiEnabled] = useState(true);
  const [fallbackOnError, setFallbackOnError] = useState(true);
  const [maxQueryChars, setMaxQueryChars] = useState(1000);
  const [savingConfig, setSavingConfig] = useState(false);

  const [newTitle, setNewTitle] = useState('');
  const [newSystemPrompt, setNewSystemPrompt] = useState('');
  const [newUserTemplate, setNewUserTemplate] = useState(
    'Analyze the financial research topic for {{symbol}} covering key drivers, valuation context, market structure, and downside risk dispersion: {{query}}',
  );
  const [newNotes, setNewNotes] = useState('');
  const [activateImmediately, setActivateImmediately] = useState(true);
  const [creatingPrompt, setCreatingPrompt] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, pr, aiTelemetry] = await Promise.all([
        adminApi.getAiOverview(),
        adminApi.listPrompts(),
        adminApi.getObservabilityAi({ range, status: statusFilter, limit: 40, offset: 0 }),
      ]);
      setOverview(ov);
      setPrompts(pr.prompts);
      setObsAi(aiTelemetry);
      setModelInput(ov.provider.activeModel);
      setAiEnabled(ov.provider.aiEnabled);
      setFallbackOnError(ov.provider.fallbackOnError);
      setMaxQueryChars(ov.provider.maxQueryChars);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load AI control centre.');
    } finally {
      setLoading(false);
    }
  }, [range, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    setError(null);
    setFeedback(null);
    try {
      await adminApi.updateAiConfig({
        activeModel: modelInput,
        aiEnabled,
        fallbackOnError,
        maxQueryChars,
      });
      setFeedback('Runtime AI model & policy settings updated.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update AI settings.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleCreatePrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingPrompt(true);
    setError(null);
    setFeedback(null);
    try {
      await adminApi.createPrompt({
        title: newTitle.trim(),
        systemPrompt: newSystemPrompt.trim(),
        userPromptTemplate: newUserTemplate.trim(),
        modelTarget: modelInput,
        notes: newNotes.trim(),
        activateImmediately,
      });
      setNewTitle('');
      setNewSystemPrompt('');
      setNewNotes('');
      setFeedback('New prompt template version saved.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create prompt version.');
    } finally {
      setCreatingPrompt(false);
    }
  };

  const handleActivatePrompt = async (id: string, versionNumber: number) => {
    setError(null);
    setFeedback(null);
    try {
      await adminApi.activatePrompt(id);
      setFeedback(`Prompt version v${versionNumber} is now active across research requests.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate prompt version.');
    }
  };

  const handleInspectRequest = async (id: string) => {
    setError(null);
    try {
      const res = await adminApi.inspectSensitiveAiRequest(id);
      setInspectedRecord(res.request);
      setFeedback('Audited inspection logged (sensitive credentials stripped).');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to inspect AI request.');
    }
  };

  if (loading && !overview) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] text-xs text-[#667085]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#2D46E6]" />
        Loading AI Control & Observability...
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

      {overview && obsAi && (
        <>
          {/* Filter Row */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] px-4 py-2.5">
            <div className="font-mono text-[11px] text-[#667085]">
              {obsAi.summary.pricingNote}
            </div>
            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter AI requests by status"
                className="h-8 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2 font-mono text-xs"
              >
                <option value="ALL">All Outcomes</option>
                <option value="SUCCESS">SUCCESS</option>
                <option value="FALLBACK">FALLBACK</option>
                <option value="FAILED">FAILED</option>
                <option value="BLOCKED">BLOCKED</option>
              </select>
              <select
                value={range}
                onChange={(e) => setRange(e.target.value as ObservabilityRangeKey)}
                aria-label="AI telemetry timeframe"
                className="h-8 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2 font-mono text-xs"
              >
                <option value="15m">15m</option>
                <option value="1h">1H</option>
                <option value="24h">24H</option>
                <option value="7d">7D</option>
                <option value="30d">30D</option>
                <option value="all">All</option>
              </select>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4">
              <div className="text-[11px] text-[#667085]">Requests ({range.toUpperCase()})</div>
              <div className="font-mono text-2xl font-bold tabular-nums text-[#080B12]">
                {obsAi.summary.totalRequests.toLocaleString()}
              </div>
              <div className="font-mono text-[10px] text-[#667085]">
                OK: {obsAi.summary.successCount} · Fallback: {obsAi.summary.fallbackCount}
              </div>
            </div>
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4">
              <div className="text-[11px] text-[#667085]">Avg / P95 Latency</div>
              <div className="font-mono text-2xl font-bold tabular-nums text-[#080B12]">
                {obsAi.summary.avgLatencyMs !== null ? `${obsAi.summary.avgLatencyMs}ms` : 'N/A'}
              </div>
              <div className="font-mono text-[10px] text-[#667085]">
                P95: {obsAi.summary.p95LatencyMs !== null ? `${obsAi.summary.p95LatencyMs}ms` : 'N/A'}
              </div>
            </div>
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4">
              <div className="text-[11px] text-[#667085]">Measured Tokens</div>
              <div className="font-mono text-2xl font-bold tabular-nums text-[#080B12]">
                {obsAi.summary.totalTokensMeasured !== null
                  ? obsAi.summary.totalTokensMeasured.toLocaleString()
                  : 'Data unavailable'}
              </div>
              <div className="font-mono text-[10px] text-[#667085]">Gemini usageMetadata</div>
            </div>
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4">
              <div className="text-[11px] text-[#667085]">Failures & 429 Errors</div>
              <div className="font-mono text-2xl font-bold tabular-nums text-[#DC2626]">
                {obsAi.summary.failedCount} / {obsAi.summary.rateLimitErrors}
              </div>
              <div className="font-mono text-[10px] text-[#667085]">
                Blocked: {obsAi.summary.blockedCount}
              </div>
            </div>
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4">
              <div className="text-[11px] text-[#667085]">Gemini API Key</div>
              <div
                className={`font-mono text-lg font-bold ${
                  overview.provider.geminiKeyConfigured ? 'text-[#15803D]' : 'text-[#B45309]'
                }`}
              >
                {overview.provider.geminiKeyConfigured ? 'CONFIGURED' : 'NOT CONFIGURED'}
              </div>
              <div className="font-mono text-[10px] text-[#667085]">Estimated cost: Unavailable</div>
            </div>
          </div>

          {/* Model / Provider Observability Breakdown */}
          <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
            <div className="border-b border-[#E4E8F2] px-4 py-3">
              <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                Model & Provider Performance Matrix ({obsAi.modelBreakdown.length})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                    <th className="px-4 py-2">Provider / Model</th>
                    <th className="px-3 py-2">Availability</th>
                    <th className="px-3 py-2">Requests</th>
                    <th className="px-3 py-2">Success Rate</th>
                    <th className="px-3 py-2">Avg / P95</th>
                    <th className="px-3 py-2">Tokens</th>
                    <th className="px-4 py-2">Last Success</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {obsAi.modelBreakdown.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-[#667085]">
                        No model invocations recorded in this window.
                      </td>
                    </tr>
                  ) : (
                    obsAi.modelBreakdown.map((m) => (
                      <tr key={`${m.provider}-${m.model}`} className="h-10 hover:bg-[#F7F8FA]">
                        <td className="px-4 py-2 font-mono text-[11px]">
                          <span className="font-semibold text-[#080B12]">{m.model}</span>{' '}
                          <span className="text-[#667085]">({m.provider})</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-[10px] font-semibold">
                          {m.availabilityStatus}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums">{m.requestCount}</td>
                        <td className="px-3 py-2 font-mono tabular-nums text-[#15803D]">
                          {m.successRatePct}%
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums">
                          {m.avgLatencyMs}ms / {m.p95LatencyMs}ms
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums text-[#667085]">
                          {m.totalTokensMeasured !== null
                            ? m.totalTokensMeasured.toLocaleString()
                            : 'Unavailable'}
                        </td>
                        <td className="px-4 py-2 font-mono text-[11px] text-[#667085]">
                          {m.lastSuccessAt ? new Date(m.lastSuccessAt).toLocaleString() : 'Never'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Model & Policy Controls */}
            <form
              onSubmit={handleSaveConfig}
              className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h2 className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                  <Cpu className="h-4 w-4 text-[#2D46E6]" />
                  Model & Inference Controls
                </h2>
                <span className="font-mono text-[10px] text-[#667085]">
                  Active Prompt: v{overview.activePrompt.versionNumber}
                </span>
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-[#475467]">
                  Active Approved Model
                </label>
                <select
                  value={modelInput}
                  disabled={!canManage}
                  onChange={(e) => setModelInput(e.target.value)}
                  className="h-9 w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 font-mono text-xs text-[#080B12]"
                >
                  {overview.provider.approvedModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-[#475467]">
                  Max Query Length (100–2000 chars)
                </label>
                <input
                  type="number"
                  min={100}
                  max={2000}
                  disabled={!canManage}
                  value={maxQueryChars}
                  onChange={(e) => setMaxQueryChars(Number(e.target.value) || 1000)}
                  className="h-9 w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 font-mono text-xs text-[#080B12]"
                />
              </div>

              <div className="space-y-2 pt-1 text-xs">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={aiEnabled}
                    disabled={!canManage}
                    onChange={(e) => setAiEnabled(e.target.checked)}
                    className="h-4 w-4 accent-[#2D46E6]"
                  />
                  <span>Enable AI Research Engine platform-wide</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={fallbackOnError}
                    disabled={!canManage}
                    onChange={(e) => setFallbackOnError(e.target.checked)}
                    className="h-4 w-4 accent-[#2D46E6]"
                  />
                  <span>Surface AI Building Mode notice cleanly when upstream Gemini is unavailable</span>
                </label>
              </div>

              {canManage && (
                <button
                  type="submit"
                  disabled={savingConfig}
                  className="h-9 rounded-md bg-[#2D46E6] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer disabled:opacity-50"
                >
                  {savingConfig ? 'Saving...' : 'Save AI Runtime Policy'}
                </button>
              )}
            </form>

            <AdminBarChart
              title={`AI Request Volume (${range.toUpperCase()})`}
              subtitle={`Workspace: ${overview.usage.byFeature.workspace_research} · Public: ${overview.usage.byFeature.public_research}`}
              data={obsAi.trends}
              showErrorsOverlay
              accentColor="#0F766E"
            />
          </div>

          {/* Prompt Versioning */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
              <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                Prompt Versions ({prompts.length})
              </h2>
              <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                {prompts.map((p) => (
                  <div
                    key={p.id}
                    className={`rounded-md border p-3 text-xs space-y-1.5 ${
                      p.status === 'ACTIVE'
                        ? 'border-[#2D46E6] bg-[#EFF2FA]/50'
                        : 'border-[#E4E8F2] bg-[#F7F8FA]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-[#080B12]">
                        <span className="font-mono text-[#2D46E6]">v{p.versionNumber}</span> · {p.title}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded border border-[#CBD5E1] bg-[#FFFFFF] px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                          {p.status}
                        </span>
                        {canManage && p.status !== 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() => void handleActivatePrompt(p.id, p.versionNumber)}
                            className="inline-flex items-center gap-1 rounded bg-[#2D46E6] px-2 py-0.5 text-[10px] font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer"
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>Activate</span>
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] text-[#475467] line-clamp-3">{p.systemPrompt}</p>
                    <div className="font-mono text-[10px] text-[#667085]">
                      Target: {p.modelTarget} · Created {new Date(p.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {canManage && (
              <form
                onSubmit={handleCreatePrompt}
                className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3"
              >
                <h2 className="inline-flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                  <Plus className="h-4 w-4 text-[#2D46E6]" />
                  <span>Create New Prompt Version</span>
                </h2>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Version title (e.g. Strict Risk-Balanced Synthesis)"
                  className="h-9 w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs"
                />
                <textarea
                  rows={3}
                  required
                  value={newSystemPrompt}
                  onChange={(e) => setNewSystemPrompt(e.target.value)}
                  placeholder="System prompt instruction (min 20 characters)..."
                  className="w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] p-2.5 text-xs"
                />
                <textarea
                  rows={2}
                  required
                  value={newUserTemplate}
                  onChange={(e) => setNewUserTemplate(e.target.value)}
                  placeholder="User prompt template..."
                  className="w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] p-2.5 font-mono text-[11px]"
                />
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={activateImmediately}
                      onChange={(e) => setActivateImmediately(e.target.checked)}
                      className="h-4 w-4 accent-[#2D46E6]"
                    />
                    <span>Activate immediately</span>
                  </label>
                  <button
                    type="submit"
                    disabled={creatingPrompt}
                    className="h-9 rounded-md bg-[#080B12] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#1E293B] cursor-pointer disabled:opacity-50"
                  >
                    {creatingPrompt ? 'Saving...' : 'Create Version'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Audited Sensitive Inspection Drawer */}
          {inspectedRecord && (
            <div className="rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] p-4 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-bold text-[#1D4ED8]">
                  AUDITED PROMPT INSPECTION · {inspectedRecord.symbol} ({inspectedRecord.model})
                </span>
                <button
                  type="button"
                  onClick={() => setInspectedRecord(null)}
                  className="font-mono text-[10px] font-semibold text-[#1D4ED8] hover:underline cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
              <div className="rounded border border-[#BFDBFE] bg-[#FFFFFF] p-2.5 font-mono text-[11px] text-[#080B12]">
                {inspectedRecord.queryPreviewSanitized}
              </div>
              {inspectedRecord.errorMessage && (
                <div className="text-[11px] text-[#B91C1C]">Error: {inspectedRecord.errorMessage}</div>
              )}
            </div>
          )}

          {/* AI Request Telemetry Log (masked by default) */}
          <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
            <div className="border-b border-[#E4E8F2] px-4 py-3 flex items-center justify-between">
              <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                AI Request Telemetry ({obsAi.requests.length} shown · Prompts Redacted by Default)
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                    <th className="px-4 py-2">Symbol</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Model</th>
                    <th className="px-3 py-2">Latency</th>
                    <th className="px-3 py-2">Tokens</th>
                    <th className="px-3 py-2">Summary</th>
                    <th className="px-4 py-2 text-right">Audit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {obsAi.requests.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-[#667085]">
                        No AI research executions logged in this window.
                      </td>
                    </tr>
                  ) : (
                    obsAi.requests.map((r) => (
                      <tr key={r.id} className="h-10 hover:bg-[#F7F8FA]">
                        <td className="px-4 py-2 font-mono font-semibold text-[#080B12]">{r.symbol}</td>
                        <td className="px-3 py-2 font-mono text-[10px] font-semibold">{r.status}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-[#475467]">{r.model}</td>
                        <td className="px-3 py-2 font-mono tabular-nums">{r.latencyMs}ms</td>
                        <td className="px-3 py-2 font-mono tabular-nums text-[#667085]">
                          {r.totalTokens !== null ? r.totalTokens.toLocaleString() : 'N/A'}
                        </td>
                        <td className="px-3 py-2 max-w-[260px] truncate text-[#475467]">
                          {r.queryPreview}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {canInspectSensitive ? (
                            <button
                              type="button"
                              onClick={() => void handleInspectRequest(r.id)}
                              className="inline-flex items-center gap-1 rounded border border-[#E4E8F2] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#2D46E6] hover:border-[#2D46E6] cursor-pointer"
                            >
                              <Eye className="h-3 w-3" />
                              <span>Inspect</span>
                            </button>
                          ) : (
                            <span className="font-mono text-[10px] text-[#94A3B8]">Masked</span>
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
    </div>
  );
};
