import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLEAN_PAPER_TRADING_STATE,
  EMPTY_PORTFOLIO_STATE,
  validatePaperOrder,
  executePaperOrder,
  calculatePortfolioMetrics,
  calculateSeriesRiskMetrics,
} from './portfolioEngine';
import { CATALOG_INSTRUMENTS, filterInstruments, type MarketQuoteDto } from './marketData';

function makeQuote(symbol: string, price: number | null, overrides?: Partial<MarketQuoteDto>): MarketQuoteDto {
  const cat = CATALOG_INSTRUMENTS.find((c) => c.symbol === symbol);
  return {
    symbol,
    name: cat?.name ?? symbol,
    exchange: cat?.exchange ?? 'NASDAQ',
    region: cat?.region ?? 'US',
    category: cat?.category ?? 'STOCK',
    currency: cat?.currency ?? 'USD',
    sector: cat?.sector ?? 'Technology',
    price,
    previousClose: price !== null ? price - 1 : null,
    change: price !== null ? 1 : null,
    changePercent: price !== null ? 0.5 : null,
    high: price,
    low: price,
    open: price,
    volume: 100000,
    providerId: price !== null ? 'yahoo-finance' : 'none',
    providerName: price !== null ? 'Yahoo Finance' : 'Unavailable',
    status: price !== null ? 'DELAYED' : 'UNAVAILABLE',
    delayMinutes: 15,
    sourceTimestamp: price !== null ? '2026-11-17T00:00:00Z' : null,
    fetchedAt: price !== null ? '2026-11-17T00:00:00Z' : null,
    unavailableReason: price === null ? 'Upstream offline' : null,
    ...overrides,
  };
}

test('CLEAN_PAPER_TRADING_STATE starts with $100,000 cash and zero starter holdings', () => {
  assert.equal(CLEAN_PAPER_TRADING_STATE.cashBalanceUsd, 100_000);
  assert.equal(CLEAN_PAPER_TRADING_STATE.holdings.length, 0);
  assert.equal(CLEAN_PAPER_TRADING_STATE.orders.length, 0);
  assert.equal(EMPTY_PORTFOLIO_STATE.cashBalanceUsd, 0);
  assert.equal(EMPTY_PORTFOLIO_STATE.holdings.length, 0);
});

test('validatePaperOrder rejects zero quantity, unavailable FX on INR orders, and insufficient funds', () => {
  const zeroQty = validatePaperOrder(
    {
      symbol: 'NVDA',
      side: 'BUY',
      quantity: 0,
      executionPriceNative: 146.28,
      currency: 'USD',
      region: 'US',
      name: 'NVIDIA Corporation',
      exchange: 'NASDAQ',
    },
    CLEAN_PAPER_TRADING_STATE,
    84.5,
  );
  assert.equal(zeroQty.valid, false);

  const missingFx = validatePaperOrder(
    {
      symbol: 'RELIANCE.NS',
      side: 'BUY',
      quantity: 5,
      executionPriceNative: 1300,
      currency: 'INR',
      region: 'IN',
      name: 'Reliance Industries',
      exchange: 'NSE',
    },
    CLEAN_PAPER_TRADING_STATE,
    null,
  );
  assert.equal(missingFx.valid, false);
  assert.match(missingFx.error ?? '', /USD\/INR FX rate is unavailable/);

  const oversized = validatePaperOrder(
    {
      symbol: 'NVDA',
      side: 'BUY',
      quantity: 5000,
      executionPriceNative: 146.28,
      currency: 'USD',
      region: 'US',
      name: 'NVIDIA Corporation',
      exchange: 'NASDAQ',
    },
    CLEAN_PAPER_TRADING_STATE,
    84.5,
  );
  assert.equal(oversized.valid, false);
  assert.match(oversized.error ?? '', /Insufficient simulated cash/);
});

