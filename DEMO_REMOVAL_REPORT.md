# NEXTRADE AI — DEMO REMOVAL REPORT

## 1. Executive Summary

All fabricated, static, and placeholder demo data paths across Nextrade AI have been audited and removed from the public marketing site, interactive hero calculator, workspace browser application, backend services, and admin governance views. Simulated practice features that intentionally operate on virtual balances (Simulated Paper Trading) remain clearly separated, start from clean empty ledgers (`$100,000.00` virtual buying power with zero starter holdings), price dynamically against real server-fetched quotes, and prominently display `SIMULATED TRADING — No real money or brokerage execution.`.

## 2. Branding & Product Scope Enforcement

- **Product Identity:** Nextrade AI
- **Creators:** Built by **Meril & NEXORA Labs**
- **License & Access Model:** 100% Free & Open Source (`Apache-2.0`), repository at `https://github.com/MERIL2026/nextrade-ai`. No paid subscriptions, tiers, or paywalls exist anywhere in the codebase.
- **Footer & Attribution Updates:** Updated `src/components/FaqAndFooter.tsx`, `src/lib/siteData.ts`, `src/components/HeroSection.tsx`, `src/components/pages/OpenSourceAndCommunityPages.tsx`, `index.html`, and `metadata.json` with explicit attribution (`"Nextrade AI is built by Meril & NEXORA Labs."`).

## 3. Classification & Removal Matrix

| Removed / Updated Artifact | Previous Demo Behavior | Production Replacement |
| :--- | :--- | :--- |
| `src/lib/marketData.ts` & `src/market/catalog.ts` | Static `INSTRUMENTS` array & `MARKET_INDICES` with hardcoded prices, deterministic `generateHistoricalSeries` random walks, and `SIMULATED` defaults | Replaced with `CATALOG_INSTRUMENTS` & `CATALOG_INDICES` metadata registries containing zero prices; all prices, OHLC points, and FX rates come strictly from `createMarketService` (`Yahoo Finance`, `CoinGecko`, `Frankfurter ECB FX`) or return `null` (`UNAVAILABLE`) |
| `src/lib/portfolioEngine.ts` | Exported `INITIAL_PORTFOLIO_STATE` with pre-seeded holdings (`RELIANCE.NS`, `NVDA`, `AAPL`, `TCS.NS`) & `$42,850` cash + hardcoded `84.5` USD/INR rate | Replaced with `EMPTY_PORTFOLIO_STATE` (`$0` cash, 0 holdings) for personal tracking and `CLEAN_PAPER_TRADING_STATE` (`$100,000.00` cash, 0 starter positions, 0 orders); removed hardcoded `84.5` constant in favor of explicit nullable `usdInrRate`; portfolio valuations yield `null` (`Unavailable`) when upstream FX or quotes are missing |
| `src/lib/researchEngine.ts` | Generated deterministic illustrative placeholder research briefs (`illustrative-fallback`) when `GEMINI_API_KEY` was absent or Gemini errored | Removed fallback brief generator completely; throws typed `ResearchServiceError` (`AI_NOT_CONFIGURED`, `AI_UNAVAILABLE`, `AI_FEATURE_DISABLED`, `AI_POLICY_BLOCKED`) so UI displays **AI Building Mode** cleanly |
| `src/components/HeroSection.tsx` & `src/components/MarketOverviewSection.tsx` | Displayed hardcoded ticker figures (`NVDA`, `NIFTY 50`) and simulated snapshots | Fetches live quotes, benchmark indices, sparklines, and ECB `USD/INR` FX from `/api/markets`; surfaces `DELAYED`, `LIVE`, `END_OF_DAY`, `CACHED`, or `UNAVAILABLE` |
| `src/components/WorkspacePreviewFrame.tsx` | Simulated workspace preview displaying static numbers & sample AI brief | Connects to live `/api/markets` and `/api/markets/history/:symbol`; displays AI Building Mode roadmap (`BUILDING` / `COMING SOON`) with zero fake AI prose |
| `src/components/WorkspaceApp.tsx` | Reached into hardcoded `INSTRUMENTS`, `INITIAL_PORTFOLIO_STATE`, hardcoded P/E, Beta, and fake `aiSummary` text | Consumes real `/api/markets`, `/api/markets/quote/:symbol`, `/api/markets/history/:symbol`, `/api/markets/search`, user-scoped DB portfolios with manual holding entry/removal, clean `$100k` paper trading reset, and AI Building Mode panel |
| `src/components/pages/MarketsResearchPaperPages.tsx` | Static snapshot tables, illustrative fallback notes, and starter pre-seeded holdings | Replaced with multi-asset category filtering (`STOCK`, `INDEX`, `ETF`, `CRYPTO`, `FOREX`), clean `$100k` simulated paper account banner, and AI Building Mode card |
| `src/components/CookieConsentBanner.tsx` | Referenced `"paper-trading demo state"` | Updated to `"simulated paper-trading preferences"` |
| `src/components/admin/AdminMarketsView.tsx`, `AdminAiView.tsx`, `AdminAiPoliciesView.tsx`, `src/admin/superOpsService.ts` | Referenced `snapshotPrice`, `"deterministic illustrative catalog snapshots"`, and `"illustrative fallback"` | Updated to `latestPrice ?? 'Unavailable'`, `providerName`, `GLOBAL` region governance, active live market adapter status reporting, and AI Building Mode policy controls |

## 4. Verification Summary

- Verified zero references to `INITIAL_PORTFOLIO_STATE`, `generateHistoricalSeries`, `snapshotPrice`, or `"paper-trading demo"` remain in application runtime code.
- Verified `npm run lint` (`tsc --noEmit`) and `vite build` pass cleanly without errors.
- Verified automated tests (`58/58` passing across `src/lib/*.test.ts`, `src/market/*.test.ts`, `src/auth/*.test.ts`, `src/workspace/*.test.ts`, `src/admin/*.test.ts`) confirm fail-closed null valuations and zero fabricated fallback quotes or AI theses.
