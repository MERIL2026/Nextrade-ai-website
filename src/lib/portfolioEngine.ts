import type { MarketQuoteDto, MarketRegion } from './marketData';

export interface PaperHolding {
  symbol: string;
  name: string;
  exchange: string;
  region: 'IN' | 'US';
  currency: 'INR' | 'USD';
  quantity: number;
  avgCostNative: number;
}

export interface PaperOrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  executionPriceNative: number;
  currency: 'INR' | 'USD';
  region: MarketRegion;
  name: string;
  exchange: string;
  usdInrRate?: number | null;
  note?: string;
}

export interface PaperOrderRecord {
  id: string;
  timestamp: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  priceNative: number;
  currency: 'INR' | 'USD';
  totalUsdEquivalent: number;
  realizedPnlUsd: number;
  status: 'SIMULATED_FILLED';
}

export interface PaperPortfolioState {
  cashBalanceUsd: number;
  realizedPnlUsd: number;
  holdings: PaperHolding[];
  orders: PaperOrderRecord[];
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface HoldingValuation extends PaperHolding {
  currentPriceNative: number | null;
  priceStatus: 'LIVE' | 'DELAYED' | 'END_OF_DAY' | 'CACHED' | 'UNAVAILABLE';
  marketValueUsd: number | null;
  costBasisUsd: number | null;
  unrealizedPnlUsd: number | null;
  unrealizedPnlPct: number | null;
  weightPct: number | null;
}

export interface PortfolioMetrics {
  totalEquityUsd: number | null;
  cashBalanceUsd: number;
  investedValueUsd: number | null;
  unrealizedPnlUsd: number | null;
  unrealizedPnlPct: number | null;
  realizedPnlUsd: number;
  indiaExposurePct: number;
  usExposurePct: number;
  cashWeightPct: number;
  concentrationScore: number | null;
  riskLabel: 'Low' | 'Moderate' | 'Elevated' | 'Unavailable';
  fxAvailable: boolean;
  usdInrRate: number | null;
  unavailableHoldingsCount: number;
  valuations: HoldingValuation[];
}

export interface SeriesRiskMetrics {
  periodReturnPct: number | null;
  annualizedVolatilityPct: number | null;
  maxDrawdownPct: number | null;
  returnToVolatilityRatio: number | null;
  sufficientData: boolean;
  hasData: boolean;
}

export const EMPTY_PORTFOLIO_STATE: PaperPortfolioState = {
  cashBalanceUsd: 0,
  realizedPnlUsd: 0,
  holdings: [],
  orders: [],
};

export const CLEAN_PAPER_TRADING_STATE: PaperPortfolioState = {
  cashBalanceUsd: 100_000,
  realizedPnlUsd: 0,
  holdings: [],
  orders: [],
};

export function toStorageRegion(region: MarketRegion, currency: 'INR' | 'USD'): 'IN' | 'US' {
  if (region === 'IN' || region === 'US') return region;
  return currency === 'INR' ? 'IN' : 'US';
}

export function toUsdEquivalent(
  amountNative: number,
  currency: 'INR' | 'USD',
  usdInrRate: number | null,
): number | null {
  if (currency === 'USD') return amountNative;
  if (typeof usdInrRate !== 'number' || !Number.isFinite(usdInrRate) || usdInrRate <= 0) {
    return null;
  }
  return amountNative / usdInrRate;
}

export function validatePaperOrder(
  order: PaperOrderRequest,
  state: PaperPortfolioState,
  usdInrRate: number | null,
): ValidationResult {
  if (!order.symbol) {
    return { valid: false, error: 'Select a financial instrument before placing a paper order.' };
  }
  if (!Number.isFinite(order.quantity) || order.quantity <= 0) {
    return { valid: false, error: 'Quantity must be greater than zero.' };
  }
  if (order.quantity > 1_000_000) {
    return { valid: false, error: 'Quantity exceeds maximum simulated order limit (1,000,000 shares).' };
  }
  if (!Number.isFinite(order.executionPriceNative) || order.executionPriceNative <= 0) {
    return { valid: false, error: 'Live execution quote unavailable for this instrument.' };
  }

  const orderUsd = toUsdEquivalent(
    order.quantity * order.executionPriceNative,
    order.currency,
    usdInrRate,
  );
  if (orderUsd === null) {
    return {
      valid: false,
      error: 'Cannot value INR-denominated paper order while live/cached USD/INR FX rate is unavailable.',
    };
  }

  if (order.side === 'BUY') {
    if (orderUsd > state.cashBalanceUsd) {
      return {
        valid: false,
        error: `Insufficient simulated cash ($${state.cashBalanceUsd.toFixed(2)} available, $${orderUsd.toFixed(2)} required).`,
      };
    }
    return { valid: true };
  }

  const existing = state.holdings.find((h) => h.symbol === order.symbol);
  if (!existing || existing.quantity < order.quantity) {
    const owned = existing ? existing.quantity : 0;
    return {
      valid: false,
      error: `Insufficient simulated position for ${order.symbol} (${owned} shares held).`,
    };
  }

  return { valid: true };
}

export function executePaperOrder(
  state: PaperPortfolioState,
  order: PaperOrderRequest,
  usdInrRate: number | null = order.usdInrRate ?? null,
  timestampLabel = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
): { nextState: PaperPortfolioState; validation: ValidationResult } {
  const effectiveFx = usdInrRate ?? order.usdInrRate ?? null;
  const validation = validatePaperOrder(order, state, effectiveFx);
  if (!validation.valid) {
    return { nextState: state, validation };
  }

  const orderUsd = toUsdEquivalent(
    order.quantity * order.executionPriceNative,
    order.currency,
    effectiveFx,
  )!;
  const holdingsCopy = state.holdings.map((h) => ({ ...h }));
  const existingIdx = holdingsCopy.findIndex((h) => h.symbol === order.symbol);
  let realizedDeltaUsd = 0;
  let nextCashUsd = state.cashBalanceUsd;

  if (order.side === 'BUY') {
    nextCashUsd -= orderUsd;
    if (existingIdx >= 0) {
      const prev = holdingsCopy[existingIdx];
      const totalQty = prev.quantity + order.quantity;
      const weightedCost =
        (prev.quantity * prev.avgCostNative + order.quantity * order.executionPriceNative) /
        totalQty;
      holdingsCopy[existingIdx] = {
        ...prev,
        quantity: Number(totalQty.toFixed(4)),
        avgCostNative: Number(weightedCost.toFixed(4)),
      };
    } else {
      holdingsCopy.push({
        symbol: order.symbol,
        name: order.name,
        exchange: order.exchange,
        region: toStorageRegion(order.region, order.currency),
        currency: order.currency,
        quantity: Number(order.quantity.toFixed(4)),
        avgCostNative: Number(order.executionPriceNative.toFixed(4)),
      });
    }
  } else {
    nextCashUsd += orderUsd;
    const prev = holdingsCopy[existingIdx];
    const nativeGain = (order.executionPriceNative - prev.avgCostNative) * order.quantity;
    realizedDeltaUsd = toUsdEquivalent(nativeGain, order.currency, effectiveFx) ?? 0;
    const remaining = Number((prev.quantity - order.quantity).toFixed(4));
    if (remaining <= 0.0001) {
      holdingsCopy.splice(existingIdx, 1);
    } else {
      holdingsCopy[existingIdx] = { ...prev, quantity: remaining };
    }
  }

  const record: PaperOrderRecord = {
    id: `SIM-${Date.now().toString().slice(-6)}`,
    timestamp: timestampLabel,
    symbol: order.symbol,
    side: order.side,
    quantity: order.quantity,
    priceNative: order.executionPriceNative,
    currency: order.currency,
    totalUsdEquivalent: Number(orderUsd.toFixed(2)),
    realizedPnlUsd: Number(realizedDeltaUsd.toFixed(2)),
    status: 'SIMULATED_FILLED',
  };

  return {
    validation: { valid: true },
    nextState: {
      cashBalanceUsd: Number(nextCashUsd.toFixed(2)),
      realizedPnlUsd: Number((state.realizedPnlUsd + realizedDeltaUsd).toFixed(2)),
      holdings: holdingsCopy,
      orders: [record, ...state.orders],
    },
  };
}

export function calculatePortfolioMetrics(
  state: PaperPortfolioState,
  quotes: MarketQuoteDto[],
  usdInrRate: number | null,
): PortfolioMetrics {
  const bySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));
  const needsInrFx = state.holdings.some((h) => h.currency === 'INR');
  const fxAvailable = !needsInrFx || (typeof usdInrRate === 'number' && usdInrRate > 0);

  let investedValueUsd = 0;
  let totalCostBasisUsd = 0;
  let indiaUsd = 0;
  let usUsd = 0;
  let unavailableHoldingsCount = 0;

  const rawValuations = state.holdings.map((holding) => {
    const q = bySymbol.get(holding.symbol.toUpperCase());
    const hasPrice = Boolean(q && typeof q.price === 'number' && Number.isFinite(q.price) && q.price > 0);
    const currentPriceNative = hasPrice ? q!.price! : null;
    const marketValueUsd =
      currentPriceNative !== null
        ? toUsdEquivalent(currentPriceNative * holding.quantity, holding.currency, usdInrRate)
        : null;
    const costBasisUsd = toUsdEquivalent(
      holding.avgCostNative * holding.quantity,
      holding.currency,
      usdInrRate,
    );

    if (marketValueUsd === null) {
      unavailableHoldingsCount += 1;
    } else {
      investedValueUsd += marketValueUsd;
      if (holding.region === 'IN') indiaUsd += marketValueUsd;
      else usUsd += marketValueUsd;
    }

    if (costBasisUsd !== null) {
      totalCostBasisUsd += costBasisUsd;
    }

    const unrealizedPnlUsd =
      marketValueUsd !== null && costBasisUsd !== null ? marketValueUsd - costBasisUsd : null;
    const unrealizedPnlPct =
      unrealizedPnlUsd !== null && costBasisUsd && costBasisUsd > 0
        ? (unrealizedPnlUsd / costBasisUsd) * 100
        : null;

    const priceStatus: HoldingValuation['priceStatus'] =
      q && hasPrice
        ? q.status === 'LIVE' || q.status === 'DELAYED' || q.status === 'END_OF_DAY' || q.status === 'CACHED'
          ? q.status
          : 'DELAYED'
        : 'UNAVAILABLE';

    return {
      ...holding,
      currentPriceNative,
      priceStatus,
      marketValueUsd,
      costBasisUsd,
      unrealizedPnlUsd,
      unrealizedPnlPct,
    };
  });

  const allHoldingsValued = unavailableHoldingsCount === 0;
  const totalEquityUsd = allHoldingsValued
    ? Number((investedValueUsd + state.cashBalanceUsd).toFixed(2))
    : null;
  const denominator = investedValueUsd + state.cashBalanceUsd;

  const valuations: HoldingValuation[] = rawValuations.map((v) => ({
    ...v,
    marketValueUsd: v.marketValueUsd !== null ? Number(v.marketValueUsd.toFixed(2)) : null,
    costBasisUsd: v.costBasisUsd !== null ? Number(v.costBasisUsd.toFixed(2)) : null,
    unrealizedPnlUsd: v.unrealizedPnlUsd !== null ? Number(v.unrealizedPnlUsd.toFixed(2)) : null,
    unrealizedPnlPct: v.unrealizedPnlPct !== null ? Number(v.unrealizedPnlPct.toFixed(2)) : null,
    weightPct:
      v.marketValueUsd !== null && denominator > 0
        ? Number(((v.marketValueUsd / denominator) * 100).toFixed(1))
        : null,
  }));

  if (state.holdings.length === 0) {
    return {
      totalEquityUsd: Number(state.cashBalanceUsd.toFixed(2)),
      cashBalanceUsd: Number(state.cashBalanceUsd.toFixed(2)),
      investedValueUsd: 0,
      unrealizedPnlUsd: 0,
      unrealizedPnlPct: 0,
      realizedPnlUsd: Number(state.realizedPnlUsd.toFixed(2)),
      indiaExposurePct: 0,
      usExposurePct: 0,
      cashWeightPct: state.cashBalanceUsd > 0 ? 100 : 0,
      concentrationScore: 0,
      riskLabel: 'Low',
      fxAvailable,
      usdInrRate,
      unavailableHoldingsCount: 0,
      valuations,
    };
  }

  const hhi =
    investedValueUsd > 0 && allHoldingsValued
      ? rawValuations.reduce((acc, item) => {
          const share = (item.marketValueUsd ?? 0) / investedValueUsd;
          return acc + share * share;
        }, 0)
      : null;
  const concentrationScore = hhi !== null ? Math.round(hhi * 100) : null;

  const riskLabel: PortfolioMetrics['riskLabel'] =
    concentrationScore === null
      ? 'Unavailable'
      : concentrationScore > 45
        ? 'Elevated'
        : concentrationScore > 25
          ? 'Moderate'
          : 'Low';

  const unrealizedPnlUsd =
    allHoldingsValued && fxAvailable
      ? Number((investedValueUsd - totalCostBasisUsd).toFixed(2))
      : null;
  const unrealizedPnlPct =
    unrealizedPnlUsd !== null && totalCostBasisUsd > 0
      ? Number(((unrealizedPnlUsd / totalCostBasisUsd) * 100).toFixed(2))
      : null;

  return {
    totalEquityUsd,
    cashBalanceUsd: Number(state.cashBalanceUsd.toFixed(2)),
    investedValueUsd: allHoldingsValued ? Number(investedValueUsd.toFixed(2)) : null,
    unrealizedPnlUsd,
    unrealizedPnlPct,
    realizedPnlUsd: Number(state.realizedPnlUsd.toFixed(2)),
    indiaExposurePct: denominator > 0 ? Number(((indiaUsd / denominator) * 100).toFixed(1)) : 0,
    usExposurePct: denominator > 0 ? Number(((usUsd / denominator) * 100).toFixed(1)) : 0,
    cashWeightPct: denominator > 0 ? Number(((state.cashBalanceUsd / denominator) * 100).toFixed(1)) : 0,
    concentrationScore,
    riskLabel,
    fxAvailable,
    usdInrRate,
    unavailableHoldingsCount,
    valuations,
  };
}

