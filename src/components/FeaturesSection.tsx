import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CapabilityBadgeArt } from './IsometricIllustrations';
import { FINTECH_EASE, FINTECH_SPRING_SNAPPY } from '../lib/motionPrimitives';

interface FeaturesSectionProps {
  onLaunchApp: (initialTab?: string, initialSymbol?: string) => void;
}

interface CapabilityItem {
  id: string;
  number: string;
  tabLabel: string;
  title: string;
  subtitle: string;
  description: string;
  kind: string;
  targetTab: string;
  mode: 'research' | 'simulate';
}

const CAPABILITIES: CapabilityItem[] = [
  {
    id: 'ai-research',
    number: '01',
    tabLabel: '01. AI Research',
    title: 'AI Market Research',
    subtitle: 'Gemini & Building Mode',
    description:
      'Submit structured queries grounded in fetched exchange quotes via Google Gemini when active, with upcoming specialized intelligence modules transparently staged in AI Building Mode.',
    kind: 'research',
    targetTab: 'research',
    mode: 'research',
  },
  {
    id: 'explainable-ai',
    number: '02',
    tabLabel: '02. Explainability',
    title: 'Explainable Intelligence',
    subtitle: 'Transparent Reasoning',
    description:
      'Every structured brief separates positive supporting drivers from downside risks and discloses data sources rather than displaying fabricated scores.',
    kind: 'explainability',
    targetTab: 'research',
    mode: 'research',
  },
  {
    id: 'risk-intel',
    number: '03',
    tabLabel: '03. Risk Analysis',
    title: 'Risk Intelligence',
    subtitle: 'Volatility & Drawdown',
    description:
      'Measure period return, annualized volatility, and maximum historical drawdown computed directly from fetched OHLC historical market series.',
    kind: 'risk',
    targetTab: 'analytics',
    mode: 'research',
  },
  {
    id: 'portfolio-intel',
    number: '04',
    tabLabel: '04. Portfolio',
    title: 'Portfolio Intelligence',
    subtitle: 'Dynamic INR & USD FX',
    description:
      'Track manual holdings and paper positions normalized dynamically via live USD/INR exchange rates with Herfindahl concentration scoring.',
    kind: 'portfolio',
    targetTab: 'portfolio',
    mode: 'simulate',
  },
  {
    id: 'paper-trading',
    number: '05',
    tabLabel: '05. Paper Trading',
    title: 'Simulated Trading',
    subtitle: 'Live Quote Simulation',
    description:
      'Practice simulated BUY and SELL orders against live fetched market quotes from a clean $100,000 virtual account with zero real-money brokerage risk.',
    kind: 'paper',
    targetTab: 'paper-trading',
    mode: 'simulate',
  },
  {
    id: 'multi-market',
    number: '06',
    tabLabel: '06. Multi-Market',
    title: 'Multi-Asset Markets',
    subtitle: 'Stocks, Crypto & FX',
    description:
      'Track Indian equities (NSE/BSE), US equities (NYSE/NASDAQ), global indices, ETFs, crypto assets, and forex pairs with explicit data freshness labels.',
    kind: 'multimarket',
    targetTab: 'markets',
    mode: 'simulate',
  },
];

