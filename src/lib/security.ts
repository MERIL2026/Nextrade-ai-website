import { PaperHolding, PaperOrderRecord, PaperPortfolioState } from './portfolioEngine';

export const MAX_PAPER_ORDER_QUANTITY = 1_000_000;

/**
 * Normalizes and validates an internal SPA or HTTP redirect path so it can never
 * become a protocol-relative (`//evil.example`), external (`https://evil.example`),
 * or script (`javascript:...`) navigation target.
 */
export function sanitizeInternalPath(rawPath: string): string {
  if (typeof rawPath !== 'string') return '/';
  const trimmed = rawPath.replace(/[\x00-\x1f\x7f\\]/g, '').trim();
  if (!trimmed) return '/';

  // Reject explicit schemes before query/hash (e.g. http:, https:, javascript:, data:)
  const beforeQueryOrHash = trimmed.split(/[?#]/)[0];
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(beforeQueryOrHash) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return '/';
  }

  // Collapse any repeated leading or internal slashes into a single '/'
  const withSingleSlashes = trimmed.replace(/\/{2,}/g, '/');
  const ensuredLeading = withSingleSlashes.startsWith('/')
    ? withSingleSlashes
    : `/${withSingleSlashes}`;

  if (ensuredLeading.startsWith('//')) {
    return '/';
  }
  return ensuredLeading;
}

/**
 * Verifies a relative redirect target starts with exactly one '/' and contains
 * no control characters or backslashes.
 */
export function isSafeRelativeRedirect(target: string): boolean {
  if (typeof target !== 'string') return false;
  if (/[\x00-\x1f\x7f\\]/.test(target)) return false;
  return target.startsWith('/') && !target.startsWith('//');
}

/**
 * Serializes JSON safely for embedding inside HTML <script> elements by escaping
 * characters that could break out of a script block (`</script>`, `<!--`) or
 * break JS string parsing (`\u2028`, `\u2029`).
 */
export function safeJsonLdStringify(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Resolves a validated canonical base URL (`scheme://host[:port]`) without
 * trusting arbitrary Host / X-Forwarded-Host / X-Forwarded-Proto strings.
 */
export function sanitizeBaseUrl(
  configuredAppUrl: string | undefined,
  hostHeader: string | undefined,
  protoHeader: string | undefined,
  fallbackPort = 3000,
): string {
  const configured = (configuredAppUrl ?? '').trim();
  if (configured && configured !== 'MY_APP_URL') {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return `${parsed.protocol}//${parsed.host}`;
      }
    } catch {
      // fall through to validated header fallback
    }
  }

  const rawProto = (protoHeader ?? '').split(',')[0].trim().toLowerCase();
  const safeProto = rawProto === 'https' ? 'https' : 'http';

  const rawHost = (hostHeader ?? '').split(',')[0].trim();
  const hostMatch = /^([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)(?::(\d{1,5}))?$/.exec(
    rawHost,
  );

  if (hostMatch) {
    const portNum = hostMatch[2] ? Number(hostMatch[2]) : undefined;
    if (portNum === undefined || (portNum >= 1 && portNum <= 65535)) {
      return `${safeProto}://${rawHost}`;
    }
  }

  return `http://localhost:${fallbackPort}`;
}

/**
 * Strips ASCII control characters (`\x00-\x1f`, `\x7f`) and enforces a maximum
 * length. When `allowNewlines` is true, `\n` is preserved while `\r\n` is normalized.
 */
export function stripControlChars(
  input: string,
  maxLen: number,
  options: { allowNewlines?: boolean } = {},
): string {
  if (typeof input !== 'string') return '';
  let cleaned = input.replace(/\r\n?/g, options.allowNewlines ? '\n' : ' ');
  cleaned = options.allowNewlines
    ? cleaned.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '')
    : cleaned.replace(/[\x00-\x1f\x7f]/g, ' ');
  return cleaned.trim().slice(0, maxLen);
}

/**
 * Validates and sanitizes restored paper-portfolio JSON from localStorage so
 * corrupted or tampered numeric fields cannot produce NaN/Infinity UI crashes.
 */
