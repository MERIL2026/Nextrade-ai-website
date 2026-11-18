# Nextrade AI — Phase 5 Pre-Implementation Audit

**Audit Date:** 2026-11-16  
**Scope:** Platform Governance, Reliability & Lifecycle Management inside existing `/admin/*` Admin Control Centre & `/app/*` User Privacy Controls  
**Verification Basis:** Direct inspection of source tree, migrations (`0001`–`0004`), runtime dependencies, and host environment capabilities.

---

## 1. Existing Repository Architecture

Nextrade AI is a unified TypeScript full-stack application served by Express + Vite (`server.ts`) on port `3000`:

- **Entry & Security Perimeter (`server.ts`)**:
  - Per-request CSP nonces (strict nonce script-src in production; dev Vite allowances locally), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `32 KB` JSON body limit.
  - Telemetry middleware (`src/admin/telemetry.ts`) buffers API request metrics (excluding auth headers, query secrets, passwords, tokens) into `api_request_logs`.
  - Maintenance gate middleware (`maintenanceGate` in `server.ts`) currently reads `platform_settings['maintenance_mode']` and returns `503 MAINTENANCE_MODE` on `/api/workspace/*`, `/api/markets`, `/api/contact`, `/api/research`, leaving `/api/auth/*`, `/api/admin/*`, and `/api/health` reachable.
- **Authentication & Authorization (`src/auth/*`)**:
  - Argon2id password hashing + SHA-256 hashed opaque session tokens in `HttpOnly`, `SameSite=Lax` cookies (`nextrade_session`).
  - CSRF same-origin enforcement on mutations (`isSameOriginMutation`).
  - 8 RBAC roles (`user`, `viewer`, `support_admin`, `data_admin`, `ai_admin`, `security_admin`, `admin`, `super_admin`) defined in `src/auth/rbacShared.ts` and enforced via `src/auth/rbacMiddleware.ts`.
  - Administrator re-authentication (`enforceReauth` in `src/admin/router.ts`) returns `428 REAUTH_REQUIRED` / `403 REAUTH_FAILED`.
- **Workspace Domain (`src/workspace/*`)**:
  - Strict `user_id` ownership isolation across `portfolios`, `portfolio_holdings`, `watchlists`, `watchlist_items`, `paper_trading_accounts`, `paper_orders`, `paper_transactions`, `ai_research_history`, `saved_reports`, and `user_preferences`.
- **Admin Control Centre & Phase 4 Observability (`src/admin/*`, `src/components/admin/*`)**:
  - Modular backend services (`src/admin/service.ts`, `src/admin/observabilityService.ts`, `src/admin/runtimeSettings.ts`, `src/admin/telemetry.ts`).
  - 15+ admin views in `src/components/admin/AdminConsoleApp.tsx` backed by `src/lib/adminApi.ts` and graphite-slate/white UI kit in `AdminLayout.tsx`.

---

## 2. Authoritative Database Source of Truth & Migration Conventions

- **Runtime Database (`src/auth/db.ts`)**:
  - **Authoritative production/dev database:** **Supabase PostgreSQL** via `postgres` driver (`pgbouncer=true` transaction pooler on port `6543`, `prepare: false`, `max_pipeline: 1`) when `DATABASE_URL` or `SUPABASE_DB_URL` is set. Live database preserves all existing user accounts and historical telemetry.
  - **Automated test & offline fallback database:** **`node:sqlite`** (`DatabaseSync`) with WAL mode and foreign keys enabled (`:memory:` or `AUTH_DB_PATH`).
- **Migration Convention**:
  - Every schema evolution is paired verbatim across:
    - `migrations/NNNN_name.sql` + `migrations/NNNN_name.down.sql` (SQLite)
    - `migrations/postgres/NNNN_name.sql` + `migrations/postgres/NNNN_name.down.sql` (PostgreSQL)
  - Registered sequentially in `ORDERED_MIGRATIONS` inside `src/auth/db.ts` (currently `0001_init_auth` through `0004_phase4_observability`).
  - Verified stepwise rollback parity in `src/auth/auth.test.ts` (`0004` -> `0001` cleanly drops all migration objects and re-applies cleanly).
  - Phase 5 will introduce `0005_phase5_governance` using this exact paired pattern without altering or rebuilding existing `users` foreign-key graphs unnecessarily.

---

## 3. Existing Governance, Privacy & Backup/Recovery Inventory

