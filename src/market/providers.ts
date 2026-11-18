import { SlidingWindowRateLimiter } from '../lib/security';
import type {
  AssetCategory,
  FxRateDto,
  MarketPricePoint,
  MarketQuoteDto,
  MarketRegion,
  MarketSearchResultDto,
  TimeframeKey,
} from './types';
import { findCatalogInstrument } from './catalog';

export type FetchLike = typeof fetch;

const yahooLimiter = new SlidingWindowRateLimiter(120, 60_000);
const coinGeckoLimiter = new SlidingWindowRateLimiter(30, 60_000);
const frankfurterLimiter = new SlidingWindowRateLimiter(30, 60_000);
const finnhubLimiter = new SlidingWindowRateLimiter(45, 60_000);

const REQUEST_TIMEOUT_MS = 5500;

async function fetchJsonWithRetry<T>(
  url: string,
  limiter: SlidingWindowRateLimiter,
  limiterKey: string,
  fetchImpl: FetchLike,
  retries = 1,
): Promise<T> {
  const rateCheck = limiter.check(limiterKey);
  if (!rateCheck.allowed) {
    throw new Error(`Provider rate limit window active (${rateCheck.retryAfterSeconds}s).`);
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'NextradeAI/1.0 (+https://github.com/MERIL2026/nextrade-ai)',
          Accept: 'application/json',
        },
      });
      clearTimeout(timer);

      if (!response.ok) {
        const bodyPreview = (await response.text().catch(() => '')).slice(0, 140);
        const err = new Error(`HTTP ${response.status} from ${new URL(url).hostname}: ${bodyPreview}`);
        if (response.status >= 500 || response.status === 429) {
          lastError = err;
          if (attempt < retries) {
            await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
            continue;
          }
        }
        throw err;
      }

      return (await response.json()) as T;
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        continue;
      }
    }
  }

  throw lastError ?? new Error('Upstream request failed.');
}

function inferRegionFromYahooSymbol(symbol: string, exchange?: string, currency?: string): MarketRegion {
  const upper = symbol.toUpperCase();
  if (upper.endsWith('.NS') || upper.endsWith('.BO') || upper === '^NSEI' || upper === '^BSESN' || upper === '^NSEBANK') {
    return 'IN';
  }
  if (currency === 'INR' || exchange === 'NSI' || exchange === 'BSE' || exchange === 'BOM') {
    return 'IN';
  }
  if (upper.endsWith('-USD') || upper.endsWith('=X')) {
    return 'GLOBAL';
  }
  return 'US';
}

function inferCategoryFromQuoteType(quoteType?: string, symbol?: string): AssetCategory {
  const qt = (quoteType ?? '').toUpperCase();
  const sym = (symbol ?? '').toUpperCase();
  if (qt === 'INDEX' || sym.startsWith('^')) return 'INDEX';
  if (qt === 'ETF' || sym === 'SPY' || sym === 'QQQ' || sym.includes('BEES')) return 'ETF';
  if (qt === 'CRYPTOCURRENCY' || sym.endsWith('-USD')) return 'CRYPTO';
  if (qt === 'CURRENCY' || sym.endsWith('=X')) return 'FOREX';
  return 'STOCK';
}

