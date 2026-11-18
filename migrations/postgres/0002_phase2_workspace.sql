-- Nextrade AI Phase 2 Authorization, RBAC & Multi-User Workspace Schema (PostgreSQL / Supabase)
-- Up Migration: 0002_phase2_workspace

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin', 'super_admin'));
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

CREATE TABLE IF NOT EXISTS portfolios (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  base_currency VARCHAR(8) NOT NULL DEFAULT 'USD' CHECK (base_currency IN ('USD', 'INR')),
  initial_balance_cents BIGINT NOT NULL CHECK (initial_balance_cents >= 0),
  cash_balance_cents BIGINT NOT NULL CHECK (cash_balance_cents >= 0),
  realized_pnl_cents BIGINT NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolios_user_id ON portfolios (user_id);

CREATE TABLE IF NOT EXISTS portfolio_holdings (
  id UUID PRIMARY KEY,
  portfolio_id UUID NOT NULL REFERENCES portfolios (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  symbol VARCHAR(24) NOT NULL,
  exchange VARCHAR(32) NOT NULL,
  region VARCHAR(8) NOT NULL CHECK (region IN ('IN', 'US')),
  name VARCHAR(120) NOT NULL,
  quantity_units BIGINT NOT NULL CHECK (quantity_units > 0),
  avg_cost_minor BIGINT NOT NULL CHECK (avg_cost_minor >= 0),
  currency VARCHAR(8) NOT NULL CHECK (currency IN ('USD', 'INR')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (portfolio_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_holdings_user_id ON portfolio_holdings (user_id);
CREATE INDEX IF NOT EXISTS idx_holdings_portfolio_id ON portfolio_holdings (portfolio_id);

CREATE TABLE IF NOT EXISTS watchlists (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_watchlists_user_id ON watchlists (user_id);

CREATE TABLE IF NOT EXISTS watchlist_items (
  id UUID PRIMARY KEY,
  watchlist_id UUID NOT NULL REFERENCES watchlists (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  symbol VARCHAR(24) NOT NULL,
  exchange VARCHAR(32) NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (watchlist_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_items_user_id ON watchlist_items (user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_items_watchlist_id ON watchlist_items (watchlist_id);

CREATE TABLE IF NOT EXISTS paper_trading_accounts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  portfolio_id UUID NOT NULL REFERENCES portfolios (id) ON DELETE CASCADE,
  starting_balance_cents BIGINT NOT NULL CHECK (starting_balance_cents >= 0),
  cash_balance_cents BIGINT NOT NULL CHECK (cash_balance_cents >= 0),
  realized_pnl_cents BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'INR')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paper_accounts_user_id ON paper_trading_accounts (user_id);

CREATE TABLE IF NOT EXISTS paper_orders (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES paper_trading_accounts (id) ON DELETE CASCADE,
  portfolio_id UUID NOT NULL REFERENCES portfolios (id) ON DELETE CASCADE,
  client_order_id VARCHAR(80),
  symbol VARCHAR(24) NOT NULL,
  exchange VARCHAR(32) NOT NULL,
  side VARCHAR(8) NOT NULL CHECK (side IN ('BUY', 'SELL')),
  order_type VARCHAR(16) NOT NULL DEFAULT 'MARKET' CHECK (order_type IN ('MARKET', 'LIMIT')),
  quantity_units BIGINT NOT NULL CHECK (quantity_units > 0),
  requested_price_minor BIGINT NOT NULL CHECK (requested_price_minor >= 0),
  execution_price_minor BIGINT NOT NULL CHECK (execution_price_minor >= 0),
  currency VARCHAR(8) NOT NULL CHECK (currency IN ('USD', 'INR')),
  total_usd_cents BIGINT NOT NULL CHECK (total_usd_cents >= 0),
  realized_pnl_cents BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL DEFAULT 'FILLED' CHECK (status IN ('FILLED', 'REJECTED', 'CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at TIMESTAMPTZ,
  UNIQUE (user_id, client_order_id)
);

CREATE INDEX IF NOT EXISTS idx_paper_orders_user_created ON paper_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_orders_account_id ON paper_orders (account_id);

CREATE TABLE IF NOT EXISTS paper_transactions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES paper_trading_accounts (id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES paper_orders (id) ON DELETE CASCADE,
  symbol VARCHAR(24) NOT NULL,
  side VARCHAR(8) NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity_units BIGINT NOT NULL CHECK (quantity_units > 0),
  price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
  fees_minor BIGINT NOT NULL DEFAULT 0 CHECK (fees_minor >= 0),
  total_usd_cents BIGINT NOT NULL CHECK (total_usd_cents >= 0),
  realized_pnl_cents BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL CHECK (currency IN ('USD', 'INR')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paper_tx_user_created ON paper_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_tx_order_id ON paper_transactions (order_id);

CREATE TABLE IF NOT EXISTS ai_research_history (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  symbol VARCHAR(24) NOT NULL,
  query TEXT NOT NULL,
  research_result_json TEXT NOT NULL,
  source VARCHAR(32) NOT NULL,
  model VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_research_user_created ON ai_research_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_user_symbol ON ai_research_history (user_id, symbol);

CREATE TABLE IF NOT EXISTS saved_reports (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL,
  report_type VARCHAR(40) NOT NULL,
  symbol VARCHAR(24) NOT NULL,
  report_content_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_reports_user_created ON saved_reports (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  preferences_json TEXT NOT NULL,
  legacy_imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
