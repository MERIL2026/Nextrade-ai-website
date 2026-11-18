-- Nextrade AI Phase 3 Admin Control Centre Rollback (PostgreSQL / Supabase)
-- Down Migration: 0003_phase3_admin

DROP TABLE IF EXISTS support_tickets;
DROP TABLE IF EXISTS background_job_runs;
DROP TABLE IF EXISTS background_jobs;
DROP TABLE IF EXISTS api_request_logs;
DROP TABLE IF EXISTS ai_request_logs;
DROP TABLE IF EXISTS ai_prompt_versions;
DROP TABLE IF EXISTS admin_config_audit;
DROP TABLE IF EXISTS platform_settings;
DROP TABLE IF EXISTS admin_announcements;
DROP TABLE IF EXISTS admin_incidents;
DROP TABLE IF EXISTS admin_role_assignments;
DROP TABLE IF EXISTS admin_audit_logs;

UPDATE users
SET role = CASE
  WHEN role IN ('user', 'admin', 'super_admin') THEN role
  WHEN role IN ('security_admin', 'ai_admin', 'data_admin', 'support_admin') THEN 'admin'
  ELSE 'user'
END;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin', 'super_admin'));

DELETE FROM schema_migrations WHERE version = '0003_phase3_admin';
