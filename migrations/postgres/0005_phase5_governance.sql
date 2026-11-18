-- Nextrade AI Phase 5 Platform Governance, Privacy, Recovery & Release Schema (PostgreSQL / Supabase)
-- Up Migration: 0005_phase5_governance

CREATE TABLE IF NOT EXISTS user_lifecycle_states (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  lifecycle_state VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (
    lifecycle_state IN (
      'active',
      'suspended',
      'pending_verification',
      'deletion_requested',
      'deletion_scheduled',
      'deleted_anonymized'
    )
  ),
  reason TEXT NOT NULL DEFAULT '',
  deletion_requested_at TIMESTAMPTZ,
  deletion_scheduled_for TIMESTAMPTZ,
  anonymized_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_lifecycle_state ON user_lifecycle_states (lifecycle_state, updated_at DESC);

CREATE TABLE IF NOT EXISTS user_lifecycle_events (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  previous_state VARCHAR(32),
  new_state VARCHAR(32) NOT NULL,
  actor_id UUID REFERENCES users (id) ON DELETE SET NULL,
  actor_email VARCHAR(180) NOT NULL DEFAULT 'system',
  reason TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_events_user ON user_lifecycle_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_admin_notes (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  author_id UUID REFERENCES users (id) ON DELETE SET NULL,
  author_email VARCHAR(180) NOT NULL DEFAULT 'system',
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_admin_notes_user ON user_admin_notes (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS data_export_requests (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  requested_by_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  requested_by_email VARCHAR(180) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'APPROVED', 'PROCESSING', 'READY', 'REJECTED', 'EXPIRED', 'FAILED')
  ),
  format VARCHAR(16) NOT NULL DEFAULT 'json',
  download_token_hash VARCHAR(128),
  expires_at TIMESTAMPTZ,
  artifact_path TEXT,
  artifact_checksum_sha256 VARCHAR(128),
  byte_size INTEGER,
  decision_note TEXT NOT NULL DEFAULT '',
  decided_by UUID REFERENCES users (id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_export_req_user ON data_export_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_req_status ON data_export_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS data_deletion_requests (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  requested_by_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  requested_by_email VARCHAR(180) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (
    status IN ('PENDING_REVIEW', 'SCHEDULED', 'CANCELLED', 'COMPLETED', 'REJECTED')
  ),
  reason TEXT NOT NULL DEFAULT '',
  scheduled_for TIMESTAMPTZ,
  grace_period_ends_at TIMESTAMPTZ,
  decision_note TEXT NOT NULL DEFAULT '',
  decided_by UUID REFERENCES users (id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deletion_req_user ON data_deletion_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deletion_req_status ON data_deletion_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS backup_records (
  id UUID PRIMARY KEY,
  backup_type VARCHAR(40) NOT NULL CHECK (
    backup_type IN ('SQLITE_SNAPSHOT', 'CONFIG_SNAPSHOT', 'FULL_DATABASE_UNAVAILABLE')
  ),
  environment VARCHAR(32) NOT NULL,
  dialect VARCHAR(16) NOT NULL,
  status VARCHAR(24) NOT NULL CHECK (
    status IN ('CREATED', 'VERIFIED', 'FAILED', 'NOT_CONFIGURED', 'SCHEDULED', 'RESTORED')
  ),
  storage_location VARCHAR(120) NOT NULL,
  file_path TEXT,
  checksum_sha256 VARCHAR(128),
  byte_size INTEGER,
  verified_at TIMESTAMPTZ,
  verification_detail TEXT NOT NULL DEFAULT '',
  failure_reason TEXT,
  triggered_by UUID REFERENCES users (id) ON DELETE SET NULL,
  triggered_by_email VARCHAR(180) NOT NULL DEFAULT 'system',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_records_created ON backup_records (created_at DESC);

CREATE TABLE IF NOT EXISTS backup_verification_events (
  id UUID PRIMARY KEY,
  backup_id UUID NOT NULL REFERENCES backup_records (id) ON DELETE CASCADE,
  action VARCHAR(32) NOT NULL CHECK (action IN ('CREATE', 'VERIFY', 'RESTORE_ATTEMPT', 'RESTORE_COMPLETED')),
  status VARCHAR(24) NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'NOT_CONFIGURED')),
  actor_id UUID REFERENCES users (id) ON DELETE SET NULL,
  actor_email VARCHAR(180) NOT NULL DEFAULT 'system',
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_events_backup ON backup_verification_events (backup_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID PRIMARY KEY,
  flag_key VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  environment_scope VARCHAR(24) NOT NULL DEFAULT 'all' CHECK (
    environment_scope IN ('all', 'production', 'development', 'staging')
  ),
  rollout_percentage INTEGER NOT NULL DEFAULT 100 CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
  target_roles_json TEXT NOT NULL DEFAULT '[]',
  is_kill_switch BOOLEAN NOT NULL DEFAULT FALSE,
  client_exposed BOOLEAN NOT NULL DEFAULT FALSE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON feature_flags (flag_key);

CREATE TABLE IF NOT EXISTS feature_flag_history (
  id UUID PRIMARY KEY,
  flag_id UUID NOT NULL REFERENCES feature_flags (id) ON DELETE CASCADE,
  flag_key VARCHAR(80) NOT NULL,
  previous_snapshot_json TEXT,
  new_snapshot_json TEXT NOT NULL,
  actor_id UUID REFERENCES users (id) ON DELETE SET NULL,
  actor_email VARCHAR(180) NOT NULL DEFAULT 'system',
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feature_flag_history_flag ON feature_flag_history (flag_id, created_at DESC);

CREATE TABLE IF NOT EXISTS release_records (
  id UUID PRIMARY KEY,
  version VARCHAR(48) NOT NULL,
  release_type VARCHAR(24) NOT NULL CHECK (release_type IN ('RUNTIME_BASELINE', 'MANUAL', 'CONFIG_ROLLOUT')),
  environment VARCHAR(32) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'ROLLED_BACK', 'SUPERSEDED')),
  summary TEXT NOT NULL,
  commit_ref VARCHAR(120) NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  deployed_by UUID REFERENCES users (id) ON DELETE SET NULL,
  deployed_by_email VARCHAR(180) NOT NULL DEFAULT 'system',
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_release_records_deployed ON release_records (deployed_at DESC);

CREATE TABLE IF NOT EXISTS maintenance_windows (
  id UUID PRIMARY KEY,
  title VARCHAR(140) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  expected_completion_note VARCHAR(240) NOT NULL DEFAULT '',
  bypass_roles_json TEXT NOT NULL DEFAULT '["super_admin","admin"]',
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  created_by_email VARCHAR(180) NOT NULL DEFAULT 'system',
  activated_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_maintenance_windows_status ON maintenance_windows (status, starts_at DESC);
