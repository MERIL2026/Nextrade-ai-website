-- Nextrade AI Production Market Data Cache & Provider Snapshot Schema (PostgreSQL / Supabase)
-- Down Migration: 0007_market_data_cache

DROP INDEX IF EXISTS idx_market_history_cache_symbol;
DROP TABLE IF EXISTS market_history_cache;

DROP TABLE IF EXISTS market_fx_cache;

DROP INDEX IF EXISTS idx_market_quote_cache_category;
DROP TABLE IF EXISTS market_quote_cache;

DELETE FROM schema_migrations WHERE version = '0007_market_data_cache';
