import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Globe,
  Sparkles,
  ShieldAlert,
  Briefcase,
  Activity,
  BarChart2,
  CheckCircle2,
  Monitor,
  Layers,
} from 'lucide-react';
import { motion } from 'motion/react';
import { SitePageShell, PageHeaderBand, DisclosureNotice } from '../PagePrimitives';
import { WorkspacePreviewFrame } from '../WorkspacePreviewFrame';
import { AnimatedMetricValue, FINTECH_SPRING_SNAPPY } from '../../lib/motionPrimitives';
import { formatCurrencyValue, formatSignedPercent } from '../../lib/marketData';
import { fetchMarketHistory, useMarketOverview } from '../../lib/marketClient';
import {
  CLEAN_PAPER_TRADING_STATE,
  calculateSeriesRiskMetrics,
} from '../../lib/portfolioEngine';

interface PageActionProps {
  onNavigate: (path: string) => void;
  onLaunchApp: (tab?: string, symbol?: string, region?: 'IN' | 'US' | 'ALL') => void;
}

export const ProductPage: React.FC<PageActionProps> = ({ onNavigate, onLaunchApp }) => {
  const { data: overview, loading } = useMarketOverview({ refreshMs: 60_000 });

  return (
    <SitePageShell currentPath="/product" onNavigate={onNavigate}>
      <PageHeaderBand
        variant="split"
        eyebrow="Product Overview"
        title="One free, open-source platform for global market intelligence."
        description="Built by Meril & NEXORA Labs, Nextrade AI unifies live Indian, US, Index, ETF, Crypto, and Forex feeds with real-FX portfolio tracking, simulated paper trading, and evolving AI intelligence."
        primaryCta={{ label: 'Launch Nextrade AI', onClick: () => onLaunchApp('home') }}
        secondaryCta={{ label: 'Explore Capabilities', onClick: () => onNavigate('/features') }}
        aside={
          <div className="rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-[#E4E8F2] pb-3">
              <span className="font-mono text-xs font-semibold text-[#080B12]">
                PLATFORM TELEMETRY
              </span>
              <span className="font-mono text-[11px] font-semibold text-[#2D46E6]">
                Apache-2.0 · Free
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 tabular-nums">
              <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5">
                <div className="text-[11px] text-[#667085]">Market Feed Status</div>
                <div className="mt-1 font-mono text-lg font-bold text-[#080B12]">
                  {overview?.dataStatus ?? (loading ? 'SYNCING' : 'READY')}
                </div>
              </div>
              <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5">
                <div className="text-[11px] text-[#667085]">Tracked Assets</div>
                <div className="mt-1 font-mono text-lg font-bold text-[#080B12]">
                  {overview?.instruments.length ?? '—'} Symbols
                </div>
              </div>
              <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5">
                <div className="text-[11px] text-[#667085]">Simulated Start Cash</div>
                <div className="mt-1 font-mono text-lg font-bold text-[#080B12]">
                  ${CLEAN_PAPER_TRADING_STATE.cashBalanceUsd.toLocaleString('en-US')}
                </div>
              </div>
              <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5">
                <div className="text-[11px] text-[#667085]">USD / INR FX</div>
                <div className="mt-1 font-mono text-lg font-bold text-[#2D46E6]">
                  {overview?.usdInrRate ? `₹${overview.usdInrRate.toFixed(2)}` : 'Syncing'}
                </div>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-[#667085]">
              Zero subscriptions, zero paywalls, and full user-isolated relational persistence in <code className="font-mono text-[#080B12]">/app</code>.
            </p>
          </div>
        }
      />

      {/* What Nextrade AI Does */}
      <section className="bg-[#FFFFFF] py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-5 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-[#2D46E6]">
                What Nextrade AI Does
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-[-0.02em] text-[#080B12]">
                Designed for financial clarity, never fabricated hype.
              </h2>
            </div>
            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 space-y-2.5">
                <Monitor className="h-5 w-5 text-[#2D46E6]" aria-hidden="true" />
                <h3 className="font-display text-base font-bold text-[#080B12]">
                  Browser-Native Runtime
                </h3>
                <p className="text-sm leading-relaxed text-[#667085]">
                  Runs immediately in any modern desktop or mobile browser backed by Express, PostgreSQL/SQLite persistence, and real upstream exchange adapters.
                </p>
              </div>
              <div className="rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 space-y-2.5">
                <Layers className="h-5 w-5 text-[#2D46E6]" aria-hidden="true" />
                <h3 className="font-display text-base font-bold text-[#080B12]">
                  Unified Cross-Asset Coverage
                </h3>
                <p className="text-sm leading-relaxed text-[#667085]">
                  Monitor Indian (NSE/BSE) stocks in INR alongside US equities (NYSE/NASDAQ), ETFs, crypto assets, and live USD/INR FX rates.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#EFF2FA] text-[#2D46E6]">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </div>
              <h3 className="font-display text-lg font-bold text-[#080B12]">
                AI Intelligence (Building Mode)
              </h3>
              <p className="text-sm leading-relaxed text-[#667085]">
                Structured <code className="font-mono text-xs text-[#080B12]">POST /api/research</code> executes Google Gemini when configured, while advanced AI Market &amp; Portfolio modules advance transparently in Building Mode.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('/research')}
                className="text-xs font-semibold text-[#2D46E6] hover:underline cursor-pointer"
              >
                Inspect AI Research →
              </button>
            </div>

            <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#EFF2FA] text-[#2D46E6]">
                <Globe className="h-4 w-4" aria-hidden="true" />
              </div>
              <h3 className="font-display text-lg font-bold text-[#080B12]">
                Real Market Adapters
              </h3>
              <p className="text-sm leading-relaxed text-[#667085]">
                Fetches NIFTY 50, SENSEX, S&amp;P 500, NASDAQ, stocks, ETFs, crypto, and FX with L2 database caching and explicit LIVE/DELAYED/CACHED indicators.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('/markets')}
                className="text-xs font-semibold text-[#2D46E6] hover:underline cursor-pointer"
              >
                Explore Supported Markets →
              </button>
            </div>

            <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#EFF2FA] text-[#2D46E6]">
                <Briefcase className="h-4 w-4" aria-hidden="true" />
              </div>
              <h3 className="font-display text-lg font-bold text-[#080B12]">
                Portfolio Intelligence
              </h3>
              <p className="text-sm leading-relaxed text-[#667085]">
                Track user-owned holdings with dynamic USD/INR conversion, unrealized P&amp;L, geographic exposure weights, and Herfindahl concentration scoring.
              </p>
              <button
                type="button"
                onClick={() => onLaunchApp('portfolio')}
                className="text-xs font-semibold text-[#2D46E6] hover:underline cursor-pointer"
              >
                Open Portfolio View →
              </button>
            </div>

            <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#EFF2FA] text-[#2D46E6]">
                <Activity className="h-4 w-4" aria-hidden="true" />
              </div>
              <h3 className="font-display text-lg font-bold text-[#080B12]">
                Simulated Paper Trading
              </h3>
              <p className="text-sm leading-relaxed text-[#667085]">
                Practice simulated BUY and SELL orders against live fetched market prices starting from clean $100,000 virtual buying power—zero real money involved.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('/paper-trading')}
                className="text-xs font-semibold text-[#2D46E6] hover:underline cursor-pointer"
              >
                Explore Simulated Trading →
              </button>
            </div>

            <div className="md:col-span-2 rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 flex flex-col justify-between space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2 max-w-xl">
                  <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.05em] text-[#2D46E6]">
                    <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                    <span>Quantitative Risk Transparency</span>
                  </div>
                  <h3 className="font-display text-lg font-bold text-[#080B12]">
                    Every chart pairs price history with realized dispersion &amp; drawdown.
                  </h3>
                  <p className="text-sm leading-relaxed text-[#667085]">
                    Instead of fabricated target scores, Nextrade AI computes period return, annualized volatility, and maximum drawdown strictly from fetched historical series.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onLaunchApp('analytics', 'NVDA')}
                  className="rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-4 py-2 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] transition-colors cursor-pointer shrink-0"
                >
                  Open Risk Analytics
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Live Product Interface Preview */}
      <section className="border-t border-[#E4E8F2] bg-[#F7F8FA] py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-[#2D46E6]">
                Live Interactive Preview
              </p>
              <h2 className="mt-1 font-display text-2xl sm:text-3xl font-bold tracking-[-0.02em] text-[#080B12]">
                Inspect real market feeds in the browser frame.
              </h2>
            </div>
            <DisclosureNotice
              label="Real Data Status"
              text="All quotes and OHLC charts below load directly from the Nextrade AI market service."
            />
          </div>

          <WorkspacePreviewFrame onLaunchApp={onLaunchApp} defaultTab="home" />
        </div>
      </section>

      {/* Launch CTA */}
      <section className="border-t border-[#E4E8F2] bg-[#FFFFFF] py-16">
        <div className="mx-auto max-w-[900px] px-4 sm:px-6 text-center space-y-5">
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-[-0.02em] text-[#080B12]">
            Ready to launch Nextrade AI?
          </h2>
          <p className="text-sm sm:text-base text-[#667085] max-w-xl mx-auto">
            Access market feeds, portfolio tracking, risk analytics, and simulated trading free and open source—built by Meril &amp; NEXORA Labs.
          </p>
          <div className="pt-1">
            <button
              type="button"
              onClick={() => onLaunchApp('home')}
              className="inline-flex h-12 items-center gap-2 rounded-md bg-[#2D46E6] px-7 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] shadow-[0_8px_22px_rgba(45,70,230,0.24)] hover:bg-[#2238C9] transition-colors cursor-pointer"
            >
              <span>Launch Nextrade AI</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>
    </SitePageShell>
  );
};