### Existing Governance Capabilities
- Basic user suspend (`account_status = 'suspended'`), restore (`'active'`), immediate delete (`DELETE FROM users` requiring `super_admin` + password re-auth + exact email confirmation), and single/all session revocation.
- Last active `super_admin` protection on suspend, delete, and role demotion (`countActiveSuperAdmins()`).
- Append-only `admin_audit_logs` (blocking HTTP `PUT`/`PATCH`/`DELETE` with `405`) and `admin_config_audit` with JSON rollback on 6 existing `platform_settings` keys.
- Simple binary `maintenance_mode` toggle (`enabled`, `message`, `allowAdminRecovery`) and basic `feature_flags` JSON blob (`aiResearchEnabled`, `paperTradingEnabled`, `publicRegistrationEnabled`, `announcementsBannerEnabled`).
- CSV export endpoints for `/api/admin/users/export` and `/api/admin/audit-logs/export` with formula-injection escaping (`csvEscape`).

### Existing Privacy Capabilities
- Authenticated users can edit `fullName` (`PATCH /api/auth/account`), view/revoke active sessions (`GET/DELETE /api/auth/sessions`), and view public `/privacy` & `/cookies` legal pages.
- **No self-service personal data export**, **no export expiry/download tokens**, **no user-initiated deletion request or grace-period cancellation**, **no privacy activity log**, and **no admin privacy request triage queue**.

### Existing Backup & Recovery Capabilities
- Host environment inspection (`which pg_dump`, `.env` key check, filesystem check):
  - `pg_dump` binary is **not installed** in the container.
  - No `SUPABASE_ACCESS_TOKEN` or external encrypted object storage backup bucket is configured in `.env`.
  - No backup history table, checksum verification pipeline, or recovery workflow exists in the codebase.
- Therefore:
  - In **Supabase PostgreSQL runtime**, automated full physical snapshot creation and automated remote restore **cannot be executed directly** by Node.js and must be reported honestly as `NOT_CONFIGURED` / `UNAVAILABLE` (with Supabase Managed Backups / PITR documented operationally).
  - In **SQLite runtime** (`file`-backed `AUTH_DB_PATH`), consistent atomic local snapshot backups (`VACUUM INTO`), SHA-256 checksums, `PRAGMA integrity_check` verification, and verified file restoration **can** execute genuinely.
  - Across **both** PostgreSQL and SQLite runtimes, application-level **Governance & Configuration Snapshots** (settings, feature flags, prompts, alert thresholds — strictly excluding credentials/secrets) can be generated, checksummed with SHA-256, verified, and inspected honestly as configuration snapshots (explicitly distinguished from full database backups).

---

## 4. Missing Phase 5 Functionality

1. **User & Organization Lifecycle Management**:
   - Extended lifecycle state model (`active`, `suspended`, `pending_verification`, `deletion_requested`, `deletion_scheduled`, `deleted_anonymized`), scheduled deletion workflow with grace period & cancellation, administrative internal notes, immutable lifecycle event timeline, and self-service vs admin-initiated deletion safeguards.
2. **Data Governance & Privacy Centre**:
   - User-facing `/app/account` privacy controls (request data export, download JSON bundle via expiring token + ownership check, request/cancel account deletion, inspect privacy request history).
   - Admin `/admin/privacy` queue (review/approve/reject/process export & deletion requests, schedule/cancel deletion, inspect data retention policies, document backup retention caveat).
   - Strict exclusion of `password_hash`, active/revoked session token hashes, reset/verification token hashes, and server API secrets from all exports.
3. **Backup & Disaster Recovery (`/admin/backups`)**:
   - Honest backup/restore capability reporting (`NOT_CONFIGURED` vs `VERIFIED` vs `FAILED`), real SQLite file snapshot + `VACUUM INTO` + `PRAGMA integrity_check` when file-backed SQLite is active, explicit `CONFIG_SNAPSHOT` support, and heavily guarded `super_admin` restore workflow (fresh password re-auth, typed confirmation phrase, verified check, environment banner, production guard).
4. **Feature Flags & Controlled Rollouts (`/admin/features`)**:
   - Dedicated normalized `feature_flags` + `feature_flag_history` tables supporting unique validated key, environment scope, rollout percentage (`0–100`) using deterministic user-ID hashing, role targeting, optional `starts_at`/`ends_at` schedule, `client_exposed` vs `internal_only` classification, kill switches, history, and rollback — without any commercial billing/paywall logic.
