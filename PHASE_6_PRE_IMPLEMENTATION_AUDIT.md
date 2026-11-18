# Nextrade AI — Phase 6 Pre-Implementation Audit

**Audit Date:** 2026-11-17  
**Scope:** Phase 6 — Advanced Super Admin Operations, Automation & Platform-Wide Control  
**Audit Basis:** Direct inspection of repository source files (`server.ts`, `src/auth/*`, `src/workspace/*`, `src/admin/*`, `src/components/admin/*`, `src/lib/*`), database migrations (`0001`–`0005`), and automated test suites (`47/47` passing baseline).

---

## 1. Verified Project Architecture & Implementation Status (Phases 1–5)

Direct source inspection confirms the following capabilities are genuinely implemented and wired end-to-end:

### Phase 1 — Identity & Authentication (`src/auth/*`)
- Relational user accounts (`users`), revocable hashed sessions (`sessions`), email verification tokens (`email_verification_tokens`), password reset tokens (`password_reset_tokens`), and security event logging (`auth_security_events`).
- Argon2id password hashing, SHA-256 opaque session tokens stored in `HttpOnly`, `SameSite=Lax` cookies (`nextrade_session`), same-origin CSRF origin verification (`isSameOriginMutation`), and sliding-window login/signup rate limiting.
- **Note on MFA:** TOTP/WebAuthn Multi-Factor Authentication is **not implemented** in the current identity layer (`users` has no MFA secret columns). Any Phase 6 privileged access inspection panel must explicitly report MFA status as `NOT_CONFIGURED` / `Not Implemented` rather than fabricating MFA enrollment.

### Phase 2 — Authorization & Multi-User Isolation (`src/auth/rbac*.ts`, `src/workspace/*`)
- Strict `user_id` ownership isolation enforced at query and router levels across `portfolios`, `portfolio_holdings`, `watchlists`, `watchlist_items`, `paper_trading_accounts`, `paper_orders`, `paper_transactions`, `ai_research_history`, `saved_reports`, and `user_preferences`.
- Server-side `requireAuthenticatedUser` + `requirePermission` middleware enforces RBAC on every workspace and admin endpoint.

### Phase 3 — Admin Control Centre (`src/admin/service.ts`, `src/admin/router.ts`)
- 8 canonical roles (`user`, `viewer`, `support_admin`, `data_admin`, `ai_admin`, `security_admin`, `admin`, `super_admin`) defined in `src/auth/rbacShared.ts`.
- Append-only `admin_audit_logs` (blocking HTTP `PUT`/`PATCH`/`DELETE` with `405 AUDIT_LOGS_IMMUTABLE`), config audit rollback (`admin_config_audit`), role assignment ledger (`admin_role_assignments`), `support_tickets`, `admin_announcements`, and re-authentication (`enforceReauth` returning `428 REAUTH_REQUIRED`).
- Last-active `super_admin` protection on suspension, deletion, and role demotion (`countActiveSuperAdmins()`).

### Phase 4 — Platform Intelligence & Observability (`src/admin/observability*.ts`, `src/admin/telemetry.ts`)
- Real telemetry collector buffering `/api/*` latencies, status codes, rate-limit events (`api_request_logs`), and a 5xx ring buffer without logging passwords, tokens, or authorization headers.
- AI request telemetry (`ai_request_logs`) with sensitive prompt inspection gated behind `admin:ai:inspect_sensitive` and masked previews by default.
- Alert evaluation engine with deduplicated fingerprints (`operational_alerts`), cooldown windows, `alert_history`, structured `admin_incidents` + `incident_events` timelines, `service_health_checks`, `market_data_health`, `background_jobs` + `background_job_runs`, and `worker_heartbeats` (including queue pause/resume).

