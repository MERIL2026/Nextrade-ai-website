-- Nextrade AI Phase 4 Platform Intelligence & Observability Rollback (PostgreSQL / Supabase)
-- Down Migration: 0004_phase4_observability

DROP TABLE IF EXISTS incident_events;
DROP TABLE IF EXISTS alert_history;
DROP TABLE IF EXISTS operational_alerts;
DROP TABLE IF EXISTS worker_heartbeats;
DROP TABLE IF EXISTS market_data_health;
DROP TABLE IF EXISTS service_health_checks;

DROP INDEX IF EXISTS idx_auth_sec_events_type_time;

ALTER TABLE background_job_runs DROP COLUMN IF EXISTS wait_ms;
ALTER TABLE background_job_runs DROP COLUMN IF EXISTS queued_at;
ALTER TABLE background_jobs DROP COLUMN IF EXISTS is_paused;

UPDATE admin_incidents
SET status = CASE
  WHEN status IN ('IDENTIFIED', 'MONITORING') THEN 'INVESTIGATING'
  WHEN status IN ('OPEN', 'INVESTIGATING', 'MITIGATED', 'RESOLVED') THEN status
  ELSE 'OPEN'
END;

ALTER TABLE admin_incidents DROP CONSTRAINT IF EXISTS admin_incidents_status_check;
ALTER TABLE admin_incidents ADD CONSTRAINT admin_incidents_status_check CHECK (
  status IN ('OPEN', 'INVESTIGATING', 'MITIGATED', 'RESOLVED')
);
ALTER TABLE admin_incidents DROP COLUMN IF EXISTS linked_event_refs_json;
ALTER TABLE admin_incidents DROP COLUMN IF EXISTS linked_alert_ids_json;
ALTER TABLE admin_incidents DROP COLUMN IF EXISTS owner_email;

DELETE FROM schema_migrations WHERE version = '0004_phase4_observability';
