-- Nextrade AI Phase 4 Platform Intelligence & Observability Schema (SQLite / node:sqlite)
-- Up Migration: 0004_phase4_observability

PRAGMA foreign_keys = OFF;

-- Expand admin_incidents workflow states + linked alerts/telemetry metadata without losing Phase 3 rows
CREATE TABLE IF NOT EXISTS admin_incidents_v4 (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'MITIGATED', 'RESOLVED')),
  source TEXT NOT NULL DEFAULT 'manual',
  assigned_admin_id TEXT,
  owner_email TEXT NOT NULL DEFAULT '',
  linked_alert_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_event_refs_json TEXT NOT NULL DEFAULT '[]',
  resolution_notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (assigned_admin_id) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
);

INSERT INTO admin_incidents_v4 (
  id, title, description, severity, status, source, assigned_admin_id, owner_email,
  linked_alert_ids_json, linked_event_refs_json, resolution_notes, created_by, created_at, updated_at, resolved_at
)
SELECT
  id, title, description, severity, status, source, assigned_admin_id, '',
  '[]', '[]', resolution_notes, created_by, created_at, updated_at, resolved_at
FROM admin_incidents;

DROP TABLE admin_incidents;
ALTER TABLE admin_incidents_v4 RENAME TO admin_incidents;

CREATE INDEX IF NOT EXISTS idx_admin_incidents_status ON admin_incidents (status, created_at DESC);

PRAGMA foreign_keys = ON;

ALTER TABLE background_jobs ADD COLUMN is_paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE background_job_runs ADD COLUMN queued_at TEXT;
ALTER TABLE background_job_runs ADD COLUMN wait_ms INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS service_health_checks (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('HEALTHY', 'DEGRADED', 'NOT_CONFIGURED', 'UNAVAILABLE')),
  latency_ms INTEGER,
  detail TEXT NOT NULL DEFAULT '',
  checked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_service_health_checked_at ON service_health_checks (checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_health_service_id ON service_health_checks (service_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS market_data_health (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'NOT_CONFIGURED')),
  classification TEXT NOT NULL CHECK (classification IN ('LIVE', 'DELAYED', 'SIMULATED', 'CACHE', 'UNAVAILABLE')),
  symbols_processed INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  validation_failures INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  detail TEXT NOT NULL DEFAULT '',
  checked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_health_checked_at ON market_data_health (checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_health_provider ON market_data_health (provider_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'HEALTHY' CHECK (status IN ('HEALTHY', 'PAUSED', 'DEGRADED', 'STOPPED')),
  queue_paused INTEGER NOT NULL DEFAULT 0 CHECK (queue_paused IN (0, 1)),
  active_job_id TEXT,
  processed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operational_alerts (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('API', 'AI', 'SECURITY', 'MARKET_DATA', 'BACKGROUND_JOB', 'SYSTEM')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPPRESSED')),
  source TEXT NOT NULL DEFAULT 'threshold_engine',
  service_id TEXT,
  metric_value REAL,
  threshold_value REAL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  event_refs_json TEXT NOT NULL DEFAULT '[]',
  internal_notes TEXT NOT NULL DEFAULT '',
  acknowledged_by TEXT,
  resolved_by TEXT,
  first_detected_at TEXT NOT NULL,
  last_detected_at TEXT NOT NULL,
  cooldown_until TEXT,
  resolved_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (acknowledged_by) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (resolved_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_status_severity ON operational_alerts (status, severity, last_detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_category ON operational_alerts (category, last_detected_at DESC);

CREATE TABLE IF NOT EXISTS alert_history (
  id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  actor_id TEXT,
  actor_email TEXT NOT NULL DEFAULT 'system',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (alert_id) REFERENCES operational_alerts (id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_history_alert_id ON alert_history (alert_id, created_at DESC);

CREATE TABLE IF NOT EXISTS incident_events (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('CREATED', 'STATUS_CHANGED', 'OWNER_ASSIGNED', 'NOTE_ADDED', 'ALERT_LINKED', 'TELEMETRY_LINKED')),
  previous_status TEXT,
  new_status TEXT,
  actor_id TEXT,
  actor_email TEXT NOT NULL DEFAULT 'system',
  note TEXT NOT NULL DEFAULT '',
  linked_alert_id TEXT,
  linked_event_ref TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (incident_id) REFERENCES admin_incidents (id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_incident_events_incident ON incident_events (incident_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_auth_sec_events_type_time ON auth_security_events (event_type, created_at DESC);