5. **Release & Maintenance Management (`/admin/releases`)**:
   - Real build/package/runtime version inspector (`package.json` version, Node version, DB dialect, migration version, environment), manual `MANUAL` release ledger, scheduled maintenance windows (`maintenance_windows` table) with start/end validation, expected completion note, bypass role evaluation in `server.ts`, maintenance history, and clear user-facing maintenance status rendering.
6. **Platform Configuration Governance (Extended `/admin/configuration`)**:
   - Unified governance taxonomy spanning all 10 required categories (`Platform`, `Authentication`, `Security`, `AI`, `Market Data`, `API`, `Background Jobs`, `Maintenance`, `Privacy`, `Notifications`), public vs private classification, strict allowlist schema validation, secret status readouts (`CONFIGURED` / `NOT_CONFIGURED` only — never leaking key values), history, and re-authenticated rollback.
7. **Compliance & Governance Reporting (`/admin/governance`)**:
   - Aggregated operational governance metrics and unified cross-domain governance event ledger (lifecycle, privacy, backups, feature flags, config changes, maintenance, role changes, security actions), date/category/actor filtering, formula-safe CSV export, and honest compliance-readiness summary without falsely claiming legal certification.

---

## 5. Risks, Security Boundaries & Dependencies

- **SQLite Foreign-Key Risk on `users` Rebuild**: Phase 2 & 3 rebuilt `users` with `PRAGMA foreign_keys = OFF`, which is fragile once 20+ tables reference `users(id)`. **Mitigation:** Add a 1:1 `user_lifecycle_states` table (plus `user_lifecycle_events` and `user_admin_notes`) and keep `users.account_status` synced cleanly (`'active'` / `'suspended'` / `'disabled'`) so existing auth & FK constraints stay 100% intact with zero table-rebuild risk.
- **Last Super Admin & Self-Lockout**: Must enforce `countActiveSuperAdmins()` across suspend, scheduled deletion, immediate anonymization/deletion, and role demotion; also ensure maintenance bypass always permits `super_admin` / `/admin` / `/api/auth` recovery.
- **Secret & PII Leakage in Exports**: Exports must allowlist safe fields explicitly rather than dumping raw table rows (`SELECT *` on `users` or `sessions` must never leak into exports).
- **PgBouncer Transaction Pooler Compatibility**: Every PostgreSQL query must avoid prepared-statement assumptions, cast ISO parameters explicitly (`$1::timestamptz`), and keep request latency concise.

---

## 6. Implementation Sequence

1. **Migration (`0005_phase5_governance`)** & DB registration (`src/auth/db.ts`) for both SQLite and PostgreSQL (+ `.down.sql`).
2. **RBAC Extension** (`src/auth/rbacShared.ts` + `src/admin/types.ts`).
3. **Pure Domain Logic** (`src/admin/governanceMath.ts` — deterministic rollout bucketing, schedule evaluation, allowlist validators, redaction & secret-exclusion helpers, retention & compliance readiness calculations, CSV formula safety).
4. **Governance & Privacy Services** (`src/admin/governanceService.ts` wired into `AdminService` + user-facing `/api/privacy/*` + `/api/features/evaluated` routes).
5. **Server Gate & Wiring** (`server.ts` maintenance window gate + privacy/features router mount, `src/admin/router.ts` Phase 5 endpoints).
6. **Frontend Admin & User UI** (`src/lib/adminApi.ts`, `src/lib/siteData.ts`, `AdminLayout.tsx`, `AdminConsoleApp.tsx`, extended `AdminUserDetailView.tsx` & `AdminConfigAndLogsViews.tsx`, new admin views for Privacy, Backups, Feature Flags, Releases/Maintenance, and Governance Reports; user-facing privacy panel in `/app/account` + maintenance UX).
7. **Verification & Documentation**: `src/admin/phase5.test.ts`, migration rollback update in `src/auth/auth.test.ts`, live browser QA via `playwright-cli`, and 4 final Phase 5 Markdown deliverables (`PHASE_5_IMPLEMENTATION_REPORT.md`, `PHASE_5_VERIFICATION_REPORT.md`, `PHASE_5_DISASTER_RECOVERY_RUNBOOK.md`, `PHASE_5_GOVERNANCE_READINESS_REPORT.md`).