### Phase 5 — Platform Governance, Reliability & Lifecycle (`src/admin/governance*.ts`, `src/admin/privacyRouter.ts`)
- Extended user lifecycle state machine (`user_lifecycle_states`, `user_lifecycle_events`, `user_admin_notes`) supporting `active`, `suspended`, `pending_verification`, `deletion_requested`, `deletion_scheduled`, and `deleted_anonymized`.
- Privacy workflows (`data_export_requests`, `data_deletion_requests`) with HMAC-SHA256 expiring download signatures, owner-only `403` IDOR enforcement, and secret exclusion.
- Capability-honest backup engine (`backup_records`, `backup_verification_events`) reporting `NOT_CONFIGURED` for physical PostgreSQL snapshots in this container while supporting SHA-256 verified `CONFIG_SNAPSHOT` backups (plus `VACUUM INTO` + `PRAGMA integrity_check` for SQLite test/local runtimes) and `super_admin` + re-auth + `"RESTORE BACKUP"` guarded restores.
- Normalized `feature_flags` + `feature_flag_history`, manual `release_records`, scheduled `maintenance_windows` with server-side `maintenanceGate`, 10-category configuration matrix, and governance CSV exports.

---

## 2. Database Source of Truth & Migration Conventions

- **Production / Live Runtime Database:** Supabase PostgreSQL (`authDatabase: "supabase-postgres"` via `postgres` driver configured with `prepare: false` and `max_pipeline: 1` for PgBouncer transaction pooler compatibility). Verified active via `/api/health`.
- **Automated Test & Local Fallback Database:** `node:sqlite` (`DatabaseSync`) with foreign keys and WAL mode enabled.
- **Migration Convention:** Sequential ordered versions in `ORDERED_MIGRATIONS` inside `src/auth/db.ts` (`0001` through `0005`), each maintaining paired up/down SQL files in `/migrations/*.sql` (SQLite) and `/migrations/postgres/*.sql` (PostgreSQL).
- **Important Constraint Found in `src/auth/auth.test.ts`:** The migration rollback test verifies sequential rollback from the latest version back down to `0001_init_auth` and clean re-application. Adding `0006_phase6_super_ops` requires adding paired up/down SQL scripts and extending the rollback assertions in `src/auth/auth.test.ts`.

---

## 3. Existing Gaps Addressed by Phase 6

1. **No Dedicated Super Admin Command View:** `/admin` currently serves a general overview for any `ADMIN_CONSOLE_READ` role; there is no unified `/admin/super-control` executive command plane combining user/alert/incident/maintenance/backup/automation/governance state and a cross-domain unified activity timeline.
2. **No Governed Automation Engine:** `background_jobs` executes static manual/interval jobs (`session-cleanup`, `telemetry-prune`, `market-catalog-sync`, `health-probe`). There is no declarative workflow builder, predefined safe action catalog, idempotency protection, automation kill switch, human-approval gating, or execution monitoring.
3. **No Access Reviews, Separation-of-Duties Approval Workflows, or Time-Limited Emergency Access:** Roles can be inspected (`/admin/access-control`) and changed immediately by a Super Admin (`POST /api/admin/users/:id/role`), but there is no periodic privileged access review ledger, dual-control request/approval pipeline preventing self-approval, or time-boxed emergency access grant workflow with post-incident review.
4. **AI Policy Versioning & Runtime Enforcement Gap:** `ai_prompt_versions` versions system prompts and `platform_settings['ai_config']` stores basic model/fallback toggles, but `src/lib/researchEngine.ts` lacks full versioned `ai_policy_versions` enforcement covering allowed model lists, output token limits, request timeout bounds, capability-level kill switches, sensitive-data redaction, and explicit prompt-injection boundary guards.
5. **No Dedicated Emergency Response Centre & Playbooks:** Phase 3 has `/api/admin/emergency` (`maintenance_on/off`, `disable_ai`, `disable_markets`, `revoke_all_user_sessions`), and Phase 4 has alerts/incidents, but there is no unified `/admin/emergency` triage surface with documented playbooks, incident escalation, queue pause, or structured emergency event logging + recovery guidance.
6. **Fragmented Intelligence & Single-Entity Top-Bar Search:** Header search currently redirects only to `/admin/users?search=...` or matches sidebar labels. There is no server-side multi-resource permission-filtered search (`/api/admin/search`), no Global Admin Action Centre, and no cross-domain Phase 4+5 trend/recommendation support (`/admin/intelligence`).

