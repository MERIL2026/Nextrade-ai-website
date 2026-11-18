-- Nextrade AI Phase 5 Platform Governance, Privacy, Recovery & Release Schema (SQLite / node:sqlite)
-- Up Migration: 0005_phase5_governance

CREATE TABLE IF NOT EXISTS user_lifecycle_states (
  user_id TEXT PRIMARY KEY,
  lifecycle_state TEXT NOT NULL DEFAULT 'active' CHECK (
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
  deletion_requested_at TEXT,
  deletion_scheduled_for TEXT,
  anonymized_at TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_lifecycle_state ON user_lifecycle_states (lifecycle_state, updated_at DESC);

CREATE TABLE IF NOT EXISTS user_lifecycle_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  previous_state TEXT,
  new_state TEXT NOT NULL,
  actor_id TEXT,
  actor_email TEXT NOT NULL DEFAULT 'system',
  reason TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_events_user ON user_lifecycle_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_admin_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  author_id TEXT,
  author_email TEXT NOT NULL DEFAULT 'system',
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_admin_notes_user ON user_admin_notes (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS data_export_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  requested_by_user_id TEXT,
  requested_by_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'APPROVED', 'PROCESSING', 'READY', 'REJECTED', 'EXPIRED', 'FAILED')
  ),
  format TEXT NOT NULL DEFAULT 'json',
  download_token_hash TEXT,
  expires_at TEXT,
  artifact_path TEXT,
  artifact_checksum_sha256 TEXT,
  byte_size INTEGER,
  decision_note TEXT NOT NULL DEFAULT '',
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (decided_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_export_req_user ON data_export_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_req_status ON data_export_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS data_deletion_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  requested_by_user_id TEXT,
  requested_by_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (
    status IN ('PENDING_REVIEW', 'SCHEDULED', 'CANCELLED', 'COMPLETED', 'REJECTED')
  ),
  reason TEXT NOT NULL DEFAULT '',
  scheduled_for TEXT,
  grace_period_ends_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  decided_by TEXT,
  decided_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (decided_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_deletion_req_user ON data_deletion_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deletion_req_status ON data_deletion_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS backup_records (
  id TEXT PRIMARY KEY,
  backup_type TEXT NOT NULL CHECK (
    backup_type IN ('SQLITE_SNAPSHOT', 'CONFIG_SNAPSHOT', 'FULL_DATABASE_UNAVAILABLE')
  ),
  environment TEXT NOT NULL,
  dialect TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('CREATED', 'VERIFIED', 'FAILED', 'NOT_CONFIGURED', 'SCHEDULED', 'RESTORED')
  ),
  storage_location TEXT NOT NULL,
  file_path TEXT,
  checksum_sha256 TEXT,
  byte_size INTEGER,
  verified_at TEXT,
  verification_detail TEXT NOT NULL DEFAULT '',
  failure_reason TEXT,
  triggered_by TEXT,
  triggered_by_email TEXT NOT NULL DEFAULT 'system',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (triggered_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_backup_records_created ON backup_records (created_at DESC);

CREATE TABLE IF NOT EXISTS backup_verification_events (
  id TEXT PRIMARY KEY,
  backup_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('CREATE', 'VERIFY', 'RESTORE_ATTEMPT', 'RESTORE_COMPLETED')),
  status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'NOT_CONFIGURED')),
  actor_id TEXT,
  actor_email TEXT NOT NULL DEFAULT 'system',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (backup_id) REFERENCES backup_records (id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_backup_events_backup ON backup_verification_events (backup_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feature_flags (
  id TEXT PRIMARY KEY,
  flag_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  environment_scope TEXT NOT NULL DEFAULT 'all' CHECK (
    environment_scope IN ('all', 'production', 'development', 'staging')
  ),
  rollout_percentage INTEGER NOT NULL DEFAULT 100 CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
  target_roles_json TEXT NOT NULL DEFAULT '[]',
  is_kill_switch INTEGER NOT NULL DEFAULT 0 CHECK (is_kill_switch IN (0, 1)),
  client_exposed INTEGER NOT NULL DEFAULT 0 CHECK (client_exposed IN (0, 1)),
  starts_at TEXT,
  ends_at TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON feature_flags (flag_key);

CREATE TABLE IF NOT EXISTS feature_flag_history (
  id TEXT PRIMARY KEY,
  flag_id TEXT NOT NULL,
  flag_key TEXT NOT NULL,
  previous_snapshot_json TEXT,
  new_snapshot_json TEXT NOT NULL,
  actor_id TEXT,
  actor_email TEXT NOT NULL DEFAULT 'system',
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (flag_id) REFERENCES feature_flags (id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_feature_flag_history_flag ON feature_flag_history (flag_id, created_at DESC);

CREATE TABLE IF NOT EXISTS release_records (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  release_type TEXT NOT NULL CHECK (release_type IN ('RUNTIME_BASELINE', 'MANUAL', 'CONFIG_ROLLOUT')),
  environment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'ROLLED_BACK', 'SUPERSEDED')),
  summary TEXT NOT NULL,
  commit_ref TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  deployed_by TEXT,
  deployed_by_email TEXT NOT NULL DEFAULT 'system',
  deployed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (deployed_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_release_records_deployed ON release_records (deployed_at DESC);

CREATE TABLE IF NOT EXISTS maintenance_windows (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  expected_completion_note TEXT NOT NULL DEFAULT '',
  bypass_roles_json TEXT NOT NULL DEFAULT '["super_admin","admin"]',
  created_by TEXT,
  created_by_email TEXT NOT NULL DEFAULT 'system',
  activated_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_maintenance_windows_status ON maintenance_windows (status, starts_at DESC);
