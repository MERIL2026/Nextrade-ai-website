import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthDatabase } from '../auth/db';
import { CATALOG_INSTRUMENTS } from './catalog';
import { createMarketService } from './service';
import type { FetchLike } from './providers';

function makeMockResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

function makeFakeFetch(mode: 'healthy' | 'offline'): FetchLike {
  return async (input: string | URL | Request) => {
    const url = String(input);
    if (mode === 'offline') {
      throw new Error('ECONNREFUSED upstream unreachable');
    }

    if (url.includes('frankfurter.app')) {
      return makeMockResponse({
        amount: 1,
        base: 'USD',
        date: '2026-11-16',
        rates: { INR: 84.5 },
      });
    }

    if (url.includes('coingecko.com/api/v3/simple/price')) {
      return makeMockResponse({
        bitcoin: { usd: 92450.25, usd_24h_change: 2.15, last_updated_at: 1763300000 },
        ethereum: { usd: 3180.5, usd_24h_change: 1.4, last_updated_at: 1763300000 },
        solana: { usd: 218.75, usd_24h_change: -0.8, last_updated_at: 1763300000 },
      });
    }

    if (url.includes('coingecko.com/api/v3/coins/')) {
      const baseTs = Date.now() - 4 * 86_400_000;
      return makeMockResponse({
        prices: [
          [baseTs, 89000],
          [baseTs + 86_400_000, 90200],
          [baseTs + 2 * 86_400_000, 91100],
          [baseTs + 3 * 86_400_000, 92450],
        ],
      });
    }

    if (url.includes('query1.finance.yahoo.com/v1/finance/search')) {
      return makeMockResponse({
        quotes: [
          {
            symbol: 'SHOP',
            shortname: 'Shopify Inc.',
            exchange: 'NYSE',
            quoteType: 'EQUITY',
            sector: 'Technology',
          },
        ],
      });
    }

    if (url.includes('query1.finance.yahoo.com/v8/finance/chart')) {
      const m = /chart\/([^?]+)/.exec(url);
      const sym = decodeURIComponent(m?.[1] ?? 'AAPL');
      const isInr = sym.endsWith('.NS') || sym === '^NSEI' || sym === '^BSESN';
      const basePrice = isInr ? 1650 : 210.5;
      const nowSec = Math.floor(Date.now() / 1000);
      return makeMockResponse({
        chart: {
          result: [
            {
              meta: {
                symbol: sym,
                currency: isInr ? 'INR' : 'USD',
                exchangeName: isInr ? 'NSE' : 'NASDAQ',
                regularMarketPrice: basePrice,
                chartPreviousClose: basePrice - 2,
                regularMarketDayHigh: basePrice + 4,
                regularMarketDayLow: basePrice - 3,
                regularMarketOpen: basePrice - 1,
                regularMarketVolume: 1250000,
                regularMarketTime: nowSec,
              },
              timestamp: [nowSec - 172800, nowSec - 86400, nowSec],
              indicators: {
                quote: [
                  {
                    open: [basePrice - 3, basePrice - 2, basePrice - 1],
                    high: [basePrice, basePrice + 1, basePrice + 4],
                    low: [basePrice - 5, basePrice - 4, basePrice - 3],
                    close: [basePrice - 2.5, basePrice - 1.2, basePrice],
                    volume: [900000, 1100000, 1250000],
                  },
                ],
              },
            },
          ],
        },
      });
    }

    return makeMockResponse({}, false, 404);
  };
}

test('Catalog spans India, US, ETFs, Crypto, and Forex without hardcoded prices', () => {
  const categories = new Set(CATALOG_INSTRUMENTS.map((i) => i.category));
  assert.ok(categories.has('STOCK'));
  assert.ok(categories.has('ETF'));
  assert.ok(categories.has('CRYPTO'));
  assert.ok(categories.has('FOREX'));
  for (const item of CATALOG_INSTRUMENTS) {
    assert.equal('price' in item, false, `${item.symbol} must not contain static price`);
  }
});

test('MarketService normalizes real adapters and serves L2 DB cache when upstream later goes offline', async () => {
  const db = await createAuthDatabase(':memory:');
  try {
    // 1. Live adapter fetch populates L1 + L2 cache (migration 0007_market_data_cache)
    const liveSvc = createMarketService({ db, fetchImpl: makeFakeFetch('healthy') });
    const overview = await liveSvc.getOverview();
    assert.equal(overview.fx.usdInr.rate, 84.5);
    assert.equal(overview.fx.usdInr.providerId, 'frankfurter-ecb');
    assert.equal(overview.fx.usdInr.status, 'END_OF_DAY');
    assert.equal(overview.indices.length, 6);
    assert.ok(overview.indices.every((idx) => idx.value !== null));

    const btc = await liveSvc.getQuote('BTC-USD');
    assert.equal(btc.price, 92450.25);
    assert.equal(btc.providerId, 'coingecko');
    assert.equal(btc.status, 'LIVE');

    const aapl = await liveSvc.getQuote('AAPL');
    assert.equal(aapl.price, 210.5);
    assert.equal(aapl.providerId, 'yahoo-finance');
    assert.equal(aapl.status, 'DELAYED');

    const hist = await liveSvc.getHistory('AAPL', '1M');
    assert.equal(hist.points.length, 3);
    assert.equal(hist.status, 'DELAYED');

    const searchRes = await liveSvc.searchSymbols('Shopify');
    assert.ok(searchRes.some((s) => s.symbol === 'SHOP'));

    // 2. New instance with empty L1 memory cache & offline upstream reads L2 DB cache cleanly
    const offlineWithCacheSvc = createMarketService({ db, fetchImpl: makeFakeFetch('offline') });
    const cachedAapl = await offlineWithCacheSvc.getQuote('AAPL');
    assert.equal(cachedAapl.price, 210.5);
    assert.equal(cachedAapl.providerId, 'yahoo-finance');

    const cachedFx = await offlineWithCacheSvc.getUsdInrRate();
    assert.equal(cachedFx.rate, 84.5);
    assert.equal(cachedFx.status, 'CACHED');

    const cachedHist = await offlineWithCacheSvc.getHistory('AAPL', '1M');
    assert.equal(cachedHist.points.length, 3);

    // 3. Probe writes health rows into market_data_health
    const probe = await liveSvc.probeProviders();
    assert.ok(probe.providers.length >= 3);
  } finally {
    await db.close();
  }
});

test('MarketService never fabricates prices when both upstream and cache are unavailable', async () => {
  const db = await createAuthDatabase(':memory:');
  try {
    const offlineSvc = createMarketService({ db, fetchImpl: makeFakeFetch('offline') });

    const quote = await offlineSvc.getQuote('NVDA');
    assert.equal(quote.price, null);
    assert.equal(quote.status, 'UNAVAILABLE');
    assert.ok(quote.unavailableReason);

    const fx = await offlineSvc.getUsdInrRate();
    assert.equal(fx.rate, null);
    assert.equal(fx.status, 'UNAVAILABLE');

    const hist = await offlineSvc.getHistory('NVDA', '1M');
    assert.equal(hist.points.length, 0);
    assert.equal(hist.status, 'UNAVAILABLE');

    const ov = await offlineSvc.getOverview();
    assert.equal(ov.summary.availableQuotes, 0);
    assert.equal(ov.summary.overallStatus, 'UNAVAILABLE');
  } finally {
    await db.close();
  }
});
