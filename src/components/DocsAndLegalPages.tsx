import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Copy,
  Check,
  BookOpen,
  ArrowRight,
  Cookie,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import {
  Breadcrumbs,
  SitePageShell,
  PageHeaderBand,
  DisclosureNotice,
} from './PagePrimitives';
import {
  DOC_ARTICLES,
  DOC_CATEGORIES,
  DocCategory,
  filterDocsArticles,
  getBreadcrumbsForPath,
} from '../lib/siteData';
import {
  CookieConsentChoice,
  getStoredCookieConsent,
  resetCookieConsent,
  saveCookieConsent,
  subscribeCookieConsent,
} from '../lib/analytics';

interface DocsAndLegalPagesProps {
  page: 'docs' | 'privacy' | 'terms' | 'cookies' | 'disclaimer';
  onNavigate: (path: string) => void;
}

const DocCodeSnippet: React.FC<{ label: string; code: string }> = ({ label, code }) => {
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
    <div className="rounded-lg border border-[#E4E8F2] bg-[#080B12] text-[#F5F7FA] overflow-hidden mt-3">
      <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2 text-[11px]">
        <span className="font-mono text-[#A6B0C3]">{label}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[#CBD3E3] hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" aria-hidden="true" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto text-xs leading-relaxed font-mono text-[#E4E8F2]">
        <code>{code}</code>
      </pre>
    </div>
  );
};