export function sanitizePortfolioState(
  raw: unknown,
  fallback: PaperPortfolioState,
): PaperPortfolioState {
  if (!raw || typeof raw !== 'object') return fallback;
  const candidate = raw as Record<string, unknown>;

  if (
    typeof candidate.cashBalanceUsd !== 'number' ||
    !Number.isFinite(candidate.cashBalanceUsd) ||
    candidate.cashBalanceUsd < 0 ||
    candidate.cashBalanceUsd > 1_000_000_000
  ) {
    return fallback;
  }

  if (
    typeof candidate.realizedPnlUsd !== 'number' ||
    !Number.isFinite(candidate.realizedPnlUsd) ||
    Math.abs(candidate.realizedPnlUsd) > 1_000_000_000
  ) {
    return fallback;
  }

  if (!Array.isArray(candidate.holdings) || !Array.isArray(candidate.orders)) {
    return fallback;
  }

  const holdings: PaperHolding[] = [];
  for (const item of candidate.holdings.slice(0, 100)) {
    if (!item || typeof item !== 'object') return fallback;
    const h = item as Record<string, unknown>;
    const normalizedRegion = h.region === 'GLOBAL' ? (h.currency === 'INR' ? 'IN' : 'US') : h.region;
    if (
      typeof h.symbol !== 'string' ||
      !h.symbol.trim() ||
      typeof h.name !== 'string' ||
      typeof h.exchange !== 'string' ||
      (normalizedRegion !== 'IN' && normalizedRegion !== 'US') ||
      (h.currency !== 'INR' && h.currency !== 'USD') ||
      typeof h.quantity !== 'number' ||
      !Number.isFinite(h.quantity) ||
      h.quantity <= 0 ||
      h.quantity > MAX_PAPER_ORDER_QUANTITY ||
      typeof h.avgCostNative !== 'number' ||
      !Number.isFinite(h.avgCostNative) ||
      h.avgCostNative <= 0
    ) {
      return fallback;
    }

    holdings.push({
      symbol: stripControlChars(h.symbol, 24),
      name: stripControlChars(h.name, 120),
      exchange: stripControlChars(h.exchange, 24),
      region: normalizedRegion,
      currency: h.currency,
      quantity: Number(h.quantity.toFixed(4)),
      avgCostNative: Number(h.avgCostNative.toFixed(2)),
    });
  }

  const orders: PaperOrderRecord[] = [];
  for (const item of candidate.orders.slice(0, 200)) {
    if (!item || typeof item !== 'object') return fallback;
    const o = item as Record<string, unknown>;
    if (
      typeof o.id !== 'string' ||
      typeof o.timestamp !== 'string' ||
      typeof o.symbol !== 'string' ||
      (o.side !== 'BUY' && o.side !== 'SELL') ||
      (o.currency !== 'INR' && o.currency !== 'USD') ||
      typeof o.quantity !== 'number' ||
      !Number.isFinite(o.quantity) ||
      o.quantity <= 0 ||
      typeof o.priceNative !== 'number' ||
      !Number.isFinite(o.priceNative) ||
      o.priceNative <= 0 ||
      typeof o.totalUsdEquivalent !== 'number' ||
      !Number.isFinite(o.totalUsdEquivalent) ||
      typeof o.realizedPnlUsd !== 'number' ||
      !Number.isFinite(o.realizedPnlUsd)
    ) {
      return fallback;
    }

    orders.push({
      id: stripControlChars(o.id, 32),
      timestamp: stripControlChars(o.timestamp, 40),
      symbol: stripControlChars(o.symbol, 24),
      side: o.side,
      quantity: o.quantity,
      priceNative: o.priceNative,
      currency: o.currency,
      totalUsdEquivalent: o.totalUsdEquivalent,
      realizedPnlUsd: o.realizedPnlUsd,
      status: 'SIMULATED_FILLED',
    });
  }

  return {
    cashBalanceUsd: Number(candidate.cashBalanceUsd.toFixed(2)),
    realizedPnlUsd: Number(candidate.realizedPnlUsd.toFixed(2)),
    holdings,
    orders,
  };
}

/**
 * Validates and cleans a persisted watchlist array from localStorage.
 */
export function sanitizeWatchlist(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return fallback;
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const sym = stripControlChars(item, 24).toUpperCase();
    if (!/^[A-Z0-9^.=_-]{1,24}$/.test(sym)) continue;
    if (seen.has(sym)) continue;
    seen.add(sym);
    cleaned.push(sym);
    if (cleaned.length >= 50) break;
  }
  return cleaned;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Bounded-memory sliding-window rate limiter keyed by client IP.
 * Evicts expired windows and enforces a maximum key count to avoid heap growth.
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly maxTrackedKeys = 5000,
  ) {}

  check(key: string, nowMs = Date.now()): RateLimitCheckResult {
    const safeKey = key || 'unknown';
    const cutoff = nowMs - this.windowMs;

    const existing = this.hits.get(safeKey);
    const active = existing ? existing.filter((ts) => ts > cutoff) : [];

    if (active.length >= this.maxRequests) {
      const oldestActive = active[0] ?? nowMs;
      const retryAfterMs = Math.max(1000, oldestActive + this.windowMs - nowMs);
      this.hits.set(safeKey, active);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      };
    }

    if (!existing && this.hits.size >= this.maxTrackedKeys) {
      this.evictExpired(cutoff);
      if (this.hits.size >= this.maxTrackedKeys) {
        const oldestKey = this.hits.keys().next().value;
        if (oldestKey !== undefined) {
          this.hits.delete(oldestKey);
        }
      }
    }

    active.push(nowMs);
    this.hits.set(safeKey, active);
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - active.length),
      retryAfterSeconds: 0,
    };
  }

  private evictExpired(cutoff: number) {
    for (const [k, timestamps] of this.hits.entries()) {
      const fresh = timestamps.filter((ts) => ts > cutoff);
      if (fresh.length === 0) {
        this.hits.delete(k);
      } else {
        this.hits.set(k, fresh);
      }
    }
  }
}
