import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Cpu,
  Database,
  Globe,
  Loader2,
  RefreshCw,
  Shield,
  Users,
} from 'lucide-react';
import type { ObservabilityRangeKey } from '../../admin/types';
import { adminApi, type ObservabilityOverviewResponse } from '../../lib/adminApi';
import { AdminBarChart } from './AdminCharts';

interface AdminOverviewViewProps {
  onNavigate: (href: string) => void;
  onMaintenanceModeDetected?: (enabled: boolean) => void;
}

const RANGE_OPTIONS: { key: ObservabilityRangeKey; label: string }[] = [
  { key: '15m', label: '15m' },
  { key: '1h', label: '1H' },
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: 'all', label: 'All' },
  { key: 'custom', label: 'Custom' },
];

function statusStyle(status: string): string {
  if (status === 'HEALTHY') return 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]';
  if (status === 'DEGRADED') return 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]';
  if (status === 'UNAVAILABLE') return 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]';
  return 'border-[#E2E8F0] bg-[#F8FAFC] text-[#475467]';
}

function formatDelta(pct: number | null): string {
  if (pct === null) return 'No prior baseline';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct}% vs prior`;
}

export const AdminOverviewView: React.FC<AdminOverviewViewProps> = ({
  onNavigate,
  onMaintenanceModeDetected,
}) => {
  const [range, setRange] = useState<ObservabilityRangeKey>('24h');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState<ObservabilityOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (selectedRange: ObservabilityRangeKey, fromVal?: string, toVal?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await adminApi.getObservabilityOverview({
          range: selectedRange,
          from: selectedRange === 'custom' && fromVal ? new Date(fromVal).toISOString() : undefined,
          to: selectedRange === 'custom' && toVal ? new Date(toVal).toISOString() : undefined,
        });
        setData(res);
        onMaintenanceModeDetected?.(res.maintenanceMode);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load command centre overview.');
      } finally {
        setLoading(false);
      }
    },
    [onMaintenanceModeDetected],
  );

  useEffect(() => {
    if (range !== 'custom' || (customFrom && customTo)) {
      void load(range, customFrom, customTo);
    }
  }, [range, customFrom, customTo, load]);

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs text-[#667085]">
            Real-time platform intelligence across accounts, workspace usage, API latency percentiles, AI inference, market health, and operational alerts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Overview timeframe selector"
            className="inline-flex flex-wrap rounded-md border border-[#E4E8F2] bg-[#FFFFFF] p-0.5"
          >
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setRange(opt.key)}
                className={`rounded px-2 py-1 font-mono text-[11px] font-semibold transition-colors cursor-pointer ${
                  range === opt.key
                    ? 'bg-[#2D46E6] text-[#FFFFFF]'
                    : 'text-[#667085] hover:text-[#080B12]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {range === 'custom' && (
            <div className="flex items-center gap-1.5 text-xs">
              <input
                type="datetime-local"
                aria-label="Custom range start"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-8 rounded border border-[#E4E8F2] bg-[#FFFFFF] px-2 font-mono text-[11px]"
              />
              <span className="text-[#667085]">→</span>
              <input
                type="datetime-local"
                aria-label="Custom range end"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-8 rounded border border-[#E4E8F2] bg-[#FFFFFF] px-2 font-mono text-[11px]"
              />
            </div>
          )}
          <button
            type="button"
            onClick={() => void load(range, customFrom, customTo)}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-xs text-[#B91C1C]"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="flex h-56 items-center justify-center rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] text-xs text-[#667085]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#2D46E6]" />
          Loading Platform Intelligence overview...
        </div>
      ) : data ? (
        <>
          {/* Overall Platform Health & Active Alert Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] px-4 py-3">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#667085]">
                Overall Platform Health
              </span>
              <span
                className={`rounded border px-2 py-0.5 font-mono text-[11px] font-bold uppercase ${statusStyle(data.overallPlatformHealth)}`}
              >
                {data.overallPlatformHealth}
              </span>
              <span className="font-mono text-[11px] text-[#475467]">
                API P95:{' '}
                <strong className="text-[#080B12]">
                  {data.apiMetrics.p95LatencyMs !== null ? `${data.apiMetrics.p95LatencyMs}ms` : 'N/A'}
                </strong>{' '}
                · Paper Orders:{' '}
                <strong className="text-[#080B12]">{data.usageMetrics.paperTradingOrders}</strong> · Research:{' '}
                <strong className="text-[#080B12]">{data.usageMetrics.workspaceResearchSaved}</strong>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigate('/admin/alerts')}
                className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-[11px] font-semibold cursor-pointer ${
                  data.securityMetrics.openAlerts > 0
                    ? 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]'
                    : 'border-[#E4E8F2] bg-[#F7F8FA] text-[#475467]'
                }`}
              >
                <Bell className="h-3.5 w-3.5" />
                <span>{data.securityMetrics.openAlerts} Active Alerts</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('/admin/incidents')}
                className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-[11px] font-semibold cursor-pointer ${
                  data.securityMetrics.openIncidents > 0
                    ? 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]'
                    : 'border-[#E4E8F2] bg-[#F7F8FA] text-[#475467]'
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{data.securityMetrics.openIncidents} Open Incidents</span>
              </button>
            </div>
          </div>

          {/* 6 KPI Summary Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {/* Users */}
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
                  <Users className="h-3.5 w-3.5 text-[#2D46E6]" />
                  User Intelligence
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('/admin/users')}
                  className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#2D46E6] hover:underline cursor-pointer"
                >
                  <span>Directory</span>
                  <ArrowUpRight className="h-3 w-3" />
                </button>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-2xl font-bold tabular-nums text-[#080B12]">
                  {data.userMetrics.totalUsers.toLocaleString()}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-[#15803D]">
                  +{data.userMetrics.newRegistrations} ({formatDelta(data.userMetrics.newRegistrationsDeltaPct)})
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 border-t border-[#F1F5F9] pt-2 text-[11px]">
                <div>
                  <div className="text-[#667085]">Active</div>
                  <div className="font-mono font-semibold tabular-nums">{data.userMetrics.recentlyActiveUsers}</div>
                </div>
                <div>
                  <div className="text-[#667085]">Verified</div>
                  <div className="font-mono font-semibold tabular-nums">{data.userMetrics.verifiedUsers}</div>
                </div>
                <div>
                  <div className="text-[#667085]">Sign-ins</div>
                  <div className="font-mono font-semibold tabular-nums">{data.userMetrics.loginActivityCount}</div>
                </div>
                <div>
                  <div className="text-[#667085]">Suspended</div>
                  <div className="font-mono font-semibold tabular-nums text-[#DC2626]">
                    {data.userMetrics.suspendedUsers}
                  </div>
                </div>
              </div>
            </div>

            {/* AI Engine */}
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
                  <Cpu className="h-3.5 w-3.5 text-[#2D46E6]" />
                  AI Intelligence
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('/admin/ai')}
                  className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#2D46E6] hover:underline cursor-pointer"
                >
                  <span>AI Control</span>
                  <ArrowUpRight className="h-3 w-3" />
                </button>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-2xl font-bold tabular-nums text-[#080B12]">
                  {data.aiMetrics.totalRequests.toLocaleString()}
                </span>
                <span className="font-mono text-[11px] text-[#475467]">
                  {formatDelta(data.aiMetrics.totalRequestsDeltaPct)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 border-t border-[#F1F5F9] pt-2 text-[11px]">
                <div>
                  <div className="text-[#667085]">Avg / P95</div>
                  <div className="font-mono font-semibold tabular-nums">
                    {data.aiMetrics.avgLatencyMs !== null
                      ? `${data.aiMetrics.avgLatencyMs}/${data.aiMetrics.p95LatencyMs ?? data.aiMetrics.avgLatencyMs}ms`
                      : 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-[#667085]">Tokens</div>
                  <div className="font-mono font-semibold tabular-nums">
                    {data.aiMetrics.totalTokensMeasured !== null
                      ? data.aiMetrics.totalTokensMeasured.toLocaleString()
                      : 'Unavailable'}
                  </div>
                </div>
                <div>
                  <div className="text-[#667085]">Failed</div>
                  <div className="font-mono font-semibold tabular-nums text-[#DC2626]">
                    {data.aiMetrics.failedRequests}
                  </div>
                </div>
              </div>
            </div>

            {/* Market Data */}
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
                  <Globe className="h-3.5 w-3.5 text-[#2D46E6]" />
                  Market Data & Usage
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('/admin/markets')}
                  className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#2D46E6] hover:underline cursor-pointer"
                >
                  <span>Health</span>
                  <ArrowUpRight className="h-3 w-3" />
                </button>
              </div>
              <div className="flex items-baseline gap-2.5">
                <span className="font-mono text-2xl font-bold tabular-nums text-[#080B12]">
                  {data.marketMetrics.instrumentCount}
                </span>
                <span className="rounded border border-[#FDE68A] bg-[#FFFBEB] px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-[#B45309]">
                  {data.marketMetrics.classification}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 border-t border-[#F1F5F9] pt-2 text-[11px]">
                <div>
                  <div className="text-[#667085]">Market Reqs</div>
                  <div className="font-mono font-semibold tabular-nums">{data.marketMetrics.marketDataRequests}</div>
                </div>
                <div>
                  <div className="text-[#667085]">Sync Status</div>
                  <div className="font-mono font-semibold">{data.marketMetrics.lastSyncStatus}</div>
                </div>
                <div>
                  <div className="text-[#667085]">Regions</div>
                  <div className="font-mono font-semibold">{data.marketMetrics.enabledRegions.join(', ')}</div>
                </div>
              </div>
            </div>

            {/* API Traffic */}
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
                  <Activity className="h-3.5 w-3.5 text-[#2D46E6]" />
                  API Observability
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('/admin/apis')}
                  className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#2D46E6] hover:underline cursor-pointer"
                >
                  <span>Endpoints</span>
                  <ArrowUpRight className="h-3 w-3" />
                </button>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-2xl font-bold tabular-nums text-[#080B12]">
                  {data.apiMetrics.requestVolume.toLocaleString()}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-[#667085]">
                  {formatDelta(data.apiMetrics.requestVolumeDeltaPct)}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 border-t border-[#F1F5F9] pt-2 text-[11px]">
                <div>
                  <div className="text-[#667085]">Err Rate</div>
                  <div className="font-mono font-semibold tabular-nums">{data.apiMetrics.errorRatePct}%</div>
                </div>
                <div>
                  <div className="text-[#667085]">P50</div>
                  <div className="font-mono font-semibold tabular-nums">
                    {data.apiMetrics.p50LatencyMs !== null ? `${data.apiMetrics.p50LatencyMs}ms` : 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-[#667085]">P95</div>
                  <div className="font-mono font-semibold tabular-nums">
                    {data.apiMetrics.p95LatencyMs !== null ? `${data.apiMetrics.p95LatencyMs}ms` : 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-[#667085]">P99</div>
                  <div className="font-mono font-semibold tabular-nums">
                    {data.apiMetrics.p99LatencyMs !== null ? `${data.apiMetrics.p99LatencyMs}ms` : 'N/A'}
                  </div>
                </div>
              </div>
            </div>

            {/* Infrastructure & Worker */}
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
                  <Database className="h-3.5 w-3.5 text-[#2D46E6]" />
                  Infrastructure & Worker
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('/admin/jobs')}
                  className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#2D46E6] hover:underline cursor-pointer"
                >
                  <span>Jobs</span>
                  <ArrowUpRight className="h-3 w-3" />
                </button>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-2xl font-bold tabular-nums text-[#080B12]">
                  {data.infrastructure.dbLatencyMs}ms
                </span>
                <span className="font-mono text-xs text-[#15803D]">
                  {data.infrastructure.dbDialect.toUpperCase()}
                </span>
                {data.infrastructure.workerPaused && (
                  <span className="rounded border border-[#FDE68A] bg-[#FFFBEB] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#B45309]">
                    QUEUE PAUSED
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 border-t border-[#F1F5F9] pt-2 text-[11px]">
                <div>
                  <div className="text-[#667085]">Uptime</div>
                  <div className="font-mono font-semibold tabular-nums">
                    {Math.floor(data.infrastructure.uptimeSeconds / 60)}m
                  </div>
                </div>
                <div>
                  <div className="text-[#667085]">Stuck Jobs</div>
                  <div className="font-mono font-semibold tabular-nums">
                    {data.infrastructure.stuckJobsCount}
                  </div>
                </div>
                <div>
                  <div className="text-[#667085]">Failed Jobs</div>
                  <div className="font-mono font-semibold tabular-nums text-[#DC2626]">
                    {data.infrastructure.failedJobsCount}
                  </div>
                </div>
              </div>
            </div>

            {/* Security & Alerts */}
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
                  <Shield className="h-3.5 w-3.5 text-[#2D46E6]" />
                  Security & Alerts
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('/admin/security')}
                  className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#2D46E6] hover:underline cursor-pointer"
                >
                  <span>Security</span>
                  <ArrowUpRight className="h-3 w-3" />
                </button>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-2xl font-bold tabular-nums text-[#080B12]">
                  {data.securityMetrics.failedLogins}
                </span>
                <span className="font-mono text-[11px] text-[#667085]">
                  failed logins ({formatDelta(data.userMetrics.failedLoginsDeltaPct)})
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 border-t border-[#F1F5F9] pt-2 text-[11px]">
                <div>
                  <div className="text-[#667085]">Open Alerts</div>
                  <div className="font-mono font-semibold tabular-nums text-[#DC2626]">
                    {data.securityMetrics.openAlerts}
                  </div>
                </div>
                <div>
                  <div className="text-[#667085]">429 Blocked</div>
                  <div className="font-mono font-semibold tabular-nums">
                    {data.securityMetrics.blockedRequests}
                  </div>
                </div>
                <div>
                  <div className="text-[#667085]">Tickets</div>
                  <div className="font-mono font-semibold tabular-nums">
                    {data.securityMetrics.openSupportTickets}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Time-Series Charts */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <AdminBarChart
              title="New Registrations"
              subtitle="Account creation over selected window"
              data={data.charts.userGrowth}
            />
            <AdminBarChart
              title="API Traffic & Errors"
              subtitle="Recorded /api/* requests"
              data={data.charts.apiTraffic}
              showErrorsOverlay
            />
            <AdminBarChart
              title="AI Research Calls"
              subtitle="Workspace + public executions"
              data={data.charts.aiUsage}
              accentColor="#0F766E"
            />
          </div>

          {/* Service Health Matrix + Recent Admin Audit */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
              <div className="border-b border-[#E4E8F2] px-4 py-3 flex items-center justify-between">
                <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                  7-Service Runtime Health Matrix
                </h2>
                <span className="font-mono text-[10px] text-[#667085]">Verified server checks</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                      <th className="px-4 py-2">Service</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Latency</th>
                      <th className="px-4 py-2">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9]">
                    {data.serviceHealth.map((svc) => (
                      <tr key={svc.id} className="h-10 hover:bg-[#F7F8FA]">
                        <td className="px-4 py-2 font-medium text-[#080B12]">{svc.name}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${statusStyle(svc.status)}`}
                          >
                            {svc.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums text-[#475467]">
                          {svc.latencyMs !== null ? `${svc.latencyMs}ms` : 'N/A'}
                        </td>
                        <td className="px-4 py-2 text-[#667085]">{svc.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
              <div className="border-b border-[#E4E8F2] px-4 py-3 flex items-center justify-between">
                <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                  Recent Admin Audit Activity
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('/admin/audit-logs')}
                  className="text-[11px] font-semibold text-[#2D46E6] hover:underline cursor-pointer"
                >
                  Full Log
                </button>
              </div>
              {data.recentActivity.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#667085]">
                  No administrative mutations recorded yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                        <th className="px-4 py-2">Action</th>
                        <th className="px-3 py-2">Actor</th>
                        <th className="px-3 py-2">Target</th>
                        <th className="px-4 py-2">When</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F1F5F9]">
                      {data.recentActivity.map((act) => (
                        <tr key={act.id} className="h-10 hover:bg-[#F7F8FA]">
                          <td className="px-4 py-2 font-mono text-[11px] font-semibold text-[#080B12]">
                            {act.action}
                          </td>
                          <td className="px-3 py-2 text-[#475467] truncate max-w-[140px]">
                            {act.adminEmail}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-[#667085]">
                            {act.resourceType}
                          </td>
                          <td className="px-4 py-2 font-mono text-[11px] tabular-nums text-[#667085]">
                            {new Date(act.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};
