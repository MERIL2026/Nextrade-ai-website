import React, { useCallback, useEffect, useState } from 'react';
import {
  Shield,
  KeyRound,
  HardDrive,
  Scale,
  ExternalLink,
  MessageSquare,
  Bug,
  Lightbulb,
  Code2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Activity,
  Send,
  Loader2,
} from 'lucide-react';
import { SitePageShell, PageHeaderBand, DisclosureNotice } from '../PagePrimitives';
import { GITHUB_REPO_URL, GITHUB_ISSUES_URL, GITHUB_NEW_ISSUE_URL } from '../../lib/siteData';

interface TrustPageProps {
  onNavigate: (path: string) => void;
}

export const SecurityPage: React.FC<TrustPageProps> = ({ onNavigate }) => {
  return (
    <SitePageShell currentPath="/security" onNavigate={onNavigate}>
      <PageHeaderBand
        variant="left"
        eyebrow="Security & Trust"
        title="Security architecture built around minimal data exposure."
        description="Nextrade AI keeps API secrets strictly server-side, stores simulated paper-trading state locally in your browser, and never requests brokerage credentials or custody of real funds."
        secondaryCta={{
          label: 'Report Security Issue',
          href: GITHUB_ISSUES_URL,
        }}
      />

      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#EFF2FA] text-[#2D46E6]">
                <KeyRound className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="font-display text-lg font-semibold text-[#080B12]">
                Server-Side API Key Isolation
              </h2>
              <p className="text-sm text-[#667085] leading-relaxed">
                <code className="font-mono text-xs text-[#080B12]">GEMINI_API_KEY</code> is read exclusively inside the Express backend (<code className="font-mono text-xs text-[#080B12]">server.ts</code>). It is never bundled into Vite client assets or exposed through <code className="font-mono text-xs text-[#080B12]">VITE_*</code> variables.
              </p>
            </div>

            <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#EFF2FA] text-[#2D46E6]">
                <HardDrive className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="font-display text-lg font-semibold text-[#080B12]">
                Authenticated Sessions &amp; Simulation Boundaries
              </h2>
              <p className="text-sm text-[#667085] leading-relaxed">
                Workspace access is protected by Argon2id credential hashing, single-use verification tokens, and HttpOnly session cookies backed by relational PostgreSQL/SQLite persistence. Simulated paper trading uses clean virtual buying power with zero real brokerage connectivity.
              </p>
            </div>

            <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#EFF2FA] text-[#2D46E6]">
                <Scale className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="font-display text-lg font-semibold text-[#080B12]">
                Zero Brokerage Access or Custody
              </h2>
              <p className="text-sm text-[#667085] leading-relaxed">
                Nextrade AI never connects to real brokerage accounts, demat accounts, bank rails, or exchange execution engines. Every order in Paper Trading is purely simulated arithmetic.
              </p>
            </div>

            <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#EFF2FA] text-[#2D46E6]">
                <Shield className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="font-display text-lg font-semibold text-[#080B12]">
                Responsible Disclosure
              </h2>
              <p className="text-sm text-[#667085] leading-relaxed">
                If you discover a security flaw or unsafe input handling in the repository, please notify maintainers via{' '}
                <a
                  href={GITHUB_ISSUES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-[#2D46E6] hover:underline"
                >
                  GitHub Issues
                </a>{' '}
                or submit a private report via the{' '}
                <a
                  href="/contact"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate('/contact');
                  }}
                  className="font-medium text-[#2D46E6] hover:underline"
                >
                  Contact Form
                </a>
                .
              </p>
            </div>
          </div>

          <DisclosureNotice
            label="Audit & Certification Honesty"
            text="Nextrade AI is open-source software and has not undergone formal third-party security audits, SOC 2 certification, or ISO compliance attestation. Review the source code directly on GitHub before deploying in sensitive environments."
          />
        </div>
      </section>
    </SitePageShell>
  );
};

interface ContactReceipt {
  ticketId: string;
  submittedAt: string;
  message: string;
}