function formatChartLabel(tsSeconds: number, timeframe: TimeframeKey): string {
  const d = new Date(tsSeconds * 1000);
  if (timeframe === '1D') {
    return d.toISOString().slice(11, 16);
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function mapTimeframeToYahooParams(timeframe: TimeframeKey): { range: string; interval: string } {
  switch (timeframe) {
    case '1D':
      return { range: '1d', interval: '15m' };
    case '1W':
      return { range: '5d', interval: '1h' };
    case '1M':
      return { range: '1mo', interval: '1d' };
    case '6M':
      return { range: '6mo', interval: '1d' };
    case '1Y':
      return { range: '1y', interval: '1wk' };
  }
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string;
        shortName?: string;
        longName?: string;
        currency?: string;
        exchangeName?: string;
        fullExchangeName?: string;
        instrumentType?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketDayHigh?: number;
        regularMarketDayLow?: number;
        regularMarketOpen?: number;
        regularMarketVolume?: number;
        regularMarketTime?: number;
        exchangeDataDelayedBy?: number;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: { description?: string };
  };
}

export async function fetchYahooChart(
  symbol: string,
  timeframe: TimeframeKey,
  fetchImpl: FetchLike = fetch,
): Promise<{
  quote: MarketQuoteDto;
  points: MarketPricePoint[];
}> {
  const cleanSymbol = symbol.trim().toUpperCase();
  const { range, interval } = mapTimeframeToYahooParams(timeframe);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSymbol)}?range=${range}&interval=${interval}`;
  const raw = await fetchJsonWithRetry<YahooChartResponse>(
    url,
    yahooLimiter,
    'yahoo-finance',
    fetchImpl,
  );

  const result = raw.chart?.result?.[0];
  if (!result?.meta) {
    throw new Error(raw.chart?.error?.description || `No market chart data returned for ${cleanSymbol}`);
  }

  const meta = result.meta;
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quoteIndicator = result.indicators?.quote?.[0];
  const closes = Array.isArray(quoteIndicator?.close) ? quoteIndicator.close : [];
  const opens = Array.isArray(quoteIndicator?.open) ? quoteIndicator.open : [];
  const highs = Array.isArray(quoteIndicator?.high) ? quoteIndicator.high : [];
  const lows = Array.isArray(quoteIndicator?.low) ? quoteIndicator.low : [];
  const volumes = Array.isArray(quoteIndicator?.volume) ? quoteIndicator.volume : [];

  const points: MarketPricePoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const closeVal = closes[i];
    if (typeof closeVal !== 'number' || !Number.isFinite(closeVal) || closeVal <= 0) continue;
    points.push({
      label: formatChartLabel(timestamps[i], timeframe),
      timestamp: new Date(timestamps[i] * 1000).toISOString(),
      price: Number(closeVal.toFixed(4)),
      open: typeof opens[i] === 'number' && Number.isFinite(opens[i]) ? Number(opens[i]!.toFixed(4)) : null,
      high: typeof highs[i] === 'number' && Number.isFinite(highs[i]) ? Number(highs[i]!.toFixed(4)) : null,
      low: typeof lows[i] === 'number' && Number.isFinite(lows[i]) ? Number(lows[i]!.toFixed(4)) : null,
      volume: typeof volumes[i] === 'number' && Number.isFinite(volumes[i]) ? Math.round(volumes[i]!) : null,
    });
  }

  const catalog = findCatalogInstrument(cleanSymbol);
  const price =
    typeof meta.regularMarketPrice === 'number' && Number.isFinite(meta.regularMarketPrice)
      ? meta.regularMarketPrice
      : points.length > 0
        ? points[points.length - 1].price
        : null;

  if (price === null || !Number.isFinite(price) || price <= 0) {
    throw new Error(`Invalid market price returned by Yahoo Finance for ${cleanSymbol}`);
  }

  const previousCloseRaw =
    typeof meta.previousClose === 'number' && Number.isFinite(meta.previousClose)
      ? meta.previousClose
      : typeof meta.chartPreviousClose === 'number' && Number.isFinite(meta.chartPreviousClose)
        ? meta.chartPreviousClose
        : points.length > 1
          ? points[0].price
          : null;

  const change =
    previousCloseRaw !== null && previousCloseRaw > 0
      ? Number((price - previousCloseRaw).toFixed(4))
      : null;
  const changePercent =
    change !== null && previousCloseRaw && previousCloseRaw > 0
      ? Number(((change / previousCloseRaw) * 100).toFixed(2))
      : null;

  const currency: 'INR' | 'USD' =
    catalog?.currency ?? (meta.currency?.toUpperCase() === 'INR' ? 'INR' : 'USD');
  const exchange =
    catalog?.exchange ?? meta.fullExchangeName ?? meta.exchangeName ?? 'Global Exchange';
  const region = catalog?.region ?? inferRegionFromYahooSymbol(cleanSymbol, meta.exchangeName, currency);
  const category = catalog?.category ?? inferCategoryFromQuoteType(meta.instrumentType, cleanSymbol);
  const delayMinutes =
    typeof meta.exchangeDataDelayedBy === 'number' && meta.exchangeDataDelayedBy > 0
      ? meta.exchangeDataDelayedBy
      : 15;
  const status = delayMinutes === 0 ? 'LIVE' : 'DELAYED';
  const nowIso = new Date().toISOString();

  return {
    quote: {
      symbol: cleanSymbol,
      name: catalog?.name ?? meta.longName ?? meta.shortName ?? cleanSymbol,
      exchange,
      region,
      category,
      currency,
      sector: catalog?.sector ?? (category === 'INDEX' ? 'Market Index' : category === 'ETF' ? 'Exchange-Traded Fund' : 'Equities'),
      price: Number(price.toFixed(4)),
      previousClose: previousCloseRaw !== null ? Number(previousCloseRaw.toFixed(4)) : null,
      change,
      changePercent,
      high:
        typeof meta.regularMarketDayHigh === 'number' && Number.isFinite(meta.regularMarketDayHigh)
          ? Number(meta.regularMarketDayHigh.toFixed(4))
          : null,
      low:
        typeof meta.regularMarketDayLow === 'number' && Number.isFinite(meta.regularMarketDayLow)
          ? Number(meta.regularMarketDayLow.toFixed(4))
          : null,
      open:
        typeof meta.regularMarketOpen === 'number' && Number.isFinite(meta.regularMarketOpen)
          ? Number(meta.regularMarketOpen.toFixed(4))
          : null,
      volume:
        typeof meta.regularMarketVolume === 'number' && Number.isFinite(meta.regularMarketVolume)
          ? Math.round(meta.regularMarketVolume)
          : null,
      providerId: 'yahoo-finance',
      providerName: 'Yahoo Finance Chart Feed',
      status,
      delayMinutes,
      sourceTimestamp: meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000).toISOString()
        : nowIso,
      fetchedAt: nowIso,
      unavailableReason: null,
    },
    points,
  };
}

interface YahooSearchResponse {
  quotes?: Array<{
    symbol?: string;
    shortname?: string;
    longname?: string;
    exchange?: string;
    exchDisp?: string;
    quoteType?: string;
    sectorDisp?: string;
  }>;
}

export async function searchYahooFinance(
  query: string,
  fetchImpl: FetchLike = fetch,
): Promise<MarketSearchResultDto[]> {
  const clean = query.trim();
  if (clean.length < 1) return [];
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(clean)}&quotesCount=10&newsCount=0`;
  const raw = await fetchJsonWithRetry<YahooSearchResponse>(
    url,
    yahooLimiter,
    'yahoo-finance-search',
    fetchImpl,
  );
  const quotes = Array.isArray(raw.quotes) ? raw.quotes : [];
  const results: MarketSearchResultDto[] = [];
  for (const q of quotes) {
    const symbol = (q.symbol ?? '').trim().toUpperCase();
    if (!symbol) continue;
    const category = inferCategoryFromQuoteType(q.quoteType, symbol);
    const region = inferRegionFromYahooSymbol(symbol, q.exchange);
    const currency: 'INR' | 'USD' = region === 'IN' || symbol.includes('INR') ? 'INR' : 'USD';
    results.push({
      symbol,
      name: q.longname || q.shortname || symbol,
      exchange: q.exchDisp || q.exchange || 'Global',
      region,
      category,
      currency,
      sector: q.sectorDisp || category,
      providerId: 'yahoo-finance',
    });
  }
  return results;
}