test('executePaperOrder updates cash balance, average cost, and realizes P&L across BUY and full SELL', () => {
  const { nextState: afterBuy, validation: buyVal } = executePaperOrder(
    CLEAN_PAPER_TRADING_STATE,
    {
      symbol: 'AAPL',
      side: 'BUY',
      quantity: 10,
      executionPriceNative: 200.0,
      currency: 'USD',
      region: 'US',
      name: 'Apple Inc.',
      exchange: 'NASDAQ',
    },
    84.5,
    '2026-11-13 10:00 UTC',
  );

  assert.equal(buyVal.valid, true);
  assert.equal(afterBuy.cashBalanceUsd, 98_000);
  assert.equal(afterBuy.holdings.length, 1);
  assert.equal(afterBuy.holdings[0].avgCostNative, 200);

  const { nextState: afterSell, validation: sellVal } = executePaperOrder(
    afterBuy,
    {
      symbol: 'AAPL',
      side: 'SELL',
      quantity: 10,
      executionPriceNative: 225.0,
      currency: 'USD',
      region: 'US',
      name: 'Apple Inc.',
      exchange: 'NASDAQ',
    },
    84.5,
    '2026-11-13 10:05 UTC',
  );

  assert.equal(sellVal.valid, true);
  assert.equal(afterSell.holdings.length, 0);
  assert.equal(afterSell.realizedPnlUsd, 250);
  assert.equal(afterSell.cashBalanceUsd, 100_250);
});

test('calculatePortfolioMetrics computes real allocations and degrades honestly to null when quotes are unavailable', () => {
  const state = {
    cashBalanceUsd: 50_000,
    realizedPnlUsd: 0,
    holdings: [
      {
        symbol: 'MSFT',
        name: 'Microsoft Corporation',
        exchange: 'NASDAQ',
        region: 'US' as const,
        currency: 'USD' as const,
        quantity: 50,
        avgCostNative: 400,
      },
      {
        symbol: 'TCS.NS',
        name: 'Tata Consultancy Services',
        exchange: 'NSE',
        region: 'IN' as const,
        currency: 'INR' as const,
        quantity: 100,
        avgCostNative: 3800,
      },
    ],
    orders: [],
  };

  const valued = calculatePortfolioMetrics(
    state,
    [makeQuote('MSFT', 420), makeQuote('TCS.NS', 4225)],
    84.5,
  );
  assert.equal(valued.unavailableHoldingsCount, 0);
  assert.ok(valued.totalEquityUsd !== null);
  const totalAllocation = valued.indiaExposurePct + valued.usExposurePct + valued.cashWeightPct;
  assert.ok(totalAllocation >= 99.5 && totalAllocation <= 100.5);

  const unavailable = calculatePortfolioMetrics(state, [makeQuote('MSFT', 420)], 84.5);
  assert.equal(unavailable.unavailableHoldingsCount, 1);
  assert.equal(unavailable.totalEquityUsd, null);
  assert.equal(unavailable.unrealizedPnlUsd, null);
});

test('calculateSeriesRiskMetrics accurately captures drawdown and handles empty data honestly', () => {
  const empty = calculateSeriesRiskMetrics([]);
  assert.equal(empty.hasData, false);
  assert.equal(empty.sufficientData, false);
  assert.equal(empty.periodReturnPct, null);

  const risk = calculateSeriesRiskMetrics([100, 120, 90, 110]);
  assert.equal(risk.hasData, true);
  assert.equal(risk.periodReturnPct, 10);
  assert.equal(risk.maxDrawdownPct, 25);
  assert.ok((risk.annualizedVolatilityPct ?? 0) > 0);
});

test('filterInstruments isolates regions/categories and searches by ticker', () => {
  const inOnly = filterInstruments(CATALOG_INSTRUMENTS, '', 'IN');
  assert.ok(inOnly.length > 0 && inOnly.every((item) => item.region === 'IN'));

  const cryptoOnly = filterInstruments(CATALOG_INSTRUMENTS, '', 'ALL', 'CRYPTO');
  assert.ok(cryptoOnly.length >= 2 && cryptoOnly.every((item) => item.category === 'CRYPTO'));

  const nvdaOnly = filterInstruments(CATALOG_INSTRUMENTS, 'nvidia', 'ALL');
  assert.equal(nvdaOnly.length, 1);
  assert.equal(nvdaOnly[0].symbol, 'NVDA');
});