---

## 4. Architectural Risks & Mitigations

| Risk | Mitigation Strategy |
| --- | --- |
| **Arbitrary Code / Unsafe Side Effects in Automation** | Restrict workflow triggers and actions to strict TypeScript/SQL enum allowlists; never execute shell commands, raw SQL, dynamic JS, or outbound webhooks; block destructive actions (`delete user`, `db restore`, `super_admin grant`) in engine validation and runtime checks. |
| **Self-Approval Bypass in Privileged Requests** | Enforce `request.requested_by !== actor.userId` server-side inside `decidePrivilegedActionRequest` and restrict high-impact approvals (`ROLE_ASSIGN`, `BACKUP_RESTORE`, `AI_POLICY_CRITICAL`) to `super_admin` (plus fresh re-auth on sensitive execution). |
| **Cross-Domain Duplication** | Reuse existing `createObservabilityService` alerts/incidents, `createBackgroundJobManager` queue pause/resume, `createGovernanceService` feature flags & maintenance windows, and `writeAuditLog` rather than creating parallel tables for those entities. |
| **Global Search Information Disclosure** | Evaluate caller RBAC permissions per entity type before running queries; redact emails/notes/targets where needed; enforce strict query length validation, pagination limits, and rate limiting. |
| **PgBouncer Transaction Pooler Constraints** | Avoid prepared statements, cast ISO timestamps explicitly (`$n::timestamptz`), and keep PostgreSQL transactions bounded and concise. |
| **Last Super Admin Lockout** | Preserve `countActiveSuperAdmins()` checks across session revocation, lifecycle actions, role modifications, and emergency session revocation (`revoke_non_super_admin_sessions` / session exclusion). |

---

## 5. Implementation Sequence

1. **Database & RBAC Foundation (`0006_phase6_super_ops` + `src/auth/rbacShared.ts` + `src/admin/types.ts`)**:
   - Add paired SQLite & PostgreSQL migrations and register `0006_phase6_super_ops` in `src/auth/db.ts`.
   - Extend `PERMISSIONS` and `ROLE_PERMISSION_MATRIX` with Phase 6 least-privilege grants.
2. **Pure Logic & AI Safety (`src/admin/superOpsMath.ts`)**:
   - Workflow validation, idempotency key helpers, separation-of-duties checks, AI policy validation, prompt-injection & PII input inspection, and evidence-backed operational recommendation derivation.
3. **AI Policy Integration (`src/admin/runtimeSettings.ts` + `src/lib/researchEngine.ts`)**:
   - Wire active `ai_policy_versions` enforcement cleanly into `executeFinancialResearch` (without changing public/workspace response contracts).
4. **Core Phase 6 Backend Service & Router (`src/admin/superOpsService.ts` + `src/admin/service.ts` + `src/admin/router.ts`)**:
   - Super Control Command Centre, Unified Timeline, Governed Automation Engine, Privileged Access Reviews / Approval Requests / Emergency Access Grants, AI Policy Governance, Emergency Response Centre + Playbooks, Platform Intelligence + Recommendations, Global Action Centre, and Permission-Filtered Global Search.
5. **Frontend Admin Modules (`src/lib/adminApi.ts`, `src/lib/siteData.ts`, `src/components/admin/*`)**:
   - Add `/admin/super-control`, `/admin/automation`, `/admin/access-reviews`, `/admin/ai-policies`, `/admin/emergency`, `/admin/intelligence`, and header Global Search + Action Centre drawer inside the existing Nextrade AI graphite/white/#2D46E6 design system.
6. **Verification, Integration Audit & Documentation**:
   - Comprehensive unit & integration suite (`src/admin/phase6.test.ts`), migration rollback updates (`src/auth/auth.test.ts`), `npm run lint` (`tsc --noEmit`), `npm run build`, desktop & mobile Chromium QA via `playwright-cli`, and all 6 final Phase 6 reports.
