# NEXTRADE AI — PHASE 6 SECURITY AUDIT

**Scope:** Phase 6 Super Admin Operations, Governed Automation, Access Governance, AI Policy Governance, Emergency Controls, Platform Intelligence & Global Search  
**Audit Method:** Code review of routers, pure validation helpers, RBAC permission tables, database migrations, and automated integration test verification

---

## 1. Authentication, Authorization & Least-Privilege Boundaries

| Control | Implementation Details | Status |
| :--- | :--- | :--- |
| Server-Side RBAC Enforcement | Every Phase 6 endpoint in `src/admin/router.ts` uses `requirePermission(PERMISSIONS.*)` after `requireAuth` and `requireAdminPanelAccess`. Client-side nav filtering is strictly secondary UX. | **Enforced** |
| Super Admin Exclusivity | `ADMIN_SUPER_CONTROL_READ` (`/api/admin/super-control`), `ADMIN_AUTOMATION_MANAGE`, `ADMIN_PRIVILEGED_ACTIONS_APPROVE`, `ADMIN_EMERGENCY_MANAGE`, and `ADMIN_AI_POLICY_MANAGE` are withheld from `viewer`, `support_admin`, `data_admin`, `ai_admin` (except AI policy read/manage as scoped), and `security_admin` per `src/auth/rbacShared.ts`. | **Enforced** |
| Read-Only `viewer` Boundary | `viewer` receives `*_READ` permissions only and receives HTTP `403` on `/api/admin/super-control` and all mutating POST/PATCH endpoints. | **Enforced** |
| CSRF Origin Verification | `createAdminRouter` enforces `isSameOriginMutation(req)` on all non-GET/HEAD/OPTIONS mutations (`CSRF_ORIGIN_MISMATCH` 403). | **Enforced** |
| Password Re-Authentication | `enforceReauth(req, res)` (Argon2id verification against current user password) is enforced on Automation Kill Switch toggle, Privileged Request `/decide` and `/execute`, Emergency Access `/grant` and `/revoke`, AI Policy `/activate`, `/rollback`, and `/emergency-control`, plus critical Emergency Centre actions (`ACTIVATE_MAINTENANCE`, `DEACTIVATE_MAINTENANCE`, `DISABLE_AI_PROVIDER`, `ENABLE_AI_PROVIDER`, `REVOKE_USER_SESSIONS`). | **Enforced** |

---

## 2. Separation of Duties & Anti-Lockout Protections

1. **No Self-Approval on Privileged Requests:** `canApprovePrivilegedRequest()` (`src/admin/superOpsMath.ts`) rejects any approval/rejection where `requestedByUserId === reviewerUserId` (HTTP `403`).
2. **Role-Authority Tiering:** `ROLE_PROMOTION` and `PRODUCTION_RESTORE` privileged requests require `super_admin` authority on `/decide` and `/execute`.
3. **No Self-Review on Access Reviews:** `submitAccessReview()` rejects access reviews where the acting admin targets their own `userId` (HTTP `403`).
4. **Self-Lockout Prevention:** `executeEmergencyCentreAction()` blocks `REVOKE_USER_SESSIONS` when `targetId === actor.userId` (HTTP `409`), preserving administrative continuity during incidents.
5. **Last Super Admin Guard:** Inherited from Phases 3 & 5, role demotions and deletions block actions that would leave zero active `super_admin` accounts.

---

## 3. Automation Safety & AI Policy Guards

1. **Bounded Automation Action Catalog:** Workflows can only run one of 9 enumerated internal operational handlers (`AUTOMATION_ACTION_TYPES`). Shell commands, arbitrary SQL, dynamic `eval`, and outbound arbitrary webhooks are blocked by both TypeScript types, runtime validation (`validateAutomationWorkflowInput` + `FORBIDDEN_ACTION_KEYWORDS` + dangerous shell/SQL pattern check), and SQL `CHECK` constraints (`migrations/0006_phase6_super_ops.sql` and `migrations/postgres/0006_phase6_super_ops.sql`).
2. **Idempotency & Replay Prevention:** Duplicate `idempotencyKey` per workflow is enforced at both application lookup and SQL `UNIQUE (workflow_id, idempotency_key)` constraint (returning HTTP `409`).
3. **AI Prompt Injection & Secret Redaction (`inspectAiPromptInput`):**
   - Evaluates prompt-injection/override patterns (`ignore previous instructions`, `reveal system prompt`, `print process.env`, `<system>`, jailbreak overrides) and blocks execution with `AI_POLICY_BLOCKED` (HTTP `400`) when active policy has `blockPromptInjection = true`.
   - Redacts API keys (`sk-*`, `AIza*`), emails, SSNs, and PAN-format tax IDs prior to provider dispatch when `redactSensitiveInputs = true`.
   - Enforces model allowlist (`APPROVED_GEMINI_MODELS`), `maxInputChars`, `maxOutputTokens`, and `timeoutMs` inside `executeFinancialResearch()`.

---

## 4. Permission-Filtered Search & Honesty Boundaries

1. **Search Rate Limiting & Sanitization:** `GET /api/admin/search` is rate-limited at 60 requests/min per admin (`searchLimiter`), sanitizes control characters via `sanitizeAdminSearchQuery()`, uses parameterized SQL queries across both SQLite (`?`) and Postgres (`$N`), and filters queried entity tables strictly by caller permissions (verified in `phase6.test.ts` where `support_admin` cannot view `automation_workflow` or `audit_log` hits).
2. **Zero Security Theater:**
   - MFA status explicitly reports `NOT_CONFIGURED` until TOTP/WebAuthn is added.
   - Full `pg_dump` binary backup/restore explicitly reports `NOT_CONFIGURED` in this runtime.
   - Live brokerage feeds explicitly report `SIMULATED` / `NOT_CONFIGURED`.
   - No password hashes, session tokens, or API secrets are serialized in exports, search responses, or timeline feeds.