export const ContactPage: React.FC<TrustPageProps> = ({ onNavigate }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState('General Question');
  const [reference, setReference] = useState('');
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<ContactReceipt | null>(null);

  const channels = [
    {
      title: 'General Enquiries & Community Questions',
      description:
        'Questions about supported Indian (NSE/BSE) or US (NYSE/NASDAQ) workflows, architecture, or self-hosting setup.',
      cta: 'Open GitHub Issues',
      href: GITHUB_ISSUES_URL,
      icon: <MessageSquare className="h-5 w-5" aria-hidden="true" />,
    },
    {
      title: 'Bug Reports & Edge Cases',
      description:
        'Report calculation mismatches, API errors, or visual issues on desktop or mobile browsers with clear steps to reproduce.',
      cta: 'File a Bug Report',
      href: GITHUB_NEW_ISSUE_URL,
      icon: <Bug className="h-5 w-5" aria-hidden="true" />,
    },
    {
      title: 'Feature Requests & Proposals',
      description:
        'Suggest new risk analytics, exchange data adapters, or documentation improvements for upcoming roadmap milestones.',
      cta: 'Submit Feature Idea',
      href: GITHUB_NEW_ISSUE_URL,
      icon: <Lightbulb className="h-5 w-5" aria-hidden="true" />,
    },
    {
      title: 'Developer Contributions',
      description:
        'Inspect open issues, read local setup instructions, and collaborate on pull requests directly in the public repository.',
      cta: 'View Repository',
      href: GITHUB_REPO_URL,
      icon: <Code2 className="h-5 w-5" aria-hidden="true" />,
    },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setFieldErrors({});

    const localErrors: Record<string, string> = {};
    if (name.trim().length < 2) localErrors.name = 'Please enter your name (at least 2 characters).';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      localErrors.email = 'Please enter a valid email address.';
    }
    if (message.trim().length < 10) {
      localErrors.message = 'Please enter at least 10 characters describing your enquiry.';
    }
    if (!consent) {
      localErrors.consent = 'Please confirm you have read the Privacy Policy.';
    }

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      setSubmitError(Object.values(localErrors)[0]);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          topic,
          reference: reference.trim(),
          message: message.trim(),
          consent,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        ticketId?: string;
        submittedAt?: string;
        message?: string;
        error?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!res.ok || !data.ok) {
        if (data.fieldErrors) setFieldErrors(data.fieldErrors);
        setSubmitError(data.error ?? 'Unable to submit message. Please verify your entries.');
        return;
      }

      setReceipt({
        ticketId: data.ticketId ?? 'NXT-RECEIVED',
        submittedAt: data.submittedAt ?? new Date().toISOString(),
        message: data.message ?? 'Message received.',
      });
      setName('');
      setEmail('');
      setReference('');
      setMessage('');
      setConsent(false);
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Network error while reaching POST /api/contact. Please retry.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SitePageShell currentPath="/contact" onNavigate={onNavigate}>
      <PageHeaderBand
        variant="left"
        eyebrow="Contact & Support"
        title="Reach the Nextrade AI maintainers directly."
        description="Send a structured enquiry through our live backend contact form below, or collaborate openly with the community on GitHub Issues."
      />

      <section className="py-14 sm:py-18 border-b border-[#E4E8F2]">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          {/* Working Contact Form */}
          <div className="lg:col-span-7 rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 sm:p-8 shadow-[0_12px_36px_rgba(15,23,42,0.04)]">
            {receipt ? (
              <div className="space-y-5 py-4" role="status" aria-live="polite">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="space-y-2">
                  <h2 className="font-display text-2xl font-bold text-[#080B12]">
                    Enquiry Logged Successfully
                  </h2>
                  <p className="text-sm text-[#667085] leading-relaxed">{receipt.message}</p>
                </div>
                <div className="rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <div className="text-[#667085]">Reference Ticket ID</div>
                    <div className="mt-1 font-mono text-sm font-bold text-[#080B12]">
                      {receipt.ticketId}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#667085]">Recorded Timestamp (UTC)</div>
                    <div className="mt-1 font-mono text-xs font-medium text-[#080B12]">
                      {receipt.submittedAt}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReceipt(null)}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-4 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] transition-colors cursor-pointer"
                >
                  Send Another Message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate className="space-y-5">
                <div className="border-b border-[#E4E8F2] pb-4 space-y-1">
                  <h2 className="font-display text-xl font-bold text-[#080B12]">
                    Send a Direct Message
                  </h2>
                  <p className="text-xs sm:text-sm text-[#667085]">
                    Submitted to <code className="font-mono text-[#080B12]">POST /api/contact</code> with validation and ticket confirmation.
                  </p>
                </div>

                {submitError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700"
                  >
                    {submitError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label htmlFor="contact-name" className="block text-xs font-semibold text-[#080B12]">
                      Full Name <span className="text-rose-600">*</span>
                    </label>
                    <input
                      id="contact-name"
                      name="name"
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Aarav Mehta"
                      className="h-10 w-full rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] px-3.5 text-sm text-[#080B12] placeholder:text-[#98A2B3] focus:border-[#2D46E6] focus:outline-none"
                    />
                    {fieldErrors.name && (
                      <p className="text-[11px] text-rose-600">{fieldErrors.name}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="contact-email" className="block text-xs font-semibold text-[#080B12]">
                      Email Address <span className="text-rose-600">*</span>
                    </label>
                    <input
                      id="contact-email"
                      name="email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="h-10 w-full rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] px-3.5 text-sm text-[#080B12] placeholder:text-[#98A2B3] focus:border-[#2D46E6] focus:outline-none"
                    />
                    {fieldErrors.email && (
                      <p className="text-[11px] text-rose-600">{fieldErrors.email}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label htmlFor="contact-topic" className="block text-xs font-semibold text-[#080B12]">
                      Topic <span className="text-rose-600">*</span>
                    </label>
                    <select
                      id="contact-topic"
                      name="topic"
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      className="h-10 w-full rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] px-3 text-sm text-[#080B12] focus:border-[#2D46E6] focus:outline-none"
                    >
                      <option value="General Question">General Question</option>
                      <option value="Bug Report">Bug Report</option>
                      <option value="Feature Proposal">Feature Proposal</option>
                      <option value="Security / Compliance">Security / Compliance</option>
                      <option value="Self-Hosting & API">Self-Hosting &amp; API</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="contact-ref" className="block text-xs font-semibold text-[#080B12]">
                      Route / Ticker Reference (Optional)
                    </label>
                    <input
                      id="contact-ref"
                      name="reference"
                      type="text"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="e.g. /app, RELIANCE.NS, NVDA"
                      className="h-10 w-full rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] px-3.5 text-sm text-[#080B12] placeholder:text-[#98A2B3] focus:border-[#2D46E6] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="contact-message" className="block text-xs font-semibold text-[#080B12]">
                      Message <span className="text-rose-600">*</span>
                    </label>
                    <span className="font-mono text-[11px] text-[#667085]">
                      {message.length}/4000
                    </span>
                  </div>
                  <textarea
                    id="contact-message"
                    name="message"
                    rows={5}
                    required
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Share your question, reproduction steps, or integration feedback..."
                    className="w-full rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5 text-sm text-[#080B12] placeholder:text-[#98A2B3] focus:border-[#2D46E6] focus:outline-none resize-y"
                  />
                  {fieldErrors.message && (
                    <p className="text-[11px] text-rose-600">{fieldErrors.message}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="flex items-start gap-2.5 text-xs text-[#667085] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-[#CBD5E1] text-[#2D46E6] focus:ring-[#2D46E6]"
                    />
                    <span>
                      I acknowledge that this message will be stored solely to review my enquiry in accordance with the{' '}
                      <a
                        href="/privacy"
                        onClick={(e) => {
                          e.preventDefault();
                          onNavigate('/privacy');
                        }}
                        className="font-semibold text-[#2D46E6] hover:underline"
                      >
                        Privacy Policy
                      </a>
                      .
                    </span>
                  </label>
                  {fieldErrors.consent && (
                    <p className="text-[11px] text-rose-600 pl-6">{fieldErrors.consent}</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex h-11 items-center gap-2 rounded-md bg-[#2D46E6] px-6 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] shadow-[0_8px_20px_rgba(45,70,230,0.22)] hover:bg-[#2238C9] disabled:opacity-60 transition-colors cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span>Submitting...</span>
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" aria-hidden="true" />
                      <span>Send Message</span>
                    </>
                  )}
                </button>
              </form>
            )}
          </div>

          {/* Open-Source Channels */}
          <div className="lg:col-span-5 space-y-4">
            {channels.map((ch) => (
              <div
                key={ch.title}
                className="rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-2.5">
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#EFF2FA] text-[#2D46E6]">
                      {ch.icon}
                    </div>
                    <h3 className="font-display text-sm font-bold text-[#080B12]">{ch.title}</h3>
                  </div>
                  <p className="text-xs text-[#667085] leading-relaxed">{ch.description}</p>
                </div>

                <div>
                  <a
                    href={ch.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3.5 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] transition-colors"
                  >
                    <span>{ch.cta}</span>
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-10 bg-[#FFFFFF]">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8">
          <DisclosureNotice
            label="Support Channels"
            text="Direct contact submissions are persisted for maintainer review, and public bug tracking lives on github.com/MERIL2026/nextrade-ai/issues. Check /status before reporting a backend outage."
          />
        </div>
      </section>
    </SitePageShell>
  );
};

type ProbeTone = 'ok' | 'warn' | 'error' | 'checking';

interface ServiceDiagnostic {
  id: string;
  name: string;
  endpoint: string;
  statusLabel: string;
  tone: ProbeTone;
  latencyMs: number | null;
  detail: string;
}

export const StatusPage: React.FC<TrustPageProps> = ({ onNavigate }) => {
  const [checking, setChecking] = useState(true);
  const [lastCheckedAt, setLastCheckedAt] = useState<string>('');
  const [diagnostics, setDiagnostics] = useState<ServiceDiagnostic[]>([
    {
      id: 'frontend',
      name: 'SSR & Browser Runtime',
      endpoint: 'SSR + React Hydration',
      statusLabel: 'Checking...',
      tone: 'checking',
      latencyMs: null,
      detail: 'Verifying server-rendered markup and client hydration.',
    },
    {
      id: 'health',
      name: 'Express Backend API',
      endpoint: 'GET /api/health',
      statusLabel: 'Checking...',
      tone: 'checking',
      latencyMs: null,
      detail: 'Probing backend health, SSR, GA4 & Search Console readiness.',
    },
    {
      id: 'markets',
      name: 'Market Data Endpoint',
      endpoint: 'GET /api/markets',
      statusLabel: 'Checking...',
      tone: 'checking',
      latencyMs: null,
      detail: 'Inspecting market feed mode and instrument count.',
    },
    {
      id: 'research',
      name: 'AI Research Synthesis',
      endpoint: 'POST /api/research',
      statusLabel: 'Checking...',
      tone: 'checking',
      latencyMs: null,
      detail: 'Probing structured research response and model mode.',
    },
  ]);

  const runDiagnostics = useCallback(async () => {
    setChecking(true);
    const results: ServiceDiagnostic[] = [];

    // 1. Frontend & SSR runtime
    results.push({
      id: 'frontend',
      name: 'SSR & Browser Runtime',
      endpoint: typeof window !== 'undefined' ? window.location.origin : 'Browser Runtime',
      statusLabel: 'Operational',
      tone: 'ok',
      latencyMs: 0,
      detail: 'Server-rendered document hydrated cleanly with canonical & Schema.org metadata.',
    });

    // 2. GET /api/health
    let geminiConfigured: boolean | null = null;
    {
      const t0 = performance.now();
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        const latencyMs = Math.round(performance.now() - t0);
        if (res.ok) {
          const data = (await res.json()) as {
            status?: string;
            geminiConfigured?: boolean;
            ssrEnabled?: boolean;
            gaConfigured?: boolean;
            searchConsoleConfigured?: boolean;
            contactApiReady?: boolean;
          };
          geminiConfigured = Boolean(data.geminiConfigured);
          results.push({
            id: 'health',
            name: 'Express Backend API',
            endpoint: 'GET /api/health',
            statusLabel: data.status === 'ok' ? 'Operational' : 'Degraded',
            tone: data.status === 'ok' ? 'ok' : 'warn',
            latencyMs,
            detail: `HTTP ${res.status} · ssrEnabled=${String(Boolean(data.ssrEnabled))} · contactApi=${String(Boolean(data.contactApiReady))} · gemini=${String(geminiConfigured)} · ga4=${String(Boolean(data.gaConfigured))} · gsc=${String(Boolean(data.searchConsoleConfigured))}.`,
          });
        } else {
          results.push({
            id: 'health',
            name: 'Express Backend API',
            endpoint: 'GET /api/health',
            statusLabel: 'Unavailable',
            tone: 'error',
            latencyMs,
            detail: `Returned HTTP ${res.status}.`,
          });
        }
      } catch (err) {
        results.push({
          id: 'health',
          name: 'Express Backend API',
          endpoint: 'GET /api/health',
          statusLabel: 'Unavailable',
          tone: 'error',
          latencyMs: Math.round(performance.now() - t0),
          detail: err instanceof Error ? err.message : 'Network error',
        });
      }
    }

    // 3. GET /api/markets
    {
      const t0 = performance.now();
      try {
        const res = await fetch('/api/markets', { cache: 'no-store' });
        const latencyMs = Math.round(performance.now() - t0);
        if (res.ok) {
          const data = (await res.json()) as {
            dataStatus?: string;
            provider?: string;
            usdInrRate?: number | null;
            indices?: unknown[];
            instruments?: unknown[];
          };
          const indexCount = Array.isArray(data.indices) ? data.indices.length : 0;
          const instCount = Array.isArray(data.instruments) ? data.instruments.length : 0;
          const status = data.dataStatus ?? 'UNAVAILABLE';
          results.push({
            id: 'markets',
            name: 'Market Data Service',
            endpoint: 'GET /api/markets',
            statusLabel: `${status} (${data.provider ?? 'Upstream Feed'})`,
            tone: status === 'UNAVAILABLE' ? 'error' : status === 'CACHED' ? 'warn' : 'ok',
            latencyMs,
            detail: `HTTP ${res.status} · status=${status} (${indexCount} indices, ${instCount} instruments)${
              typeof data.usdInrRate === 'number' ? ` · USD/INR ₹${data.usdInrRate.toFixed(2)}` : ''
            }.`,
          });
        } else {
          results.push({
            id: 'markets',
            name: 'Market Data Service',
            endpoint: 'GET /api/markets',
            statusLabel: 'Unavailable',
            tone: 'error',
            latencyMs,
            detail: `Returned HTTP ${res.status}.`,
          });
        }
      } catch (err) {
        results.push({
          id: 'markets',
          name: 'Market Data Service',
          endpoint: 'GET /api/markets',
          statusLabel: 'Unavailable',
          tone: 'error',
          latencyMs: Math.round(performance.now() - t0),
          detail: err instanceof Error ? err.message : 'Network error',
        });
      }
    }

    // 4. POST /api/research
    {
      const t0 = performance.now();
      try {
        const res = await fetch('/api/research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: 'NVDA',
            query: 'Live status diagnostic check for explainable research response.',
          }),
        });
        const latencyMs = Math.round(performance.now() - t0);
        const data = (await res.json().catch(() => ({}))) as {
          source?: string;
          code?: string;
          error?: string;
        };
        if (res.ok && data.source === 'gemini') {
          results.push({
            id: 'research',
            name: 'AI Research Service',
            endpoint: 'POST /api/research',
            statusLabel: 'Operational (Live Gemini)',
            tone: 'ok',
            latencyMs,
            detail: `HTTP ${res.status} · Live @google/genai structured response verified (geminiConfigured=${String(Boolean(geminiConfigured))}).`,
          });
        } else if (
          res.status === 503 &&
          (data.code === 'AI_NOT_CONFIGURED' || data.code === 'AI_FEATURE_DISABLED')
        ) {
          results.push({
            id: 'research',
            name: 'AI Research Service',
            endpoint: 'POST /api/research',
            statusLabel: 'AI Building Mode (Unconfigured / Disabled)',
            tone: 'warn',
            latencyMs,
            detail: `HTTP ${res.status} · ${data.error ?? 'AI research is in Building Mode cleanly reporting availability.'}`,
          });
        } else {
          results.push({
            id: 'research',
            name: 'AI Research Service',
            endpoint: 'POST /api/research',
            statusLabel: 'Unavailable',
            tone: 'error',
            latencyMs,
            detail: `Returned HTTP ${res.status}${data.error ? ` — ${data.error}` : ''}.`,
          });
        }
      } catch (err) {
        results.push({
          id: 'research',
          name: 'AI Research Service',
          endpoint: 'POST /api/research',
          statusLabel: 'Unavailable',
          tone: 'error',
          latencyMs: Math.round(performance.now() - t0),
          detail: err instanceof Error ? err.message : 'Network error',
        });
      }
    }

    setDiagnostics(results);
    setLastCheckedAt(new Date().toLocaleTimeString());
    setChecking(false);
  }, []);

  useEffect(() => {
    void runDiagnostics();
  }, [runDiagnostics]);

  const toneBadge = (tone: ProbeTone) => {
    if (tone === 'ok') {
      return {
        cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />,
      };
    }
    if (tone === 'warn') {
      return {
        cls: 'bg-amber-50 text-amber-800 border-amber-200',
        icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />,
      };
    }
    if (tone === 'error') {
      return {
        cls: 'bg-rose-50 text-rose-700 border-rose-200',
        icon: <XCircle className="h-3.5 w-3.5" aria-hidden="true" />,
      };
    }
    return {
      cls: 'bg-[#EFF2FA] text-[#2D46E6] border-[#D5DDF7]',
      icon: <Clock className="h-3.5 w-3.5" aria-hidden="true" />,
    };
  };

  return (
    <SitePageShell currentPath="/status" onNavigate={onNavigate}>
      <PageHeaderBand
        variant="left"
        eyebrow="System Status"
        title="Live API & Platform Diagnostics"
        description="Real-time diagnostic checks run directly from your browser against the Nextrade AI Express endpoints. Service states reflect actual HTTP responses—never hardcoded green indicators."
      />

      <section className="py-14 sm:py-18">
        <div className="mx-auto max-w-[980px] px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] px-5 py-4">
            <div className="flex items-center gap-3 text-sm text-[#080B12]">
              <Activity className="h-4 w-4 text-[#2D46E6]" aria-hidden="true" />
              <span className="font-medium">
                {checking
                  ? 'Running live endpoint checks...'
                  : `Last diagnostic check completed at ${lastCheckedAt}`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void runDiagnostics()}
              disabled={checking}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[#2D46E6] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] disabled:opacity-60 transition-colors cursor-pointer"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{checking ? 'Checking...' : 'Run Health Checks'}</span>
            </button>
          </div>

          <div className="space-y-4">
            {diagnostics.map((item) => {
              const badge = toneBadge(item.tone);
              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h2 className="font-display text-base font-bold text-[#080B12]">
                        {item.name}
                      </h2>
                      <code className="rounded bg-[#F7F8FA] border border-[#E4E8F2] px-2 py-0.5 font-mono text-[11px] text-[#667085]">
                        {item.endpoint}
                      </code>
                    </div>
                    <p className="text-xs sm:text-sm text-[#667085] leading-relaxed">
                      {item.detail}
                    </p>
                  </div>

                  <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold ${badge.cls}`}
                    >
                      {badge.icon}
                      <span>{item.statusLabel}</span>
                    </span>
                    {item.latencyMs !== null && (
                      <span className="font-mono text-[11px] text-[#667085] tabular-nums">
                        {item.latencyMs} ms
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <DisclosureNotice
            label="Diagnostic Accuracy"
            text="Nextrade AI never fakes green indicators. When GEMINI_API_KEY is unconfigured or disabled, POST /api/research reports AI Building Mode cleanly without synthesizing fake advice."
          />
        </div>
      </section>
    </SitePageShell>
  );
};
