import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, ArrowUpRight, ArrowLeftRight } from 'lucide-react';
import { formatCurrencyValue, formatSignedPercent } from '../lib/marketData';
import { useMarketOverview } from '../lib/marketClient';
import {
  AnimatedMetricValue,
  FINTECH_EASE,
  FINTECH_SPRING_SNAPPY,
} from '../lib/motionPrimitives';
import { HeroIsometricEngine } from './IsometricIllustrations';
import { AmbientThreeBackground } from './AmbientThreeBackground';

interface HeroSectionProps {
  onLaunchApp: (initialTab?: string, initialSymbol?: string) => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ onLaunchApp }) => {
  const { data: overview, loading } = useMarketOverview({ refreshMs: 60_000 });
  const instruments = useMemo(() => overview?.instruments ?? [], [overview]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('NVDA');
  const [allocationInput, setAllocationInput] = useState<string>('10000');
  const [swapRotation, setSwapRotation] = useState<number>(0);

  useEffect(() => {
    if (instruments.length === 0) return;
    if (!instruments.some((i) => i.symbol === selectedSymbol)) {
      setSelectedSymbol(instruments[0].symbol);
    }
  }, [instruments, selectedSymbol]);

  const instrument =
    instruments.find((i) => i.symbol === selectedSymbol) ?? instruments[0] ?? null;
  const numericAllocation = Math.max(0, Number(allocationInput) || 0);
  const hasValidPrice =
    instrument !== null &&
    instrument.price !== null &&
    Number.isFinite(instrument.price) &&
    instrument.price > 0;
  const estimatedUnits = hasValidPrice && instrument ? numericAllocation / (instrument.price as number) : 0;

  const formatUnits = useCallback(
    (v: number) => (hasValidPrice ? `${v.toFixed(instrument?.category === 'CRYPTO' ? 4 : 2)} units` : 'Unavailable'),
    [hasValidPrice, instrument?.category],
  );

  const handleRegionSwap = () => {
    setSwapRotation((r) => r + 180);
    if (!instrument) return;
    if (instrument.region === 'US') {
      const inMatch = instruments.find((i) => i.region === 'IN') ?? instruments[0];
      if (inMatch) {
        setSelectedSymbol(inMatch.symbol);
        setAllocationInput('100000');
      }
    } else {
      const usMatch = instruments.find((i) => i.region === 'US') ?? instruments[0];
      if (usMatch) {
        setSelectedSymbol(usMatch.symbol);
        setAllocationInput('10000');
      }
    }
  };

  return (
    <section
      id="product"
      className="relative bg-[#FFFFFF] pt-10 pb-14 sm:pt-14 sm:pb-20 lg:pt-16 lg:pb-24 overflow-hidden"
    >
      <AmbientThreeBackground />
      <div className="relative z-10 mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-center">
          {/* Left Column: Editorial Headline + Live Allocation Calculator + Primary CTA */}
          <div className="lg:col-span-6 space-y-6">
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.34, ease: FINTECH_EASE }}
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] font-medium text-[#667085]"
            >
              <span>Free &amp; Open Source</span>
              <span aria-hidden="true" className="text-[#CBD5E1]">·</span>
              <span>Built by Meril &amp; NEXORA Labs</span>
              <span aria-hidden="true" className="text-[#CBD5E1]">·</span>
              <span>Global Markets</span>
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.42, delay: 0.05, ease: FINTECH_EASE }}
              className="font-display text-[clamp(2.45rem,4.3vw,3.85rem)] font-bold leading-[1.06] tracking-[-0.03em] text-[#080B12] text-balance"
            >
              Understand Markets.
              <br />
              With AI Intelligence.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1, ease: FINTECH_EASE }}
              className="max-w-xl text-[16px] leading-[1.6] text-[#667085]"
            >
              Explore real Indian, US, Crypto, ETF, and Forex market feeds, practice simulated paper trading, and track transparent AI financial intelligence directly in your browser.
            </motion.p>

            {/* Live Market Quote & Allocation Estimator */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.44, delay: 0.15, ease: FINTECH_EASE }}
              className="relative rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-2 shadow-[0_18px_48px_rgba(15,23,42,0.07)]"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[#E4E8F2]">
                {/* Left Input Panel */}
                <div className="p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-[11.5px] text-[#667085]">
                    <label htmlFor="hero-allocation">Simulated Allocation:</label>
                    <span className="font-mono text-[#080B12]">
                      {instrument?.currency ?? 'USD'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <input
                      id="hero-allocation"
                      type="number"
                      min="100"
                      step="100"
                      value={allocationInput}
                      onChange={(e) => setAllocationInput(e.target.value)}
                      className="w-full font-mono text-lg font-semibold text-[#080B12] bg-transparent focus:outline-none tabular-nums"
                    />
                    <select
                      aria-label="Select financial instrument"
                      value={selectedSymbol}
                      onChange={(e) => setSelectedSymbol(e.target.value)}
                      disabled={instruments.length === 0}
                      className="rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 py-1.5 font-mono text-xs font-semibold text-[#080B12] cursor-pointer max-w-[130px]"
                    >
                      {instruments.length === 0 ? (
                        <option value={selectedSymbol}>{loading ? 'Loading…' : selectedSymbol}</option>
                      ) : (
                        instruments.map((inst) => (
                          <option key={inst.symbol} value={inst.symbol}>
                            {inst.symbol}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                  <div className="text-[11px] text-[#667085] tabular-nums truncate">
                    {loading && !instrument
                      ? 'Fetching live market quote…'
                      : instrument && instrument.price !== null
                        ? `1 ${instrument.symbol} = ${formatCurrencyValue(instrument.price, instrument.currency)} · ${instrument.dataStatus}`
                        : 'Quote currently unavailable'}
                  </div>
                </div>

                {/* Right Output Panel */}
                <div className="p-4 sm:pl-6 space-y-2.5 bg-[#F7F8FA]/50 rounded-b-lg sm:rounded-b-none sm:rounded-r-lg overflow-hidden">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={instrument?.symbol ?? 'loading'}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.18, ease: FINTECH_EASE }}
                      className="space-y-2.5"
                    >
                      <div className="flex items-center justify-between text-[11.5px] text-[#667085]">
                        <span>Simulated Units:</span>
                        <span
                          className={`font-mono font-medium ${
                            instrument?.changePercent === null || instrument?.changePercent === undefined
                              ? 'text-[#667085]'
                              : instrument.changePercent >= 0
                                ? 'text-[#16A34A]'
                                : 'text-[#DC2626]'
                          }`}
                        >
                          {instrument?.changePercent !== null && instrument?.changePercent !== undefined
                            ? formatSignedPercent(instrument.changePercent)
                            : '—'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 tabular-nums">
                        {loading && !instrument ? (
                          <span className="font-mono text-[15px] font-semibold text-[#667085]">
                            Connecting…
                          </span>
                        ) : (
                          <AnimatedMetricValue
                            value={estimatedUnits}
                            format={formatUnits}
                            className="font-mono text-[17px] font-semibold text-[#080B12] whitespace-nowrap shrink-0"
                          />
                        )}
                        <span className="font-mono text-[10.5px] text-[#2D46E6] font-semibold whitespace-nowrap">
                          {overview?.usdInrRate
                            ? `USD/INR ₹${overview.usdInrRate.toFixed(2)}`
                            : instrument?.category ?? 'MARKET'}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#667085] truncate">
                        {instrument
                          ? `${instrument.exchange} · ${instrument.provider}`
                          : 'Yahoo Finance · CoinGecko · ECB FX'}
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>

              {/* Center Swap Region Floating Button */}
              <motion.button
                type="button"
                onClick={handleRegionSwap}
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.94 }}
                animate={{ rotate: swapRotation }}
                transition={FINTECH_SPRING_SNAPPY}
                title="Switch between US and Indian markets"
                aria-label="Swap between US and Indian market instruments"
                className="hidden sm:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-9 w-9 items-center justify-center rounded-full border-2 border-[#FFFFFF] bg-[#2D46E6] text-[#FFFFFF] shadow-[0_6px_16px_rgba(45,70,230,0.28)] hover:bg-[#2238C9] transition-colors cursor-pointer"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
              </motion.button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-wrap items-center gap-4 pt-1"
            >
              <motion.button
                type="button"
                whileHover={{ y: -1.5 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onLaunchApp('home', selectedSymbol)}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-[#2D46E6] px-7 text-xs font-semibold tracking-[0.04em] uppercase text-[#FFFFFF] shadow-[0_10px_24px_rgba(45,70,230,0.28)] transition-colors duration-150 hover:bg-[#2238C9] whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2D46E6]"
              >
                <span>Launch Nextrade AI</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </motion.button>

              <motion.a
                href="https://github.com/MERIL2026/nextrade-ai"
                target="_blank"
                rel="noopener noreferrer"
                whileHover={{ y: -1.5 }}
                whileTap={{ scale: 0.98 }}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-6 text-xs font-semibold tracking-[0.03em] uppercase text-[#080B12] transition-colors duration-150 hover:border-[#2D46E6] hover:text-[#2D46E6] whitespace-nowrap"
              >
                <span>Explore on GitHub</span>
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </motion.a>
            </motion.div>
          </div>

          {/* Right Column: Crisp 2D/3D Isometric Financial Engine Illustration */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.55, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-6"
          >
            <HeroIsometricEngine />
          </motion.div>
        </div>
      </div>
    </section>
  );
};
