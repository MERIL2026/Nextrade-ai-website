import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FINTECH_EASE, FINTECH_SPRING_SNAPPY } from '../lib/motionPrimitives';
import {
  Home,
  Globe,
  Sparkles,
  Briefcase,
  Activity,
  Bookmark,
  BarChart2,
  Settings,
  Search,
  ArrowLeft,
  Star,
  Menu,
  X,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  User,
  ShieldCheck,
  LogOut,
  Plus,
  Trash2,
  Download,
  BookmarkPlus,
  Loader2,
  Shield,
  Megaphone,
  Wrench,
  Cpu,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { useAuth } from '../lib/authContext';
import { isAdminRole } from '../auth/rbacShared';
import { AccountSettingsPanel, SecuritySessionsPanel } from './auth/AccountSecurityPanels';
import { ResearchHistoryPanel } from './workspace/ResearchHistoryPanel';
import {
  AssetCategory,
  CATALOG_INSTRUMENTS,
  MarketPricePoint,
  MarketQuoteDto,
  MarketRegion,
  MarketSearchResultDto,
  TimeframeKey,
  filterInstruments,
  formatCurrencyValue,
  formatSignedPercent,
  formatVolume,
  getDataStatusColorClass,
} from '../lib/marketData';
import {
  fetchMarketHistory,
  fetchMarketQuote,
  searchMarketInstruments,
  useMarketOverview,
} from '../lib/marketClient';
import {
  EMPTY_PORTFOLIO_STATE,
  PaperPortfolioState,
  calculatePortfolioMetrics,
  calculateSeriesRiskMetrics,
  toStorageRegion,
  toUsdEquivalent,
} from '../lib/portfolioEngine';
import { sanitizePortfolioState, sanitizeWatchlist } from '../lib/security';
import { workspaceApi, WorkspaceUnauthorizedError } from '../lib/workspaceApi';
import type {
  UserPreferencesPayload,
  WorkspacePaperAccount,
  WorkspacePaperOrder,
  WorkspacePaperTransaction,
  WorkspacePortfolio,
  WorkspaceProfilePayload,
  WorkspaceResearchItem,
  WorkspaceResearchResultPayload,
  WorkspaceSavedReport,
  WorkspaceWatchlist,
} from '../workspace/types';
import { InteractivePriceChart } from './SparklineChart';

export type WorkspaceTab =
  | 'home'
  | 'markets'
  | 'research'
  | 'portfolio'
  | 'paper-trading'
  | 'watchlist'
  | 'analytics'
  | 'settings'
  | 'account'
  | 'security';

interface WorkspaceAppProps {
  onNavigate: (path: string) => void;
  initialTab?: string;
  initialSymbol?: string;
  initialRegion?: MarketRegion | 'ALL';
}

const LEGACY_PORTFOLIO_KEY = 'nextrade_paper_portfolio_v1';
const LEGACY_WATCHLIST_KEY = 'nextrade_watchlist_v1';
const LEGACY_REGION_KEY = 'nextrade_default_region_v1';

interface LegacyDraftPayload {
  portfolio: unknown | null;
  watchlist: string[] | null;
  defaultRegion: 'ALL' | MarketRegion | null;
  holdingsCount: number;
  watchlistCount: number;
  ordersCount: number;
}

const DEFAULT_PREFS: UserPreferencesPayload = {
  defaultRegion: 'ALL',
  defaultCurrency: 'USD',
  defaultTab: 'home',
  defaultTimeframe: '1M',
  compactTables: false,
  researchAutoSave: true,
};

const ASSET_CATEGORIES: ReadonlyArray<{ id: 'ALL' | AssetCategory; label: string }> = [
  { id: 'ALL', label: 'All Assets' },
  { id: 'STOCK', label: 'Stocks' },
  { id: 'INDEX', label: 'Indices' },
  { id: 'ETF', label: 'ETFs' },
  { id: 'CRYPTO', label: 'Crypto' },
  { id: 'FOREX', label: 'Forex' },
];

const AI_BUILDING_ROADMAP = [
  {
    name: 'AI Market Analysis Engine',
    status: 'BUILDING',
    detail: 'Structured cross-market synthesis anchored to live quote and OHLC bar history.',
  },
  {
    name: 'AI Portfolio Intelligence',
    status: 'COMING SOON',
    detail: 'Automated concentration, correlation, and currency attribution diagnostics for your holdings.',
  },
  {
    name: 'Predictive & Risk Analytics',
    status: 'COMING SOON',
    detail: 'Quantitative drawdown and volatility regime modeling without fabricated forecasts.',
  },
] as const;

const NAV_ITEMS: { id: WorkspaceTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'markets', label: 'Markets', icon: Globe },
  { id: 'research', label: 'Research', icon: Sparkles },
  { id: 'portfolio', label: 'Portfolio', icon: Briefcase },
  { id: 'paper-trading', label: 'Paper Trading', icon: Activity },
  { id: 'watchlist', label: 'Watchlist', icon: Bookmark },
  { id: 'analytics', label: 'Analytics', icon: BarChart2 },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'account', label: 'Account', icon: User },
  { id: 'security', label: 'Security', icon: ShieldCheck },
];

function isValidTab(tab?: string): tab is WorkspaceTab {
  return NAV_ITEMS.some((item) => item.id === tab);
}

function readLegacyBrowserDraft(): LegacyDraftPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const rawPort = window.localStorage.getItem(LEGACY_PORTFOLIO_KEY);
    const rawWl = window.localStorage.getItem(LEGACY_WATCHLIST_KEY);
    const rawReg = window.localStorage.getItem(LEGACY_REGION_KEY);
    if (!rawPort && !rawWl) return null;

    let parsedPort: unknown | null = null;
    let holdingsCount = 0;
    let ordersCount = 0;
    if (rawPort) {
      const candidate = JSON.parse(rawPort);
      const clean = sanitizePortfolioState(candidate, EMPTY_PORTFOLIO_STATE);
      parsedPort = clean;
      holdingsCount = clean.holdings.length;
      ordersCount = clean.orders.length;
    }

    let parsedWl: string[] | null = null;
    if (rawWl) {
      parsedWl = sanitizeWatchlist(JSON.parse(rawWl), []);
    }

    const defaultRegion =
      rawReg === 'IN' || rawReg === 'US' || rawReg === 'GLOBAL' || rawReg === 'ALL'
        ? rawReg
        : null;

    if (holdingsCount === 0 && (!parsedWl || parsedWl.length === 0)) return null;

    return {
      portfolio: parsedPort,
      watchlist: parsedWl,
      defaultRegion,
      holdingsCount,
      watchlistCount: parsedWl?.length ?? 0,
      ordersCount,
    };
  } catch {
    return null;
  }
}

function clearLegacyBrowserKeys() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_PORTFOLIO_KEY);
    window.localStorage.removeItem(LEGACY_WATCHLIST_KEY);
    window.localStorage.removeItem(LEGACY_REGION_KEY);
  } catch {
    // ignore storage access issues
  }
}

function buildSkeletonQuote(symbol: string): MarketQuoteDto {
  const cat = CATALOG_INSTRUMENTS.find((c) => c.symbol === symbol);
  return {
    symbol: cat?.symbol ?? symbol,
    name: cat?.name ?? symbol,
    exchange: cat?.exchange ?? 'MARKET',
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
    providerId: 'market-engine',
    providerName: 'Market Data Engine',
    status: 'UNAVAILABLE',
    delayMinutes: 0,
    sourceTimestamp: null,
    fetchedAt: null,
    unavailableReason: 'Quote loading or temporarily unavailable.',
  };
}

