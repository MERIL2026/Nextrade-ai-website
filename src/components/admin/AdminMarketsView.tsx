import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Globe, Loader2, RefreshCw } from 'lucide-react';
import { PERMISSIONS } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import {
  adminApi,
  type AdminMarketsOverviewResponse,
  type ObservabilityMarketDataResponse,
} from '../../lib/adminApi';

function freshnessBadgeClass(status: 'FRESH' | 'STALE' | 'NEVER_SYNCED'): string {
  switch (status) {
    case 'FRESH':
      return 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]';
    case 'STALE':
      return 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]';
    case 'NEVER_SYNCED':
    default:
      return 'border-[#CBD5E1] bg-[#F8FAFC] text-[#475467]';
  }
}

export const AdminMarketsView: React.FC = () => {
  const { user } = useAuth();
  const canManage = new Set<string>(user?.permissions ?? []).has(PERMISSIONS.ADMIN_MARKETS_MANAGE);

  const [data, setData] = useState<AdminMarketsOverviewResponse | null>(null);
  const [obs, setObs] = useState<ObservabilityMarketDataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewRes, obsRes] = await Promise.all([
        adminApi.getMarketsOverview(),
        adminApi.getObservabilityMarketData(25),
      ]);
      setData(overviewRes);
      setObs(obsRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load market catalog configuration.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggleRegion = async (region: 'IN' | 'US' | 'GLOBAL') => {
    if (!data || !canManage) return;
    const current = new Set(data.config.enabledRegions);
    if (current.has(region)) {
      if (current.size <= 1) {
        setError('At least one market region (IN, US, or GLOBAL) must remain active.');
        return;
      }
      current.delete(region);
    } else {
      current.add(region);
    }
    setError(null);
    setFeedback(null);
    try {
      await adminApi.updateMarketConfig({ enabledRegions: Array.from(current) });
      setFeedback('Updated active market regions.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update regions.');
    }
  };

  const handleToggleSymbol = async (symbol: string) => {
    if (!data || !canManage) return;
    const disabled = new Set(data.config.disabledSymbols);
    if (disabled.has(symbol)) {
      disabled.delete(symbol);
    } else {
      disabled.add(symbol);
    }
    setError(null);
    setFeedback(null);
    try {
      await adminApi.updateMarketConfig({ disabledSymbols: Array.from(disabled) });
      setFeedback(`Updated catalog availability for ${symbol}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update symbol.');
    }
  };

  const handleSyncCatalog = async () => {
    setSyncing(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await adminApi.syncMarketCatalog();
      setFeedback(res.run.summary || 'Catalog sync completed.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Catalog sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] text-xs text-[#667085]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#2D46E6]" />
        Loading Market Data Management...
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

      {/* Freshness & Validation Health Banner */}
      {obs && (
        <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <Activity className="h-4 w-4 text-[#2D46E6]" />
              <span className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                Market Data Ingestion &amp; Freshness
              </span>
              <span
                className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${freshnessBadgeClass(
                  obs.freshness.status,
                )}`}
              >
                {obs.freshness.status.replace('_', ' ')}
              </span>
              <span className="rounded border border-[#FDE68A] bg-[#FFFBEB] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#B45309]">
                {obs.summary.classification}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] tabular-nums text-[#475467]">
              <span>
                Last Sync:{' '}
                <strong className="text-[#080B12]">
                  {obs.freshness.lastSyncAt
                    ? new Date(obs.freshness.lastSyncAt).toLocaleString()
                    : 'Never'}
                </strong>
                {obs.freshness.ageMinutes !== null && ` (${obs.freshness.ageMinutes}m ago)`}
              </span>
              <span>
                Threshold: <strong className="text-[#080B12]">{obs.freshness.staleThresholdMinutes}m</strong>
              </span>
              <span>
                Sync Runs: <strong className="text-[#080B12]">{obs.summary.recordedSyncRuns}</strong>
              </span>
              <span>
                Failures:{' '}
                <strong className={obs.summary.totalFailures > 0 ? 'text-[#DC2626]' : 'text-[#080B12]'}>
                  {obs.summary.totalFailures}
                </strong>
              </span>
              <span>
                Validation Errors:{' '}
                <strong
                  className={
                    obs.summary.totalValidationFailures > 0 ? 'text-[#B45309]' : 'text-[#080B12]'
                  }
                >
                  {obs.summary.totalValidationFailures}
                </strong>
              </span>
            </div>
          </div>
          {obs.freshness.status === 'STALE' && (
            <div className="mt-2.5 flex items-center gap-2 rounded border border-[#FDE68A] bg-[#FFFBEB] px-3 py-1.5 text-[11px] text-[#B45309]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                Catalog verification age ({obs.freshness.ageMinutes}m) exceeds configured stale threshold (
                {obs.freshness.staleThresholdMinutes}m). Run catalog verification sync to refresh health metrics.
              </span>
            </div>
          )}
        </div>
      )}

      {data && (
        <>
          {/* Providers */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {data.providers.map((p) => {
              const obsProvider = obs?.providers.find((item) => item.id === p.id);
              return (
                <div key={p.id} className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-2 font-display text-sm font-bold text-[#080B12]">
                      <Globe className="h-4 w-4 text-[#2D46E6]" />
                      <span>{p.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                          p.classification === 'LIVE'
                            ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                            : p.classification === 'SIMULATED'
                              ? 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]'
                              : 'border-[#E2E8F0] bg-[#F8FAFC] text-[#475467]'
                        }`}
                      >
                        {p.classification}
                      </span>
                      <span className="rounded border border-[#CBD5E1] bg-[#F8FAFC] px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                        {p.status}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-[#475467]">{p.note}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#F1F5F9] pt-2 font-mono text-[11px] tabular-nums text-[#667085]">
                    <span>Exchanges: {p.exchanges.join(', ')}</span>
                    {obsProvider && (
                      <span>
                        Processed: {obsProvider.symbolsProcessed} · Failures: {obsProvider.failureCount}
                      </span>
                    )}
                    <span>
                      Last Sync:{' '}
                      {p.lastSuccessfulSync ? new Date(p.lastSuccessfulSync).toLocaleString() : 'Never'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4">
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <span className="font-semibold text-[#080B12]">Active Regions:</span>
              {(['IN', 'US', 'GLOBAL'] as const).map((reg) => {
                const enabled = data.config.enabledRegions.includes(reg);
                const label =
                  reg === 'IN'
                    ? `India (NSE/BSE · ${data.coverage.indiaCount})`
                    : reg === 'US'
                      ? `US (NASDAQ/NYSE · ${data.coverage.usCount})`
                      : `Global Crypto/FX (${data.coverage.globalCount})`;
                return (
                  <label key={reg} className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={!canManage}
                      onChange={() => void handleToggleRegion(reg)}
                      className="h-4 w-4 accent-[#2D46E6]"
                    />
                    <span className="font-mono font-semibold">{label}</span>
                  </label>
                );
              })}
              <span className="font-mono text-[11px] text-[#667085]">
                {data.coverage.enabledCount} / {data.coverage.totalInstruments} symbols enabled
              </span>
            </div>

            {canManage && (
              <button
                type="button"
                disabled={syncing}
                onClick={() => void handleSyncCatalog()}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2D46E6] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
                <span>{syncing ? 'Verifying...' : 'Run Catalog Verification Sync'}</span>
              </button>
            )}
          </div>

          {/* Market Catalog Sync & Health History */}
          {obs && (
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
              <div className="border-b border-[#E4E8F2] px-4 py-3 flex items-center justify-between">
                <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                  Market Catalog Sync &amp; Health History ({obs.history.length})
                </h2>
                <span className="font-mono text-[10px] text-[#667085]">
                  Real persisted market_data_health verification telemetry
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                      <th className="px-4 py-2">Provider</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Mode</th>
                      <th className="px-3 py-2 text-right">Symbols</th>
                      <th className="px-3 py-2 text-right">Failures</th>
                      <th className="px-3 py-2 text-right">Validation Errs</th>
                      <th className="px-3 py-2 text-right">Latency</th>
                      <th className="px-3 py-2">Detail</th>
                      <th className="px-4 py-2">Checked At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9]">
                    {obs.history.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-6 text-center text-[#667085]">
                          No catalog verification runs recorded yet. Run Catalog Verification Sync above to record real health telemetry.
                        </td>
                      </tr>
                    ) : (
                      obs.history.map((row) => (
                        <tr key={row.id} className="h-10 hover:bg-[#F7F8FA]">
                          <td className="px-4 py-2 font-semibold text-[#080B12]">
                            {row.providerName}
                          </td>
                          <td className="px-3 py-2 font-mono text-[10px] font-semibold">
                            <span
                              className={`rounded border px-1.5 py-0.5 ${
                                row.status === 'HEALTHY'
                                  ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                                  : row.status === 'UNAVAILABLE'
                                    ? 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]'
                                    : 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]'
                              }`}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-[10px] text-[#B45309]">
                            {row.classification}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {row.symbolsProcessed}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono tabular-nums ${
                              row.failureCount > 0 ? 'font-bold text-[#DC2626]' : 'text-[#475467]'
                            }`}
                          >
                            {row.failureCount}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono tabular-nums ${
                              row.validationFailures > 0 ? 'font-bold text-[#B45309]' : 'text-[#475467]'
                            }`}
                          >
                            {row.validationFailures}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-[#475467]">
                            {row.latencyMs !== null ? `${row.latencyMs}ms` : 'N/A'}
                          </td>
                          <td className="max-w-xs truncate px-3 py-2 text-[#475467]" title={row.detail}>
                            {row.detail || '—'}
                          </td>
                          <td className="px-4 py-2 font-mono text-[11px] text-[#667085]">
                            {new Date(row.checkedAt).toLocaleString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Instrument Catalog */}
          <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
            <div className="border-b border-[#E4E8F2] px-4 py-3">
              <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                Instrument Catalog Governance
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                    <th className="px-4 py-2">Symbol</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Exchange</th>
                    <th className="px-3 py-2">Latest Price</th>
                    <th className="px-3 py-2">Provider</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-4 py-2 text-right">Public Visibility</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {data.symbols.map((sym) => (
                    <tr key={sym.symbol} className="h-10 hover:bg-[#F7F8FA]">
                      <td className="px-4 py-2 font-mono font-semibold text-[#080B12]">
                        {sym.symbol}
                      </td>
                      <td className="px-3 py-2 text-[#475467]">{sym.name}</td>
                      <td className="px-3 py-2 font-mono text-[10px] text-[#475467]">
                        {sym.category ?? sym.sector}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px]">{sym.exchange}</td>
                      <td className="px-3 py-2 font-mono tabular-nums">
                        {sym.latestPrice !== null
                          ? `${sym.currency === 'INR' ? '₹' : '$'}${sym.latestPrice.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`
                          : 'Unavailable'}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-[#475467]">
                        {sym.providerName ?? 'Unavailable'}
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-[#475467]">
                        {sym.classification}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={() => void handleToggleSymbol(sym.symbol)}
                          className={`rounded border px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase cursor-pointer disabled:opacity-50 ${
                            sym.enabled
                              ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                              : 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]'
                          }`}
                        >
                          {sym.enabled ? 'Enabled' : 'Disabled'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

