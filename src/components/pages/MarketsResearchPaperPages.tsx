import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Search,
  Sparkles,
  ShieldAlert,
  Activity,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Cpu,
  Clock,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { SitePageShell, PageHeaderBand, DisclosureNotice } from '../PagePrimitives';
import { AnimatedMetricValue, FINTECH_EASE, FINTECH_SPRING_SNAPPY } from '../../lib/motionPrimitives';
import {
  InstrumentCategory,
  MarketRegion,
  MarketSearchResultDto,
  filterInstruments,
  formatCurrencyValue,
  formatSignedPercent,
} from '../../lib/marketData';
import { searchMarketInstruments, useMarketOverview } from '../../lib/marketClient';
import {
  CLEAN_PAPER_TRADING_STATE,
  PaperPortfolioState,
  calculatePortfolioMetrics,
  executePaperOrder,
} from '../../lib/portfolioEngine';
import { Sparkline } from '../SparklineChart';

interface PageActionProps {
  onNavigate: (path: string) => void;
  onLaunchApp: (tab?: string, symbol?: string, region?: 'IN' | 'US' | 'ALL') => void;
}

const ASSET_CATEGORIES: ReadonlyArray<{ id: 'ALL' | InstrumentCategory; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'STOCK', label: 'Stocks' },
  { id: 'INDEX', label: 'Indices' },
  { id: 'ETF', label: 'ETFs' },
  { id: 'CRYPTO', label: 'Crypto' },
  { id: 'FOREX', label: 'Forex' },
];