type CoinGeckoSimpleResponse = Record<
  string,
  {
    usd?: number;
    usd_24h_change?: number;
    inr?: number;
    last_updated_at?: number;
  }
>;

export async function fetchCoinGeckoSpotQuotes(
  ids: string[],
  fetchImpl: FetchLike = fetch,
): Promise<Map<string, { priceUsd: number; change24hPct: number | null; updatedAt: string | null }>> {
  const out = new Map<string, { priceUsd: number; change24hPct: number | null; updatedAt: string | null }>();
  if (ids.length === 0) return out;
  const joined = encodeURIComponent(ids.join(','));
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${joined}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`;
  const raw = await fetchJsonWithRetry<CoinGeckoSimpleResponse>(
    url,
    coinGeckoLimiter,
    'coingecko',
    fetchImpl,
  );
  for (const id of ids) {
    const entry = raw[id];
    if (entry && typeof entry.usd === 'number' && Number.isFinite(entry.usd) && entry.usd > 0) {
      out.set(id, {
        priceUsd: entry.usd,
        change24hPct:
          typeof entry.usd_24h_change === 'number' && Number.isFinite(entry.usd_24h_change)
            ? Number(entry.usd_24h_change.toFixed(2))
            : null,
        updatedAt:
          typeof entry.last_updated_at === 'number'
            ? new Date(entry.last_updated_at * 1000).toISOString()
            : null,
      });
    }
  }
  return out;
}

export async function fetchCoinGeckoHistory(
  coingeckoId: string,
  timeframe: TimeframeKey,
  fetchImpl: FetchLike = fetch,
): Promise<MarketPricePoint[]> {
  const days =
    timeframe === '1D'
      ? '1'
      : timeframe === '1W'
        ? '7'
        : timeframe === '1M'
          ? '30'
          : timeframe === '6M'
            ? '180'
            : '365';
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coingeckoId)}/market_chart?vs_currency=usd&days=${days}`;
  const raw = await fetchJsonWithRetry<{ prices?: [number, number][] }>(
    url,
    coinGeckoLimiter,
    'coingecko',
    fetchImpl,
  );
  const rows = Array.isArray(raw.prices) ? raw.prices : [];
  if (rows.length === 0) return [];

  // Downsample cleanly to <= 60 points for responsive SVG chart rendering
  const step = Math.max(1, Math.floor(rows.length / 60));
  const points: MarketPricePoint[] = [];
  for (let i = 0; i < rows.length; i += step) {
    const [tsMs, price] = rows[i];
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue;
    points.push({
      label: formatChartLabel(Math.floor(tsMs / 1000), timeframe),
      timestamp: new Date(tsMs).toISOString(),
      price: Number(price.toFixed(2)),
    });
  }
  const last = rows[rows.length - 1];
  if (last && points.length > 0 && points[points.length - 1].timestamp !== new Date(last[0]).toISOString()) {
    points.push({
      label: formatChartLabel(Math.floor(last[0] / 1000), timeframe),
      timestamp: new Date(last[0]).toISOString(),
      price: Number(last[1].toFixed(2)),
    });
  }
  return points;
}

