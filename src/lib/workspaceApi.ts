import type {
  LegacyImportSummary,
  UserPreferencesPayload,
  WorkspacePaperAccount,
  WorkspacePaperOrder,
  WorkspacePaperTransaction,
  WorkspacePortfolio,
  WorkspaceProfilePayload,
  WorkspaceResearchItem,
  WorkspaceSavedReport,
  WorkspaceWatchlist,
  WorkspaceWatchlistItem,
} from '../workspace/types';

export class WorkspaceUnauthorizedError extends Error {
  constructor() {
    super('Your session has expired. Please sign in again.');
    this.name = 'WorkspaceUnauthorizedError';
  }
}

export class WorkspaceApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'WorkspaceApiError';
    this.status = status;
    this.code = code;
  }
}

async function wsRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/workspace${path}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 401) {
    throw new WorkspaceUnauthorizedError();
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new WorkspaceApiError(
      typeof body.error === 'string' ? body.error : `Workspace request failed (${res.status}).`,
      res.status,
      typeof body.code === 'string' ? body.code : undefined,
    );
  }
  return body as T;
}

export const workspaceApi = {
  getProfile: () => wsRequest<WorkspaceProfilePayload & { ok: true }>('/profile'),

  // Portfolios
  listPortfolios: () =>
    wsRequest<{ ok: true; portfolios: WorkspacePortfolio[] }>('/portfolios').then((d) => d.portfolios),
  createPortfolio: (payload: { name: string; baseCurrency?: 'USD' | 'INR'; initialBalanceUsd?: number }) =>
    wsRequest<{ ok: true; portfolio: WorkspacePortfolio }>('/portfolios', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then((d) => d.portfolio),
  updatePortfolio: (id: string, payload: { name?: string; isDefault?: boolean }) =>
    wsRequest<{ ok: true; portfolio: WorkspacePortfolio }>(`/portfolios/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }).then((d) => d.portfolio),
  deletePortfolio: (id: string) =>
    wsRequest<{ ok: true; deleted: true; id: string }>(`/portfolios/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  upsertHolding: (
    portfolioId: string,
    symbol: string,
    payload: { quantity: number; avgCostNative?: number },
  ) =>
    wsRequest<{ ok: true; portfolio: WorkspacePortfolio }>(
      `/portfolios/${encodeURIComponent(portfolioId)}/holdings/${encodeURIComponent(symbol)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
    ).then((d) => d.portfolio),
  deleteHolding: (portfolioId: string, symbol: string) =>
    wsRequest<{ ok: true; portfolio: WorkspacePortfolio }>(
      `/portfolios/${encodeURIComponent(portfolioId)}/holdings/${encodeURIComponent(symbol)}`,
      {
        method: 'DELETE',
      },
    ).then((d) => d.portfolio),

  // Watchlists
  listWatchlists: () =>
    wsRequest<{ ok: true; watchlists: WorkspaceWatchlist[] }>('/watchlists').then((d) => d.watchlists),
  createWatchlist: (name: string) =>
    wsRequest<{ ok: true; watchlist: WorkspaceWatchlist }>('/watchlists', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }).then((d) => d.watchlist),
  updateWatchlist: (id: string, payload: { name?: string; isDefault?: boolean }) =>
    wsRequest<{ ok: true; watchlist: WorkspaceWatchlist }>(`/watchlists/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }).then((d) => d.watchlist),
  deleteWatchlist: (id: string) =>
    wsRequest<{ ok: true; deleted: true; id: string }>(`/watchlists/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  addWatchlistItem: (watchlistId: string, symbol: string) =>
    wsRequest<{ ok: true; item: WorkspaceWatchlistItem }>(
      `/watchlists/${encodeURIComponent(watchlistId)}/items`,
      {
        method: 'POST',
        body: JSON.stringify({ symbol }),
      },
    ).then((d) => d.item),
  removeWatchlistItem: (watchlistId: string, itemIdOrSymbol: string) =>
    wsRequest<{ ok: true; deleted: true; itemId: string }>(
      `/watchlists/${encodeURIComponent(watchlistId)}/items/${encodeURIComponent(itemIdOrSymbol)}`,
      {
        method: 'DELETE',
      },
    ),

  // Paper Trading
  getPaperAccount: () =>
    wsRequest<{ ok: true; account: WorkspacePaperAccount; portfolio: WorkspacePortfolio }>(
      '/paper-trading/account',
    ),
  listPaperOrders: (params?: { limit?: number; offset?: number; symbol?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    if (params?.symbol) qs.set('symbol', params.symbol);
    const queryStr = qs.toString() ? `?${qs.toString()}` : '';
    return wsRequest<{ ok: true; orders: WorkspacePaperOrder[]; total: number }>(
      `/paper-trading/orders${queryStr}`,
    );
  },
  listPaperTransactions: (params?: { limit?: number; offset?: number; symbol?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    if (params?.symbol) qs.set('symbol', params.symbol);
    const queryStr = qs.toString() ? `?${qs.toString()}` : '';
    return wsRequest<{ ok: true; transactions: WorkspacePaperTransaction[]; total: number }>(
      `/paper-trading/transactions${queryStr}`,
    );
  },
  executePaperOrder: (payload: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    orderType?: 'MARKET' | 'LIMIT';
    clientOrderId?: string;
  }) =>
    wsRequest<{
      ok: true;
      order: WorkspacePaperOrder;
      transaction: WorkspacePaperTransaction;
      account: WorkspacePaperAccount;
      portfolio: WorkspacePortfolio;
      deduplicated: boolean;
    }>('/paper-trading/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  resetPaperAccount: (mode: 'clean' | 'starter' = 'clean') =>
    wsRequest<{ ok: true; account: WorkspacePaperAccount; portfolio: WorkspacePortfolio }>(
      '/paper-trading/reset',
      {
        method: 'POST',
        body: JSON.stringify({ mode }),
      },
    ),

  // Research & Reports
  listResearchHistory: (params?: { symbol?: string; search?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.symbol) qs.set('symbol', params.symbol);
    if (params?.search) qs.set('search', params.search);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const queryStr = qs.toString() ? `?${qs.toString()}` : '';
    return wsRequest<{ ok: true; items: WorkspaceResearchItem[]; total: number }>(
      `/research${queryStr}`,
    );
  },
  runResearch: (payload: { symbol: string; query: string }) =>
    wsRequest<{ ok: true; item: WorkspaceResearchItem }>('/research', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then((d) => d.item),
  deleteResearchItem: (id: string) =>
    wsRequest<{ ok: true; deleted: true; id: string }>(`/research/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  listSavedReports: () =>
    wsRequest<{ ok: true; reports: WorkspaceSavedReport[] }>('/reports').then((d) => d.reports),
  createSavedReport: (payload: {
    title: string;
    reportType: 'research-brief' | 'portfolio-snapshot' | 'risk-note';
    symbol: string;
    content: Record<string, unknown>;
  }) =>
    wsRequest<{ ok: true; report: WorkspaceSavedReport }>('/reports', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then((d) => d.report),
  deleteSavedReport: (id: string) =>
    wsRequest<{ ok: true; deleted: true; id: string }>(`/reports/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Preferences & Legacy Import
  getPreferences: () =>
    wsRequest<{ ok: true; preferences: UserPreferencesPayload }>('/preferences').then(
      (d) => d.preferences,
    ),
  updatePreferences: (patch: Partial<UserPreferencesPayload>) =>
    wsRequest<{ ok: true; preferences: UserPreferencesPayload }>('/preferences', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).then((d) => d.preferences),
  importLegacyData: (payload: {
    portfolio?: unknown;
    watchlist?: unknown;
    defaultRegion?: unknown;
  }) =>
    wsRequest<{ ok: true } & LegacyImportSummary>('/import-legacy', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