export const MarketsPage: React.FC<PageActionProps> = ({ onNavigate, onLaunchApp }) => {
  const { data: overview, loading, error } = useMarketOverview({ refreshMs: 60_000 });
  const [regionFilter, setRegionFilter] = useState<'ALL' | MarketRegion>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | InstrumentCategory>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [remoteSearchResults, setRemoteSearchResults] = useState<MarketSearchResultDto[]>([]);
  const [searchingRemote, setSearchingRemote] = useState(false);

  const indices = useMemo(() => overview?.indices ?? [], [overview]);
  const instruments = useMemo(() => overview?.instruments ?? [], [overview]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setRemoteSearchResults([]);
      setSearchingRemote(false);
      return;
    }
    const controller = new AbortController();
    setSearchingRemote(true);
    const timer = setTimeout(() => {
      searchMarketInstruments(q, controller.signal)
        .then((res) => setRemoteSearchResults(res))
        .catch(() => setRemoteSearchResults([]))
        .finally(() => setSearchingRemote(false));
    }, 280);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  const indiaIndices = indices.filter((i) => i.region === 'IN');
  const usIndices = indices.filter((i) => i.region === 'US');
  const filteredEquities = filterInstruments(
    instruments,
    searchQuery,
    regionFilter,
    categoryFilter,
  );

  return (
    <SitePageShell currentPath="/markets" onNavigate={onNavigate}>
      <PageHeaderBand
        variant="left"
        eyebrow="Supported Markets"
        title="Stocks, Indices, ETFs, Crypto & Forex in one unified view."
        description="Real-time and delayed quotes fetched by the Nextrade AI backend from Yahoo Finance, CoinGecko, and Frankfurter ECB FX with L2 database caching and explicit freshness labels."
        primaryCta={{
          label: 'Open Markets in /app',
          onClick: () => onLaunchApp('markets', undefined, regionFilter === 'GLOBAL' ? 'ALL' : regionFilter),
        }}
        secondaryCta={{ label: 'Explore AI Research', onClick: () => onNavigate('/research') }}
      />

      <section className="bg-[#FFFFFF] py-12 sm:py-16">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 space-y-12">
          {/* Data Source & Freshness Banner */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#667085]">
                Market Data Providers
              </div>
              <div className="mt-1 font-mono text-sm font-bold text-[#080B12]">
                {overview?.provider ?? (loading ? 'Connecting adapters…' : 'Unavailable')}
              </div>
            </div>
            <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#667085]">
                Data Classification &amp; Status
              </div>
              <div className="mt-1 font-mono text-sm font-bold text-[#2D46E6]">
                {overview?.dataStatus ?? (loading ? 'SYNCING' : 'UNAVAILABLE')}
              </div>
            </div>
            <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#667085]">
                Live USD / INR Reference Rate
              </div>
              <div className="mt-1 font-mono text-sm font-bold text-[#080B12]">
                {overview?.usdInrRate
                  ? `1 USD = ₹${overview.usdInrRate.toFixed(4)} (${overview.usdInrStatus})`
                  : loading
                    ? 'Fetching ECB FX…'
                    : 'Unavailable'}
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              {error}
            </div>
          )}

          {/* Regional Coverage Breakdown: India vs US */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-[#E4E8F2] pb-4">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#2D46E6]">
                    Region 01 · INR
                  </span>
                  <h2 className="font-display text-xl font-bold text-[#080B12]">
                    India — NSE &amp; BSE
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setRegionFilter('IN')}
                  className="rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 py-1.5 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] cursor-pointer"
                >
                  Filter India
                </button>
              </div>
              <p className="text-sm text-[#667085]">
                Indian benchmarks (NIFTY 50, SENSEX, BANK NIFTY) and NSE-listed leaders fetched directly from Yahoo Finance chart endpoints.
              </p>
              <div className="space-y-3 tabular-nums">
                {indiaIndices.length === 0 ? (
                  <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-4 text-xs text-[#667085]">
                    {loading ? 'Loading Indian indices…' : 'Indian index feed unavailable.'}
                  </div>
                ) : (
                  indiaIndices.map((idx) => (
                    <div
                      key={idx.id}
                      className="flex items-center justify-between rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] px-4 py-3"
                    >
                      <div>
                        <div className="font-display text-sm font-bold text-[#080B12]">{idx.name}</div>
                        <div className="text-[11px] font-mono text-[#667085]">
                          {idx.dataStatus} · {idx.provider}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {idx.sparkline.length >= 2 && (
                          <Sparkline
                            values={idx.sparkline}
                            positive={(idx.changePercent ?? 0) >= 0}
                            width={68}
                            height={24}
                          />
                        )}
                        <div className="text-right font-mono">
                          <div className="text-sm font-semibold text-[#080B12]">
                            {idx.value !== null
                              ? idx.value.toLocaleString('en-US', { minimumFractionDigits: 2 })
                              : 'Unavailable'}
                          </div>
                          <div
                            className={`text-xs ${
                              idx.changePercent === null
                                ? 'text-[#667085]'
                                : idx.changePercent >= 0
                                  ? 'text-[#16A34A]'
                                  : 'text-[#DC2626]'
                            }`}
                          >
                            {idx.changePercent !== null ? formatSignedPercent(idx.changePercent) : '—'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-[#E4E8F2] pb-4">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#2D46E6]">
                    Region 02 · USD
                  </span>
                  <h2 className="font-display text-xl font-bold text-[#080B12]">
                    United States — NYSE &amp; NASDAQ
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setRegionFilter('US')}
                  className="rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 py-1.5 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] cursor-pointer"
                >
                  Filter US
                </button>
              </div>
              <p className="text-sm text-[#667085]">
                US market benchmarks (S&amp;P 500, NASDAQ, DOW JONES), ETFs (SPY, QQQ), large-cap equities, crypto pairs, and major forex rates.
              </p>
              <div className="space-y-3 tabular-nums">
                {usIndices.length === 0 ? (
                  <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-4 text-xs text-[#667085]">
                    {loading ? 'Loading US indices…' : 'US index feed unavailable.'}
                  </div>
                ) : (
                  usIndices.map((idx) => (
                    <div
                      key={idx.id}
                      className="flex items-center justify-between rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] px-4 py-3"
                    >
                      <div>
                        <div className="font-display text-sm font-bold text-[#080B12]">{idx.name}</div>
                        <div className="text-[11px] font-mono text-[#667085]">
                          {idx.dataStatus} · {idx.provider}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {idx.sparkline.length >= 2 && (
                          <Sparkline
                            values={idx.sparkline}
                            positive={(idx.changePercent ?? 0) >= 0}
                            width={68}
                            height={24}
                          />
                        )}
                        <div className="text-right font-mono">
                          <div className="text-sm font-semibold text-[#080B12]">
                            {idx.value !== null
                              ? idx.value.toLocaleString('en-US', { minimumFractionDigits: 2 })
                              : 'Unavailable'}
                          </div>
                          <div
                            className={`text-xs ${
                              idx.changePercent === null
                                ? 'text-[#667085]'
                                : idx.changePercent >= 0
                                  ? 'text-[#16A34A]'
                                  : 'text-[#DC2626]'
                            }`}
                          >
                            {idx.changePercent !== null ? formatSignedPercent(idx.changePercent) : '—'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Interactive Multi-Asset Market Screener */}
          <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] shadow-[0_14px_40px_rgba(15,23,42,0.04)] overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-[#E4E8F2] bg-[#F7F8FA] px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-bold text-[#080B12]">
                    Live Multi-Asset Screener &amp; Global Symbol Search
                  </h2>
                  <p className="text-xs text-[#667085]">
                    Showing {filteredEquities.length} instruments ({overview?.instruments.length ?? 0} loaded in overview).
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#667085]"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      aria-label="Filter or search global symbols"
                      placeholder="Search ticker, ETF, crypto..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-9 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] pl-8 pr-3 text-xs text-[#080B12] focus:border-[#2D46E6] focus:outline-none"
                    />
                  </div>

                  <div className="inline-flex rounded-md border border-[#E4E8F2] bg-[#FFFFFF] p-0.5">
                    {(
                      [
                        { id: 'ALL', label: 'All' },
                        { id: 'IN', label: 'India' },
                        { id: 'US', label: 'US' },
                        { id: 'GLOBAL', label: 'Global' },
                      ] as const
                    ).map((tab) => {
                      const active = regionFilter === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setRegionFilter(tab.id)}
                          className={`relative rounded px-3 py-1 text-xs font-semibold cursor-pointer ${
                            active ? 'text-[#FFFFFF]' : 'text-[#667085] hover:text-[#080B12]'
                          }`}
                        >
                          {active && (
                            <motion.span
                              layoutId="markets-page-region-pill"
                              transition={FINTECH_SPRING_SNAPPY}
                              className="absolute inset-0 rounded bg-[#2D46E6]"
                            />
                          )}
                          <span className="relative z-10">{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {ASSET_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategoryFilter(cat.id)}
                    className={`rounded-md px-3 py-1 text-xs font-semibold cursor-pointer transition-colors ${
                      categoryFilter === cat.id
                        ? 'bg-[#080B12] text-[#FFFFFF]'
                        : 'bg-[#FFFFFF] border border-[#E4E8F2] text-[#667085] hover:text-[#080B12]'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="border-b border-[#E4E8F2] bg-[#FFFFFF] text-[11px] font-semibold uppercase tracking-[0.04em] text-[#667085]">
                  <tr>
                    <th className="px-5 py-3.5">Symbol / Asset</th>
                    <th className="px-4 py-3.5">Class · Exchange</th>
                    <th className="px-4 py-3.5">Price</th>
                    <th className="px-4 py-3.5">Change</th>
                    <th className="px-4 py-3.5">Source / Status</th>
                    <th className="px-5 py-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E8F2]">
                  {filteredEquities.map((inst) => (
                    <tr key={inst.symbol} className="hover:bg-[#F7F8FA]">
                      <td className="px-5 py-3.5">
                        <div className="font-mono font-bold text-[#080B12]">{inst.symbol}</div>
                        <div className="text-[11px] text-[#667085]">
                          {inst.name} · {inst.sector}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[#667085]">
                        {inst.category} · {inst.exchange}
                      </td>
                      <td className="px-4 py-3.5 font-mono font-semibold text-[#080B12] whitespace-nowrap">
                        {inst.price !== null
                          ? formatCurrencyValue(inst.price, inst.currency)
                          : 'Unavailable'}
                      </td>
                      <td
                        className={`px-4 py-3.5 font-mono font-semibold whitespace-nowrap ${
                          inst.changePercent === null
                            ? 'text-[#667085]'
                            : inst.changePercent >= 0
                              ? 'text-[#16A34A]'
                              : 'text-[#DC2626]'
                        }`}
                      >
                        {inst.changePercent !== null ? formatSignedPercent(inst.changePercent) : '—'}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[#667085]">
                        {inst.dataStatus} · {inst.provider}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            onLaunchApp(
                              'markets',
                              inst.symbol,
                              inst.region === 'GLOBAL' ? 'ALL' : inst.region,
                            )
                          }
                          className="rounded bg-[#EFF2FA] px-3 py-1.5 text-[11px] font-semibold text-[#2D46E6] hover:bg-[#2D46E6] hover:text-[#FFFFFF] transition-colors cursor-pointer whitespace-nowrap"
                        >
                          Open in App
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredEquities.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-xs text-[#667085]">
                        {loading
                          ? 'Fetching market instruments…'
                          : `No catalog instruments matched "${searchQuery}".`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {searchQuery.trim().length >= 2 && (
              <div className="border-t border-[#E4E8F2] bg-[#F7F8FA] p-5 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#080B12]">
                    Global Upstream Search Results for &ldquo;{searchQuery.trim()}&rdquo;
                  </span>
                  <span className="font-mono text-[#667085]">
                    {searchingRemote ? 'Searching upstream…' : `${remoteSearchResults.length} matches`}
                  </span>
                </div>
                {remoteSearchResults.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {remoteSearchResults.slice(0, 9).map((item) => (
                      <button
                        key={item.symbol}
                        type="button"
                        onClick={() => onLaunchApp('markets', item.symbol)}
                        className="flex items-center justify-between rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] px-3.5 py-2.5 text-left hover:border-[#2D46E6] cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-xs font-bold text-[#080B12] truncate">
                            {item.symbol}
                          </div>
                          <div className="text-[11px] text-[#667085] truncate">{item.name}</div>
                        </div>
                        <span className="font-mono text-[10.5px] text-[#2D46E6] shrink-0 ml-2">
                          {item.exchange}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <DisclosureNotice
            label="Market Data Transparency"
            text="Every price and historical series is sourced from real upstream adapters (Yahoo Finance, CoinGecko, Frankfurter ECB FX) or L2 database cache and labeled LIVE, DELAYED, CACHED, or UNAVAILABLE. Zero fabricated values are displayed."
          />
        </div>
      </section>
    </SitePageShell>
  );
};

interface ResearchResponse {
  symbol: string;
  source: string;
  model?: string;
  summary: string;
  keyDrivers: string[];
  riskFactors: string[];
  explainabilityBasis: string;
  disclaimer: string;
}

const AI_BUILDING_MODULES = [
  {
    name: 'AI Market Analysis Engine',
    status: 'BUILDING',
    detail:
      'Automated multi-timeframe technical & macro regime summarization grounded in verified exchange feeds.',
  },
  {
    name: 'AI Portfolio Intelligence',
    status: 'COMING SOON',
    detail:
      'Concentration stress scenarios, correlation clustering, and currency exposure commentary for user holdings.',
  },
  {
    name: 'Predictive & Risk Analytics',
    status: 'COMING SOON',
    detail:
      'Probabilistic volatility regimes and quantitative drawdown attribution without deterministic price guarantees.',
  },
] as const;

export const ResearchPage: React.FC<PageActionProps> = ({ onNavigate, onLaunchApp }) => {
  const { data: overview, loading: marketLoading } = useMarketOverview({ refreshMs: 60_000 });
  const instruments = useMemo(() => overview?.instruments ?? [], [overview]);
  const [symbol, setSymbol] = useState<string>('NVDA');
  const [query, setQuery] = useState<string>(
    'Evaluate key structural drivers, valuation sensitivity, and downside risks.',
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResearchResponse | null>(null);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/health', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.geminiConfigured === 'boolean') {
          setGeminiConfigured(data.geminiConfigured);
        }
      })
      .catch(() => setGeminiConfigured(null));
  }, []);

  useEffect(() => {
    if (instruments.length > 0 && !instruments.some((i) => i.symbol === symbol)) {
      setSymbol(instruments[0].symbol);
    }
  }, [instruments, symbol]);

  const selectedInstrument =
    instruments.find((i) => i.symbol === symbol) ?? instruments[0] ?? null;

  const handleRunResearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      setError('Please enter a research question.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, query: query.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `AI research unavailable (HTTP ${res.status}).`);
      } else {
        setResult(data as ResearchResponse);
      }
    } catch {
      setError('Network error calling POST /api/research.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SitePageShell currentPath="/research" onNavigate={onNavigate}>
      <PageHeaderBand
        variant="split"
        eyebrow="AI Intelligence & Building Mode"
        title="Explainable financial synthesis without fabricated answers."
        description="Nextrade AI pairs live Google Gemini synthesis (when configured) with an honest AI Building Mode roadmap. If AI credentials are absent or upstream inference fails, the system explicitly reports availability rather than faking analysis."
        primaryCta={{ label: 'Open AI Research in /app', onClick: () => onLaunchApp('research', symbol) }}
        secondaryCta={{ label: 'Inspect API Docs', onClick: () => onNavigate('/docs') }}
        aside={
          <div className="rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.05em] text-[#2D46E6]">
              <span>AI System Posture</span>
              <span className="font-mono text-[#080B12]">
                {geminiConfigured === null
                  ? 'CHECKING'
                  : geminiConfigured
                    ? 'GEMINI READY'
                    : 'BUILDING MODE'}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-[#667085]">
              AI-powered financial intelligence is currently under active development. Specialized analytical engines below show exact module status cleanly.
            </p>
            <div className="divide-y divide-[#E4E8F2] border-t border-[#E4E8F2] pt-2 text-xs">
              {AI_BUILDING_MODULES.map((mod) => (
                <div key={mod.name} className="py-2 flex items-center justify-between gap-2">
                  <span className="font-medium text-[#080B12]">{mod.name}</span>
                  <span className="font-mono text-[10.5px] font-semibold text-[#2D46E6]">
                    {mod.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        }
      />

      <section className="bg-[#FFFFFF] py-14 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 space-y-10">
          {/* AI Building Mode Notice Banner */}
          <div className="rounded-xl border border-[#2D46E6]/25 bg-[#EFF2FA] p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Cpu className="h-5 w-5 text-[#2D46E6] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1">
                <div className="font-display text-sm font-bold text-[#080B12]">
                  AI Building Mode Active — Live Gemini + Module Engineering
                </div>
                <p className="text-xs text-[#667085] leading-relaxed">
                  AI-powered financial intelligence is currently under development. We are actively training and integrating AI Market Analysis, AI Portfolio Intelligence, and Predictive Analytics—and never display fabricated placeholder briefs.
                </p>
              </div>
            </div>
            <span className="font-mono text-[11px] font-semibold text-[#2D46E6] whitespace-nowrap shrink-0">
              {geminiConfigured ? 'GEMINI_API_KEY: CONFIGURED' : 'GEMINI_API_KEY: NOT CONFIGURED'}
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Live Gemini Query Form */}
            <div className="lg:col-span-5 rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-bold text-[#080B12]">
                  Query Structured AI Research
                </h2>
                <span className="font-mono text-[11px] text-[#2D46E6]">POST /api/research</span>
              </div>

              <form onSubmit={handleRunResearch} className="space-y-4">
                <div>
                  <label
                    htmlFor="research-page-symbol"
                    className="block text-xs font-semibold text-[#080B12] mb-1.5"
                  >
                    Select Market Instrument
                  </label>
                  <select
                    id="research-page-symbol"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    disabled={instruments.length === 0}
                    className="w-full h-10 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3 font-mono text-xs text-[#080B12]"
                  >
                    {instruments.length === 0 ? (
                      <option value={symbol}>
                        {marketLoading ? 'Loading market instruments…' : symbol}
                      </option>
                    ) : (
                      instruments.map((inst) => (
                        <option key={inst.symbol} value={inst.symbol}>
                          {inst.symbol} — {inst.name} ({inst.exchange})
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3 text-xs space-y-1 tabular-nums">
                  <div className="font-semibold text-[#080B12]">
                    Live Market Quote Grounding
                  </div>
                  <div className="font-mono text-[#667085]">
                    {selectedInstrument && selectedInstrument.price !== null
                      ? `Price: ${formatCurrencyValue(selectedInstrument.price, selectedInstrument.currency)} · Change: ${
                          selectedInstrument.changePercent !== null
                            ? formatSignedPercent(selectedInstrument.changePercent)
                            : '—'
                        } · ${selectedInstrument.dataStatus} (${selectedInstrument.provider})`
                      : marketLoading
                        ? 'Fetching quote from upstream feed…'
                        : 'Quote currently unavailable; query runs without snapshot price.'}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="research-page-query"
                    className="block text-xs font-semibold text-[#080B12] mb-1.5"
                  >
                    Research Question
                  </label>
                  <textarea
                    id="research-page-query"
                    rows={3}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full rounded-md border border-[#E4E8F2] bg-[#FFFFFF] p-3 text-xs text-[#080B12] focus:border-[#2D46E6] focus:outline-none"
                  />
                </div>

                {error && (
                  <div className="rounded-md border border-[#DC2626]/30 bg-[#FEF2F2] px-3 py-2.5 text-xs text-[#DC2626]">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#2D46E6] px-5 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] hover:bg-[#2238C9] disabled:opacity-60 cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{loading ? 'Querying Gemini…' : 'Run Live Gemini Research'}</span>
                </button>
              </form>
            </div>

            {/* Honest Research Output Panel */}
            <div className="lg:col-span-7 rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-5 shadow-[0_14px_40px_rgba(15,23,42,0.04)]">
              {result ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E4E8F2] pb-4">
                    <div>
                      <div className="font-mono text-sm font-bold text-[#080B12]">
                        {result.symbol} — Live Gemini Synthesis
                      </div>
                      <div className="text-[11px] text-[#667085]">
                        Generated dynamically via server-side @google/genai
                      </div>
                    </div>
                    <span className="font-mono text-[11px] font-semibold text-[#2D46E6]">
                      source: {result.source} {result.model ? `· ${result.model}` : ''}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.05em] text-[#667085]">
                      Research Summary
                    </h3>
                    <p className="text-sm leading-relaxed text-[#080B12]">{result.summary}</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-4 space-y-2">
                      <h4 className="text-xs font-semibold text-[#16A34A]">Key Drivers</h4>
                      <ul className="space-y-1.5 text-xs leading-relaxed text-[#667085]">
                        {result.keyDrivers.map((d, i) => (
                          <li key={i}>+ {d}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-4 space-y-2">
                      <h4 className="text-xs font-semibold text-[#DC2626] flex items-center gap-1.5">
                        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Risk Factors</span>
                      </h4>
                      <ul className="space-y-1.5 text-xs leading-relaxed text-[#667085]">
                        {result.riskFactors.map((r, i) => (
                          <li key={i}>! {r}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#E4E8F2] bg-[#EFF2FA]/60 p-4 space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#2D46E6]">
                      Explainability Basis
                    </div>
                    <p className="text-xs leading-relaxed text-[#080B12]">
                      {result.explainabilityBasis}
                    </p>
                  </div>

                  <p className="text-[11px] text-[#667085] border-t border-[#E4E8F2] pt-3">
                    {result.disclaimer}
                  </p>
                </>
              ) : (
                <div className="space-y-6">
                  <div className="border-b border-[#E4E8F2] pb-4 flex items-center justify-between">
                    <div>
                      <h3 className="font-display text-base font-bold text-[#080B12]">
                        Awaiting Live Research Query
                      </h3>
                      <p className="text-xs text-[#667085]">
                        No placeholder AI theses are shown before executing a real query.
                      </p>
                    </div>
                    <Clock className="h-4 w-4 text-[#2D46E6]" aria-hidden="true" />
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    {AI_BUILDING_MODULES.map((mod) => (
                      <div
                        key={mod.name}
                        className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-4 space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-[#080B12]">{mod.name}</span>
                          <span className="font-mono text-[10.5px] font-semibold text-[#2D46E6]">
                            {mod.status}
                          </span>
                        </div>
                        <p className="text-xs text-[#667085] leading-relaxed">{mod.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </SitePageShell>
  );
};

export const PaperTradingPage: React.FC<PageActionProps> = ({ onNavigate, onLaunchApp }) => {
  const { data: overview, loading } = useMarketOverview({ refreshMs: 60_000 });
  const instruments = useMemo(() => overview?.instruments ?? [], [overview]);
  const usdInrRate = overview?.usdInrRate ?? null;

  const [simState, setSimState] = useState<PaperPortfolioState>(CLEAN_PAPER_TRADING_STATE);
  const [symbol, setSymbol] = useState<string>('NVDA');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [qtyInput, setQtyInput] = useState<string>('2');
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (instruments.length > 0 && !instruments.some((i) => i.symbol === symbol)) {
      setSymbol(instruments[0].symbol);
    }
  }, [instruments, symbol]);

  const inst = instruments.find((i) => i.symbol === symbol) ?? instruments[0] ?? null;
  const metrics = calculatePortfolioMetrics(simState, instruments, usdInrRate);

  const handlePlaceOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inst || inst.price === null || inst.price <= 0) {
      setFeedback({ ok: false, msg: 'Live market price is currently unavailable for this symbol.' });
      return;
    }
    if (inst.currency === 'INR' && (!usdInrRate || usdInrRate <= 0)) {
      setFeedback({ ok: false, msg: 'Live USD/INR FX rate is currently unavailable for INR settlement.' });
      return;
    }
    const quantity = Number(qtyInput);
    const { nextState, validation } = executePaperOrder(simState, {
      symbol: inst.symbol,
      side,
      quantity,
      executionPriceNative: inst.price,
      currency: inst.currency,
      region: inst.region,
      name: inst.name,
      exchange: inst.exchange,
      usdInrRate,
    });
    if (!validation.valid) {
      setFeedback({ ok: false, msg: validation.error ?? 'Order rejected.' });
      return;
    }
    setSimState(nextState);
    setFeedback({
      ok: true,
      msg: `SIMULATED ${side} ${quantity} ${inst.symbol} filled at live price ${formatCurrencyValue(inst.price, inst.currency)} (no real money or brokerage execution).`,
    });
  };

  return (
    <SitePageShell currentPath="/paper-trading" onNavigate={onNavigate}>
      <PageHeaderBand
        variant="left"
        eyebrow="Simulated Trading Engine"
        title="Practice simulated trading against real live market quotes."
        description="Start from a clean $100,000 virtual buying-power account with zero fake pre-seeded positions. Orders price dynamically against fetched market quotes and live ECB USD/INR conversion."
        primaryCta={{
          label: 'Start Simulated Trading in /app',
          onClick: () => onLaunchApp('paper-trading', symbol),
        }}
        secondaryCta={{ label: 'Learn Portfolio Metrics', onClick: () => onNavigate('/docs') }}
      />

      <section className="bg-[#FFFFFF] py-12 sm:py-16">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 space-y-10">
          {/* Mandatory Clear Simulation Notice Banner */}
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs font-semibold text-amber-950">
              <AlertCircle className="h-4 w-4 text-amber-700 shrink-0" aria-hidden="true" />
              <span>SIMULATED TRADING — No real money or brokerage execution.</span>
            </div>
            <span className="font-mono text-[11px] text-amber-900">
              {usdInrRate ? `Live FX: 1 USD = ₹${usdInrRate.toFixed(2)}` : 'FX feed syncing'}
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-5 rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-bold text-[#080B12] flex items-center gap-2">
                  <Activity className="h-4 w-4 text-[#2D46E6]" aria-hidden="true" />
                  <span>Simulated Order Ticket</span>
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setSimState(CLEAN_PAPER_TRADING_STATE);
                    setFeedback(null);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#667085] hover:text-[#080B12] cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  <span>Reset Clean Account</span>
                </button>
              </div>

              <form onSubmit={handlePlaceOrder} className="space-y-4">
                <div className="grid grid-cols-2 gap-2 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] p-1">
                  {(['BUY', 'SELL'] as const).map((s) => {
                    const active = side === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSide(s)}
                        className={`relative h-9 rounded text-xs font-bold uppercase tracking-[0.04em] cursor-pointer ${
                          active ? 'text-[#FFFFFF]' : 'text-[#667085] hover:text-[#080B12]'
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="paper-preview-side-pill"
                            transition={FINTECH_SPRING_SNAPPY}
                            className="absolute inset-0 rounded bg-[#2D46E6]"
                          />
                        )}
                        <span className="relative z-10">Simulated {s}</span>
                      </button>
                    );
                  })}
                </div>

                <div>
                  <label
                    htmlFor="paper-preview-symbol"
                    className="block text-xs font-semibold text-[#080B12] mb-1.5"
                  >
                    Instrument ({inst?.dataStatus ?? 'SYNCING'})
                  </label>
                  <select
                    id="paper-preview-symbol"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    disabled={instruments.length === 0}
                    className="w-full h-10 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3 font-mono text-xs text-[#080B12]"
                  >
                    {instruments.length === 0 ? (
                      <option value={symbol}>{loading ? 'Loading quotes…' : symbol}</option>
                    ) : (
                      instruments.map((i) => (
                        <option key={i.symbol} value={i.symbol}>
                          {i.symbol} ({i.price !== null ? formatCurrencyValue(i.price, i.currency) : 'Unavailable'})
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="paper-preview-qty"
                    className="block text-xs font-semibold text-[#080B12] mb-1.5"
                  >
                    Quantity (Shares / Units)
                  </label>
                  <input
                    id="paper-preview-qty"
                    type="number"
                    min="0.01"
                    step="any"
                    value={qtyInput}
                    onChange={(e) => setQtyInput(e.target.value)}
                    className="w-full h-10 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3 font-mono text-sm text-[#080B12]"
                  />
                </div>

                <AnimatePresence mode="wait">
                  {feedback && (
                    <motion.div
                      key={feedback.msg}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.18, ease: FINTECH_EASE }}
                      className={`rounded-md border px-3 py-2 text-xs flex items-start gap-2 ${
                        feedback.ok
                          ? 'border-[#16A34A]/30 bg-[#F0FDF4] text-[#16A34A]'
                          : 'border-[#DC2626]/30 bg-[#FEF2F2] text-[#DC2626]'
                      }`}
                    >
                      {feedback.ok ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                      ) : (
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                      )}
                      <span>{feedback.msg}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  type="submit"
                  disabled={!inst || inst.price === null}
                  className="w-full h-10 rounded-md bg-[#2D46E6] text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] hover:bg-[#2238C9] disabled:opacity-50 cursor-pointer"
                >
                  Submit Simulated {side} Order
                </button>
              </form>
            </div>

            <div className="lg:col-span-7 rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-5 tabular-nums">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-3.5">
                  <div className="text-[11px] text-[#667085]">Simulated Cash</div>
                  <div className="mt-1 font-mono text-sm font-bold text-[#080B12]">
                    <AnimatedMetricValue
                      value={metrics.cashBalanceUsd}
                      format={(v) =>
                        `$${v.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`
                      }
                    />
                  </div>
                </div>
                <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-3.5">
                  <div className="text-[11px] text-[#667085]">Simulated Equity</div>
                  <div className="mt-1 font-mono text-sm font-bold text-[#080B12]">
                    {metrics.totalEquityUsd !== null ? (
                      <AnimatedMetricValue
                        value={metrics.totalEquityUsd}
                        format={(v) =>
                          `$${v.toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}`
                        }
                      />
                    ) : (
                      'Unavailable'
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-3.5">
                  <div className="text-[11px] text-[#667085]">Unrealized P&amp;L</div>
                  <div
                    className={`mt-1 font-mono text-sm font-bold ${
                      (metrics.unrealizedPnlUsd ?? 0) >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'
                    }`}
                  >
                    {metrics.unrealizedPnlUsd !== null ? (
                      <AnimatedMetricValue
                        value={metrics.unrealizedPnlUsd}
                        format={(v) => `$${v.toFixed(2)}`}
                      />
                    ) : (
                      'Unavailable'
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-3.5">
                  <div className="text-[11px] text-[#667085]">Concentration</div>
                  <div className="mt-1 font-mono text-sm font-bold text-[#2D46E6]">
                    {metrics.concentrationScore !== null
                      ? `${metrics.concentrationScore}/100 (${metrics.riskLabel})`
                      : 'Unavailable'}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-[#E4E8F2] overflow-hidden">
                <div className="bg-[#F7F8FA] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#667085]">
                  Simulated Holdings ({metrics.valuations.length})
                </div>
                <div className="divide-y divide-[#E4E8F2]">
                  {metrics.valuations.length === 0 ? (
                    <div className="px-4 py-6 text-center text-xs text-[#667085]">
                      Clean simulated account — submit a simulated BUY order on the left to open your first position.
                    </div>
                  ) : (
                    metrics.valuations.map((h) => (
                      <div
                        key={h.symbol}
                        className="flex items-center justify-between px-4 py-2.5 text-xs"
                      >
                        <div>
                          <span className="font-mono font-bold text-[#080B12]">{h.symbol}</span>
                          <span className="ml-2 text-[#667085]">
                            {h.quantity} units @ {formatCurrencyValue(h.avgCostNative, h.currency)}
                          </span>
                        </div>
                        <div className="font-mono text-right">
                          <span className="font-semibold text-[#080B12]">
                            {h.marketValueUsd !== null
                              ? `$${h.marketValueUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                              : 'Unavailable'}
                          </span>
                          <span
                            className={`ml-2 ${
                              (h.unrealizedPnlUsd ?? 0) >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'
                            }`}
                          >
                            {h.unrealizedPnlPct !== null ? formatSignedPercent(h.unrealizedPnlPct) : '—'}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          <DisclosureNotice
            label="Simulation Only"
            text="SIMULATED TRADING — Nextrade AI is not a registered broker and never executes real brokerage orders. Paper fills price against live/delayed market quotes with zero real-money risk."
          />

          <div className="text-center">
            <button
              type="button"
              onClick={() => onLaunchApp('paper-trading', symbol)}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-[#2D46E6] px-6 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer"
            >
              <span>Open Simulated Trading in /app</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>
    </SitePageShell>
  );
};
