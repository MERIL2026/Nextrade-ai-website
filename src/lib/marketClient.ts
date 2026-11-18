import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AssetCategory,
  DataSourceStatus,
  MarketHistoryResponseDto,
  MarketIndexDto,
  MarketOverviewResponseDto,
  MarketQuoteDto,
  MarketRegion,
  MarketSearchResultDto,
  TimeframeKey,
} from './marketData';

export interface MarketOverviewQuery {
  category?: 'ALL' | AssetCategory;
  region?: 'ALL' | MarketRegion;
}

export interface MarketOverviewIndexItem extends MarketIndexDto {
  dataStatus: DataSourceStatus;
  provider: string;
}

export interface MarketOverviewQuoteItem extends MarketQuoteDto {
  dataStatus: DataSourceStatus;
  provider: string;
  sparkline: number[];
}

export interface MarketOverviewClientPayload extends MarketOverviewResponseDto {
  dataStatus: DataSourceStatus;
  provider: string;
  fetchedAt: string;
  usdInrRate: number | null;
  usdInrStatus: DataSourceStatus;
  usdInrProvider: string;
  indices: MarketOverviewIndexItem[];
  instruments: MarketOverviewQuoteItem[];
}

export interface MarketHistoryClientPayload extends MarketHistoryResponseDto {
  dataStatus: DataSourceStatus;
  provider: string;
}

export async function fetchMarketsOverview(
  query: MarketOverviewQuery = {},
  signal?: AbortSignal,
): Promise<MarketOverviewClientPayload> {
  const qs = new URLSearchParams();
  if (query.category && query.category !== 'ALL') qs.set('category', query.category);
  if (query.region && query.region !== 'ALL') qs.set('region', query.region);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await fetch(`/api/markets${suffix}`, {
    signal,
    cache: 'no-store',
  });
  const payload = (await res.json().catch(() => ({}))) as Partial<MarketOverviewResponseDto> & {
    error?: string;
    dataStatus?: DataSourceStatus;
  };
  if (!res.ok) {
    throw new Error(payload.error || `Market overview unavailable (HTTP ${res.status}).`);
  }

  const providers = Array.isArray(payload.providers) ? payload.providers : [];
  const activeProviders = providers
    .filter((p) => p.configured && p.status !== 'NOT_CONFIGURED')
    .map((p) => p.name);
  const providerSummary =
    activeProviders.length > 0
      ? activeProviders.slice(0, 3).join(' · ')
      : 'Yahoo Finance · CoinGecko · ECB FX';

  const fxUsdInr = payload.fx?.usdInr ?? {
    pair: 'USD/INR',
    baseCurrency: 'USD',
    quoteCurrency: 'INR',
    rate: null,
    providerId: 'frankfurter-ecb',
    providerName: 'Frankfurter ECB FX',
    status: 'UNAVAILABLE' as DataSourceStatus,
    sourceDate: null,
    fetchedAt: null,
  };

  const summary = payload.summary ?? {
    totalInstruments: Array.isArray(payload.instruments) ? payload.instruments.length : 0,
    availableQuotes: 0,
    unavailableQuotes: 0,
    cachedQuotes: 0,
    overallStatus: payload.dataStatus ?? ('UNAVAILABLE' as DataSourceStatus),
    fetchedAt: new Date().toISOString(),
  };

  const indices: MarketOverviewIndexItem[] = (Array.isArray(payload.indices) ? payload.indices : []).map(
    (idx) => ({
      ...idx,
      sparkline: Array.isArray(idx.sparkline) ? idx.sparkline : [],
      dataStatus: idx.status ?? 'UNAVAILABLE',
      provider: idx.providerName ?? 'Yahoo Finance',
    }),
  );

  const instruments: MarketOverviewQuoteItem[] = (
    Array.isArray(payload.instruments) ? payload.instruments : []
  ).map((inst) => ({
    ...inst,
    dataStatus: inst.status ?? 'UNAVAILABLE',
    provider: inst.providerName ?? 'Market Data Engine',
    sparkline: Array.isArray((inst as unknown as { sparkline?: number[] }).sparkline)
      ? ((inst as unknown as { sparkline: number[] }).sparkline)
      : [],
  }));

  return {
    indices,
    instruments,
    fx: { usdInr: fxUsdInr },
    providers,
    summary,
    dataStatus: summary.overallStatus ?? 'UNAVAILABLE',
    provider: providerSummary,
    fetchedAt: summary.fetchedAt ?? new Date().toISOString(),
    usdInrRate: typeof fxUsdInr.rate === 'number' ? fxUsdInr.rate : null,
    usdInrStatus: fxUsdInr.status ?? 'UNAVAILABLE',
    usdInrProvider: fxUsdInr.providerName ?? 'Frankfurter ECB FX',
  };
}

