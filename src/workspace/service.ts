import crypto from 'node:crypto';
import type { AuthDatabase, AuthQueryRunner } from '../auth/db';
import { normalizeUserRole, resolveUserPermissions } from '../auth/rbac';
import type { PublicAuthUser } from '../auth/service';
import {
  findCatalogInstrument,
  type MarketRegion,
  type TimeframeKey,
} from '../lib/marketData';
import {
  CLEAN_PAPER_TRADING_STATE,
  EMPTY_PORTFOLIO_STATE,
  toStorageRegion,
  toUsdEquivalent,
} from '../lib/portfolioEngine';
import { executeFinancialResearch, type ResearchResponsePayload } from '../lib/researchEngine';
import type { MarketQuoteDto, MarketService } from '../market';
import type { RuntimeConfigManager } from '../admin/runtimeSettings';
import { sanitizePortfolioState, sanitizeWatchlist, stripControlChars } from '../lib/security';
import type {
  LegacyImportSummary,
  UserPreferencesPayload,
  WorkspaceDefaultTab,
  WorkspaceHolding,
  WorkspacePaperAccount,
  WorkspacePaperOrder,
  WorkspacePaperTransaction,
  WorkspacePortfolio,
  WorkspaceProfilePayload,
  WorkspaceResearchItem,
  WorkspaceResearchResultPayload,
  WorkspaceSavedReport,
  WorkspaceWatchlist,
  WorkspaceWatchlistItem,
} from './types';

const QUANTITY_SCALE = 10_000;
const MAX_PORTFOLIOS_PER_USER = 10;
const MAX_WATCHLISTS_PER_USER = 10;
const MAX_WATCHLIST_ITEMS = 50;
const MAX_SAVED_REPORTS = 100;

export const DEFAULT_USER_PREFERENCES: UserPreferencesPayload = {
  defaultRegion: 'ALL',
  defaultCurrency: 'USD',
  defaultTab: 'home',
  defaultTimeframe: '1M',
  compactTables: false,
  researchAutoSave: true,
};

export type WorkspaceOutcome<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; code?: string };

interface DbPortfolioRow {
  id: string;
  user_id: string;
  name: string;
  base_currency: 'USD' | 'INR';
  initial_balance_cents: number | string;
  cash_balance_cents: number | string;
  realized_pnl_cents: number | string;
  is_default: number | boolean;
  created_at: string | Date;
  updated_at: string | Date;
}

interface DbHoldingRow {
  id: string;
  portfolio_id: string;
  user_id: string;
  symbol: string;
  exchange: string;
  region: MarketRegion;
  name: string;
  quantity_units: number | string;
  avg_cost_minor: number | string;
  currency: 'USD' | 'INR';
  created_at: string | Date;
  updated_at: string | Date;
}

interface DbWatchlistRow {
  id: string;
  user_id: string;
  name: string;
  is_default: number | boolean;
  created_at: string | Date;
  updated_at: string | Date;
}

interface DbWatchlistItemRow {
  id: string;
  watchlist_id: string;
  user_id: string;
  symbol: string;
  exchange: string;
  added_at: string | Date;
}

interface DbPaperAccountRow {
  id: string;
  user_id: string;
  portfolio_id: string;
  starting_balance_cents: number | string;
  cash_balance_cents: number | string;
  realized_pnl_cents: number | string;
  currency: 'USD' | 'INR';
  created_at: string | Date;
  updated_at: string | Date;
}

interface DbPaperOrderRow {
  id: string;
  user_id: string;
  account_id: string;
  portfolio_id: string;
  client_order_id: string | null;
  symbol: string;
  exchange: string;
  side: 'BUY' | 'SELL';
  order_type: 'MARKET' | 'LIMIT';
  quantity_units: number | string;
  requested_price_minor: number | string;
  execution_price_minor: number | string;
  currency: 'USD' | 'INR';
  total_usd_cents: number | string;
  realized_pnl_cents: number | string;
  status: 'FILLED' | 'REJECTED' | 'CANCELLED';
  created_at: string | Date;
  executed_at: string | Date | null;
}

interface DbPaperTxRow {
  id: string;
  user_id: string;
  account_id: string;
  order_id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity_units: number | string;
  price_minor: number | string;
  fees_minor: number | string;
  total_usd_cents: number | string;
  realized_pnl_cents: number | string;
  currency: 'USD' | 'INR';
  created_at: string | Date;
}

interface DbResearchRow {
  id: string;
  user_id: string;
  symbol: string;
  query: string;
  research_result_json: string;
  source: string;
  model: string;
  created_at: string | Date;
}

interface DbReportRow {
  id: string;
  user_id: string;
  title: string;
  report_type: string;
  symbol: string;
  report_content_json: string;
  created_at: string | Date;
  updated_at: string | Date;
}

