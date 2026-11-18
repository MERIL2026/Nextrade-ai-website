import type { MarketRegion, TimeframeKey } from '../lib/marketData';
import type { Permission } from '../auth/rbac';
import type { UserRole } from '../auth/db';
import type { PublicAuthUser } from '../auth/service';

export interface WorkspaceHolding {
  id: string;
  portfolioId: string;
  symbol: string;
  exchange: string;
  region: MarketRegion;
  name: string;
  quantity: number;
  avgCostNative: number;
  currency: 'USD' | 'INR';
  createdAt: string;
  updatedAt: string;
}

export interface WorkspacePortfolio {
  id: string;
  userId: string;
  name: string;
  baseCurrency: 'USD' | 'INR';
  initialBalanceUsd: number;
  cashBalanceUsd: number;
  realizedPnlUsd: number;
  isDefault: boolean;
  holdings: WorkspaceHolding[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceWatchlistItem {
  id: string;
  watchlistId: string;
  symbol: string;
  exchange: string;
  addedAt: string;
}

export interface WorkspaceWatchlist {
  id: string;
  userId: string;
  name: string;
  isDefault: boolean;
  items: WorkspaceWatchlistItem[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspacePaperAccount {
  id: string;
  userId: string;
  portfolioId: string;
  startingBalanceUsd: number;
  cashBalanceUsd: number;
  realizedPnlUsd: number;
  currency: 'USD' | 'INR';
  createdAt: string;
  updatedAt: string;
}

export interface WorkspacePaperOrder {
  id: string;
  userId: string;
  accountId: string;
  portfolioId: string;
  clientOrderId: string | null;
  symbol: string;
  exchange: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT';
  quantity: number;
  requestedPriceNative: number;
  executionPriceNative: number;
  currency: 'USD' | 'INR';
  totalUsdEquivalent: number;
  realizedPnlUsd: number;
  status: 'FILLED' | 'REJECTED' | 'CANCELLED';
  createdAt: string;
  executedAt: string | null;
}

export interface WorkspacePaperTransaction {
  id: string;
  userId: string;
  accountId: string;
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  priceNative: number;
  feesNative: number;
  totalUsdEquivalent: number;
  realizedPnlUsd: number;
  currency: 'USD' | 'INR';
  createdAt: string;
}

export interface WorkspaceResearchResultPayload {
  symbol: string;
  source: 'gemini' | 'unavailable' | string;
  model: string;
  summary: string;
  keyDrivers: string[];
  riskFactors: string[];
  explainabilityBasis: string;
  disclaimer: string;
}

export interface WorkspaceResearchItem {
  id: string;
  userId: string;
  symbol: string;
  query: string;
  result: WorkspaceResearchResultPayload;
  source: string;
  model: string;
  createdAt: string;
}

export interface WorkspaceSavedReport {
  id: string;
  userId: string;
  title: string;
  reportType: 'research-brief' | 'portfolio-snapshot' | 'risk-note';
  symbol: string;
  content: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceDefaultTab =
  | 'home'
  | 'markets'
  | 'research'
  | 'portfolio'
  | 'paper-trading'
  | 'watchlist'
  | 'analytics';

export interface UserPreferencesPayload {
  defaultRegion: 'ALL' | MarketRegion;
  defaultCurrency: 'USD' | 'INR';
  defaultTab: WorkspaceDefaultTab;
  defaultTimeframe: TimeframeKey;
  compactTables: boolean;
  researchAutoSave: boolean;
}

export interface WorkspaceProfilePayload {
  user: PublicAuthUser;
  role: UserRole;
  permissions: Permission[];
  defaultPortfolioId: string;
  defaultWatchlistId: string;
  legacyImportedAt: string | null;
  summary: {
    portfolioCount: number;
    watchlistCount: number;
    watchlistItemCount: number;
    ordersCount: number;
    researchCount: number;
    savedReportsCount: number;
  };
}

export interface LegacyImportSummary {
  importedAt: string;
  importedHoldingsCount: number;
  importedWatchlistCount: number;
  importedOrdersCount: number;
  importedRegion: 'ALL' | MarketRegion | null;
}
