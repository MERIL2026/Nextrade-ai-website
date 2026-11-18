-- Nextrade AI Phase 6 Super Admin Operations, Automation & Governance Schema (SQLite / node:sqlite)
-- Down Migration: 0006_phase6_super_ops

DROP INDEX IF EXISTS idx_emergency_events_created;
DROP TABLE IF EXISTS emergency_events;

DROP TABLE IF EXISTS emergency_playbooks;

DROP INDEX IF EXISTS idx_ai_policy_status;
DROP TABLE IF EXISTS ai_policy_versions;

DROP INDEX IF EXISTS idx_emergency_grants_status;
DROP TABLE IF EXISTS emergency_access_grants;

DROP INDEX IF EXISTS idx_priv_action_hist_req;
DROP TABLE IF EXISTS privileged_action_history;

DROP INDEX IF EXISTS idx_priv_requests_status;
DROP TABLE IF EXISTS privileged_action_requests;

DROP INDEX IF EXISTS idx_priv_reviews_status;
DROP INDEX IF EXISTS idx_priv_reviews_user;
DROP TABLE IF EXISTS privileged_access_reviews;

DROP INDEX IF EXISTS idx_automation_events_wf;
DROP TABLE IF EXISTS admin_automation_events;

DROP INDEX IF EXISTS idx_automation_runs_status;
DROP INDEX IF EXISTS idx_automation_runs_workflow;
DROP TABLE IF EXISTS admin_automation_runs;

DROP INDEX IF EXISTS idx_automation_workflows_enabled;
DROP TABLE IF EXISTS admin_automation_workflows;

DELETE FROM schema_migrations WHERE version = '0006_phase6_super_ops';
