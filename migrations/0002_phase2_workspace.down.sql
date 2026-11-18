-- Nextrade AI Phase 2 Authorization, RBAC & Multi-User Workspace Rollback (SQLite / node:sqlite)
-- Down Migration: 0002_phase2_workspace

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS user_preferences;
DROP TABLE IF EXISTS saved_reports;
DROP TABLE IF EXISTS ai_research_history;
DROP TABLE IF EXISTS paper_transactions;
DROP TABLE IF EXISTS paper_orders;
DROP TABLE IF EXISTS paper_trading_accounts;
DROP TABLE IF EXISTS watchlist_items;
DROP TABLE IF EXISTS watchlists;
DROP TABLE IF EXISTS portfolio_holdings;
DROP TABLE IF EXISTS portfolios;

CREATE TABLE IF NOT EXISTS users_v1 (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'disabled', 'suspended')),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

INSERT INTO users_v1 (
  id, full_name, email, password_hash, email_verified, account_status, role, created_at, updated_at, last_login_at
)
SELECT
  id,
  full_name,
  email,
  password_hash,
  email_verified,
  account_status,
  CASE WHEN role = 'admin' THEN 'admin' ELSE 'user' END,
  created_at,
  updated_at,
  last_login_at
FROM users;

DROP TABLE users;
ALTER TABLE users_v1 RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (account_status);

DELETE FROM schema_migrations WHERE version = '0002_phase2_workspace';

PRAGMA foreign_keys = ON;
