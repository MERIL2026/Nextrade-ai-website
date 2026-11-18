-- Nextrade AI Phase 5 Platform Governance Schema (PostgreSQL / Supabase)
-- Down Migration: 0005_phase5_governance

DROP INDEX IF EXISTS idx_maintenance_windows_status;
DROP TABLE IF EXISTS maintenance_windows;

DROP INDEX IF EXISTS idx_release_records_deployed;
DROP TABLE IF EXISTS release_records;

DROP INDEX IF EXISTS idx_feature_flag_history_flag;
DROP TABLE IF EXISTS feature_flag_history;

DROP INDEX IF EXISTS idx_feature_flags_key;
DROP TABLE IF EXISTS feature_flags;

DROP INDEX IF EXISTS idx_backup_events_backup;
DROP TABLE IF EXISTS backup_verification_events;

DROP INDEX IF EXISTS idx_backup_records_created;
DROP TABLE IF EXISTS backup_records;

DROP INDEX IF EXISTS idx_deletion_req_status;
DROP INDEX IF EXISTS idx_deletion_req_user;
DROP TABLE IF EXISTS data_deletion_requests;

DROP INDEX IF EXISTS idx_export_req_status;
DROP INDEX IF EXISTS idx_export_req_user;
DROP TABLE IF EXISTS data_export_requests;

DROP INDEX IF EXISTS idx_user_admin_notes_user;
DROP TABLE IF EXISTS user_admin_notes;

DROP INDEX IF EXISTS idx_lifecycle_events_user;
DROP TABLE IF EXISTS user_lifecycle_events;

DROP INDEX IF EXISTS idx_user_lifecycle_state;
DROP TABLE IF EXISTS user_lifecycle_states;

DELETE FROM schema_migrations WHERE version = '0005_phase5_governance';
