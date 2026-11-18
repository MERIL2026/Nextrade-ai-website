# Nextrade AI — Complete Production Transformation Audit (Stages A & B)

**Product**: Nextrade AI (`https://nextradeai.app` / local Express + React SPA)  
**Built by**: **Meril & NEXORA Labs**  
**License**: Apache-2.0 (Free & Open Source; zero paywalls or subscriptions)  
**Audit Date**: 2026-11-17  

---

## 1. Existing Architecture & Database Source of Truth Verified

- **Backend**: Express SSR + REST API in `server.ts` serving Vite SPA in development and compiled static assets in production, with Security Headers (CSP, `X-Frame-Options`, HSTS in prod, Same-Origin CSRF checks).
- **Databases**:
  - **Production**: Supabase PostgreSQL (`DATABASE_URL` / `SUPABASE_DB_URL`), PgBouncer transaction pooler compatible (`prepare: false`, `max_pipeline: 1`).
  - **Testing**: Local SQLite (`node:sqlite` via `DatabaseSync`) preserving 100% SQL parity across paired migrations in `migrations/` (SQLite) and `migrations/postgres/` (PostgreSQL) plus `.down.sql` rollbacks registered in `src/auth/db.ts` (`0001`–`0006`).
- **Real Modules Verified Working**:
  - **Phase 1**: Argon2id password hashing, HTTP-only session cookies, email verification, password reset (`src/auth/`).
  - **Phase 2**: Server-side workspace persistence (`src/workspace/`) scoped strictly by `req.auth.user.id` across `portfolios`, `portfolio_holdings`, `watchlists`, `watchlist_items`, `paper_trading_accounts`, `paper_orders`, `paper_transactions`, `research_history`, `saved_reports`, `user_preferences`.
  - **Phase 3–6**: RBAC + 6-Phase Admin Control Centre (`src/admin/` + `src/components/admin/`) including Observability, Alerts, Incidents, Lifecycle/Privacy Governance, Backups, Feature Flags, Automation Workflows, Dual-Control Approvals, Emergency Access, and AI Safety Policies.

---

## 2. External Provider Reachability Verification

Live HTTPS probes from the server runtime verified direct server-side connectivity to:
1. **Yahoo Finance Chart & Search API (`query1.finance.yahoo.com`)** — HTTP `200` for US equities (`AAPL`), Indian equities (`RELIANCE.NS`, `TCS.NS`, `HDFCBANK.NS`, `INFY.NS`), US/Indian indices (`^NSEI`, `^BSESN`, `^GSPC`, `^IXIC`), ETFs (`SPY`, `QQQ`), Crypto (`BTC-USD`, `ETH-USD`), Forex (`USDINR=X`, `EURUSD=X`), and live symbol search (`INFY`).
2. **CoinGecko Public API (`api.coingecko.com/api/v3`)** — HTTP `200` for live spot prices (USD & INR + 24h change) and historical crypto market charts (`/coins/{id}/market_chart`).
3. **Frankfurter ECB FX API (`api.frankfurter.app`)** — HTTP `200` for daily European Central Bank reference exchange rates (`USD` -> `INR`, `EUR`, `GBP`, `JPY`, etc.).
4. **Optional Keyed Providers (Architecture Ready, Env-Gated)**: Finnhub (`FINNHUB_API_KEY`), Alpha Vantage (`ALPHA_VANTAGE_API_KEY`), Twelve Data (`TWELVEDATA_API_KEY`) — cleanly report `NOT_CONFIGURED` unless keys are set in server `.env`.
5. **Gemini AI (`@google/genai`)**: Real SDK integration exists (`src/lib/researchEngine.ts`) controlled by `GEMINI_API_KEY` + Admin AI Policy; currently falls back to fake `illustrative-fallback` text when unavailable or when key is unset.

---

## 3. Complete Demo / Mock / Placeholder Inventory & Classification

Per Stage B rules, every finding is classified into one of five categories:
1. **Real production functionality**
2. **Legitimate simulated functionality** (e.g., paper trading — must carry explicit simulation disclaimer and never run on fake static prices)
3. **Temporary demo content** (must be removed/replaced immediately)
4. **Placeholder / unfinished functionality** (must be labeled `BUILDING` / Coming Soon honestly)
5. **Unavailable integration** (must report `UNAVAILABLE` / `NOT_CONFIGURED` honestly)

