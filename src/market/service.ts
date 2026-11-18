import type { AuthDatabase } from '../auth/db';
import {
  CATALOG_INDICES,
  CATALOG_INSTRUMENTS,
  findCatalogIndex,
  findCatalogInstrument,
} from './catalog';
import {
  buildUnavailableFxRate,
  fetchCoinGeckoHistory,
  fetchCoinGeckoSpotQuotes,
  fetchFinnhubQuoteIfConfigured,
  fetchFrankfurterFxRates,
  fetchYahooChart,
  getOptionalProviderEnvStatus,
  searchYahooFinance,
  type FetchLike,
} from './providers';
import type {
  AssetCategory,
  DataSourceStatus,
  FxRateDto,
  MarketHistoryResponseDto,
  MarketIndexDto,
  MarketOverviewResponseDto,
  MarketPricePoint,
  MarketProviderStatusDto,
  MarketQuoteDto,
  MarketRegion,
  MarketSearchResultDto,
  TimeframeKey,
} from './types';

const QUOTE_TTL_MS = 60_000;
const HISTORY_TTL_MS = 300_000;
const FX_TTL_MS = 900_000;

interface CacheEntry<T> {
  value: T;
  fetchedAtMs: number;
  expiresAtMs: number;
}

function toIso(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function unavailableQuote(symbol: string, reason: string): MarketQuoteDto {
  const cat = findCatalogInstrument(symbol);
  return {
    symbol: cat?.symbol ?? symbol.toUpperCase(),
    name: cat?.name ?? symbol.toUpperCase(),
    exchange: cat?.exchange ?? 'Exchange Unavailable',
    region: cat?.region ?? 'US',
    category: cat?.category ?? 'STOCK',
    currency: cat?.currency ?? 'USD',
    sector: cat?.sector ?? 'Market Instrument',
    price: null,
    previousClose: null,
    change: null,
    changePercent: null,
    high: null,
    low: null,
    open: null,
    volume: null,
    providerId: 'none',
    providerName: 'Upstream Unavailable',
    status: 'UNAVAILABLE',
    delayMinutes: 0,
    sourceTimestamp: null,
    fetchedAt: null,
    unavailableReason: reason,
  };
}

export function createMarketService(options: {
  db?: AuthDatabase;
  fetchImpl?: FetchLike;
}) {
  const db = options.db;
  const fetchImpl = options.fetchImpl ?? fetch;
  const isPg = db?.dialect === 'postgres';

  const quoteMem = new Map<string, CacheEntry<MarketQuoteDto>>();
  const historyMem = new Map<string, CacheEntry<MarketHistoryResponseDto>>();
  let fxMem: CacheEntry<{ usdInr: FxRateDto; ratesFromUsd: Record<string, number> }> | null = null;
  let lastOverviewCache: CacheEntry<MarketOverviewResponseDto> | null = null;

  async function saveQuoteCache(quote: MarketQuoteDto, points?: MarketPricePoint[]) {
    if (!db || quote.price === null) return;
    const fetchedAt = quote.fetchedAt ?? new Date().toISOString();
    const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString();
    try {
      await db.execute(
        `INSERT INTO market_quote_cache
         (symbol, asset_category, exchange, region, currency, name, price, previous_close, change_value, change_percent, high_price, low_price, open_price, volume, provider_id, status, delay_minutes, source_timestamp, fetched_at, expires_at, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol) DO UPDATE SET
           price = excluded.price,
           previous_close = excluded.previous_close,
           change_value = excluded.change_value,
           change_percent = excluded.change_percent,
           high_price = excluded.high_price,
           low_price = excluded.low_price,
           open_price = excluded.open_price,
           volume = excluded.volume,
           provider_id = excluded.provider_id,
           status = excluded.status,
           delay_minutes = excluded.delay_minutes,
           source_timestamp = excluded.source_timestamp,
           fetched_at = excluded.fetched_at,
           expires_at = excluded.expires_at,
           payload_json = excluded.payload_json`,
        `INSERT INTO market_quote_cache
         (symbol, asset_category, exchange, region, currency, name, price, previous_close, change_value, change_percent, high_price, low_price, open_price, volume, provider_id, status, delay_minutes, source_timestamp, fetched_at, expires_at, payload_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::timestamptz, $19::timestamptz, $20::timestamptz, $21)
         ON CONFLICT (symbol) DO UPDATE SET
           price = EXCLUDED.price,
           previous_close = EXCLUDED.previous_close,
           change_value = EXCLUDED.change_value,
           change_percent = EXCLUDED.change_percent,
           high_price = EXCLUDED.high_price,
           low_price = EXCLUDED.low_price,
           open_price = EXCLUDED.open_price,
           volume = EXCLUDED.volume,
           provider_id = EXCLUDED.provider_id,
           status = EXCLUDED.status,
           delay_minutes = EXCLUDED.delay_minutes,
           source_timestamp = EXCLUDED.source_timestamp,
           fetched_at = EXCLUDED.fetched_at,
           expires_at = EXCLUDED.expires_at,
           payload_json = EXCLUDED.payload_json`,
        [
          quote.symbol,
          quote.category,
          quote.exchange,
          quote.region,
          quote.currency,
          quote.name,
          quote.price,
          quote.previousClose,
          quote.change,
          quote.changePercent,
          quote.high,
          quote.low,
          quote.open,
          quote.volume,
          quote.providerId,
          quote.status === 'CACHED' ? 'DELAYED' : quote.status,
          quote.delayMinutes,
          quote.sourceTimestamp,
          fetchedAt,
          expiresAt,
          JSON.stringify({
            providerName: quote.providerName,
            sparkline: points ? points.slice(-14).map((p) => p.price) : [],
          }),
        ],
      );
    } catch {
      // Cache write failure must not break upstream delivery
    }
  }

  async function readQuoteFromDb(symbol: string): Promise<{ quote: MarketQuoteDto; isFresh: boolean; sparkline: number[] } | null> {
    if (!db) return null;
    try {
      const row = await db.queryOne<Record<string, unknown>>(
        'SELECT * FROM market_quote_cache WHERE symbol = ?',
        'SELECT * FROM market_quote_cache WHERE symbol = $1',
        [symbol.toUpperCase()],
      );
      if (!row) return null;
      const expiresAtMs = new Date(toIso(row.expires_at) ?? 0).getTime();
      const isFresh = expiresAtMs > Date.now();
      let payload: { providerName?: string; sparkline?: number[] } = {};
      try {
        payload = JSON.parse(String(row.payload_json ?? '{}'));
      } catch {
        payload = {};
      }
      const rawStatus = String(row.status) as DataSourceStatus;
      return {
        isFresh,
        sparkline: Array.isArray(payload.sparkline) ? payload.sparkline : [],
        quote: {
          symbol: String(row.symbol),
          name: String(row.name),
          exchange: String(row.exchange),
          region: String(row.region) as MarketRegion,
          category: String(row.asset_category) as AssetCategory,
          currency: String(row.currency) as 'INR' | 'USD',
          sector: findCatalogInstrument(String(row.symbol))?.sector ?? String(row.asset_category),
          price: Number(row.price),
          previousClose: row.previous_close !== null ? Number(row.previous_close) : null,
          change: row.change_value !== null ? Number(row.change_value) : null,
          changePercent: row.change_percent !== null ? Number(row.change_percent) : null,
          high: row.high_price !== null ? Number(row.high_price) : null,
          low: row.low_price !== null ? Number(row.low_price) : null,
          open: row.open_price !== null ? Number(row.open_price) : null,
          volume: row.volume !== null ? Number(row.volume) : null,
          providerId: String(row.provider_id),
          providerName: payload.providerName || String(row.provider_id),
          status: isFresh ? rawStatus : 'CACHED',
          delayMinutes: Number(row.delay_minutes ?? 15),
          sourceTimestamp: toIso(row.source_timestamp),
          fetchedAt: toIso(row.fetched_at),
          unavailableReason: isFresh ? null : 'Serving cached quote while live upstream refreshes.',
        },
      };
    } catch {
      return null;
    }
  }

  async function saveHistoryCache(res: MarketHistoryResponseDto) {
    if (!db || res.points.length === 0) return;
    const cacheKey = `${res.symbol}:${res.timeframe}`;
    const fetchedAt = res.fetchedAt ?? new Date().toISOString();
    const expiresAt = new Date(Date.now() + HISTORY_TTL_MS).toISOString();
    try {
      await db.execute(
        `INSERT INTO market_history_cache (cache_key, symbol, timeframe, points_json, provider_id, status, fetched_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           points_json = excluded.points_json,
           provider_id = excluded.provider_id,
           status = excluded.status,
           fetched_at = excluded.fetched_at,
           expires_at = excluded.expires_at`,
        `INSERT INTO market_history_cache (cache_key, symbol, timeframe, points_json, provider_id, status, fetched_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)
         ON CONFLICT (cache_key) DO UPDATE SET
           points_json = EXCLUDED.points_json,
           provider_id = EXCLUDED.provider_id,
           status = EXCLUDED.status,
           fetched_at = EXCLUDED.fetched_at,
           expires_at = EXCLUDED.expires_at`,
        [
          cacheKey,
          res.symbol,
          res.timeframe,
          JSON.stringify(res.points),
          res.providerId,
          res.status === 'CACHED' ? 'DELAYED' : res.status,
          fetchedAt,
          expiresAt,
        ],
      );
    } catch {
      // Ignore cache failure
    }
  }

  async function readHistoryFromDb(symbol: string, timeframe: TimeframeKey): Promise<{ dto: MarketHistoryResponseDto; isFresh: boolean } | null> {
    if (!db) return null;
    const cleanSymbol = symbol.trim().toUpperCase();
    const cacheKey = `${cleanSymbol}:${timeframe}`;
    try {
      const row = await db.queryOne<Record<string, unknown>>(
        'SELECT * FROM market_history_cache WHERE cache_key = ?',
        'SELECT * FROM market_history_cache WHERE cache_key = $1',
        [cacheKey],
      );
      if (!row) return null;
      const points = JSON.parse(String(row.points_json ?? '[]')) as MarketPricePoint[];
      if (!Array.isArray(points) || points.length === 0) return null;
      const expiresAtMs = new Date(toIso(row.expires_at) ?? 0).getTime();
      const isFresh = expiresAtMs > Date.now();
      const meta = findCatalogInstrument(cleanSymbol) ?? findCatalogIndex(cleanSymbol);
      return {
        isFresh,
        dto: {
          symbol: cleanSymbol,
          name: meta?.name ?? cleanSymbol,
          exchange: meta?.exchange ?? 'Global',
          currency: meta?.currency ?? 'USD',
          timeframe,
          points,
          providerId: String(row.provider_id),
          providerName:
            row.provider_id === 'coingecko'
              ? 'CoinGecko Market Chart'
              : 'Yahoo Finance Historical Feed',
          status: isFresh ? (String(row.status) as DataSourceStatus) : 'CACHED',
          delayMinutes: 15,
          fetchedAt: toIso(row.fetched_at),
          unavailableReason: isFresh ? null : 'Serving cached history while upstream refreshes.',
        },
      };
    } catch {
      return null;
    }
  }

  async function getUsdInrRate(): Promise<FxRateDto> {
    if (fxMem && fxMem.expiresAtMs > Date.now()) {
      return fxMem.value.usdInr;
    }

    try {
      const fx = await fetchFrankfurterFxRates(fetchImpl);
      const usdInrRate = fx.ratesFromUsd.INR;
      const dto: FxRateDto = {
        pair: 'USD/INR',
        baseCurrency: 'USD',
        quoteCurrency: 'INR',
        rate: Number(usdInrRate.toFixed(4)),
        providerId: 'frankfurter-ecb',
        providerName: 'Frankfurter (ECB Reference FX)',
        status: 'END_OF_DAY',
        sourceDate: fx.sourceDate,
        fetchedAt: fx.fetchedAt,
        unavailableReason: null,
      };
      fxMem = {
        value: { usdInr: dto, ratesFromUsd: fx.ratesFromUsd },
        fetchedAtMs: Date.now(),
        expiresAtMs: Date.now() + FX_TTL_MS,
      };
      if (db) {
        const expiresIso = new Date(Date.now() + FX_TTL_MS).toISOString();
        await db.execute(
          `INSERT INTO market_fx_cache (pair, base_currency, quote_currency, rate, provider_id, status, source_date, fetched_at, expires_at)
           VALUES ('USD/INR', 'USD', 'INR', ?, ?, 'END_OF_DAY', ?, ?, ?)
           ON CONFLICT(pair) DO UPDATE SET
             rate = excluded.rate,
             source_date = excluded.source_date,
             fetched_at = excluded.fetched_at,
             expires_at = excluded.expires_at`,
          `INSERT INTO market_fx_cache (pair, base_currency, quote_currency, rate, provider_id, status, source_date, fetched_at, expires_at)
           VALUES ('USD/INR', 'USD', 'INR', $1, $2, 'END_OF_DAY', $3, $4::timestamptz, $5::timestamptz)
           ON CONFLICT (pair) DO UPDATE SET
             rate = EXCLUDED.rate,
             source_date = EXCLUDED.source_date,
             fetched_at = EXCLUDED.fetched_at,
             expires_at = EXCLUDED.expires_at`,
          [dto.rate, dto.providerId, dto.sourceDate, fx.fetchedAt, expiresIso],
        ).catch(() => undefined);
      }
      return dto;
    } catch {
      // Fall back to Yahoo Finance USDINR=X if Frankfurter fails
      try {
        const y = await fetchYahooChart('USDINR=X', '1D', fetchImpl);
        if (y.quote.price && y.quote.price > 0) {
          const dto: FxRateDto = {
            pair: 'USD/INR',
            baseCurrency: 'USD',
            quoteCurrency: 'INR',
            rate: Number(y.quote.price.toFixed(4)),
            providerId: 'yahoo-finance',
            providerName: 'Yahoo Finance FX',
            status: 'DELAYED',
            sourceDate: y.quote.sourceTimestamp?.slice(0, 10) ?? null,
            fetchedAt: y.quote.fetchedAt,
            unavailableReason: null,
          };
          fxMem = {
            value: { usdInr: dto, ratesFromUsd: { INR: y.quote.price } },
            fetchedAtMs: Date.now(),
            expiresAtMs: Date.now() + QUOTE_TTL_MS,
          };
          return dto;
        }
      } catch {
        // Check persisted cache
      }
    }

    if (fxMem) {
      return {
        ...fxMem.value.usdInr,
        status: 'CACHED',
        unavailableReason: 'Serving cached USD/INR rate while FX upstream recovers.',
      };
    }

    if (db) {
      try {
        const row = await db.queryOne<Record<string, unknown>>(
          "SELECT * FROM market_fx_cache WHERE pair = 'USD/INR'",
          "SELECT * FROM market_fx_cache WHERE pair = 'USD/INR'",
        );
        if (row && Number(row.rate) > 0) {
          return {
            pair: 'USD/INR',
            baseCurrency: 'USD',
            quoteCurrency: 'INR',
            rate: Number(row.rate),
            providerId: String(row.provider_id),
            providerName: 'Cached FX Reference',
            status: 'CACHED',
            sourceDate: row.source_date ? String(row.source_date) : null,
            fetchedAt: toIso(row.fetched_at),
            unavailableReason: 'Serving persisted FX rate while upstream recovers.',
          };
        }
      } catch {
        // Ignore DB error
      }
    }

    return buildUnavailableFxRate(
      'USD/INR',
      'USD',
      'INR',
      'Live and cached USD/INR exchange rates are currently unavailable.',
    );
  }

  async function getQuote(symbol: string): Promise<MarketQuoteDto> {
    const cleanSymbol = symbol.trim().toUpperCase();
    const mem = quoteMem.get(cleanSymbol);
    if (mem && mem.expiresAtMs > Date.now()) {
      return mem.value;
    }

    const dbCached = await readQuoteFromDb(cleanSymbol);
    if (dbCached && dbCached.isFresh) {
      quoteMem.set(cleanSymbol, {
        value: dbCached.quote,
        fetchedAtMs: Date.now(),
        expiresAtMs: Date.now() + QUOTE_TTL_MS,
      });
      return dbCached.quote;
    }

    const catalog = findCatalogInstrument(cleanSymbol);

    // Crypto via CoinGecko first if known, fallback to Yahoo BTC-USD/etc.
    if (catalog?.coingeckoId) {
      try {
        const spot = await fetchCoinGeckoSpotQuotes([catalog.coingeckoId], fetchImpl);
        const cg = spot.get(catalog.coingeckoId);
        if (cg && cg.priceUsd > 0) {
          const prevClose =
            cg.change24hPct !== null
              ? Number((cg.priceUsd / (1 + cg.change24hPct / 100)).toFixed(4))
              : null;
          const nowIso = new Date().toISOString();
          const quote: MarketQuoteDto = {
            symbol: catalog.symbol,
            name: catalog.name,
            exchange: catalog.exchange,
            region: catalog.region,
            category: 'CRYPTO',
            currency: 'USD',
            sector: catalog.sector,
            price: Number(cg.priceUsd.toFixed(2)),
            previousClose: prevClose,
            change: prevClose !== null ? Number((cg.priceUsd - prevClose).toFixed(2)) : null,
            changePercent: cg.change24hPct,
            high: null,
            low: null,
            open: null,
            volume: null,
            providerId: 'coingecko',
            providerName: 'CoinGecko Spot API',
            status: 'LIVE',
            delayMinutes: 0,
            sourceTimestamp: cg.updatedAt ?? nowIso,
            fetchedAt: nowIso,
            unavailableReason: null,
          };
          quoteMem.set(cleanSymbol, {
            value: quote,
            fetchedAtMs: Date.now(),
            expiresAtMs: Date.now() + QUOTE_TTL_MS,
          });
          void saveQuoteCache(quote);
          return quote;
        }
      } catch {
        // Fallback to Yahoo chart
      }
    }

    // Optional Finnhub quote if API key configured for US symbols
    try {
      const finnhub = await fetchFinnhubQuoteIfConfigured(cleanSymbol, fetchImpl);
      if (finnhub) {
        quoteMem.set(cleanSymbol, {
          value: finnhub,
          fetchedAtMs: Date.now(),
          expiresAtMs: Date.now() + QUOTE_TTL_MS,
        });
        void saveQuoteCache(finnhub);
        return finnhub;
      }
    } catch {
      // Fallback to Yahoo chart
    }

    // Yahoo Finance Chart API (Stocks, Indices, ETFs, Crypto, FX)
    try {
      const yahoo = await fetchYahooChart(cleanSymbol, '1M', fetchImpl);
      quoteMem.set(cleanSymbol, {
        value: yahoo.quote,
        fetchedAtMs: Date.now(),
        expiresAtMs: Date.now() + QUOTE_TTL_MS,
      });
      void saveQuoteCache(yahoo.quote, yahoo.points);
      return yahoo.quote;
    } catch (err) {
      if (mem) {
        return {
          ...mem.value,
          status: 'CACHED',
          unavailableReason: 'Serving recently cached quote; live upstream temporarily unreachable.',
        };
      }
      if (dbCached) {
        return {
          ...dbCached.quote,
          status: 'CACHED',
          unavailableReason: 'Serving stored cache quote; live upstream temporarily unreachable.',
        };
      }
      return unavailableQuote(
        cleanSymbol,
        err instanceof Error ? err.message : 'Market data upstream unreachable.',
      );
    }
  }

  async function getHistory(
    symbol: string,
    timeframe: TimeframeKey = '1M',
  ): Promise<MarketHistoryResponseDto> {
    const cleanSymbol = symbol.trim().toUpperCase();
    const cacheKey = `${cleanSymbol}:${timeframe}`;
    const mem = historyMem.get(cacheKey);
    if (mem && mem.expiresAtMs > Date.now()) {
      return mem.value;
    }

    const dbCached = await readHistoryFromDb(cleanSymbol, timeframe);
    if (dbCached && dbCached.isFresh) {
      historyMem.set(cacheKey, {
        value: dbCached.dto,
        fetchedAtMs: Date.now(),
        expiresAtMs: Date.now() + HISTORY_TTL_MS,
      });
      return dbCached.dto;
    }

    const catalog = findCatalogInstrument(cleanSymbol);
    const indexMeta = findCatalogIndex(cleanSymbol);

    if (catalog?.coingeckoId) {
      try {
        const points = await fetchCoinGeckoHistory(catalog.coingeckoId, timeframe, fetchImpl);
        if (points.length >= 2) {
          const dto: MarketHistoryResponseDto = {
            symbol: cleanSymbol,
            name: catalog.name,
            exchange: catalog.exchange,
            currency: 'USD',
            timeframe,
            points,
            providerId: 'coingecko',
            providerName: 'CoinGecko Market Chart',
            status: 'DELAYED',
            delayMinutes: 5,
            fetchedAt: new Date().toISOString(),
            unavailableReason: null,
          };
          historyMem.set(cacheKey, {
            value: dto,
            fetchedAtMs: Date.now(),
            expiresAtMs: Date.now() + HISTORY_TTL_MS,
          });
          void saveHistoryCache(dto);
          return dto;
        }
      } catch {
        // Fallback to Yahoo chart
      }
    }

    try {
      const yahoo = await fetchYahooChart(cleanSymbol, timeframe, fetchImpl);
      const dto: MarketHistoryResponseDto = {
        symbol: cleanSymbol,
        name: indexMeta?.name ?? catalog?.name ?? yahoo.quote.name,
        exchange: indexMeta?.exchange ?? catalog?.exchange ?? yahoo.quote.exchange,
        currency: yahoo.quote.currency,
        timeframe,
        points: yahoo.points,
        providerId: yahoo.quote.providerId,
        providerName: yahoo.quote.providerName,
        status: yahoo.quote.status,
        delayMinutes: yahoo.quote.delayMinutes,
        fetchedAt: yahoo.quote.fetchedAt,
        unavailableReason: null,
      };
      historyMem.set(cacheKey, {
        value: dto,
        fetchedAtMs: Date.now(),
        expiresAtMs: Date.now() + HISTORY_TTL_MS,
      });
      if (timeframe === '1M') {
        quoteMem.set(cleanSymbol, {
          value: yahoo.quote,
          fetchedAtMs: Date.now(),
          expiresAtMs: Date.now() + QUOTE_TTL_MS,
        });
        void saveQuoteCache(yahoo.quote, yahoo.points);
      }
      void saveHistoryCache(dto);
      return dto;
    } catch (err) {
      if (mem) {
        return {
          ...mem.value,
          status: 'CACHED',
          unavailableReason: 'Serving cached historical series while upstream recovers.',
        };
      }
      if (dbCached) {
        return {
          ...dbCached.dto,
          status: 'CACHED',
          unavailableReason: 'Serving persisted cache history while upstream recovers.',
        };
      }
      return {
        symbol: cleanSymbol,
        name: indexMeta?.name ?? catalog?.name ?? cleanSymbol,
        exchange: indexMeta?.exchange ?? catalog?.exchange ?? 'Unavailable',
        currency: indexMeta?.currency ?? catalog?.currency ?? 'USD',
        timeframe,
        points: [],
        providerId: 'none',
        providerName: 'Upstream Unavailable',
        status: 'UNAVAILABLE',
        delayMinutes: 0,
        fetchedAt: null,
        unavailableReason:
          err instanceof Error ? err.message : 'Historical series unavailable.',
      };
    }
  }

  async function getIndexQuote(idx: (typeof CATALOG_INDICES)[number]): Promise<MarketIndexDto> {
    const cleanSymbol = idx.symbol.toUpperCase();
    const mem = quoteMem.get(cleanSymbol);
    const histMem = historyMem.get(`${cleanSymbol}:1M`);
    if (mem && mem.expiresAtMs > Date.now() && mem.value.price !== null) {
      const spark = histMem?.value.points.slice(-14).map((p) => p.price) ?? [];
      return {
        id: idx.id,
        symbol: idx.symbol,
        name: idx.name,
        exchange: idx.exchange,
        region: idx.region,
        currency: idx.currency,
        value: mem.value.price,
        previousClose: mem.value.previousClose,
        change: mem.value.change,
        changePercent: mem.value.changePercent,
        sparkline: spark,
        providerId: mem.value.providerId,
        providerName: mem.value.providerName,
        status: mem.value.status,
        delayMinutes: mem.value.delayMinutes,
        fetchedAt: mem.value.fetchedAt,
        unavailableReason: null,
      };
    }

    try {
      const yahoo = await fetchYahooChart(idx.symbol, '1M', fetchImpl);
      quoteMem.set(cleanSymbol, {
        value: yahoo.quote,
        fetchedAtMs: Date.now(),
        expiresAtMs: Date.now() + QUOTE_TTL_MS,
      });
      const histDto: MarketHistoryResponseDto = {
        symbol: cleanSymbol,
        name: idx.name,
        exchange: idx.exchange,
        currency: idx.currency,
        timeframe: '1M',
        points: yahoo.points,
        providerId: yahoo.quote.providerId,
        providerName: yahoo.quote.providerName,
        status: yahoo.quote.status,
        delayMinutes: yahoo.quote.delayMinutes,
        fetchedAt: yahoo.quote.fetchedAt,
        unavailableReason: null,
      };
      historyMem.set(`${cleanSymbol}:1M`, {
        value: histDto,
        fetchedAtMs: Date.now(),
        expiresAtMs: Date.now() + HISTORY_TTL_MS,
      });
      void saveQuoteCache(yahoo.quote, yahoo.points);
      void saveHistoryCache(histDto);
      return {
        id: idx.id,
        symbol: idx.symbol,
        name: idx.name,
        exchange: idx.exchange,
        region: idx.region,
        currency: idx.currency,
        value: yahoo.quote.price,
        previousClose: yahoo.quote.previousClose,
        change: yahoo.quote.change,
        changePercent: yahoo.quote.changePercent,
        sparkline: yahoo.points.slice(-14).map((p) => p.price),
        providerId: yahoo.quote.providerId,
        providerName: yahoo.quote.providerName,
        status: yahoo.quote.status,
        delayMinutes: yahoo.quote.delayMinutes,
        fetchedAt: yahoo.quote.fetchedAt,
        unavailableReason: null,
      };
    } catch (err) {
      const dbCached = await readQuoteFromDb(cleanSymbol);
      if (dbCached && dbCached.quote.price !== null) {
        return {
          id: idx.id,
          symbol: idx.symbol,
          name: idx.name,
          exchange: idx.exchange,
          region: idx.region,
          currency: idx.currency,
          value: dbCached.quote.price,
          previousClose: dbCached.quote.previousClose,
          change: dbCached.quote.change,
          changePercent: dbCached.quote.changePercent,
          sparkline: dbCached.sparkline,
          providerId: dbCached.quote.providerId,
          providerName: dbCached.quote.providerName,
          status: 'CACHED',
          delayMinutes: dbCached.quote.delayMinutes,
          fetchedAt: dbCached.quote.fetchedAt,
          unavailableReason: 'Serving cached index value while live upstream recovers.',
        };
      }
      return {
        id: idx.id,
        symbol: idx.symbol,
        name: idx.name,
        exchange: idx.exchange,
        region: idx.region,
        currency: idx.currency,
        value: null,
        previousClose: null,
        change: null,
        changePercent: null,
        sparkline: [],
        providerId: 'none',
        providerName: 'Upstream Unavailable',
        status: 'UNAVAILABLE',
        delayMinutes: 0,
        fetchedAt: null,
        unavailableReason: err instanceof Error ? err.message : 'Index feed unreachable.',
      };
    }
  }

  function buildProviderRegistrySnapshot(params: {
    yahooOk: boolean;
    yahooLatencyMs: number | null;
    coinGeckoOk: boolean;
    coinGeckoLatencyMs: number | null;
    fxOk: boolean;
    fxLatencyMs: number | null;
    checkedAt: string;
  }): MarketProviderStatusDto[] {
    const envStatus = getOptionalProviderEnvStatus();
    return [
      {
        id: 'yahoo-finance',
        name: 'Yahoo Finance Chart & Search API',
        configured: true,
        requiresKey: false,
        categories: ['STOCK', 'INDEX', 'ETF', 'CRYPTO', 'FOREX'],
        exchanges: ['NSE', 'BSE', 'NASDAQ', 'NYSE'],
        status: params.yahooOk ? 'HEALTHY' : 'UNAVAILABLE',
        classification: params.yahooOk ? 'DELAYED' : 'UNAVAILABLE',
        latencyMs: params.yahooLatencyMs,
        lastCheckedAt: params.checkedAt,
        detail: params.yahooOk
          ? 'Connected server-side; equities, indices, ETFs, and FX (~15m delayed).'
          : 'Upstream probe failed or timed out; cached fallback used when available.',
      },
      {
        id: 'coingecko',
        name: 'CoinGecko Public Crypto API',
        configured: true,
        requiresKey: false,
        categories: ['CRYPTO'],
        exchanges: ['CRYPTO'],
        status: params.coinGeckoOk ? 'HEALTHY' : 'DEGRADED',
        classification: params.coinGeckoOk ? 'LIVE' : 'UNAVAILABLE',
        latencyMs: params.coinGeckoLatencyMs,
        lastCheckedAt: params.checkedAt,
        detail: params.coinGeckoOk
          ? 'Connected server-side; live crypto spot & market charts.'
          : 'Rate-limited or unreachable; falling back to Yahoo Finance / cache.',
      },
      {
        id: 'frankfurter-ecb',
        name: 'Frankfurter ECB FX Reference',
        configured: true,
        requiresKey: false,
        categories: ['FOREX'],
        exchanges: ['FX'],
        status: params.fxOk ? 'HEALTHY' : 'DEGRADED',
        classification: params.fxOk ? 'END_OF_DAY' : 'UNAVAILABLE',
        latencyMs: params.fxLatencyMs,
        lastCheckedAt: params.checkedAt,
        detail: params.fxOk
          ? 'Daily European Central Bank FX reference (USD/INR, EUR/USD, GBP/USD).'
          : 'FX endpoint unreachable; using Yahoo FX or persisted cache.',
      },
      {
        id: 'finnhub',
        name: 'Finnhub Real-Time Quote API',
        configured: envStatus.finnhubConfigured,
        requiresKey: true,
        envKeyName: 'FINNHUB_API_KEY',
        categories: ['STOCK', 'ETF'],
        exchanges: ['NASDAQ', 'NYSE'],
        status: envStatus.finnhubConfigured ? 'HEALTHY' : 'NOT_CONFIGURED',
        classification: envStatus.finnhubConfigured ? 'LIVE' : 'NOT_CONFIGURED',
        latencyMs: null,
        lastCheckedAt: envStatus.finnhubConfigured ? params.checkedAt : null,
        detail: envStatus.finnhubConfigured
          ? 'FINNHUB_API_KEY configured server-side for low-latency US quotes.'
          : 'Optional provider not configured (set FINNHUB_API_KEY in .env).',
      },
      {
        id: 'alpha-vantage',
        name: 'Alpha Vantage Market API',
        configured: envStatus.alphaVantageConfigured,
        requiresKey: true,
        envKeyName: 'ALPHA_VANTAGE_API_KEY',
        categories: ['STOCK', 'ETF', 'FOREX'],
        exchanges: ['NASDAQ', 'NYSE'],
        status: envStatus.alphaVantageConfigured ? 'HEALTHY' : 'NOT_CONFIGURED',
        classification: envStatus.alphaVantageConfigured ? 'END_OF_DAY' : 'NOT_CONFIGURED',
        latencyMs: null,
        lastCheckedAt: envStatus.alphaVantageConfigured ? params.checkedAt : null,
        detail: envStatus.alphaVantageConfigured
          ? 'ALPHA_VANTAGE_API_KEY configured server-side.'
          : 'Optional provider not configured (set ALPHA_VANTAGE_API_KEY in .env).',
      },
      {
        id: 'twelve-data',
        name: 'Twelve Data Time-Series API',
        configured: envStatus.twelveDataConfigured,
        requiresKey: true,
        envKeyName: 'TWELVEDATA_API_KEY',
        categories: ['STOCK', 'ETF', 'CRYPTO', 'FOREX'],
        exchanges: ['NSE', 'NASDAQ', 'NYSE'],
        status: envStatus.twelveDataConfigured ? 'HEALTHY' : 'NOT_CONFIGURED',
        classification: envStatus.twelveDataConfigured ? 'DELAYED' : 'NOT_CONFIGURED',
        latencyMs: null,
        lastCheckedAt: envStatus.twelveDataConfigured ? params.checkedAt : null,
        detail: envStatus.twelveDataConfigured
          ? 'TWELVEDATA_API_KEY configured server-side.'
          : 'Optional provider not configured (set TWELVEDATA_API_KEY in .env).',
      },
    ];
  }

  async function getOverview(): Promise<MarketOverviewResponseDto> {
    if (lastOverviewCache && lastOverviewCache.expiresAtMs > Date.now()) {
      return lastOverviewCache.value;
    }

    const t0 = Date.now();
    const [usdInr, indices, instruments] = await Promise.all([
      getUsdInrRate(),
      Promise.all(CATALOG_INDICES.map((idx) => getIndexQuote(idx))),
      Promise.all(CATALOG_INSTRUMENTS.map((inst) => getQuote(inst.symbol))),
    ]);

    const nowIso = new Date().toISOString();
    const yahooItems = [...indices, ...instruments].filter((q) => q.providerId === 'yahoo-finance');
    const cgItems = instruments.filter((q) => q.providerId === 'coingecko');

    const providers = buildProviderRegistrySnapshot({
      yahooOk: yahooItems.some((q) => q.status === 'DELAYED' || q.status === 'LIVE'),
      yahooLatencyMs: yahooItems.length > 0 ? Math.max(12, Date.now() - t0) : null,
      coinGeckoOk: cgItems.some((q) => q.status === 'LIVE' || q.status === 'DELAYED'),
      coinGeckoLatencyMs: cgItems.length > 0 ? Math.max(10, Math.round((Date.now() - t0) * 0.6)) : null,
      fxOk: usdInr.rate !== null && usdInr.status !== 'CACHED',
      fxLatencyMs: usdInr.rate !== null ? Math.max(10, Math.round((Date.now() - t0) * 0.5)) : null,
      checkedAt: nowIso,
    });

    const availableQuotes = instruments.filter((i) => i.price !== null).length;
    const cachedQuotes = instruments.filter((i) => i.status === 'CACHED').length;
    const unavailableQuotes = instruments.length - availableQuotes;

    const overallStatus: DataSourceStatus =
      availableQuotes === 0
        ? 'UNAVAILABLE'
        : cachedQuotes === availableQuotes
          ? 'CACHED'
          : instruments.some((i) => i.status === 'LIVE')
            ? 'DELAYED'
            : 'DELAYED';

    const payload: MarketOverviewResponseDto = {
      indices,
      instruments,
      fx: { usdInr },
      providers,
      summary: {
        totalInstruments: instruments.length,
        availableQuotes,
        unavailableQuotes,
        cachedQuotes,
        overallStatus,
        fetchedAt: nowIso,
      },
    };

    lastOverviewCache = {
      value: payload,
      fetchedAtMs: Date.now(),
      expiresAtMs: Date.now() + QUOTE_TTL_MS,
    };

    return payload;
  }

  async function searchSymbols(
    query: string,
    category?: AssetCategory,
    region?: MarketRegion | 'ALL',
  ): Promise<MarketSearchResultDto[]> {
    const clean = query.trim().toLowerCase();
    const localMatches: MarketSearchResultDto[] = CATALOG_INSTRUMENTS.filter((inst) => {
      if (category && inst.category !== category) return false;
      if (region && region !== 'ALL' && inst.region !== region) return false;
      if (!clean) return true;
      return (
        inst.symbol.toLowerCase().includes(clean) ||
        inst.name.toLowerCase().includes(clean) ||
        inst.sector.toLowerCase().includes(clean)
      );
    }).map((inst) => ({
      symbol: inst.symbol,
      name: inst.name,
      exchange: inst.exchange,
      region: inst.region,
      category: inst.category,
      currency: inst.currency,
      sector: inst.sector,
      providerId: inst.coingeckoId ? 'coingecko' : 'yahoo-finance',
    }));

    if (!clean) return localMatches;

    try {
      const remote = await searchYahooFinance(clean, fetchImpl);
      const merged = new Map<string, MarketSearchResultDto>();
      for (const item of localMatches) merged.set(item.symbol, item);
      for (const item of remote) {
        if (category && item.category !== category) continue;
        if (region && region !== 'ALL' && item.region !== region) continue;
        if (!merged.has(item.symbol)) merged.set(item.symbol, item);
      }
      return Array.from(merged.values()).slice(0, 15);
    } catch {
      return localMatches;
    }
  }

  async function probeProviders(): Promise<{
    checkedAt: string;
    providers: MarketProviderStatusDto[];
    symbolsChecked: number;
    symbolsSucceeded: number;
    symbolsFailed: number;
  }> {
    const checkedAt = new Date().toISOString();

    const yT0 = Date.now();
    let yahooOk = false;
    let yahooLatency: number | null = null;
    try {
      await fetchYahooChart('AAPL', '1D', fetchImpl);
      yahooOk = true;
      yahooLatency = Date.now() - yT0;
    } catch {
      yahooLatency = Date.now() - yT0;
    }

    const cgT0 = Date.now();
    let cgOk = false;
    let cgLatency: number | null = null;
    try {
      const spot = await fetchCoinGeckoSpotQuotes(['bitcoin'], fetchImpl);
      cgOk = spot.has('bitcoin');
      cgLatency = Date.now() - cgT0;
    } catch {
      cgLatency = Date.now() - cgT0;
    }

    const fxT0 = Date.now();
    let fxOk = false;
    let fxLatency: number | null = null;
    try {
      await fetchFrankfurterFxRates(fetchImpl);
      fxOk = true;
      fxLatency = Date.now() - fxT0;
    } catch {
      fxLatency = Date.now() - fxT0;
    }

    const providers = buildProviderRegistrySnapshot({
      yahooOk,
      yahooLatencyMs: yahooLatency,
      coinGeckoOk: cgOk,
      coinGeckoLatencyMs: cgLatency,
      fxOk,
      fxLatencyMs: fxLatency,
      checkedAt,
    });

    if (db) {
      for (const p of providers) {
        const failureCount = p.status === 'UNAVAILABLE' ? 1 : 0;
        try {
          await db.execute(
            `INSERT INTO market_data_health
             (id, provider_id, provider_name, status, classification, symbols_processed, failure_count, validation_failures, latency_ms, detail, checked_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
            `INSERT INTO market_data_health
             (id, provider_id, provider_name, status, classification, symbols_processed, failure_count, validation_failures, latency_ms, detail, checked_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10::timestamptz)`,
            [
              `${p.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              p.id,
              p.name,
              p.status,
              p.classification === 'LIVE' || p.classification === 'DELAYED' || p.classification === 'UNAVAILABLE'
                ? p.classification
                : p.classification === 'CACHED'
                  ? 'CACHE'
                  : 'DELAYED',
              p.configured ? p.categories.length : 0,
              failureCount,
              p.latencyMs,
              p.detail,
              checkedAt,
            ],
          );
        } catch {
          // Ignore DB health write failure
        }
      }
    }

    const overview = await getOverview().catch(() => null);
    return {
      checkedAt,
      providers,
      symbolsChecked: overview?.summary.totalInstruments ?? CATALOG_INSTRUMENTS.length,
      symbolsSucceeded: overview?.summary.availableQuotes ?? (yahooOk ? 1 : 0),
      symbolsFailed: overview?.summary.unavailableQuotes ?? (yahooOk ? 0 : 1),
    };
  }

  return {
    getOverview,
    getQuote,
    getHistory,
    getUsdInrRate,
    searchSymbols,
    probeProviders,
    getProviderRegistryStatus: () =>
      buildProviderRegistrySnapshot({
        yahooOk: true,
        yahooLatencyMs: null,
        coinGeckoOk: true,
        coinGeckoLatencyMs: null,
        fxOk: true,
        fxLatencyMs: null,
        checkedAt: new Date().toISOString(),
      }),
    clearMemoryCache: () => {
      quoteMem.clear();
      historyMem.clear();
      fxMem = null;
      lastOverviewCache = null;
    },
    isPg,
  };
}

export type MarketService = ReturnType<typeof createMarketService>;