export const FeaturesSection: React.FC<FeaturesSectionProps> = ({ onLaunchApp }) => {
  const [activeIdx, setActiveIdx] = useState<number>(1); // Default center focus like reference
  const [focusMode, setFocusMode] = useState<'research' | 'simulate'>('research');

  const handleModeSwitch = (mode: 'research' | 'simulate') => {
    setFocusMode(mode);
    const firstInMode = CAPABILITIES.findIndex((c) => c.mode === mode);
    if (firstInMode >= 0) setActiveIdx(firstInMode);
  };

  const prevIdx = (activeIdx - 1 + CAPABILITIES.length) % CAPABILITIES.length;
  const nextIdx = (activeIdx + 1) % CAPABILITIES.length;

  const prevCard = CAPABILITIES[prevIdx];
  const centerCard = CAPABILITIES[activeIdx];
  const nextCard = CAPABILITIES[nextIdx];

  return (
    <section id="features" className="border-t border-[#E4E8F2] bg-[#FFFFFF] py-20 sm:py-24">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
        {/* Centered Headline with Inline Segmented Toggle */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.04 }}
          transition={{ duration: 0.32, ease: FINTECH_EASE }}
          className="mx-auto max-w-3xl text-center"
        >
          <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-[-0.025em] text-[#080B12] leading-snug">
            Six core ways to{' '}
            <span className="inline-flex items-center rounded-md border border-[#E4E8F2] bg-[#F7F8FA] p-1 align-middle mx-1">
              {(['research', 'simulate'] as const).map((mode) => {
                const active = focusMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => handleModeSwitch(mode)}
                    className={`relative rounded px-3 py-1 text-xs font-bold uppercase tracking-[0.04em] transition-colors cursor-pointer ${
                      active ? 'text-[#FFFFFF]' : 'text-[#667085] hover:text-[#080B12]'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="feature-mode-pill"
                        transition={FINTECH_SPRING_SNAPPY}
                        className="absolute inset-0 rounded bg-[#2D46E6]"
                        aria-hidden="true"
                      />
                    )}
                    <span className="relative z-10">
                      {mode === 'research' ? 'Research' : 'Simulate'}
                    </span>
                  </button>
                );
              })}
            </span>{' '}
            markets
          </h2>
        </motion.div>

        {/* Reference-Style Selector Header Box + Overlapping 3-Card Stage */}
        <div className="mt-12 relative">
          {/* Upper Selector Bar Card */}
          <div className="mx-auto max-w-4xl rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] px-4 pt-6 pb-20 sm:px-8 shadow-[0_14px_40px_rgba(15,23,42,0.04)]">
            <p className="text-center text-sm font-medium text-[#080B12]">
              Select a capability module to inspect how Nextrade AI structures analysis
            </p>

            <div
              role="tablist"
              aria-label="Platform capabilities"
              className="mt-6 flex flex-wrap items-center justify-center gap-4 sm:gap-7 border-b border-[#E4E8F2]"
            >
              {CAPABILITIES.map((cap, idx) => {
                const isSelected = idx === activeIdx;
                return (
                  <button
                    key={cap.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => setActiveIdx(idx)}
                    className={`relative pb-3 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      isSelected
                        ? 'text-[#2D46E6]'
                        : 'text-[#667085] hover:text-[#080B12]'
                    }`}
                  >
                    {cap.tabLabel}
                    {isSelected && (
                      <motion.span
                        layoutId="feature-tab-underline"
                        transition={FINTECH_SPRING_SNAPPY}
                        className="absolute left-0 right-0 -bottom-[1px] h-[2px] bg-[#2D46E6]"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3-Card Overlapping Stage */}
          <div className="-mt-12 grid grid-cols-1 md:grid-cols-12 gap-5 items-center max-w-5xl mx-auto px-2 sm:px-4">
            {/* Left Secondary Card */}
            <motion.button
              key={`prev-${prevCard.id}`}
              type="button"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => setActiveIdx(prevIdx)}
              className="md:col-span-4 rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 text-center transition-colors hover:border-[#CBD5E1] cursor-pointer space-y-3"
            >
              <CapabilityBadgeArt kind={prevCard.kind} />
              <div className="font-display text-base font-bold text-[#080B12]">
                {prevCard.title}
              </div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#2D46E6]">
                {prevCard.number}. {prevCard.subtitle}
              </div>
            </motion.button>

            {/* Center Elevated Royal Cobalt Hero Card */}
            <div className="md:col-span-4 relative z-10 md:-my-4">
              <AnimatePresence mode="wait">
                <motion.div
                  key={centerCard.id}
                  initial={{ opacity: 0, y: 10, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.985 }}
                  transition={{ duration: 0.2, ease: FINTECH_EASE }}
                  className="rounded-xl bg-[#2D46E6] p-7 text-center text-[#FFFFFF] shadow-[0_24px_56px_rgba(45,70,230,0.32)] space-y-4"
                >
                  <CapabilityBadgeArt active kind={centerCard.kind} />
                  <div>
                    <h3 className="font-display text-xl font-bold text-[#FFFFFF]">
                      {centerCard.title}
                    </h3>
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-white/80">
                      {centerCard.number}. {centerCard.subtitle}
                    </div>
                  </div>
                  <p className="text-xs leading-relaxed text-white/90">
                    {centerCard.description}
                  </p>
                  <div className="pt-2">
                    <motion.button
                      type="button"
                      whileHover={{ y: -1 }}
                      whileTap={{ scale: 0.98 }}
                      transition={FINTECH_SPRING_SNAPPY}
                      onClick={() => onLaunchApp(centerCard.targetTab)}
                      className="w-full rounded-md bg-[#FFFFFF] py-2.5 text-xs font-semibold uppercase tracking-[0.04em] text-[#2D46E6] hover:bg-[#F7F8FA] transition-colors cursor-pointer"
                    >
                      Open {centerCard.title}
                    </motion.button>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Right Secondary Card */}
            <motion.button
              key={`next-${nextCard.id}`}
              type="button"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => setActiveIdx(nextIdx)}
              className="md:col-span-4 rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 text-center transition-colors hover:border-[#CBD5E1] cursor-pointer space-y-3"
            >
              <CapabilityBadgeArt kind={nextCard.kind} />
              <div className="font-display text-base font-bold text-[#080B12]">
                {nextCard.title}
              </div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#2D46E6]">
                {nextCard.number}. {nextCard.subtitle}
              </div>
            </motion.button>
          </div>
        </div>
      </div>
    </section>
  );
};