export const DocsAndLegalPages: React.FC<DocsAndLegalPagesProps> = ({
  page,
  onNavigate,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'ALL' | DocCategory>('ALL');
  const [cookieChoice, setCookieChoice] = useState<CookieConsentChoice | null>(null);
  const [consentSavedNotice, setConsentSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    setCookieChoice(getStoredCookieConsent());
    return subscribeCookieConsent((next) => setCookieChoice(next));
  }, []);

  const filteredArticles = useMemo(
    () => filterDocsArticles(DOC_ARTICLES, searchQuery, selectedCategory),
    [searchQuery, selectedCategory],
  );

  if (page === 'docs') {
    return (
      <SitePageShell currentPath="/docs" onNavigate={onNavigate}>
        <PageHeaderBand
          variant="left"
          eyebrow="Documentation"
          title="Nextrade AI Architecture & Platform Guides"
          description="Searchable documentation covering local setup, workspace modules, server API endpoints (/api/health, /api/markets, /api/research), and open-source developer workflows."
          primaryCta={{
            label: 'Launch Browser Workspace',
            onClick: () => onNavigate('/app'),
          }}
          secondaryCta={{
            label: 'Check System Status',
            onClick: () => onNavigate('/status'),
          }}
        />

        <section className="py-12 sm:py-16">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 space-y-10">
            {/* Search & Category Filter Bar */}
            <div className="rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#667085]"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search docs (e.g. research, NSE, paper trading, .env)..."
                  aria-label="Search documentation"
                  className="h-10 w-full rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] pl-10 pr-3.5 text-sm text-[#080B12] placeholder:text-[#98A2B3] focus:border-[#2D46E6] focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('ALL')}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                    selectedCategory === 'ALL'
                      ? 'bg-[#2D46E6] text-[#FFFFFF]'
                      : 'bg-[#FFFFFF] text-[#667085] border border-[#E4E8F2] hover:text-[#080B12]'
                  }`}
                >
                  All ({DOC_ARTICLES.length})
                </button>
                {DOC_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                      selectedCategory === cat
                        ? 'bg-[#2D46E6] text-[#FFFFFF]'
                        : 'bg-[#FFFFFF] text-[#667085] border border-[#E4E8F2] hover:text-[#080B12]'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Sidebar + Articles Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
              <aside className="lg:col-span-4 lg:sticky lg:top-24 rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-5 space-y-5">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#2D46E6]">
                  <BookOpen className="h-4 w-4" aria-hidden="true" />
                  <span>Contents</span>
                </div>
                <div className="space-y-4">
                  {DOC_CATEGORIES.map((cat) => {
                    const catItems = DOC_ARTICLES.filter((a) => a.category === cat);
                    return (
                      <div key={cat} className="space-y-1.5">
                        <p className="text-xs font-bold uppercase tracking-[0.05em] text-[#080B12]">
                          {cat}
                        </p>
                        <ul className="space-y-1 border-l border-[#E4E8F2] pl-3">
                          {catItems.map((item) => (
                            <li key={item.id}>
                              <a
                                href={`#${item.id}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  setSelectedCategory('ALL');
                                  setSearchQuery('');
                                  setTimeout(() => {
                                    document
                                      .getElementById(item.id)
                                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                  }, 30);
                                }}
                                className="block py-1 text-xs text-[#667085] hover:text-[#2D46E6] transition-colors"
                              >
                                {item.title}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </aside>

              <div className="lg:col-span-8 space-y-6">
                {filteredArticles.length === 0 ? (
                  <div className="rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-8 text-center space-y-3">
                    <p className="font-display text-lg font-semibold text-[#080B12]">
                      No matching documentation articles
                    </p>
                    <p className="text-sm text-[#667085]">
                      Try clearing your search filter or browsing all four categories.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setSelectedCategory('ALL');
                      }}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2D46E6] px-4 text-xs font-semibold text-[#FFFFFF] cursor-pointer"
                    >
                      Reset Filters
                    </button>
                  </div>
                ) : (
                  filteredArticles.map((article) => (
                    <article
                      key={article.id}
                      id={article.id}
                      className="scroll-mt-24 rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 sm:p-7 space-y-4"
                    >
                      <div className="space-y-1.5">
                        <span className="inline-block rounded bg-[#EFF2FA] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#2D46E6]">
                          {article.category}
                        </span>
                        <h2 className="font-display text-xl font-bold text-[#080B12]">
                          {article.title}
                        </h2>
                        <p className="text-sm font-medium text-[#667085]">{article.summary}</p>
                      </div>

                      <div className="space-y-3 text-sm leading-relaxed text-[#667085]">
                        {article.body.map((paragraph, idx) => (
                          <p key={idx}>{paragraph}</p>
                        ))}
                      </div>

                      {article.codeSnippet && (
                        <DocCodeSnippet
                          label={article.codeSnippet.label}
                          code={article.codeSnippet.code}
                        />
                      )}
                    </article>
                  ))
                )}

                <div className="rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="font-display text-base font-semibold text-[#080B12]">
                      Want to contribute to Nextrade AI?
                    </h3>
                    <p className="text-xs sm:text-sm text-[#667085]">
                      Review our contributor guide, pure engine tests, and GitHub workflow.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('/contribute')}
                    className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-4 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] transition-colors cursor-pointer"
                  >
                    <span>Contributor Guide</span>
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </SitePageShell>
    );
  }

  const currentPath = `/${page}`;
  const breadcrumbs = getBreadcrumbsForPath(currentPath);

  return (
    <SitePageShell currentPath={currentPath} onNavigate={onNavigate}>
      <div className="mx-auto max-w-[860px] px-4 py-14 sm:px-6 sm:py-20 space-y-10">
        <Breadcrumbs items={breadcrumbs} onNavigate={onNavigate} />

        {page === 'privacy' && (
          <>
            <div className="space-y-3 border-b border-[#E4E8F2] pb-8">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#2D46E6]">
                  Legal · Privacy Policy
                </p>
                <span className="font-mono text-xs text-[#667085]">Effective: November 13, 2026</span>
              </div>
              <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-[-0.02em] text-[#080B12]">
                Privacy Policy
              </h1>
              <p className="text-sm sm:text-base text-[#667085] leading-relaxed">
                Nextrade AI is engineered around minimal data collection. You can explore Indian (NSE/BSE) and US (NYSE/NASDAQ) markets, run paper-trading simulations, and read research briefs without creating an account.
              </p>
            </div>

            <div className="space-y-6">
              <section className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
                <h2 className="font-display text-lg font-bold text-[#080B12]">
                  1. Zero-Account Architecture &amp; Browser-Local Storage
                </h2>
                <p className="text-sm leading-relaxed text-[#667085]">
                  Nextrade AI does not require registration, passwords, PAN/SSN identifiers, or brokerage credentials. Your simulated paper-trading portfolio, order history, watchlist tickers, and region preferences are saved exclusively inside your browser&apos;s{' '}
                  <code className="rounded bg-[#F7F8FA] border border-[#E4E8F2] px-1.5 py-0.5 font-mono text-xs text-[#080B12]">
                    localStorage
                  </code>
                  . That state never leaves your device automatically and can be reset anytime from{' '}
                  <a
                    href="/app?tab=settings"
                    onClick={(e) => {
                      e.preventDefault();
                      onNavigate('/app?tab=settings');
                    }}
                    className="font-medium text-[#2D46E6] hover:underline"
                  >
                    Workspace Settings
                  </a>
                  .
                </p>
              </section>

              <section className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
                <h2 className="font-display text-lg font-bold text-[#080B12]">
                  2. AI Research Queries (/api/research)
                </h2>
                <p className="text-sm leading-relaxed text-[#667085]">
                  When you submit a financial research prompt inside the AI Research Assistant, the selected ticker symbol and your query text are sent to our Express backend (<code className="font-mono text-xs text-[#080B12]">POST /api/research</code>) to synthesize a structured analytical brief via <code className="font-mono text-xs text-[#080B12]">@google/genai</code> when configured. Do not include personal financial account numbers or confidential personal information inside research prompts.
                </p>
              </section>

              <section className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
                <h2 className="font-display text-lg font-bold text-[#080B12]">
                  3. Contact Form Submissions (/api/contact)
                </h2>
                <p className="text-sm leading-relaxed text-[#667085]">
                  When you voluntarily submit the form on our{' '}
                  <a
                    href="/contact"
                    onClick={(e) => {
                      e.preventDefault();
                      onNavigate('/contact');
                    }}
                    className="font-medium text-[#2D46E6] hover:underline"
                  >
                    Contact page
                  </a>
                  , we record your name, email address, selected topic, optional ticker/URL reference, message content, and timestamp solely so project maintainers can review and respond to your enquiry. We never sell, rent, or share contact details with third-party advertisers.
                </p>
              </section>

              <section className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
                <h2 className="font-display text-lg font-bold text-[#080B12]">
                  4. Analytics &amp; Cookie Consent Controls
                </h2>
                <p className="text-sm leading-relaxed text-[#667085]">
                  When Google Analytics 4 is enabled in production, Google Consent Mode v2 defaults{' '}
                  <code className="font-mono text-xs text-[#080B12]">analytics_storage</code> to{' '}
                  <code className="font-mono text-xs text-[#080B12]">denied</code> and disables advertising personalization (<code className="font-mono text-xs text-[#080B12]">ad_storage: &apos;denied&apos;</code>). Aggregated page-view telemetry is only sent if you explicitly click <strong>Accept Analytics</strong>. Review or revoke your preference anytime on the{' '}
                  <a
                    href="/cookies"
                    onClick={(e) => {
                      e.preventDefault();
                      onNavigate('/cookies');
                    }}
                    className="font-medium text-[#2D46E6] hover:underline"
                  >
                    Cookies Policy page
                  </a>
                  .
                </p>
              </section>
            </div>
          </>
        )}

        {page === 'terms' && (
          <>
            <div className="space-y-3 border-b border-[#E4E8F2] pb-8">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#2D46E6]">
                  Legal · Terms &amp; Conditions
                </p>
                <span className="font-mono text-xs text-[#667085]">Effective: November 13, 2026</span>
              </div>
              <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-[-0.02em] text-[#080B12]">
                Terms &amp; Conditions
              </h1>
              <p className="text-sm sm:text-base text-[#667085] leading-relaxed">
                These Terms &amp; Conditions govern access to the Nextrade AI public website, browser workspace (<code className="font-mono text-xs text-[#080B12]">/app</code>), and API routes.
              </p>
            </div>

            <div className="space-y-6">
              <section className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
                <h2 className="font-display text-lg font-bold text-[#080B12]">
                  1. Open-Source License (Apache-2.0)
                </h2>
                <p className="text-sm leading-relaxed text-[#667085]">
                  Nextrade AI is distributed free of charge as open-source software under the Apache License, Version 2.0. You may inspect, fork, self-host, and contribute improvements subject to the terms of the Apache-2.0 License. Nextrade AI does not sell paid subscription plans or locked Pro tiers.
                </p>
              </section>

              <section className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
                <h2 className="font-display text-lg font-bold text-[#080B12]">
                  2. Educational &amp; Informational Purpose Only
                </h2>
                <p className="text-sm leading-relaxed text-[#667085]">
                  All AI research briefs, market metrics, volatility statistics, and portfolio ratios are strictly informational. Nextrade AI does not provide personalized investment, tax, or legal advice, and never promises guaranteed returns, accurate price targets, or risk-free trading outcomes.
                </p>
              </section>

              <section className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
                <h2 className="font-display text-lg font-bold text-[#080B12]">
                  3. Simulated Paper Trading &amp; Market Data Transparency
                </h2>
                <p className="text-sm leading-relaxed text-[#667085]">
                  Orders placed in the Paper Trading module use virtual buying power and fetched real/delayed market quotes with live FX conversion. They represent strictly simulated execution—they never route to NSE, BSE, NYSE, NASDAQ, or any broker-dealer and carry zero monetary settlement obligations.
                </p>
              </section>

              <section className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
                <h2 className="font-display text-lg font-bold text-[#080B12]">
                  4. Acceptable API &amp; Service Usage
                </h2>
                <p className="text-sm leading-relaxed text-[#667085]">
                  Users agree not to abuse, flood, or automate excessive requests against <code className="font-mono text-xs text-[#080B12]">POST /api/research</code> or <code className="font-mono text-xs text-[#080B12]">POST /api/contact</code>, attempt unauthorized access to host infrastructure, or redistribute AI outputs as regulated financial advice.
                </p>
              </section>

              <section className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
                <h2 className="font-display text-lg font-bold text-[#080B12]">
                  5. Disclaimer of Warranties
                </h2>
                <p className="text-sm leading-relaxed text-[#667085]">
                  Consistent with the Apache-2.0 License, the platform is provided &ldquo;AS IS&rdquo; without warranties of merchantability, fitness for a particular purpose, uninterrupted uptime, or real-time quote accuracy.
                </p>
              </section>
            </div>
          </>
        )}

        {page === 'cookies' && (
          <>
            <div className="space-y-3 border-b border-[#E4E8F2] pb-8">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#2D46E6]">
                  Legal · Cookies &amp; Browser Storage
                </p>
                <span className="font-mono text-xs text-[#667085]">Effective: November 13, 2026</span>
              </div>
              <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-[-0.02em] text-[#080B12]">
                Cookies Policy &amp; Preferences
              </h1>
              <p className="text-sm sm:text-base text-[#667085] leading-relaxed">
                Understand exactly what Nextrade AI stores in your browser and manage your optional analytics consent preference at any time.
              </p>
            </div>

            {/* Live Interactive Consent Manager */}
            <div className="rounded-2xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 sm:p-7 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#EFF2FA] text-[#2D46E6]">
                    <Cookie className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="font-display text-base font-bold text-[#080B12]">
                      Your Current Privacy Preference
                    </h2>
                    <p className="text-xs text-[#667085]">
                      Status:{' '}
                      <span className="font-semibold text-[#080B12]">
                        {cookieChoice === 'accepted'
                          ? 'Essential Storage + Google Analytics 4 Enabled'
                          : cookieChoice === 'essential'
                            ? 'Essential Browser Storage Only (Analytics Denied)'
                            : 'Not Yet Selected (Defaults to Essential Only)'}
                      </span>
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 py-1 text-[11px] font-semibold text-[#080B12]">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#2D46E6]" aria-hidden="true" />
                  <span>Consent Mode v2</span>
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    saveCookieConsent('essential');
                    setConsentSavedNotice('Saved: Essential browser storage only. Analytics remains disabled.');
                  }}
                  className={`inline-flex h-10 items-center justify-center rounded-md border px-4 text-xs font-semibold transition-colors cursor-pointer ${
                    cookieChoice === 'essential'
                      ? 'border-[#080B12] bg-[#080B12] text-[#FFFFFF]'
                      : 'border-[#E4E8F2] bg-[#FFFFFF] text-[#080B12] hover:border-[#2D46E6]'
                  }`}
                >
                  Use Essential Only
                </button>
                <button
                  type="button"
                  onClick={() => {
                    saveCookieConsent('accepted');
                    setConsentSavedNotice('Saved: Optional Google Analytics 4 telemetry enabled for page views.');
                  }}
                  className={`inline-flex h-10 items-center justify-center rounded-md px-4 text-xs font-semibold transition-colors cursor-pointer ${
                    cookieChoice === 'accepted'
                      ? 'bg-[#2D46E6] text-[#FFFFFF]'
                      : 'border border-[#2D46E6] bg-[#FFFFFF] text-[#2D46E6] hover:bg-[#EFF2FA]'
                  }`}
                >
                  Accept Analytics
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetCookieConsent();
                    setConsentSavedNotice('Consent choice cleared. The preference banner is visible again.');
                  }}
                  className="inline-flex h-10 items-center gap-1.5 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-4 text-xs font-semibold text-[#667085] hover:text-[#080B12] transition-colors cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Reset Consent Banner</span>
                </button>
              </div>

              {consentSavedNotice && (
                <p className="text-xs font-medium text-[#2D46E6]" role="status">
                  {consentSavedNotice}
                </p>
              )}
            </div>

            <div className="space-y-6">
              <section className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
                <h2 className="font-display text-lg font-bold text-[#080B12]">
                  1. Essential Browser Storage (Always Active)
                </h2>
                <p className="text-sm leading-relaxed text-[#667085]">
                  Instead of tracking session cookies, the Nextrade AI workspace relies on strictly necessary <code className="font-mono text-xs text-[#080B12]">localStorage</code> keys so your simulation remains functional across reloads:
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#E4E8F2] text-[#667085]">
                        <th className="py-2 pr-4 font-semibold">Storage Key</th>
                        <th className="py-2 pr-4 font-semibold">Purpose</th>
                        <th className="py-2 font-semibold">Scope</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E4E8F2] text-[#080B12]">
                      <tr>
                        <td className="py-2.5 pr-4 font-mono">nextrade_paper_portfolio_v1</td>
                        <td className="py-2.5 pr-4 text-[#667085]">Simulated paper-trading cash, holdings &amp; order history</td>
                        <td className="py-2.5 text-[#667085]">Local Browser</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pr-4 font-mono">nextrade_watchlist_v1</td>
                        <td className="py-2.5 pr-4 text-[#667085]">Saved NSE/BSE and NYSE/NASDAQ focus tickers</td>
                        <td className="py-2.5 text-[#667085]">Local Browser</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pr-4 font-mono">nextrade_default_region_v1</td>
                        <td className="py-2.5 pr-4 text-[#667085]">Preferred market region filter (ALL, IN, or US)</td>
                        <td className="py-2.5 text-[#667085]">Local Browser</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pr-4 font-mono">nextrade_cookie_consent_v1</td>
                        <td className="py-2.5 pr-4 text-[#667085]">Stores your analytics consent choice</td>
                        <td className="py-2.5 text-[#667085]">Local Browser</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
                <h2 className="font-display text-lg font-bold text-[#080B12]">
                  2. Optional Google Analytics 4 Cookies
                </h2>
                <p className="text-sm leading-relaxed text-[#667085]">
                  If the deployment configures a Google Analytics 4 measurement ID and you click <strong>Accept Analytics</strong>, Google Analytics may set first-party cookies (such as <code className="font-mono text-xs text-[#080B12]">_ga</code>) to measure aggregate page navigation performance with IP anonymization enabled. Ad storage and ad personalization remain permanently denied.
                </p>
              </section>
            </div>
          </>
        )}

        {page === 'disclaimer' && (
          <>
            <div className="space-y-3 border-b border-[#E4E8F2] pb-8">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#2D46E6]">
                Disclosures
              </p>
              <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-[-0.02em] text-[#080B12]">
                Financial Information Disclaimer
              </h1>
            </div>
            <div className="rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 space-y-4 text-sm leading-relaxed text-[#667085]">
              <p>
                Nextrade AI, built by Meril &amp; NEXORA Labs, is an informational financial intelligence platform and simulated paper-trading simulator. It is not a registered broker-dealer, investment advisor, or fiduciary in India (SEBI), the United States (SEC/FINRA), or any other jurisdiction.
              </p>
              <p>
                Nothing presented on the Nextrade AI website or inside the browser workspace constitutes personalized investment advice, a solicitation to buy or sell securities, or any guarantee of financial returns.
              </p>
              <p>
                Market quotes, exchange indices, ETFs, crypto rates, and forex values originate from public upstream adapters and L2 cache layers with explicit LIVE, DELAYED, CACHED, or UNAVAILABLE labels.
              </p>
            </div>
          </>
        )}

        <DisclosureNotice
          label="Security & Governance"
          text="Review how server-side API keys and browser-local storage are handled on the Security page or inspect our Privacy Policy."
        />
      </div>
    </SitePageShell>
  );
};
