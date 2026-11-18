-- Nextrade AI Phase 6 Super Admin Operations, Automation & Governance Schema (SQLite / node:sqlite)
-- Up Migration: 0006_phase6_super_ops

CREATE TABLE IF NOT EXISTS admin_automation_workflows (
  id TEXT PRIMARY KEY,
  workflow_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  trigger_type TEXT NOT NULL CHECK (
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
  action_type TEXT NOT NULL CHECK (
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
  requires_approval INTEGER NOT NULL DEFAULT 0 CHECK (requires_approval IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  is_paused INTEGER NOT NULL DEFAULT 0 CHECK (is_paused IN (0, 1)),
  owner_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  owner_email TEXT NOT NULL DEFAULT 'system',
  last_run_at TEXT,
  next_run_at TEXT,
  last_status TEXT,
  retry_limit INTEGER NOT NULL DEFAULT 1 CHECK (retry_limit >= 0 AND retry_limit <= 5),
  timeout_ms INTEGER NOT NULL DEFAULT 5000 CHECK (timeout_ms >= 500 AND timeout_ms <= 60000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_automation_workflows_enabled ON admin_automation_workflows (enabled, is_paused, updated_at DESC);

CREATE TABLE IF NOT EXISTS admin_automation_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES admin_automation_workflows (id) ON DELETE CASCADE,
  trigger_source TEXT NOT NULL DEFAULT 'manual',
  idempotency_key TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'BLOCKED', 'PENDING_APPROVAL', 'TIMED_OUT')
  ),
  retry_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  triggered_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  triggered_by_email TEXT NOT NULL DEFAULT 'system',
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT,
  UNIQUE (workflow_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_workflow ON admin_automation_runs (workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_status ON admin_automation_runs (status, started_at DESC);

CREATE TABLE IF NOT EXISTS admin_automation_events (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES admin_automation_workflows (id) ON DELETE CASCADE,
  run_id TEXT REFERENCES admin_automation_runs (id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL DEFAULT 'system',
  detail TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_automation_events_wf ON admin_automation_events (workflow_id, created_at DESC);

CREATE TABLE IF NOT EXISTS privileged_access_reviews (
  id TEXT PRIMARY KEY,
  target_user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_email TEXT NOT NULL,
  reviewed_role TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    review_status IN ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED')
  ),
  reviewer_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  reviewer_email TEXT NOT NULL DEFAULT 'system',
  decision_note TEXT NOT NULL DEFAULT '',
  expires_at TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_priv_reviews_user ON privileged_access_reviews (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_priv_reviews_status ON privileged_access_reviews (review_status, created_at DESC);

CREATE TABLE IF NOT EXISTS privileged_action_requests (
  id TEXT PRIMARY KEY,
  action_type TEXT NOT NULL CHECK (
    action_type IN (
      'ROLE_PROMOTION',
      'SECURITY_POLICY_CHANGE',
      'PRODUCTION_RESTORE',
      'AI_POLICY_CRITICAL',
      'AUTOMATION_HIGH_IMPACT',
      'HIGH_IMPACT_OPERATION'
    )
  ),
  target_resource_type TEXT NOT NULL,
  target_resource_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'EXPIRED', 'CANCELLED')
  ),
  requested_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  requested_by_email TEXT NOT NULL,
  assigned_reviewer_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  approved_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  approved_by_email TEXT,
  rejection_reason TEXT NOT NULL DEFAULT '',
  execution_result TEXT,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  executed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_priv_requests_status ON privileged_action_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS privileged_action_history (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES privileged_action_requests (id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL DEFAULT 'system',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_priv_action_hist_req ON privileged_action_history (request_id, created_at ASC);

CREATE TABLE IF NOT EXISTS emergency_access_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  granted_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  granted_by_email TEXT NOT NULL,
  scoped_permissions_json TEXT NOT NULL DEFAULT '[]',
  justification TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (
    status IN ('ACTIVE', 'EXPIRED', 'REVOKED', 'REVIEWED')
  ),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  post_incident_review_note TEXT NOT NULL DEFAULT '',
  reviewed_by_email TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_emergency_grants_status ON emergency_access_grants (status, expires_at DESC);

CREATE TABLE IF NOT EXISTS ai_policy_versions (
  id TEXT PRIMARY KEY,
  version_number INTEGER NOT NULL UNIQUE CHECK (version_number > 0),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  allowed_models_json TEXT NOT NULL DEFAULT '[]',
  default_model TEXT NOT NULL,
  fallback_model TEXT NOT NULL DEFAULT 'illustrative-fallback',
  fallback_enabled INTEGER NOT NULL DEFAULT 1 CHECK (fallback_enabled IN (0, 1)),
  provider_priority_json TEXT NOT NULL DEFAULT '["gemini","illustrative-fallback"]',
  rate_limit_per_min INTEGER NOT NULL DEFAULT 25 CHECK (rate_limit_per_min >= 1 AND rate_limit_per_min <= 500),
  max_input_chars INTEGER NOT NULL DEFAULT 1000 CHECK (max_input_chars >= 100 AND max_input_chars <= 4000),
  max_output_tokens INTEGER NOT NULL DEFAULT 1400 CHECK (max_output_tokens >= 200 AND max_output_tokens <= 8192),
  timeout_ms INTEGER NOT NULL DEFAULT 18000 CHECK (timeout_ms >= 2000 AND timeout_ms <= 60000),
  safety_mode TEXT NOT NULL DEFAULT 'STRICT' CHECK (safety_mode IN ('STRICT', 'STANDARD')),
  redact_sensitive_inputs INTEGER NOT NULL DEFAULT 1 CHECK (redact_sensitive_inputs IN (0, 1)),
  block_prompt_injection INTEGER NOT NULL DEFAULT 1 CHECK (block_prompt_injection IN (0, 1)),
  disabled_capabilities_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_by_email TEXT NOT NULL DEFAULT 'system',
  activated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_policy_status ON ai_policy_versions (status, version_number DESC);

CREATE TABLE IF NOT EXISTS emergency_playbooks (
  id TEXT PRIMARY KEY,
  playbook_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  trigger_conditions TEXT NOT NULL,
  investigation_steps_json TEXT NOT NULL DEFAULT '[]',
  safe_actions_json TEXT NOT NULL DEFAULT '[]',
  escalation_requirements TEXT NOT NULL DEFAULT '',
  recovery_validation TEXT NOT NULL DEFAULT '',
  resolution_criteria TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS emergency_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  playbook_key TEXT,
  related_incident_id TEXT,
  action_taken TEXT NOT NULL DEFAULT '',
  actor_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL DEFAULT 'system',
  rollback_hint TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_emergency_events_created ON emergency_events (created_at DESC);
