import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Cookie, X } from 'lucide-react';
import {
  CookieConsentChoice,
  getStoredCookieConsent,
  saveCookieConsent,
  subscribeCookieConsent,
  syncGtagConsent,
} from '../lib/analytics';
import { FINTECH_EASE } from '../lib/motionPrimitives';

interface CookieConsentBannerProps {
  onNavigate: (path: string) => void;
}

export const CookieConsentBanner: React.FC<CookieConsentBannerProps> = ({ onNavigate }) => {
  const [mounted, setMounted] = useState(false);
  const [choice, setChoice] = useState<CookieConsentChoice | null>(null);

  useEffect(() => {
    const stored = getStoredCookieConsent();
    setChoice(stored);
    if (stored) {
      syncGtagConsent(stored);
    }
    setMounted(true);
    return subscribeCookieConsent((next) => setChoice(next));
  }, []);

  if (!mounted || choice !== null) return null;

  return (
    <AnimatePresence>
      <motion.aside
        role="region"
        aria-label="Cookie and storage preferences"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        transition={{ duration: 0.25, ease: FINTECH_EASE }}
        className="fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-[440px] z-40 rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-4 sm:p-5 shadow-[0_20px_50px_rgba(8,11,18,0.14)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[#2D46E6]">
            <Cookie className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Cookies &amp; Privacy</span>
          </div>
          <button
            type="button"
            onClick={() => saveCookieConsent('essential')}
            aria-label="Dismiss cookie notice with essential storage only"
            className="rounded p-1 text-[#667085] hover:bg-[#F7F8FA] hover:text-[#080B12] cursor-pointer"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-[#667085]">
          Nextrade AI uses essential browser <code className="font-mono text-[#080B12]">localStorage</code> for your simulated paper-trading preferences and optional Google Analytics 4 telemetry when permitted.{' '}
          <a
            href="/cookies"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('/cookies');
            }}
            className="font-semibold text-[#2D46E6] hover:underline"
          >
            Read Cookies Policy
          </a>
          .
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => saveCookieConsent('essential')}
            className="inline-flex h-9 items-center justify-center rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3.5 text-xs font-semibold text-[#080B12] hover:border-[#CBD5E1] cursor-pointer"
          >
            Essential Only
          </button>
          <button
            type="button"
            onClick={() => saveCookieConsent('accepted')}
            className="inline-flex h-9 items-center justify-center rounded-md bg-[#2D46E6] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer"
          >
            Accept Analytics
          </button>
        </div>
      </motion.aside>
    </AnimatePresence>
  );
};
