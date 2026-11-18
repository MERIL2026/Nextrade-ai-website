-- Nextrade AI Phase 2 Authorization, RBAC & Multi-User Workspace Schema (SQLite / node:sqlite)
-- Up Migration: 0002_phase2_workspace

PRAGMA foreign_keys = OFF;

-- Expand users.role CHECK constraint to include super_admin safely without losing existing rows
CREATE TABLE IF NOT EXISTS users_v2 (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'disabled', 'suspended')),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

INSERT INTO users_v2 (
  id, full_name, email, password_hash, email_verified, account_status, role, created_at, updated_at, last_login_at
)
SELECT
  id,
  full_name,
  email,
  password_hash,
  email_verified,
  account_status,
  CASE
    WHEN LOWER(role) IN ('user', 'admin', 'super_admin') THEN LOWER(role)
    ELSE 'user'
  END,
  created_at,
  updated_at,
  last_login_at
FROM users;

DROP TABLE users;
ALTER TABLE users_v2 RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (account_status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS portfolios (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'USD' CHECK (base_currency IN ('USD', 'INR')),
  initial_balance_cents INTEGER NOT NULL CHECK (initial_balance_cents >= 0),
  cash_balance_cents INTEGER NOT NULL CHECK (cash_balance_cents >= 0),
  realized_pnl_cents INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_portfolios_user_id ON portfolios (user_id);

CREATE TABLE IF NOT EXISTS portfolio_holdings (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  region TEXT NOT NULL CHECK (region IN ('IN', 'US')),
  name TEXT NOT NULL,
  quantity_units INTEGER NOT NULL CHECK (quantity_units > 0),
  avg_cost_minor INTEGER NOT NULL CHECK (avg_cost_minor >= 0),
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'INR')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (portfolio_id, symbol),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_holdings_user_id ON portfolio_holdings (user_id);
CREATE INDEX IF NOT EXISTS idx_holdings_portfolio_id ON portfolio_holdings (portfolio_id);

CREATE TABLE IF NOT EXISTS watchlists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_watchlists_user_id ON watchlists (user_id);

CREATE TABLE IF NOT EXISTS watchlist_items (
  id TEXT PRIMARY KEY,
  watchlist_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  added_at TEXT NOT NULL,
  UNIQUE (watchlist_id, symbol),
  FOREIGN KEY (watchlist_id) REFERENCES watchlists (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_watchlist_items_user_id ON watchlist_items (user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_items_watchlist_id ON watchlist_items (watchlist_id);

CREATE TABLE IF NOT EXISTS paper_trading_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  portfolio_id TEXT NOT NULL,
  starting_balance_cents INTEGER NOT NULL CHECK (starting_balance_cents >= 0),
  cash_balance_cents INTEGER NOT NULL CHECK (cash_balance_cents >= 0),
  realized_pnl_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'INR')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (portfolio_id) REFERENCES portfolios (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_paper_accounts_user_id ON paper_trading_accounts (user_id);

CREATE TABLE IF NOT EXISTS paper_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  portfolio_id TEXT NOT NULL,
  client_order_id TEXT,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  order_type TEXT NOT NULL DEFAULT 'MARKET' CHECK (order_type IN ('MARKET', 'LIMIT')),
  quantity_units INTEGER NOT NULL CHECK (quantity_units > 0),
  requested_price_minor INTEGER NOT NULL CHECK (requested_price_minor >= 0),
  execution_price_minor INTEGER NOT NULL CHECK (execution_price_minor >= 0),
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'INR')),
  total_usd_cents INTEGER NOT NULL CHECK (total_usd_cents >= 0),
  realized_pnl_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'FILLED' CHECK (status IN ('FILLED', 'REJECTED', 'CANCELLED')),
  created_at TEXT NOT NULL,
  executed_at TEXT,
  UNIQUE (user_id, client_order_id),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES paper_trading_accounts (id) ON DELETE CASCADE,
  FOREIGN KEY (portfolio_id) REFERENCES portfolios (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_paper_orders_user_created ON paper_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_orders_account_id ON paper_orders (account_id);

CREATE TABLE IF NOT EXISTS paper_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity_units INTEGER NOT NULL CHECK (quantity_units > 0),
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  fees_minor INTEGER NOT NULL DEFAULT 0 CHECK (fees_minor >= 0),
  total_usd_cents INTEGER NOT NULL CHECK (total_usd_cents >= 0),
  realized_pnl_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'INR')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES paper_trading_accounts (id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES paper_orders (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_paper_tx_user_created ON paper_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_tx_order_id ON paper_transactions (order_id);

CREATE TABLE IF NOT EXISTS ai_research_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  query TEXT NOT NULL,
  research_result_json TEXT NOT NULL,
  source TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_research_user_created ON ai_research_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_user_symbol ON ai_research_history (user_id, symbol);

CREATE TABLE IF NOT EXISTS saved_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  report_type TEXT NOT NULL,
  symbol TEXT NOT NULL,
  report_content_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_saved_reports_user_created ON saved_reports (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  preferences_json TEXT NOT NULL,
  legacy_imported_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