export function calculateSeriesRiskMetrics(prices: number[]): SeriesRiskMetrics {
  if (prices.length < 3) {
    return {
      periodReturnPct: null,
      annualizedVolatilityPct: null,
      maxDrawdownPct: null,
      returnToVolatilityRatio: null,
      sufficientData: false,
      hasData: false,
    };
  }

  const start = prices[0];
  const end = prices[prices.length - 1];
  const periodReturnPct = start > 0 ? ((end - start) / start) * 100 : 0;

  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
  }

  const mean = returns.reduce((a, b) => a + b, 0) / Math.max(1, returns.length);
  const variance =
    returns.reduce((acc, r) => acc + (r - mean) * (r - mean), 0) /
    Math.max(1, returns.length - 1);
  const stdev = Math.sqrt(variance);
  const annualizedVolatilityPct = stdev * Math.sqrt(252) * 100;

  let peak = prices[0];
  let maxDrawdown = 0;
  for (const p of prices) {
    if (p > peak) peak = p;
    if (peak > 0) {
      const dd = ((peak - p) / peak) * 100;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
  }

  const returnToVolatilityRatio =
    annualizedVolatilityPct > 0 ? periodReturnPct / annualizedVolatilityPct : 0;

  return {
    periodReturnPct: Number(periodReturnPct.toFixed(2)),
    annualizedVolatilityPct: Number(annualizedVolatilityPct.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdown.toFixed(2)),
    returnToVolatilityRatio: Number(returnToVolatilityRatio.toFixed(2)),
    sufficientData: true,
    hasData: true,
  };
}