| Location | Finding | Classification | Remediation Plan |
| --- | --- | --- | --- |
| `src/lib/marketData.ts` | Hardcoded `MARKET_INDICES` (`Demo Session · NSE/BSE/NYSE/NASDAQ`, static `value`, `sparkline`), hardcoded `INSTRUMENTS` (`price`, `changePercent`, `peRatio`, `volatilityAnnualizedPct`), deterministic `buildSeries()` `Math.sin`/`Math.cos` waveforms, and scripted `aiSummary` blocks | **3. Temporary demo content** | Remove all hardcoded prices, synthetic waveforms (`buildSeries`), `Demo Session` labels, and fake `aiSummary` text. Retain pure formatting utilities, catalog symbol metadata (identifiers/names/exchanges/asset categories), and shared strict types with `DataSourceMeta`. |
| `src/lib/researchEngine.ts` | Genuine `@google/genai` SDK call wrapped with `buildFallbackResearch()` (`source: 'illustrative-fallback'`) that returns fabricated financial briefs when `GEMINI_API_KEY` is missing or errors | **1. Real production** (Gemini call) + **3. Temporary demo / 4. Placeholder** (`buildFallbackResearch`) | Remove `buildFallbackResearch` fake thesis generation. When Gemini is unavailable, disabled, or `GEMINI_API_KEY` is unset, return explicit `BUILDING` / `AI_NOT_CONFIGURED` or `AI_UNAVAILABLE` status without inventing stock analysis. Feed real server quote (when available) instead of static snapshot price. |
| `src/lib/portfolioEngine.ts` | `INITIAL_PORTFOLIO_STATE` pre-populates fake `$42,850` cash, `$340.50` realized P&L, 4 fake holdings (`NVDA`, `AAPL`, `RELIANCE.NS`, `TCS.NS`), and 2 fake orders (`SIM-1042`, `SIM-1041`); hardcoded `USD_PER_INR = 1 / 84.2`; `calculatePortfolioMetrics` silently uses `holding.avgCostNative` or static `inst.price` | **3. Temporary demo content** (starter seed + hardcoded FX) + **1. Real math engine** (holding valuation & HHI/volatility math) | Replace starter seed with clean empty state (`EMPTY_PORTFOLIO_STATE`: `$0` cash, 0 holdings, 0 orders; clean `$100,000` virtual paper balance only inside explicit paper trading reset/initialization). Use dynamic server FX rate (`USD/INR` from Frankfurter/Yahoo) with explicit `unavailableCount` / `valuationStatus` when quotes are missing. |
| `src/workspace/service.ts` | `ensureUserWorkspaceInTx()` inserts fake starter holdings/cash/`$340.50` realized P&L/orders and auto-populates 4 watchlist stocks for every new user; `executePaperTrade()` executes against frozen `INSTRUMENTS` snapshot prices; `resetPaperAccount()` defaults to `'starter'` demo seed | **3. Temporary demo content** (fake starter seeds & static fill prices) + **2. Legitimate simulation** (paper trading ledger) | Remove all starter fake holdings, fake orders, and starter watchlist inserts from `ensureUserWorkspaceInTx()`. Default paper account starts cleanly with `$100,000` simulated virtual cash and **zero holdings / zero orders**. Fetch real quote via `MarketService` during `executePaperTrade()` (return `503 QUOTE_UNAVAILABLE` if quote unavailable). Default `resetPaperAccount()` to `'clean'`. |
| `server.ts` (`/api/markets`, `/api/research`) | `/api/markets` returns static `dataMode: 'illustrative-demo'`; `/api/research` passes `fallbackOnError` allowing fake `illustrative-fallback` | **3. Temporary demo content** | Replace `/api/markets` with live `MarketService` backed by Yahoo Finance + CoinGecko + Frankfurter FX + optional env-keyed adapters and L1/L2 DB cache (`0007_market_data_cache.sql`). Add `/api/markets/search`, `/api/markets/quote/:symbol`, `/api/markets/history/:symbol`. Stop returning fake AI fallback on `/api/research`. |
| `src/components/HeroSection.tsx` & `MarketOverviewSection.tsx` | Import hardcoded `INSTRUMENTS` & `MARKET_INDICES`; display static `(Demo)` / `Benchmark Indices (Demo)` / `Demo Price` numbers | **3. Temporary demo content** | Consume `/api/markets` live/delayed/cached quotes with explicit `Source · Status · Updated` metadata and honest empty/unavailable states if upstream fails. |
| `src/components/WorkspacePreviewFrame.tsx` | Displays static `MARKET_INDICES`, `INSTRUMENTS`, `INITIAL_PORTFOLIO_STATE` ($74,475 fake equity), static `aiSummary`, `'Illustrative Demo Mode'` | **3. Temporary demo content** | Connect preview frame to live `/api/markets`, remove fake starter balance (`$0` / `"Clean Simulated Workspace"` / `"No positions yet"` preview), and replace fake `aiSummary` card with honest **AI Building Mode** status panel. |
| `src/components/WorkspaceApp.tsx` | Imports static `INSTRUMENTS` & `MARKET_INDICES`; shows static pre-loaded `activeInstrument.aiSummary`; Analytics computed from `buildSeries`; Paper Trading reads `Demo Reference Price`; Settings mentions `'Illustrative Demo Mode'` | **1. Real workspace persistence** + **2. Paper trading** + **3. Demo data** + **4. Incomplete AI UI** | Fetch all quotes, search, FX, and historical OHLCV from `/api/markets*`; add Category tabs (`Stocks`, `Indices`, `ETFs`, `Crypto`, `Forex`) + live symbol lookup; Portfolio shows user holdings with real FX + manual entry + `UNAVAILABLE` quote handling; Paper Trading shows `"SIMULATED TRADING — No real money or brokerage execution."` + live fill; Analytics computes from real history + honest empty state; AI/Research displays **AI Building Mode** banner + truthful Gemini run/unavailable state. |
| `src/components/pages/MarketsResearchPaperPages.tsx` & `ProductAndFeaturesPages.tsx` | Static sample metrics from `INITIAL_PORTFOLIO_STATE`, `nvdaRisk`, `aiSummary.thesis`; docs describe `Illustrative Demo` and deterministic fallback | **3. Temporary demo content** + **4. Building AI features** | Connect `/markets` to real `/api/markets` + category/search; label `/paper-trading` clearly as `SIMULATED` backed by real quotes; label `/research` & AI feature cards honestly with **AI Building Mode**; update `/features` & `/product` copy to remove fake equity examples. |
| `src/components/FaqAndFooter.tsx`, `OpenSourceAndCommunityPages.tsx`, `TrustAndSupportPages.tsx`, `DocsAndLegalPages.tsx`, `src/lib/siteData.ts`, `index.html` | Missing `Meril & NEXORA Labs` creator attribution; stale `localStorage`/demo-fallback documentation; outdated endpoint notes | **3. Stale docs / missing branding** | Add `"Nextrade AI is built by Meril & NEXORA Labs."` across Footer, `/about`, `/open-source`, docs, and HTML/SEO schema (`index.html`). Update architecture, API, data-disclaimer, and open-source pages to match true production behavior. Preserve verified GitHub URL `https://github.com/MERIL2026/nextrade-ai`. |
| `src/admin/telemetry.ts`, `src/admin/service.ts`, `src/admin/observabilityService.ts`, `src/admin/types.ts`, `src/components/admin/AdminMarketsView.tsx`, `AdminOverviewView.tsx`, `AdminAiView.tsx` | `market-catalog-sync` checks static `INSTRUMENTS` array and writes `'nextrade-catalog-snapshot'` (`SIMULATED`); `AdminMarketsView` shows frozen snapshot prices; `AdminAiView` presents `'illustrative-fallback'` option | **1. Real RBAC & Telemetry** + **3. Snapshot-era config** | Upgrade `market-catalog-sync` & `getMarketsOverview` & `observabilityService` to probe and track real Market Data adapters (`Yahoo Finance`, `CoinGecko`, `Frankfurter FX`, optional keyed providers), record real latency/failures/staleness, and align AI controls with Building Mode / strict Gemini truthfulness. |

