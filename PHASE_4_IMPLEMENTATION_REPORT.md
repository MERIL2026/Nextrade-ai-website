# Nextrade AI — Phase 4 Implementation Report
## Platform Intelligence & Observability

**Scope**: Extension of the existing Admin Control Centre (`/admin/*` and `/api/admin/*`) built across Phases 1–3, adding real telemetry collection, runtime observability, threshold-driven alerting, incident lifecycle timelines, and operational intelligence across both dual-dialect databases (`node:sqlite` for automated tests and Supabase PostgreSQL via PgBouncer for runtime).

---

## 1. Existing Architecture Preserved

- **Authentication & Sessions**: Preserved Phase 1 Argon2id password hashing, SHA-256 hashed opaque session tokens, HttpOnly cookies, and CSRF origin checks (`src/auth/crypto.ts`, `src/auth/service.ts`, `src/lib/security.ts`).
- **Multi-User Isolation & RBAC**: Preserved Phase 2 workspace isolation (`src/workspace/*`) and extended the Phase 3 centralized RBAC matrix (`src/auth/rbacShared.ts`, `src/auth/rbacMiddleware.ts`) without breaking any existing user or admin roles.
- **Dual-Dialect Database Layer**: Preserved `AuthDatabase` (`src/auth/db.ts`) supporting both `node:sqlite` (`DatabaseSync`, WAL) and Supabase PostgreSQL (`postgres`, `prepare: false`, `max_pipeline: 1` for PgBouncer compatibility), with paired up/down SQL migrations in `migrations/` and `migrations/postgres/`.
- **Admin Design System**: Preserved the institutional light editorial Admin Console theme (`#F7F8FA`, `#FFFFFF`, `#101827`, `#2D46E6`, tabular monospace figures, single hairline borders, zero decorative pulsing animations, and explicit unavailability states).

---

## 2. Database Schema & Migrations (`0004_phase4_observability`)

Added paired up and down migrations:
- `migrations/0004_phase4_observability.sql` & `migrations/0004_phase4_observability.down.sql`
- `migrations/postgres/0004_phase4_observability.sql` & `migrations/postgres/0004_phase4_observability.down.sql`

### Schema Additions & Extensions
1. **`admin_incidents` (extended)**:
   - Expanded `status` workflow constraint to `OPEN`, `INVESTIGATING`, `IDENTIFIED`, `MONITORING`, `MITIGATED`, `RESOLVED`.
   - Added `owner_email`, `linked_alert_ids_json`, and `linked_event_refs_json`.
2. **`background_jobs` & `background_job_runs` (extended)**:
   - Added `background_jobs.is_paused` (boolean/integer flag).
   - Added `background_job_runs.queued_at` and `background_job_runs.wait_ms`.
3. **`service_health_checks`**: Persisted dependency probe snapshots (`service_id`, `service_name`, `category`, `status`, `latency_ms`, `detail`, `checked_at`).
4. **`market_data_health`**: Persisted catalog snapshot verification runs (`provider_id`, `provider_name`, `status`, `classification`, `symbols_processed`, `failure_count`, `validation_failures`, `latency_ms`, `detail`, `checked_at`).
5. **`worker_heartbeats`**: Worker queue state and counters (`worker_id`, `status`, `queue_paused`, `active_job_id`, `processed_count`, `failed_count`, `last_heartbeat_at`, `updated_at`).
6. **`operational_alerts`**: Threshold-triggered alerts with unique `fingerprint` deduplication, `occurrence_count`, `metric_value`, `threshold_value`, `cooldown_until`, `internal_notes`, `acknowledged_by`, `resolved_by`, and lifecycle timestamps.
7. **`alert_history`**: Immutable state transition and note history linked by foreign key to `operational_alerts`.
8. **`incident_events`**: Append-only incident timeline events (`CREATED`, `STATUS_CHANGED`, `OWNER_ASSIGNED`, `NOTE_ADDED`, `ALERT_LINKED`, `TELEMETRY_LINKED`) linked by foreign key to `admin_incidents`.
9. **Indexes**: Added targeted descending timestamp and composite status/severity/category indexes (`idx_service_health_checked_at`, `idx_market_health_checked_at`, `idx_alerts_status_severity`, `idx_alerts_category`, `idx_alert_history_alert_id`, `idx_incident_events_incident`, `idx_auth_sec_events_type_time`).

---

## 3. RBAC Extensions (`src/auth/rbacShared.ts`)

Added five granular Phase 4 permissions:
- `admin:alerts:read`
- `admin:alerts:manage`
- `admin:incidents:read`
- `admin:incidents:manage`
- `admin:ai:inspect_sensitive`

Role grants:
- **`viewer`**: Read-only access (`admin:alerts:read`, `admin:incidents:read`).
- **`data_admin`**: Added `admin:alerts:read`.
- **`ai_admin`**: Added `admin:alerts:read` and `admin:ai:inspect_sensitive`.
- **`security_admin`**: Added full alerts & incidents read/manage permissions (`admin:alerts:read`, `admin:alerts:manage`, `admin:incidents:read`, `admin:incidents:manage`).
- **`admin` & `super_admin`**: Granted all five Phase 4 permissions.
- **`user` & `support_admin`**: Explicitly excluded from Phase 4 observability/alerting/incident/sensitive-AI inspection endpoints.

---

## 4. Backend Modules & API Endpoints

