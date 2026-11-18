-- Nextrade AI Phase 6 Super Admin Operations, Automation & Governance Schema (PostgreSQL / Supabase)
-- Up Migration: 0006_phase6_super_ops

CREATE TABLE IF NOT EXISTS admin_automation_workflows (
  id UUID PRIMARY KEY,
  workflow_key VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(140) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  trigger_type VARCHAR(32) NOT NULL CHECK (
    trigger_type IN (
      'SCHEDULED',
      'OPERATIONAL_EVENT',
      'ALERT_THRESHOLD',
      'JOB_FAILURE',
      'SECURITY_EVENT',
      'MANUAL'
    )
  ),
  trigger_config_json TEXT NOT NULL DEFAULT '{}',
  conditions_json TEXT NOT NULL DEFAULT '{}',
  action_type VARCHAR(48) NOT NULL CHECK (
    action_type IN (
      'CREATE_ALERT',
      'ACKNOWLEDGE_ELIGIBLE_ALERT',
      'CREATE_INCIDENT',
      'ADD_INCIDENT_EVENT',
      'PAUSE_WORKER_QUEUE',
      'RESUME_WORKER_QUEUE',
      'DISABLE_FEATURE_FLAG',
      'GENERATE_GOVERNANCE_REMINDER',
      'RECORD_OPERATIONAL_EVENT'
    )
  ),
  action_config_json TEXT NOT NULL DEFAULT '{}',
  schedule_interval_minutes INTEGER,
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_paused BOOLEAN NOT NULL DEFAULT FALSE,
  owner_id UUID REFERENCES users (id) ON DELETE SET NULL,
  owner_email VARCHAR(180) NOT NULL DEFAULT 'system',
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_status VARCHAR(24),
  retry_limit INTEGER NOT NULL DEFAULT 1 CHECK (retry_limit >= 0 AND retry_limit <= 5),
  timeout_ms INTEGER NOT NULL DEFAULT 5000 CHECK (timeout_ms >= 500 AND timeout_ms <= 60000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_workflows_enabled ON admin_automation_workflows (enabled, is_paused, updated_at DESC);

CREATE TABLE IF NOT EXISTS admin_automation_runs (
  id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES admin_automation_workflows (id) ON DELETE CASCADE,
  trigger_source VARCHAR(32) NOT NULL DEFAULT 'manual',
  idempotency_key VARCHAR(120),
  status VARCHAR(24) NOT NULL CHECK (
    status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'BLOCKED', 'PENDING_APPROVAL', 'TIMED_OUT')
  ),
  retry_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  triggered_by UUID REFERENCES users (id) ON DELETE SET NULL,
  triggered_by_email VARCHAR(180) NOT NULL DEFAULT 'system',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  UNIQUE (workflow_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_workflow ON admin_automation_runs (workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_status ON admin_automation_runs (status, started_at DESC);

CREATE TABLE IF NOT EXISTS admin_automation_events (
  id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES admin_automation_workflows (id) ON DELETE CASCADE,
  run_id UUID REFERENCES admin_automation_runs (id) ON DELETE SET NULL,
  event_type VARCHAR(48) NOT NULL,
  actor_id UUID REFERENCES users (id) ON DELETE SET NULL,
  actor_email VARCHAR(180) NOT NULL DEFAULT 'system',
  detail TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_events_wf ON admin_automation_events (workflow_id, created_at DESC);

CREATE TABLE IF NOT EXISTS privileged_access_reviews (
  id UUID PRIMARY KEY,
  target_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_email VARCHAR(180) NOT NULL,
  reviewed_role VARCHAR(32) NOT NULL,
  review_status VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK (
    review_status IN ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED')
  ),
  reviewer_id UUID REFERENCES users (id) ON DELETE SET NULL,
  reviewer_email VARCHAR(180) NOT NULL DEFAULT 'system',
  decision_note TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_priv_reviews_user ON privileged_access_reviews (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_priv_reviews_status ON privileged_access_reviews (review_status, created_at DESC);

CREATE TABLE IF NOT EXISTS privileged_action_requests (
  id UUID PRIMARY KEY,
  action_type VARCHAR(48) NOT NULL CHECK (
    action_type IN (
      'ROLE_PROMOTION',
      'SECURITY_POLICY_CHANGE',
      'PRODUCTION_RESTORE',
      'AI_POLICY_CRITICAL',
      'AUTOMATION_HIGH_IMPACT',
      'HIGH_IMPACT_OPERATION'
    )
  ),
  target_resource_type VARCHAR(64) NOT NULL,
  target_resource_id VARCHAR(120) NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'EXPIRED', 'CANCELLED')
  ),
  requested_by UUID REFERENCES users (id) ON DELETE SET NULL,
  requested_by_email VARCHAR(180) NOT NULL,
  assigned_reviewer_id UUID REFERENCES users (id) ON DELETE SET NULL,
  approved_by UUID REFERENCES users (id) ON DELETE SET NULL,
  approved_by_email VARCHAR(180),
  rejection_reason TEXT NOT NULL DEFAULT '',
  execution_result TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_priv_requests_status ON privileged_action_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS privileged_action_history (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES privileged_action_requests (id) ON DELETE CASCADE,
  event_type VARCHAR(48) NOT NULL,
  actor_id UUID REFERENCES users (id) ON DELETE SET NULL,
  actor_email VARCHAR(180) NOT NULL DEFAULT 'system',
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_priv_action_hist_req ON privileged_action_history (request_id, created_at ASC);

CREATE TABLE IF NOT EXISTS emergency_access_grants (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_email VARCHAR(180) NOT NULL,
  granted_by UUID REFERENCES users (id) ON DELETE SET NULL,
  granted_by_email VARCHAR(180) NOT NULL,
  scoped_permissions_json TEXT NOT NULL DEFAULT '[]',
  justification TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (
    status IN ('ACTIVE', 'EXPIRED', 'REVOKED', 'REVIEWED')
  ),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  post_incident_review_note TEXT NOT NULL DEFAULT '',
  reviewed_by_email VARCHAR(180),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emergency_grants_status ON emergency_access_grants (status, expires_at DESC);

CREATE TABLE IF NOT EXISTS ai_policy_versions (
  id UUID PRIMARY KEY,
  version_number INTEGER NOT NULL UNIQUE CHECK (version_number > 0),
  name VARCHAR(120) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  allowed_models_json TEXT NOT NULL DEFAULT '[]',
  default_model VARCHAR(64) NOT NULL,
  fallback_model VARCHAR(64) NOT NULL DEFAULT 'illustrative-fallback',
  fallback_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  provider_priority_json TEXT NOT NULL DEFAULT '["gemini","illustrative-fallback"]',
  rate_limit_per_min INTEGER NOT NULL DEFAULT 25 CHECK (rate_limit_per_min >= 1 AND rate_limit_per_min <= 500),
  max_input_chars INTEGER NOT NULL DEFAULT 1000 CHECK (max_input_chars >= 100 AND max_input_chars <= 4000),
  max_output_tokens INTEGER NOT NULL DEFAULT 1400 CHECK (max_output_tokens >= 200 AND max_output_tokens <= 8192),
  timeout_ms INTEGER NOT NULL DEFAULT 18000 CHECK (timeout_ms >= 2000 AND timeout_ms <= 60000),
  safety_mode VARCHAR(24) NOT NULL DEFAULT 'STRICT' CHECK (safety_mode IN ('STRICT', 'STANDARD')),
  redact_sensitive_inputs BOOLEAN NOT NULL DEFAULT TRUE,
  block_prompt_injection BOOLEAN NOT NULL DEFAULT TRUE,
  disabled_capabilities_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  created_by_email VARCHAR(180) NOT NULL DEFAULT 'system',
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_policy_status ON ai_policy_versions (status, version_number DESC);

CREATE TABLE IF NOT EXISTS emergency_playbooks (
  id UUID PRIMARY KEY,
  playbook_key VARCHAR(64) NOT NULL UNIQUE,
  title VARCHAR(140) NOT NULL,
  category VARCHAR(48) NOT NULL,
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  trigger_conditions TEXT NOT NULL,
  investigation_steps_json TEXT NOT NULL DEFAULT '[]',
  safe_actions_json TEXT NOT NULL DEFAULT '[]',
  escalation_requirements TEXT NOT NULL DEFAULT '',
  recovery_validation TEXT NOT NULL DEFAULT '',
  resolution_criteria TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS emergency_events (
  id UUID PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  title VARCHAR(160) NOT NULL,
  summary TEXT NOT NULL,
  playbook_key VARCHAR(64),
  related_incident_id VARCHAR(80),
  action_taken TEXT NOT NULL DEFAULT '',
  actor_id UUID REFERENCES users (id) ON DELETE SET NULL,
  actor_email VARCHAR(180) NOT NULL DEFAULT 'system',
  rollback_hint TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emergency_events_created ON emergency_events (created_at DESC);
