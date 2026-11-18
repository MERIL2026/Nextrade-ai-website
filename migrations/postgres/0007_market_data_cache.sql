-- Nextrade AI Production Market Data Cache & Provider Snapshot Schema (PostgreSQL / Supabase)
-- Up Migration: 0007_market_data_cache

CREATE TABLE IF NOT EXISTS market_quote_cache (
  symbol VARCHAR(36) PRIMARY KEY,
  asset_category VARCHAR(16) NOT NULL CHECK (asset_category IN ('STOCK', 'INDEX', 'ETF', 'CRYPTO', 'FOREX')),
  exchange VARCHAR(32) NOT NULL,
  region VARCHAR(16) NOT NULL CHECK (region IN ('IN', 'US', 'GLOBAL')),
  currency VARCHAR(8) NOT NULL CHECK (currency IN ('INR', 'USD')),
  name VARCHAR(160) NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  previous_close DOUBLE PRECISION,
  change_value DOUBLE PRECISION,
  change_percent DOUBLE PRECISION,
  high_price DOUBLE PRECISION,
  low_price DOUBLE PRECISION,
  open_price DOUBLE PRECISION,
  volume BIGINT,
  provider_id VARCHAR(48) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('LIVE', 'DELAYED', 'END_OF_DAY', 'CACHED', 'UNAVAILABLE')),
  delay_minutes INTEGER NOT NULL DEFAULT 15,
  source_timestamp TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_market_quote_cache_category ON market_quote_cache (asset_category, region, fetched_at DESC);

CREATE TABLE IF NOT EXISTS market_fx_cache (
  pair VARCHAR(24) PRIMARY KEY,
  base_currency VARCHAR(8) NOT NULL,
  quote_currency VARCHAR(8) NOT NULL,
  rate DOUBLE PRECISION NOT NULL,
  provider_id VARCHAR(48) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('LIVE', 'DELAYED', 'END_OF_DAY', 'CACHED', 'UNAVAILABLE')),
  source_date VARCHAR(32),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS market_history_cache (
  cache_key VARCHAR(64) PRIMARY KEY,
  symbol VARCHAR(36) NOT NULL,
  timeframe VARCHAR(8) NOT NULL CHECK (timeframe IN ('1D', '1W', '1M', '6M', '1Y')),
  points_json TEXT NOT NULL,
  provider_id VARCHAR(48) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('LIVE', 'DELAYED', 'END_OF_DAY', 'CACHED', 'UNAVAILABLE')),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_history_cache_symbol ON market_history_cache (symbol, timeframe);
