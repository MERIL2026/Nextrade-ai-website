# NEXTRADE AI — REAL DATA INTEGRATION REPORT

## 1. Architecture Overview

Nextrade AI now operates a unified server-side multi-asset market data engine (`src/market/`) backed by paired SQLite & Supabase PostgreSQL L2 persistence (`migrations/0007_market_data_cache.sql` and `migrations/postgres/0007_market_data_cache.sql`), HTTP caching headers, and explicit provenance classification on every payload.

**Never-Fabricate Guarantee:** Upstream failures degrade first to L1 in-memory cache (`CACHED`), second to L2 database cache (`CACHED`), and finally return explicit `null` price/series DTOs marked `status: 'UNAVAILABLE'` with an `unavailableReason`. Numeric prices or fake sparklines are never synthesized.

## 2. Covered Asset Classes & Catalog

`src/market/catalog.ts` provides default benchmark indices and multi-asset coverage across regions (`IN`, `US`, `GLOBAL`) while dynamic search extends coverage to any symbol discoverable via Yahoo Finance:

- **Equities (`STOCK`):** NSE (`RELIANCE.NS`, `TCS.NS`, `HDFCBANK.NS`, `INFY.NS`) and NASDAQ (`NVDA`, `AAPL`, `MSFT`, `GOOGL`, plus dynamic search)
- **Benchmark Indices (`INDEX`):** `^NSEI` (NIFTY 50), `^BSESN` (BSE SENSEX), `^NSEBANK` (BANK NIFTY), `^GSPC` (S&P 500), `^IXIC` (NASDAQ Composite), `^DJI` (Dow Jones 30)
- **ETFs (`ETF`):** `NIFTYBEES.NS`, `SPY`, `QQQ`
- **Crypto (`CRYPTO`):** `BTC-USD`, `ETH-USD`, `SOL-USD`
- **Forex (`FOREX`):** `USDINR=X`, `EURUSD=X`, `GBPUSD=X` + standalone ECB `USD/INR` reference pair

## 3. Upstream Provider Adapters (`src/market/providers.ts`)

| Provider | Asset Classes | Requirement | Classification | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Yahoo Finance Chart & Search API** | Stocks, Indices, ETFs, Crypto, Forex | Public server-side (`fetch`) | `DELAYED` (~15m) | Primary equities/index/ETF OHLC history (`1D`, `1W`, `1M`, `6M`, `1Y`), quotes, and symbol search |
| **CoinGecko Public API** | Crypto Spot & Market Chart | Public server-side (`fetch`) | `LIVE` (spot) / `DELAYED` (charts) | Primary crypto spot prices & 24h delta with Yahoo Finance fallback |
| **Frankfurter (ECB Reference FX)** | Reference FX (`USD/INR`) | Public server-side (`fetch`) | `END_OF_DAY` | Authoritative daily ECB USD/INR conversion with Yahoo `USDINR=X` fallback |
| **Finnhub** *(Optional)* | US Equities / ETFs | `FINNHUB_API_KEY` | `LIVE` | Automatically prioritized for US symbols when configured; otherwise reports `NOT_CONFIGURED` |
| **Alpha Vantage / Twelve Data** *(Optional)* | Stocks, ETFs, Forex | `ALPHA_VANTAGE_API_KEY` / `TWELVEDATA_API_KEY` | `END_OF_DAY` / `DELAYED` | Surfaces `NOT_CONFIGURED` honestly in Provider Registry until keys are supplied |

## 4. API Surface & Database Caching

### Persisted Cache Schema (`0007_market_data_cache`)
- `market_quote_cache`: Stores normalized quotes, provider attribution, timestamps, expiration, and sparkline points.
- `market_history_cache`: Stores timeframe-indexed historical close/volume arrays (`1D`, `1W`, `1M`, `6M`, `1Y`).
- `market_fx_cache`: Stores `USD/INR` reference rates and ECB source dates.

### Verified Express Endpoints (`server.ts`)
- `GET /api/markets`: Returns `MarketOverviewResponseDto` (`indices`, `instruments`, `fx.usdInr`, `providers`, `summary`), filtered server-side by admin `enabledRegions` (`IN`, `US`, `GLOBAL`), `disabledSymbols`, and `?category=` / `?region=` query params.
- `GET /api/markets/quote/:symbol`: Fetches or serves cached quote with provider provenance and freshness metadata.
- `GET /api/markets/history/:symbol?timeframe=1M`: Returns real historical OHLC/close series for interactive charting and client-side drawdown/volatility math (`calculateSeriesRiskMetrics`).
- `GET /api/markets/search?q=...`: Searches local catalog plus remote Yahoo Finance instruments.

## 5. Server-Side Paper Trading & Portfolio Integrity

- `src/workspace/service.ts` resolves execution quotes via `resolveQuote(symbol)` and currency conversions via `resolveUsdInrRate()` on the server — client-spoofed prices or static FX values are rejected (`QUOTE_UNAVAILABLE`, `FX_UNAVAILABLE`).
- `portfolio_holdings.region` (`IN` / `US` Postgres constraint) normalizes `'GLOBAL'` assets safely via `toStorageRegion(region, currency)`.
- Users manage personal holdings manually (`PUT /api/workspace/portfolios/:id/holdings/:symbol`, `DELETE .../holdings/:symbol`) alongside watchlist additions for any supported or searched ticker.
