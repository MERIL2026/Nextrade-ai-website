-- Nextrade AI Phase 3 Admin Control Centre Schema (SQLite / node:sqlite)
-- Up Migration: 0003_phase3_admin

PRAGMA foreign_keys = OFF;

-- Expand users.role CHECK constraint to include specialized Phase 3 admin roles cleanly
CREATE TABLE IF NOT EXISTS users_v3 (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'disabled', 'suspended')),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin', 'security_admin', 'ai_admin', 'data_admin', 'support_admin', 'viewer')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

INSERT INTO users_v3 (
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
    WHEN LOWER(role) IN ('user', 'admin', 'super_admin', 'security_admin', 'ai_admin', 'data_admin', 'support_admin', 'viewer') THEN LOWER(role)
    ELSE 'user'
  END,
  created_at,
  updated_at,
  last_login_at
FROM users;

DROP TABLE users;
ALTER TABLE users_v3 RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (account_status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at);

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  admin_id TEXT,
  admin_email TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  previous_value_redacted TEXT,
  new_value_redacted TEXT,
  ip_address TEXT NOT NULL DEFAULT 'unknown',
  user_agent TEXT NOT NULL DEFAULT 'unknown',
  result TEXT NOT NULL DEFAULT 'SUCCESS' CHECK (result IN ('SUCCESS', 'DENIED', 'ERROR')),
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (admin_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin_id ON admin_audit_logs (admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_resource ON admin_audit_logs (resource_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_logs (action, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_role_assignments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  previous_role TEXT NOT NULL,
  assigned_role TEXT NOT NULL,
  assigned_by TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_role_assign_user ON admin_role_assignments (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_incidents (
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

CREATE INDEX IF NOT EXISTS idx_admin_incidents_status ON admin_incidents (status, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'UPDATE' CHECK (category IN ('MAINTENANCE', 'UPDATE', 'SECURITY', 'MARKET_NOTICE')),
  severity TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED')),
  created_by TEXT,
  scheduled_for TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_announcements_status ON admin_announcements (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  is_sensitive INTEGER NOT NULL DEFAULT 0 CHECK (is_sensitive IN (0, 1)),
  description TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS admin_config_audit (
  id TEXT PRIMARY KEY,
  admin_id TEXT,
  config_key TEXT NOT NULL,
  previous_value_redacted TEXT,
  new_value_redacted TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (admin_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_config_audit_key ON admin_config_audit (config_key, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_prompt_versions (
  id TEXT PRIMARY KEY,
  template_key TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  title TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  user_prompt_template TEXT NOT NULL,
  model_target TEXT NOT NULL DEFAULT 'gemini-4-hydrogen',
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  activated_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (template_key, version_number),
  FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_prompts_key ON ai_prompt_versions (template_key, version_number DESC);

CREATE TABLE IF NOT EXISTS ai_request_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  symbol TEXT NOT NULL,
  query_preview TEXT NOT NULL,
  feature TEXT NOT NULL DEFAULT 'workspace_research',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FALLBACK', 'FAILED', 'BLOCKED')),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_logs_created_at ON ai_request_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_status ON ai_request_logs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS api_request_logs (
  id TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  route_path TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  rate_limited INTEGER NOT NULL DEFAULT 0 CHECK (rate_limited IN (0, 1)),
  user_id TEXT,
  ip_address TEXT NOT NULL DEFAULT 'unknown',
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_logs_created_at ON api_request_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_route ON api_request_logs (route_path, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_status ON api_request_logs (status_code, created_at DESC);

CREATE TABLE IF NOT EXISTS background_jobs (
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

CREATE TABLE IF NOT EXISTS background_job_runs (
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

CREATE INDEX IF NOT EXISTS idx_job_runs_job_id ON background_job_runs (job_id, started_at DESC);

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL UNIQUE,
  user_id TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  topic TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH')),
  assigned_admin_id TEXT,
  resolution_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_admin_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets (status, created_at DESC);