interface DbPreferencesRow {
  id: string;
  user_id: string;
  preferences_json: string;
  legacy_imported_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function toNum(v: number | string | null | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toIso(v: string | Date | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function toBool(v: number | boolean | null | undefined): boolean {
  return v === true || v === 1;
}

function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

function fromMinorUnits(minor: number | string): number {
  return Number((toNum(minor) / 100).toFixed(2));
}

function toQtyUnits(qty: number): number {
  return Math.round(qty * QUANTITY_SCALE);
}

function fromQtyUnits(units: number | string): number {
  return Number((toNum(units) / QUANTITY_SCALE).toFixed(4));
}

function toUsdCentsFromNativeMinor(
  qtyUnits: number,
  priceMinor: number,
  currency: 'USD' | 'INR',
  usdInrRate: number | null,
): number | null {
  const nativeMajor = (qtyUnits / QUANTITY_SCALE) * (priceMinor / 100);
  const usdMajor = toUsdEquivalent(nativeMajor, currency, usdInrRate);
  if (usdMajor === null) return null;
  return Math.round(usdMajor * 100);
}

interface ResolvedInstrumentMeta {
  symbol: string;
  name: string;
  exchange: string;
  region: MarketRegion;
  storageRegion: 'IN' | 'US';
  currency: 'USD' | 'INR';
}

function isValidUuid(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(id.trim());
}

function mapHoldingRow(row: DbHoldingRow): WorkspaceHolding {
  return {
    id: row.id,
    portfolioId: row.portfolio_id,
    symbol: row.symbol,
    exchange: row.exchange,
    region: row.region,
    name: row.name,
    quantity: fromQtyUnits(row.quantity_units),
    avgCostNative: fromMinorUnits(row.avg_cost_minor),
    currency: row.currency,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapPortfolioRow(
  row: DbPortfolioRow,
  holdings: WorkspaceHolding[],
): WorkspacePortfolio {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    baseCurrency: row.base_currency,
    initialBalanceUsd: fromMinorUnits(row.initial_balance_cents),
    cashBalanceUsd: fromMinorUnits(row.cash_balance_cents),
    realizedPnlUsd: fromMinorUnits(row.realized_pnl_cents),
    isDefault: toBool(row.is_default),
    holdings,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapWatchlistItemRow(row: DbWatchlistItemRow): WorkspaceWatchlistItem {
  return {
    id: row.id,
    watchlistId: row.watchlist_id,
    symbol: row.symbol,
    exchange: row.exchange,
    addedAt: toIso(row.added_at),
  };
}

function mapWatchlistRow(
  row: DbWatchlistRow,
  items: WorkspaceWatchlistItem[],
): WorkspaceWatchlist {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    isDefault: toBool(row.is_default),
    items,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapPaperAccountRow(row: DbPaperAccountRow): WorkspacePaperAccount {
  return {
    id: row.id,
    userId: row.user_id,
    portfolioId: row.portfolio_id,
    startingBalanceUsd: fromMinorUnits(row.starting_balance_cents),
    cashBalanceUsd: fromMinorUnits(row.cash_balance_cents),
    realizedPnlUsd: fromMinorUnits(row.realized_pnl_cents),
    currency: row.currency,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapPaperOrderRow(row: DbPaperOrderRow): WorkspacePaperOrder {
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    portfolioId: row.portfolio_id,
    clientOrderId: row.client_order_id,
    symbol: row.symbol,
    exchange: row.exchange,
    side: row.side,
    orderType: row.order_type,
    quantity: fromQtyUnits(row.quantity_units),
    requestedPriceNative: fromMinorUnits(row.requested_price_minor),
    executionPriceNative: fromMinorUnits(row.execution_price_minor),
    currency: row.currency,
    totalUsdEquivalent: fromMinorUnits(row.total_usd_cents),
    realizedPnlUsd: fromMinorUnits(row.realized_pnl_cents),
    status: row.status,
    createdAt: toIso(row.created_at),
    executedAt: row.executed_at ? toIso(row.executed_at) : null,
  };
}

function mapPaperTxRow(row: DbPaperTxRow): WorkspacePaperTransaction {
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    orderId: row.order_id,
    symbol: row.symbol,
    side: row.side,
    quantity: fromQtyUnits(row.quantity_units),
    priceNative: fromMinorUnits(row.price_minor),
    feesNative: fromMinorUnits(row.fees_minor),
    totalUsdEquivalent: fromMinorUnits(row.total_usd_cents),
    realizedPnlUsd: fromMinorUnits(row.realized_pnl_cents),
    currency: row.currency,
    createdAt: toIso(row.created_at),
  };
}

function sanitizePreferencesObject(raw: unknown, base: UserPreferencesPayload): UserPreferencesPayload {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const validRegions = new Set(['ALL', 'IN', 'US', 'GLOBAL']);
  const validCurrencies = new Set(['USD', 'INR']);
  const validTabs = new Set<WorkspaceDefaultTab>([
    'home',
    'markets',
    'research',
    'portfolio',
    'paper-trading',
    'watchlist',
    'analytics',
  ]);
  const validTimeframes = new Set<TimeframeKey>(['1D', '1W', '1M', '6M', '1Y']);

  return {
    defaultRegion:
      typeof input.defaultRegion === 'string' && validRegions.has(input.defaultRegion)
        ? (input.defaultRegion as UserPreferencesPayload['defaultRegion'])
        : base.defaultRegion,
    defaultCurrency:
      typeof input.defaultCurrency === 'string' && validCurrencies.has(input.defaultCurrency)
        ? (input.defaultCurrency as UserPreferencesPayload['defaultCurrency'])
        : base.defaultCurrency,
    defaultTab:
      typeof input.defaultTab === 'string' && validTabs.has(input.defaultTab as WorkspaceDefaultTab)
        ? (input.defaultTab as WorkspaceDefaultTab)
        : base.defaultTab,
    defaultTimeframe:
      typeof input.defaultTimeframe === 'string' &&
      validTimeframes.has(input.defaultTimeframe as TimeframeKey)
        ? (input.defaultTimeframe as TimeframeKey)
        : base.defaultTimeframe,
    compactTables:
      typeof input.compactTables === 'boolean' ? input.compactTables : base.compactTables,
    researchAutoSave:
      typeof input.researchAutoSave === 'boolean' ? input.researchAutoSave : base.researchAutoSave,
  };
}

function parseResearchJson(raw: string, fallbackSymbol: string): WorkspaceResearchResultPayload {
  try {
    const p = JSON.parse(raw) as Partial<WorkspaceResearchResultPayload>;
    return {
      symbol: typeof p.symbol === 'string' ? p.symbol : fallbackSymbol,
      source: p.source === 'gemini' ? 'gemini' : 'unavailable',
      model: typeof p.model === 'string' ? p.model : 'unavailable',
      summary: typeof p.summary === 'string' ? p.summary : '',
      keyDrivers: Array.isArray(p.keyDrivers) ? p.keyDrivers.filter((x): x is string => typeof x === 'string') : [],
      riskFactors: Array.isArray(p.riskFactors) ? p.riskFactors.filter((x): x is string => typeof x === 'string') : [],
      explainabilityBasis: typeof p.explainabilityBasis === 'string' ? p.explainabilityBasis : '',
      disclaimer: typeof p.disclaimer === 'string' ? p.disclaimer : '',
    };
  } catch {
    return {
      symbol: fallbackSymbol,
      source: 'unavailable',
      model: 'unavailable',
      summary: 'Research summary unavailable.',
      keyDrivers: [],
      riskFactors: [],
      explainabilityBasis: '',
      disclaimer: 'Informational research only.',
    };
  }
}

export interface WorkspaceServiceOptions {
  db: AuthDatabase;
  runtimeConfigManager?: RuntimeConfigManager;
  marketService?: MarketService;
  quoteResolver?: (symbol: string) => Promise<MarketQuoteDto>;
  fxResolver?: () => Promise<number | null>;
  researchExecutor?: (params: {
    symbol: string;
    query: string;
    liveQuote?: MarketQuoteDto | null;
    runtimeConfigManager?: RuntimeConfigManager;
    userId?: string | null;
    feature?: 'workspace_research' | 'public_research';
  }) => Promise<ResearchResponsePayload>;
}

export function createWorkspaceService(options: WorkspaceServiceOptions) {
  const { db, runtimeConfigManager, marketService } = options;
  const runResearch = options.researchExecutor ?? executeFinancialResearch;
  const isPg = db.dialect === 'postgres';
  const boolVal = (v: boolean) => (isPg ? v : v ? 1 : 0);

  async function resolveUsdInrRate(): Promise<number | null> {
    if (options.fxResolver) {
      return options.fxResolver();
    }
    if (marketService) {
      const fx = await marketService.getUsdInrRate();
      return fx.rate;
    }
    return null;
  }

  async function resolveQuote(symbol: string): Promise<MarketQuoteDto | null> {
    if (options.quoteResolver) {
      return options.quoteResolver(symbol);
    }
    if (marketService) {
      return marketService.getQuote(symbol);
    }
    return null;
  }

  async function resolveInstrumentMeta(symbolRaw: unknown): Promise<ResolvedInstrumentMeta | undefined> {
    if (typeof symbolRaw !== 'string') return undefined;
    const clean = stripControlChars(symbolRaw, 24).toUpperCase();
    if (!/^[A-Z0-9^.=_-]{1,24}$/.test(clean)) return undefined;

    const cat = findCatalogInstrument(clean);
    if (cat) {
      return {
        symbol: cat.symbol,
        name: cat.name,
        exchange: cat.exchange,
        region: cat.region,
        storageRegion: toStorageRegion(cat.region, cat.currency),
        currency: cat.currency,
      };
    }

    const q = await resolveQuote(clean).catch(() => null);
    if (q && q.price !== null) {
      return {
        symbol: q.symbol,
        name: q.name,
        exchange: q.exchange,
        region: q.region,
        storageRegion: toStorageRegion(q.region, q.currency),
        currency: q.currency,
      };
    }

    return undefined;
  }

  async function acquireUserLock(tx: AuthQueryRunner, userId: string): Promise<void> {
    if (tx.dialect === 'postgres') {
      await tx.execute('', 'SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);
    }
  }

  async function logAuditEvent(
    runner: AuthQueryRunner,
    params: {
      userId: string;
      eventType: string;
      ipAddress?: string;
      userAgent?: string;
      detail: string;
    },
  ): Promise<void> {
    await runner.execute(
      `INSERT INTO auth_security_events (id, user_id, event_type, ip_address, user_agent, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      `INSERT INTO auth_security_events (id, user_id, event_type, ip_address, user_agent, detail, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)`,
      [
        crypto.randomUUID(),
        params.userId,
        stripControlChars(params.eventType, 64),
        stripControlChars(params.ipAddress ?? 'unknown', 64) || 'unknown',
        stripControlChars(params.userAgent ?? 'unknown', 240) || 'unknown',
        stripControlChars(params.detail, 400),
        new Date().toISOString(),
      ],
    );
  }

  async function ensureUserWorkspaceInTx(tx: AuthQueryRunner, userId: string): Promise<{
    defaultPortfolioId: string;
    defaultWatchlistId: string;
    paperAccountId: string;
  }> {
    await acquireUserLock(tx, userId);
    const nowIso = new Date().toISOString();

    let portfolio = await tx.queryOne<DbPortfolioRow>(
      'SELECT * FROM portfolios WHERE user_id = ? ORDER BY is_default DESC, created_at ASC LIMIT 1',
      'SELECT * FROM portfolios WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1',
      [userId],
    );

    if (!portfolio) {
      const portfolioId = crypto.randomUUID();
      const initialCashCents = toMinorUnits(CLEAN_PAPER_TRADING_STATE.cashBalanceUsd);
      const initialRealizedCents = 0;

      await tx.execute(
        `INSERT INTO portfolios (id, user_id, name, base_currency, initial_balance_cents, cash_balance_cents, realized_pnl_cents, is_default, created_at, updated_at)
         VALUES (?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?)`,
        `INSERT INTO portfolios (id, user_id, name, base_currency, initial_balance_cents, cash_balance_cents, realized_pnl_cents, is_default, created_at, updated_at)
         VALUES ($1, $2, $3, 'USD', $4, $5, $6, $7, $8::timestamptz, $9::timestamptz)`,
        [
          portfolioId,
          userId,
          'Primary Portfolio',
          initialCashCents,
          initialCashCents,
          initialRealizedCents,
          boolVal(true),
          nowIso,
          nowIso,
        ],
      );

      portfolio = await tx.queryOne<DbPortfolioRow>(
        'SELECT * FROM portfolios WHERE id = ?',
        'SELECT * FROM portfolios WHERE id = $1',
        [portfolioId],
      );
    }

    let paperAccount = await tx.queryOne<DbPaperAccountRow>(
      'SELECT * FROM paper_trading_accounts WHERE user_id = ?',
      'SELECT * FROM paper_trading_accounts WHERE user_id = $1',
      [userId],
    );

    if (!paperAccount && portfolio) {
      const accountId = crypto.randomUUID();
      await tx.execute(
        `INSERT INTO paper_trading_accounts (id, user_id, portfolio_id, starting_balance_cents, cash_balance_cents, realized_pnl_cents, currency, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, ?)`,
        `INSERT INTO paper_trading_accounts (id, user_id, portfolio_id, starting_balance_cents, cash_balance_cents, realized_pnl_cents, currency, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'USD', $7::timestamptz, $8::timestamptz)`,
        [
          accountId,
          userId,
          portfolio.id,
          toNum(portfolio.initial_balance_cents),
          toNum(portfolio.cash_balance_cents),
          toNum(portfolio.realized_pnl_cents),
          nowIso,
          nowIso,
        ],
      );

      paperAccount = await tx.queryOne<DbPaperAccountRow>(
        'SELECT * FROM paper_trading_accounts WHERE id = ?',
        'SELECT * FROM paper_trading_accounts WHERE id = $1',
        [accountId],
      );
    }

    let watchlist = await tx.queryOne<DbWatchlistRow>(
      'SELECT * FROM watchlists WHERE user_id = ? ORDER BY is_default DESC, created_at ASC LIMIT 1',
      'SELECT * FROM watchlists WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1',
      [userId],
    );

    if (!watchlist) {
      const watchlistId = crypto.randomUUID();
      await tx.execute(
        `INSERT INTO watchlists (id, user_id, name, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        `INSERT INTO watchlists (id, user_id, name, is_default, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)`,
        [watchlistId, userId, 'Primary Watchlist', boolVal(true), nowIso, nowIso],
      );

      watchlist = await tx.queryOne<DbWatchlistRow>(
        'SELECT * FROM watchlists WHERE id = ?',
        'SELECT * FROM watchlists WHERE id = $1',
        [watchlistId],
      );
    }

    const prefs = await tx.queryOne<{ id: string }>(
      'SELECT id FROM user_preferences WHERE user_id = ?',
      'SELECT id FROM user_preferences WHERE user_id = $1',
      [userId],
    );

    if (!prefs) {
      await tx.execute(
        `INSERT INTO user_preferences (id, user_id, preferences_json, legacy_imported_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?)`,
        `INSERT INTO user_preferences (id, user_id, preferences_json, legacy_imported_at, created_at, updated_at)
         VALUES ($1, $2, $3, NULL, $4::timestamptz, $5::timestamptz)`,
        [crypto.randomUUID(), userId, JSON.stringify(DEFAULT_USER_PREFERENCES), nowIso, nowIso],
      );
    }

    return {
      defaultPortfolioId: portfolio!.id,
      defaultWatchlistId: watchlist!.id,
      paperAccountId: paperAccount!.id,
    };
  }

  const pendingEnsures = new Map<
    string,
    Promise<{
      defaultPortfolioId: string;
      defaultWatchlistId: string;
      paperAccountId: string;
    }>
  >();

  async function ensureUserWorkspace(userId: string) {
    const fast = await db.queryOne<{
      pid: string | null;
      aid: string | null;
      wid: string | null;
      pref_id: string | null;
    }>(
      `SELECT
         (SELECT id FROM portfolios WHERE user_id = ? ORDER BY is_default DESC, created_at ASC LIMIT 1) AS pid,
         (SELECT id FROM paper_trading_accounts WHERE user_id = ? ORDER BY created_at ASC LIMIT 1) AS aid,
         (SELECT id FROM watchlists WHERE user_id = ? ORDER BY is_default DESC, created_at ASC LIMIT 1) AS wid,
         (SELECT id FROM user_preferences WHERE user_id = ? LIMIT 1) AS pref_id`,
      `SELECT
         (SELECT id FROM portfolios WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1) AS pid,
         (SELECT id FROM paper_trading_accounts WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1) AS aid,
         (SELECT id FROM watchlists WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1) AS wid,
         (SELECT id FROM user_preferences WHERE user_id = $1 LIMIT 1) AS pref_id`,
      isPg ? [userId] : [userId, userId, userId, userId],
    );

    if (fast?.pid && fast?.aid && fast?.wid && fast?.pref_id) {
      return {
        defaultPortfolioId: fast.pid,
        defaultWatchlistId: fast.wid,
        paperAccountId: fast.aid,
      };
    }

    const existingPromise = pendingEnsures.get(userId);
    if (existingPromise) {
      return existingPromise;
    }

    const run = db
      .withTransaction((tx) => ensureUserWorkspaceInTx(tx, userId))
      .finally(() => {
        pendingEnsures.delete(userId);
      });
    pendingEnsures.set(userId, run);
    return run;
  }

  async function getProfile(user: PublicAuthUser): Promise<WorkspaceProfilePayload> {
    const ensured = await ensureUserWorkspace(user.id);
    const role = normalizeUserRole(user.role);
    const permissions = resolveUserPermissions(role);

    const [
      portfolioRows,
      watchlistRows,
      watchlistItemsCountRow,
      ordersCountRow,
      researchCountRow,
      reportsCountRow,
      prefsRow,
    ] = await Promise.all([
      db.queryAll<{ id: string }>(
        'SELECT id FROM portfolios WHERE user_id = ?',
        'SELECT id FROM portfolios WHERE user_id = $1',
        [user.id],
      ),
      db.queryAll<{ id: string }>(
        'SELECT id FROM watchlists WHERE user_id = ?',
        'SELECT id FROM watchlists WHERE user_id = $1',
        [user.id],
      ),
      db.queryOne<{ cnt: number | string }>(
        'SELECT COUNT(*) AS cnt FROM watchlist_items WHERE user_id = ?',
        'SELECT COUNT(*) AS cnt FROM watchlist_items WHERE user_id = $1',
        [user.id],
      ),
      db.queryOne<{ cnt: number | string }>(
        'SELECT COUNT(*) AS cnt FROM paper_orders WHERE user_id = ?',
        'SELECT COUNT(*) AS cnt FROM paper_orders WHERE user_id = $1',
        [user.id],
      ),
      db.queryOne<{ cnt: number | string }>(
        'SELECT COUNT(*) AS cnt FROM ai_research_history WHERE user_id = ?',
        'SELECT COUNT(*) AS cnt FROM ai_research_history WHERE user_id = $1',
        [user.id],
      ),
      db.queryOne<{ cnt: number | string }>(
        'SELECT COUNT(*) AS cnt FROM saved_reports WHERE user_id = ?',
        'SELECT COUNT(*) AS cnt FROM saved_reports WHERE user_id = $1',
        [user.id],
      ),
      db.queryOne<DbPreferencesRow>(
        'SELECT * FROM user_preferences WHERE user_id = ?',
        'SELECT * FROM user_preferences WHERE user_id = $1',
        [user.id],
      ),
    ]);

    return {
      user: { ...user, role, permissions },
      role,
      permissions,
      defaultPortfolioId: ensured.defaultPortfolioId,
      defaultWatchlistId: ensured.defaultWatchlistId,
      legacyImportedAt: prefsRow?.legacy_imported_at ? toIso(prefsRow.legacy_imported_at) : null,
      summary: {
        portfolioCount: portfolioRows.length,
        watchlistCount: watchlistRows.length,
        watchlistItemCount: toNum(watchlistItemsCountRow?.cnt),
        ordersCount: toNum(ordersCountRow?.cnt),
        researchCount: toNum(researchCountRow?.cnt),
        savedReportsCount: toNum(reportsCountRow?.cnt),
      },
    };
  }

  // ---- Portfolios & Holdings ----
  async function listPortfolios(userId: string): Promise<WorkspacePortfolio[]> {
    await ensureUserWorkspace(userId);
    const portfolioRows = await db.queryAll<DbPortfolioRow>(
      'SELECT * FROM portfolios WHERE user_id = ? ORDER BY is_default DESC, created_at ASC',
      'SELECT * FROM portfolios WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC',
      [userId],
    );
    const holdingRows = await db.queryAll<DbHoldingRow>(
      'SELECT * FROM portfolio_holdings WHERE user_id = ? ORDER BY symbol ASC',
      'SELECT * FROM portfolio_holdings WHERE user_id = $1 ORDER BY symbol ASC',
      [userId],
    );

    const byPortfolio = new Map<string, WorkspaceHolding[]>();
    for (const h of holdingRows) {
      const list = byPortfolio.get(h.portfolio_id) ?? [];
      list.push(mapHoldingRow(h));
      byPortfolio.set(h.portfolio_id, list);
    }

    return portfolioRows.map((p) => mapPortfolioRow(p, byPortfolio.get(p.id) ?? []));
  }

  async function getPortfolio(
    userId: string,
    portfolioId: string,
  ): Promise<WorkspaceOutcome<{ portfolio: WorkspacePortfolio }>> {
    if (!isValidUuid(portfolioId)) {
      return { ok: false, status: 404, error: 'Portfolio not found.', code: 'NOT_FOUND' };
    }
    const row = await db.queryOne<DbPortfolioRow>(
      'SELECT * FROM portfolios WHERE id = ? AND user_id = ?',
      'SELECT * FROM portfolios WHERE id = $1 AND user_id = $2',
      [portfolioId.trim(), userId],
    );
    if (!row) {
      return { ok: false, status: 404, error: 'Portfolio not found.', code: 'NOT_FOUND' };
    }
    const holdingRows = await db.queryAll<DbHoldingRow>(
      'SELECT * FROM portfolio_holdings WHERE portfolio_id = ? AND user_id = ? ORDER BY symbol ASC',
      'SELECT * FROM portfolio_holdings WHERE portfolio_id = $1 AND user_id = $2 ORDER BY symbol ASC',
      [row.id, userId],
    );
    return {
      ok: true,
      status: 200,
      data: { portfolio: mapPortfolioRow(row, holdingRows.map(mapHoldingRow)) },
    };
  }

  async function createPortfolio(
    userId: string,
    input: { name: unknown; baseCurrency?: unknown; initialBalanceUsd?: unknown },
  ): Promise<WorkspaceOutcome<{ portfolio: WorkspacePortfolio }>> {
    await ensureUserWorkspace(userId);
    const name = typeof input.name === 'string' ? stripControlChars(input.name, 80) : '';
    if (name.length < 2 || name.length > 80) {
      return { ok: false, status: 400, error: 'Portfolio name must be between 2 and 80 characters.' };
    }

    const baseCurrency = input.baseCurrency === 'INR' ? 'INR' : 'USD';
    const rawBalance =
      typeof input.initialBalanceUsd === 'number' && Number.isFinite(input.initialBalanceUsd)
        ? input.initialBalanceUsd
        : 25000;
    if (rawBalance < 0 || rawBalance > 10_000_000) {
      return {
        ok: false,
        status: 400,
        error: 'Initial simulated balance must be between $0 and $10,000,000.',
      };
    }

    const existing = await db.queryAll<{ id: string }>(
      'SELECT id FROM portfolios WHERE user_id = ?',
      'SELECT id FROM portfolios WHERE user_id = $1',
      [userId],
    );
    if (existing.length >= MAX_PORTFOLIOS_PER_USER) {
      return {
        ok: false,
        status: 400,
        error: `You can maintain up to ${MAX_PORTFOLIOS_PER_USER} portfolios per account.`,
      };
    }

    const portfolioId = crypto.randomUUID();
    const balanceCents = toMinorUnits(rawBalance);
    const nowIso = new Date().toISOString();

    await db.execute(
      `INSERT INTO portfolios (id, user_id, name, base_currency, initial_balance_cents, cash_balance_cents, realized_pnl_cents, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      `INSERT INTO portfolios (id, user_id, name, base_currency, initial_balance_cents, cash_balance_cents, realized_pnl_cents, is_default, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8::timestamptz, $9::timestamptz)`,
      [
        portfolioId,
        userId,
        name,
        baseCurrency,
        balanceCents,
        balanceCents,
        boolVal(false),
        nowIso,
        nowIso,
      ],
    );

    const created = await getPortfolio(userId, portfolioId);
    if (!created.ok) return created;
    return { ok: true, status: 201, data: created.data };
  }

  async function updatePortfolio(
    userId: string,
    portfolioId: string,
    input: { name?: unknown; isDefault?: unknown },
  ): Promise<WorkspaceOutcome<{ portfolio: WorkspacePortfolio }>> {
    if (!isValidUuid(portfolioId)) {
      return { ok: false, status: 404, error: 'Portfolio not found.', code: 'NOT_FOUND' };
    }

    const target = await db.queryOne<DbPortfolioRow>(
      'SELECT * FROM portfolios WHERE id = ? AND user_id = ?',
      'SELECT * FROM portfolios WHERE id = $1 AND user_id = $2',
      [portfolioId.trim(), userId],
    );
    if (!target) {
      return { ok: false, status: 404, error: 'Portfolio not found.', code: 'NOT_FOUND' };
    }

    const nextName =
      typeof input.name === 'string' ? stripControlChars(input.name, 80) : target.name;
    if (nextName.length < 2 || nextName.length > 80) {
      return { ok: false, status: 400, error: 'Portfolio name must be between 2 and 80 characters.' };
    }

    const makeDefault = input.isDefault === true;
    const nowIso = new Date().toISOString();

    await db.withTransaction(async (tx) => {
      await acquireUserLock(tx, userId);
      if (makeDefault) {
        await tx.execute(
          'UPDATE portfolios SET is_default = ? WHERE user_id = ?',
          'UPDATE portfolios SET is_default = $1 WHERE user_id = $2',
          [boolVal(false), userId],
        );
        await tx.execute(
          'UPDATE paper_trading_accounts SET portfolio_id = ?, updated_at = ? WHERE user_id = ?',
          'UPDATE paper_trading_accounts SET portfolio_id = $1, updated_at = $2::timestamptz WHERE user_id = $3',
          [target.id, nowIso, userId],
        );
      }

      await tx.execute(
        'UPDATE portfolios SET name = ?, is_default = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        'UPDATE portfolios SET name = $1, is_default = $2, updated_at = $3::timestamptz WHERE id = $4 AND user_id = $5',
        [
          nextName,
          boolVal(makeDefault ? true : toBool(target.is_default)),
          nowIso,
          target.id,
          userId,
        ],
      );
    });

    return getPortfolio(userId, target.id);
  }

  async function deletePortfolio(
    userId: string,
    portfolioId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<WorkspaceOutcome<{ deleted: true; id: string }>> {
    if (!isValidUuid(portfolioId)) {
      return { ok: false, status: 404, error: 'Portfolio not found.', code: 'NOT_FOUND' };
    }

    return db.withTransaction(async (tx) => {
      await acquireUserLock(tx, userId);
      const all = await tx.queryAll<DbPortfolioRow>(
        'SELECT * FROM portfolios WHERE user_id = ?',
        'SELECT * FROM portfolios WHERE user_id = $1',
        [userId],
      );
      const target = all.find((p) => p.id === portfolioId.trim());
      if (!target) {
        return { ok: false, status: 404, error: 'Portfolio not found.', code: 'NOT_FOUND' };
      }
      if (all.length <= 1) {
        return {
          ok: false,
          status: 400,
          error: 'Cannot delete your sole remaining portfolio.',
          code: 'LAST_PORTFOLIO',
        };
      }
      if (toBool(target.is_default)) {
        return {
          ok: false,
          status: 400,
          error: 'Set another portfolio as primary before deleting the default portfolio.',
          code: 'CANNOT_DELETE_DEFAULT',
        };
      }

      const paperAcc = await tx.queryOne<{ portfolio_id: string }>(
        'SELECT portfolio_id FROM paper_trading_accounts WHERE user_id = ?',
        'SELECT portfolio_id FROM paper_trading_accounts WHERE user_id = $1',
        [userId],
      );
      if (paperAcc && paperAcc.portfolio_id === target.id) {
        return {
          ok: false,
          status: 400,
          error: 'Cannot delete the portfolio currently linked to your paper trading account.',
          code: 'PORTFOLIO_LINKED_TO_PAPER_ACCOUNT',
        };
      }

      await tx.execute(
        'DELETE FROM portfolios WHERE id = ? AND user_id = ?',
        'DELETE FROM portfolios WHERE id = $1 AND user_id = $2',
        [target.id, userId],
      );

      await logAuditEvent(tx, {
        userId,
        eventType: 'portfolio_deleted',
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
        detail: `Deleted portfolio ${target.name}.`,
      });

      return { ok: true, status: 200, data: { deleted: true, id: target.id } };
    });
  }

  async function upsertPortfolioHolding(
    userId: string,
    portfolioId: string,
    input: { symbol: unknown; quantity: unknown; avgCostNative?: unknown },
  ): Promise<WorkspaceOutcome<{ portfolio: WorkspacePortfolio }>> {
    if (!isValidUuid(portfolioId)) {
      return { ok: false, status: 404, error: 'Portfolio not found.', code: 'NOT_FOUND' };
    }
    const inst = await resolveInstrumentMeta(input.symbol);
    if (!inst) {
      return {
        ok: false,
        status: 400,
        error: 'Unsupported or unrecognized instrument symbol.',
        code: 'INVALID_SYMBOL',
      };
    }

    const qty = typeof input.quantity === 'number' ? input.quantity : Number(input.quantity);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1_000_000) {
      return { ok: false, status: 400, error: 'Quantity must be between 0.0001 and 1,000,000.' };
    }

    const parsedAvg =
      typeof input.avgCostNative === 'number'
        ? input.avgCostNative
        : input.avgCostNative !== undefined && input.avgCostNative !== null && input.avgCostNative !== ''
          ? Number(input.avgCostNative)
          : Number.NaN;
    if (!Number.isFinite(parsedAvg) || parsedAvg < 0 || parsedAvg > 10_000_000) {
      return {
        ok: false,
        status: 400,
        error: 'Explicit non-negative average cost basis is required.',
        code: 'INVALID_COST_BASIS',
      };
    }

    const nowIso = new Date().toISOString();

    const updated = await db.withTransaction(async (tx) => {
      const portfolio = await tx.queryOne<DbPortfolioRow>(
        'SELECT * FROM portfolios WHERE id = ? AND user_id = ?',
        'SELECT * FROM portfolios WHERE id = $1 AND user_id = $2',
        [portfolioId.trim(), userId],
      );
      if (!portfolio) return false;

      const existing = await tx.queryOne<DbHoldingRow>(
        'SELECT * FROM portfolio_holdings WHERE portfolio_id = ? AND user_id = ? AND symbol = ?',
        'SELECT * FROM portfolio_holdings WHERE portfolio_id = $1 AND user_id = $2 AND symbol = $3',
        [portfolio.id, userId, inst.symbol],
      );

      if (existing) {
        await tx.execute(
          'UPDATE portfolio_holdings SET quantity_units = ?, avg_cost_minor = ?, updated_at = ? WHERE id = ? AND user_id = ?',
          'UPDATE portfolio_holdings SET quantity_units = $1, avg_cost_minor = $2, updated_at = $3::timestamptz WHERE id = $4 AND user_id = $5',
          [toQtyUnits(qty), toMinorUnits(parsedAvg), nowIso, existing.id, userId],
        );
      } else {
        await tx.execute(
          `INSERT INTO portfolio_holdings (id, portfolio_id, user_id, symbol, exchange, region, name, quantity_units, avg_cost_minor, currency, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          `INSERT INTO portfolio_holdings (id, portfolio_id, user_id, symbol, exchange, region, name, quantity_units, avg_cost_minor, currency, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12::timestamptz)`,
          [
            crypto.randomUUID(),
            portfolio.id,
            userId,
            inst.symbol,
            inst.exchange,
            inst.storageRegion,
            inst.name,
            toQtyUnits(qty),
            toMinorUnits(parsedAvg),
            inst.currency,
            nowIso,
            nowIso,
          ],
        );
      }

      await tx.execute(
        'UPDATE portfolios SET updated_at = ? WHERE id = ? AND user_id = ?',
        'UPDATE portfolios SET updated_at = $1::timestamptz WHERE id = $2 AND user_id = $3',
        [nowIso, portfolio.id, userId],
      );
      return true;
    });

    if (!updated) {
      return { ok: false, status: 404, error: 'Portfolio not found.', code: 'NOT_FOUND' };
    }
    return getPortfolio(userId, portfolioId);
  }

  async function removePortfolioHolding(
    userId: string,
    portfolioId: string,
    symbolRaw: string,
  ): Promise<WorkspaceOutcome<{ portfolio: WorkspacePortfolio }>> {
    if (!isValidUuid(portfolioId)) {
      return { ok: false, status: 404, error: 'Portfolio not found.', code: 'NOT_FOUND' };
    }
    const cleanSymbol = stripControlChars(symbolRaw, 24).toUpperCase();
    const portfolio = await db.queryOne<DbPortfolioRow>(
      'SELECT * FROM portfolios WHERE id = ? AND user_id = ?',
      'SELECT * FROM portfolios WHERE id = $1 AND user_id = $2',
      [portfolioId.trim(), userId],
    );
    if (!portfolio) {
      return { ok: false, status: 404, error: 'Portfolio not found.', code: 'NOT_FOUND' };
    }

    const del = await db.execute(
      'DELETE FROM portfolio_holdings WHERE portfolio_id = ? AND user_id = ? AND symbol = ?',
      'DELETE FROM portfolio_holdings WHERE portfolio_id = $1 AND user_id = $2 AND symbol = $3',
      [portfolio.id, userId, cleanSymbol],
    );
    if (del.changes === 0) {
      return { ok: false, status: 404, error: 'Holding not found.', code: 'NOT_FOUND' };
    }
    return getPortfolio(userId, portfolio.id);
  }

  // ---- Watchlists ----
  async function listWatchlists(userId: string): Promise<WorkspaceWatchlist[]> {
    await ensureUserWorkspace(userId);
    const lists = await db.queryAll<DbWatchlistRow>(
      'SELECT * FROM watchlists WHERE user_id = ? ORDER BY is_default DESC, created_at ASC',
      'SELECT * FROM watchlists WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC',
      [userId],
    );
    const items = await db.queryAll<DbWatchlistItemRow>(
      'SELECT * FROM watchlist_items WHERE user_id = ? ORDER BY added_at ASC',
      'SELECT * FROM watchlist_items WHERE user_id = $1 ORDER BY added_at ASC',
      [userId],
    );

    const byList = new Map<string, WorkspaceWatchlistItem[]>();
    for (const item of items) {
      const arr = byList.get(item.watchlist_id) ?? [];
      arr.push(mapWatchlistItemRow(item));
      byList.set(item.watchlist_id, arr);
    }
    return lists.map((wl) => mapWatchlistRow(wl, byList.get(wl.id) ?? []));
  }

  async function createWatchlist(
    userId: string,
    input: { name: unknown },
  ): Promise<WorkspaceOutcome<{ watchlist: WorkspaceWatchlist }>> {
    await ensureUserWorkspace(userId);
    const name = typeof input.name === 'string' ? stripControlChars(input.name, 80) : '';
    if (name.length < 2 || name.length > 80) {
      return { ok: false, status: 400, error: 'Watchlist name must be 2 to 80 characters.' };
    }
    const existing = await db.queryAll<{ id: string }>(
      'SELECT id FROM watchlists WHERE user_id = ?',
      'SELECT id FROM watchlists WHERE user_id = $1',
      [userId],
    );
    if (existing.length >= MAX_WATCHLISTS_PER_USER) {
      return {
        ok: false,
        status: 400,
        error: `Maximum of ${MAX_WATCHLISTS_PER_USER} watchlists allowed per account.`,
      };
    }

    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    await db.execute(
      `INSERT INTO watchlists (id, user_id, name, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      `INSERT INTO watchlists (id, user_id, name, is_default, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)`,
      [id, userId, name, boolVal(false), nowIso, nowIso],
    );

    const created = await db.queryOne<DbWatchlistRow>(
      'SELECT * FROM watchlists WHERE id = ? AND user_id = ?',
      'SELECT * FROM watchlists WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return {
      ok: true,
      status: 201,
      data: { watchlist: mapWatchlistRow(created!, []) },
    };
  }

  async function updateWatchlist(
    userId: string,
    watchlistId: string,
    input: { name?: unknown; isDefault?: unknown },
  ): Promise<WorkspaceOutcome<{ watchlist: WorkspaceWatchlist }>> {
    if (!isValidUuid(watchlistId)) {
      return { ok: false, status: 404, error: 'Watchlist not found.', code: 'NOT_FOUND' };
    }
    const wl = await db.queryOne<DbWatchlistRow>(
      'SELECT * FROM watchlists WHERE id = ? AND user_id = ?',
      'SELECT * FROM watchlists WHERE id = $1 AND user_id = $2',
      [watchlistId.trim(), userId],
    );
    if (!wl) {
      return { ok: false, status: 404, error: 'Watchlist not found.', code: 'NOT_FOUND' };
    }
    const nextName =
      typeof input.name === 'string' ? stripControlChars(input.name, 80) : wl.name;
    if (nextName.length < 2 || nextName.length > 80) {
      return { ok: false, status: 400, error: 'Watchlist name must be 2 to 80 characters.' };
    }
    const makeDefault = input.isDefault === true;
    const nowIso = new Date().toISOString();

    await db.withTransaction(async (tx) => {
      if (makeDefault) {
        await tx.execute(
          'UPDATE watchlists SET is_default = ? WHERE user_id = ?',
          'UPDATE watchlists SET is_default = $1 WHERE user_id = $2',
          [boolVal(false), userId],
        );
      }
      await tx.execute(
        'UPDATE watchlists SET name = ?, is_default = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        'UPDATE watchlists SET name = $1, is_default = $2, updated_at = $3::timestamptz WHERE id = $4 AND user_id = $5',
        [nextName, boolVal(makeDefault ? true : toBool(wl.is_default)), nowIso, wl.id, userId],
      );
    });

    const all = await listWatchlists(userId);
    const updated = all.find((item) => item.id === wl.id)!;
    return { ok: true, status: 200, data: { watchlist: updated } };
  }

  async function deleteWatchlist(
    userId: string,
    watchlistId: string,
  ): Promise<WorkspaceOutcome<{ deleted: true; id: string }>> {
    if (!isValidUuid(watchlistId)) {
      return { ok: false, status: 404, error: 'Watchlist not found.', code: 'NOT_FOUND' };
    }

    return db.withTransaction(async (tx) => {
      await acquireUserLock(tx, userId);
      const lists = await tx.queryAll<DbWatchlistRow>(
        'SELECT * FROM watchlists WHERE user_id = ?',
        'SELECT * FROM watchlists WHERE user_id = $1',
        [userId],
      );
      const target = lists.find((w) => w.id === watchlistId.trim());
      if (!target) {
        return { ok: false, status: 404, error: 'Watchlist not found.', code: 'NOT_FOUND' };
      }
      if (lists.length <= 1) {
        return {
          ok: false,
          status: 400,
          error: 'Cannot delete your sole remaining watchlist.',
          code: 'LAST_WATCHLIST',
        };
      }
      await tx.execute(
        'DELETE FROM watchlists WHERE id = ? AND user_id = ?',
        'DELETE FROM watchlists WHERE id = $1 AND user_id = $2',
        [target.id, userId],
      );
      if (toBool(target.is_default)) {
        const next = lists.find((w) => w.id !== target.id);
        if (next) {
          await tx.execute(
            'UPDATE watchlists SET is_default = ? WHERE id = ? AND user_id = ?',
            'UPDATE watchlists SET is_default = $1 WHERE id = $2 AND user_id = $3',
            [boolVal(true), next.id, userId],
          );
        }
      }
      return { ok: true, status: 200, data: { deleted: true, id: target.id } };
    });
  }

  async function addWatchlistItem(
    userId: string,
    watchlistId: string,
    input: { symbol: unknown },
  ): Promise<WorkspaceOutcome<{ item: WorkspaceWatchlistItem }>> {
    if (!isValidUuid(watchlistId)) {
      return { ok: false, status: 404, error: 'Watchlist not found.', code: 'NOT_FOUND' };
    }
    const inst = await resolveInstrumentMeta(input.symbol);
    if (!inst) {
      return {
        ok: false,
        status: 400,
        error: 'Unsupported or unrecognized instrument symbol.',
        code: 'INVALID_SYMBOL',
      };
    }

    const wl = await db.queryOne<DbWatchlistRow>(
      'SELECT * FROM watchlists WHERE id = ? AND user_id = ?',
      'SELECT * FROM watchlists WHERE id = $1 AND user_id = $2',
      [watchlistId.trim(), userId],
    );
    if (!wl) {
      return { ok: false, status: 404, error: 'Watchlist not found.', code: 'NOT_FOUND' };
    }

    const currentItems = await db.queryAll<DbWatchlistItemRow>(
      'SELECT * FROM watchlist_items WHERE watchlist_id = ? AND user_id = ?',
      'SELECT * FROM watchlist_items WHERE watchlist_id = $1 AND user_id = $2',
      [wl.id, userId],
    );
    const duplicate = currentItems.find((i) => i.symbol === inst.symbol);
    if (duplicate) {
      return { ok: true, status: 200, data: { item: mapWatchlistItemRow(duplicate) } };
    }
    if (currentItems.length >= MAX_WATCHLIST_ITEMS) {
      return {
        ok: false,
        status: 400,
        error: `A watchlist can hold up to ${MAX_WATCHLIST_ITEMS} symbols.`,
      };
    }

    const itemId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    await db.execute(
      `INSERT INTO watchlist_items (id, watchlist_id, user_id, symbol, exchange, added_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      `INSERT INTO watchlist_items (id, watchlist_id, user_id, symbol, exchange, added_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
      [itemId, wl.id, userId, inst.symbol, inst.exchange, nowIso],
    );

    const created = await db.queryOne<DbWatchlistItemRow>(
      'SELECT * FROM watchlist_items WHERE id = ?',
      'SELECT * FROM watchlist_items WHERE id = $1',
      [itemId],
    );
    return { ok: true, status: 201, data: { item: mapWatchlistItemRow(created!) } };
  }

  async function removeWatchlistItem(
    userId: string,
    watchlistId: string,
    itemIdOrSymbol: string,
  ): Promise<WorkspaceOutcome<{ deleted: true; itemId: string }>> {
    if (!isValidUuid(watchlistId)) {
      return { ok: false, status: 404, error: 'Watchlist not found.', code: 'NOT_FOUND' };
    }
    const cleanRef = stripControlChars(itemIdOrSymbol, 80);
    if (!cleanRef) {
      return { ok: false, status: 404, error: 'Watchlist item not found.', code: 'NOT_FOUND' };
    }

    const existing = await db.queryOne<DbWatchlistItemRow>(
      'SELECT * FROM watchlist_items WHERE watchlist_id = ? AND user_id = ? AND (id = ? OR UPPER(symbol) = UPPER(?))',
      'SELECT * FROM watchlist_items WHERE watchlist_id = $1 AND user_id = $2 AND (id::text = $3 OR UPPER(symbol) = UPPER($4))',
      [watchlistId.trim(), userId, cleanRef, cleanRef],
    );
    if (!existing) {
      return { ok: false, status: 404, error: 'Watchlist item not found.', code: 'NOT_FOUND' };
    }

    await db.execute(
      'DELETE FROM watchlist_items WHERE id = ? AND user_id = ?',
      'DELETE FROM watchlist_items WHERE id = $1 AND user_id = $2',
      [existing.id, userId],
    );
    return { ok: true, status: 200, data: { deleted: true, itemId: existing.id } };
  }

  // ---- Paper Trading ----
  async function getPaperAccount(userId: string): Promise<{
    account: WorkspacePaperAccount;
    portfolio: WorkspacePortfolio;
  }> {
    const ensured = await ensureUserWorkspace(userId);
    const accRow = await db.queryOne<DbPaperAccountRow>(
      'SELECT * FROM paper_trading_accounts WHERE id = ? AND user_id = ?',
      'SELECT * FROM paper_trading_accounts WHERE id = $1 AND user_id = $2',
      [ensured.paperAccountId, userId],
    );
    const portOutcome = await getPortfolio(userId, accRow!.portfolio_id);
    return {
      account: mapPaperAccountRow(accRow!),
      portfolio: portOutcome.ok
        ? portOutcome.data.portfolio
        : (await listPortfolios(userId))[0],
    };
  }

  async function listPaperOrders(
    userId: string,
    opts?: { symbol?: string; limit?: number; offset?: number },
  ): Promise<{ orders: WorkspacePaperOrder[]; total: number }> {
    await ensureUserWorkspace(userId);
    const limit = Math.min(Math.max(1, Number(opts?.limit ?? 50)), 100);
    const offset = Math.max(0, Number(opts?.offset ?? 0));
    const cleanSym = opts?.symbol ? stripControlChars(opts.symbol, 24).toUpperCase() : '';

    if (cleanSym) {
      const [rows, countRow] = await Promise.all([
        db.queryAll<DbPaperOrderRow>(
          'SELECT * FROM paper_orders WHERE user_id = ? AND symbol = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
          'SELECT * FROM paper_orders WHERE user_id = $1 AND symbol = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4',
          [userId, cleanSym, limit, offset],
        ),
        db.queryOne<{ cnt: number | string }>(
          'SELECT COUNT(*) AS cnt FROM paper_orders WHERE user_id = ? AND symbol = ?',
          'SELECT COUNT(*) AS cnt FROM paper_orders WHERE user_id = $1 AND symbol = $2',
          [userId, cleanSym],
        ),
      ]);
      return { orders: rows.map(mapPaperOrderRow), total: toNum(countRow?.cnt) };
    }

    const [rows, countRow] = await Promise.all([
      db.queryAll<DbPaperOrderRow>(
        'SELECT * FROM paper_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        'SELECT * FROM paper_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [userId, limit, offset],
      ),
      db.queryOne<{ cnt: number | string }>(
        'SELECT COUNT(*) AS cnt FROM paper_orders WHERE user_id = ?',
        'SELECT COUNT(*) AS cnt FROM paper_orders WHERE user_id = $1',
        [userId],
      ),
    ]);
    return { orders: rows.map(mapPaperOrderRow), total: toNum(countRow?.cnt) };
  }

  async function listPaperTransactions(
    userId: string,
    opts?: { symbol?: string; limit?: number; offset?: number },
  ): Promise<{ transactions: WorkspacePaperTransaction[]; total: number }> {
    await ensureUserWorkspace(userId);
    const limit = Math.min(Math.max(1, Number(opts?.limit ?? 50)), 100);
    const offset = Math.max(0, Number(opts?.offset ?? 0));
    const cleanSym = opts?.symbol ? stripControlChars(opts.symbol, 24).toUpperCase() : '';

    if (cleanSym) {
      const [rows, countRow] = await Promise.all([
        db.queryAll<DbPaperTxRow>(
          'SELECT * FROM paper_transactions WHERE user_id = ? AND symbol = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
          'SELECT * FROM paper_transactions WHERE user_id = $1 AND symbol = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4',
          [userId, cleanSym, limit, offset],
        ),
        db.queryOne<{ cnt: number | string }>(
          'SELECT COUNT(*) AS cnt FROM paper_transactions WHERE user_id = ? AND symbol = ?',
          'SELECT COUNT(*) AS cnt FROM paper_transactions WHERE user_id = $1 AND symbol = $2',
          [userId, cleanSym],
        ),
      ]);
      return { transactions: rows.map(mapPaperTxRow), total: toNum(countRow?.cnt) };
    }

    const [rows, countRow] = await Promise.all([
      db.queryAll<DbPaperTxRow>(
        'SELECT * FROM paper_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        'SELECT * FROM paper_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [userId, limit, offset],
      ),
      db.queryOne<{ cnt: number | string }>(
        'SELECT COUNT(*) AS cnt FROM paper_transactions WHERE user_id = ?',
        'SELECT COUNT(*) AS cnt FROM paper_transactions WHERE user_id = $1',
        [userId],
      ),
    ]);
    return { transactions: rows.map(mapPaperTxRow), total: toNum(countRow?.cnt) };
  }

  async function executePaperTrade(
    userId: string,
    input: {
      symbol: unknown;
      side: unknown;
      quantity: unknown;
      orderType?: unknown;
      clientOrderId?: unknown;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<
    WorkspaceOutcome<{
      order: WorkspacePaperOrder;
      transaction: WorkspacePaperTransaction;
      account: WorkspacePaperAccount;
      portfolio: WorkspacePortfolio;
      deduplicated: boolean;
    }>
  > {
    const inst = await resolveInstrumentMeta(input.symbol);
    if (!inst) {
      return {
        ok: false,
        status: 400,
        error: 'Unsupported market instrument.',
        code: 'INVALID_SYMBOL',
      };
    }

    const side = input.side === 'BUY' || input.side === 'SELL' ? input.side : null;
    if (!side) {
      return { ok: false, status: 400, error: 'Order side must be BUY or SELL.' };
    }

    const orderType = input.orderType === 'LIMIT' ? 'LIMIT' : 'MARKET';
    const qty = typeof input.quantity === 'number' ? input.quantity : Number(input.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, status: 400, error: 'Order quantity must be greater than zero.' };
    }
    if (qty > 1_000_000) {
      return {
        ok: false,
        status: 400,
        error: 'Order exceeds the maximum simulated order limit (1,000,000 shares).',
      };
    }

    const qtyUnits = toQtyUnits(qty);
    if (qtyUnits <= 0) {
      return { ok: false, status: 400, error: 'Order quantity is too small.' };
    }

    const clientOrderId =
      typeof input.clientOrderId === 'string' && input.clientOrderId.trim()
        ? stripControlChars(input.clientOrderId, 80)
        : null;

    // Enforce admin runtime feature flags & market data controls when configured
    if (runtimeConfigManager) {
      const cfg = await runtimeConfigManager.getConfig();
      if (!cfg.feature_flags.paperTradingEnabled) {
        return {
          ok: false,
          status: 503,
          error: 'Simulated paper trading is temporarily disabled by platform administration.',
          code: 'PAPER_TRADING_DISABLED',
        };
      }
      if (
        cfg.market_data_config.disabledSymbols.includes(inst.symbol) ||
        !cfg.market_data_config.enabledRegions.includes(inst.storageRegion)
      ) {
        return {
          ok: false,
          status: 400,
          error: `${inst.symbol} is currently disabled in the market catalog by platform configuration.`,
          code: 'SYMBOL_DISABLED',
        };
      }
    }

    // Server-authoritative live/cached quote (never trust browser price or invent quotes)
    const liveQuote = await resolveQuote(inst.symbol).catch(() => null);
    if (!liveQuote || liveQuote.price === null || !Number.isFinite(liveQuote.price) || liveQuote.price <= 0) {
      return {
        ok: false,
        status: 503,
        error: `Live or cached execution quote is currently unavailable for ${inst.symbol}. Paper order was not filled.`,
        code: 'QUOTE_UNAVAILABLE',
      };
    }

    const usdInrRate = inst.currency === 'INR' ? await resolveUsdInrRate().catch(() => null) : null;
    const executionPriceNative = liveQuote.price;
    const executionPriceMinor = toMinorUnits(executionPriceNative);
    const totalUsdCents = toUsdCentsFromNativeMinor(
      qtyUnits,
      executionPriceMinor,
      inst.currency,
      usdInrRate,
    );
    if (totalUsdCents === null) {
      return {
        ok: false,
        status: 503,
        error: 'Live/cached USD/INR FX rate is currently unavailable to convert INR order.',
        code: 'FX_UNAVAILABLE',
      };
    }

    return db.withTransaction(async (tx) => {
      const ensured = await ensureUserWorkspaceInTx(tx, userId);

      if (clientOrderId) {
        const existingOrder = await tx.queryOne<DbPaperOrderRow>(
          'SELECT * FROM paper_orders WHERE user_id = ? AND client_order_id = ?',
          'SELECT * FROM paper_orders WHERE user_id = $1 AND client_order_id = $2',
          [userId, clientOrderId],
        );
        if (existingOrder) {
          const existingTx = await tx.queryOne<DbPaperTxRow>(
            'SELECT * FROM paper_transactions WHERE order_id = ? AND user_id = ?',
            'SELECT * FROM paper_transactions WHERE order_id = $1 AND user_id = $2',
            [existingOrder.id, userId],
          );
          const accRow = await tx.queryOne<DbPaperAccountRow>(
            'SELECT * FROM paper_trading_accounts WHERE id = ? AND user_id = ?',
            'SELECT * FROM paper_trading_accounts WHERE id = $1 AND user_id = $2',
            [ensured.paperAccountId, userId],
          );
          const portRow = await tx.queryOne<DbPortfolioRow>(
            'SELECT * FROM portfolios WHERE id = ? AND user_id = ?',
            'SELECT * FROM portfolios WHERE id = $1 AND user_id = $2',
            [accRow!.portfolio_id, userId],
          );
          const holdingRows = await tx.queryAll<DbHoldingRow>(
            'SELECT * FROM portfolio_holdings WHERE portfolio_id = ? AND user_id = ? ORDER BY symbol ASC',
            'SELECT * FROM portfolio_holdings WHERE portfolio_id = $1 AND user_id = $2 ORDER BY symbol ASC',
            [portRow!.id, userId],
          );
          return {
            ok: true,
            status: 200,
            data: {
              order: mapPaperOrderRow(existingOrder),
              transaction: mapPaperTxRow(existingTx!),
              account: mapPaperAccountRow(accRow!),
              portfolio: mapPortfolioRow(portRow!, holdingRows.map(mapHoldingRow)),
              deduplicated: true,
            },
          };
        }
      }

      const accountRow = await tx.queryOne<DbPaperAccountRow>(
        'SELECT * FROM paper_trading_accounts WHERE id = ? AND user_id = ?',
        'SELECT * FROM paper_trading_accounts WHERE id = $1 AND user_id = $2',
        [ensured.paperAccountId, userId],
      );
      const portfolioRow = await tx.queryOne<DbPortfolioRow>(
        'SELECT * FROM portfolios WHERE id = ? AND user_id = ?',
        'SELECT * FROM portfolios WHERE id = $1 AND user_id = $2',
        [accountRow!.portfolio_id, userId],
      );

      let cashBalanceCents = toNum(accountRow!.cash_balance_cents);
      let realizedPnlCents = toNum(accountRow!.realized_pnl_cents);
      let orderRealizedCents = 0;

      const existingHolding = await tx.queryOne<DbHoldingRow>(
        'SELECT * FROM portfolio_holdings WHERE portfolio_id = ? AND user_id = ? AND symbol = ?',
        'SELECT * FROM portfolio_holdings WHERE portfolio_id = $1 AND user_id = $2 AND symbol = $3',
        [portfolioRow!.id, userId, inst.symbol],
      );

      const nowIso = new Date().toISOString();

      if (side === 'BUY') {
        if (totalUsdCents > cashBalanceCents) {
          return {
            ok: false,
            status: 400,
            error: `Insufficient simulated cash ($${(cashBalanceCents / 100).toFixed(2)} available, $${(totalUsdCents / 100).toFixed(2)} required).`,
            code: 'INSUFFICIENT_CASH',
          };
        }
        cashBalanceCents -= totalUsdCents;

        if (existingHolding) {
          const prevQtyUnits = toNum(existingHolding.quantity_units);
          const prevAvgMinor = toNum(existingHolding.avg_cost_minor);
          const nextQtyUnits = prevQtyUnits + qtyUnits;
          const nextAvgMinor = Math.round(
            (prevQtyUnits * prevAvgMinor + qtyUnits * executionPriceMinor) / nextQtyUnits,
          );
          await tx.execute(
            'UPDATE portfolio_holdings SET quantity_units = ?, avg_cost_minor = ?, updated_at = ? WHERE id = ? AND user_id = ?',
            'UPDATE portfolio_holdings SET quantity_units = $1, avg_cost_minor = $2, updated_at = $3::timestamptz WHERE id = $4 AND user_id = $5',
            [nextQtyUnits, nextAvgMinor, nowIso, existingHolding.id, userId],
          );
        } else {
          await tx.execute(
            `INSERT INTO portfolio_holdings (id, portfolio_id, user_id, symbol, exchange, region, name, quantity_units, avg_cost_minor, currency, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            `INSERT INTO portfolio_holdings (id, portfolio_id, user_id, symbol, exchange, region, name, quantity_units, avg_cost_minor, currency, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12::timestamptz)`,
            [
              crypto.randomUUID(),
              portfolioRow!.id,
              userId,
              inst.symbol,
              inst.exchange,
              inst.storageRegion,
              inst.name,
              qtyUnits,
              executionPriceMinor,
              inst.currency,
              nowIso,
              nowIso,
            ],
          );
        }
      } else {
        const heldUnits = existingHolding ? toNum(existingHolding.quantity_units) : 0;
        if (!existingHolding || heldUnits < qtyUnits) {
          return {
            ok: false,
            status: 400,
            error: `Insufficient ${inst.symbol} paper holdings (${fromQtyUnits(heldUnits)} shares held).`,
            code: 'INSUFFICIENT_HOLDINGS',
          };
        }

        const avgMinor = toNum(existingHolding.avg_cost_minor);
        const diffPerUnitMinor = executionPriceMinor - avgMinor;
        const realizedNativeMajor = (qtyUnits / QUANTITY_SCALE) * (diffPerUnitMinor / 100);
        const realizedUsdMajor = toUsdEquivalent(realizedNativeMajor, inst.currency, usdInrRate) ?? 0;
        orderRealizedCents = Math.round(realizedUsdMajor * 100);
        realizedPnlCents += orderRealizedCents;
        cashBalanceCents += totalUsdCents;

        const remainingUnits = heldUnits - qtyUnits;
        if (remainingUnits <= 0) {
          await tx.execute(
            'DELETE FROM portfolio_holdings WHERE id = ? AND user_id = ?',
            'DELETE FROM portfolio_holdings WHERE id = $1 AND user_id = $2',
            [existingHolding.id, userId],
          );
        } else {
          await tx.execute(
            'UPDATE portfolio_holdings SET quantity_units = ?, updated_at = ? WHERE id = ? AND user_id = ?',
            'UPDATE portfolio_holdings SET quantity_units = $1, updated_at = $2::timestamptz WHERE id = $3 AND user_id = $4',
            [remainingUnits, nowIso, existingHolding.id, userId],
          );
        }
      }

      await tx.execute(
        'UPDATE paper_trading_accounts SET cash_balance_cents = ?, realized_pnl_cents = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        'UPDATE paper_trading_accounts SET cash_balance_cents = $1, realized_pnl_cents = $2, updated_at = $3::timestamptz WHERE id = $4 AND user_id = $5',
        [cashBalanceCents, realizedPnlCents, nowIso, accountRow!.id, userId],
      );

      await tx.execute(
        'UPDATE portfolios SET cash_balance_cents = ?, realized_pnl_cents = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        'UPDATE portfolios SET cash_balance_cents = $1, realized_pnl_cents = $2, updated_at = $3::timestamptz WHERE id = $4 AND user_id = $5',
        [cashBalanceCents, realizedPnlCents, nowIso, portfolioRow!.id, userId],
      );

      const orderId = crypto.randomUUID();
      const txId = crypto.randomUUID();

      await tx.execute(
        `INSERT INTO paper_orders (id, user_id, account_id, portfolio_id, client_order_id, symbol, exchange, side, order_type, quantity_units, requested_price_minor, execution_price_minor, currency, total_usd_cents, realized_pnl_cents, status, created_at, executed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FILLED', ?, ?)`,
        `INSERT INTO paper_orders (id, user_id, account_id, portfolio_id, client_order_id, symbol, exchange, side, order_type, quantity_units, requested_price_minor, execution_price_minor, currency, total_usd_cents, realized_pnl_cents, status, created_at, executed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'FILLED', $16::timestamptz, $17::timestamptz)`,
        [
          orderId,
          userId,
          accountRow!.id,
          portfolioRow!.id,
          clientOrderId,
          inst.symbol,
          inst.exchange,
          side,
          orderType,
          qtyUnits,
          executionPriceMinor,
          executionPriceMinor,
          inst.currency,
          totalUsdCents,
          orderRealizedCents,
          nowIso,
          nowIso,
        ],
      );

      await tx.execute(
        `INSERT INTO paper_transactions (id, user_id, account_id, order_id, symbol, side, quantity_units, price_minor, fees_minor, total_usd_cents, realized_pnl_cents, currency, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        `INSERT INTO paper_transactions (id, user_id, account_id, order_id, symbol, side, quantity_units, price_minor, fees_minor, total_usd_cents, realized_pnl_cents, currency, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11, $12::timestamptz)`,
        [
          txId,
          userId,
          accountRow!.id,
          orderId,
          inst.symbol,
          side,
          qtyUnits,
          executionPriceMinor,
          totalUsdCents,
          orderRealizedCents,
          inst.currency,
          nowIso,
        ],
      );

      await logAuditEvent(tx, {
        userId,
        eventType: 'paper_order_executed',
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        detail: `Simulated ${side} ${qty} ${inst.symbol} (${inst.currency} ${executionPriceNative}, source: ${liveQuote.providerName}).`,
      });

      const [orderRow, txRow, updatedAcc, updatedPort, holdingRows] = await Promise.all([
        tx.queryOne<DbPaperOrderRow>(
          'SELECT * FROM paper_orders WHERE id = ?',
          'SELECT * FROM paper_orders WHERE id = $1',
          [orderId],
        ),
        tx.queryOne<DbPaperTxRow>(
          'SELECT * FROM paper_transactions WHERE id = ?',
          'SELECT * FROM paper_transactions WHERE id = $1',
          [txId],
        ),
        tx.queryOne<DbPaperAccountRow>(
          'SELECT * FROM paper_trading_accounts WHERE id = ?',
          'SELECT * FROM paper_trading_accounts WHERE id = $1',
          [accountRow!.id],
        ),
        tx.queryOne<DbPortfolioRow>(
          'SELECT * FROM portfolios WHERE id = ?',
          'SELECT * FROM portfolios WHERE id = $1',
          [portfolioRow!.id],
        ),
        tx.queryAll<DbHoldingRow>(
          'SELECT * FROM portfolio_holdings WHERE portfolio_id = ? AND user_id = ? ORDER BY symbol ASC',
          'SELECT * FROM portfolio_holdings WHERE portfolio_id = $1 AND user_id = $2 ORDER BY symbol ASC',
          [portfolioRow!.id, userId],
        ),
      ]);

      return {
        ok: true,
        status: 201,
        data: {
          order: mapPaperOrderRow(orderRow!),
          transaction: mapPaperTxRow(txRow!),
          account: mapPaperAccountRow(updatedAcc!),
          portfolio: mapPortfolioRow(updatedPort!, holdingRows.map(mapHoldingRow)),
          deduplicated: false,
        },
      };
    });
  }

  async function resetPaperAccount(
    userId: string,
    input?: { mode?: 'starter' | 'clean'; ipAddress?: string; userAgent?: string },
  ): Promise<WorkspaceOutcome<{ account: WorkspacePaperAccount; portfolio: WorkspacePortfolio }>> {
    const mode = 'clean';
    const nowIso = new Date().toISOString();

    return db.withTransaction(async (tx) => {
      const ensured = await ensureUserWorkspaceInTx(tx, userId);
      const accountRow = await tx.queryOne<DbPaperAccountRow>(
        'SELECT * FROM paper_trading_accounts WHERE id = ? AND user_id = ?',
        'SELECT * FROM paper_trading_accounts WHERE id = $1 AND user_id = $2',
        [ensured.paperAccountId, userId],
      );
      const portfolioId = accountRow!.portfolio_id;

      const targetCashCents = toMinorUnits(CLEAN_PAPER_TRADING_STATE.cashBalanceUsd);
      const targetRealizedCents = 0;

      await tx.execute(
        'DELETE FROM paper_transactions WHERE user_id = ? AND account_id = ?',
        'DELETE FROM paper_transactions WHERE user_id = $1 AND account_id = $2',
        [userId, accountRow!.id],
      );
      await tx.execute(
        'DELETE FROM paper_orders WHERE user_id = ? AND account_id = ?',
        'DELETE FROM paper_orders WHERE user_id = $1 AND account_id = $2',
        [userId, accountRow!.id],
      );
      await tx.execute(
        'DELETE FROM portfolio_holdings WHERE portfolio_id = ? AND user_id = ?',
        'DELETE FROM portfolio_holdings WHERE portfolio_id = $1 AND user_id = $2',
        [portfolioId, userId],
      );

      await tx.execute(
        'UPDATE paper_trading_accounts SET starting_balance_cents = ?, cash_balance_cents = ?, realized_pnl_cents = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        'UPDATE paper_trading_accounts SET starting_balance_cents = $1, cash_balance_cents = $2, realized_pnl_cents = $3, updated_at = $4::timestamptz WHERE id = $5 AND user_id = $6',
        [targetCashCents, targetCashCents, targetRealizedCents, nowIso, accountRow!.id, userId],
      );

      await tx.execute(
        'UPDATE portfolios SET initial_balance_cents = ?, cash_balance_cents = ?, realized_pnl_cents = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        'UPDATE portfolios SET initial_balance_cents = $1, cash_balance_cents = $2, realized_pnl_cents = $3, updated_at = $4::timestamptz WHERE id = $5 AND user_id = $6',
        [targetCashCents, targetCashCents, targetRealizedCents, nowIso, portfolioId, userId],
      );

      await logAuditEvent(tx, {
        userId,
        eventType: 'paper_account_reset',
        ipAddress: input?.ipAddress,
        userAgent: input?.userAgent,
        detail: `Paper trading account reset (${mode} $100,000 simulated cash mode).`,
      });

      const [updatedAcc, updatedPort, holdingRows] = await Promise.all([
        tx.queryOne<DbPaperAccountRow>(
          'SELECT * FROM paper_trading_accounts WHERE id = ?',
          'SELECT * FROM paper_trading_accounts WHERE id = $1',
          [accountRow!.id],
        ),
        tx.queryOne<DbPortfolioRow>(
          'SELECT * FROM portfolios WHERE id = ?',
          'SELECT * FROM portfolios WHERE id = $1',
          [portfolioId],
        ),
        tx.queryAll<DbHoldingRow>(
          'SELECT * FROM portfolio_holdings WHERE portfolio_id = ? AND user_id = ? ORDER BY symbol ASC',
          'SELECT * FROM portfolio_holdings WHERE portfolio_id = $1 AND user_id = $2 ORDER BY symbol ASC',
          [portfolioId, userId],
        ),
      ]);

      return {
        ok: true,
        status: 200,
        data: {
          account: mapPaperAccountRow(updatedAcc!),
          portfolio: mapPortfolioRow(updatedPort!, holdingRows.map(mapHoldingRow)),
        },
      };
    });
  }

  // ---- AI Research History & Saved Reports ----
  async function listResearchHistory(
    userId: string,
    opts?: { symbol?: string; search?: string; limit?: number; offset?: number },
  ): Promise<{ items: WorkspaceResearchItem[]; total: number }> {
    const limit = Math.min(Math.max(1, Number(opts?.limit ?? 25)), 100);
    const offset = Math.max(0, Number(opts?.offset ?? 0));
    const sym = opts?.symbol ? stripControlChars(opts.symbol, 24).toUpperCase() : '';
    const search = opts?.search ? stripControlChars(opts.search, 120) : '';

    const conditionsSqlite = ['user_id = ?'];
    const conditionsPg = ['user_id = $1'];
    const params: unknown[] = [userId];

    if (sym) {
      params.push(sym);
      conditionsSqlite.push('UPPER(symbol) = ?');
      conditionsPg.push(`UPPER(symbol) = $${params.length}`);
    }
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditionsSqlite.push('(LOWER(query) LIKE ? OR LOWER(symbol) LIKE ?)');
      params.push(`%${search.toLowerCase()}%`);
      conditionsPg.push(
        `(LOWER(query) LIKE $${params.length - 1} OR LOWER(symbol) LIKE $${params.length})`,
      );
      // Align SQLite param count cleanly
    }

    // Build clean identical-arity queries
    const countRows = await db.queryOne<{ cnt: number | string }>(
      `SELECT COUNT(*) AS cnt FROM ai_research_history WHERE ${conditionsSqlite.join(' AND ')}`,
      `SELECT COUNT(*) AS cnt FROM ai_research_history WHERE ${conditionsPg.join(' AND ')}`,
      params,
    );

    const listParams = [...params, limit, offset];
    const rows = await db.queryAll<DbResearchRow>(
      `SELECT * FROM ai_research_history WHERE ${conditionsSqlite.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      `SELECT * FROM ai_research_history WHERE ${conditionsPg.join(' AND ')} ORDER BY created_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );

    return {
      items: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        symbol: r.symbol,
        query: r.query,
        result: parseResearchJson(r.research_result_json, r.symbol),
        source: r.source,
        model: r.model,
        createdAt: toIso(r.created_at),
      })),
      total: toNum(countRows?.cnt),
    };
  }

  async function runAndSaveResearch(
    userId: string,
    input: { symbol: unknown; query: unknown },
  ): Promise<WorkspaceOutcome<{ item: WorkspaceResearchItem }>> {
    const rawSymbol = typeof input.symbol === 'string' ? stripControlChars(input.symbol, 24) : '';
    const rawQuery = typeof input.query === 'string' ? stripControlChars(input.query, 1000) : '';

    if (rawSymbol.length > 24) {
      return { ok: false, status: 400, error: 'Instrument symbol must be 24 characters or fewer.' };
    }
    if (!rawQuery || rawQuery.length < 2) {
      return {
        ok: false,
        status: 400,
        error: 'Please enter a financial research question (at least 2 characters).',
      };
    }

    const liveQuote = rawSymbol ? await resolveQuote(rawSymbol).catch(() => null) : null;

    let result: ResearchResponsePayload;
    try {
      result = await runResearch({
        symbol: rawSymbol,
        query: rawQuery,
        liveQuote,
        runtimeConfigManager,
        userId,
        feature: 'workspace_research',
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      const status = (err as { status?: number })?.status;
      if (code === 'AI_FEATURE_DISABLED' && status === 503) {
        return {
          ok: false,
          status: 503,
          error: 'AI research is temporarily disabled by platform configuration.',
          code: 'AI_FEATURE_DISABLED',
        };
      }
      if (code === 'AI_POLICY_BLOCKED' && status === 400) {
        return {
          ok: false,
          status: 400,
          error: err instanceof Error ? err.message : 'Research query rejected by AI safety policy.',
          code: 'AI_POLICY_BLOCKED',
        };
      }
      if (code === 'AI_NOT_CONFIGURED') {
        return {
          ok: false,
          status: 503,
          error:
            err instanceof Error
              ? err.message
              : 'AI-powered financial intelligence is currently in building mode (GEMINI_API_KEY required).',
          code: 'AI_NOT_CONFIGURED',
        };
      }
      return {
        ok: false,
        status: 503,
        error:
          err instanceof Error
            ? err.message
            : 'AI research provider is currently unavailable. No synthetic fallback output was generated.',
        code: 'AI_UNAVAILABLE',
      };
    }

    const prefs = await getPreferences(userId);
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const item: WorkspaceResearchItem = {
      id,
      userId,
      symbol: result.symbol,
      query: rawQuery,
      result,
      source: result.source,
      model: result.model,
      createdAt: nowIso,
    };

    if (prefs.researchAutoSave) {
      await db.execute(
        `INSERT INTO ai_research_history (id, user_id, symbol, query, research_result_json, source, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        `INSERT INTO ai_research_history (id, user_id, symbol, query, research_result_json, source, model, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
        [
          id,
          userId,
          result.symbol,
          rawQuery,
          JSON.stringify(result),
          result.source,
          result.model,
          nowIso,
        ],
      );
    }

    return { ok: true, status: 201, data: { item } };
  }

  async function getResearchItem(
    userId: string,
    researchId: string,
  ): Promise<WorkspaceOutcome<{ item: WorkspaceResearchItem }>> {
    if (!isValidUuid(researchId)) {
      return { ok: false, status: 404, error: 'Research entry not found.', code: 'NOT_FOUND' };
    }
    const row = await db.queryOne<DbResearchRow>(
      'SELECT * FROM ai_research_history WHERE id = ? AND user_id = ?',
      'SELECT * FROM ai_research_history WHERE id = $1 AND user_id = $2',
      [researchId.trim(), userId],
    );
    if (!row) {
      return { ok: false, status: 404, error: 'Research entry not found.', code: 'NOT_FOUND' };
    }
    return {
      ok: true,
      status: 200,
      data: {
        item: {
          id: row.id,
          userId: row.user_id,
          symbol: row.symbol,
          query: row.query,
          result: parseResearchJson(row.research_result_json, row.symbol),
          source: row.source,
          model: row.model,
          createdAt: toIso(row.created_at),
        },
      },
    };
  }

  async function deleteResearchItem(
    userId: string,
    researchId: string,
  ): Promise<WorkspaceOutcome<{ deleted: true; id: string }>> {
    if (!isValidUuid(researchId)) {
      return { ok: false, status: 404, error: 'Research entry not found.', code: 'NOT_FOUND' };
    }
    const res = await db.execute(
      'DELETE FROM ai_research_history WHERE id = ? AND user_id = ?',
      'DELETE FROM ai_research_history WHERE id = $1 AND user_id = $2',
      [researchId.trim(), userId],
    );
    if (res.changes === 0) {
      return { ok: false, status: 404, error: 'Research entry not found.', code: 'NOT_FOUND' };
    }
    return { ok: true, status: 200, data: { deleted: true, id: researchId.trim() } };
  }

  async function listSavedReports(userId: string): Promise<WorkspaceSavedReport[]> {
    const rows = await db.queryAll<DbReportRow>(
      'SELECT * FROM saved_reports WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
      'SELECT * FROM saved_reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
      [userId],
    );
    return rows.map((r) => {
      let content: Record<string, unknown> = {};
      try {
        content = JSON.parse(r.report_content_json) as Record<string, unknown>;
      } catch {
        content = {};
      }
      return {
        id: r.id,
        userId: r.user_id,
        title: r.title,
        reportType:
          r.report_type === 'portfolio-snapshot' || r.report_type === 'risk-note'
            ? r.report_type
            : 'research-brief',
        symbol: r.symbol,
        content,
        createdAt: toIso(r.created_at),
        updatedAt: toIso(r.updated_at),
      };
    });
  }

  async function createSavedReport(
    userId: string,
    input: {
      title: unknown;
      reportType?: unknown;
      symbol?: unknown;
      content: unknown;
    },
  ): Promise<WorkspaceOutcome<{ report: WorkspaceSavedReport }>> {
    const title = typeof input.title === 'string' ? stripControlChars(input.title, 160) : '';
    if (title.length < 2 || title.length > 160) {
      return { ok: false, status: 400, error: 'Report title must be between 2 and 160 characters.' };
    }

    const reportType =
      input.reportType === 'portfolio-snapshot' || input.reportType === 'risk-note'
        ? input.reportType
        : 'research-brief';
    const symbol =
      typeof input.symbol === 'string' && input.symbol.trim()
        ? stripControlChars(input.symbol, 24).toUpperCase()
        : 'MARKET';
    const content =
      input.content && typeof input.content === 'object' && !Array.isArray(input.content)
        ? (input.content as Record<string, unknown>)
        : null;
    if (!content) {
      return { ok: false, status: 400, error: 'Report content object is required.' };
    }

    const existing = await db.queryAll<{ id: string }>(
      'SELECT id FROM saved_reports WHERE user_id = ?',
      'SELECT id FROM saved_reports WHERE user_id = $1',
      [userId],
    );
    if (existing.length >= MAX_SAVED_REPORTS) {
      return {
        ok: false,
        status: 400,
        error: `Maximum of ${MAX_SAVED_REPORTS} saved reports allowed per account.`,
      };
    }

    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    await db.execute(
      `INSERT INTO saved_reports (id, user_id, title, report_type, symbol, report_content_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      `INSERT INTO saved_reports (id, user_id, title, report_type, symbol, report_content_json, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)`,
      [id, userId, title, reportType, symbol, JSON.stringify(content), nowIso, nowIso],
    );

    return {
      ok: true,
      status: 201,
      data: {
        report: {
          id,
          userId,
          title,
          reportType,
          symbol,
          content,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      },
    };
  }

  async function deleteSavedReport(
    userId: string,
    reportId: string,
  ): Promise<WorkspaceOutcome<{ deleted: true; id: string }>> {
    if (!isValidUuid(reportId)) {
      return { ok: false, status: 404, error: 'Saved report not found.', code: 'NOT_FOUND' };
    }
    const res = await db.execute(
      'DELETE FROM saved_reports WHERE id = ? AND user_id = ?',
      'DELETE FROM saved_reports WHERE id = $1 AND user_id = $2',
      [reportId.trim(), userId],
    );
    if (res.changes === 0) {
      return { ok: false, status: 404, error: 'Saved report not found.', code: 'NOT_FOUND' };
    }
    return { ok: true, status: 200, data: { deleted: true, id: reportId.trim() } };
  }

  // ---- Preferences ----
  async function getPreferences(userId: string): Promise<UserPreferencesPayload> {
    await ensureUserWorkspace(userId);
    const row = await db.queryOne<DbPreferencesRow>(
      'SELECT * FROM user_preferences WHERE user_id = ?',
      'SELECT * FROM user_preferences WHERE user_id = $1',
      [userId],
    );
    if (!row) return DEFAULT_USER_PREFERENCES;
    try {
      return sanitizePreferencesObject(JSON.parse(row.preferences_json), DEFAULT_USER_PREFERENCES);
    } catch {
      return DEFAULT_USER_PREFERENCES;
    }
  }

  async function updatePreferences(
    userId: string,
    patch: Record<string, unknown>,
  ): Promise<WorkspaceOutcome<{ preferences: UserPreferencesPayload }>> {
    const current = await getPreferences(userId);
    const next = sanitizePreferencesObject(patch, current);
    const nowIso = new Date().toISOString();

    await db.execute(
      'UPDATE user_preferences SET preferences_json = ?, updated_at = ? WHERE user_id = ?',
      'UPDATE user_preferences SET preferences_json = $1, updated_at = $2::timestamptz WHERE user_id = $3',
      [JSON.stringify(next), nowIso, userId],
    );

    return { ok: true, status: 200, data: { preferences: next } };
  }

  // ---- Legacy Browser Import (Explicit User-Approved One-Time Migration) ----
  async function importLegacyBrowserData(
    userId: string,
    input: {
      portfolio?: unknown;
      watchlist?: unknown;
      defaultRegion?: unknown;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<WorkspaceOutcome<LegacyImportSummary>> {
    const nowIso = new Date().toISOString();

    return db.withTransaction(async (tx) => {
      const ensured = await ensureUserWorkspaceInTx(tx, userId);
      const prefsRow = await tx.queryOne<DbPreferencesRow>(
        'SELECT * FROM user_preferences WHERE user_id = ?',
        'SELECT * FROM user_preferences WHERE user_id = $1',
        [userId],
      );

      if (prefsRow?.legacy_imported_at) {
        return {
          ok: false,
          status: 409,
          error: 'Legacy browser workspace data has already been imported for this account.',
          code: 'LEGACY_ALREADY_IMPORTED',
        };
      }

      let importedHoldingsCount = 0;
      let importedWatchlistCount = 0;
      let importedOrdersCount = 0;
      let importedRegion: 'ALL' | MarketRegion | null = null;

      if (input.portfolio && typeof input.portfolio === 'object') {
        const cleanPortfolio = sanitizePortfolioState(input.portfolio, EMPTY_PORTFOLIO_STATE);
        const cashCents = toMinorUnits(cleanPortfolio.cashBalanceUsd);
        const realizedCents = toMinorUnits(cleanPortfolio.realizedPnlUsd);
        const usdInrRate = await resolveUsdInrRate().catch(() => null);

        await tx.execute(
          'UPDATE portfolios SET cash_balance_cents = ?, realized_pnl_cents = ?, updated_at = ? WHERE id = ? AND user_id = ?',
          'UPDATE portfolios SET cash_balance_cents = $1, realized_pnl_cents = $2, updated_at = $3::timestamptz WHERE id = $4 AND user_id = $5',
          [cashCents, realizedCents, nowIso, ensured.defaultPortfolioId, userId],
        );
        await tx.execute(
          'UPDATE paper_trading_accounts SET cash_balance_cents = ?, realized_pnl_cents = ?, updated_at = ? WHERE id = ? AND user_id = ?',
          'UPDATE paper_trading_accounts SET cash_balance_cents = $1, realized_pnl_cents = $2, updated_at = $3::timestamptz WHERE id = $4 AND user_id = $5',
          [cashCents, realizedCents, nowIso, ensured.paperAccountId, userId],
        );

        await tx.execute(
          'DELETE FROM portfolio_holdings WHERE portfolio_id = ? AND user_id = ?',
          'DELETE FROM portfolio_holdings WHERE portfolio_id = $1 AND user_id = $2',
          [ensured.defaultPortfolioId, userId],
        );

        for (const h of cleanPortfolio.holdings) {
          const inst = await resolveInstrumentMeta(h.symbol);
          if (!inst) continue;
          await tx.execute(
            `INSERT INTO portfolio_holdings (id, portfolio_id, user_id, symbol, exchange, region, name, quantity_units, avg_cost_minor, currency, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            `INSERT INTO portfolio_holdings (id, portfolio_id, user_id, symbol, exchange, region, name, quantity_units, avg_cost_minor, currency, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12::timestamptz)`,
            [
              crypto.randomUUID(),
              ensured.defaultPortfolioId,
              userId,
              inst.symbol,
              inst.exchange,
              inst.storageRegion,
              inst.name,
              toQtyUnits(h.quantity),
              toMinorUnits(h.avgCostNative),
              inst.currency,
              nowIso,
              nowIso,
            ],
          );
          importedHoldingsCount += 1;
        }

        for (const ord of cleanPortfolio.orders.slice(0, 25)) {
          const inst = await resolveInstrumentMeta(ord.symbol);
          if (!inst) continue;
          const orderId = crypto.randomUUID();
          const qtyUnits = toQtyUnits(ord.quantity);
          const priceMinor = toMinorUnits(ord.priceNative);
          const totalUsdCents =
            toUsdCentsFromNativeMinor(qtyUnits, priceMinor, inst.currency, usdInrRate) ??
            toMinorUnits(ord.totalUsdEquivalent);
          const realizedOrderCents = toMinorUnits(ord.realizedPnlUsd);

          await tx.execute(
            `INSERT INTO paper_orders (id, user_id, account_id, portfolio_id, client_order_id, symbol, exchange, side, order_type, quantity_units, requested_price_minor, execution_price_minor, currency, total_usd_cents, realized_pnl_cents, status, created_at, executed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'MARKET', ?, ?, ?, ?, ?, ?, 'FILLED', ?, ?)`,
            `INSERT INTO paper_orders (id, user_id, account_id, portfolio_id, client_order_id, symbol, exchange, side, order_type, quantity_units, requested_price_minor, execution_price_minor, currency, total_usd_cents, realized_pnl_cents, status, created_at, executed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'MARKET', $9, $10, $11, $12, $13, $14, 'FILLED', $15::timestamptz, $16::timestamptz)`,
            [
              orderId,
              userId,
              ensured.paperAccountId,
              ensured.defaultPortfolioId,
              `legacy-${ord.id}-${importedOrdersCount}`,
              inst.symbol,
              inst.exchange,
              ord.side,
              qtyUnits,
              priceMinor,
              priceMinor,
              inst.currency,
              totalUsdCents,
              realizedOrderCents,
              nowIso,
              nowIso,
            ],
          );
          importedOrdersCount += 1;
        }
      }

      if (Array.isArray(input.watchlist)) {
        const cleanSymbols = sanitizeWatchlist(input.watchlist, []);
        for (const sym of cleanSymbols) {
          const inst = await resolveInstrumentMeta(sym);
          if (!inst) continue;
          const existing = await tx.queryOne<{ id: string }>(
            'SELECT id FROM watchlist_items WHERE watchlist_id = ? AND symbol = ?',
            'SELECT id FROM watchlist_items WHERE watchlist_id = $1 AND symbol = $2',
            [ensured.defaultWatchlistId, inst.symbol],
          );
          if (!existing) {
            await tx.execute(
              `INSERT INTO watchlist_items (id, watchlist_id, user_id, symbol, exchange, added_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
              `INSERT INTO watchlist_items (id, watchlist_id, user_id, symbol, exchange, added_at)
               VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
              [crypto.randomUUID(), ensured.defaultWatchlistId, userId, inst.symbol, inst.exchange, nowIso],
            );
            importedWatchlistCount += 1;
          }
        }
      }

      let currentPrefs = DEFAULT_USER_PREFERENCES;
      if (prefsRow) {
        try {
          currentPrefs = sanitizePreferencesObject(
            JSON.parse(prefsRow.preferences_json),
            DEFAULT_USER_PREFERENCES,
          );
        } catch {
          currentPrefs = DEFAULT_USER_PREFERENCES;
        }
      }

      if (input.defaultRegion === 'ALL' || input.defaultRegion === 'IN' || input.defaultRegion === 'US') {
        importedRegion = input.defaultRegion;
        currentPrefs = { ...currentPrefs, defaultRegion: input.defaultRegion };
      }

      await tx.execute(
        'UPDATE user_preferences SET preferences_json = ?, legacy_imported_at = ?, updated_at = ? WHERE user_id = ?',
        'UPDATE user_preferences SET preferences_json = $1, legacy_imported_at = $2::timestamptz, updated_at = $3::timestamptz WHERE user_id = $4',
        [JSON.stringify(currentPrefs), nowIso, nowIso, userId],
      );

      await logAuditEvent(tx, {
        userId,
        eventType: 'legacy_workspace_imported',
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        detail: `Imported ${importedHoldingsCount} holdings, ${importedWatchlistCount} watchlist symbols, ${importedOrdersCount} orders.`,
      });

      return {
        ok: true,
        status: 200,
        data: {
          importedAt: nowIso,
          importedHoldingsCount,
          importedWatchlistCount,
          importedOrdersCount,
          importedRegion,
        },
      };
    });
  }

  return {
    ensureUserWorkspace,
    getProfile,
    listPortfolios,
    getPortfolio,
    createPortfolio,
    updatePortfolio,
    deletePortfolio,
    upsertPortfolioHolding,
    removePortfolioHolding,
    listWatchlists,
    createWatchlist,
    updateWatchlist,
    deleteWatchlist,
    addWatchlistItem,
    removeWatchlistItem,
    getPaperAccount,
    listPaperOrders,
    listPaperTransactions,
    executePaperTrade,
    resetPaperAccount,
    listResearchHistory,
    runAndSaveResearch,
    getResearchItem,
    deleteResearchItem,
    listSavedReports,
    createSavedReport,
    deleteSavedReport,
    getPreferences,
    updatePreferences,
    importLegacyBrowserData,
  };
}

export type WorkspaceService = ReturnType<typeof createWorkspaceService>;
