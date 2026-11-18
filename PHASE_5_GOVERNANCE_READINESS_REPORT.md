# NEXTRADE AI — PHASE 5 GOVERNANCE READINESS REPORT

> **Compliance & Legal Boundary Notice:** This document tracks enforced technical controls and operational governance telemetry implemented inside Nextrade AI. It does **not** constitute legal certification, attestation, or audit sign-off under GDPR, CCPA, SOC 2, ISO 27001, SEBI, or FINRA frameworks.

---

## 1. Control Readiness Matrix

| Governance Domain | Technical Status | Enforced Controls & Evidence |
|---|---|---|
| **Identity & Least-Privilege RBAC** | `IMPLEMENTED` | 8 scoped roles enforced server-side (`src/auth/rbacShared.ts`), Argon2id passwords, SHA-256 opaque `HttpOnly` sessions, same-origin CSRF mutation checks. |
| **Sensitive Action Re-Authentication** | `IMPLEMENTED` | Fresh password check required for role changes, immediate anonymization, emergency kill-switches, backup restoration, and governance policy updates. |
| **Last Super Admin & Self-Action Guards** | `IMPLEMENTED` | Server blocks self-demotion, self-suspension, self-deletion, and modifying/deleting the final active `super_admin`. |
| **User Lifecycle & Controlled Deletion** | `IMPLEMENTED` | `user_lifecycle_states` + `user_lifecycle_events` + `user_admin_notes` with configurable grace window, user/admin cancellation prior to execution, and irreversible anonymization option. |
| **Personal Data Export & Secret Exclusion** | `IMPLEMENTED` | `/app/account` + `/api/privacy/export` exports sanitized JSON strictly vetted by `containsForbiddenExportKeys` (excludes password hashes, session token hashes, OTP/TOTP/OAuth secrets). Downloads use HMAC-SHA256 expiring links with strict owner checks (`403` IDOR block, `410` expired). |
| **Configuration Classification & Secret Hygiene** | `IMPLEMENTED` | 10-category config matrix (`Platform`, `Authentication`, `Security`, `AI`, `Market Data`, `API`, `Background Jobs`, `Maintenance`, `Privacy`, `Notifications`) classifies `PUBLIC` vs `PRIVATE` and exposes secrets solely as `CONFIGURED` / `NOT_CONFIGURED`. |
| **Immutable Governance Audit Trail** | `IMPLEMENTED` | `admin_audit_logs` rejects `PUT`/`PATCH`/`DELETE` (`HTTP 405`), redacts sensitive fields, and exports formula-safe CSV (`buildCsvDocument`). |
| **Feature Rollouts & Maintenance Governance** | `IMPLEMENTED` | Deterministic SHA-256 user-ID bucketing, role/environment targeting, kill switches, history rollback, and scheduled maintenance windows with role bypass. |
| **Automated Physical PostgreSQL Backups** | `NOT_CONFIGURED` *(in-app)* | App container lacks `pg_dump` and managed object-store credentials; full PostgreSQL PITR/backups rely on Supabase Dashboard while `CONFIG_SNAPSHOT` + SHA-256 verification operate in-app. |
| **Automated CI/CD Release Webhooks** | `NOT_CONFIGURED` | `/admin/releases` reports `ciCdWebhookConfigured: false` honestly and maintains an audited manual release ledger alongside live Node/migration metadata. |

---

## 2. Data Retention & Backup Caveat

- **Default Policies (`governance_policies`):**
  - Personal export download link expiry: **24 hours** (configurable 1–168h)
  - Account deletion grace period: **7 days** (configurable 1–90d)
  - Request/telemetry log retention target: **30 days** (configurable 7–365d)
  - Audit log retention target: **365 days** (configurable 30–3650d)
- **Backup Caveat:** Disclosed transparently in `/app/account` and `/admin/privacy` — infrastructure point-in-time backups retained by hosting providers cannot be mutated per-row and age out on provider rotation schedules.
