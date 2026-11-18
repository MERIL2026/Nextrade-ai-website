-- Nextrade AI Phase 3 Admin Control Centre Schema (PostgreSQL / Supabase)
-- Up Migration: 0003_phase3_admin

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN ('user', 'admin', 'super_admin', 'security_admin', 'ai_admin', 'data_admin', 'support_admin', 'viewer')
);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id UUID PRIMARY KEY,
  admin_id UUID REFERENCES users (id) ON DELETE SET NULL,
  admin_email VARCHAR(180) NOT NULL DEFAULT 'system',
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(64) NOT NULL,
  resource_id VARCHAR(120),
  previous_value_redacted TEXT,
  new_value_redacted TEXT,
  ip_address VARCHAR(64) NOT NULL DEFAULT 'unknown',
  user_agent VARCHAR(240) NOT NULL DEFAULT 'unknown',
  result VARCHAR(16) NOT NULL DEFAULT 'SUCCESS' CHECK (result IN ('SUCCESS', 'DENIED', 'ERROR')),
  correlation_id VARCHAR(80) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin_id ON admin_audit_logs (admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_resource ON admin_audit_logs (resource_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_logs (action, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_role_assignments (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  previous_role VARCHAR(32) NOT NULL,
  assigned_role VARCHAR(32) NOT NULL,
  assigned_by UUID REFERENCES users (id) ON DELETE SET NULL,
  reason VARCHAR(300) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_role_assign_user ON admin_role_assignments (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_incidents (
  id UUID PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'INVESTIGATING', 'MITIGATED', 'RESOLVED')),
  source VARCHAR(64) NOT NULL DEFAULT 'manual',
  assigned_admin_id UUID REFERENCES users (id) ON DELETE SET NULL,
  resolution_notes TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_admin_incidents_status ON admin_incidents (status, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_announcements (
  id UUID PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  content TEXT NOT NULL,
  category VARCHAR(32) NOT NULL DEFAULT 'UPDATE' CHECK (category IN ('MAINTENANCE', 'UPDATE', 'SECURITY', 'MARKET_NOTICE')),
  severity VARCHAR(16) NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED')),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  scheduled_for TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_announcements_status ON admin_announcements (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key VARCHAR(80) PRIMARY KEY,
  value_json TEXT NOT NULL,
  category VARCHAR(48) NOT NULL DEFAULT 'general',
  is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  description VARCHAR(240) NOT NULL DEFAULT '',
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_config_audit (
  id UUID PRIMARY KEY,
  admin_id UUID REFERENCES users (id) ON DELETE SET NULL,
  config_key VARCHAR(80) NOT NULL,
  previous_value_redacted TEXT,
  new_value_redacted TEXT,
  reason VARCHAR(300) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_config_audit_key ON admin_config_audit (config_key, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_prompt_versions (
  id UUID PRIMARY KEY,
  template_key VARCHAR(64) NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  title VARCHAR(120) NOT NULL,
  system_prompt TEXT NOT NULL,
  user_prompt_template TEXT NOT NULL,
  model_target VARCHAR(64) NOT NULL DEFAULT 'gemini-4-hydrogen',
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  notes VARCHAR(400) NOT NULL DEFAULT '',
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_key, version_number)
);

CREATE INDEX IF NOT EXISTS idx_ai_prompts_key ON ai_prompt_versions (template_key, version_number DESC);

CREATE TABLE IF NOT EXISTS ai_request_logs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  symbol VARCHAR(24) NOT NULL,
  query_preview VARCHAR(200) NOT NULL,
  feature VARCHAR(40) NOT NULL DEFAULT 'workspace_research',
  provider VARCHAR(32) NOT NULL,
  model VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('SUCCESS', 'FALLBACK', 'FAILED', 'BLOCKED')),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  error_message VARCHAR(400),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_logs_created_at ON ai_request_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_status ON ai_request_logs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS api_request_logs (
  id UUID PRIMARY KEY,
  method VARCHAR(12) NOT NULL,
  route_path VARCHAR(160) NOT NULL,
  status_code INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  rate_limited BOOLEAN NOT NULL DEFAULT FALSE,
  user_id UUID,
  ip_address VARCHAR(64) NOT NULL DEFAULT 'unknown',
  error_code VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_logs_created_at ON api_request_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_route ON api_request_logs (route_path, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_status ON api_request_logs (status_code, created_at DESC);

CREATE TABLE IF NOT EXISTS background_jobs (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  job_type VARCHAR(48) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'IDLE' CHECK (status IN ('IDLE', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  schedule_label VARCHAR(80) NOT NULL DEFAULT 'Manual / Interval',
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_duration_ms INTEGER,
  last_error VARCHAR(400),
  retry_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS background_job_runs (
  id UUID PRIMARY KEY,
  job_id VARCHAR(64) NOT NULL REFERENCES background_jobs (id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  triggered_by UUID REFERENCES users (id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  summary VARCHAR(400) NOT NULL DEFAULT '',
  error_message VARCHAR(400)
);

CREATE INDEX IF NOT EXISTS idx_job_runs_job_id ON background_job_runs (job_id, started_at DESC);

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY,
  ticket_id VARCHAR(48) NOT NULL UNIQUE,
  user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(180) NOT NULL,
  topic VARCHAR(80) NOT NULL,
  reference VARCHAR(240) NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  priority VARCHAR(16) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH')),
  assigned_admin_id UUID REFERENCES users (id) ON DELETE SET NULL,
  resolution_notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets (status, created_at DESC);
