export type MarketRegion = 'IN' | 'US' | 'GLOBAL';
export type AssetCategory = 'STOCK' | 'INDEX' | 'ETF' | 'CRYPTO' | 'FOREX';
export type TimeframeKey = '1D' | '1W' | '1M' | '6M' | '1Y';

export type DataSourceStatus =
  | 'LIVE'
  | 'DELAYED'
  | 'END_OF_DAY'
  | 'CACHED'
  | 'SIMULATED'
  | 'UNAVAILABLE'
  | 'NOT_CONFIGURED'
  | 'BUILDING';

export interface CatalogInstrument {
  symbol: string;
  name: string;
  exchange: string;
  region: MarketRegion;
  category: AssetCategory;
  currency: 'INR' | 'USD';
  sector: string;
  coingeckoId?: string;
  fxBase?: string;
  fxQuote?: string;
}

export interface CatalogIndex {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  region: MarketRegion;
  currency: 'INR' | 'USD';
}

export interface MarketPricePoint {
  label: string;
  timestamp: string;
  price: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
}

export interface MarketQuoteDto {
  symbol: string;
  name: string;
  exchange: string;
  region: MarketRegion;
  category: AssetCategory;
  currency: 'INR' | 'USD';
  sector: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
  volume: number | null;
  providerId: string;
  providerName: string;
  status: DataSourceStatus;
  delayMinutes: number;
  sourceTimestamp: string | null;
  fetchedAt: string | null;
  unavailableReason?: string | null;
}

export interface MarketIndexDto {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  region: MarketRegion;
  currency: 'INR' | 'USD';
  value: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  sparkline: number[];
  providerId: string;
  providerName: string;
  status: DataSourceStatus;
  delayMinutes: number;
  fetchedAt: string | null;
  unavailableReason?: string | null;
}

export interface MarketHistoryResponseDto {
  symbol: string;
  name: string;
  exchange: string;
  currency: 'INR' | 'USD';
  timeframe: TimeframeKey;
  points: MarketPricePoint[];
  providerId: string;
  providerName: string;
  status: DataSourceStatus;
  delayMinutes: number;
  fetchedAt: string | null;
  unavailableReason?: string | null;
}

export interface FxRateDto {
  pair: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: number | null;
  providerId: string;
  providerName: string;
  status: DataSourceStatus;
  sourceDate: string | null;
  fetchedAt: string | null;
  unavailableReason?: string | null;
}

export interface MarketSearchResultDto {
  symbol: string;
  name: string;
  exchange: string;
  region: MarketRegion;
  category: AssetCategory;
  currency: 'INR' | 'USD';
  sector: string;
  providerId: string;
}

export interface MarketProviderStatusDto {
  id: string;
  name: string;
  configured: boolean;
  requiresKey: boolean;
  envKeyName?: string;
  categories: AssetCategory[];
  exchanges: string[];
  status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
  classification: DataSourceStatus;
  latencyMs: number | null;
  lastCheckedAt: string | null;
  detail: string;
}

export interface MarketOverviewResponseDto {
  indices: MarketIndexDto[];
  instruments: MarketQuoteDto[];
  fx: {
    usdInr: FxRateDto;
  };
  providers: MarketProviderStatusDto[];
  summary: {
    totalInstruments: number;
    availableQuotes: number;
    unavailableQuotes: number;
    cachedQuotes: number;
    overallStatus: DataSourceStatus;
    fetchedAt: string;
  };
}
