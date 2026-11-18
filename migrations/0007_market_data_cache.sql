-- Nextrade AI Production Market Data Cache & Provider Snapshot Schema (SQLite / node:sqlite)
-- Up Migration: 0007_market_data_cache

CREATE TABLE IF NOT EXISTS market_quote_cache (
  symbol TEXT PRIMARY KEY,
  asset_category TEXT NOT NULL CHECK (asset_category IN ('STOCK', 'INDEX', 'ETF', 'CRYPTO', 'FOREX')),
  exchange TEXT NOT NULL,
  region TEXT NOT NULL CHECK (region IN ('IN', 'US', 'GLOBAL')),
  currency TEXT NOT NULL CHECK (currency IN ('INR', 'USD')),
  name TEXT NOT NULL,
  price REAL NOT NULL,
  previous_close REAL,
  change_value REAL,
  change_percent REAL,
  high_price REAL,
  low_price REAL,
  open_price REAL,
  volume INTEGER,
  provider_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('LIVE', 'DELAYED', 'END_OF_DAY', 'CACHED', 'UNAVAILABLE')),
  delay_minutes INTEGER NOT NULL DEFAULT 15,
  source_timestamp TEXT,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_market_quote_cache_category ON market_quote_cache (asset_category, region, fetched_at DESC);

CREATE TABLE IF NOT EXISTS market_fx_cache (
  pair TEXT PRIMARY KEY,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate REAL NOT NULL,
  provider_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('LIVE', 'DELAYED', 'END_OF_DAY', 'CACHED', 'UNAVAILABLE')),
  source_date TEXT,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_history_cache (
  cache_key TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('1D', '1W', '1M', '6M', '1Y')),
  points_json TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('LIVE', 'DELAYED', 'END_OF_DAY', 'CACHED', 'UNAVAILABLE')),
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_history_cache_symbol ON market_history_cache (symbol, timeframe);
