-- Nextrade AI Phase 4 Platform Intelligence & Observability Rollback (SQLite / node:sqlite)
-- Down Migration: 0004_phase4_observability

DROP TABLE IF EXISTS incident_events;
DROP TABLE IF EXISTS alert_history;
DROP TABLE IF EXISTS operational_alerts;
DROP TABLE IF EXISTS worker_heartbeats;
DROP TABLE IF EXISTS market_data_health;
DROP TABLE IF EXISTS service_health_checks;

DROP INDEX IF EXISTS idx_auth_sec_events_type_time;

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS admin_incidents_v3_rb (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'INVESTIGATING', 'MITIGATED', 'RESOLVED')),
  source TEXT NOT NULL DEFAULT 'manual',
  assigned_admin_id TEXT,
  resolution_notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (assigned_admin_id) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
);

INSERT INTO admin_incidents_v3_rb (
  id, title, description, severity, status, source, assigned_admin_id, resolution_notes, created_by, created_at, updated_at, resolved_at
)
SELECT
  id,
  title,
  description,
  severity,
  CASE
    WHEN status IN ('IDENTIFIED', 'MONITORING') THEN 'INVESTIGATING'
    WHEN status IN ('OPEN', 'INVESTIGATING', 'MITIGATED', 'RESOLVED') THEN status
    ELSE 'OPEN'
  END,
  source,
  assigned_admin_id,
  resolution_notes,
  created_by,
  created_at,
  updated_at,
  resolved_at
FROM admin_incidents;

DROP TABLE admin_incidents;
ALTER TABLE admin_incidents_v3_rb RENAME TO admin_incidents;
CREATE INDEX IF NOT EXISTS idx_admin_incidents_status ON admin_incidents (status, created_at DESC);

CREATE TABLE IF NOT EXISTS background_jobs_v3_rb (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'IDLE' CHECK (status IN ('IDLE', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  schedule_label TEXT NOT NULL DEFAULT 'Manual / Interval',
  last_run_at TEXT,
  next_run_at TEXT,
  last_duration_ms INTEGER,
  last_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT INTO background_jobs_v3_rb (
  id, name, job_type, status, schedule_label, last_run_at, next_run_at, last_duration_ms, last_error, retry_count, updated_at
)
SELECT
  id, name, job_type, status, schedule_label, last_run_at, next_run_at, last_duration_ms, last_error, retry_count, updated_at
FROM background_jobs;

DROP TABLE background_jobs;
ALTER TABLE background_jobs_v3_rb RENAME TO background_jobs;

CREATE TABLE IF NOT EXISTS background_job_runs_v3_rb (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  triggered_by TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  summary TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  FOREIGN KEY (job_id) REFERENCES background_jobs (id) ON DELETE CASCADE,
  FOREIGN KEY (triggered_by) REFERENCES users (id) ON DELETE SET NULL
);

INSERT INTO background_job_runs_v3_rb (
  id, job_id, status, triggered_by, started_at, finished_at, duration_ms, summary, error_message
)
SELECT
  id, job_id, status, triggered_by, started_at, finished_at, duration_ms, summary, error_message
FROM background_job_runs;

DROP TABLE background_job_runs;
ALTER TABLE background_job_runs_v3_rb RENAME TO background_job_runs;
CREATE INDEX IF NOT EXISTS idx_job_runs_job_id ON background_job_runs (job_id, started_at DESC);

PRAGMA foreign_keys = ON;

DELETE FROM schema_migrations WHERE version = '0004_phase4_observability';
