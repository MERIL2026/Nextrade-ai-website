-- Nextrade AI Phase 4 Platform Intelligence & Observability Schema (PostgreSQL / Supabase)
-- Up Migration: 0004_phase4_observability

ALTER TABLE admin_incidents DROP CONSTRAINT IF EXISTS admin_incidents_status_check;
ALTER TABLE admin_incidents ADD CONSTRAINT admin_incidents_status_check CHECK (
  status IN ('OPEN', 'INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'MITIGATED', 'RESOLVED')
);
ALTER TABLE admin_incidents ADD COLUMN IF NOT EXISTS owner_email VARCHAR(180) NOT NULL DEFAULT '';
ALTER TABLE admin_incidents ADD COLUMN IF NOT EXISTS linked_alert_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE admin_incidents ADD COLUMN IF NOT EXISTS linked_event_refs_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS is_paused BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE background_job_runs ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ;
ALTER TABLE background_job_runs ADD COLUMN IF NOT EXISTS wait_ms INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS service_health_checks (
  id UUID PRIMARY KEY,
  service_id VARCHAR(64) NOT NULL,
  service_name VARCHAR(120) NOT NULL,
  category VARCHAR(32) NOT NULL,
  status VARCHAR(24) NOT NULL CHECK (status IN ('HEALTHY', 'DEGRADED', 'NOT_CONFIGURED', 'UNAVAILABLE')),
  latency_ms INTEGER,
  detail VARCHAR(320) NOT NULL DEFAULT '',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_health_checked_at ON service_health_checks (checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_health_service_id ON service_health_checks (service_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS market_data_health (
  id UUID PRIMARY KEY,
  provider_id VARCHAR(64) NOT NULL,
  provider_name VARCHAR(120) NOT NULL,
  status VARCHAR(24) NOT NULL CHECK (status IN ('HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'NOT_CONFIGURED')),
  classification VARCHAR(24) NOT NULL CHECK (classification IN ('LIVE', 'DELAYED', 'SIMULATED', 'CACHE', 'UNAVAILABLE')),
  symbols_processed INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  validation_failures INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  detail VARCHAR(320) NOT NULL DEFAULT '',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_health_checked_at ON market_data_health (checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_health_provider ON market_data_health (provider_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id VARCHAR(64) PRIMARY KEY,
  status VARCHAR(16) NOT NULL DEFAULT 'HEALTHY' CHECK (status IN ('HEALTHY', 'PAUSED', 'DEGRADED', 'STOPPED')),
  queue_paused BOOLEAN NOT NULL DEFAULT FALSE,
  active_job_id VARCHAR(64),
  processed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operational_alerts (
  id UUID PRIMARY KEY,
  fingerprint VARCHAR(160) NOT NULL UNIQUE,
  category VARCHAR(24) NOT NULL CHECK (category IN ('API', 'AI', 'SECURITY', 'MARKET_DATA', 'BACKGROUND_JOB', 'SYSTEM')),
  title VARCHAR(180) NOT NULL,
  description TEXT NOT NULL,
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPPRESSED')),
  source VARCHAR(64) NOT NULL DEFAULT 'threshold_engine',
  service_id VARCHAR(64),
  metric_value DOUBLE PRECISION,
  threshold_value DOUBLE PRECISION,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  event_refs_json TEXT NOT NULL DEFAULT '[]',
  internal_notes TEXT NOT NULL DEFAULT '',
  acknowledged_by UUID REFERENCES users (id) ON DELETE SET NULL,
  resolved_by UUID REFERENCES users (id) ON DELETE SET NULL,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cooldown_until TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_status_severity ON operational_alerts (status, severity, last_detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_category ON operational_alerts (category, last_detected_at DESC);

CREATE TABLE IF NOT EXISTS alert_history (
  id UUID PRIMARY KEY,
  alert_id UUID NOT NULL REFERENCES operational_alerts (id) ON DELETE CASCADE,
  previous_status VARCHAR(20),
  new_status VARCHAR(20) NOT NULL,
  actor_id UUID REFERENCES users (id) ON DELETE SET NULL,
  actor_email VARCHAR(180) NOT NULL DEFAULT 'system',
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_history_alert_id ON alert_history (alert_id, created_at DESC);

CREATE TABLE IF NOT EXISTS incident_events (
  id UUID PRIMARY KEY,
  incident_id UUID NOT NULL REFERENCES admin_incidents (id) ON DELETE CASCADE,
  event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('CREATED', 'STATUS_CHANGED', 'OWNER_ASSIGNED', 'NOTE_ADDED', 'ALERT_LINKED', 'TELEMETRY_LINKED')),
  previous_status VARCHAR(24),
  new_status VARCHAR(24),
  actor_id UUID REFERENCES users (id) ON DELETE SET NULL,
  actor_email VARCHAR(180) NOT NULL DEFAULT 'system',
  note TEXT NOT NULL DEFAULT '',
  linked_alert_id VARCHAR(80),
  linked_event_ref VARCHAR(160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_events_incident ON incident_events (incident_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_auth_sec_events_type_time ON auth_security_events (event_type, created_at DESC);