interface FrankfurterResponse {
  amount?: number;
  base?: string;
  date?: string;
  rates?: Record<string, number>;
}

export async function fetchFrankfurterFxRates(
  fetchImpl: FetchLike = fetch,
): Promise<{
  sourceDate: string | null;
  fetchedAt: string;
  ratesFromUsd: Record<string, number>;
}> {
  const url = 'https://api.frankfurter.app/latest?from=USD&to=INR,EUR,GBP,JPY';
  const raw = await fetchJsonWithRetry<FrankfurterResponse>(
    url,
    frankfurterLimiter,
    'frankfurter',
    fetchImpl,
  );
  if (!raw.rates || typeof raw.rates.INR !== 'number' || !Number.isFinite(raw.rates.INR)) {
    throw new Error('Frankfurter FX response did not include USD/INR rate.');
  }
  return {
    sourceDate: raw.date ?? null,
    fetchedAt: new Date().toISOString(),
    ratesFromUsd: raw.rates,
  };
}

export async function fetchFinnhubQuoteIfConfigured(
  symbol: string,
  fetchImpl: FetchLike = fetch,
): Promise<MarketQuoteDto | null> {
  const key = (process.env.FINNHUB_API_KEY ?? '').trim();
  if (!key || symbol.includes('.NS') || symbol.includes('.BO') || symbol.startsWith('^')) {
    return null;
  }
  const cleanSymbol = symbol.trim().toUpperCase();
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(cleanSymbol)}&token=${encodeURIComponent(key)}`;
  const raw = await fetchJsonWithRetry<{
    c?: number;
    d?: number;
    dp?: number;
    h?: number;
    l?: number;
    o?: number;
    pc?: number;
    t?: number;
  }>(url, finnhubLimiter, 'finnhub', fetchImpl, 0);

  if (typeof raw.c !== 'number' || !Number.isFinite(raw.c) || raw.c <= 0) {
    return null;
  }
  const catalog = findCatalogInstrument(cleanSymbol);
  const nowIso = new Date().toISOString();
  return {
    symbol: cleanSymbol,
    name: catalog?.name ?? cleanSymbol,
    exchange: catalog?.exchange ?? 'NASDAQ / NYSE',
    region: catalog?.region ?? 'US',
    category: catalog?.category ?? 'STOCK',
    currency: 'USD',
    sector: catalog?.sector ?? 'Equities',
    price: Number(raw.c.toFixed(4)),
    previousClose: typeof raw.pc === 'number' ? Number(raw.pc.toFixed(4)) : null,
    change: typeof raw.d === 'number' ? Number(raw.d.toFixed(4)) : null,
    changePercent: typeof raw.dp === 'number' ? Number(raw.dp.toFixed(2)) : null,
    high: typeof raw.h === 'number' ? Number(raw.h.toFixed(4)) : null,
    low: typeof raw.l === 'number' ? Number(raw.l.toFixed(4)) : null,
    open: typeof raw.o === 'number' ? Number(raw.o.toFixed(4)) : null,
    volume: null,
    providerId: 'finnhub',
    providerName: 'Finnhub Real-Time Quote API',
    status: 'LIVE',
    delayMinutes: 0,
    sourceTimestamp: raw.t ? new Date(raw.t * 1000).toISOString() : nowIso,
    fetchedAt: nowIso,
    unavailableReason: null,
  };
}

export function getOptionalProviderEnvStatus() {
  return {
    finnhubConfigured: Boolean((process.env.FINNHUB_API_KEY ?? '').trim()),
    alphaVantageConfigured: Boolean((process.env.ALPHA_VANTAGE_API_KEY ?? '').trim()),
    twelveDataConfigured: Boolean((process.env.TWELVEDATA_API_KEY ?? '').trim()),
  };
}

export function buildUnavailableFxRate(pair: string, base: string, quote: string, reason: string): FxRateDto {
  return {
    pair,
    baseCurrency: base,
    quoteCurrency: quote,
    rate: null,
    providerId: 'frankfurter-ecb',
    providerName: 'Frankfurter (ECB Reference FX)',
    status: 'UNAVAILABLE',
    sourceDate: null,
    fetchedAt: null,
    unavailableReason: reason,
  };
}