export const FeaturesPage: React.FC<PageActionProps> = ({ onNavigate, onLaunchApp }) => {
  const { data: overview } = useMarketOverview({ refreshMs: 60_000 });
  const indices = useMemo(() => overview?.indices ?? [], [overview]);
  const instruments = useMemo(() => overview?.instruments ?? [], [overview]);

  const [selectedRiskSymbol, setSelectedRiskSymbol] = useState<'NVDA' | 'TCS.NS' | 'RELIANCE.NS'>(
    'NVDA',
  );
  const [riskSeriesPrices, setRiskSeriesPrices] = useState<number[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetchMarketHistory(selectedRiskSymbol, '1M', controller.signal)
      .then((res) => setRiskSeriesPrices(res.points.map((p) => p.price)))
      .catch(() => setRiskSeriesPrices([]));
    return () => controller.abort();
  }, [selectedRiskSymbol]);

  const riskCalc = calculateSeriesRiskMetrics(riskSeriesPrices);

  return (
    <SitePageShell currentPath="/features" onNavigate={onNavigate}>
      <PageHeaderBand
        variant="centered"
        eyebrow="Platform Capabilities"
        title="Transparent financial modules built on real data."
        description="Every capability in Nextrade AI separates real fetched market data from simulated trading and clearly communicates AI Building Mode status."
        primaryCta={{ label: 'Open Workspace', onClick: () => onLaunchApp('home') }}
        secondaryCta={{ label: 'View Architecture Docs', onClick: () => onNavigate('/docs') }}
      />

      <div className="divide-y divide-[#E4E8F2]">
        {/* 01. AI Market Research */}
        <section className="bg-[#FFFFFF] py-16 sm:py-20">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-5 space-y-4">
              <span className="font-mono text-xs font-bold uppercase tracking-[0.08em] text-[#2D46E6]">
                01 · AI Market Research
              </span>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#080B12]">
                Gemini-powered synthesis &amp; honest Building Mode.
              </h2>
              <p className="text-sm sm:text-base leading-relaxed text-[#667085]">
                Submit questions about global instruments to POST /api/research. When GEMINI_API_KEY is configured, Nextrade AI grounds prompts in live market quotes; otherwise it reports AI Building Mode cleanly without fake briefs.
              </p>
              <ul className="space-y-2 text-sm text-[#080B12]">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#2D46E6]" aria-hidden="true" />
                  <span>Server-side @google/genai structured output</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#2D46E6]" aria-hidden="true" />
                  <span>Zero fabricated fallback briefs when unconfigured</span>
                </li>
              </ul>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => onNavigate('/research')}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-[#2D46E6] px-5 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer"
                >
                  <span>Inspect AI Research &amp; Building Mode</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="lg:col-span-7">
              <div className="rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 space-y-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-semibold text-[#080B12]">
                    AI INTELLIGENCE PIPELINE
                  </span>
                  <span className="font-mono text-[11px] font-semibold text-[#2D46E6]">
                    BUILDING MODE ACTIVE
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-1">
                    <div className="font-semibold text-[#080B12]">Live Gemini Briefs</div>
                    <p className="text-[#667085]">Active when GEMINI_API_KEY is configured.</p>
                  </div>
                  <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-1">
                    <div className="font-semibold text-[#080B12]">Predictive &amp; Portfolio AI</div>
                    <p className="text-[#667085]">Coming soon in upcoming platform releases.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 02. Risk Intelligence */}
        <section className="bg-[#F7F8FA] py-16 sm:py-20">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-5 space-y-4">
              <span className="font-mono text-xs font-bold uppercase tracking-[0.08em] text-[#2D46E6]">
                02 · Risk Intelligence
              </span>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#080B12]">
                Realized volatility &amp; drawdown from historical series.
              </h2>
              <p className="text-sm sm:text-base leading-relaxed text-[#667085]">
                Inspect period return, annualized volatility, and maximum drawdown computed directly from fetched 1M OHLC historical prices.
              </p>
              <div className="flex flex-wrap gap-2">
                {(['NVDA', 'RELIANCE.NS', 'TCS.NS'] as const).map((sym) => {
                  const active = selectedRiskSymbol === sym;
                  return (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => setSelectedRiskSymbol(sym)}
                      className={`relative rounded-md px-3 py-1.5 font-mono text-xs font-semibold transition-colors cursor-pointer ${
                        active
                          ? 'text-[#FFFFFF]'
                          : 'border border-[#E4E8F2] bg-[#FFFFFF] text-[#667085] hover:text-[#080B12]'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="features-risk-symbol-pill"
                          transition={FINTECH_SPRING_SNAPPY}
                          className="absolute inset-0 rounded-md bg-[#2D46E6]"
                        />
                      )}
                      <span className="relative z-10">{sym}</span>
                    </button>
                  );
                })}
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => onLaunchApp('analytics', selectedRiskSymbol)}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-[#2D46E6] px-5 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer"
                >
                  <span>Open Analytics</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-4 tabular-nums">
              <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-4">
                <div className="text-xs text-[#667085]">1M Return</div>
                <div className="mt-2 font-mono text-lg font-bold text-[#080B12]">
                  {riskCalc.hasData && riskCalc.periodReturnPct !== null ? (
                    <AnimatedMetricValue
                      value={riskCalc.periodReturnPct}
                      format={(v) => formatSignedPercent(Number(v.toFixed(2)))}
                    />
                  ) : (
                    'Unavailable'
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-4">
                <div className="text-xs text-[#667085]">Ann. Volatility</div>
                <div className="mt-2 font-mono text-lg font-bold text-[#080B12]">
                  {riskCalc.hasData && riskCalc.annualizedVolatilityPct !== null
                    ? `${riskCalc.annualizedVolatilityPct.toFixed(1)}%`
                    : '—'}
                </div>
              </div>
              <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-4">
                <div className="text-xs text-[#667085]">Max Drawdown</div>
                <div className="mt-2 font-mono text-lg font-bold text-[#DC2626]">
                  {riskCalc.hasData && riskCalc.maxDrawdownPct !== null
                    ? `-${riskCalc.maxDrawdownPct.toFixed(1)}%`
                    : '—'}
                </div>
              </div>
              <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-4">
                <div className="text-xs text-[#667085]">Series Points</div>
                <div className="mt-2 font-mono text-lg font-bold text-[#2D46E6]">
                  {riskSeriesPrices.length} bars
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 03 & 04: Portfolio & Simulated Paper Trading */}
        <section className="bg-[#FFFFFF] py-16 sm:py-20">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-7 space-y-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold uppercase tracking-[0.08em] text-[#2D46E6]">
                  03 · Portfolio Intelligence
                </span>
                <BarChart2 className="h-4 w-4 text-[#2D46E6]" aria-hidden="true" />
              </div>
              <h3 className="font-display text-2xl font-bold text-[#080B12]">
                User-owned holdings with dynamic USD/INR FX.
              </h3>
              <p className="text-sm leading-relaxed text-[#667085]">
                Manually enter positions with exact cost basis or track paper trades. Cross-currency valuation updates dynamically using live Frankfurter ECB / Yahoo USD-INR rates.
              </p>
              <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 flex items-center justify-between text-xs tabular-nums">
                <span className="text-[#667085]">Live FX Rate</span>
                <span className="font-mono font-bold text-[#080B12]">
                  {overview?.usdInrRate ? `1 USD = ₹${overview.usdInrRate.toFixed(2)}` : 'Syncing…'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onLaunchApp('portfolio')}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-4 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] cursor-pointer"
              >
                <span>Open Portfolio Module</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            <div className="rounded-xl bg-[#2D46E6] p-7 text-[#FFFFFF] space-y-5 shadow-[0_18px_48px_rgba(45,70,230,0.22)]">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold uppercase tracking-[0.08em] text-white/80">
                  04 · Simulated Paper Trading
                </span>
                <Activity className="h-4 w-4 text-white" aria-hidden="true" />
              </div>
              <h3 className="font-display text-2xl font-bold text-[#FFFFFF]">
                Clean simulated BUY &amp; SELL execution on live prices.
              </h3>
              <p className="text-sm leading-relaxed text-white/85">
                Start with $100,000 virtual buying power and zero fabricated holdings. Orders execute against live quotes with zero real brokerage connection.
              </p>
              <div className="rounded-lg border border-white/20 bg-white/10 p-4 flex items-center justify-between text-xs tabular-nums">
                <span>Clean Starting Buying Power</span>
                <span className="font-mono font-bold">
                  ${CLEAN_PAPER_TRADING_STATE.cashBalanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('/paper-trading')}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-[#FFFFFF] px-5 text-xs font-semibold uppercase tracking-[0.04em] text-[#2D46E6] hover:bg-[#F7F8FA] cursor-pointer"
              >
                <span>Try Simulated Trading</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>

        {/* 05. Multi-Asset Market Coverage */}
        <section className="bg-[#F7F8FA] py-16 sm:py-20">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div className="space-y-2 max-w-2xl">
                <span className="font-mono text-xs font-bold uppercase tracking-[0.08em] text-[#2D46E6]">
                  05 · Multi-Asset Market Coverage
                </span>
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#080B12]">
                  Indian, US &amp; Global benchmarks in real time.
                </h2>
                <p className="text-sm text-[#667085]">
                  Live and delayed quotes spanning Stocks, Indices, ETFs, Crypto, and Forex with explicit data classification.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('/markets')}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-[#2D46E6] px-5 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer shrink-0 self-start sm:self-auto"
              >
                <span>View Supported Markets</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 tabular-nums">
              {indices.length === 0 ? (
                <div className="col-span-3 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-6 text-xs text-[#667085]">
                  Loading live exchange benchmarks…
                </div>
              ) : (
                indices.map((idx) => (
                  <div
                    key={idx.id}
                    className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 flex items-center justify-between"
                  >
                    <div>
                      <div className="text-[11px] font-mono font-semibold text-[#667085]">
                        {idx.exchange} · {idx.dataStatus}
                      </div>
                      <div className="font-display text-sm font-bold text-[#080B12]">{idx.name}</div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="text-sm font-semibold text-[#080B12]">
                        {idx.value !== null
                          ? idx.value.toLocaleString('en-US', { minimumFractionDigits: 2 })
                          : 'Unavailable'}
                      </div>
                      <div
                        className={`text-xs font-medium ${
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
                ))
              )}
            </div>

            {instruments.length > 0 && (
              <div className="text-xs font-mono text-[#667085]">
                Loaded sample quotes: {instruments.slice(0, 4).map((i) => `${i.symbol} (${i.price !== null ? formatCurrencyValue(i.price, i.currency) : 'N/A'})`).join(' · ')}
              </div>
            )}
          </div>
        </section>
      </div>
    </SitePageShell>
  );
};
