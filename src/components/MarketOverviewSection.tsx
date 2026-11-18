import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronUp,
  ChevronDown,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
} from 'lucide-react';
import {
  InstrumentCategory,
  MarketRegion,
  filterInstruments,
  formatCurrencyValue,
  formatSignedPercent,
} from '../lib/marketData';
import { useMarketOverview } from '../lib/marketClient';
import { FINTECH_EASE, FINTECH_SPRING_SNAPPY } from '../lib/motionPrimitives';
import { Sparkline } from './SparklineChart';

interface MarketOverviewSectionProps {
  onOpenMarkets: (region: MarketRegion) => void;
  onLaunchSymbol?: (symbol: string) => void;
}

const CATEGORY_TABS: ReadonlyArray<{ id: 'ALL' | InstrumentCategory; label: string }> = [
  { id: 'ALL', label: 'All Assets' },
  { id: 'STOCK', label: 'Stocks' },
  { id: 'INDEX', label: 'Indices' },
  { id: 'ETF', label: 'ETFs' },
  { id: 'CRYPTO', label: 'Crypto' },
  { id: 'FOREX', label: 'Forex' },
];

export const MarketOverviewSection: React.FC<MarketOverviewSectionProps> = ({
  onOpenMarkets,
  onLaunchSymbol,
}) => {
  const { data: overview, loading, error, refresh } = useMarketOverview({ refreshMs: 60_000 });
  const [ribbonIndex, setRibbonIndex] = useState(0);
  const [regionFilter, setRegionFilter] = useState<'ALL' | MarketRegion>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | InstrumentCategory>('ALL');
  const [activeRowSymbol, setActiveRowSymbol] = useState<string>('NVDA');

  const indices = useMemo(() => overview?.indices ?? [], [overview]);
  const instruments = useMemo(() => overview?.instruments ?? [], [overview]);

  const activeBenchmark =
    indices.length > 0 ? indices[ribbonIndex % indices.length] : null;
  const benchmarkPositive = (activeBenchmark?.changePercent ?? 0) >= 0;

  const visibleInstruments = useMemo(
    () => filterInstruments(instruments, '', regionFilter, categoryFilter).slice(0, 8),
    [instruments, regionFilter, categoryFilter],
  );

  useEffect(() => {
    if (visibleInstruments.length === 0) return;
    if (!visibleInstruments.some((item) => item.symbol === activeRowSymbol)) {
      setActiveRowSymbol(visibleInstruments[0].symbol);
    }
  }, [visibleInstruments, activeRowSymbol]);

  const cycleBenchmark = (delta: number) => {
    if (indices.length === 0) return;
    setRibbonIndex((prev) => (prev + delta + indices.length) % indices.length);
  };

  return (
    <section id="markets" className="bg-[#FFFFFF]">
      {/* Signature Full-Width Royal Cobalt Benchmark Ribbon */}
      <div className="bg-[#2D46E6] text-[#FFFFFF]">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <div className="text-xs sm:text-sm font-medium leading-tight text-white/90">
              Market Benchmarks
              <br className="hidden sm:inline" />{' '}
              <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-white/75">
                {overview?.dataStatus ?? (loading ? 'SYNCING' : 'UNAVAILABLE')}
              </span>
            </div>

            <div className="flex flex-col items-center border-l border-white/20 pl-3">
              <button
                type="button"
                onClick={() => cycleBenchmark(-1)}
                aria-label="Previous benchmark index"
                className="p-0.5 text-white/80 hover:text-white cursor-pointer"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => cycleBenchmark(1)}
                aria-label="Next benchmark index"
                className="p-0.5 text-white/80 hover:text-white cursor-pointer"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="min-h-[42px] flex items-center overflow-hidden">
            {activeBenchmark ? (
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeBenchmark.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18, ease: FINTECH_EASE }}
                  className="flex flex-wrap items-center gap-5 sm:gap-8 tabular-nums"
                >
                  <div>
                    <div className="text-sm font-semibold text-white">
                      {activeBenchmark.name}
                    </div>
                    <div className="text-[11px] text-white/75 font-mono">
                      {activeBenchmark.dataStatus} · {activeBenchmark.provider}
                    </div>
                  </div>

                  <div className="font-mono text-sm sm:text-base font-semibold text-white">
                    {activeBenchmark.value !== null
                      ? activeBenchmark.value.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })
                      : 'Unavailable'}
                  </div>

                  <div className="inline-flex items-center gap-1 font-mono text-xs font-medium text-white">
                    {activeBenchmark.changePercent !== null ? (
                      <>
                        {benchmarkPositive ? (
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        <span>{formatSignedPercent(activeBenchmark.changePercent)}</span>
                      </>
                    ) : (
                      <span>—</span>
                    )}
                  </div>

                  {activeBenchmark.sparkline.length >= 2 && (
                    <div className="hidden sm:block">
                      <Sparkline
                        values={activeBenchmark.sparkline}
                        strokeOverride="#FFFFFF"
                        width={96}
                        height={28}
                      />
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            ) : (
              <div className="text-xs font-mono text-white/80">
                {loading ? 'Loading live exchange benchmarks…' : error ?? 'Benchmark feed unavailable.'}
              </div>
            )}
          </div>

          <motion.button
            type="button"
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={FINTECH_SPRING_SNAPPY}
            onClick={() => onOpenMarkets(activeBenchmark?.region ?? 'US')}
            className="rounded-md bg-[#FFFFFF] px-5 py-2 text-xs font-semibold tracking-[0.04em] uppercase text-[#2D46E6] hover:bg-[#F7F8FA] transition-colors whitespace-nowrap cursor-pointer"
          >
            Explore {activeBenchmark?.region === 'IN' ? 'India' : activeBenchmark?.region === 'GLOBAL' ? 'Global' : 'Markets'}
          </motion.button>
        </div>
      </div>

      {/* Benchmark Mini Grid + Live Multi-Asset Table */}
      <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 space-y-10">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-[-0.02em] text-[#080B12]">
              Real multi-asset market intelligence in one workspace
            </h2>
            <p className="mt-2 text-sm text-[#667085] max-w-2xl">
              Track Stocks, Indices, ETFs, Crypto, and Forex feeds from Yahoo Finance, CoinGecko, and Frankfurter ECB FX.{' '}
              <span className="font-mono text-xs text-[#080B12] font-medium">
                {overview?.usdInrRate
                  ? `USD/INR ₹${overview.usdInrRate.toFixed(2)} (${overview.usdInrStatus})`
                  : 'FX feed syncing'}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Filter market region"
              className="inline-flex items-center gap-1 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] p-1"
            >
              {(
                [
                  { id: 'ALL', label: 'All Regions' },
                  { id: 'IN', label: 'India' },
                  { id: 'US', label: 'United States' },
                  { id: 'GLOBAL', label: 'Global / FX' },
                ] as const
              ).map((tab) => {
                const active = regionFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setRegionFilter(tab.id)}
                    className={`relative rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      active ? 'text-[#FFFFFF]' : 'text-[#667085] hover:text-[#080B12]'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="market-region-pill"
                        transition={FINTECH_SPRING_SNAPPY}
                        className="absolute inset-0 rounded bg-[#2D46E6]"
                        aria-hidden="true"
                      />
                    )}
                    <span className="relative z-10">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => void refresh()}
              title="Refresh quotes"
              aria-label="Refresh market overview"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3 text-xs font-medium text-[#667085] hover:text-[#080B12] hover:border-[#CBD5E1] cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Category Filter Bar */}
        <div
          role="group"
          aria-label="Filter asset class"
          className="flex flex-wrap items-center gap-2 border-b border-[#E4E8F2] pb-3"
        >
          {CATEGORY_TABS.map((cat) => {
            const active = categoryFilter === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryFilter(cat.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-[#080B12] text-[#FFFFFF]'
                    : 'bg-[#F7F8FA] text-[#667085] hover:text-[#080B12]'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Benchmark Cards Strip */}
        {indices.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.02 }}
            transition={{ duration: 0.28, ease: FINTECH_EASE }}
            className="flex md:grid md:grid-cols-3 lg:grid-cols-6 gap-3 overflow-x-auto pb-2 md:pb-0 snap-x"
          >
            {indices
              .filter((idx) => regionFilter === 'ALL' || idx.region === regionFilter)
              .map((idx, i) => {
                const pos = (idx.changePercent ?? 0) >= 0;
                const isSelected = i === ribbonIndex % indices.length;
                return (
                  <motion.button
                    key={idx.id}
                    layout
                    type="button"
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.985 }}
                    transition={FINTECH_SPRING_SNAPPY}
                    onClick={() => setRibbonIndex(indices.findIndex((m) => m.id === idx.id))}
                    className={`min-w-[185px] md:min-w-0 snap-start text-left rounded-lg border p-3.5 transition-colors cursor-pointer tabular-nums ${
                      isSelected
                        ? 'border-[#2D46E6] bg-[#EFF2FA]'
                        : 'border-[#E4E8F2] bg-[#F7F8FA] hover:border-[#CBD5E1]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10.5px] font-mono text-[#667085]">
                      <span>{idx.exchange}</span>
                      <span>{idx.dataStatus}</span>
                    </div>
                    <div className="mt-0.5 font-display text-xs font-bold text-[#080B12] truncate">
                      {idx.name}
                    </div>
                    <div className="mt-2 font-mono text-sm font-semibold text-[#080B12]">
                      {idx.value !== null
                        ? idx.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : 'Unavailable'}
                    </div>
                    <div
                      className={`mt-0.5 font-mono text-[11px] font-medium ${
                        idx.changePercent === null
                          ? 'text-[#667085]'
                          : pos
                            ? 'text-[#16A34A]'
                            : 'text-[#DC2626]'
                      }`}
                    >
                      {idx.changePercent !== null ? formatSignedPercent(idx.changePercent) : '—'}
                    </div>
                  </motion.button>
                );
              })}
          </motion.div>
        )}

        {/* Signature Light Table Card with Full-Bleed Cobalt Active Row */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.02 }}
          transition={{ duration: 0.28, ease: FINTECH_EASE }}
          className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] shadow-[0_18px_50px_rgba(15,23,42,0.06)] overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs tabular-nums">
              <thead className="border-b border-[#E4E8F2] bg-[#F7F8FA] text-[11px] font-semibold uppercase tracking-[0.04em] text-[#667085]">
                <tr>
                  <th className="px-6 py-4">Instrument</th>
                  <th className="px-4 py-4">Price</th>
                  <th className="px-4 py-4">5D Trend</th>
                  <th className="px-4 py-4">Change</th>
                  <th className="px-4 py-4">Source / Status</th>
                  <th className="px-6 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E8F2]">
                {visibleInstruments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-sm text-[#667085]">
                      {loading
                        ? 'Fetching live quotes from exchange adapters…'
                        : error ?? 'No instruments match the selected region and asset filter.'}
                    </td>
                  </tr>
                ) : (
                  visibleInstruments.map((inst) => {
                    const pos = (inst.changePercent ?? 0) >= 0;
                    const active = inst.symbol === activeRowSymbol;
                    return (
                      <tr
                        key={inst.symbol}
                        onClick={() => setActiveRowSymbol(inst.symbol)}
                        className={`transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#2D46E6] text-[#FFFFFF]'
                            : 'bg-[#FFFFFF] text-[#080B12] hover:bg-[#F7F8FA]'
                        }`}
                      >
                        <td className="px-6 py-4">
                          <div className="font-mono font-bold text-sm">{inst.symbol}</div>
                          <div
                            className={`text-[11px] ${
                              active ? 'text-white/80' : 'text-[#667085]'
                            }`}
                          >
                            {inst.name} · {inst.exchange} · {inst.category}
                          </div>
                        </td>
                        <td className="px-4 py-4 font-mono font-semibold text-sm whitespace-nowrap">
                          {inst.price !== null
                            ? formatCurrencyValue(inst.price, inst.currency)
                            : 'Unavailable'}
                        </td>
                        <td className="px-4 py-4">
                          {inst.sparkline.length >= 2 ? (
                            <Sparkline
                              values={inst.sparkline}
                              positive={pos}
                              strokeOverride={active ? '#FFFFFF' : undefined}
                              width={92}
                              height={28}
                            />
                          ) : (
                            <span className={`font-mono text-[11px] ${active ? 'text-white/75' : 'text-[#667085]'}`}>
                              —
                            </span>
                          )}
                        </td>
                        <td
                          className={`px-4 py-4 font-mono font-semibold whitespace-nowrap ${
                            inst.changePercent === null
                              ? active
                                ? 'text-white/75'
                                : 'text-[#667085]'
                              : active
                                ? 'text-white'
                                : pos
                                  ? 'text-[#16A34A]'
                                  : 'text-[#DC2626]'
                          }`}
                        >
                          {inst.changePercent !== null ? formatSignedPercent(inst.changePercent) : '—'}
                        </td>
                        <td
                          className={`px-4 py-4 font-mono text-[11px] ${
                            active ? 'text-white/90' : 'text-[#667085]'
                          }`}
                        >
                          {inst.dataStatus} · {inst.provider}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onLaunchSymbol) {
                                onLaunchSymbol(inst.symbol);
                              } else {
                                onOpenMarkets(inst.region);
                              }
                            }}
                            className={`rounded-md px-4 py-2 text-[11px] font-semibold tracking-[0.04em] uppercase transition-colors cursor-pointer whitespace-nowrap ${
                              active
                                ? 'bg-[#FFFFFF] text-[#2D46E6] hover:bg-[#F7F8FA]'
                                : 'bg-[#2D46E6] text-[#FFFFFF] hover:bg-[#2238C9]'
                            }`}
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="border-t border-[#E4E8F2] bg-[#FFFFFF] py-5 text-center">
            <motion.button
              type="button"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onOpenMarkets(regionFilter === 'ALL' ? 'US' : regionFilter)}
              className="inline-flex items-center justify-center rounded-md border border-[#CBD5E1] px-6 py-2.5 text-[11.5px] font-semibold tracking-[0.04em] uppercase text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] transition-colors cursor-pointer"
            >
              View All Multi-Asset Markets
            </motion.button>
          </div>
        </motion.div>
      </div>
    </section>
  );
};
