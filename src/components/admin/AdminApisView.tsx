import React, { useCallback, useEffect, useState } from 'react';
import { Activity, CheckCircle2, Loader2, Search } from 'lucide-react';
import type { ObservabilityRangeKey } from '../../admin/types';
import { PERMISSIONS } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import { adminApi, type ObservabilityApiResponse } from '../../lib/adminApi';
import { AdminBarChart } from './AdminCharts';

export const AdminApisView: React.FC = () => {
  const { user } = useAuth();
  const canManage = new Set<string>(user?.permissions ?? []).has(PERMISSIONS.ADMIN_APIS_MANAGE);

  const [range, setRange] = useState<ObservabilityRangeKey>('24h');
  const [endpointFilter, setEndpointFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const [data, setData] = useState<ObservabilityApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [researchMax, setResearchMax] = useState(25);
  const [mutationMax, setMutationMax] = useState(120);
  const [orderMax, setOrderMax] = useState(40);
  const [contactMax, setContactMax] = useState(5);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getObservabilityApi({
        range,
        endpoint: endpointFilter.trim() || undefined,
        method: methodFilter,
        statusCode: statusFilter,
        limit: 50,
        offset: 0,
      });
      setData(res);
      setResearchMax(res.rateLimits.apiResearchMaxPerMin);
      setMutationMax(res.rateLimits.workspaceMutationMaxPerMin);
      setOrderMax(res.rateLimits.paperOrderMaxPerMin);
      setContactMax(res.rateLimits.contactMaxPer15Min);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load API observability telemetry.');
    } finally {
      setLoading(false);
    }
  }, [range, endpointFilter, methodFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSaveRateLimits = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      await adminApi.updateRateLimits({
        apiResearchMaxPerMin: researchMax,
        workspaceMutationMaxPerMin: mutationMax,
        paperOrderMaxPerMin: orderMax,
        contactMaxPer15Min: contactMax,
      });
      setFeedback('Rate-limit policy saved.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rate-limit policy.');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] text-xs text-[#667085]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#2D46E6]" />
        Loading Advanced API Observability...
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

      {data && (
        <>
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#667085]" />
                <input
                  type="search"
                  value={endpointFilter}
                  onChange={(e) => setEndpointFilter(e.target.value)}
                  placeholder="Filter endpoint (/api/...)"
                  aria-label="Filter by endpoint path"
                  className="h-8 w-52 rounded border border-[#E4E8F2] bg-[#F7F8FA] pl-8 pr-2.5 font-mono text-xs"
                />
              </div>
              <select
                value={methodFilter}
                onChange={(e) => setMethodFilter(e.target.value)}
                aria-label="Filter by HTTP method"
                className="h-8 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono text-xs"
              >
                <option value="ALL">All Methods</option>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status class"
                className="h-8 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono text-xs"
              >
                <option value="ALL">All Statuses</option>
                <option value="2xx">2xx Success</option>
                <option value="4xx">4xx Client</option>
                <option value="5xx">5xx Server</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#2D46E6]" />
              <select
                value={range}
                onChange={(e) => setRange(e.target.value as ObservabilityRangeKey)}
                aria-label="API metrics range"
                className="h-8 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 font-mono text-xs"
              >
                <option value="15m">Last 15m</option>
                <option value="1h">Last 1H</option>
                <option value="24h">Last 24H</option>
                <option value="7d">Last 7D</option>
                <option value="30d">Last 30D</option>
                <option value="all">All Time</option>
              </select>
            </div>
          </div>

          {/* KPI Strip with P50/P95/P99 */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5">
              <div className="text-[11px] text-[#667085]">Requests</div>
              <div className="font-mono text-xl font-bold tabular-nums">
                {data.summary.totalVolume.toLocaleString()}
              </div>
              <div className="font-mono text-[10px] text-[#667085]">
                Err rate: {data.summary.errorRatePct}%
              </div>
            </div>
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5">
              <div className="text-[11px] text-[#667085]">Avg / P50 Latency</div>
              <div className="font-mono text-xl font-bold tabular-nums">
                {data.summary.avgLatencyMs !== null ? `${data.summary.avgLatencyMs}ms` : 'N/A'}
              </div>
              <div className="font-mono text-[10px] text-[#667085]">
                P50: {data.summary.p50LatencyMs !== null ? `${data.summary.p50LatencyMs}ms` : 'N/A'}
              </div>
            </div>
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5">
              <div className="text-[11px] text-[#667085]">P95 / P99 Latency</div>
              <div className="font-mono text-xl font-bold tabular-nums text-[#2D46E6]">
                {data.summary.p95LatencyMs !== null ? `${data.summary.p95LatencyMs}ms` : 'N/A'}
              </div>
              <div className="font-mono text-[10px] text-[#667085]">
                P99: {data.summary.p99LatencyMs !== null ? `${data.summary.p99LatencyMs}ms` : 'N/A'}
              </div>
            </div>
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5">
              <div className="text-[11px] text-[#667085]">2xx Responses</div>
              <div className="font-mono text-xl font-bold tabular-nums text-[#15803D]">
                {data.summary.statusBreakdown.s2xx}
              </div>
            </div>
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5">
              <div className="text-[11px] text-[#667085]">4xx / 5xx</div>
              <div className="font-mono text-xl font-bold tabular-nums text-[#DC2626]">
                {data.summary.statusBreakdown.s4xx} / {data.summary.statusBreakdown.s5xx}
              </div>
            </div>
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5">
              <div className="text-[11px] text-[#667085]">429 Rate Limits</div>
              <div className="font-mono text-xl font-bold tabular-nums">
                {data.summary.rateLimitEvents}
              </div>
            </div>
          </div>

          <AdminBarChart
            title="API Request & Error Trends"
            subtitle="Sanitized server telemetry (credentials and tokens never logged)"
            data={data.trends}
            showErrorsOverlay
          />

          {/* Endpoint Performance Directory */}
          <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
            <div className="border-b border-[#E4E8F2] px-4 py-3 flex items-center justify-between">
              <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                Endpoint Performance Table ({data.endpoints.length} of {data.totalEndpoints})
              </h2>
              <span className="font-mono text-[10px] text-[#667085]">
                Sorted by request volume
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                    <th className="px-4 py-2">Method & Route</th>
                    <th className="px-3 py-2">Count</th>
                    <th className="px-3 py-2">Avg</th>
                    <th className="px-3 py-2">P95</th>
                    <th className="px-3 py-2">P99</th>
                    <th className="px-3 py-2">Errors</th>
                    <th className="px-4 py-2">Last Observed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {data.endpoints.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-[#667085]">
                        No API traffic matches the selected filters.
                      </td>
                    </tr>
                  ) : (
                    data.endpoints.map((ep) => (
                      <tr key={`${ep.method}-${ep.routePath}`} className="h-10 hover:bg-[#F7F8FA]">
                        <td className="px-4 py-2 font-mono text-[11px]">
                          <span className="mr-2 font-bold text-[#2D46E6]">{ep.method}</span>
                          <span className="text-[#080B12]">{ep.routePath}</span>
                          {ep.isSlow && (
                            <span className="ml-2 rounded border border-[#FDE68A] bg-[#FFFBEB] px-1.5 py-0.5 text-[9px] font-bold text-[#B45309]">
                              SLOW
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums">{ep.volume}</td>
                        <td className="px-3 py-2 font-mono tabular-nums">{ep.avgLatencyMs}ms</td>
                        <td className="px-3 py-2 font-mono tabular-nums font-semibold">{ep.p95LatencyMs}ms</td>
                        <td className="px-3 py-2 font-mono tabular-nums text-[#667085]">{ep.p99LatencyMs}ms</td>
                        <td className="px-3 py-2 font-mono tabular-nums text-[#DC2626]">
                          {ep.errorCount} ({ep.errorRatePct}%)
                        </td>
                        <td className="px-4 py-2 font-mono text-[11px] text-[#667085]">
                          {new Date(ep.lastObservedAt).toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Integrations */}
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
              <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                External Integrations (Secrets Never Exposed)
              </h2>
              <div className="divide-y divide-[#F1F5F9]">
                {data.integrations.map((intg) => (
                  <div key={intg.name} className="flex items-center justify-between py-2.5 text-xs">
                    <div>
                      <div className="font-semibold text-[#080B12]">{intg.name}</div>
                      <div className="font-mono text-[11px] text-[#667085]">{intg.keyMasked}</div>
                    </div>
                    <span
                      className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                        intg.configured
                          ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                          : 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]'
                      }`}
                    >
                      {intg.configured ? 'Configured' : 'Not Configured'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Rate Limit Editor */}
            <form
              onSubmit={handleSaveRateLimits}
              className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3"
            >
              <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                Rate-Limit Threshold Policy
              </h2>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <label className="space-y-1">
                  <span className="block text-[11px] text-[#475467]">Research / min</span>
                  <input
                    type="number"
                    min={5}
                    max={500}
                    disabled={!canManage}
                    value={researchMax}
                    onChange={(e) => setResearchMax(Number(e.target.value) || 25)}
                    className="h-9 w-full rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-[11px] text-[#475467]">Workspace writes / min</span>
                  <input
                    type="number"
                    min={10}
                    max={1000}
                    disabled={!canManage}
                    value={mutationMax}
                    onChange={(e) => setMutationMax(Number(e.target.value) || 120)}
                    className="h-9 w-full rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-[11px] text-[#475467]">Paper orders / min</span>
                  <input
                    type="number"
                    min={5}
                    max={500}
                    disabled={!canManage}
                    value={orderMax}
                    onChange={(e) => setOrderMax(Number(e.target.value) || 40)}
                    className="h-9 w-full rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-[11px] text-[#475467]">Contact form / 15min</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    disabled={!canManage}
                    value={contactMax}
                    onChange={(e) => setContactMax(Number(e.target.value) || 5)}
                    className="h-9 w-full rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono"
                  />
                </label>
              </div>
              {canManage && (
                <button
                  type="submit"
                  disabled={saving}
                  className="h-9 rounded-md bg-[#2D46E6] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Update Rate Limits'}
                </button>
              )}
            </form>
          </div>
        </>
      )}
    </div>
  );
};
