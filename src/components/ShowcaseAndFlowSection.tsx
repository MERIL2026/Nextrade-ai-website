import React from 'react';
import { motion } from 'motion/react';
import { ArrowRight, ArrowUpRight, BookOpen, GitBranch } from 'lucide-react';
import { WorkspacePreviewFrame } from './WorkspacePreviewFrame';
import {
  FINTECH_EASE,
  FINTECH_SPRING_SNAPPY,
  StaggerGroup,
  StaggerItem,
} from '../lib/motionPrimitives';

interface ShowcaseAndFlowProps {
  onLaunchApp: (initialTab?: string, initialSymbol?: string) => void;
  onNavigate: (path: string) => void;
}

const HOW_IT_WORKS_STEPS = [
  {
    step: '01 — EXPLORE',
    title: 'Inspect real multi-asset market data across regions.',
    description:
      'Filter Indian (NSE, BSE) and US (NYSE, NASDAQ) equities alongside global indices, ETFs, crypto assets, and USD/INR forex rates with live status indicators.',
  },
  {
    step: '02 — ANALYZE',
    title: 'Compute historical risk & track AI Building Mode.',
    description:
      'Inspect realized OHLC volatility and drawdown charts, track manual or simulated portfolios with live FX conversion, and run Gemini research when configured.',
  },
  {
    step: '03 — SIMULATE',
    title: 'Practice simulated orders without real-money risk.',
    description:
      'Test strategies from a clean $100,000 virtual account priced strictly against real fetched exchange quotes and dynamic FX—zero fabricated ledger balances.',
  },
];

const TECH_STACK = [
  { name: 'React 19', role: 'UI Runtime' },
  { name: 'TypeScript', role: 'Financial Models' },
  { name: 'Vite', role: 'Browser Bundler' },
  { name: 'Tailwind CSS v4', role: 'Design Tokens' },
  { name: 'Express', role: 'API Layer' },
  { name: 'Motion', role: 'UI Motion' },
  { name: 'Google GenAI SDK', role: 'Explainable AI' },
];

export const ShowcaseAndFlowSection: React.FC<ShowcaseAndFlowProps> = ({
  onLaunchApp,
  onNavigate,
}) => {
  return (
    <>
      {/* E. Browser Application Showcase */}
      <section id="browser-showcase" className="border-t border-[#E4E8F2] bg-[#F7F8FA] py-20 sm:py-24">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between mb-12">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-[#2D46E6]">
                Browser Application
              </p>
              <h2 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-[-0.025em] text-[#080B12] text-balance">
                Your Market Intelligence Workspace.
              </h2>
              <p className="mt-3 text-base leading-relaxed text-[#667085]">
                Everything you need to explore, analyze, and understand financial markets — directly in your browser.
              </p>
            </div>

            <button
              type="button"
              onClick={() => onLaunchApp('home')}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#2D46E6] px-6 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] shadow-[0_8px_20px_rgba(45,70,230,0.22)] hover:bg-[#2238C9] transition-colors whitespace-nowrap shrink-0 self-start md:self-auto cursor-pointer"
            >
              <span>Launch Workspace</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <WorkspacePreviewFrame onLaunchApp={onLaunchApp} defaultTab="home" />
        </div>
      </section>

      {/* F. How It Works */}
      <section className="border-t border-[#E4E8F2] bg-[#FFFFFF] py-20 sm:py-24">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
          <div className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-[#2D46E6]">
              Workflow
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-[-0.02em] text-[#080B12]">
              A disciplined three-step research loop.
            </h2>
          </div>

          <StaggerGroup className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
            {HOW_IT_WORKS_STEPS.map((item) => (
              <StaggerItem key={item.step}>
                <motion.div
                  whileHover={{ y: -3 }}
                  transition={FINTECH_SPRING_SNAPPY}
                  className="h-full rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 space-y-3 transition-shadow hover:shadow-[0_12px_32px_rgba(15,23,42,0.05)]"
                >
                  <div className="font-mono text-xs font-bold tracking-[0.06em] text-[#2D46E6]">
                    {item.step}
                  </div>
                  <h3 className="font-display text-lg font-bold text-[#080B12] leading-snug">
                    {item.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-[#667085]">
                    {item.description}
                  </p>
                </motion.div>
              </StaggerItem>
            ))}
          </StaggerGroup>
        </div>
      </section>

      {/* G. Compact Technology Section */}
      <section className="border-t border-[#E4E8F2] bg-[#FFFFFF] py-12 sm:py-14">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div>
              <h2 className="font-display text-sm font-bold uppercase tracking-[0.04em] text-[#080B12]">
                Open Engineering Stack
              </h2>
              <p className="mt-1 text-xs text-[#667085]">
                Verified technologies used in this repository.
              </p>
            </div>

            <StaggerGroup className="flex flex-wrap items-center gap-4 sm:gap-7">
              {TECH_STACK.map((tech) => (
                <StaggerItem key={tech.name} className="text-left">
                  <div className="font-display text-sm font-bold text-[#080B12]">
                    {tech.name}
                  </div>
                  <div className="text-[11px] text-[#667085]">{tech.role}</div>
                </StaggerItem>
              ))}
            </StaggerGroup>
          </div>
        </div>
      </section>

      {/* H. Open Source Section */}
      <section
        id="open-source"
        className="border-t border-[#E4E8F2] bg-[#F7F8FA] py-20 sm:py-24"
      >
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-8 space-y-5">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-[#2D46E6]">
                Free &amp; Open Source · Built by Meril &amp; NEXORA Labs
              </p>
              <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-[-0.025em] text-[#080B12] text-balance">
                Financial intelligence should be accessible to everyone.
              </h2>
              <p className="max-w-2xl text-base leading-relaxed text-[#667085]">
                Nextrade AI is free, open source under Apache-2.0, and built by Meril &amp; NEXORA Labs. Inspect the repository, contribute adapters or modules, and explore transparent market tooling.
              </p>

              <div className="pt-2 flex flex-wrap items-center gap-3">
                <a
                  href="https://github.com/MERIL2026/nextrade-ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-[#2D46E6] px-5 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] hover:bg-[#2238C9] transition-colors whitespace-nowrap"
                >
                  <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Explore GitHub</span>
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </a>

                <button
                  type="button"
                  onClick={() => onNavigate('/docs')}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-5 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] transition-colors whitespace-nowrap cursor-pointer"
                >
                  <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Documentation</span>
                </button>

                <button
                  type="button"
                  onClick={() => onNavigate('/contribute')}
                  className="inline-flex h-10 items-center gap-1.5 px-3 text-xs font-semibold text-[#667085] hover:text-[#080B12] transition-colors whitespace-nowrap cursor-pointer"
                >
                  <span>Contribute →</span>
                </button>
              </div>
            </div>

            <div className="lg:col-span-4 flex justify-start lg:justify-end">
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{ duration: 0.38, ease: FINTECH_EASE }}
                whileHover={{ y: -3 }}
                className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 flex items-center justify-center max-w-[290px] w-full shadow-[0_12px_36px_rgba(15,23,42,0.04)]"
              >
                <img
                  src="/assets/aistudio/09-monochrome_0a9bc17a.svg"
                  alt="Nextrade AI official monochrome emblem and wordmark lockup for Apache-2.0 open-source release"
                  width={290}
                  height={96}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-auto object-contain"
                  referrerPolicy="no-referrer"
                />
              </motion.div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
};
