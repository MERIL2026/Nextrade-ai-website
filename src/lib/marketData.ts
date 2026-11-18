export type {
  AssetCategory,
  AssetCategory as InstrumentCategory,
  CatalogIndex,
  CatalogInstrument,
  DataSourceStatus,
  DataSourceStatus as DataClassification,
  FxRateDto,
  MarketHistoryResponseDto,
  MarketIndexDto,
  MarketOverviewResponseDto,
  MarketPricePoint,
  MarketPricePoint as HistoricalPoint,
  MarketProviderStatusDto,
  MarketQuoteDto,
  MarketRegion,
  MarketSearchResultDto,
  TimeframeKey,
} from '../market/types';

export {
  CATALOG_INDICES,
  CATALOG_INSTRUMENTS,
  findCatalogIndex,
  findCatalogInstrument,
} from '../market/catalog';

import type { AssetCategory, DataSourceStatus, MarketRegion } from '../market/types';

export function filterInstruments<
  T extends {
    symbol: string;
    name: string;
    sector?: string;
    exchange?: string;
    region: MarketRegion;
    category?: AssetCategory;
  },
>(
  instruments: readonly T[],
  searchQuery: string,
  regionFilter: 'ALL' | MarketRegion = 'ALL',
  categoryFilter: 'ALL' | AssetCategory = 'ALL',
): T[] {
  const q = searchQuery.trim().toLowerCase();
  return instruments.filter((inst) => {
    if (regionFilter !== 'ALL' && inst.region !== regionFilter) return false;
    if (categoryFilter !== 'ALL' && inst.category && inst.category !== categoryFilter) return false;
    if (!q) return true;
    return (
      inst.symbol.toLowerCase().includes(q) ||
      inst.name.toLowerCase().includes(q) ||
      (inst.sector ?? '').toLowerCase().includes(q) ||
      (inst.exchange ?? '').toLowerCase().includes(q)
    );
  });
}

export function formatCurrencyValue(
  value: number | null | undefined,
  currency: 'INR' | 'USD',
  maximumFractionDigits?: number,
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Unavailable';
  }
  const symbol = currency === 'INR' ? '₹' : '$';
  const decimals =
    maximumFractionDigits !== undefined ? maximumFractionDigits : value < 10 ? 4 : 2;
  return `${symbol}${value.toLocaleString('en-US', {
    minimumFractionDigits: Math.min(2, decimals),
    maximumFractionDigits: decimals,
  })}`;
}

export function formatSignedPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatVolume(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 'Unavailable';
  }
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString('en-US');
}

export function getDataStatusLabel(status: DataSourceStatus): string {
  switch (status) {
    case 'LIVE':
      return 'LIVE';
    case 'DELAYED':
      return 'DELAYED';
    case 'END_OF_DAY':
      return 'END OF DAY';
    case 'CACHED':
      return 'CACHED';
    case 'SIMULATED':
      return 'SIMULATED';
    case 'NOT_CONFIGURED':
      return 'NOT CONFIGURED';
    case 'BUILDING':
      return 'BUILDING';
    case 'UNAVAILABLE':
    default:
      return 'UNAVAILABLE';
  }
}

export function getDataStatusColorClass(status: DataSourceStatus): string {
  switch (status) {
    case 'LIVE':
      return 'text-[#15803D]';
    case 'DELAYED':
    case 'END_OF_DAY':
      return 'text-[#2D46E6]';
    case 'CACHED':
    case 'BUILDING':
      return 'text-[#B45309]';
    case 'SIMULATED':
      return 'text-[#0F766E]';
    case 'NOT_CONFIGURED':
    case 'UNAVAILABLE':
    default:
      return 'text-[#B91C1C]';
  }
}
