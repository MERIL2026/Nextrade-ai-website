-- Nextrade AI Phase 2 Authorization, RBAC & Multi-User Workspace Rollback (PostgreSQL / Supabase)
-- Down Migration: 0002_phase2_workspace

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

UPDATE users SET role = 'user' WHERE role = 'super_admin';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'));
DROP INDEX IF EXISTS idx_users_role;

DELETE FROM schema_migrations WHERE version = '0002_phase2_workspace';
