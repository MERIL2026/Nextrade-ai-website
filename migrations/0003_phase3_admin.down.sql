-- Nextrade AI Phase 3 Admin Control Centre Rollback (SQLite / node:sqlite)
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

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS users_v2_rb (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'disabled', 'suspended')),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

INSERT INTO users_v2_rb (
  id, full_name, email, password_hash, email_verified, account_status, role, created_at, updated_at, last_login_at
)
SELECT
  id,
  full_name,
  email,
  password_hash,
  email_verified,
  account_status,
  CASE
    WHEN LOWER(role) IN ('user', 'admin', 'super_admin') THEN LOWER(role)
    WHEN LOWER(role) IN ('security_admin', 'ai_admin', 'data_admin', 'support_admin') THEN 'admin'
    ELSE 'user'
  END,
  created_at,
  updated_at,
  last_login_at
FROM users;

DROP TABLE users;
ALTER TABLE users_v2_rb RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (account_status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

PRAGMA foreign_keys = ON;

DELETE FROM schema_migrations WHERE version = '0003_phase3_admin';
