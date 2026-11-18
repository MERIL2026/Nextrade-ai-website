import React from 'react';
import { ArrowLeft, ShieldCheck, Lock, Globe } from 'lucide-react';
import { BrandLogo } from '../BrandLogo';

interface AuthLayoutProps {
  onNavigate: (path: string) => void;
  eyebrow: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({
  onNavigate,
  eyebrow,
  title,
  subtitle,
  children,
}) => {
  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#080B12] flex flex-col">
      {/* Minimal editorial header */}
      <header className="border-b border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('/');
            }}
            className="inline-flex items-center focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2D46E6] rounded-sm"
            aria-label="Nextrade AI Home"
          >
            <BrandLogo variant="light" symbolHeightClass="h-4.5" />
          </a>

          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('/');
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#667085] hover:text-[#080B12] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Back to Nextrade AI</span>
          </a>
        </div>
      </header>

      {/* Split Editorial Auth Grid */}
      <main className="flex-1 bg-[#F7F8FA]">
        <div className="mx-auto max-w-[1160px] px-4 sm:px-6 lg:px-8 pt-10 pb-24 sm:pt-14 sm:pb-28">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
            {/* Left Identity & Security Trust Column (below form on mobile) */}
            <aside className="order-2 lg:order-1 lg:col-span-5 space-y-6 pt-2">
              <div className="space-y-3">
                <p className="font-mono text-xs font-semibold uppercase tracking-[0.1em] text-[#2D46E6]">
                  {eyebrow}
                </p>
                <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-[-0.03em] text-[#080B12] leading-[1.12]">
                  {title}
                </h1>
                <p className="text-sm sm:text-base text-[#667085] leading-relaxed">
                  {subtitle}
                </p>
              </div>

              {/* Subtle abstract market-dispersion SVG motif */}
              <div
                aria-hidden="true"
                className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-2.5"
              >
                <div className="flex items-center justify-between text-[11px] font-mono text-[#667085]">
                  <span>CROSS-MARKET DISPERSION INDEX</span>
                  <span className="text-[#2D46E6] font-semibold">NSE · BSE · NYSE</span>
                </div>
                <svg
                  viewBox="0 0 360 64"
                  className="w-full h-14 overflow-visible"
                  fill="none"
                >
                  <line x1="0" y1="54" x2="360" y2="54" stroke="#EFF2FA" strokeWidth="1" />
                  <line x1="0" y1="30" x2="360" y2="30" stroke="#EFF2FA" strokeWidth="1" strokeDasharray="3 3" />
                  <path
                    d="M0 48 C 42 46, 68 38, 108 40 C 148 42, 178 24, 218 28 C 258 32, 294 14, 360 10"
                    stroke="#2D46E6"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M0 52 C 50 50, 82 47, 125 45 C 165 43, 210 38, 255 34 C 296 30, 326 26, 360 24"
                    stroke="#CBD5E1"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <circle cx="218" cy="28" r="3" fill="#2D46E6" />
                  <circle cx="360" cy="10" r="3" fill="#080B12" />
                </svg>
              </div>

              <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] divide-y divide-[#E4E8F2]">
                <div className="p-4 flex items-start gap-3">
                  <div className="mt-0.5 rounded-md bg-[#EFF2FA] p-2 text-[#2D46E6]">
                    <Lock className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-[#080B12]">
                      Argon2id &amp; HttpOnly Sessions
                    </div>
                    <p className="mt-0.5 text-xs text-[#667085] leading-relaxed">
                      Passwords are salted and hashed with Argon2id. Sessions use SHA-256 hashed opaque tokens inside HttpOnly cookies.
                    </p>
                  </div>
                </div>

                <div className="p-4 flex items-start gap-3">
                  <div className="mt-0.5 rounded-md bg-[#EFF2FA] p-2 text-[#2D46E6]">
                    <Globe className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-[#080B12]">
                      Cross-Market Intelligence Workspace
                    </div>
                    <p className="mt-0.5 text-xs text-[#667085] leading-relaxed">
                      Access NSE/BSE and US equity exploration, explainable Gemini research, risk metrics, and paper trading.
                    </p>
                  </div>
                </div>

                <div className="p-4 flex items-start gap-3">
                  <div className="mt-0.5 rounded-md bg-[#EFF2FA] p-2 text-[#2D46E6]">
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-[#080B12]">
                      Informational Platform Boundary
                    </div>
                    <p className="mt-0.5 text-xs text-[#667085] leading-relaxed">
                      No real-money deposits, no brokerage custody, and no automated trade execution.
                    </p>
                  </div>
                </div>
              </div>
            </aside>

            {/* Right Interactive Auth Card (above fold on mobile) */}
            <div className="order-1 lg:order-2 lg:col-span-7">
              <div className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 sm:p-8 shadow-[0_14px_40px_rgba(15,23,42,0.05)]">
                {children}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