export async function searchMarketInstruments(
  query: string,
  signal?: AbortSignal,
): Promise<MarketSearchResultDto[]> {
  const q = query.trim();
  if (!q) return [];
  const res = await fetch(`/api/markets/search?q=${encodeURIComponent(q)}`, {
    signal,
    cache: 'no-store',
  });
  const payload = (await res.json().catch(() => ({}))) as {
    results?: MarketSearchResultDto[];
    error?: string;
  };
  if (!res.ok) {
    throw new Error(payload.error || `Market search failed (HTTP ${res.status}).`);
  }
  return Array.isArray(payload.results) ? payload.results : [];
}

export async function fetchMarketQuote(
  symbol: string,
  signal?: AbortSignal,
): Promise<MarketQuoteDto> {
  const res = await fetch(`/api/markets/quote/${encodeURIComponent(symbol)}`, {
    signal,
    cache: 'no-store',
  });
  const payload = (await res.json().catch(() => ({}))) as {
    quote?: MarketQuoteDto;
    error?: string;
  };
  if (!res.ok || !payload.quote) {
    throw new Error(payload.error || `Quote unavailable for ${symbol}.`);
  }
  return payload.quote;
}

export async function fetchMarketHistory(
  symbol: string,
  timeframe: TimeframeKey,
  signal?: AbortSignal,
): Promise<MarketHistoryClientPayload> {
  const res = await fetch(
    `/api/markets/history/${encodeURIComponent(symbol)}?timeframe=${encodeURIComponent(timeframe)}`,
    {
      signal,
      cache: 'no-store',
    },
  );
  const payload = (await res.json().catch(() => ({}))) as Partial<MarketHistoryResponseDto> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(payload.error || `History unavailable for ${symbol}.`);
  }
  const status: DataSourceStatus = payload.status ?? 'UNAVAILABLE';
  const providerName = payload.providerName ?? 'Market Data Engine';
  return {
    symbol: payload.symbol ?? symbol,
    name: payload.name ?? symbol,
    exchange: payload.exchange ?? 'MARKET',
    currency: payload.currency === 'INR' ? 'INR' : 'USD',
    timeframe: payload.timeframe ?? timeframe,
    points: Array.isArray(payload.points) ? payload.points : [],
    providerId: payload.providerId ?? 'market-engine',
    providerName,
    status,
    delayMinutes: typeof payload.delayMinutes === 'number' ? payload.delayMinutes : 0,
    fetchedAt: payload.fetchedAt ?? new Date().toISOString(),
    unavailableReason: payload.unavailableReason ?? null,
    dataStatus: status,
    provider: providerName,
  };
}

export function useMarketOverview(options: { refreshMs?: number } = {}) {
  const { refreshMs = 60_000 } = options;
  const [data, setData] = useState<MarketOverviewClientPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const controller = new AbortController();
    try {
      const overview = await fetchMarketsOverview({}, controller.signal);
      if (!mountedRef.current) return;
      setData(overview);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Unable to load market data.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    if (refreshMs <= 0) {
      return () => {
        mountedRef.current = false;
      };
    }
    const timer = setInterval(() => {
      void load();
    }, refreshMs);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [load, refreshMs]);

  return { data, loading, error, refresh: load };
}
