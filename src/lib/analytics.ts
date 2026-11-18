export type CookieConsentChoice = 'accepted' | 'essential';

export const COOKIE_CONSENT_STORAGE_KEY = 'nextrade_cookie_consent_v1';
const CONSENT_CHANGE_EVENT = 'nextrade-cookie-consent-changed';

declare global {
  interface Window {
    __NEXTRADE_GA_ID__?: string;
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function getStoredCookieConsent(): CookieConsentChoice | null {
  if (typeof window === 'undefined') return null;
  try {
    const val = localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (val === 'accepted' || val === 'essential') return val;
  } catch {
    // ignore storage errors
  }
  return null;
}

export function getMeasurementId(): string {
  if (typeof window !== 'undefined' && window.__NEXTRADE_GA_ID__) {
    return window.__NEXTRADE_GA_ID__;
  }
  const viteGaId = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_GA_MEASUREMENT_ID;
  return typeof viteGaId === 'string' ? viteGaId.trim() : '';
}

export function syncGtagConsent(choice: CookieConsentChoice) {
  if (typeof window === 'undefined') return;
  if (typeof window.gtag === 'function') {
    window.gtag('consent', 'update', {
      analytics_storage: choice === 'accepted' ? 'granted' : 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
  }
}

export function saveCookieConsent(choice: CookieConsentChoice) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, choice);
  } catch {
    // ignore storage errors
  }
  syncGtagConsent(choice);
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: choice }));
}

export function resetCookieConsent() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(COOKIE_CONSENT_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
  syncGtagConsent('essential');
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: null }));
}

export function subscribeCookieConsent(
  listener: (choice: CookieConsentChoice | null) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => listener(getStoredCookieConsent());
  window.addEventListener(CONSENT_CHANGE_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(CONSENT_CHANGE_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

export function trackPageView(pathname: string, title: string) {
  if (typeof window === 'undefined') return;
  const gaId = getMeasurementId();
  if (!gaId) return;
  if (getStoredCookieConsent() !== 'accepted') return;
  if (typeof window.gtag === 'function') {
    window.gtag('event', 'page_view', {
      page_title: title,
      page_path: pathname,
      page_location: window.location.href,
    });
  }
}
