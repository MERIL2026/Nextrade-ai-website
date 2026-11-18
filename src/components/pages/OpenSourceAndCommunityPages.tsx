import React, { useState } from 'react';
import {
  ArrowRight,
  ExternalLink,
  GitBranch,
  Terminal,
  Copy,
  Check,
  Layers,
  ShieldCheck,
  Code2,
  BookOpen,
  Compass,
  Bug,
  Lightbulb,
  GitPullRequest,
  CheckCircle2,
  Clock,
  Calendar,
  Sparkles,
} from 'lucide-react';
import { SitePageShell, PageHeaderBand, DisclosureNotice } from '../PagePrimitives';
import { BrandLogo } from '../BrandLogo';
import {
  GITHUB_REPO_URL,
  GITHUB_ISSUES_URL,
  GITHUB_NEW_ISSUE_URL,
  CHANGELOG_RELEASES,
  ROADMAP_ITEMS,
  RoadmapStatus,
} from '../../lib/siteData';

interface CommunityPageProps {
  onNavigate: (path: string) => void;
  onLaunchApp?: (tab?: string, symbol?: string, region?: 'IN' | 'US' | 'ALL') => void;
}

const CopyCodeBlock: React.FC<{ label: string; code: string }> = ({ label, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="rounded-xl border border-[#E4E8F2] bg-[#080B12] text-[#F5F7FA] overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 text-xs">
        <span className="font-mono text-[#A6B0C3]">{label}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium text-[#CBD3E3] hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-xs sm:text-[13px] leading-relaxed font-mono text-[#E4E8F2]">
        <code>{code}</code>
      </pre>
    </div>
  );
};

export const OpenSourcePage: React.FC<CommunityPageProps> = ({ onNavigate, onLaunchApp }) => {
  const techStack = [
    { name: 'React 19 + TypeScript', role: 'Modular SPA UI, workspace views, strict typing' },
    { name: 'Tailwind CSS v4 + Motion', role: 'Light + Royal Cobalt editorial token system' },
    { name: 'Three.js (WebGL)', role: 'Interactive optical analyzer & subtle ambient canvas' },
    { name: 'Express + tsx Runtime', role: 'Single-origin server serving /api/* & Vite SPA' },
    { name: '@google/genai SDK', role: 'Server-side structured JSON research synthesis' },
    { name: 'Node Built-in Test Runner', role: 'Deterministic unit tests for portfolio & SEO logic' },
  ];

  return (
    <SitePageShell currentPath="/open-source" onNavigate={onNavigate}>
      <PageHeaderBand
        variant="split"
        eyebrow="Open Source"
        title="Transparent financial software, open by design."
        description="Nextrade AI is free, open-source software released under the Apache-2.0 License. Inspect every calculation, audit every AI prompt contract, or self-host the entire stack locally."
        primaryCta={{
          label: 'Launch Nextrade AI',
          onClick: () => (onLaunchApp ? onLaunchApp() : onNavigate('/app')),
        }}
        secondaryCta={{
          label: 'View on GitHub',
          href: GITHUB_REPO_URL,
        }}
        aside={
          <div className="rounded-2xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 sm:p-8 space-y-5">
            <div className="flex items-center justify-between border-b border-[#E4E8F2] pb-5">
              <BrandLogo variant="light" symbolHeightClass="h-5" />
              <span className="rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 py-1 font-mono text-[11px] font-semibold text-[#080B12]">
                Apache-2.0
              </span>
            </div>
            <div className="space-y-3 text-sm text-[#667085]">
              <div className="flex items-center justify-between">
                <span>Built By</span>
                <span className="font-semibold text-[#080B12]">Meril &amp; NEXORA Labs</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Repository</span>
                <a
                  href={GITHUB_REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs font-medium text-[#2D46E6] hover:underline inline-flex items-center gap-1"
                >
                  <span>MERIL2026/nextrade-ai</span>
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              </div>
              <div className="flex items-center justify-between">
                <span>Pricing Model</span>
                <span className="font-medium text-[#080B12]">Free &amp; Open Source</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Runtime Delivery</span>
                <span className="font-medium text-[#080B12]">Browser Web App</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Telemetry / Lock-in</span>
                <span className="font-medium text-[#080B12]">None</span>
              </div>
            </div>
          </div>
        }
      />

      <section className="py-16 sm:py-20 border-b border-[#E4E8F2]">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="max-w-2xl space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#2D46E6]">
              System Architecture
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-[-0.02em] text-[#080B12]">
              Clean separation between UI, pure quantitative logic, and server AI.
            </h2>
            <p className="text-sm sm:text-base text-[#667085] leading-relaxed">
              Every financial formula and AI integration is modular, testable, and exposed in readable TypeScript so contributors can verify behavior without black-box abstractions.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#EFF2FA] text-[#2D46E6]">
                <Layers className="h-5 w-5" aria-hidden="true" />
              </div>
              <h3 className="font-display text-lg font-semibold text-[#080B12]">
                1. Browser Client (React + Three.js)
              </h3>
              <p className="text-sm text-[#667085] leading-relaxed">
                Public editorial routes and the authenticated <code className="font-mono text-xs text-[#080B12]">/app</code> workspace run cleanly in-browser, backed by user-isolated relational database tables.
              </p>
            </div>

            <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#EFF2FA] text-[#2D46E6]">
                <Code2 className="h-5 w-5" aria-hidden="true" />
              </div>
              <h3 className="font-display text-lg font-semibold text-[#080B12]">
                2. Pure Domain &amp; Market Adapters
              </h3>
              <p className="text-sm text-[#667085] leading-relaxed">
                <code className="font-mono text-xs text-[#080B12]">portfolioEngine.ts</code> and <code className="font-mono text-xs text-[#080B12]">src/market/</code> handle real upstream market feeds, L2 quote caching, dynamic USD/INR conversion, BUY/SELL validation, and volatility math.
              </p>
            </div>

            <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#EFF2FA] text-[#2D46E6]">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <h3 className="font-display text-lg font-semibold text-[#080B12]">
                3. Express API + Gemini
              </h3>
              <p className="text-sm text-[#667085] leading-relaxed">
                <code className="font-mono text-xs text-[#080B12]">server.ts</code> isolates <code className="font-mono text-xs text-[#080B12]">GEMINI_API_KEY</code> on the server, exposes <code className="font-mono text-xs text-[#080B12]">/api/markets/*</code> and <code className="font-mono text-xs text-[#080B12]">/api/research</code>, and cleanly reports AI Building Mode if unconfigured.
              </p>
            </div>
          </div>

          <figure className="overflow-hidden rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] shadow-[0_12px_36px_rgba(15,23,42,0.04)]">
            <img
              src="/assets/nextrade-architecture-overview.webp"
              alt="Nextrade AI three-layer open-source architecture diagram showing React 19 + Three.js browser client, pure TypeScript portfolio math engine, and Express API + Google GenAI server"
              width={1200}
              height={630}
              loading="lazy"
              decoding="async"
              className="w-full h-auto block object-cover"
            />
          </figure>

          <div className="rounded-2xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 sm:p-8">
            <h3 className="font-display text-lg font-semibold text-[#080B12] mb-5">
              Verified Technology Stack
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {techStack.map((item) => (
                <div
                  key={item.name}
                  className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-1"
                >
                  <p className="text-sm font-semibold text-[#080B12]">{item.name}</p>
                  <p className="text-xs text-[#667085] leading-relaxed">{item.role}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20 bg-[#F7F8FA] border-b border-[#E4E8F2]">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-5 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#2D46E6]">
              Quick Start
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-[-0.02em] text-[#080B12]">
              Run Nextrade AI locally in under two minutes.
            </h2>
            <p className="text-sm text-[#667085] leading-relaxed">
              No database daemon or desktop installer is required. Clone the repository, install npm packages, optionally configure a server-side Gemini key in <code className="font-mono text-xs text-[#080B12]">.env</code>, and start the unified server on port 3000.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                onClick={() => onNavigate('/contribute')}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-[#2D46E6] px-5 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] hover:bg-[#2238C9] transition-colors cursor-pointer"
              >
                <span>Contribution Guide</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('/docs')}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-4 text-xs font-semibold uppercase tracking-[0.03em] text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] transition-colors cursor-pointer"
              >
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Read Docs</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-7 space-y-4">
            <CopyCodeBlock
              label="bash — clone, install & start"
              code={`git clone ${GITHUB_REPO_URL}.git
cd nextrade-ai
npm install
cp .env.example .env
npm run dev`}
            />
            <DisclosureNotice
              label="License & Transparency"
              text="Nextrade AI is licensed under Apache-2.0. Repository links point directly to github.com/MERIL2026/nextrade-ai without fabricated star counts, contributor badges, or download claims."
            />
          </div>
        </div>
      </section>
    </SitePageShell>
  );
};

export const AboutPage: React.FC<CommunityPageProps> = ({ onNavigate, onLaunchApp }) => {
  const principles = [
    {
      title: 'Explainability Over Black Boxes',
      text: 'Every AI-assisted brief separates thesis summary, positive drivers, downside risk factors, and explicit reasoning basis so users can critique conclusions rather than blindly trust scores.',
    },
    {
      title: 'Cross-Market Perspective by Default',
      text: 'Modern capital and supply chains span India (NSE, BSE) and the United States (NYSE, NASDAQ). Nextrade AI treats both ecosystems as first-class citizens in a single workspace.',
    },
    {
      title: 'Risk First, Simulation Without Consequence',
      text: 'Volatility, maximum drawdown, beta, and concentration (HHI) sit beside every return figure—and paper trading lets learners test allocation mechanics without risking real capital.',
    },
    {
      title: 'Free, Browser-Native & Open Source',
      text: 'Financial literacy tools should not sit behind enterprise paywalls or opaque binaries. Anyone can open the browser app immediately or inspect the source code on GitHub.',
    },
  ];

  return (
    <SitePageShell currentPath="/about" onNavigate={onNavigate}>
      <PageHeaderBand
        variant="left"
        eyebrow="About Nextrade AI · Built by Meril & NEXORA Labs"
        title="Making Financial Intelligence Accessible & Open."
        description="Nextrade AI is a free and open-source AI-powered financial intelligence platform built by Meril & NEXORA Labs to help investors, students, and builders explore global markets with real data and transparent engineering."
        primaryCta={{
          label: 'Explore the Workspace',
          onClick: () => (onLaunchApp ? onLaunchApp() : onNavigate('/app')),
        }}
        secondaryCta={{
          label: 'Open Source Architecture',
          onClick: () => onNavigate('/open-source'),
        }}
      />

      <section className="py-16 sm:py-20 border-b border-[#E4E8F2]">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 space-y-16">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
            <div className="md:col-span-4">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#2D46E6]">
                Creators &amp; Mission
              </p>
              <h2 className="mt-2 font-display text-2xl font-bold text-[#080B12]">
                Built by Meril &amp; NEXORA Labs.
              </h2>
            </div>
            <div className="md:col-span-8 space-y-4 text-base text-[#667085] leading-relaxed">
              <p>
                Nextrade AI is created and maintained by <strong className="text-[#080B12]">Meril &amp; NEXORA Labs</strong> as a 100% free, Apache-2.0 open-source platform. There are zero paid subscriptions, zero locked Pro tiers, and zero artificial paywalls.
              </p>
              <p>
                Most retail trading apps push emotional frequency while institutional research terminals remain locked behind high fees. Nextrade AI bridges that gap with real multi-asset data across NSE/BSE, NYSE/NASDAQ, ETFs, crypto, and forex, paired with transparent simulated trading and evolving AI intelligence.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start border-t border-[#E4E8F2] pt-14">
            <div className="md:col-span-4">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#2D46E6]">
                Mission &amp; Vision
              </p>
              <h2 className="mt-2 font-display text-2xl font-bold text-[#080B12]">
                Understand markets. Research deeper.
              </h2>
            </div>
            <div className="md:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 space-y-2.5">
                <h3 className="font-display text-base font-semibold text-[#080B12]">Our Mission</h3>
                <p className="text-sm text-[#667085] leading-relaxed">
                  Give anyone with a web browser clean access to explainable market research, risk-aware portfolio analytics, and cross-market simulation—completely free and inspectable.
                </p>
              </div>
              <div className="rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 space-y-2.5">
                <h3 className="font-display text-base font-semibold text-[#080B12]">Our Vision</h3>
                <p className="text-sm text-[#667085] leading-relaxed">
                  A transparent financial software commons where AI assists critical thinking, uncertainties are stated plainly, and communities can extend data adapters openly.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start border-t border-[#E4E8F2] pt-14">
            <div className="md:col-span-4">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#2D46E6]">
                Product Philosophy
              </p>
              <h2 className="mt-2 font-display text-2xl font-bold text-[#080B12]">
                Four non-negotiable engineering principles.
              </h2>
            </div>
            <div className="md:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-5">
              {principles.map((p) => (
                <div
                  key={p.title}
                  className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-5 space-y-2"
                >
                  <h3 className="font-display text-base font-semibold text-[#080B12]">{p.title}</h3>
                  <p className="text-sm text-[#667085] leading-relaxed">{p.text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start border-t border-[#E4E8F2] pt-14">
            <div className="md:col-span-4">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#2D46E6]">
                Transparency &amp; Future Direction
              </p>
              <h2 className="mt-2 font-display text-2xl font-bold text-[#080B12]">
                Honest boundaries at every layer.
              </h2>
            </div>
            <div className="md:col-span-8 space-y-5">
              <p className="text-sm sm:text-base text-[#667085] leading-relaxed">
                Nextrade AI is an informational and educational open-source initiative by Meril &amp; NEXORA Labs—not a registered broker, exchange, or investment advisor. Market prices originate from upstream data adapters with explicit freshness labels (LIVE, DELAYED, CACHED, UNAVAILABLE), paper trading is strictly simulated, and AI capabilities clearly communicate live Gemini vs. Building Mode status.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate('/roadmap')}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-4 text-xs font-semibold uppercase tracking-[0.03em] text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] transition-colors cursor-pointer"
                >
                  <Compass className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>View Public Roadmap</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('/changelog')}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-4 text-xs font-semibold uppercase tracking-[0.03em] text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] transition-colors cursor-pointer"
                >
                  <span>Read Changelog</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </SitePageShell>
  );
};

type ChangelogCategory = 'All' | 'Features' | 'Improvements' | 'Fixes' | 'Technical';

export const ChangelogPage: React.FC<CommunityPageProps> = ({ onNavigate }) => {
  const [filter, setFilter] = useState<ChangelogCategory>('All');
  const categories: ChangelogCategory[] = ['All', 'Features', 'Improvements', 'Fixes', 'Technical'];

  return (
    <SitePageShell currentPath="/changelog" onNavigate={onNavigate}>
      <PageHeaderBand
        variant="left"
        eyebrow="Changelog"
        title="Release History & Platform Evolution"
        description="A chronological record of verified product capabilities, interface refinements, bug fixes, and architectural updates shipped in Nextrade AI."
        secondaryCta={{ label: 'View Repository Releases', href: GITHUB_REPO_URL }}
      />

      <section className="py-14 sm:py-18">
        <div className="mx-auto max-w-[980px] px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="flex flex-wrap items-center gap-2 border-b border-[#E4E8F2] pb-5">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setFilter(cat)}
                className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  filter === cat
                    ? 'bg-[#2D46E6] text-[#FFFFFF]'
                    : 'bg-[#F7F8FA] text-[#667085] border border-[#E4E8F2] hover:text-[#080B12]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="space-y-8">
            {CHANGELOG_RELEASES.map((rel) => {
              const showFeatures =
                (filter === 'All' || filter === 'Features') && rel.features.length > 0;
              const showImprovements =
                (filter === 'All' || filter === 'Improvements') && rel.improvements.length > 0;
              const showFixes = (filter === 'All' || filter === 'Fixes') && rel.fixes.length > 0;
              const showTechnical =
                (filter === 'All' || filter === 'Technical') && rel.technical.length > 0;

              if (!showFeatures && !showImprovements && !showFixes && !showTechnical) {
                return null;
              }

              return (
                <article
                  key={rel.version}
                  className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 sm:p-8 space-y-6"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E4E8F2] pb-5">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="rounded-md bg-[#EFF2FA] px-2.5 py-1 font-mono text-xs font-bold text-[#2D46E6]">
                          {rel.version}
                        </span>
                        <time className="font-mono text-xs text-[#667085]">{rel.date}</time>
                      </div>
                      <h2 className="font-display text-xl sm:text-2xl font-bold text-[#080B12] pt-1">
                        {rel.title}
                      </h2>
                    </div>
                  </div>

                  <p className="text-sm sm:text-base text-[#667085] leading-relaxed">
                    {rel.summary}
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {showFeatures && (
                      <div className="space-y-2.5">
                        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[#2D46E6]">
                          Features
                        </h3>
                        <ul className="space-y-2 text-sm text-[#080B12]">
                          {rel.features.map((item) => (
                            <li key={item} className="flex items-start gap-2.5">
                              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#2D46E6] shrink-0" />
                              <span className="text-[#667085] leading-relaxed">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {showImprovements && (
                      <div className="space-y-2.5">
                        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[#080B12]">
                          Improvements
                        </h3>
                        <ul className="space-y-2 text-sm">
                          {rel.improvements.map((item) => (
                            <li key={item} className="flex items-start gap-2.5">
                              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#080B12] shrink-0" />
                              <span className="text-[#667085] leading-relaxed">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {showFixes && (
                      <div className="space-y-2.5">
                        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[#080B12]">
                          Fixes
                        </h3>
                        <ul className="space-y-2 text-sm">
                          {rel.fixes.map((item) => (
                            <li key={item} className="flex items-start gap-2.5">
                              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#667085] shrink-0" />
                              <span className="text-[#667085] leading-relaxed">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {showTechnical && (
                      <div className="space-y-2.5">
                        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[#080B12]">
                          Technical Updates
                        </h3>
                        <ul className="space-y-2 text-sm">
                          {rel.technical.map((item) => (
                            <li key={item} className="flex items-start gap-2.5">
                              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#667085] shrink-0" />
                              <span className="text-[#667085] leading-relaxed">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </SitePageShell>
  );
};

export const RoadmapPage: React.FC<CommunityPageProps> = ({ onNavigate }) => {
  const sections: {
    status: RoadmapStatus;
    subtitle: string;
    icon: React.ReactNode;
    badgeClass: string;
  }[] = [
    {
      status: 'Completed',
      subtitle: 'Shipped and verifiable in the live browser application today.',
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />,
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    {
      status: 'In Progress',
      subtitle: 'Actively being engineered and refined in current development.',
      icon: <Clock className="h-4 w-4 text-[#2D46E6]" aria-hidden="true" />,
      badgeClass: 'bg-[#EFF2FA] text-[#2D46E6] border-[#D5DDF7]',
    },
    {
      status: 'Planned',
      subtitle: 'Scoped priorities queued for upcoming open-source milestones.',
      icon: <Calendar className="h-4 w-4 text-[#080B12]" aria-hidden="true" />,
      badgeClass: 'bg-[#F7F8FA] text-[#080B12] border-[#E4E8F2]',
    },
    {
      status: 'Under Consideration',
      subtitle: 'Community proposals and research ideas open for discussion.',
      icon: <Sparkles className="h-4 w-4 text-[#667085]" aria-hidden="true" />,
      badgeClass: 'bg-[#FFFFFF] text-[#667085] border-[#E4E8F2]',
    },
  ];

  return (
    <SitePageShell currentPath="/roadmap" onNavigate={onNavigate}>
      <PageHeaderBand
        variant="left"
        eyebrow="Public Roadmap"
        title="Where Nextrade AI stands—and where it is heading."
        description="We publish an honest capability roadmap separating shipped features from active work and future proposals, without unconfirmed target dates or speculative promises."
        primaryCta={{
          label: 'Propose a Feature',
          onClick: () => onNavigate('/contribute'),
        }}
        secondaryCta={{
          label: 'View GitHub Issues',
          href: GITHUB_ISSUES_URL,
        }}
      />

      <section className="py-14 sm:py-18">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 space-y-12">
          {sections.map((section) => {
            const items = ROADMAP_ITEMS.filter((i) => i.status === section.status);
            return (
              <div key={section.status} className="space-y-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#E4E8F2] pb-3">
                  <div className="flex items-center gap-2.5">
                    {section.icon}
                    <h2 className="font-display text-xl font-bold text-[#080B12]">
                      {section.status}
                    </h2>
                    <span className="font-mono text-xs text-[#667085]">({items.length})</span>
                  </div>
                  <p className="text-xs sm:text-sm text-[#667085]">{section.subtitle}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3 hover:border-[#C9D2E8] transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#667085]">
                          {item.category}
                        </span>
                        <span
                          className={`rounded-md border px-2.5 py-0.5 text-[11px] font-semibold ${section.badgeClass}`}
                        >
                          {item.status}
                        </span>
                      </div>
                      <h3 className="font-display text-lg font-semibold text-[#080B12]">
                        {item.title}
                      </h3>
                      <p className="text-sm text-[#667085] leading-relaxed">{item.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <DisclosureNotice
            label="Roadmap Policy"
            text="Items marked Planned or Under Consideration reflect current engineering priorities and community feedback via GitHub Issues. No binding release dates are published until implementation is verified."
          />
        </div>
      </section>
    </SitePageShell>
  );
};

export const ContributePage: React.FC<CommunityPageProps> = ({ onNavigate }) => {
  return (
    <SitePageShell currentPath="/contribute" onNavigate={onNavigate}>
      <PageHeaderBand
        variant="left"
        eyebrow="Contribute"
        title="Build open financial intelligence with us."
        description="Nextrade AI welcomes bug reports, quantitative improvements, documentation refinements, and exchange adapter proposals under the Apache-2.0 License."
        secondaryCta={{ label: 'Contribute on GitHub', href: GITHUB_REPO_URL }}
      />

      <section className="py-16 sm:py-20 border-b border-[#E4E8F2]">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 space-y-3">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#FFFFFF] border border-[#E4E8F2] text-[#2D46E6]">
                <Bug className="h-4 w-4" aria-hidden="true" />
              </div>
              <h2 className="font-display text-lg font-semibold text-[#080B12]">Report Bugs</h2>
              <p className="text-sm text-[#667085] leading-relaxed">
                Found a calculation edge case, UI layout defect, or API error? Open an issue with clear reproduction steps and expected behavior.
              </p>
              <a
                href={GITHUB_NEW_ISSUE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2D46E6] hover:underline"
              >
                <span>Open an Issue</span>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>

            <div className="rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 space-y-3">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#FFFFFF] border border-[#E4E8F2] text-[#2D46E6]">
                <Lightbulb className="h-4 w-4" aria-hidden="true" />
              </div>
              <h2 className="font-display text-lg font-semibold text-[#080B12]">Suggest Features</h2>
              <p className="text-sm text-[#667085] leading-relaxed">
                Have an idea for risk analytics, NSE/BSE or NYSE/NASDAQ datasets, or workspace workflows? Share a concise proposal before coding.
              </p>
              <a
                href={GITHUB_ISSUES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2D46E6] hover:underline"
              >
                <span>Discuss on GitHub</span>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>

            <div className="rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 space-y-3">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#FFFFFF] border border-[#E4E8F2] text-[#2D46E6]">
                <GitPullRequest className="h-4 w-4" aria-hidden="true" />
              </div>
              <h2 className="font-display text-lg font-semibold text-[#080B12]">Submit Pull Requests</h2>
              <p className="text-sm text-[#667085] leading-relaxed">
                Fork the repo, keep financial math pure and unit-tested, preserve the monochrome brand guidelines, and open a clean PR.
              </p>
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2D46E6] hover:underline"
              >
                <span>Contribute on GitHub</span>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-5 space-y-4">
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#2D46E6]">
                <Terminal className="h-4 w-4" aria-hidden="true" />
                <span>Developer Setup</span>
              </div>
              <h2 className="font-display text-2xl font-bold text-[#080B12]">
                Local environment, unit tests &amp; code standards
              </h2>
              <ul className="space-y-3 text-sm text-[#667085] leading-relaxed">
                <li className="flex items-start gap-2.5">
                  <GitBranch className="h-4 w-4 text-[#2D46E6] shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    Fork <code className="font-mono text-xs text-[#080B12]">MERIL2026/nextrade-ai</code> and create a focused feature branch.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-[#2D46E6] shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    Ensure <code className="font-mono text-xs text-[#080B12]">portfolioEngine.test.ts</code>, <code className="font-mono text-xs text-[#080B12]">siteData.test.ts</code>, <code className="font-mono text-xs text-[#080B12]">npm run lint</code>, and <code className="font-mono text-xs text-[#080B12]">npm run build</code> pass cleanly.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <ShieldCheck className="h-4 w-4 text-[#2D46E6] shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    Never expose secrets in client variables (<code className="font-mono text-xs text-[#080B12]">VITE_*</code>) or modify the monochrome SVG logo geometry.
                  </span>
                </li>
              </ul>
            </div>

            <div className="lg:col-span-7 space-y-4">
              <CopyCodeBlock
                label="Local Setup & Verification"
                code={`# 1. Fork & clone your repository
git clone ${GITHUB_REPO_URL}.git
cd nextrade-ai
npm install

# 2. Configure optional server environment
cp .env.example .env

# 3. Run unit tests, typecheck & production build
npx tsx --test src/lib/portfolioEngine.test.ts
npx tsx --test src/lib/siteData.test.ts
npm run lint
npm run build`}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-[#E4E8F2] bg-[#EFF2FA] p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#2D46E6]">
                Apache-2.0 License
              </p>
              <h3 className="font-display text-lg font-bold text-[#080B12]">
                Ready to inspect the codebase or pick up a first issue?
              </h3>
              <p className="text-sm text-[#667085]">
                Contributions are governed by Apache-2.0 so improvements stay free and open for everyone.
              </p>
            </div>
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-md bg-[#2D46E6] px-6 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] shadow-[0_8px_20px_rgba(45,70,230,0.22)] hover:bg-[#2238C9] transition-colors"
            >
              <span>Contribute on GitHub</span>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
    </SitePageShell>
  );
};
