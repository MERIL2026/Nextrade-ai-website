import React, { useEffect, useId, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Search,
  Home,
  Globe,
  Sparkles,
  Briefcase,
  Activity,
  Bookmark,
  BarChart2,
  Settings,
  ArrowUpRight,
  Cpu,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { FINTECH_EASE, FINTECH_SPRING_SNAPPY } from '../lib/motionPrimitives';
import {
  HistoricalPoint,
  TimeframeKey,
  formatCurrencyValue,
  formatSignedPercent,
} from '../lib/marketData';
import { fetchMarketHistory, useMarketOverview } from '../lib/marketClient';
import {
  CLEAN_PAPER_TRADING_STATE,
  calculateSeriesRiskMetrics,
} from '../lib/portfolioEngine';
import { InteractivePriceChart, Sparkline } from './SparklineChart';

interface WorkspacePreviewFrameProps {
  onLaunchApp: (initialTab?: string, initialSymbol?: string) => void;
  defaultTab?: string;
}

const PREVIEW_SIDEBAR = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'markets', label: 'Markets', icon: Globe },
  { id: 'research', label: 'AI Research', icon: Sparkles },
  { id: 'portfolio', label: 'Portfolio', icon: Briefcase },
  { id: 'paper-trading', label: 'Paper Trading', icon: Activity },
  { id: 'watchlist', label: 'Watchlist', icon: Bookmark },
  { id: 'analytics', label: 'Analytics', icon: BarChart2 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const WorkspacePreviewFrame: React.FC<WorkspacePreviewFrameProps> = ({
  onLaunchApp,
  defaultTab = 'home',
}) => {
  const { data: overview, loading: overviewLoading } = useMarketOverview({ refreshMs: 60_000 });
  const [selectedSymbol, setSelectedSymbol] = useState<string>('NVDA');
  const [timeframe, setTimeframe] = useState<TimeframeKey>('1M');
  const [activeSidebar, setActiveSidebar] = useState<string>(defaultTab);
  const [series, setSeries] = useState<HistoricalPoint[]>([]);
  const [seriesStatus, setSeriesStatus] = useState<string>('LOADING');
  const [historyLoading, setHistoryLoading] = useState<boolean>(true);
  const instanceId = useId();

  const instruments = useMemo(() => overview?.instruments ?? [], [overview]);
  const indices = useMemo(() => overview?.indices ?? [], [overview]);

  const featuredSymbols = useMemo(() => {
    const preferred = ['NVDA', 'RELIANCE.NS', 'BTC-USD', 'SPY'];
    const available = preferred.filter((sym) => instruments.some((i) => i.symbol === sym));
    if (available.length > 0) return available;
    return instruments.slice(0, 4).map((i) => i.symbol);
  }, [instruments]);

  useEffect(() => {
    if (instruments.length === 0) return;
    if (!instruments.some((i) => i.symbol === selectedSymbol)) {
      setSelectedSymbol(instruments[0].symbol);
    }
  }, [instruments, selectedSymbol]);

  const activeInstrument =
    instruments.find((i) => i.symbol === selectedSymbol) ?? instruments[0] ?? null;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setHistoryLoading(true);
    fetchMarketHistory(selectedSymbol, timeframe, controller.signal)
      .then((res) => {
        if (!active) return;
        setSeries(res.points);
        setSeriesStatus(res.dataStatus);
      })
      .catch(() => {
        if (!active) return;
        setSeries([]);
        setSeriesStatus('UNAVAILABLE');
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [selectedSymbol, timeframe]);

  const isPositive = (activeInstrument?.changePercent ?? 0) >= 0;
  const seriesRisk = useMemo(
    () => calculateSeriesRiskMetrics(series.map((p) => p.price)),
    [series],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.02 }}
      transition={{ duration: 0.28, ease: FINTECH_EASE }}
      className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] shadow-[0_24px_70px_rgba(15,23,42,0.08)] overflow-hidden"
    >
      {/* Realistic Light Browser Chrome */}
      <div className="flex items-center justify-between gap-4 border-b border-[#E4E8F2] bg-[#F7F8FA] px-4 py-2.5">
        <div className="flex items-center gap-2 shrink-0" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-[#CBD5E1]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#CBD5E1]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#CBD5E1]" />
        </div>

        <div className="flex items-center gap-2 rounded border border-[#E4E8F2] bg-[#FFFFFF] px-3 py-1 text-[11.5px] font-mono text-[#667085] truncate max-w-[320px] w-full justify-center">
          <span className="truncate">nextrade.ai/app/{activeSidebar}</span>
        </div>

        <button
          type="button"
          onClick={() => onLaunchApp(activeSidebar, activeInstrument?.symbol ?? selectedSymbol)}
          className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#2D46E6] hover:text-[#2238C9] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <span>Open Full App</span>
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Browser Application Body */}
      <div className="grid grid-cols-1 lg:grid-cols-[210px_1fr] min-h-[460px]">
        {/* Left Sidebar */}
        <aside className="hidden lg:flex flex-col justify-between border-r border-[#E4E8F2] bg-[#F7F8FA] p-3.5">
          <div className="space-y-4">
            <div className="px-2 py-1">
              <BrandLogo variant="light" symbolHeightClass="h-3.5" />
            </div>

            <nav aria-label="Workspace preview sections" className="space-y-0.5">
              {PREVIEW_SIDEBAR.map((item) => {
                const Icon = item.icon;
                const active = activeSidebar === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveSidebar(item.id)}
                    className={`relative w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[12.5px] font-medium transition-colors cursor-pointer ${
                      active ? 'text-[#FFFFFF]' : 'text-[#667085] hover:text-[#080B12] hover:bg-[#EFF2FA]'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId={`preview-sidebar-pill-${instanceId}`}
                        transition={FINTECH_SPRING_SNAPPY}
                        className="absolute inset-0 rounded-md bg-[#2D46E6]"
                        aria-hidden="true"
                      />
                    )}
                    <Icon className="relative z-10 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="relative z-10 truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="border-t border-[#E4E8F2] pt-3 px-2 space-y-1">
            <p className="text-[11px] font-semibold text-[#080B12]">Live Multi-Asset Feeds</p>
            <p className="text-[11px] text-[#667085] font-mono">
              {overview?.dataStatus ?? (overviewLoading ? 'SYNCING' : 'UNAVAILABLE')}
            </p>
          </div>
        </aside>

        {/* Main Workspace Canvas */}
        <div className="flex flex-col bg-[#FFFFFF]">
          {/* Top Workspace Selector */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E4E8F2] px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2 text-xs text-[#667085]">
              <Search className="h-3.5 w-3.5 text-[#667085] shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Instrument:</span>
              <div className="flex items-center gap-1 flex-wrap">
                {(featuredSymbols.length > 0 ? featuredSymbols : [selectedSymbol]).map((sym) => {
                  const selected = sym === (activeInstrument?.symbol ?? selectedSymbol);
                  return (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => setSelectedSymbol(sym)}
                      className={`relative rounded px-2 py-1 font-mono text-[11.5px] transition-colors cursor-pointer ${
                        selected
                          ? 'text-[#FFFFFF] font-semibold'
                          : 'bg-[#F7F8FA] text-[#667085] hover:text-[#080B12] border border-[#E4E8F2]'
                      }`}
                    >
                      {selected && (
                        <motion.span
                          layoutId={`preview-sym-pill-${instanceId}`}
                          transition={FINTECH_SPRING_SNAPPY}
                          className="absolute inset-0 rounded bg-[#2D46E6]"
                          aria-hidden="true"
                        />
                      )}
                      <span className="relative z-10">{sym}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-1 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] p-0.5">
              {(['1D', '1W', '1M', '6M', '1Y'] as TimeframeKey[]).map((tf) => {
                const active = timeframe === tf;
                return (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => setTimeframe(tf)}
                    className={`relative rounded px-2 py-1 font-mono text-[11px] transition-colors cursor-pointer ${
                      active
                        ? 'text-[#080B12] font-semibold'
                        : 'text-[#667085] hover:text-[#080B12]'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId={`preview-tf-pill-${instanceId}`}
                        transition={FINTECH_SPRING_SNAPPY}
                        className="absolute inset-0 rounded bg-[#FFFFFF] shadow-xs"
                        aria-hidden="true"
                      />
                    )}
                    <span className="relative z-10">{tf}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={`${activeSidebar}-${activeInstrument?.symbol ?? selectedSymbol}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: FINTECH_EASE }}
              className="flex-1 flex flex-col"
            >
              {activeSidebar === 'markets' ? (
                <div className="p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-display text-sm font-bold text-[#080B12]">
                        Global Exchange Benchmark Snapshot
                      </h3>
                      <p className="text-xs text-[#667085]">
                        Live &amp; delayed benchmark data from Yahoo Finance &amp; ECB FX
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onLaunchApp('markets', activeInstrument?.symbol ?? selectedSymbol)}
                      className="text-xs font-semibold text-[#2D46E6] hover:underline cursor-pointer"
                    >
                      Open Markets →
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 tabular-nums">
                    {indices.length === 0 ? (
                      <div className="col-span-3 rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-5 text-xs text-[#667085]">
                        {overviewLoading ? 'Syncing benchmark series…' : 'Benchmark feed unavailable.'}
                      </div>
                    ) : (
                      indices.map((idx) => {
                        const pos = (idx.changePercent ?? 0) >= 0;
                        return (
                          <div
                            key={idx.id}
                            className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-3.5 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="text-[10.5px] font-mono text-[#667085]">
                                {idx.exchange} · {idx.dataStatus}
                              </div>
                              <div className="text-xs font-bold text-[#080B12] truncate">{idx.name}</div>
                              <div className="mt-1 font-mono text-xs text-[#080B12]">
                                {idx.value !== null
                                  ? idx.value.toLocaleString('en-US', { minimumFractionDigits: 2 })
                                  : 'Unavailable'}{' '}
                                {idx.changePercent !== null && (
                                  <span className={pos ? 'text-[#16A34A]' : 'text-[#DC2626]'}>
                                    {formatSignedPercent(idx.changePercent)}
                                  </span>
                                )}
                              </div>
                            </div>
                            {idx.sparkline.length >= 2 && (
                              <Sparkline values={idx.sparkline} positive={pos} width={60} height={26} />
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : activeSidebar === 'portfolio' ? (
                <div className="p-5 space-y-4 tabular-nums">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-display text-sm font-bold text-[#080B12]">
                        User-Owned Portfolio &amp; Simulated Paper Ledger
                      </h3>
                      <p className="text-xs text-[#667085]">
                        Clean starting buying power: $
                        {CLEAN_PAPER_TRADING_STATE.cashBalanceUsd.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                        })}{' '}
                        · Zero pre-seeded fake positions
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onLaunchApp('portfolio')}
                      className="text-xs font-semibold text-[#2D46E6] hover:underline cursor-pointer"
                    >
                      Open Portfolio →
                    </button>
                  </div>
                  <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-6 text-center space-y-2">
                    <p className="text-xs font-semibold text-[#080B12]">
                      Your workspace ledger starts completely clean
                    </p>
                    <p className="text-xs text-[#667085] max-w-md mx-auto">
                      Add real personal holdings with explicit cost basis or practice simulated BUY/SELL orders on live quotes inside the authenticated workspace.
                    </p>
                  </div>
                </div>
              ) : activeSidebar === 'analytics' ? (
                <div className="p-5 space-y-4 tabular-nums">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-display text-sm font-bold text-[#080B12]">
                        Risk &amp; Dispersion Analytics — {activeInstrument?.symbol ?? selectedSymbol}
                      </h3>
                      <p className="text-xs text-[#667085]">
                        Computed strictly from fetched {timeframe} OHLC history · {seriesStatus}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onLaunchApp('analytics', activeInstrument?.symbol ?? selectedSymbol)}
                      className="text-xs font-semibold text-[#2D46E6] hover:underline cursor-pointer"
                    >
                      Open Analytics →
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-3.5">
                      <div className="text-[11px] text-[#667085]">Period Return</div>
                      <div className="mt-1 font-mono text-sm font-semibold text-[#080B12]">
                        {seriesRisk.hasData ? formatSignedPercent(seriesRisk.periodReturnPct) : 'Insufficient Data'}
                      </div>
                    </div>
                    <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-3.5">
                      <div className="text-[11px] text-[#667085]">Annualized Vol</div>
                      <div className="mt-1 font-mono text-sm font-semibold text-[#080B12]">
                        {seriesRisk.hasData ? `${seriesRisk.annualizedVolatilityPct}%` : '—'}
                      </div>
                    </div>
                    <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-3.5">
                      <div className="text-[11px] text-[#667085]">Max Drawdown</div>
                      <div className="mt-1 font-mono text-sm font-semibold text-[#DC2626]">
                        {seriesRisk.hasData ? `-${seriesRisk.maxDrawdownPct}%` : '—'}
                      </div>
                    </div>
                    <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-3.5">
                      <div className="text-[11px] text-[#667085]">USD/INR Rate</div>
                      <div className="mt-1 font-mono text-sm font-semibold text-[#080B12]">
                        {overview?.usdInrRate ? `₹${overview.usdInrRate.toFixed(2)}` : 'Unavailable'}
                      </div>
                    </div>
                  </div>
                  {series.length >= 2 ? (
                    <InteractivePriceChart
                      data={series}
                      currency={activeInstrument?.currency ?? 'USD'}
                      positive={isPositive}
                      height={155}
                    />
                  ) : (
                    <div className="flex h-[155px] items-center justify-center rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] text-xs text-[#667085]">
                      {historyLoading ? 'Loading historical price bars…' : 'Historical series unavailable for this timeframe.'}
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-[#E4E8F2] flex-1">
                  <div className="md:col-span-7 p-4 sm:p-5 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-[#667085] font-mono">
                          <span>{activeInstrument?.exchange ?? 'EXCHANGE'}</span>
                          <span aria-hidden="true">·</span>
                          <span>{activeInstrument?.dataStatus ?? 'SYNCING'}</span>
                        </div>
                        <h3 className="mt-1 font-display text-base sm:text-lg font-bold text-[#080B12]">
                          {activeInstrument?.name ?? selectedSymbol}
                        </h3>
                      </div>

                      <div className="text-right tabular-nums shrink-0">
                        <div className="font-mono text-base sm:text-lg font-bold text-[#080B12]">
                          {activeInstrument && activeInstrument.price !== null
                            ? formatCurrencyValue(activeInstrument.price, activeInstrument.currency)
                            : overviewLoading
                              ? 'Loading…'
                              : 'Unavailable'}
                        </div>
                        <div
                          className={`font-mono text-xs font-medium whitespace-nowrap ${
                            activeInstrument?.changePercent === null || activeInstrument?.changePercent === undefined
                              ? 'text-[#667085]'
                              : isPositive
                                ? 'text-[#16A34A]'
                                : 'text-[#DC2626]'
                          }`}
                        >
                          {activeInstrument?.changePercent !== null && activeInstrument?.changePercent !== undefined
                            ? formatSignedPercent(activeInstrument.changePercent)
                            : '—'}
                        </div>
                      </div>
                    </div>

                    {series.length >= 2 ? (
                      <InteractivePriceChart
                        data={series}
                        currency={activeInstrument?.currency ?? 'USD'}
                        positive={isPositive}
                        height={205}
                      />
                    ) : (
                      <div className="flex h-[205px] items-center justify-center rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] text-xs text-[#667085]">
                        {historyLoading ? 'Fetching live historical series…' : 'Historical chart unavailable'}
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-3 border-t border-[#E4E8F2] pt-3.5 tabular-nums">
                      <div>
                        <div className="text-[11px] text-[#667085]">Period Return</div>
                        <div className="mt-0.5 font-mono text-xs sm:text-sm font-semibold text-[#080B12]">
                          {seriesRisk.hasData ? formatSignedPercent(seriesRisk.periodReturnPct) : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-[#667085]">Ann. Volatility</div>
                        <div className="mt-0.5 font-mono text-xs sm:text-sm font-semibold text-[#080B12]">
                          {seriesRisk.hasData ? `${seriesRisk.annualizedVolatilityPct}%` : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-[#667085]">USD/INR FX</div>
                        <div className="mt-0.5 font-mono text-xs sm:text-sm font-semibold text-[#080B12]">
                          {overview?.usdInrRate ? `₹${overview.usdInrRate.toFixed(2)}` : '—'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Honest AI Building Mode Panel */}
                  <div className="md:col-span-5 p-4 sm:p-5 flex flex-col justify-between space-y-4 bg-[#F7F8FA]/70">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-[#080B12]">
                          <Cpu className="h-3.5 w-3.5 text-[#2D46E6]" aria-hidden="true" />
                          <span>AI Financial Intelligence</span>
                        </span>
                        <span className="font-mono text-[11px] text-[#2D46E6] font-semibold">
                          BUILDING MODE
                        </span>
                      </div>

                      <p className="text-[13px] leading-relaxed text-[#080B12]">
                        AI-powered financial intelligence is currently under active development in Nextrade AI. We never display fabricated or static sample AI theses.
                      </p>

                      <div className="space-y-2 border-t border-[#E4E8F2] pt-3 text-[12px] text-[#667085]">
                        <div className="text-[11px] font-semibold text-[#080B12]">
                          Module Status Roadmap
                        </div>
                        <div className="flex items-center justify-between font-mono text-[11px]">
                          <span>Live Gemini Research (/api/research)</span>
                          <span className="text-[#2D46E6]">LIVE WHEN CONFIGURED</span>
                        </div>
                        <div className="flex items-center justify-between font-mono text-[11px]">
                          <span>AI Market Analysis Engine</span>
                          <span>COMING SOON</span>
                        </div>
                        <div className="flex items-center justify-between font-mono text-[11px]">
                          <span>AI Portfolio &amp; Predictive Models</span>
                          <span>COMING SOON</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 border-t border-[#E4E8F2] pt-3">
                      <span className="text-[11px] font-mono text-[#667085]">
                        {activeInstrument?.provider ?? 'Upstream Market Feed'}
                      </span>
                      <button
                        type="button"
                        onClick={() => onLaunchApp('research', activeInstrument?.symbol ?? selectedSymbol)}
                        className="text-[12px] font-semibold text-[#2D46E6] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Open Research →
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
};
