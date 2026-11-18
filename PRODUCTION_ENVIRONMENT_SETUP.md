# NEXTRADE AI — PRODUCTION ENVIRONMENT SETUP

## 1. Prerequisites

- **Node.js**: v22+ (with built-in `node:sqlite` support for local fallback and unit testing)
- **Package Manager**: `npm` or `bun`
- **Database**: Supabase PostgreSQL URI (recommended for production) or SQLite (`.data/nextrade-auth.sqlite` local fallback)

## 2. Environment Variables (`.env`)

Copy `.env.example` to `.env` and populate values appropriate for your environment. **Never commit `.env` or secret keys to version control.**

### Core Application & Security
- `APP_URL`: Canonical HTTPS origin (e.g., `https://nextrade.example.com`) used for SSR `<link rel="canonical">`, email verification links, and CSRF origin checks.
- `GEMINI_API_KEY`: Server-side Google Gemini API key required for live AI synthesis on `/api/research` and `/api/workspace/research`. When omitted, Nextrade AI safely enters **AI Building Mode** (`503 AI_NOT_CONFIGURED`).

### Database (Supabase PostgreSQL / SQLite Fallback)
- `DATABASE_URL` or `SUPABASE_DB_URL`: PostgreSQL connection string (`postgresql://...`). When provided, `createAuthDatabase` connects to PostgreSQL and executes `migrations/postgres/0001_init_auth.sql` through `migrations/postgres/0007_market_data_cache.sql`.
- `AUTH_DB_PATH`: Local SQLite file path (defaults to `.data/nextrade-auth.sqlite`) used only when PostgreSQL URI variables are unset.

### Transactional Email (Verification, Reset, Security Alerts)
- Default `EMAIL_PROVIDER="emailjs"`:
  - `EMAILJS_SERVICE_ID`
  - `EMAILJS_TEMPLATE_ID`
  - `EMAILJS_PUBLIC_KEY`
  - `EMAILJS_PRIVATE_KEY`
  - `EMAILJS_RESET_TEMPLATE_ID`
  - `EMAILJS_SECURITY_TEMPLATE_ID`
- Optional `EMAIL_PROVIDER="resend"`:
  - `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`
- `AUTH_DEV_OUTBOX="false"` in production.

### Market Data Providers
- **Works Out of the Box (No Keys Required):**
  - Yahoo Finance Chart & Search API (Equities, Indices, ETFs, Crypto, FX)
  - CoinGecko Spot & Market Chart API (Crypto)
  - Frankfurter ECB Reference FX API (`USD/INR`)
- **Optional Dedicated Market API Keys:**
  - `FINNHUB_API_KEY` (prioritized low-latency US stock/ETF quotes)
  - `ALPHA_VANTAGE_API_KEY`
  - `TWELVEDATA_API_KEY`

### Controlled Super Admin Bootstrap & Analytics (Optional)
- `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD`, `ADMIN_BOOTSTRAP_NAME`: Seeds initial `super_admin` only if zero active `super_admin` accounts exist in the database.
- `GA_MEASUREMENT_ID`: Optional Google Analytics 4 measurement ID (gated behind user cookie consent).
- `GOOGLE_SITE_VERIFICATION` / `GOOGLE_SITE_VERIFICATION_FILE`: Optional Search Console verification.

## 3. Running & Deploying

```bash
# 1. Install dependencies
npm install

# 2. Verify TypeScript & test suite
npm run lint
npx --yes tsx --test src/lib/*.test.ts src/market/*.test.ts src/auth/*.test.ts src/workspace/*.test.ts src/admin/*.test.ts

# 3. Build production client bundle
npm run build

# 4. Start server on port 3000 (development or production entry)
npm run dev
# or for production:
NODE_ENV=production npm start
```

Verify startup health at `GET /api/health` (`status: "ok"`) and market feed connectivity at `GET /api/markets`.