### Core Phase 4 Modules
- **`src/admin/observabilityMath.ts`**: Pure deterministic functions for time-window resolution (`15m`, `1h`, `24h`, `7d`, `30d`, `all`, `custom` clamped to 90 days), P50/P95/P99 latency percentiles, period-over-period delta %, route/UUID/email/token sanitization, sensitive text redaction, masked prompt previews, security event severity classification, stuck job detection, and alert threshold candidate evaluation.
- **`src/admin/runtimeSettings.ts`**: Extended `platform_settings` defaults with `alert_thresholds` (`apiErrorRateCriticalPct`, `apiP95LatencyWarningMs`, `aiFailureRateWarningPct`, `failedLoginsBurstThreshold`, `marketSyncStaleMinutes`, `stuckJobMinutes`, `alertCooldownMinutes`, `retentionDays`).
- **`src/admin/telemetry.ts`**:
  - Express `/api/*` request telemetry collector with async batched flushing into `api_request_logs` and a bounded 50-item in-memory 5xx ring buffer.
  - Background job worker manager supporting 4 registered jobs (`session-cleanup`, `telemetry-prune`, `market-catalog-sync`, `health-probe`), `worker_heartbeats` persistence, `queuePaused` blocking (`409 QUEUE_PAUSED`), queue wait tracking, and cancellation support.
- **`src/admin/observabilityService.ts`**:
  - Platform intelligence overview (user/usage/API/AI/market metrics, prior-period comparisons, 7-service runtime health matrix, and hourly/daily trend buckets).
  - API endpoint performance aggregation (P50/P95/P99, error rate, rate-limit counts, slow-endpoint detection, method/status/endpoint filters).
  - AI model/provider performance breakdown, masked prompt summaries by default, and audited `inspectSensitiveAiRequest` reveal.
  - Market data freshness tracking (`FRESH` / `STALE` / `NEVER_SYNCED`) and provider health history.
  - Security monitoring with severity classification, repeated failure source detection (`>= 3` failures per IP), and time-window trend charts.
  - Threshold alert evaluator with fingerprint deduplication, cooldown enforcement, severity-escalation cooldown bypass, status transitions, and `Escalate to Incident` workflow.
  - Incident lifecycle management with immutable chronological `incident_events` timeline.
- **`src/admin/router.ts`**: Registered `/api/admin/observability/*`, `/api/admin/jobs/queue/pause`, `/api/admin/jobs/queue/resume`, `/api/admin/alerts*`, and `/api/admin/incidents*` endpoints guarded by `requirePermission(...)`.

---

## 5. Admin Control Centre UI Modules

- **`src/components/admin/AdminCharts.tsx`**: Reusable SVG/CSS institutional bar/trend charts (`AdminBarChart`) with error overlays and clean empty states.
- **`src/components/admin/AdminOverviewView.tsx`**: Enhanced Command Centre with time-range selector (`15m`, `1H`, `24H`, `7D`, `30D`, `All`, `Custom`), 6 intelligence cards with period deltas, 3 trend charts, 7-service live health matrix, active alert/incident pills, and recent admin audit feed.
- **`src/components/admin/AdminApisView.tsx`**: API Observability table with endpoint/method/status/time filters, P50/P95/P99 latency columns, slow-endpoint badges, and recent failed request inspection.
- **`src/components/admin/AdminAiView.tsx`**: Model & Provider Performance Matrix, availability & token metrics (explicitly showing `Unavailable` / `Estimated cost unavailable` when provider pricing or usage metadata is absent), redacted prompt summaries, and audited `Inspect` reveal flow.
- **`src/components/admin/AdminMarketsView.tsx`**: Market freshness banner (`FRESH` / `STALE` / `NEVER_SYNCED`), explicit `SIMULATED` vs `UNAVAILABLE / NOT_CONFIGURED` provider cards, and `Market Catalog Sync & Health History`.
- **`src/components/admin/AdminInfraAndJobsViews.tsx`**: Worker Heartbeat & Queue State card (`Pause Queue` / `Resume Queue`), job execution & failure trend chart, avg queue wait & duration metrics, and registered maintenance jobs.
- **`src/components/admin/AdminSecurityView.tsx`**: Security event trend chart, severity distribution pills, repeated-failure source card, and multi-filter security audit log.
- **`src/components/admin/AdminAlertsView.tsx`**: Operational Alerts console with status/severity/category filters, collapsible Threshold Rules & Retention editor, `Evaluate Thresholds Now`, alert lifecycle actions (`Acknowledge`, `Resolve`, `Suppress (2h)`, `Escalate to Incident`), and `Alert State History`.
- **`src/components/admin/AdminIncidentsView.tsx`**: Incident queue, creation form, 6-stage workflow bar (`OPEN` → `INVESTIGATING` → `IDENTIFIED` → `MONITORING` → `MITIGATED` → `RESOLVED`), owner assignment, telemetry/alert linking, resolution summary, and immutable `Incident Timeline`.

---

## 6. Privacy, Security & Honesty Controls

- **Zero Credential Leakage**: Query strings, bearer tokens, JWTs, `AIza...` keys, passwords, emails, and >=8-digit numbers are scrubbed by `sanitizeRoutePath()` and `redactSensitiveText()` before storage or display.
- **Default Prompt Redaction**: AI telemetry lists return masked previews (`maskUserPromptSummary`); viewing full sanitized previews requires `admin:ai:inspect_sensitive` and writes an `ADMIN_AI_SENSITIVE_INSPECT` audit entry.
- **No Fabricated Telemetry**: Market data continues to carry explicit `SIMULATED` / `UNAVAILABLE` classifications; AI cost shows `Estimated cost unavailable: provider pricing table not configured`; disk volume shows `Unavailable (Statfs not polled)`; and empty telemetry windows render explicit empty-state notices rather than synthetic zeroes or fake curves.
