import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ArrowUpRight } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { FOOTER_COLUMNS } from '../lib/siteData';

interface FaqAndFooterProps {
  onNavigate: (path: string) => void;
}

const FAQ_ITEMS = [
  {
    q: 'What is Nextrade AI and who builds it?',
    a: 'Nextrade AI is a free and open-source financial intelligence platform built by Meril & NEXORA Labs. It combines real multi-asset market data, clean portfolio tracking, simulated paper trading, and evolving AI intelligence directly in your browser.',
  },
  {
    q: 'Is Nextrade AI completely free?',
    a: 'Yes. Nextrade AI is 100% free and open source under Apache-2.0, with zero paid subscriptions, zero locked Pro tiers, and zero paywalls.',
  },
  {
    q: 'Which financial markets and asset classes does it support?',
    a: 'Nextrade AI aggregates real live and delayed quotes across Indian equities (NSE/BSE), US equities (NYSE/NASDAQ), global benchmark indices, ETFs, crypto assets, and USD/INR forex rates.',
  },
  {
    q: 'Where do market prices and historical charts come from?',
    a: 'Market quotes and OHLC bars are retrieved on the backend from real upstream adapters (Yahoo Finance, CoinGecko, and Frankfurter ECB FX, plus optional Finnhub/Alpha Vantage/Twelve Data keys) with L2 database caching and explicit LIVE, DELAYED, CACHED, or UNAVAILABLE labels.',
  },
  {
    q: 'Does Paper Trading execute real-money brokerage orders?',
    a: 'No. Nextrade AI is not a broker and does not connect to real brokerage custody accounts. Paper Trading executes simulated BUY and SELL orders funded by virtual buying power ($100,000 starting USD) against real market prices and live USD/INR conversion.',
  },
  {
    q: 'What is the status of AI Financial Intelligence?',
    a: 'When GEMINI_API_KEY is configured on the server, live structured synthesis runs through Google Gemini grounded in fetched market prices. Advanced multi-module AI Market Analysis, AI Portfolio Intelligence, and Predictive Analytics are currently in AI Building Mode—and we never return fake placeholder AI responses when AI is unconfigured.',
  },
  {
    q: 'Is Nextrade AI financial advice?',
    a: 'No. All market feeds, analytics, simulated paper trades, and AI outputs are strictly informational and educational and never constitute investment, tax, or legal advice.',
  },
];

export const SiteFooter: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  return (
    <footer className="relative bg-[#2D46E6] text-[#FFFFFF] pt-14 pb-10 overflow-hidden">
      <svg
        aria-hidden="true"
        viewBox="0 0 600 260"
        fill="none"
        className="pointer-events-none absolute -left-16 bottom-0 h-[240px] w-auto opacity-15"
      >
        <path d="M20 180 L220 80 L420 180 L220 280 Z" stroke="#FFFFFF" strokeWidth="1.5" />
        <path d="M120 150 L240 90 L350 145 L230 205 Z" stroke="#FFFFFF" strokeWidth="1.5" />
        <path d="M260 40 L310 15 L340 95 L290 120 Z" stroke="#FFFFFF" strokeWidth="1.5" />
      </svg>

      <div className="relative mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 border-b border-white/20 pb-12">
          <div className="lg:col-span-4 space-y-4">
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('/');
              }}
              className="inline-flex items-center"
              aria-label="Nextrade AI Home"
            >
              <BrandLogo variant="dark" symbolHeightClass="h-4.5" />
            </a>
            <p className="font-display text-sm font-semibold text-white">
              Nextrade AI is built by Meril &amp; NEXORA Labs.
            </p>
            <p className="max-w-xs text-xs leading-relaxed text-white/80">
              Free and open-source AI-powered financial intelligence platform for exploring global stocks, indices, ETFs, crypto, and forex markets.
            </p>
          </div>

          <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-8">
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.heading} className="space-y-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-white">
                  {col.heading}
                </h3>
                <ul className="space-y-2.5 text-xs text-white/80">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      {link.external ? (
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 hover:text-white transition-colors"
                        >
                          <span>{link.label}</span>
                          <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                        </a>
                      ) : (
                        <a
                          href={link.href}
                          onClick={(e) => {
                            e.preventDefault();
                            onNavigate(link.href);
                          }}
                          className="hover:text-white transition-colors"
                        >
                          {link.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between text-[11.5px] text-white/80">
          <p>
            © {new Date().getFullYear()} Nextrade AI · Built by Meril &amp; NEXORA Labs · Free and open-source software (Apache-2.0).
          </p>
          <p className="max-w-xl sm:text-right">
            Disclaimer: Market quotes carry explicit provider status indicators (LIVE / DELAYED / CACHED). Paper trading is simulated execution only; Nextrade AI is not a broker or investment advisor.
          </p>
        </div>
      </div>
    </footer>
  );
};

export const FaqAndFooter: React.FC<FaqAndFooterProps> = ({ onNavigate }) => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <>
      <section id="faq" className="border-t border-[#E4E8F2] bg-[#FFFFFF] py-20 sm:py-24">
        <div className="mx-auto max-w-[900px] px-4 sm:px-6 lg:px-8">
          <div className="mb-10">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-[#2D46E6]">
              Frequently Asked Questions
            </p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-[-0.02em] text-[#080B12]">
              Clarity on platform scope and data transparency.
            </h2>
          </div>

          <div className="divide-y divide-[#E4E8F2] border-y border-[#E4E8F2]">
            {FAQ_ITEMS.map((item, idx) => {
              const isOpen = openIndex === idx;
              return (
                <div key={item.q}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenIndex(isOpen ? null : idx)}
                    className="flex w-full items-center justify-between gap-6 py-5 text-left transition-colors hover:text-[#2D46E6] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2D46E6]"
                  >
                    <span className="font-display text-[15.5px] font-semibold text-[#080B12]">
                      {item.q}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-[#667085] transition-transform duration-200 ${
                        isOpen ? 'rotate-180 text-[#2D46E6]' : ''
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="pb-5 pr-8 text-sm leading-relaxed text-[#667085]">
                          {item.a}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <SiteFooter onNavigate={onNavigate} />
    </>
  );
};