---

## 4. Database Preservation & Migration Plan

- Preserve existing `0001`–`0006` migrations and all existing user accounts (`purvprajapati99@gmail.com`, `merilparmar26@gmail.com`, `merilpu37@gmail.com`) intact without destructive resets.
- Add paired migration **`0007_market_data_cache.sql`** (SQLite + PostgreSQL + `.down.sql` rollbacks) registered in `src/auth/db.ts`:
  - `market_quote_cache`: symbol, asset_category, exchange, region, currency, name, price, previous_close, change_value, change_percent, high, low, volume, open_price, market_cap, provider_id, status (`LIVE` | `DELAYED` | `END_OF_DAY` | `CACHED` | `UNAVAILABLE`), delay_minutes, source_timestamp, fetched_at, expires_at, payload_json.
  - `market_fx_cache`: pair (`USD/INR`, etc.), rate, provider_id, status, source_date, fetched_at, expires_at.
  - `market_history_cache`: cache_key (`SYMBOL:TIMEFRAME`), symbol, timeframe, points_json, provider_id, status, fetched_at, expires_at.

---

## 5. Risks & Guardrails

1. **Test Suite Updates Required Intentionally**: Existing test assertions in `src/lib/portfolioEngine.test.ts`, `src/lib/security.test.ts`, `src/lib/siteData.test.ts`, `src/workspace/workspace.test.ts`, and `src/admin/admin.test.ts` explicitly expect old starter holdings/fallback AI strings. Every modified contract will be updated and tested cleanly with deterministic HTTP mocks / unit tests in addition to live server checks.
2. **Existing Production DB User Rows**: Do NOT wipe or mutate existing users' real accounts during startup migrations. Only stop seeding fake starter holdings/orders/watchlist items for newly provisioned workspaces (`ensureUserWorkspaceInTx`).
3. **External Rate Limits & Failures**: Protect Yahoo Finance, CoinGecko, and Frankfurter with per-provider sliding-window rate limiters, `5500ms` timeouts, bounded retries (2 retries w/ jittered backoff), L1 memory + L2 DB caching, and stale-cache fallback explicitly labeled `CACHED` (or `UNAVAILABLE` if never fetched).
