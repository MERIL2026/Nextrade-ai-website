-- Nextrade AI Phase 1 Identity & Authentication Schema Rollback (SQLite / node:sqlite)
-- Down Migration: 0001_init_auth

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS auth_security_events;
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS email_verification_tokens;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DELETE FROM schema_migrations WHERE version = '0001_init_auth';

PRAGMA foreign_keys = ON;