export const WorkspaceApp: React.FC<WorkspaceAppProps> = ({
  onNavigate,
  initialTab,
  initialSymbol,
  initialRegion,
}) => {
  const { user, logout, clearAuthState } = useAuth();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(
    isValidTab(initialTab) ? initialTab : 'home',
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    if (isValidTab(initialTab)) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const selectWorkspaceTab = (tab: WorkspaceTab) => {
    setActiveTab(tab);
    setMobileSidebarOpen(false);
    if (tab === 'account') {
      onNavigate('/app/account');
    } else if (tab === 'security') {
      onNavigate('/app/security');
    } else if (
      typeof window !== 'undefined' &&
      (window.location.pathname === '/app/account' || window.location.pathname === '/app/security')
    ) {
      onNavigate(`/app?tab=${tab}`);
    }
  };

  const handleSignOut = async () => {
    await logout();
    onNavigate('/login');
  };

  // Real Market Data state
  const {
    data: marketOverview,
    loading: marketLoading,
    error: marketError,
    refresh: refreshMarketOverview,
  } = useMarketOverview({ refreshMs: 60_000 });

  const [selectedSymbol, setSelectedSymbol] = useState<string>(
    initialSymbol && initialSymbol.trim() ? initialSymbol.trim().toUpperCase() : 'NVDA',
  );
  const [timeframe, setTimeframe] = useState<TimeframeKey>('1M');
  const [searchQuery, setSearchQuery] = useState('');
  const [regionFilter, setRegionFilter] = useState<'ALL' | MarketRegion>(initialRegion ?? 'ALL');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | AssetCategory>('ALL');

  const [remoteSearchResults, setRemoteSearchResults] = useState<MarketSearchResultDto[]>([]);
  const [searchingRemote, setSearchingRemote] = useState(false);
  const [extraQuotes, setExtraQuotes] = useState<Record<string, MarketQuoteDto>>({});

  const [historyPoints, setHistoryPoints] = useState<MarketPricePoint[]>([]);
  const [historyStatus, setHistoryStatus] = useState<string>('LOADING');
  const [historyProvider, setHistoryProvider] = useState<string>('Market Data Engine');
  const [historyLoading, setHistoryLoading] = useState<boolean>(true);

  // Server-backed Phase 2 state
  const [wsLoading, setWsLoading] = useState(true);
  const [wsError, setWsError] = useState<string | null>(null);
  const [profile, setProfile] = useState<WorkspaceProfilePayload | null>(null);
  const [portfolios, setPortfolios] = useState<WorkspacePortfolio[]>([]);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>('');
  const [watchlists, setWatchlists] = useState<WorkspaceWatchlist[]>([]);
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string>('');
  const [paperAccount, setPaperAccount] = useState<WorkspacePaperAccount | null>(null);
  const [paperOrders, setPaperOrders] = useState<WorkspacePaperOrder[]>([]);
  const [paperTransactions, setPaperTransactions] = useState<WorkspacePaperTransaction[]>([]);
  const [researchHistory, setResearchHistory] = useState<WorkspaceResearchItem[]>([]);
  const [savedReports, setSavedReports] = useState<WorkspaceSavedReport[]>([]);
  const [preferences, setPreferences] = useState<UserPreferencesPayload>(DEFAULT_PREFS);

  // Legacy migration prompt state
  const [legacyDraft, setLegacyDraft] = useState<LegacyDraftPayload | null>(null);
  const [importingLegacy, setImportingLegacy] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  // Paper order ticket state
  const [orderSide, setOrderSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderQty, setOrderQty] = useState<string>('5');
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orderFeedback, setOrderFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Portfolio management & manual holding form state
  const [newPortfolioName, setNewPortfolioName] = useState('');
  const [creatingPortfolio, setCreatingPortfolio] = useState(false);
  const [manualSymbol, setManualSymbol] = useState('NVDA');
  const [manualQty, setManualQty] = useState('10');
  const [manualAvgCost, setManualAvgCost] = useState('');
  const [savingHolding, setSavingHolding] = useState(false);

  // Watchlist management state
  const [newWatchlistName, setNewWatchlistName] = useState('');
  const [creatingWatchlist, setCreatingWatchlist] = useState(false);
  const [portfolioActionMsg, setPortfolioActionMsg] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<
    Array<{ id: string; title: string; content: string; severity: string }>
  >([]);
  const [dismissedAnnIds, setDismissedAnnIds] = useState<Set<string>>(() => new Set());
  const [maintenanceStatus, setMaintenanceStatus] = useState<{
    active: boolean;
    bypassed: boolean;
    source: string;
    message: string;
    expectedCompletionNote: string;
    endsAt: string | null;
  } | null>(null);

  // AI Research Assistant state
  const [researchPrompt, setResearchPrompt] = useState<string>(
    'Evaluate key business drivers, valuation dispersion, and primary downside risks.',
  );
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchResult, setResearchResult] = useState<WorkspaceResearchResultPayload | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [savingReportId, setSavingReportId] = useState<string | null>(null);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null);

  // Settings feedback
  const [settingsFeedback, setSettingsFeedback] = useState<string | null>(null);

  const fetchMaintenanceStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/maintenance/status', {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        active?: boolean;
        bypassed?: boolean;
        source?: string;
        message?: string;
        expectedCompletionNote?: string;
        endsAt?: string | null;
      };
      setMaintenanceStatus({
        active: Boolean(data.active),
        bypassed: Boolean(data.bypassed),
        source: data.source ?? 'none',
        message: data.message ?? '',
        expectedCompletionNote: data.expectedCompletionNote ?? '',
        endsAt: data.endsAt ?? null,
      });
    } catch {
      // Non-blocking status check
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/announcements/active', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            announcements?: Array<{ id: string; title: string; content: string; severity: string }>;
          } | null,
        ) => {
          if (!cancelled && data && Array.isArray(data.announcements)) {
            setAnnouncements(data.announcements);
          }
        },
      )
      .catch(() => {});

    fetch('/api/health', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { geminiConfigured?: boolean } | null) => {
        if (!cancelled && data && typeof data.geminiConfigured === 'boolean') {
          setGeminiConfigured(data.geminiConfigured);
        }
      })
      .catch(() => {});

    void fetchMaintenanceStatus();
    return () => {
      cancelled = true;
    };
  }, [fetchMaintenanceStatus]);

  const handleApiError = useCallback(
    (err: unknown, fallbackMsg: string): string => {
      if (err instanceof WorkspaceUnauthorizedError) {
        clearAuthState();
        onNavigate('/login?redirect=/app');
        return err.message;
      }
      return err instanceof Error ? err.message : fallbackMsg;
    },
    [clearAuthState, onNavigate],
  );

  const loadWorkspaceData = useCallback(async () => {
    if (!user?.id) return;
    setWsLoading(true);
    setWsError(null);
    try {
      const [
        profRes,
        portList,
        wlList,
        paperAccRes,
        ordersRes,
        txRes,
        researchRes,
        reportsList,
        prefsRes,
      ] = await Promise.all([
        workspaceApi.getProfile(),
        workspaceApi.listPortfolios(),
        workspaceApi.listWatchlists(),
        workspaceApi.getPaperAccount(),
        workspaceApi.listPaperOrders({ limit: 50 }),
        workspaceApi.listPaperTransactions({ limit: 50 }),
        workspaceApi.listResearchHistory({ limit: 50 }),
        workspaceApi.listSavedReports(),
        workspaceApi.getPreferences(),
      ]);

      setProfile(profRes);
      setPortfolios(portList);
      setSelectedPortfolioId((prev) =>
        prev && portList.some((p) => p.id === prev)
          ? prev
          : profRes.defaultPortfolioId || portList[0]?.id || '',
      );
      setWatchlists(wlList);
      setSelectedWatchlistId((prev) =>
        prev && wlList.some((w) => w.id === prev)
          ? prev
          : profRes.defaultWatchlistId || wlList[0]?.id || '',
      );
      setPaperAccount(paperAccRes.account);
      setPaperOrders(ordersRes.orders);
      setPaperTransactions(txRes.transactions);
      setResearchHistory(researchRes.items);
      setSavedReports(reportsList);
      setPreferences(prefsRes);

      if (!initialRegion) {
        setRegionFilter(prefsRes.defaultRegion);
      }
      if (prefsRes.defaultTimeframe) {
        setTimeframe(prefsRes.defaultTimeframe);
      }
      if (!isValidTab(initialTab) && prefsRes.defaultTab && window.location.pathname === '/app') {
        const params = new URLSearchParams(window.location.search);
        if (!params.get('tab')) {
          setActiveTab(prefsRes.defaultTab);
        }
      }

      if (!profRes.legacyImportedAt) {
        setLegacyDraft(readLegacyBrowserDraft());
      } else {
        setLegacyDraft(null);
      }
    } catch (err) {
      setWsError(handleApiError(err, 'Unable to load workspace data from server.'));
    } finally {
      setWsLoading(false);
    }
  }, [handleApiError, initialRegion, initialTab, user?.id]);

  useEffect(() => {
    setPortfolios([]);
    setWatchlists([]);
    setPaperAccount(null);
    setPaperOrders([]);
    setPaperTransactions([]);
    setResearchHistory([]);
    setSavedReports([]);
    setResearchResult(null);
    setOrderFeedback(null);
    void loadWorkspaceData();
  }, [loadWorkspaceData, user?.id]);

  // Remote global symbol search (debounced)
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setRemoteSearchResults([]);
      setSearchingRemote(false);
      return;
    }
    const controller = new AbortController();
    setSearchingRemote(true);
    const timer = setTimeout(() => {
      searchMarketInstruments(q, controller.signal)
        .then((res) => setRemoteSearchResults(res))
        .catch(() => setRemoteSearchResults([]))
        .finally(() => setSearchingRemote(false));
    }, 280);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  // Merge overview quotes + extra dynamically fetched quotes (for custom/searched holdings/watchlist symbols)
  const overviewQuotes = useMemo(() => marketOverview?.instruments ?? [], [marketOverview]);
  const overviewIndices = useMemo(() => marketOverview?.indices ?? [], [marketOverview]);
  const usdInrRate = marketOverview?.usdInrRate ?? null;
  const usdInrStatus = marketOverview?.usdInrStatus ?? 'UNAVAILABLE';

  const allKnownQuotes: MarketQuoteDto[] = useMemo(() => {
    const bySym = new Map<string, MarketQuoteDto>();
    for (const q of overviewQuotes) {
      bySym.set(q.symbol.toUpperCase(), q);
    }
    for (const [sym, q] of Object.entries(extraQuotes)) {
      if (!bySym.has(sym.toUpperCase())) {
        bySym.set(sym.toUpperCase(), q);
      }
    }
    return Array.from(bySym.values());
  }, [overviewQuotes, extraQuotes]);

  const activeInstrument: MarketQuoteDto = useMemo(() => {
    const upper = selectedSymbol.toUpperCase();
    return (
      allKnownQuotes.find((q) => q.symbol.toUpperCase() === upper) ??
      buildSkeletonQuote(upper)
    );
  }, [allKnownQuotes, selectedSymbol]);

  const activePortfolio = useMemo(
    () =>
      portfolios.find((p) => p.id === selectedPortfolioId) ??
      portfolios.find((p) => p.isDefault) ??
      portfolios[0] ??
      null,
    [portfolios, selectedPortfolioId],
  );

  const paperLinkedPortfolio = useMemo(
    () =>
      (paperAccount && portfolios.find((p) => p.id === paperAccount.portfolioId)) ||
      portfolios.find((p) => p.isDefault) ||
      portfolios[0] ||
      null,
    [paperAccount, portfolios],
  );

  const activeWatchlist = useMemo(
    () =>
      watchlists.find((w) => w.id === selectedWatchlistId) ??
      watchlists.find((w) => w.isDefault) ??
      watchlists[0] ??
      null,
    [watchlists, selectedWatchlistId],
  );

  const watchlistSymbols = useMemo(
    () => (activeWatchlist ? activeWatchlist.items.map((item) => item.symbol) : []),
    [activeWatchlist],
  );

  // Fetch quotes for any custom selected/held/watchlisted symbols missing from overview
  useEffect(() => {
    const needed = new Set<string>();
    needed.add(selectedSymbol.toUpperCase());
    for (const h of activePortfolio?.holdings ?? []) {
      needed.add(h.symbol.toUpperCase());
    }
    for (const sym of watchlistSymbols) {
      needed.add(sym.toUpperCase());
    }
    const knownSet = new Set(allKnownQuotes.map((q) => q.symbol.toUpperCase()));
    const missing = Array.from(needed).filter((sym) => !knownSet.has(sym));
    if (missing.length === 0) return;

    let active = true;
    const controller = new AbortController();
    Promise.all(
      missing.slice(0, 6).map((sym) =>
        fetchMarketQuote(sym, controller.signal).catch(() => null),
      ),
    ).then((fetched) => {
      if (!active) return;
      const updates: Record<string, MarketQuoteDto> = {};
      for (const q of fetched) {
        if (q) updates[q.symbol.toUpperCase()] = q;
      }
      if (Object.keys(updates).length > 0) {
        setExtraQuotes((prev) => ({ ...prev, ...updates }));
      }
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [selectedSymbol, activePortfolio?.holdings, watchlistSymbols, allKnownQuotes]);

  // Fetch real OHLC series whenever symbol or timeframe changes
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setHistoryLoading(true);
    fetchMarketHistory(selectedSymbol, timeframe, controller.signal)
      .then((res) => {
        if (!active) return;
        setHistoryPoints(res.points);
        setHistoryStatus(res.dataStatus);
        setHistoryProvider(res.provider);
      })
      .catch(() => {
        if (!active) return;
        setHistoryPoints([]);
        setHistoryStatus('UNAVAILABLE');
        setHistoryProvider('Market Data Engine');
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [selectedSymbol, timeframe]);

  const enginePortfolioState: PaperPortfolioState = useMemo(() => {
    const target = activePortfolio ?? paperLinkedPortfolio;
    if (!target) {
      return { cashBalanceUsd: 0, realizedPnlUsd: 0, holdings: [], orders: [] };
    }
    return {
      cashBalanceUsd: target.cashBalanceUsd,
      realizedPnlUsd: target.realizedPnlUsd,
      holdings: target.holdings.map((h) => ({
        symbol: h.symbol,
        name: h.name,
        exchange: h.exchange,
        region: toStorageRegion(h.region, h.currency),
        currency: h.currency,
        quantity: h.quantity,
        avgCostNative: h.avgCostNative,
      })),
      orders: paperOrders.map((o) => ({
        id: o.id.slice(0, 8).toUpperCase(),
        timestamp: o.createdAt,
        symbol: o.symbol,
        side: o.side,
        quantity: o.quantity,
        priceNative: o.executionPriceNative,
        currency: o.currency,
        totalUsdEquivalent: o.totalUsdEquivalent,
        realizedPnlUsd: o.realizedPnlUsd,
        status: 'SIMULATED_FILLED',
      })),
    };
  }, [activePortfolio, paperLinkedPortfolio, paperOrders]);

  const filteredInstruments = useMemo(
    () => filterInstruments(overviewQuotes, searchQuery, regionFilter, categoryFilter),
    [overviewQuotes, searchQuery, regionFilter, categoryFilter],
  );

  const portfolioMetrics = useMemo(
    () => calculatePortfolioMetrics(enginePortfolioState, allKnownQuotes, usdInrRate),
    [enginePortfolioState, allKnownQuotes, usdInrRate],
  );

  const seriesRisk = useMemo(
    () => calculateSeriesRiskMetrics(historyPoints.map((pt) => pt.price)),
    [historyPoints],
  );

  const toggleWatchlist = async (symbol: string) => {
    const targetList = activeWatchlist;
    if (!targetList) return;
    const upper = symbol.toUpperCase();
    const existingItem = targetList.items.find((i) => i.symbol.toUpperCase() === upper);
    try {
      if (existingItem) {
        await workspaceApi.removeWatchlistItem(targetList.id, existingItem.id);
      } else {
        await workspaceApi.addWatchlistItem(targetList.id, upper);
      }
      const updatedLists = await workspaceApi.listWatchlists();
      setWatchlists(updatedLists);
    } catch (err) {
      setWsError(handleApiError(err, 'Unable to update watchlist item.'));
    }
  };

  const handleSelectInstrument = (symbol: string, targetTab?: WorkspaceTab) => {
    setSelectedSymbol(symbol.toUpperCase());
    setOrderFeedback(null);
    if (targetTab) setActiveTab(targetTab);
  };

  const handlePlacePaperOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (orderSubmitting) return;
    if (activeInstrument.price === null || activeInstrument.price <= 0) {
      setOrderFeedback({
        type: 'error',
        message: `Live/cached execution quote for ${activeInstrument.symbol} is currently unavailable.`,
      });
      return;
    }
    if (activeInstrument.currency === 'INR' && (!usdInrRate || usdInrRate <= 0)) {
      setOrderFeedback({
        type: 'error',
        message: 'USD/INR FX conversion rate is temporarily unavailable for INR order settlement.',
      });
      return;
    }

    const qty = Number(orderQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setOrderFeedback({ type: 'error', message: 'Enter a valid order quantity greater than 0.' });
      return;
    }

    setOrderSubmitting(true);
    setOrderFeedback(null);
    try {
      const clientOrderId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `ord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const res = await workspaceApi.executePaperOrder({
        symbol: activeInstrument.symbol,
        side: orderSide,
        quantity: qty,
        orderType: 'MARKET',
        clientOrderId,
      });

      setPaperAccount(res.account);
      setPortfolios((prev) =>
        prev.map((p) => (p.id === res.portfolio.id ? res.portfolio : p)),
      );
      setPaperOrders((prev) => [res.order, ...prev.filter((o) => o.id !== res.order.id)]);
      setPaperTransactions((prev) => [
        res.transaction,
        ...prev.filter((t) => t.id !== res.transaction.id),
      ]);
      setOrderFeedback({
        type: 'success',
        message: `SIMULATED ${orderSide} ${qty} ${activeInstrument.symbol} @ ${formatCurrencyValue(
          res.order.executionPriceNative,
          res.order.currency,
        )} recorded on server (No real money executed).`,
      });
    } catch (err) {
      setOrderFeedback({
        type: 'error',
        message: handleApiError(err, 'Paper order execution failed.'),
      });
    } finally {
      setOrderSubmitting(false);
    }
  };

  const handleResetCleanPaperAccount = async () => {
    try {
      const res = await workspaceApi.resetPaperAccount('clean');
      setPaperAccount(res.account);
      setPortfolios((prev) =>
        prev.map((p) => (p.id === res.portfolio.id ? res.portfolio : p)),
      );
      const [ordersRes, txRes] = await Promise.all([
        workspaceApi.listPaperOrders({ limit: 50 }),
        workspaceApi.listPaperTransactions({ limit: 50 }),
      ]);
      setPaperOrders(ordersRes.orders);
      setPaperTransactions(txRes.transactions);
      setOrderFeedback({
        type: 'success',
        message:
          'Simulated paper trading account reset to a clean $100,000.00 balance with zero holdings.',
      });
    } catch (err) {
      setOrderFeedback({
        type: 'error',
        message: handleApiError(err, 'Failed to reset paper trading account.'),
      });
    }
  };

  const handleUpsertManualHolding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePortfolio || savingHolding) return;
    const sym = manualSymbol.trim().toUpperCase();
    const qty = Number(manualQty);
    const avgCost = Number(manualAvgCost);
    if (!sym || !Number.isFinite(qty) || qty <= 0) {
      setPortfolioActionMsg('Enter a valid symbol and positive quantity.');
      return;
    }
    if (!Number.isFinite(avgCost) || avgCost < 0) {
      setPortfolioActionMsg('Explicit average cost basis (>= 0) is required.');
      return;
    }

    setSavingHolding(true);
    setPortfolioActionMsg(null);
    try {
      const updated = await workspaceApi.upsertHolding(activePortfolio.id, sym, {
        quantity: qty,
        avgCostNative: avgCost,
      });
      setPortfolios((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setPortfolioActionMsg(`Saved ${sym} position (${qty} units @ ${avgCost}) to "${updated.name}".`);
      setManualAvgCost('');
    } catch (err) {
      setPortfolioActionMsg(handleApiError(err, 'Could not save holding.'));
    } finally {
      setSavingHolding(false);
    }
  };

  const handleDeleteManualHolding = async (symbol: string) => {
    if (!activePortfolio) return;
    setPortfolioActionMsg(null);
    try {
      const updated = await workspaceApi.deleteHolding(activePortfolio.id, symbol);
      setPortfolios((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setPortfolioActionMsg(`Removed ${symbol} from "${updated.name}".`);
    } catch (err) {
      setPortfolioActionMsg(handleApiError(err, 'Unable to remove holding.'));
    }
  };

  const handleRunResearch = async (e?: React.FormEvent, customPrompt?: string) => {
    e?.preventDefault();
    const queryToSend = (customPrompt ?? researchPrompt).trim();
    if (!queryToSend) {
      setResearchError('Please enter a research question before running analysis.');
      return;
    }

    setResearchLoading(true);
    setResearchError(null);
    try {
      const item = await workspaceApi.runResearch({
        symbol: activeInstrument.symbol,
        query: queryToSend,
      });
      setResearchResult(item.result);
      if (preferences.researchAutoSave) {
        setResearchHistory((prev) => [item, ...prev]);
      }
    } catch (err) {
      setResearchError(handleApiError(err, 'Unable to complete research request.'));
    } finally {
      setResearchLoading(false);
    }
  };

  const handleDeleteResearch = async (id: string) => {
    try {
      await workspaceApi.deleteResearchItem(id);
      setResearchHistory((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setResearchError(handleApiError(err, 'Failed to delete research entry.'));
    }
  };

  const handleSaveResearchAsReport = async (item: WorkspaceResearchItem) => {
    setSavingReportId(item.id);
    try {
      const rep = await workspaceApi.createSavedReport({
        title: `${item.symbol} — ${item.query.slice(0, 72)}`,
        reportType: 'research-brief',
        symbol: item.symbol,
        content: item.result as unknown as Record<string, unknown>,
      });
      setSavedReports((prev) => [rep, ...prev]);
    } catch (err) {
      setResearchError(handleApiError(err, 'Unable to save report.'));
    } finally {
      setSavingReportId(null);
    }
  };

  const handleSaveCurrentResultAsReport = async () => {
    if (!researchResult) return;
    setSavingReportId('current');
    try {
      const rep = await workspaceApi.createSavedReport({
        title: `${researchResult.symbol} — ${researchPrompt.slice(0, 72)}`,
        reportType: 'research-brief',
        symbol: researchResult.symbol,
        content: researchResult as unknown as Record<string, unknown>,
      });
      setSavedReports((prev) => [rep, ...prev]);
    } catch (err) {
      setResearchError(handleApiError(err, 'Unable to save report.'));
    } finally {
      setSavingReportId(null);
    }
  };

  const handleDeleteReport = async (id: string) => {
    try {
      await workspaceApi.deleteSavedReport(id);
      setSavedReports((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setResearchError(handleApiError(err, 'Unable to delete report.'));
    }
  };

  const handleCreatePortfolio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPortfolioName.trim() || creatingPortfolio) return;
    setCreatingPortfolio(true);
    setPortfolioActionMsg(null);
    try {
      const created = await workspaceApi.createPortfolio({
        name: newPortfolioName.trim(),
        baseCurrency: 'USD',
        initialBalanceUsd: 100_000,
      });
      setPortfolios((prev) => [...prev, created]);
      setSelectedPortfolioId(created.id);
      setNewPortfolioName('');
      setPortfolioActionMsg(`Created clean portfolio "${created.name}".`);
    } catch (err) {
      setPortfolioActionMsg(handleApiError(err, 'Could not create portfolio.'));
    } finally {
      setCreatingPortfolio(false);
    }
  };

  const handleDeletePortfolio = async (id: string) => {
    setPortfolioActionMsg(null);
    try {
      await workspaceApi.deletePortfolio(id);
      const nextList = portfolios.filter((p) => p.id !== id);
      setPortfolios(nextList);
      if (selectedPortfolioId === id) {
        setSelectedPortfolioId(nextList[0]?.id ?? '');
      }
      setPortfolioActionMsg('Portfolio deleted.');
    } catch (err) {
      setPortfolioActionMsg(handleApiError(err, 'Unable to delete portfolio.'));
    }
  };

  const handleCreateWatchlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWatchlistName.trim() || creatingWatchlist) return;
    setCreatingWatchlist(true);
    try {
      const created = await workspaceApi.createWatchlist(newWatchlistName.trim());
      setWatchlists((prev) => [...prev, created]);
      setSelectedWatchlistId(created.id);
      setNewWatchlistName('');
    } catch (err) {
      setWsError(handleApiError(err, 'Unable to create watchlist.'));
    } finally {
      setCreatingWatchlist(false);
    }
  };

  const handleDeleteWatchlist = async (id: string) => {
    try {
      await workspaceApi.deleteWatchlist(id);
      const updated = await workspaceApi.listWatchlists();
      setWatchlists(updated);
      if (selectedWatchlistId === id) {
        setSelectedWatchlistId(updated[0]?.id ?? '');
      }
    } catch (err) {
      setWsError(handleApiError(err, 'Unable to delete watchlist.'));
    }
  };

  const handleUpdatePreference = async (patch: Partial<UserPreferencesPayload>) => {
    const optimistic = { ...preferences, ...patch };
    setPreferences(optimistic);
    if (patch.defaultRegion) setRegionFilter(patch.defaultRegion);
    if (patch.defaultTimeframe) setTimeframe(patch.defaultTimeframe);
    setSettingsFeedback(null);
    try {
      const saved = await workspaceApi.updatePreferences(patch);
      setPreferences(saved);
      setSettingsFeedback('Preferences saved to your account.');
    } catch (err) {
      setSettingsFeedback(handleApiError(err, 'Failed to save preferences.'));
    }
  };

  const handleRegionChange = async (reg: 'ALL' | MarketRegion) => {
    setRegionFilter(reg);
    try {
      const saved = await workspaceApi.updatePreferences({ defaultRegion: reg });
      setPreferences(saved);
    } catch {
      // keep UI responsive even if background pref save fails
    }
  };

  const handleImportLegacy = async () => {
    if (!legacyDraft || importingLegacy) return;
    setImportingLegacy(true);
    try {
      const summary = await workspaceApi.importLegacyData({
        portfolio: legacyDraft.portfolio,
        watchlist: legacyDraft.watchlist,
        defaultRegion: legacyDraft.defaultRegion,
      });
      clearLegacyBrowserKeys();
      setLegacyDraft(null);
      setImportNotice(
        `Imported ${summary.importedHoldingsCount} holdings, ${summary.importedWatchlistCount} watchlist symbols, and ${summary.importedOrdersCount} simulated orders into your private account.`,
      );
      await loadWorkspaceData();
    } catch (err) {
      setWsError(handleApiError(err, 'Failed to import legacy browser workspace data.'));
    } finally {
      setImportingLegacy(false);
    }
  };

  const handleDismissLegacy = () => {
    setLegacyDraft(null);
  };

  const paperPortfolioHoldings = paperLinkedPortfolio?.holdings ?? [];
  const activePaperHolding = paperPortfolioHoldings.find(
    (h) => h.symbol.toUpperCase() === activeInstrument.symbol.toUpperCase(),
  );
  const qtyNum = Number(orderQty) || 0;
  const estOrderUsd =
    activeInstrument.price !== null && qtyNum > 0
      ? toUsdEquivalent(qtyNum * activeInstrument.price, activeInstrument.currency, usdInrRate)
      : null;

  const isPositive = (activeInstrument.changePercent ?? 0) >= 0;

  return (
    <div className="min-h-screen bg-[#F7F8FA] text-[#080B12] flex flex-col lg:flex-row">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:w-[244px] lg:shrink-0 flex-col justify-between border-r border-[#E4E8F2] bg-[#FFFFFF] p-4 sticky top-0 h-screen">
        <div className="space-y-6">
          <div className="flex items-center justify-between px-2 pt-1">
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2D46E6] rounded-sm cursor-pointer"
              aria-label="Back to Nextrade AI Website"
            >
              <BrandLogo variant="light" symbolHeightClass="h-4" />
            </button>
          </div>

          <nav aria-label="Workspace navigation" className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectWorkspaceTab(item.id)}
                  className={`relative w-full flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors cursor-pointer ${
                    active
                      ? 'text-[#FFFFFF] shadow-[0_6px_16px_rgba(45,70,230,0.22)]'
                      : 'text-[#667085] hover:text-[#080B12] hover:bg-[#EFF2FA]'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="workspace-sidebar-pill"
                      transition={FINTECH_SPRING_SNAPPY}
                      className="absolute inset-0 rounded-lg bg-[#2D46E6]"
                      aria-hidden="true"
                    />
                  )}
                  <Icon className="relative z-10 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="relative z-10 truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="space-y-3 border-t border-[#E4E8F2] pt-4 px-2">
          {user && isAdminRole(profile?.role ?? user.role) && (
            <button
              type="button"
              onClick={() => onNavigate('/admin')}
              className="w-full flex items-center justify-between gap-2 rounded-lg border border-[#1E293B] bg-[#101827] px-3 py-2 text-xs font-semibold text-[#FFFFFF] hover:bg-[#1E293B] transition-colors cursor-pointer"
            >
              <span className="inline-flex items-center gap-2">
                <Shield className="h-3.5 w-3.5 text-[#38BDF8]" aria-hidden="true" />
                <span>Admin Console</span>
              </span>
              <span className="font-mono text-[9px] uppercase tracking-wider text-[#94A3B8]">
                RBAC
              </span>
            </button>
          )}
          {user && (
            <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-2.5 text-[11px]">
              <div className="flex items-center justify-between gap-1.5">
                <span className="font-semibold text-[#080B12] truncate">{user.fullName}</span>
                <span className="font-mono text-[9px] font-semibold uppercase text-[#2D46E6]">
                  {profile?.role ?? user.role}
                </span>
              </div>
              <div className="text-[#667085] truncate">{user.email}</div>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#667085] hover:text-[#2D46E6] transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Website</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#DC2626] hover:underline cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Workspace Header */}
        <header className="sticky top-0 z-30 border-b border-[#E4E8F2] bg-[#FFFFFF]/92 backdrop-blur-md px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileSidebarOpen((v) => !v)}
                aria-label="Toggle workspace navigation"
                aria-expanded={mobileSidebarOpen}
                className="inline-flex lg:hidden h-10 w-10 items-center justify-center rounded-md border border-[#E4E8F2] bg-[#FFFFFF] text-[#080B12] cursor-pointer"
              >
                {mobileSidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>

              <div className="flex items-center gap-2 text-xs sm:text-sm min-w-0">
                <span className="text-[#667085] hidden sm:inline">Workspace</span>
                <span className="text-[#CBD5E1] hidden sm:inline">/</span>
                <span className="font-display font-semibold text-[#080B12] capitalize truncate">
                  {activeTab.replace('-', ' ')}
                </span>
              </div>
            </div>

            {/* Search, Region Filter & User Controls */}
            <div className="flex items-center gap-2.5 flex-1 max-w-2xl justify-end">
              <div className="relative flex-1 max-w-[230px]">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#667085]"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search stocks, crypto, FX..."
                  aria-label="Search financial instruments"
                  className="w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] pl-8 pr-3 py-1.5 text-xs text-[#080B12] placeholder:text-[#94A3B8] focus:border-[#2D46E6] focus:bg-[#FFFFFF] focus:outline-none"
                />
              </div>

              <div
                role="group"
                aria-label="Workspace market region filter"
                className="hidden sm:inline-flex items-center rounded-md border border-[#E4E8F2] bg-[#F7F8FA] p-0.5 shrink-0"
              >
                {(['ALL', 'IN', 'US', 'GLOBAL'] as const).map((reg) => {
                  const active = regionFilter === reg;
                  return (
                    <button
                      key={reg}
                      type="button"
                      onClick={() => void handleRegionChange(reg)}
                      className={`relative rounded px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                        active ? 'text-[#FFFFFF]' : 'text-[#667085] hover:text-[#080B12]'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="workspace-region-pill"
                          transition={FINTECH_SPRING_SNAPPY}
                          className="absolute inset-0 rounded bg-[#2D46E6]"
                          aria-hidden="true"
                        />
                      )}
                      <span className="relative z-10">{reg === 'ALL' ? 'All' : reg}</span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => void refreshMarketOverview()}
                title="Refresh market feeds"
                aria-label="Refresh market quotes"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#E4E8F2] bg-[#FFFFFF] text-[#667085] hover:text-[#2D46E6] hover:border-[#2D46E6] cursor-pointer shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${marketLoading ? 'animate-spin' : ''}`} />
              </button>

              {user && (
                <div className="hidden md:flex items-center gap-1.5 border-l border-[#E4E8F2] pl-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => selectWorkspaceTab('account')}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 text-xs font-medium text-[#080B12] hover:border-[#2D46E6] cursor-pointer"
                    title={user.email}
                  >
                    <User className="h-3.5 w-3.5 text-[#2D46E6]" aria-hidden="true" />
                    <span className="max-w-[110px] truncate">{user.fullName}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    aria-label="Sign Out"
                    title="Sign Out"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#E4E8F2] bg-[#FFFFFF] text-[#667085] hover:border-[#FECACA] hover:text-[#DC2626] cursor-pointer"
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Mobile Drawer */}
          {mobileSidebarOpen && (
            <div className="mt-3 border-t border-[#E4E8F2] pt-3 lg:hidden space-y-2">
              <div className="grid grid-cols-2 gap-1.5">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectWorkspaceTab(item.id)}
                      className={`flex items-center gap-2 rounded-md px-3 py-2.5 text-xs font-medium cursor-pointer ${
                        active
                          ? 'bg-[#2D46E6] text-[#FFFFFF]'
                          : 'text-[#667085] bg-[#F7F8FA] hover:text-[#080B12]'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
              {user && isAdminRole(profile?.role ?? user.role) && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileSidebarOpen(false);
                    onNavigate('/admin');
                  }}
                  className="w-full flex items-center justify-center gap-2 rounded-md bg-[#101827] px-3 py-2 text-xs font-semibold text-[#FFFFFF] cursor-pointer"
                >
                  <Shield className="h-3.5 w-3.5 text-[#38BDF8]" aria-hidden="true" />
                  <span>Open Admin Console</span>
                </button>
              )}
              <div className="flex items-center justify-between pt-2 border-t border-[#E4E8F2]">
                <button
                  type="button"
                  onClick={() => onNavigate('/')}
                  className="text-xs text-[#667085] hover:text-[#2D46E6] py-2 cursor-pointer"
                >
                  ← Return to Website
                </button>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="text-xs font-semibold text-[#DC2626] py-2 cursor-pointer"
                >
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </header>

        {/* Main Workspace Views */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1280px] w-full mx-auto">
          {/* Active Maintenance Window / Gate Notice */}
          {maintenanceStatus?.active && !maintenanceStatus.bypassed && (
            <div
              role="status"
              className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs text-[#92400E]"
            >
              <div className="flex items-start gap-3">
                <Wrench className="h-5 w-5 shrink-0 mt-0.5 text-[#D97706]" aria-hidden="true" />
                <div className="space-y-1">
                  <div className="font-display text-sm font-bold text-[#78350F]">
                    Scheduled Platform Maintenance Active
                  </div>
                  <p className="leading-relaxed">
                    {maintenanceStatus.message ||
                      'Nextrade AI workspace operations are temporarily paused for scheduled maintenance.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void fetchMaintenanceStatus()}
                  className="h-8 rounded-md border border-[#FCD34D] bg-[#FFFFFF] px-3 font-semibold text-[#92400E] hover:bg-[#FEF3C7] cursor-pointer"
                >
                  Check Status
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('/')}
                  className="h-8 rounded-md bg-[#92400E] px-3 font-semibold text-[#FFFFFF] hover:bg-[#78350F] cursor-pointer"
                >
                  Return Home
                </button>
              </div>
            </div>
          )}

          {maintenanceStatus?.active && maintenanceStatus.bypassed && (
            <div
              role="status"
              className="flex items-center justify-between gap-3 rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-2.5 text-xs text-[#1E3A8A]"
            >
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 shrink-0 text-[#2D46E6]" aria-hidden="true" />
                <span>
                  <strong>Maintenance Active (Role Bypass):</strong> Administrative role has workspace bypass access.
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('/admin/releases')}
                className="font-semibold text-[#2D46E6] hover:underline shrink-0 cursor-pointer"
              >
                Manage Window →
              </button>
            </div>
          )}

          {/* Active Platform Announcements */}
          {announcements
            .filter((ann) => !dismissedAnnIds.has(ann.id))
            .slice(0, 2)
            .map((ann) => (
              <div
                key={ann.id}
                role="status"
                className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
                  ann.severity.toUpperCase() === 'CRITICAL'
                    ? 'border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]'
                    : ann.severity.toUpperCase() === 'WARNING'
                      ? 'border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]'
                      : 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1E3A8A]'
                }`}
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <Megaphone className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="min-w-0">
                    <span className="font-semibold">{ann.title}:</span>{' '}
                    <span className="opacity-90">{ann.content}</span>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Dismiss announcement ${ann.title}`}
                  onClick={() =>
                    setDismissedAnnIds((prev) => {
                      const next = new Set(prev);
                      next.add(ann.id);
                      return next;
                    })
                  }
                  className="shrink-0 rounded p-0.5 hover:bg-black/5 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}

          {/* Market / Workspace Errors */}
          {(wsError || marketError) && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-xs text-[#B91C1C]"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{wsError ?? marketError}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  void loadWorkspaceData();
                  void refreshMarketOverview();
                }}
                className="rounded border border-[#FECACA] bg-[#FFFFFF] px-3 py-1 font-semibold text-[#B91C1C] hover:bg-[#FEF2F2] cursor-pointer"
              >
                Retry Sync
              </button>
            </div>
          )}

          {/* Legacy Migration Banner */}
          {legacyDraft && (
            <div className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-bold text-[#1E3A8A]">
                  <Download className="h-4 w-4 text-[#2D46E6]" aria-hidden="true" />
                  <span>Previous Browser-Local Workspace Data Detected</span>
                </div>
                <p className="text-xs text-[#1E40AF]">
                  Found local holdings ({legacyDraft.holdingsCount}), watchlist ({legacyDraft.watchlistCount}), and simulated orders ({legacyDraft.ordersCount}). Import into your private account?
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleDismissLegacy}
                  className="rounded-md border border-[#CBD5E1] bg-[#FFFFFF] px-3 py-1.5 text-xs font-medium text-[#667085] hover:text-[#080B12] cursor-pointer"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  disabled={importingLegacy}
                  onClick={() => void handleImportLegacy()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#2D46E6] px-3.5 py-1.5 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] disabled:opacity-60 cursor-pointer"
                >
                  {importingLegacy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>{importingLegacy ? 'Importing...' : 'Import to Account'}</span>
                </button>
              </div>
            </div>
          )}

          {importNotice && (
            <div
              role="status"
              className="flex items-center justify-between gap-3 rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 text-xs text-[#15803D]"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{importNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => setImportNotice(null)}
                className="font-semibold hover:underline cursor-pointer"
              >
                Close
              </button>
            </div>
          )}

          {/* Quick Local + Remote Symbol Search Results */}
          {searchQuery.trim() && (
            <section
              aria-label="Instrument search matches"
              className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3 shadow-[0_6px_18px_rgba(15,23,42,0.03)]"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-[#080B12]">
                  Search results for &ldquo;{searchQuery}&rdquo; ({filteredInstruments.length} catalog ·{' '}
                  {searchingRemote ? 'searching upstream…' : `${remoteSearchResults.length} global`})
                </h2>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-xs text-[#667085] hover:text-[#080B12] cursor-pointer"
                >
                  Clear
                </button>
              </div>
              {filteredInstruments.length === 0 && remoteSearchResults.length === 0 ? (
                <p className="text-xs text-[#667085]">
                  {searchingRemote
                    ? 'Querying upstream market symbol directory…'
                    : 'No matching tickers found across catalog or Yahoo Finance search.'}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {[
                    ...filteredInstruments.map((i) => ({
                      symbol: i.symbol,
                      name: i.name,
                      exchange: i.exchange,
                    })),
                    ...remoteSearchResults
                      .filter((r) => !filteredInstruments.some((f) => f.symbol === r.symbol))
                      .map((r) => ({ symbol: r.symbol, name: r.name, exchange: r.exchange })),
                  ]
                    .slice(0, 14)
                    .map((item) => (
                      <button
                        key={item.symbol}
                        type="button"
                        onClick={() => {
                          handleSelectInstrument(item.symbol);
                          setSearchQuery('');
                        }}
                        className="rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 py-1.5 text-xs hover:border-[#2D46E6] transition-colors cursor-pointer"
                      >
                        <span className="font-mono font-semibold text-[#080B12]">
                          {item.symbol}
                        </span>{' '}
                        <span className="text-[#667085]">{item.name}</span>{' '}
                        <span className="font-mono text-[10.5px] text-[#94A3B8]">
                          {item.exchange}
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </section>
          )}

          {wsLoading && portfolios.length === 0 ? (
            <div className="space-y-6 animate-pulse" aria-label="Loading workspace">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((k) => (
                  <div key={k} className="h-24 rounded-xl border border-[#E4E8F2] bg-[#FFFFFF]" />
                ))}
              </div>
              <div className="h-80 rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF]" />
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: FINTECH_EASE }}
              >
                {/* VIEW: HOME */}
                {activeTab === 'home' && (
                  <div className="space-y-6">
                    {/* Top KPI Summary Strip */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums">
                      <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-4 shadow-[0_4px_14px_rgba(15,23,42,0.02)]">
                        <div className="text-xs text-[#667085]">Simulated Equity</div>
                        <div className="mt-1 font-mono text-xl font-bold text-[#080B12]">
                          {portfolioMetrics.totalEquityUsd !== null
                            ? `$${portfolioMetrics.totalEquityUsd.toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                              })}`
                            : 'Unavailable'}
                        </div>
                        <div className="mt-1 text-[11px] text-[#94A3B8]">
                          {activePortfolio?.name ?? 'Paper Portfolio'} · Cash $
                          {portfolioMetrics.cashBalanceUsd.toLocaleString('en-US')}
                        </div>
                      </div>
                      <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-4 shadow-[0_4px_14px_rgba(15,23,42,0.02)]">
                        <div className="text-xs text-[#667085]">Unrealized P&amp;L</div>
                        <div
                          className={`mt-1 font-mono text-xl font-bold ${
                            (portfolioMetrics.unrealizedPnlUsd ?? 0) >= 0
                              ? 'text-[#16A34A]'
                              : 'text-[#DC2626]'
                          }`}
                        >
                          {portfolioMetrics.unrealizedPnlUsd !== null
                            ? `${portfolioMetrics.unrealizedPnlUsd >= 0 ? '+' : ''}$${portfolioMetrics.unrealizedPnlUsd.toLocaleString(
                                'en-US',
                                { minimumFractionDigits: 2 },
                              )}`
                            : 'Unavailable'}
                        </div>
                        <div className="mt-1 text-[11px] text-[#94A3B8]">
                          {portfolioMetrics.unrealizedPnlPct !== null
                            ? `${formatSignedPercent(portfolioMetrics.unrealizedPnlPct)} across holdings`
                            : 'Requires active quote & FX'}
                        </div>
                      </div>
                      <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-4 shadow-[0_4px_14px_rgba(15,23,42,0.02)]">
                        <div className="text-xs text-[#667085]">USD / INR FX Rate</div>
                        <div className="mt-1 font-mono text-xl font-bold text-[#080B12]">
                          {usdInrRate ? `₹${usdInrRate.toFixed(2)}` : 'Unavailable'}
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-[#94A3B8]">
                          {usdInrStatus} · {marketOverview?.usdInrProvider ?? 'ECB FX'}
                        </div>
                      </div>
                      <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-4 shadow-[0_4px_14px_rgba(15,23,42,0.02)]">
                        <div className="text-xs text-[#667085]">Portfolio Risk / Mix</div>
                        <div className="mt-1 font-mono text-xl font-bold text-[#080B12]">
                          {portfolioMetrics.concentrationScore !== null
                            ? `${portfolioMetrics.concentrationScore}/100 · ${portfolioMetrics.riskLabel}`
                            : 'Unavailable'}
                        </div>
                        <div className="mt-1 text-[11px] text-[#94A3B8]">
                          {portfolioMetrics.indiaExposurePct}% IN · {portfolioMetrics.usExposurePct}% US ·{' '}
                          {portfolioMetrics.cashWeightPct}% Cash
                        </div>
                      </div>
                    </div>

                    {/* Instrument Quick Selector & Asset Filter Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {filteredInstruments.slice(0, 10).map((inst) => (
                          <button
                            key={inst.symbol}
                            type="button"
                            onClick={() => handleSelectInstrument(inst.symbol)}
                            className={`rounded-md px-3 py-1.5 font-mono text-xs transition-colors cursor-pointer whitespace-nowrap ${
                              inst.symbol === activeInstrument.symbol
                                ? 'bg-[#2D46E6] text-[#FFFFFF] font-semibold shadow-[0_4px_12px_rgba(45,70,230,0.2)]'
                                : 'border border-[#E4E8F2] bg-[#FFFFFF] text-[#667085] hover:text-[#080B12] hover:border-[#CBD5E1]'
                            }`}
                          >
                            {inst.symbol}
                          </button>
                        ))}
                      </div>
                      <span className="font-mono text-[11px] text-[#667085]">
                        Feed: {marketOverview?.dataStatus ?? (marketLoading ? 'SYNCING' : 'UNAVAILABLE')} ·{' '}
                        {marketOverview?.summary.availableQuotes ?? 0}/
                        {marketOverview?.summary.totalInstruments ?? 0} quotes live
                      </span>
                    </div>

                    {/* Chart + AI Building Mode Card + Quick Paper Order */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      <div className="lg:col-span-8 rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] p-5 sm:p-6 space-y-5 shadow-[0_8px_24px_rgba(15,23,42,0.03)]">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#667085] font-mono">
                              <span>{activeInstrument.exchange}</span>
                              <span>·</span>
                              <span>{activeInstrument.category}</span>
                              <span>·</span>
                              <span className={`font-semibold ${getDataStatusColorClass(activeInstrument.status)}`}>
                                {activeInstrument.status}
                              </span>
                              <span>·</span>
                              <span>{activeInstrument.providerName}</span>
                              <button
                                type="button"
                                onClick={() => void toggleWatchlist(activeInstrument.symbol)}
                                aria-label={
                                  watchlistSymbols.includes(activeInstrument.symbol)
                                    ? `Remove ${activeInstrument.symbol} from watchlist`
                                    : `Add ${activeInstrument.symbol} to watchlist`
                                }
                                className="ml-1 inline-flex items-center gap-1 text-[#667085] hover:text-[#2D46E6] cursor-pointer"
                              >
                                <Star
                                  className={`h-3.5 w-3.5 ${
                                    watchlistSymbols.includes(activeInstrument.symbol)
                                      ? 'fill-[#2D46E6] text-[#2D46E6]'
                                      : ''
                                  }`}
                                />
                              </button>
                            </div>
                            <h1 className="mt-1 font-display text-2xl font-bold text-[#080B12]">
                              {activeInstrument.name} ({activeInstrument.symbol})
                            </h1>
                          </div>

                          <div className="text-right tabular-nums">
                            <div className="font-mono text-2xl font-bold text-[#080B12]">
                              {activeInstrument.price !== null
                                ? formatCurrencyValue(activeInstrument.price, activeInstrument.currency)
                                : 'Unavailable'}
                            </div>
                            <div
                              className={`font-mono text-xs font-semibold ${
                                activeInstrument.changePercent === null
                                  ? 'text-[#667085]'
                                  : isPositive
                                    ? 'text-[#16A34A]'
                                    : 'text-[#DC2626]'
                              }`}
                            >
                              {activeInstrument.changePercent !== null
                                ? `${formatSignedPercent(activeInstrument.changePercent)} (${activeInstrument.status})`
                                : 'Quote unavailable'}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 border-y border-[#E4E8F2] py-2.5">
                          <div className="flex items-center gap-1">
                            {(['1D', '1W', '1M', '6M', '1Y'] as TimeframeKey[]).map((tf) => (
                              <button
                                key={tf}
                                type="button"
                                onClick={() => setTimeframe(tf)}
                                className={`rounded px-2.5 py-1 font-mono text-xs cursor-pointer transition-colors ${
                                  timeframe === tf
                                    ? 'bg-[#2D46E6] text-[#FFFFFF] font-semibold'
                                    : 'text-[#667085] hover:text-[#080B12] hover:bg-[#F7F8FA]'
                                }`}
                              >
                                {tf}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-4 text-xs text-[#667085] font-mono tabular-nums">
                            <span>Vol: {formatVolume(activeInstrument.volume)}</span>
                            <span>
                              High/Low:{' '}
                              {activeInstrument.high !== null && activeInstrument.low !== null
                                ? `${formatCurrencyValue(activeInstrument.high, activeInstrument.currency)} / ${formatCurrencyValue(
                                    activeInstrument.low,
                                    activeInstrument.currency,
                                  )}`
                                : 'Unavailable'}
                            </span>
                            <span>Series: {historyStatus}</span>
                          </div>
                        </div>

                        {historyPoints.length >= 2 ? (
                          <InteractivePriceChart
                            data={historyPoints}
                            currency={activeInstrument.currency}
                            positive={isPositive}
                            height={235}
                          />
                        ) : (
                          <div className="h-[235px] flex flex-col items-center justify-center rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-6 text-center text-xs text-[#667085] space-y-1">
                            <span className="font-semibold text-[#080B12]">
                              {historyLoading
                                ? `Fetching ${timeframe} price series for ${activeInstrument.symbol}…`
                                : `Historical chart unavailable for ${activeInstrument.symbol} (${timeframe})`}
                            </span>
                            <span>
                              {historyLoading
                                ? `Querying ${historyProvider}`
                                : 'No fabricated or synthetic curves are displayed when upstream bars are unavailable.'}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Right Panel: AI Building Mode + Quick Simulated Order */}
                      <div className="lg:col-span-4 space-y-6">
                        <div className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] p-5 space-y-3 shadow-[0_8px_24px_rgba(15,23,42,0.03)]">
                          <div className="flex items-center justify-between gap-2">
                            <h2 className="font-display text-sm font-semibold text-[#080B12] flex items-center gap-1.5">
                              <Cpu className="h-4 w-4 text-[#2D46E6]" aria-hidden="true" />
                              <span>AI Intelligence</span>
                            </h2>
                            <span className="font-mono text-[10.5px] font-semibold uppercase text-[#2D46E6]">
                              {geminiConfigured ? 'GEMINI READY' : 'BUILDING MODE'}
                            </span>
                          </div>
                          <p className="text-[12.5px] leading-relaxed text-[#667085]">
                            Nextrade AI executes live Gemini synthesis on demand in Research and never displays placeholder AI briefs. Advanced portfolio &amp; predictive modules are actively in building mode.
                          </p>
                          <div className="border-t border-[#E4E8F2] pt-3 space-y-1.5 font-mono text-[11px]">
                            {AI_BUILDING_ROADMAP.map((mod) => (
                              <div key={mod.name} className="flex items-center justify-between gap-2">
                                <span className="text-[#080B12] truncate">{mod.name}</span>
                                <span className="text-[#2D46E6] shrink-0">{mod.status}</span>
                              </div>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => setActiveTab('research')}
                            className="w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] py-2 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] transition-colors cursor-pointer"
                          >
                            Open AI Research Workspace →
                          </button>
                        </div>

                        {/* Quick Paper Order */}
                        <form
                          onSubmit={(e) => void handlePlacePaperOrder(e)}
                          className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] p-5 space-y-3.5 shadow-[0_8px_24px_rgba(15,23,42,0.03)]"
                        >
                          <div className="flex items-center justify-between">
                            <h2 className="font-display text-sm font-semibold text-[#080B12]">
                              Simulated Order ({activeInstrument.symbol})
                            </h2>
                            <span className="font-mono text-[10px] font-semibold uppercase text-[#0F766E]">
                              SIMULATED
                            </span>
                          </div>
                          <div className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-900">
                            SIMULATED TRADING — No real money or brokerage execution.
                          </div>

                          <div className="grid grid-cols-2 gap-1.5 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] p-1">
                            {(['BUY', 'SELL'] as const).map((side) => (
                              <button
                                key={side}
                                type="button"
                                onClick={() => {
                                  setOrderSide(side);
                                  setOrderFeedback(null);
                                }}
                                className={`rounded py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                                  orderSide === side
                                    ? 'bg-[#2D46E6] text-[#FFFFFF]'
                                    : 'text-[#667085] hover:text-[#080B12]'
                                }`}
                              >
                                {side}
                              </button>
                            ))}
                          </div>

                          <div className="space-y-1">
                            <label htmlFor="home-order-qty" className="block text-xs text-[#667085]">
                              Units / Shares (Held: {activePaperHolding?.quantity ?? 0})
                            </label>
                            <input
                              id="home-order-qty"
                              type="number"
                              min="0.0001"
                              step="any"
                              value={orderQty}
                              onChange={(e) => setOrderQty(e.target.value)}
                              className="w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 py-2 font-mono text-sm text-[#080B12] focus:border-[#2D46E6] focus:bg-[#FFFFFF] focus:outline-none"
                            />
                          </div>

                          <div className="flex items-center justify-between text-xs text-[#667085] tabular-nums">
                            <span>Est. USD Equivalent</span>
                            <span className="font-mono font-semibold text-[#080B12]">
                              {estOrderUsd !== null ? `$${estOrderUsd.toFixed(2)}` : 'Unavailable'}
                            </span>
                          </div>

                          {orderFeedback && (
                            <div
                              role="status"
                              className={`rounded-md border px-3 py-2 text-xs ${
                                orderFeedback.type === 'success'
                                  ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                                  : 'border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]'
                              }`}
                            >
                              {orderFeedback.message}
                            </div>
                          )}

                          <button
                            type="submit"
                            disabled={orderSubmitting || activeInstrument.price === null}
                            className="w-full rounded-md bg-[#2D46E6] py-2.5 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] shadow-[0_6px_16px_rgba(45,70,230,0.2)] disabled:opacity-50 transition-colors cursor-pointer"
                          >
                            {orderSubmitting
                              ? 'Recording Order...'
                              : activeInstrument.price === null
                                ? 'Live Quote Unavailable'
                                : `Submit Simulated ${orderSide}`}
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                )}

                {/* VIEW: MARKETS */}
                {activeTab === 'markets' && (
                  <div className="space-y-6">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                      <div>
                        <h1 className="font-display text-2xl font-bold text-[#080B12]">
                          Multi-Asset Markets (India, US &amp; Global)
                        </h1>
                        <p className="mt-1 text-sm text-[#667085]">
                          Live/delayed quotes via Yahoo Finance, CoinGecko &amp; Frankfurter ECB FX · Status:{' '}
                          <span className="font-mono font-semibold text-[#080B12]">
                            {marketOverview?.dataStatus ?? 'SYNCING'}
                          </span>
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {ASSET_CATEGORIES.map((cat) => (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => setCategoryFilter(cat.id)}
                            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                              categoryFilter === cat.id
                                ? 'bg-[#080B12] text-[#FFFFFF]'
                                : 'border border-[#E4E8F2] bg-[#FFFFFF] text-[#667085] hover:text-[#080B12]'
                            }`}
                          >
                            {cat.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Benchmark Indices */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {overviewIndices
                        .filter((idx) => regionFilter === 'ALL' || idx.region === regionFilter)
                        .map((idx) => {
                          const pos = (idx.changePercent ?? 0) >= 0;
                          return (
                            <div
                              key={idx.id}
                              className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-4 flex items-center justify-between gap-3 shadow-[0_4px_14px_rgba(15,23,42,0.02)]"
                            >
                              <div className="min-w-0">
                                <div className="font-mono text-[11px] font-medium text-[#667085]">
                                  {idx.exchange} · {idx.dataStatus}
                                </div>
                                <div className="mt-0.5 font-display text-base font-semibold text-[#080B12] truncate">
                                  {idx.name}
                                </div>
                                <div className="mt-2 flex items-baseline gap-2.5 tabular-nums">
                                  <span className="font-mono text-sm font-bold text-[#080B12]">
                                    {idx.value !== null
                                      ? idx.value.toLocaleString('en-US', { minimumFractionDigits: 2 })
                                      : 'Unavailable'}
                                  </span>
                                  <span
                                    className={`font-mono text-xs font-semibold ${
                                      idx.changePercent === null
                                        ? 'text-[#667085]'
                                        : pos
                                          ? 'text-[#16A34A]'
                                          : 'text-[#DC2626]'
                                    }`}
                                  >
                                    {idx.changePercent !== null
                                      ? formatSignedPercent(idx.changePercent)
                                      : '—'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>

                    <div className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] overflow-hidden shadow-[0_8px_24px_rgba(15,23,42,0.03)]">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs tabular-nums">
                          <thead className="border-b border-[#E4E8F2] bg-[#F7F8FA] text-[#667085]">
                            <tr>
                              <th className="px-4 py-3 font-semibold">Instrument</th>
                              <th className="px-4 py-3 font-semibold">Class · Exchange</th>
                              <th className="px-4 py-3 font-semibold text-right">Market Price</th>
                              <th className="px-4 py-3 font-semibold text-right">24h Move</th>
                              <th className="px-4 py-3 font-semibold">Source · Status</th>
                              <th className="px-4 py-3 font-semibold text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E4E8F2]">
                            {filteredInstruments.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="px-4 py-8 text-center text-[#667085]">
                                  {marketLoading
                                    ? 'Fetching market instruments…'
                                    : 'No catalog instruments match the current filter.'}
                                </td>
                              </tr>
                            ) : (
                              filteredInstruments.map((inst) => {
                                const pos = (inst.changePercent ?? 0) >= 0;
                                const saved = watchlistSymbols.includes(inst.symbol);
                                return (
                                  <tr key={inst.symbol} className="hover:bg-[#EFF2FA]/60 transition-colors">
                                    <td className="px-4 py-3.5">
                                      <button
                                        type="button"
                                        onClick={() => handleSelectInstrument(inst.symbol, 'home')}
                                        className="text-left hover:underline cursor-pointer"
                                      >
                                        <div className="font-mono font-bold text-[#080B12]">
                                          {inst.symbol}
                                        </div>
                                        <div className="text-[#667085]">{inst.name}</div>
                                      </button>
                                    </td>
                                    <td className="px-4 py-3.5 font-mono text-[#667085]">
                                      {inst.category} · {inst.exchange}
                                    </td>
                                    <td className="px-4 py-3.5 text-right font-mono font-semibold text-[#080B12] whitespace-nowrap">
                                      {inst.price !== null
                                        ? formatCurrencyValue(inst.price, inst.currency)
                                        : 'Unavailable'}
                                    </td>
                                    <td
                                      className={`px-4 py-3.5 text-right font-mono font-semibold whitespace-nowrap ${
                                        inst.changePercent === null
                                          ? 'text-[#667085]'
                                          : pos
                                            ? 'text-[#16A34A]'
                                            : 'text-[#DC2626]'
                                      }`}
                                    >
                                      {inst.changePercent !== null
                                        ? formatSignedPercent(inst.changePercent)
                                        : '—'}
                                    </td>
                                    <td className="px-4 py-3.5 font-mono text-[11px]">
                                      <span className={`font-semibold ${getDataStatusColorClass(inst.status)}`}>
                                        {inst.status}
                                      </span>{' '}
                                      <span className="text-[#667085]">· {inst.providerName}</span>
                                    </td>
                                    <td className="px-4 py-3.5 text-right">
                                      <div className="inline-flex items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={() => void toggleWatchlist(inst.symbol)}
                                          aria-label={`Toggle ${inst.symbol} watchlist`}
                                          className="p-1.5 rounded border border-[#E4E8F2] bg-[#FFFFFF] text-[#667085] hover:text-[#2D46E6] hover:border-[#2D46E6] cursor-pointer"
                                        >
                                          <Star
                                            className={`h-3.5 w-3.5 ${
                                              saved ? 'fill-[#2D46E6] text-[#2D46E6]' : ''
                                            }`}
                                          />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleSelectInstrument(inst.symbol, 'research')}
                                          className="rounded border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 py-1 font-medium text-[#080B12] hover:border-[#CBD5E1] hover:bg-[#F7F8FA] cursor-pointer whitespace-nowrap"
                                        >
                                          Research
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleSelectInstrument(inst.symbol, 'paper-trading')}
                                          className="rounded bg-[#2D46E6] px-2.5 py-1 font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer whitespace-nowrap"
                                        >
                                          Simulate
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* VIEW: AI RESEARCH */}
                {activeTab === 'research' && (
                  <div className="space-y-6">
                    {/* Explicit AI Building Mode Banner */}
                    <div className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] p-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-start gap-2.5 text-xs text-[#1E3A8A]">
                        <Cpu className="h-4 w-4 text-[#2D46E6] shrink-0 mt-0.5" aria-hidden="true" />
                        <div>
                          <span className="font-bold">AI Building Mode &amp; Transparent Synthesis:</span>{' '}
                          Queries call server-side Google Gemini enriched with live quotes when configured. Nextrade AI never returns fabricated fallback briefs.
                        </div>
                      </div>
                      <span className="font-mono text-[11px] font-bold text-[#2D46E6] shrink-0">
                        {geminiConfigured ? 'GEMINI READY' : 'AI NOT CONFIGURED (BUILDING MODE)'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      <div className="lg:col-span-5 space-y-5">
                        <div className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] p-5 sm:p-6 space-y-4 shadow-[0_8px_24px_rgba(15,23,42,0.03)]">
                          <div>
                            <h1 className="font-display text-xl font-bold text-[#080B12]">
                              Explainable AI Research Assistant
                            </h1>
                            <p className="mt-1 text-xs leading-relaxed text-[#667085]">
                              Ask analytical questions grounded in fetched market context. Completed Gemini briefs save privately to your account.
                            </p>
                          </div>

                          <form onSubmit={(e) => void handleRunResearch(e)} className="space-y-4">
                            <div className="space-y-1.5">
                              <label htmlFor="research-symbol" className="block text-xs font-medium text-[#667085]">
                                Target Instrument
                              </label>
                              <select
                                id="research-symbol"
                                value={activeInstrument.symbol}
                                onChange={(e) => setSelectedSymbol(e.target.value)}
                                className="w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 py-2 text-xs text-[#080B12] focus:border-[#2D46E6] focus:bg-[#FFFFFF] focus:outline-none"
                              >
                                {allKnownQuotes.map((inst) => (
                                  <option key={inst.symbol} value={inst.symbol}>
                                    {inst.symbol} — {inst.name} ({inst.exchange})
                                  </option>
                                ))}
                                {!allKnownQuotes.some((q) => q.symbol === activeInstrument.symbol) && (
                                  <option value={activeInstrument.symbol}>{activeInstrument.symbol}</option>
                                )}
                              </select>
                            </div>

                            <div className="space-y-1.5">
                              <label htmlFor="research-query" className="block text-xs font-medium text-[#667085]">
                                Research Prompt
                              </label>
                              <textarea
                                id="research-query"
                                rows={4}
                                value={researchPrompt}
                                onChange={(e) => setResearchPrompt(e.target.value)}
                                placeholder="e.g., Compare margin durability against valuation and downside risk factors..."
                                className="w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] p-3 text-sm text-[#080B12] placeholder:text-[#94A3B8] focus:border-[#2D46E6] focus:bg-[#FFFFFF] focus:outline-none"
                              />
                            </div>

                            {researchError && (
                              <div
                                role="alert"
                                className="flex items-start gap-2 rounded-md border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#DC2626]"
                              >
                                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                                <span>{researchError}</span>
                              </div>
                            )}

                            <button
                              type="submit"
                              disabled={researchLoading}
                              className="w-full rounded-md bg-[#2D46E6] py-2.5 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] shadow-[0_6px_16px_rgba(45,70,230,0.2)] disabled:opacity-50 cursor-pointer"
                            >
                              {researchLoading ? 'Querying Gemini...' : 'Run Explainable Analysis'}
                            </button>
                          </form>

                          <div className="border-t border-[#E4E8F2] pt-4 space-y-2">
                            <div className="text-[11px] font-semibold text-[#667085]">Quick Prompts</div>
                            <div className="flex flex-col gap-1.5">
                              {[
                                'Analyze downside risk factors and sector sensitivity.',
                                'Summarize structural revenue drivers vs. capital expenditure risk.',
                                'How does this holding behave across USD and INR portfolio regimes?',
                              ].map((promptText) => (
                                <button
                                  key={promptText}
                                  type="button"
                                  onClick={() => {
                                    setResearchPrompt(promptText);
                                    void handleRunResearch(undefined, promptText);
                                  }}
                                  className="text-left rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 py-2 text-xs text-[#667085] hover:text-[#080B12] hover:border-[#2D46E6] transition-colors cursor-pointer"
                                >
                                  {promptText}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="lg:col-span-7">
                        <div className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-5 min-h-[420px] shadow-[0_8px_24px_rgba(15,23,42,0.03)]">
                          {researchLoading ? (
                            <div className="space-y-4 animate-pulse" aria-label="Loading research synthesis">
                              <div className="h-4 w-1/3 rounded bg-[#E4E8F2]" />
                              <div className="h-20 w-full rounded bg-[#F7F8FA]" />
                              <div className="h-4 w-1/4 rounded bg-[#E4E8F2]" />
                              <div className="h-24 w-full rounded bg-[#F7F8FA]" />
                            </div>
                          ) : researchResult ? (
                            <div className="space-y-5">
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E4E8F2] pb-4">
                                <div>
                                  <span className="font-mono text-sm font-bold text-[#080B12]">
                                    {researchResult.symbol}
                                  </span>
                                  <span className="ml-2 text-xs text-[#667085]">
                                    Explainable Research Brief
                                  </span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="font-mono text-[11px] font-semibold text-[#2D46E6]">
                                    Source: {researchResult.source} · {researchResult.model}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={savingReportId === 'current'}
                                    onClick={() => void handleSaveCurrentResultAsReport()}
                                    className="inline-flex items-center gap-1 rounded border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 py-1 text-[11px] font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] cursor-pointer"
                                  >
                                    <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
                                    <span>Save Report</span>
                                  </button>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <h2 className="text-xs font-semibold uppercase tracking-[0.05em] text-[#667085]">
                                  Analytical Summary
                                </h2>
                                <p className="text-sm leading-relaxed text-[#080B12]">
                                  {researchResult.summary}
                                </p>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 border-t border-[#E4E8F2] pt-4">
                                <div className="space-y-2.5">
                                  <h3 className="text-xs font-semibold text-[#080B12]">
                                    Key Supporting Drivers
                                  </h3>
                                  <ul className="space-y-2 text-xs leading-relaxed text-[#667085]">
                                    {researchResult.keyDrivers.map((d, i) => (
                                      <li key={i} className="flex items-start gap-2">
                                        <span className="font-mono font-bold text-[#16A34A]">+</span>
                                        <span>{d}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>

                                <div className="space-y-2.5">
                                  <h3 className="text-xs font-semibold text-[#080B12]">
                                    Risk &amp; Uncertainty Factors
                                  </h3>
                                  <ul className="space-y-2 text-xs leading-relaxed text-[#667085]">
                                    {researchResult.riskFactors.map((r, i) => (
                                      <li key={i} className="flex items-start gap-2">
                                        <span className="font-mono font-bold text-[#DC2626]">!</span>
                                        <span>{r}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </div>

                              <div className="border-t border-[#E4E8F2] pt-4 space-y-2">
                                <h3 className="text-xs font-semibold text-[#080B12]">
                                  Explainability &amp; Reasoning Basis
                                </h3>
                                <p className="text-xs leading-relaxed text-[#667085]">
                                  {researchResult.explainabilityBasis}
                                </p>
                                <p className="text-[11px] text-[#94A3B8] pt-1">
                                  {researchResult.disclaimer}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-6">
                              <div className="flex items-center justify-between border-b border-[#E4E8F2] pb-4">
                                <div>
                                  <h2 className="font-display text-base font-bold text-[#080B12]">
                                    {activeInstrument.symbol} — Awaiting Live Research Prompt
                                  </h2>
                                  <p className="text-xs text-[#667085]">
                                    No sample or synthetic AI theses are shown before calling Gemini.
                                  </p>
                                </div>
                                <Clock className="h-4 w-4 text-[#2D46E6]" aria-hidden="true" />
                              </div>

                              <div className="grid grid-cols-1 gap-3">
                                {AI_BUILDING_ROADMAP.map((mod) => (
                                  <div
                                    key={mod.name}
                                    className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-4 space-y-1"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-xs font-bold text-[#080B12]">
                                        {mod.name}
                                      </span>
                                      <span className="font-mono text-[10.5px] font-semibold text-[#2D46E6]">
                                        {mod.status}
                                      </span>
                                    </div>
                                    <p className="text-xs text-[#667085] leading-relaxed">
                                      {mod.detail}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <ResearchHistoryPanel
                      history={researchHistory}
                      savedReports={savedReports}
                      historySearch={historySearch}
                      onHistorySearchChange={setHistorySearch}
                      onSelectHistoryItem={(item) => {
                        setSelectedSymbol(item.symbol.toUpperCase());
                        setResearchPrompt(item.query);
                        setResearchResult(item.result);
                      }}
                      onDeleteHistoryItem={(id) => void handleDeleteResearch(id)}
                      onSaveAsReport={(item) => void handleSaveResearchAsReport(item)}
                      onSelectSavedReport={(rep) => {
                        const content = rep.content as Partial<WorkspaceResearchResultPayload>;
                        if (typeof content.summary === 'string') {
                          setResearchResult({
                            symbol: rep.symbol,
                            source: content.source === 'gemini' ? 'gemini' : 'unavailable',
                            model: typeof content.model === 'string' ? content.model : 'saved-report',
                            summary: content.summary,
                            keyDrivers: Array.isArray(content.keyDrivers)
                              ? (content.keyDrivers as string[])
                              : [],
                            riskFactors: Array.isArray(content.riskFactors)
                              ? (content.riskFactors as string[])
                              : [],
                            explainabilityBasis:
                              typeof content.explainabilityBasis === 'string'
                                ? content.explainabilityBasis
                                : '',
                            disclaimer:
                              typeof content.disclaimer === 'string'
                                ? content.disclaimer
                                : 'Saved analytical brief.',
                          });
                        }
                      }}
                      onDeleteSavedReport={(id) => void handleDeleteReport(id)}
                      savingReportId={savingReportId}
                    />
                  </div>
                )}

                {/* VIEW: PORTFOLIO */}
                {activeTab === 'portfolio' && (
                  <div className="space-y-6">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                      <div>
                        <h1 className="font-display text-2xl font-bold text-[#080B12]">
                          User-Owned Portfolio Intelligence
                        </h1>
                        <p className="mt-1 text-sm text-[#667085]">
                          Live valuation across Indian (INR) and US/Global (USD) holdings using dynamic ECB FX.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('paper-trading')}
                        className="rounded-md bg-[#2D46E6] px-4 py-2 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] shadow-[0_6px_16px_rgba(45,70,230,0.2)] cursor-pointer"
                      >
                        New Simulated Order
                      </button>
                    </div>

                    {/* Multi-Portfolio Selector */}
                    <div className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] p-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {portfolios.map((p) => {
                          const selected = p.id === activePortfolio?.id;
                          return (
                            <div key={p.id} className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setSelectedPortfolioId(p.id)}
                                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                                  selected
                                    ? 'bg-[#2D46E6] text-[#FFFFFF]'
                                    : 'border border-[#E4E8F2] bg-[#F7F8FA] text-[#667085] hover:text-[#080B12]'
                                }`}
                              >
                                {p.name}
                                {p.isDefault ? ' (Primary)' : ''}
                              </button>
                              {!p.isDefault && portfolios.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => void handleDeletePortfolio(p.id)}
                                  aria-label={`Delete portfolio ${p.name}`}
                                  className="rounded p-1 text-[#94A3B8] hover:text-[#DC2626] cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <form onSubmit={(e) => void handleCreatePortfolio(e)} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={newPortfolioName}
                          onChange={(e) => setNewPortfolioName(e.target.value)}
                          placeholder="New portfolio name..."
                          aria-label="New portfolio name"
                          className="rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 py-1.5 text-xs text-[#080B12] focus:border-[#2D46E6] focus:bg-[#FFFFFF] focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={creatingPortfolio || !newPortfolioName.trim()}
                          className="inline-flex items-center gap-1 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3 py-1.5 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] disabled:opacity-50 cursor-pointer"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Add</span>
                        </button>
                      </form>
                    </div>

                    {/* Manual User Holding Entry Form (Explicit quantity & cost basis required) */}
                    {activePortfolio && (
                      <form
                        onSubmit={(e) => void handleUpsertManualHolding(e)}
                        className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] p-4 flex flex-wrap items-end gap-3"
                      >
                        <div className="space-y-1 flex-1 min-w-[140px]">
                          <label htmlFor="manual-symbol" className="block text-[11px] font-semibold text-[#667085]">
                            Symbol (e.g. NVDA, RELIANCE.NS, BTC-USD)
                          </label>
                          <input
                            id="manual-symbol"
                            type="text"
                            value={manualSymbol}
                            onChange={(e) => setManualSymbol(e.target.value.toUpperCase())}
                            className="w-full h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 font-mono text-xs text-[#080B12] focus:border-[#2D46E6] focus:bg-[#FFFFFF] focus:outline-none"
                          />
                        </div>
                        <div className="space-y-1 w-32">
                          <label htmlFor="manual-qty" className="block text-[11px] font-semibold text-[#667085]">
                            Quantity
                          </label>
                          <input
                            id="manual-qty"
                            type="number"
                            min="0.0001"
                            step="any"
                            value={manualQty}
                            onChange={(e) => setManualQty(e.target.value)}
                            className="w-full h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 font-mono text-xs text-[#080B12] focus:border-[#2D46E6] focus:bg-[#FFFFFF] focus:outline-none"
                          />
                        </div>
                        <div className="space-y-1 w-40">
                          <label htmlFor="manual-cost" className="block text-[11px] font-semibold text-[#667085]">
                            Avg Cost (Native CCY)
                          </label>
                          <input
                            id="manual-cost"
                            type="number"
                            min="0"
                            step="any"
                            required
                            placeholder="e.g. 120.50"
                            value={manualAvgCost}
                            onChange={(e) => setManualAvgCost(e.target.value)}
                            className="w-full h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 font-mono text-xs text-[#080B12] focus:border-[#2D46E6] focus:bg-[#FFFFFF] focus:outline-none"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={savingHolding}
                          className="h-9 rounded-md bg-[#080B12] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#1E293B] disabled:opacity-50 cursor-pointer whitespace-nowrap"
                        >
                          {savingHolding ? 'Saving…' : 'Record Personal Holding'}
                        </button>
                      </form>
                    )}

                    {portfolioActionMsg && (
                      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] px-4 py-2.5 text-xs text-[#080B12]">
                        {portfolioActionMsg}
                      </div>
                    )}

                    <div className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] p-5 space-y-4 shadow-[0_8px_24px_rgba(15,23,42,0.03)]">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-[#080B12]">
                          Geographic &amp; Cash Allocation (USD Equivalent ·{' '}
                          {usdInrRate ? `1 USD = ₹${usdInrRate.toFixed(2)}` : 'FX Unavailable'})
                        </span>
                        <span className="font-mono text-[#667085]">
                          Concentration:{' '}
                          {portfolioMetrics.concentrationScore !== null
                            ? `${portfolioMetrics.concentrationScore}/100 (${portfolioMetrics.riskLabel})`
                            : 'Unavailable'}
                        </span>
                      </div>
                      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[#EFF2FA]">
                        <div
                          className="bg-[#2D46E6]"
                          style={{ width: `${portfolioMetrics.usExposurePct}%` }}
                        />
                        <div
                          className="bg-[#080B12]"
                          style={{ width: `${portfolioMetrics.indiaExposurePct}%` }}
                        />
                        <div
                          className="bg-[#CBD5E1]"
                          style={{ width: `${portfolioMetrics.cashWeightPct}%` }}
                        />
                      </div>
                      <div className="flex flex-wrap gap-6 text-xs text-[#667085] tabular-nums">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-[#2D46E6]" aria-hidden="true" />
                          US/Global: {portfolioMetrics.usExposurePct}%
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-[#080B12]" aria-hidden="true" />
                          India Markets: {portfolioMetrics.indiaExposurePct}%
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-[#CBD5E1]" aria-hidden="true" />
                          Cash Reserve: {portfolioMetrics.cashWeightPct}% ($
                          {portfolioMetrics.cashBalanceUsd.toLocaleString('en-US')})
                        </span>
                        <span>Realized P&amp;L: ${portfolioMetrics.realizedPnlUsd.toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] overflow-hidden shadow-[0_8px_24px_rgba(15,23,42,0.03)]">
                      {portfolioMetrics.valuations.length === 0 ? (
                        <div className="p-10 text-center space-y-3">
                          <p className="text-sm text-[#667085]">
                            This portfolio starts completely clean with zero pre-seeded positions.
                          </p>
                          <p className="text-xs text-[#94A3B8]">
                            Add a personal holding above with your explicit average cost or place a simulated order in Paper Trading.
                          </p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs tabular-nums">
                            <thead className="border-b border-[#E4E8F2] bg-[#F7F8FA] text-[#667085]">
                              <tr>
                                <th className="px-4 py-3 font-semibold">Position</th>
                                <th className="px-4 py-3 font-semibold text-right">Units</th>
                                <th className="px-4 py-3 font-semibold text-right">Avg Cost</th>
                                <th className="px-4 py-3 font-semibold text-right">Market Price</th>
                                <th className="px-4 py-3 font-semibold text-right">Value (USD Eq.)</th>
                                <th className="px-4 py-3 font-semibold text-right">Weight</th>
                                <th className="px-4 py-3 font-semibold text-right">Unrealized P&amp;L</th>
                                <th className="px-4 py-3 font-semibold text-right">Remove</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E4E8F2]">
                              {portfolioMetrics.valuations.map((pos) => {
                                const gain = (pos.unrealizedPnlUsd ?? 0) >= 0;
                                return (
                                  <tr key={pos.symbol} className="hover:bg-[#EFF2FA]/60 transition-colors">
                                    <td className="px-4 py-3.5">
                                      <button
                                        type="button"
                                        onClick={() => handleSelectInstrument(pos.symbol, 'home')}
                                        className="text-left hover:underline cursor-pointer"
                                      >
                                        <div className="font-mono font-bold text-[#080B12]">
                                          {pos.symbol}
                                        </div>
                                        <div className="text-[#667085]">
                                          {pos.name} · {pos.exchange} ·{' '}
                                          <span className="font-mono text-[10.5px]">{pos.priceStatus}</span>
                                        </div>
                                      </button>
                                    </td>
                                    <td className="px-4 py-3.5 text-right font-mono text-[#080B12]">
                                      {pos.quantity}
                                    </td>
                                    <td className="px-4 py-3.5 text-right font-mono text-[#667085]">
                                      {formatCurrencyValue(pos.avgCostNative, pos.currency)}
                                    </td>
                                    <td className="px-4 py-3.5 text-right font-mono font-semibold text-[#080B12]">
                                      {pos.currentPriceNative !== null
                                        ? formatCurrencyValue(pos.currentPriceNative, pos.currency)
                                        : 'Unavailable'}
                                    </td>
                                    <td className="px-4 py-3.5 text-right font-mono font-semibold text-[#080B12]">
                                      {pos.marketValueUsd !== null
                                        ? `$${pos.marketValueUsd.toLocaleString('en-US', {
                                            minimumFractionDigits: 2,
                                          })}`
                                        : 'Unavailable'}
                                    </td>
                                    <td className="px-4 py-3.5 text-right font-mono text-[#667085]">
                                      {pos.weightPct !== null ? `${pos.weightPct}%` : '—'}
                                    </td>
                                    <td
                                      className={`px-4 py-3.5 text-right font-mono font-semibold ${
                                        pos.unrealizedPnlUsd === null
                                          ? 'text-[#667085]'
                                          : gain
                                            ? 'text-[#16A34A]'
                                            : 'text-[#DC2626]'
                                      }`}
                                    >
                                      {pos.unrealizedPnlUsd !== null && pos.unrealizedPnlPct !== null
                                        ? `${gain ? '+' : ''}$${pos.unrealizedPnlUsd.toFixed(2)} (${formatSignedPercent(
                                            pos.unrealizedPnlPct,
                                          )})`
                                        : 'Unavailable'}
                                    </td>
                                    <td className="px-4 py-3.5 text-right">
                                      <button
                                        type="button"
                                        onClick={() => void handleDeleteManualHolding(pos.symbol)}
                                        aria-label={`Remove ${pos.symbol}`}
                                        className="rounded p-1.5 text-[#94A3B8] hover:text-[#DC2626] cursor-pointer"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* VIEW: PAPER TRADING */}
                {activeTab === 'paper-trading' && (
                  <div className="space-y-6">
                    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-amber-950">
                        <AlertCircle className="h-4 w-4 text-amber-700 shrink-0" aria-hidden="true" />
                        <span>SIMULATED TRADING — No real money or brokerage execution.</span>
                      </div>
                      <span className="font-mono text-[11px] text-amber-900">
                        {usdInrRate ? `Live FX: 1 USD = ₹${usdInrRate.toFixed(2)}` : 'USD/INR FX Unavailable'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      <div className="lg:col-span-5">
                        <form
                          onSubmit={(e) => void handlePlacePaperOrder(e)}
                          className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-4 shadow-[0_8px_24px_rgba(15,23,42,0.03)]"
                        >
                          <div>
                            <h1 className="font-display text-lg font-bold text-[#080B12]">
                              Simulated Order Ticket
                            </h1>
                            <p className="text-xs text-[#667085]">
                              Executed server-side at live/cached market quote — no real brokerage execution.
                            </p>
                          </div>

                          <div className="space-y-1.5">
                            <label htmlFor="pt-instrument" className="block text-xs font-medium text-[#667085]">
                              Instrument ({activeInstrument.status})
                            </label>
                            <select
                              id="pt-instrument"
                              value={activeInstrument.symbol}
                              onChange={(e) => {
                                setSelectedSymbol(e.target.value);
                                setOrderFeedback(null);
                              }}
                              className="w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 py-2 text-xs text-[#080B12] focus:border-[#2D46E6] focus:bg-[#FFFFFF] focus:outline-none"
                            >
                              {allKnownQuotes.map((inst) => (
                                <option key={inst.symbol} value={inst.symbol}>
                                  {inst.symbol} —{' '}
                                  {inst.price !== null
                                    ? formatCurrencyValue(inst.price, inst.currency)
                                    : 'Unavailable'}{' '}
                                  ({inst.exchange})
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="grid grid-cols-2 gap-2 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] p-1">
                            {(['BUY', 'SELL'] as const).map((side) => (
                              <button
                                key={side}
                                type="button"
                                onClick={() => {
                                  setOrderSide(side);
                                  setOrderFeedback(null);
                                }}
                                className={`rounded py-2 text-xs font-semibold transition-colors cursor-pointer ${
                                  orderSide === side
                                    ? 'bg-[#2D46E6] text-[#FFFFFF]'
                                    : 'text-[#667085] hover:text-[#080B12]'
                                }`}
                              >
                                Simulated {side}
                              </button>
                            ))}
                          </div>

                          <div className="space-y-1.5">
                            <label htmlFor="pt-qty" className="block text-xs font-medium text-[#667085]">
                              Quantity (Current position: {activePaperHolding?.quantity ?? 0} units)
                            </label>
                            <input
                              id="pt-qty"
                              type="number"
                              min="0.0001"
                              step="any"
                              value={orderQty}
                              onChange={(e) => setOrderQty(e.target.value)}
                              className="w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 py-2 font-mono text-sm text-[#080B12] focus:border-[#2D46E6] focus:bg-[#FFFFFF] focus:outline-none"
                            />
                          </div>

                          <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-3.5 space-y-2 text-xs tabular-nums">
                            <div className="flex justify-between">
                              <span className="text-[#667085]">
                                Reference Quote ({activeInstrument.status})
                              </span>
                              <span className="font-mono font-semibold text-[#080B12]">
                                {activeInstrument.price !== null
                                  ? formatCurrencyValue(activeInstrument.price, activeInstrument.currency)
                                  : 'Unavailable'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[#667085]">Est. Notional (USD Eq.)</span>
                              <span className="font-mono font-bold text-[#080B12]">
                                {estOrderUsd !== null ? `$${estOrderUsd.toFixed(2)}` : 'Unavailable'}
                              </span>
                            </div>
                            <div className="flex justify-between border-t border-[#E4E8F2] pt-2">
                              <span className="text-[#667085]">Available Virtual Cash</span>
                              <span className="font-mono font-semibold text-[#080B12]">
                                $
                                {(paperAccount?.cashBalanceUsd ?? 0).toLocaleString('en-US', {
                                  minimumFractionDigits: 2,
                                })}
                              </span>
                            </div>
                          </div>

                          {orderFeedback && (
                            <div
                              role="status"
                              className={`flex items-start gap-2 rounded-md border p-3 text-xs ${
                                orderFeedback.type === 'success'
                                  ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                                  : 'border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]'
                              }`}
                            >
                              {orderFeedback.type === 'success' ? (
                                <CheckCircle2 className="h-4 w-4 text-[#16A34A] shrink-0 mt-0.5" />
                              ) : (
                                <AlertCircle className="h-4 w-4 text-[#DC2626] shrink-0 mt-0.5" />
                              )}
                              <span>{orderFeedback.message}</span>
                            </div>
                          )}

                          <button
                            type="submit"
                            disabled={orderSubmitting || activeInstrument.price === null}
                            className="w-full rounded-md bg-[#2D46E6] py-2.5 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] shadow-[0_6px_16px_rgba(45,70,230,0.2)] disabled:opacity-50 transition-colors cursor-pointer"
                          >
                            {orderSubmitting
                              ? 'Executing Order...'
                              : activeInstrument.price === null
                                ? 'Live Quote Unavailable'
                                : `Execute Simulated ${orderSide}`}
                          </button>
                        </form>
                      </div>

                      <div className="lg:col-span-7 space-y-6">
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <h2 className="font-display text-base font-semibold text-[#080B12]">
                              Simulated Order Ledger ({paperOrders.length})
                            </h2>
                            <button
                              type="button"
                              onClick={() => void handleResetCleanPaperAccount()}
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#667085] hover:text-[#2D46E6] cursor-pointer"
                            >
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Reset Clean $100k Account</span>
                            </button>
                          </div>

                          <div className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] overflow-hidden shadow-[0_8px_24px_rgba(15,23,42,0.03)]">
                            <div className="overflow-x-auto">
                              <table className="w-full text-left text-xs tabular-nums">
                                <thead className="border-b border-[#E4E8F2] bg-[#F7F8FA] text-[#667085]">
                                  <tr>
                                    <th className="px-4 py-3 font-semibold">Order</th>
                                    <th className="px-4 py-3 font-semibold">Side</th>
                                    <th className="px-4 py-3 font-semibold">Symbol</th>
                                    <th className="px-4 py-3 font-semibold text-right">Qty</th>
                                    <th className="px-4 py-3 font-semibold text-right">Fill Price</th>
                                    <th className="px-4 py-3 font-semibold text-right">USD Eq.</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-[#E4E8F2]">
                                  {paperOrders.length === 0 ? (
                                    <tr>
                                      <td colSpan={6} className="px-4 py-6 text-center text-[#667085]">
                                        No simulated orders yet. Submit a simulated BUY order to begin.
                                      </td>
                                    </tr>
                                  ) : (
                                    paperOrders.map((ord) => (
                                      <tr key={ord.id} className="hover:bg-[#EFF2FA]/60 transition-colors">
                                        <td className="px-4 py-3 font-mono text-[#667085]">
                                          <div>{ord.id.slice(0, 8).toUpperCase()}</div>
                                          <div className="text-[10px] text-[#94A3B8]">
                                            {new Date(ord.createdAt).toLocaleString()}
                                          </div>
                                        </td>
                                        <td
                                          className={`px-4 py-3 font-mono font-bold ${
                                            ord.side === 'BUY' ? 'text-[#16A34A]' : 'text-[#DC2626]'
                                          }`}
                                        >
                                          {ord.side}
                                        </td>
                                        <td className="px-4 py-3 font-mono font-semibold text-[#080B12]">
                                          {ord.symbol}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-[#080B12]">
                                          {ord.quantity}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-[#667085]">
                                          {formatCurrencyValue(ord.executionPriceNative, ord.currency)}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono font-semibold text-[#080B12]">
                                          ${ord.totalUsdEquivalent.toFixed(2)}
                                        </td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <h2 className="font-display text-sm font-semibold text-[#080B12]">
                            Executed Transaction History ({paperTransactions.length})
                          </h2>
                          <div className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] overflow-hidden shadow-[0_8px_24px_rgba(15,23,42,0.03)]">
                            <div className="overflow-x-auto max-h-[260px] overflow-y-auto">
                              <table className="w-full text-left text-xs tabular-nums">
                                <thead className="border-b border-[#E4E8F2] bg-[#F7F8FA] text-[#667085]">
                                  <tr>
                                    <th className="px-4 py-2.5 font-semibold">Timestamp</th>
                                    <th className="px-4 py-2.5 font-semibold">Symbol</th>
                                    <th className="px-4 py-2.5 font-semibold">Side</th>
                                    <th className="px-4 py-2.5 font-semibold text-right">Total USD</th>
                                    <th className="px-4 py-2.5 font-semibold text-right">Realized P&amp;L</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-[#E4E8F2]">
                                  {paperTransactions.length === 0 ? (
                                    <tr>
                                      <td colSpan={5} className="px-4 py-5 text-center text-[#667085]">
                                        No executed simulated transactions recorded.
                                      </td>
                                    </tr>
                                  ) : (
                                    paperTransactions.map((tx) => (
                                      <tr key={tx.id}>
                                        <td className="px-4 py-2.5 font-mono text-[11px] text-[#667085]">
                                          {new Date(tx.createdAt).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-2.5 font-mono font-semibold text-[#080B12]">
                                          {tx.symbol} ({tx.quantity})
                                        </td>
                                        <td
                                          className={`px-4 py-2.5 font-mono font-bold ${
                                            tx.side === 'BUY' ? 'text-[#16A34A]' : 'text-[#DC2626]'
                                          }`}
                                        >
                                          {tx.side}
                                        </td>
                                        <td className="px-4 py-2.5 text-right font-mono text-[#080B12]">
                                          ${tx.totalUsdEquivalent.toFixed(2)}
                                        </td>
                                        <td
                                          className={`px-4 py-2.5 text-right font-mono ${
                                            tx.realizedPnlUsd > 0
                                              ? 'text-[#16A34A]'
                                              : tx.realizedPnlUsd < 0
                                                ? 'text-[#DC2626]'
                                                : 'text-[#94A3B8]'
                                          }`}
                                        >
                                          {tx.realizedPnlUsd === 0
                                            ? '—'
                                            : `${tx.realizedPnlUsd > 0 ? '+' : ''}$${tx.realizedPnlUsd.toFixed(2)}`}
                                        </td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* VIEW: WATCHLIST */}
                {activeTab === 'watchlist' && (
                  <div className="space-y-6">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                      <div>
                        <h1 className="font-display text-2xl font-bold text-[#080B12]">Watchlists</h1>
                        <p className="mt-1 text-sm text-[#667085]">
                          Account-scoped Indian, US, ETF, Crypto, and Forex watchlists saved on server.
                        </p>
                      </div>
                      <form onSubmit={(e) => void handleCreateWatchlist(e)} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={newWatchlistName}
                          onChange={(e) => setNewWatchlistName(e.target.value)}
                          placeholder="New watchlist name..."
                          aria-label="New watchlist name"
                          className="rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3 py-1.5 text-xs text-[#080B12] focus:border-[#2D46E6] focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={creatingWatchlist || !newWatchlistName.trim()}
                          className="inline-flex items-center gap-1 rounded-md bg-[#2D46E6] px-3 py-1.5 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] disabled:opacity-50 cursor-pointer"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>New Watchlist</span>
                        </button>
                      </form>
                    </div>

                    {watchlists.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        {watchlists.map((wl) => {
                          const selected = wl.id === activeWatchlist?.id;
                          return (
                            <div key={wl.id} className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setSelectedWatchlistId(wl.id)}
                                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                                  selected
                                    ? 'bg-[#2D46E6] text-[#FFFFFF]'
                                    : 'border border-[#E4E8F2] bg-[#FFFFFF] text-[#667085] hover:text-[#080B12]'
                                }`}
                              >
                                {wl.name} ({wl.items.length})
                              </button>
                              {watchlists.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteWatchlist(wl.id)}
                                  aria-label={`Delete watchlist ${wl.name}`}
                                  className="rounded p-1 text-[#94A3B8] hover:text-[#DC2626] cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {watchlistSymbols.length === 0 ? (
                      <div className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] p-10 text-center space-y-3">
                        <p className="text-sm text-[#667085]">
                          This watchlist starts clean with zero pre-seeded tickers.
                        </p>
                        <button
                          type="button"
                          onClick={() => setActiveTab('markets')}
                          className="rounded-md bg-[#2D46E6] px-4 py-2 text-xs font-semibold text-[#FFFFFF] cursor-pointer"
                        >
                          Browse Markets to Star Tickers
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {watchlistSymbols.map((sym) => {
                          const inst =
                            allKnownQuotes.find((q) => q.symbol.toUpperCase() === sym.toUpperCase()) ??
                            buildSkeletonQuote(sym);
                          const pos = (inst.changePercent ?? 0) >= 0;
                          return (
                            <div
                              key={sym}
                              className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] p-5 flex items-center justify-between gap-4 shadow-[0_6px_18px_rgba(15,23,42,0.03)]"
                            >
                              <div className="space-y-1 min-w-0">
                                <div className="flex items-center gap-2 font-mono">
                                  <span className="text-sm font-bold text-[#080B12]">{inst.symbol}</span>
                                  <span className="text-xs text-[#94A3B8]">{inst.exchange}</span>
                                  <span className={`text-[10.5px] font-semibold ${getDataStatusColorClass(inst.status)}`}>
                                    {inst.status}
                                  </span>
                                </div>
                                <div className="text-xs text-[#667085] truncate">{inst.name}</div>
                                <div className="pt-2 flex items-center gap-3 tabular-nums">
                                  <span className="font-mono text-sm font-bold text-[#080B12]">
                                    {inst.price !== null
                                      ? formatCurrencyValue(inst.price, inst.currency)
                                      : 'Unavailable'}
                                  </span>
                                  <span
                                    className={`font-mono text-xs font-semibold ${
                                      inst.changePercent === null
                                        ? 'text-[#667085]'
                                        : pos
                                          ? 'text-[#16A34A]'
                                          : 'text-[#DC2626]'
                                    }`}
                                  >
                                    {inst.changePercent !== null
                                      ? formatSignedPercent(inst.changePercent)
                                      : '—'}
                                  </span>
                                </div>
                              </div>

                              <div className="flex flex-col items-end gap-2 shrink-0">
                                <div className="flex items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => handleSelectInstrument(inst.symbol, 'research')}
                                    className="text-xs font-semibold text-[#2D46E6] hover:underline cursor-pointer"
                                  >
                                    Analyze
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void toggleWatchlist(inst.symbol)}
                                    className="text-xs text-[#667085] hover:text-[#DC2626] cursor-pointer"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* VIEW: ANALYTICS */}
                {activeTab === 'analytics' && (
                  <div className="space-y-6">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                      <div>
                        <h1 className="font-display text-2xl font-bold text-[#080B12]">
                          Quantitative Series Risk Analytics
                        </h1>
                        <p className="mt-1 text-sm text-[#667085]">
                          Computed dynamically from fetched {timeframe} bar history for{' '}
                          <span className="font-mono font-semibold text-[#080B12]">
                            {activeInstrument.symbol}
                          </span>{' '}
                          ({historyStatus} · {historyPoints.length} bars)
                        </p>
                      </div>

                      <div className="flex items-center gap-1 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] p-1">
                        {(['1D', '1W', '1M', '6M', '1Y'] as TimeframeKey[]).map((tf) => (
                          <button
                            key={tf}
                            type="button"
                            onClick={() => setTimeframe(tf)}
                            className={`rounded px-2.5 py-1 font-mono text-xs cursor-pointer transition-colors ${
                              timeframe === tf
                                ? 'bg-[#2D46E6] text-[#FFFFFF] font-semibold'
                                : 'text-[#667085] hover:text-[#080B12]'
                            }`}
                          >
                            {tf}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums">
                      <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-4 shadow-[0_4px_14px_rgba(15,23,42,0.02)]">
                        <div className="text-xs text-[#667085]">{timeframe} Series Return</div>
                        <div
                          className={`mt-1 font-mono text-xl font-bold ${
                            !seriesRisk.hasData || (seriesRisk.periodReturnPct ?? 0) >= 0
                              ? 'text-[#16A34A]'
                              : 'text-[#DC2626]'
                          }`}
                        >
                          {seriesRisk.hasData && seriesRisk.periodReturnPct !== null
                            ? formatSignedPercent(seriesRisk.periodReturnPct)
                            : 'Insufficient Data'}
                        </div>
                      </div>
                      <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-4 shadow-[0_4px_14px_rgba(15,23,42,0.02)]">
                        <div className="text-xs text-[#667085]">Series Volatility (Ann.)</div>
                        <div className="mt-1 font-mono text-xl font-bold text-[#080B12]">
                          {seriesRisk.hasData && seriesRisk.annualizedVolatilityPct !== null
                            ? `${seriesRisk.annualizedVolatilityPct}%`
                            : '—'}
                        </div>
                      </div>
                      <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-4 shadow-[0_4px_14px_rgba(15,23,42,0.02)]">
                        <div className="text-xs text-[#667085]">Max Drawdown ({timeframe})</div>
                        <div className="mt-1 font-mono text-xl font-bold text-[#DC2626]">
                          {seriesRisk.hasData && seriesRisk.maxDrawdownPct !== null
                            ? `-${seriesRisk.maxDrawdownPct}%`
                            : '—'}
                        </div>
                      </div>
                      <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-4 shadow-[0_4px_14px_rgba(15,23,42,0.02)]">
                        <div className="text-xs text-[#667085]">Return / Vol Ratio</div>
                        <div className="mt-1 font-mono text-xl font-bold text-[#080B12]">
                          {seriesRisk.hasData && seriesRisk.returnToVolatilityRatio !== null
                            ? seriesRisk.returnToVolatilityRatio
                            : '—'}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] overflow-hidden shadow-[0_8px_24px_rgba(15,23,42,0.03)]">
                      <div className="border-b border-[#E4E8F2] px-5 py-3.5 text-xs font-semibold text-[#080B12]">
                        Multi-Asset Live Quote &amp; Dispersion Selector (Click row to load series metrics)
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs tabular-nums">
                          <thead className="border-b border-[#E4E8F2] bg-[#F7F8FA] text-[#667085]">
                            <tr>
                              <th className="px-4 py-3 font-semibold">Symbol</th>
                              <th className="px-4 py-3 font-semibold">Class · Region</th>
                              <th className="px-4 py-3 font-semibold text-right">Last Price</th>
                              <th className="px-4 py-3 font-semibold text-right">24h Move</th>
                              <th className="px-4 py-3 font-semibold text-right">Source Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E4E8F2]">
                            {overviewQuotes.map((inst) => {
                              const selected = inst.symbol === activeInstrument.symbol;
                              return (
                                <tr
                                  key={inst.symbol}
                                  className={`cursor-pointer transition-colors ${
                                    selected ? 'bg-[#2D46E6] text-[#FFFFFF]' : 'hover:bg-[#EFF2FA]/60'
                                  }`}
                                  onClick={() => setSelectedSymbol(inst.symbol)}
                                >
                                  <td
                                    className={`px-4 py-3 font-mono font-bold ${
                                      selected ? 'text-[#FFFFFF]' : 'text-[#080B12]'
                                    }`}
                                  >
                                    {inst.symbol}
                                  </td>
                                  <td className={`px-4 py-3 ${selected ? 'text-white/85' : 'text-[#667085]'}`}>
                                    {inst.category} · {inst.region} ({inst.exchange})
                                  </td>
                                  <td
                                    className={`px-4 py-3 text-right font-mono ${
                                      selected ? 'text-[#FFFFFF]' : 'text-[#080B12]'
                                    }`}
                                  >
                                    {inst.price !== null
                                      ? formatCurrencyValue(inst.price, inst.currency)
                                      : 'Unavailable'}
                                  </td>
                                  <td
                                    className={`px-4 py-3 text-right font-mono ${
                                      selected ? 'text-[#FFFFFF]' : 'text-[#080B12]'
                                    }`}
                                  >
                                    {inst.changePercent !== null
                                      ? formatSignedPercent(inst.changePercent)
                                      : '—'}
                                  </td>
                                  <td
                                    className={`px-4 py-3 text-right font-mono ${
                                      selected ? 'text-white/85' : 'text-[#667085]'
                                    }`}
                                  >
                                    {inst.status} · {inst.providerName}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* VIEW: SETTINGS */}
                {activeTab === 'settings' && (
                  <div className="max-w-2xl space-y-6">
                    <div>
                      <h1 className="font-display text-2xl font-bold text-[#080B12]">
                        Workspace Settings
                      </h1>
                      <p className="mt-1 text-sm text-[#667085]">
                        Configure server-persisted account preferences and manage simulated account reset controls.
                      </p>
                    </div>

                    <div className="rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] p-6 space-y-5 shadow-[0_8px_24px_rgba(15,23,42,0.03)]">
                      <div className="space-y-2">
                        <div className="text-sm font-semibold text-[#080B12]">
                          Default Market Region Filter
                        </div>
                        <div className="inline-flex flex-wrap rounded-md border border-[#E4E8F2] bg-[#F7F8FA] p-1">
                          {(
                            [
                              { id: 'ALL', label: 'All Markets' },
                              { id: 'IN', label: 'India (NSE/BSE)' },
                              { id: 'US', label: 'US (NYSE/NASDAQ)' },
                              { id: 'GLOBAL', label: 'Global / FX / Crypto' },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => void handleUpdatePreference({ defaultRegion: opt.id })}
                              className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                                preferences.defaultRegion === opt.id
                                  ? 'bg-[#2D46E6] text-[#FFFFFF]'
                                  : 'text-[#667085] hover:text-[#080B12]'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-[#E4E8F2] pt-5">
                        <div className="space-y-1.5">
                          <label htmlFor="pref-currency" className="block text-xs font-semibold text-[#080B12]">
                            Preferred Display Currency
                          </label>
                          <select
                            id="pref-currency"
                            value={preferences.defaultCurrency}
                            onChange={(e) =>
                              void handleUpdatePreference({
                                defaultCurrency: e.target.value === 'INR' ? 'INR' : 'USD',
                              })
                            }
                            className="w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 py-2 text-xs text-[#080B12] focus:border-[#2D46E6] focus:bg-[#FFFFFF] focus:outline-none"
                          >
                            <option value="USD">USD ($)</option>
                            <option value="INR">INR (₹)</option>
                          </select>
                        </div>

                        <div className="space-y-1.5">
                          <label htmlFor="pref-timeframe" className="block text-xs font-semibold text-[#080B12]">
                            Default Chart Timeframe
                          </label>
                          <select
                            id="pref-timeframe"
                            value={preferences.defaultTimeframe}
                            onChange={(e) =>
                              void handleUpdatePreference({
                                defaultTimeframe: e.target.value as TimeframeKey,
                              })
                            }
                            className="w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 py-2 text-xs text-[#080B12] focus:border-[#2D46E6] focus:bg-[#FFFFFF] focus:outline-none"
                          >
                            {(['1D', '1W', '1M', '6M', '1Y'] as TimeframeKey[]).map((tf) => (
                              <option key={tf} value={tf}>
                                {tf}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="border-t border-[#E4E8F2] pt-5 flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold text-[#080B12]">
                            Auto-Save AI Research History
                          </div>
                          <div className="text-xs text-[#667085]">
                            Automatically record completed research briefs to your private account ledger.
                          </div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={preferences.researchAutoSave}
                          onClick={() =>
                            void handleUpdatePreference({
                              researchAutoSave: !preferences.researchAutoSave,
                            })
                          }
                          className={`rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                            preferences.researchAutoSave
                              ? 'bg-[#2D46E6] text-[#FFFFFF]'
                              : 'border border-[#E4E8F2] bg-[#F7F8FA] text-[#667085]'
                          }`}
                        >
                          {preferences.researchAutoSave ? 'Enabled' : 'Disabled'}
                        </button>
                      </div>

                      <div className="border-t border-[#E4E8F2] pt-5 space-y-2">
                        <div className="text-sm font-semibold text-[#080B12]">
                          Real Market Feeds &amp; Paper Simulation Architecture
                        </div>
                        <p className="text-xs leading-relaxed text-[#667085]">
                          Market quotes and FX rates are retrieved live from Yahoo Finance, CoinGecko, and Frankfurter ECB FX with server-side DB caching. Portfolios, watchlists, simulated trades, and Gemini AI research queries route securely through user-isolated endpoints under{' '}
                          <code className="rounded bg-[#F7F8FA] border border-[#E4E8F2] px-1.5 py-0.5 font-mono text-[#2D46E6]">
                            /api/workspace/*
                          </code>
                          . Nextrade AI is free, open source, and built by Meril &amp; NEXORA Labs.
                        </p>
                      </div>

                      <div className="border-t border-[#E4E8F2] pt-5 flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold text-[#080B12]">
                            Reset Simulated Paper Account
                          </div>
                          <div className="text-xs text-[#667085]">
                            Clear simulated positions and restore clean $100,000.00 virtual buying power.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleResetCleanPaperAccount()}
                          className="rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-4 py-2 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        >
                          Reset Clean Account
                        </button>
                      </div>

                      {(settingsFeedback || orderFeedback) && (
                        <div className="rounded-md border border-[#BBF7D0] bg-[#F0FDF4] p-3 text-xs text-[#15803D]">
                          {settingsFeedback ?? orderFeedback?.message}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* VIEW: ACCOUNT SETTINGS */}
                {activeTab === 'account' && <AccountSettingsPanel onNavigate={onNavigate} />}

                {/* VIEW: SECURITY & SESSIONS */}
                {activeTab === 'security' && <SecuritySessionsPanel onNavigate={onNavigate} />}
              </motion.div>
            </AnimatePresence>
          )}
        </main>
      </div>
    </div>
  );
};
