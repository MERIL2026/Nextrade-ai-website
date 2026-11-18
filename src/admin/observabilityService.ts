import crypto from 'node:crypto';
import type { AuthDatabase } from '../auth/db';
import type { AuthEmailSender } from '../auth/email';
import { CATALOG_INSTRUMENTS } from '../lib/marketData';
import type { MarketService } from '../market';
import { stripControlChars } from '../lib/security';
import {
  classifySecurityEventSeverity,
  computeLatencyStats,
  computePeriodDeltaPct,
  evaluateAlertCandidates,
  maskUserPromptSummary,
  redactSensitiveText,
  resolveObservabilityWindow,
  shouldBypassCooldownOnSeverityEscalation,
} from './observabilityMath';
import type { RuntimeConfigManager } from './runtimeSettings';
import type { BackgroundJobManager, TelemetryCollector } from './telemetry';
import type {
  AdminIncidentDto,
  AlertCategory,
  AlertHistoryDto,
  AlertSeverity,
  AlertStatus,
  IncidentEventDto,
  IncidentSeverity,
  IncidentStatus,
  MarketDataHealthDto,
  ObservabilityThresholdsConfig,
  OperationalAlertDto,
  ServiceHealthItem,
  TimeSeriesPoint,
} from './types';

export interface ObservabilityActor {
  userId: string | null;
  email: string;
  ipAddress?: string;
  userAgent?: string;
}

export type ObsOutcome<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; code?: string };

function toIso(v: unknown): string {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function toBool(v: unknown): boolean {
  return v === true || v === 1 || v === '1';
}

function parseJsonStringArray(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

function buildTimeBuckets(
  timestamps: Array<{ ts: string; isError?: boolean }>,
  window: ReturnType<typeof resolveObservabilityWindow>,
): TimeSeriesPoint[] {
  const nowMs = Date.parse(window.toIso) || Date.now();
  const isHourly =
    window.range === '15m' ||
    window.range === '1h' ||
    window.range === '24h' ||
    (window.durationMs !== null && window.durationMs <= 48 * 60 * 60 * 1000);

  if (isHourly) {
    const bucketCount = window.range === '15m' ? 4 : window.range === '1h' ? 6 : 12;
    const spanMs = window.durationMs ?? 24 * 60 * 60 * 1000;
    const stepMs = Math.max(60_000, Math.floor(spanMs / bucketCount));
    const startMs = nowMs - stepMs * bucketCount;

    const slots: Array<{ start: number; end: number; label: string; count: number; errors: number }> = [];
    for (let i = 0; i < bucketCount; i++) {
      const bStart = startMs + i * stepMs;
      const bEnd = bStart + stepMs;
      const d = new Date(bStart);
      const label = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
      slots.push({ start: bStart, end: bEnd, label, count: 0, errors: 0 });
    }

    for (const item of timestamps) {
      const t = Date.parse(item.ts);
      if (!Number.isFinite(t)) continue;
      for (const s of slots) {
        if (t >= s.start && t <= s.end) {
          s.count += 1;
          if (item.isError) s.errors += 1;
          break;
        }
      }
    }
    return slots.map((s) => ({ bucket: s.label, count: s.count, errors: s.errors }));
  }

  const daysCount = window.range === '30d' ? 14 : 7;
  const counts = new Map<string, { count: number; errors: number }>();
  const baseDate = new Date(nowMs);
  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date(baseDate);
    d.setUTCDate(baseDate.getUTCDate() - i);
    counts.set(d.toISOString().slice(0, 10), { count: 0, errors: 0 });
  }
  for (const item of timestamps) {
    const key = item.ts.slice(0, 10);
    const entry = counts.get(key);
    if (entry) {
      entry.count += 1;
      if (item.isError) entry.errors += 1;
    }
  }
  return Array.from(counts.entries()).map(([bucket, vals]) => ({
    bucket,
    count: vals.count,
    errors: vals.errors,
  }));
}

export function createObservabilityService(params: {
  db: AuthDatabase;
  emailSender: AuthEmailSender;
  runtimeConfigManager: RuntimeConfigManager;
  telemetryCollector: TelemetryCollector;
  jobManager: BackgroundJobManager;
  marketService?: MarketService;
  writeAuditLog: (entry: {
    actor: ObservabilityActor;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    previousValue?: unknown;
    newValue?: unknown;
    result?: 'SUCCESS' | 'DENIED' | 'ERROR';
  }) => Promise<string>;
}) {
  const { db, emailSender, runtimeConfigManager, telemetryCollector, jobManager, marketService, writeAuditLog } = params;
  const isPg = db.dialect === 'postgres';

  function mapAlertRow(row: Record<string, unknown>): OperationalAlertDto {
    return {
      id: String(row.id),
      fingerprint: String(row.fingerprint),
      category: String(row.category) as AlertCategory,
      title: String(row.title),
      description: String(row.description),
      severity: String(row.severity) as AlertSeverity,
      status: String(row.status) as AlertStatus,
      source: String(row.source),
      serviceId: row.service_id ? String(row.service_id) : null,
      metricValue:
        row.metric_value !== null && row.metric_value !== undefined ? Number(row.metric_value) : null,
      thresholdValue:
        row.threshold_value !== null && row.threshold_value !== undefined
          ? Number(row.threshold_value)
          : null,
      occurrenceCount: Number(row.occurrence_count ?? 1),
      eventRefs: parseJsonStringArray(row.event_refs_json),
      internalNotes: String(row.internal_notes ?? ''),
      acknowledgedBy: row.acknowledged_by ? String(row.acknowledged_by) : null,
      resolvedBy: row.resolved_by ? String(row.resolved_by) : null,
      firstDetectedAt: toIso(row.first_detected_at),
      lastDetectedAt: toIso(row.last_detected_at),
      cooldownUntil: row.cooldown_until ? toIso(row.cooldown_until) : null,
      resolvedAt: row.resolved_at ? toIso(row.resolved_at) : null,
      updatedAt: toIso(row.updated_at),
    };
  }

  function mapIncidentRow(row: Record<string, unknown>): AdminIncidentDto {
    return {
      id: String(row.id),
      title: String(row.title),
      description: String(row.description),
      severity: String(row.severity) as IncidentSeverity,
      status: String(row.status) as IncidentStatus,
      source: String(row.source),
      assignedAdminId: row.assigned_admin_id ? String(row.assigned_admin_id) : null,
      ownerEmail: String(row.owner_email ?? ''),
      linkedAlertIds: parseJsonStringArray(row.linked_alert_ids_json),
      linkedEventRefs: parseJsonStringArray(row.linked_event_refs_json),
      resolutionNotes: String(row.resolution_notes ?? ''),
      createdBy: row.created_by ? String(row.created_by) : null,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
      resolvedAt: row.resolved_at ? toIso(row.resolved_at) : null,
    };
  }

  function mapIncidentEventRow(row: Record<string, unknown>): IncidentEventDto {
    return {
      id: String(row.id),
      incidentId: String(row.incident_id),
      eventType: String(row.event_type) as IncidentEventDto['eventType'],
      previousStatus: row.previous_status ? String(row.previous_status) : null,
      newStatus: row.new_status ? String(row.new_status) : null,
      actorId: row.actor_id ? String(row.actor_id) : null,
      actorEmail: String(row.actor_email ?? 'system'),
      note: String(row.note ?? ''),
      linkedAlertId: row.linked_alert_id ? String(row.linked_alert_id) : null,
      linkedEventRef: row.linked_event_ref ? String(row.linked_event_ref) : null,
      createdAt: toIso(row.created_at),
    };
  }

  // ---- 1. Platform Overview & Intelligence ----
  async function getObservabilityOverview(query: {
    range?: unknown;
    from?: unknown;
    to?: unknown;
  }) {
    await telemetryCollector.flushNow();
    const window = resolveObservabilityWindow(query.range, query.from, query.to);
    const cfg = await runtimeConfigManager.getConfig();
    const { jobs, workerHeartbeat } = await jobManager.listJobs();

    const dbT0 = Date.now();
    await db.queryOne<{ ok: number }>('SELECT 1 AS ok', 'SELECT 1 AS ok');
    const dbLatencyMs = Math.max(0, Date.now() - dbT0);

    const hasBound = Boolean(window.fromIso);
    const rangeStartIso = window.fromIso ?? '1970-01-01T00:00:00.000Z';
    const rangeEndIso = window.toIso;

    const [
      userRows,
      apiRows,
      aiRows,
      secRows,
      paperOrdersRow,
      researchHistRow,
      activeAlertsRow,
      openIncidentsRow,
      openTicketsRow,
      recentAuditRows,
    ] = await Promise.all([
      db.queryAll<{
        id: string;
        account_status: string;
        email_verified: number | boolean;
        created_at: string | Date;
        last_login_at: string | Date | null;
      }>(
        'SELECT id, account_status, email_verified, created_at, last_login_at FROM users',
        'SELECT id, account_status, email_verified, created_at, last_login_at FROM users',
      ),
      hasBound
        ? db.queryAll<{
            route_path: string;
            status_code: number;
            latency_ms: number;
            rate_limited: number | boolean;
            created_at: string | Date;
          }>(
            'SELECT route_path, status_code, latency_ms, rate_limited, created_at FROM api_request_logs WHERE created_at >= ? AND created_at <= ?',
            'SELECT route_path, status_code, latency_ms, rate_limited, created_at FROM api_request_logs WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz',
            [rangeStartIso, rangeEndIso],
          )
        : db.queryAll<{
            route_path: string;
            status_code: number;
            latency_ms: number;
            rate_limited: number | boolean;
            created_at: string | Date;
          }>(
            'SELECT route_path, status_code, latency_ms, rate_limited, created_at FROM api_request_logs',
            'SELECT route_path, status_code, latency_ms, rate_limited, created_at FROM api_request_logs',
          ),
      hasBound
        ? db.queryAll<{
            status: string;
            latency_ms: number;
            total_tokens: number | null;
            created_at: string | Date;
          }>(
            'SELECT status, latency_ms, total_tokens, created_at FROM ai_request_logs WHERE created_at >= ? AND created_at <= ?',
            'SELECT status, latency_ms, total_tokens, created_at FROM ai_request_logs WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz',
            [rangeStartIso, rangeEndIso],
          )
        : db.queryAll<{
            status: string;
            latency_ms: number;
            total_tokens: number | null;
            created_at: string | Date;
          }>(
            'SELECT status, latency_ms, total_tokens, created_at FROM ai_request_logs',
            'SELECT status, latency_ms, total_tokens, created_at FROM ai_request_logs',
          ),
      hasBound
        ? db.queryAll<{ event_type: string; created_at: string | Date }>(
            'SELECT event_type, created_at FROM auth_security_events WHERE created_at >= ? AND created_at <= ?',
            'SELECT event_type, created_at FROM auth_security_events WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz',
            [rangeStartIso, rangeEndIso],
          )
        : db.queryAll<{ event_type: string; created_at: string | Date }>(
            'SELECT event_type, created_at FROM auth_security_events',
            'SELECT event_type, created_at FROM auth_security_events',
          ),
      hasBound
        ? db.queryOne<{ cnt: number | string }>(
            'SELECT COUNT(*) AS cnt FROM paper_orders WHERE created_at >= ? AND created_at <= ?',
            'SELECT COUNT(*) AS cnt FROM paper_orders WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz',
            [rangeStartIso, rangeEndIso],
          )
        : db.queryOne<{ cnt: number | string }>(
            'SELECT COUNT(*) AS cnt FROM paper_orders',
            'SELECT COUNT(*) AS cnt FROM paper_orders',
          ),
      hasBound
        ? db.queryOne<{ cnt: number | string }>(
            'SELECT COUNT(*) AS cnt FROM ai_research_history WHERE created_at >= ? AND created_at <= ?',
            'SELECT COUNT(*) AS cnt FROM ai_research_history WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz',
            [rangeStartIso, rangeEndIso],
          )
        : db.queryOne<{ cnt: number | string }>(
            'SELECT COUNT(*) AS cnt FROM ai_research_history',
            'SELECT COUNT(*) AS cnt FROM ai_research_history',
          ),
      db.queryOne<{ total_open: number | string; critical_open: number | string }>(
        `SELECT
           COUNT(*) AS total_open,
           SUM(CASE WHEN severity = 'CRITICAL' THEN 1 ELSE 0 END) AS critical_open
         FROM operational_alerts
         WHERE status IN ('OPEN', 'ACKNOWLEDGED')`,
        `SELECT
           COUNT(*) AS total_open,
           SUM(CASE WHEN severity = 'CRITICAL' THEN 1 ELSE 0 END) AS critical_open
         FROM operational_alerts
         WHERE status IN ('OPEN', 'ACKNOWLEDGED')`,
      ),
      db.queryOne<{ cnt: number | string }>(
        "SELECT COUNT(*) AS cnt FROM admin_incidents WHERE status != 'RESOLVED'",
        "SELECT COUNT(*) AS cnt FROM admin_incidents WHERE status != 'RESOLVED'",
      ),
      db.queryOne<{ cnt: number | string }>(
        "SELECT COUNT(*) AS cnt FROM support_tickets WHERE status IN ('OPEN', 'IN_PROGRESS')",
        "SELECT COUNT(*) AS cnt FROM support_tickets WHERE status IN ('OPEN', 'IN_PROGRESS')",
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT id, admin_email, action, resource_type, resource_id, result, created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT 12',
        'SELECT id, admin_email, action, resource_type, resource_id, result, created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT 12',
      ),
    ]);

    // Previous period comparisons when finite range selected
    let prevApiCount: number | null = null;
    let prevAiCount: number | null = null;
    let prevFailedLoginsCount: number | null = null;
    let prevNewRegistrationsCount: number | null = null;

    if (window.previousFromIso && window.previousToIso) {
      const [prevApiRow, prevAiRow, prevFailLoginRow] = await Promise.all([
        db.queryOne<{ cnt: number | string }>(
          'SELECT COUNT(*) AS cnt FROM api_request_logs WHERE created_at >= ? AND created_at < ?',
          'SELECT COUNT(*) AS cnt FROM api_request_logs WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz',
          [window.previousFromIso, window.previousToIso],
        ),
        db.queryOne<{ cnt: number | string }>(
          'SELECT COUNT(*) AS cnt FROM ai_request_logs WHERE created_at >= ? AND created_at < ?',
          'SELECT COUNT(*) AS cnt FROM ai_request_logs WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz',
          [window.previousFromIso, window.previousToIso],
        ),
        db.queryOne<{ cnt: number | string }>(
          `SELECT COUNT(*) AS cnt FROM auth_security_events
           WHERE event_type IN ('login_failed', 'login_blocked') AND created_at >= ? AND created_at < ?`,
          `SELECT COUNT(*) AS cnt FROM auth_security_events
           WHERE event_type IN ('login_failed', 'login_blocked') AND created_at >= $1::timestamptz AND created_at < $2::timestamptz`,
          [window.previousFromIso, window.previousToIso],
        ),
      ]);
      prevApiCount = Number(prevApiRow?.cnt ?? 0);
      prevAiCount = Number(prevAiRow?.cnt ?? 0);
      prevFailedLoginsCount = Number(prevFailLoginRow?.cnt ?? 0);
      prevNewRegistrationsCount = userRows.filter((u) => {
        const ts = toIso(u.created_at);
        return ts >= window.previousFromIso! && ts < window.previousToIso!;
      }).length;
    }

    const newRegistrations = hasBound
      ? userRows.filter((u) => {
          const ts = toIso(u.created_at);
          return ts >= rangeStartIso && ts <= rangeEndIso;
        }).length
      : userRows.length;

    const recentlyActiveUsers = hasBound
      ? userRows.filter((u) => u.last_login_at && toIso(u.last_login_at) >= rangeStartIso).length
      : userRows.filter((u) => u.account_status === 'active').length;

    const loginSuccesses = secRows.filter((e) => e.event_type === 'login_success').length;
    const failedLogins = secRows.filter(
      (e) => e.event_type === 'login_failed' || e.event_type === 'login_blocked',
    ).length;

    const apiLatencies = apiRows.map((r) => Number(r.latency_ms ?? 0));
    const apiStats = computeLatencyStats(apiLatencies);
    const apiErrorsCount = apiRows.filter((r) => Number(r.status_code) >= 400).length;
    const api5xxCount = apiRows.filter((r) => Number(r.status_code) >= 500).length;
    const rateLimitEvents = apiRows.filter((r) => toBool(r.rate_limited)).length;
    const marketDataRequests = apiRows.filter((r) => r.route_path.startsWith('/api/markets')).length;

    const aiTotal = aiRows.length;
    const aiFailed = aiRows.filter((r) => r.status === 'FAILED').length;
    const aiLatencies = aiRows.map((r) => Number(r.latency_ms ?? 0));
    const aiLatencyStats = computeLatencyStats(aiLatencies);
    const measuredTokenRows = aiRows.filter(
      (r) => typeof r.total_tokens === 'number' && Number.isFinite(r.total_tokens),
    );
    const totalTokensMeasured =
      measuredTokenRows.length > 0
        ? measuredTokenRows.reduce((sum, r) => sum + Number(r.total_tokens ?? 0), 0)
        : null;

    const geminiConfigured = Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY',
    );
    const failedJobsCount = jobs.filter((j) => j.status === 'FAILED').length;
    const stuckJobsCount = jobs.filter((j) => j.isStuck).length;
    const nowIso = new Date().toISOString();

    const serviceHealth: ServiceHealthItem[] = [
      {
        id: 'backend-express',
        name: 'Express SSR & API Runtime',
        category: 'Core',
        status: cfg.maintenance_mode.enabled
          ? 'DEGRADED'
          : api5xxCount > 5
            ? 'DEGRADED'
            : 'HEALTHY',
        detail: cfg.maintenance_mode.enabled
          ? 'Maintenance mode active (admin recovery routes open).'
          : `Uptime ${Math.round(process.uptime())}s · P95 ${apiStats.p95Ms}ms`,
        latencyMs: apiTotalOrNull(apiRows.length, apiStats.avgMs),
        checkedAt: nowIso,
      },
      {
        id: 'database-primary',
        name: db.dialect === 'postgres' ? 'Supabase PostgreSQL' : 'Local SQLite (node:sqlite)',
        category: 'Database',
        status: 'HEALTHY',
        detail: `Connected (${db.dialect})`,
        latencyMs: dbLatencyMs,
        checkedAt: nowIso,
      },
      {
        id: 'auth-service',
        name: 'Authentication & RBAC Engine',
        category: 'Core',
        status: 'HEALTHY',
        detail: `${loginSuccesses} sign-ins · ${failedLogins} failures in window`,
        latencyMs: null,
        checkedAt: nowIso,
      },
      {
        id: 'ai-gemini',
        name: `Gemini Research (${cfg.ai_config.activeModel})`,
        category: 'AI',
        status: !cfg.ai_config.aiEnabled
          ? 'UNAVAILABLE'
          : geminiConfigured
            ? aiFailed > 0 && aiFailed === aiTotal
              ? 'DEGRADED'
              : 'HEALTHY'
            : 'NOT_CONFIGURED',
        detail: !cfg.ai_config.aiEnabled
          ? 'Disabled by admin AI policy'
          : geminiConfigured
            ? 'Server credential active'
            : 'AI Building Mode (no GEMINI_API_KEY set)',
        latencyMs: aiTotal > 0 ? aiLatencyStats.avgMs : null,
        checkedAt: nowIso,
      },
      {
        id: 'market-data-engine',
        name: 'Market Data Provider Adapters',
        category: 'Market Data',
        status: cfg.market_data_config.lastSyncStatus === 'FAILED' ? 'DEGRADED' : 'HEALTHY',
        detail: `${cfg.market_data_config.dataClassification} feed · ${CATALOG_INSTRUMENTS.length} catalog instruments`,
        latencyMs: null,
        checkedAt: nowIso,
      },
      {
        id: 'background-jobs',
        name: 'Background Job Worker',
        category: 'Jobs',
        status: workerHeartbeat.queuePaused || failedJobsCount > 0 || stuckJobsCount > 0 ? 'DEGRADED' : 'HEALTHY',
        detail: workerHeartbeat.queuePaused
          ? 'Queue paused by administrator'
          : `${jobs.length} registered · ${failedJobsCount} failed · ${stuckJobsCount} stuck`,
        latencyMs: null,
        checkedAt: nowIso,
      },
      {
        id: 'email-delivery',
        name: `Transactional Email (${emailSender.getProviderName()})`,
        category: 'Messaging',
        status: emailSender.isConfigured() ? 'HEALTHY' : 'NOT_CONFIGURED',
        detail: emailSender.isConfigured()
          ? 'Provider credentials configured'
          : 'Dev outbox / provider not configured',
        latencyMs: null,
        checkedAt: nowIso,
      },
    ];

    const hasDegraded = serviceHealth.some((s) => s.status === 'DEGRADED');
    const hasCriticalFailure = serviceHealth.some(
      (s) => s.status === 'UNAVAILABLE' && (s.id === 'backend-express' || s.id === 'database-primary'),
    );
    const overallPlatformHealth = hasCriticalFailure
      ? 'UNAVAILABLE'
      : hasDegraded
        ? 'DEGRADED'
        : 'HEALTHY';

    const userGrowth = buildTimeBuckets(
      userRows.map((u) => ({ ts: toIso(u.created_at) })),
      window,
    );
    const apiTraffic = buildTimeBuckets(
      apiRows.map((r) => ({ ts: toIso(r.created_at), isError: Number(r.status_code) >= 400 })),
      window,
    );
    const aiUsage = buildTimeBuckets(
      aiRows.map((r) => ({ ts: toIso(r.created_at), isError: r.status === 'FAILED' })),
      window,
    );

    const openAlertsCount = Number(activeAlertsRow?.total_open ?? 0);
    const criticalAlertsCount = Number(activeAlertsRow?.critical_open ?? 0);

    return {
      range: window.range,
      from: window.fromIso,
      to: window.toIso,
      maintenanceMode: cfg.maintenance_mode.enabled,
      overallPlatformHealth,
      userMetrics: {
        totalUsers: userRows.length,
        activeUsers: userRows.filter((u) => u.account_status === 'active').length,
        recentlyActiveUsers,
        newRegistrations,
        newRegistrationsDeltaPct: computePeriodDeltaPct(newRegistrations, prevNewRegistrationsCount),
        verifiedUsers: userRows.filter((u) => toBool(u.email_verified)).length,
        suspendedUsers: userRows.filter((u) => u.account_status === 'suspended').length,
        restrictedUsers: userRows.filter((u) => u.account_status !== 'active').length,
        loginActivityCount: loginSuccesses,
        failedLogins,
        failedLoginsDeltaPct: computePeriodDeltaPct(failedLogins, prevFailedLoginsCount),
      },
      aiMetrics: {
        totalRequests: aiTotal,
        totalRequestsDeltaPct: computePeriodDeltaPct(aiTotal, prevAiCount),
        providerConfigured: geminiConfigured,
        aiEnabled: cfg.ai_config.aiEnabled,
        activeModel: cfg.ai_config.activeModel,
        avgLatencyMs: aiTotal > 0 ? aiLatencyStats.avgMs : null,
        p95LatencyMs: aiTotal > 0 ? aiLatencyStats.p95Ms : null,
        failedRequests: aiFailed,
        totalTokensMeasured,
        estimatedCostUsd: null,
      },
      marketMetrics: {
        activeProviders: 3,
        classification: cfg.market_data_config.dataClassification,
        enabledRegions: cfg.market_data_config.enabledRegions,
        instrumentCount: CATALOG_INSTRUMENTS.length,
        marketDataRequests,
        lastSyncAt: cfg.market_data_config.lastSyncAt,
        lastSyncStatus: cfg.market_data_config.lastSyncStatus,
        failedSyncJobs: jobs.filter((j) => j.id === 'market-catalog-sync' && j.status === 'FAILED').length,
      },
      apiMetrics: {
        requestVolume: apiRows.length,
        requestVolumeDeltaPct: computePeriodDeltaPct(apiRows.length, prevApiCount),
        errorCount: apiErrorsCount,
        serverErrorCount: api5xxCount,
        errorRatePct:
          apiRows.length > 0 ? Number(((apiErrorsCount / apiRows.length) * 100).toFixed(1)) : 0,
        rateLimitEvents,
        avgLatencyMs: apiRows.length > 0 ? apiStats.avgMs : null,
        p50LatencyMs: apiRows.length > 0 ? apiStats.p50Ms : null,
        p95LatencyMs: apiRows.length > 0 ? apiStats.p95Ms : null,
        p99LatencyMs: apiRows.length > 0 ? apiStats.p99Ms : null,
      },
      usageMetrics: {
        paperTradingOrders: Number(paperOrdersRow?.cnt ?? 0),
        workspaceResearchSaved: Number(researchHistRow?.cnt ?? 0),
        marketDataRequests,
        failedOperations: apiErrorsCount + aiFailed + failedJobsCount,
      },
      infrastructure: {
        backendHealth: cfg.maintenance_mode.enabled ? 'MAINTENANCE' : 'HEALTHY',
        dbDialect: db.dialect,
        dbLatencyMs,
        uptimeSeconds: Math.round(process.uptime()),
        nodeVersion: process.version,
        registeredJobsCount: jobs.length,
        failedJobsCount,
        stuckJobsCount,
        workerPaused: workerHeartbeat.queuePaused,
      },
      securityMetrics: {
        openIncidents: Number(openIncidentsRow?.cnt ?? 0),
        openAlerts: openAlertsCount,
        criticalAlerts: criticalAlertsCount,
        failedLogins,
        blockedRequests: rateLimitEvents,
        openSupportTickets: Number(openTicketsRow?.cnt ?? 0),
      },
      charts: {
        userGrowth,
        apiTraffic,
        aiUsage,
      },
      serviceHealth,
      recentActivity: recentAuditRows.map((r) => ({
        id: String(r.id),
        adminEmail: String(r.admin_email),
        action: String(r.action),
        resourceType: String(r.resource_type),
        resourceId: r.resource_id ? String(r.resource_id) : null,
        result: String(r.result),
        createdAt: toIso(r.created_at),
      })),
    };
  }

  // ---- 2. Advanced API Observability ----
  async function getObservabilityApi(query: {
    range?: unknown;
    from?: unknown;
    to?: unknown;
    endpoint?: string;
    method?: string;
    statusCode?: string;
    limit?: number;
    offset?: number;
  }) {
    await telemetryCollector.flushNow();
    const window = resolveObservabilityWindow(query.range, query.from, query.to);
    const cfg = await runtimeConfigManager.getConfig();
    const p95WarnThreshold = cfg.alert_thresholds?.apiP95LatencyWarningMs ?? 1200;

    const conditions: string[] = [];
    const args: unknown[] = [];
    let pgIdx = 1;

    if (window.fromIso) {
      conditions.push(isPg ? `created_at >= $${pgIdx++}::timestamptz` : 'created_at >= ?');
      args.push(window.fromIso);
    }
    conditions.push(isPg ? `created_at <= $${pgIdx++}::timestamptz` : 'created_at <= ?');
    args.push(window.toIso);

    const methodFilter = stripControlChars(query.method ?? '', 12).toUpperCase();
    if (methodFilter && methodFilter !== 'ALL') {
      conditions.push(isPg ? `method = $${pgIdx++}` : 'method = ?');
      args.push(methodFilter);
    }

    const endpointFilter = stripControlChars(query.endpoint ?? '', 120).toLowerCase();
    if (endpointFilter) {
      conditions.push(isPg ? `LOWER(route_path) LIKE $${pgIdx++}` : 'LOWER(route_path) LIKE ?');
      args.push(`%${endpointFilter}%`);
    }

    const statusFilter = stripControlChars(query.statusCode ?? '', 12).toLowerCase();
    if (statusFilter === '2xx') {
      conditions.push('status_code >= 200 AND status_code < 300');
    } else if (statusFilter === '4xx') {
      conditions.push('status_code >= 400 AND status_code < 500');
    } else if (statusFilter === '5xx') {
      conditions.push('status_code >= 500');
    } else if (/^\d{3}$/.test(statusFilter)) {
      conditions.push(isPg ? `status_code = $${pgIdx++}` : 'status_code = ?');
      args.push(Number(statusFilter));
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await db.queryAll<Record<string, unknown>>(
      `SELECT method, route_path, status_code, latency_ms, rate_limited, error_code, created_at
       FROM api_request_logs ${whereClause}
       ORDER BY created_at DESC LIMIT 3000`,
      `SELECT method, route_path, status_code, latency_ms, rate_limited, error_code, created_at
       FROM api_request_logs ${whereClause}
       ORDER BY created_at DESC LIMIT 3000`,
      args,
    );

    const statusBreakdown = { s2xx: 0, s4xx: 0, s5xx: 0 };
    const allLatencies: number[] = [];
    let totalRateLimit = 0;

    const grouped = new Map<
      string,
      {
        method: string;
        routePath: string;
        volume: number;
        errors: number;
        rateLimitCount: number;
        latencies: number[];
        lastObservedAt: string;
      }
    >();

    for (const r of rows) {
      const method = String(r.method);
      const routePath = String(r.route_path);
      const code = Number(r.status_code);
      const lat = Number(r.latency_ms ?? 0);
      const rl = toBool(r.rate_limited);
      const createdAt = toIso(r.created_at);

      allLatencies.push(lat);
      if (rl) totalRateLimit += 1;
      if (code >= 500) statusBreakdown.s5xx += 1;
      else if (code >= 400) statusBreakdown.s4xx += 1;
      else statusBreakdown.s2xx += 1;

      const key = `${method} ${routePath}`;
      const existing = grouped.get(key) ?? {
        method,
        routePath,
        volume: 0,
        errors: 0,
        rateLimitCount: 0,
        latencies: [],
        lastObservedAt: createdAt,
      };
      existing.volume += 1;
      if (code >= 400) existing.errors += 1;
      if (rl) existing.rateLimitCount += 1;
      existing.latencies.push(lat);
      if (createdAt > existing.lastObservedAt) existing.lastObservedAt = createdAt;
      grouped.set(key, existing);
    }

    const overallLatency = computeLatencyStats(allLatencies);
    const totalErrors = statusBreakdown.s4xx + statusBreakdown.s5xx;

    const allEndpoints = Array.from(grouped.values())
      .map((ep) => {
        const stats = computeLatencyStats(ep.latencies);
        return {
          method: ep.method,
          routePath: ep.routePath,
          volume: ep.volume,
          errorCount: ep.errors,
          errorRatePct: ep.volume > 0 ? Number(((ep.errors / ep.volume) * 100).toFixed(1)) : 0,
          rateLimitCount: ep.rateLimitCount,
          avgLatencyMs: stats.avgMs,
          p50LatencyMs: stats.p50Ms,
          p95LatencyMs: stats.p95Ms,
          p99LatencyMs: stats.p99Ms,
          maxLatencyMs: stats.maxMs,
          isSlow: stats.p95Ms >= p95WarnThreshold,
          lastObservedAt: ep.lastObservedAt,
        };
      })
      .sort((a, b) => b.volume - a.volume);

    const limit = Math.max(1, Math.min(100, Number(query.limit) || 30));
    const offset = Math.max(0, Number(query.offset) || 0);
    const endpoints = allEndpoints.slice(offset, offset + limit);

    const slowEndpoints = [...allEndpoints]
      .sort((a, b) => b.p95LatencyMs - a.p95LatencyMs)
      .slice(0, 8);

    const failedRequests = rows
      .filter((r) => Number(r.status_code) >= 400)
      .slice(0, 50)
      .map((r) => ({
        method: String(r.method),
        routePath: String(r.route_path),
        statusCode: Number(r.status_code),
        latencyMs: Number(r.latency_ms ?? 0),
        rateLimited: toBool(r.rate_limited),
        errorCode: r.error_code ? String(r.error_code) : null,
        createdAt: toIso(r.created_at),
      }));

    const trends = buildTimeBuckets(
      rows.map((r) => ({ ts: toIso(r.created_at), isError: Number(r.status_code) >= 400 })),
      window,
    );

    return {
      range: window.range,
      from: window.fromIso,
      to: window.toIso,
      summary: {
        totalVolume: rows.length,
        avgLatencyMs: rows.length > 0 ? overallLatency.avgMs : null,
        p50LatencyMs: rows.length > 0 ? overallLatency.p50Ms : null,
        p95LatencyMs: rows.length > 0 ? overallLatency.p95Ms : null,
        p99LatencyMs: rows.length > 0 ? overallLatency.p99Ms : null,
        errorRatePct: rows.length > 0 ? Number(((totalErrors / rows.length) * 100).toFixed(1)) : 0,
        statusBreakdown,
        rateLimitEvents: totalRateLimit,
      },
      rateLimits: cfg.rate_limits,
      integrations: [
        {
          name: 'Google Gemini API (@google/genai)',
          configured: Boolean(
            process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY',
          ),
          keyMasked: process.env.GEMINI_API_KEY ? 'Configured (server-side only)' : 'Not configured',
        },
        {
          name: `Transactional Email (${emailSender.getProviderName()})`,
          configured: emailSender.isConfigured(),
          keyMasked: emailSender.isConfigured() ? 'Configured (server-side only)' : 'Not configured',
        },
        {
          name: 'Database Driver',
          configured: true,
          keyMasked: db.dialect === 'postgres' ? 'Supabase PostgreSQL Pooler' : 'Local SQLite WAL',
        },
      ],
      endpoints,
      totalEndpoints: allEndpoints.length,
      limit,
      offset,
      slowEndpoints,
      failedRequests,
      trends,
    };
  }

  // ---- 3. AI Intelligence & Model Observability ----
  async function getObservabilityAi(query: {
    range?: unknown;
    from?: unknown;
    to?: unknown;
    status?: string;
    model?: string;
    limit?: number;
    offset?: number;
  }) {
    const window = resolveObservabilityWindow(query.range ?? '7d', query.from, query.to);
    const cfg = await runtimeConfigManager.getConfig();
    const geminiConfigured = Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY',
    );

    const conditions: string[] = [];
    const args: unknown[] = [];
    let pgIdx = 1;
    if (window.fromIso) {
      conditions.push(isPg ? `created_at >= $${pgIdx++}::timestamptz` : 'created_at >= ?');
      args.push(window.fromIso);
    }
    conditions.push(isPg ? `created_at <= $${pgIdx++}::timestamptz` : 'created_at <= ?');
    args.push(window.toIso);

    const statusFilter = stripControlChars(query.status ?? '', 16).toUpperCase();
    if (statusFilter && statusFilter !== 'ALL') {
      conditions.push(isPg ? `status = $${pgIdx++}` : 'status = ?');
      args.push(statusFilter);
    }
    const modelFilter = stripControlChars(query.model ?? '', 64);
    if (modelFilter && modelFilter !== 'ALL') {
      conditions.push(isPg ? `model = $${pgIdx++}` : 'model = ?');
      args.push(modelFilter);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await db.queryAll<Record<string, unknown>>(
      `SELECT id, user_id, symbol, query_preview, feature, provider, model, status, latency_ms,
              prompt_tokens, completion_tokens, total_tokens, error_message, created_at
       FROM ai_request_logs ${whereClause}
       ORDER BY created_at DESC LIMIT 2000`,
      `SELECT id, user_id, symbol, query_preview, feature, provider, model, status, latency_ms,
              prompt_tokens, completion_tokens, total_tokens, error_message, created_at
       FROM ai_request_logs ${whereClause}
       ORDER BY created_at DESC LIMIT 2000`,
      args,
    );

    const byModel = new Map<
      string,
      {
        provider: string;
        model: string;
        count: number;
        success: number;
        fallback: number;
        failed: number;
        blocked: number;
        latencies: number[];
        tokensMeasured: number;
        hasTokenData: boolean;
        lastSuccessAt: string | null;
        lastErrorAt: string | null;
      }
    >();

    for (const r of rows) {
      const provider = String(r.provider);
      const model = String(r.model);
      const status = String(r.status);
      const lat = Number(r.latency_ms ?? 0);
      const ts = toIso(r.created_at);
      const key = `${provider}::${model}`;

      const entry = byModel.get(key) ?? {
        provider,
        model,
        count: 0,
        success: 0,
        fallback: 0,
        failed: 0,
        blocked: 0,
        latencies: [],
        tokensMeasured: 0,
        hasTokenData: false,
        lastSuccessAt: null,
        lastErrorAt: null,
      };
      entry.count += 1;
      entry.latencies.push(lat);
      if (status === 'SUCCESS') {
        entry.success += 1;
        if (!entry.lastSuccessAt || ts > entry.lastSuccessAt) entry.lastSuccessAt = ts;
      } else if (status === 'FALLBACK') {
        entry.fallback += 1;
      } else if (status === 'FAILED') {
        entry.failed += 1;
        if (!entry.lastErrorAt || ts > entry.lastErrorAt) entry.lastErrorAt = ts;
      } else if (status === 'BLOCKED') {
        entry.blocked += 1;
        if (!entry.lastErrorAt || ts > entry.lastErrorAt) entry.lastErrorAt = ts;
      }

      if (typeof r.total_tokens === 'number' && Number.isFinite(r.total_tokens)) {
        entry.tokensMeasured += Number(r.total_tokens);
        entry.hasTokenData = true;
      }
      byModel.set(key, entry);
    }

    const modelBreakdown = Array.from(byModel.values())
      .map((m) => {
        const lat = computeLatencyStats(m.latencies);
        const nonFailed = m.success + m.fallback;
        const successRatePct = m.count > 0 ? Number(((nonFailed / m.count) * 100).toFixed(1)) : 0;
        const availabilityStatus =
          m.provider === 'gemini' && !cfg.ai_config.aiEnabled
            ? 'DISABLED'
            : m.provider === 'gemini' && !geminiConfigured
              ? 'NOT_CONFIGURED'
              : m.failed > 0 && m.success === 0
                ? 'DEGRADED'
                : 'OPERATIONAL';
        return {
          provider: m.provider,
          model: m.model,
          availabilityStatus,
          requestCount: m.count,
          successCount: m.success,
          fallbackCount: m.fallback,
          failedCount: m.failed,
          blockedCount: m.blocked,
          successRatePct,
          avgLatencyMs: lat.avgMs,
          p95LatencyMs: lat.p95Ms,
          totalTokensMeasured: m.hasTokenData ? m.tokensMeasured : null,
          estimatedCostUsd: null,
          lastSuccessAt: m.lastSuccessAt,
          lastErrorAt: m.lastErrorAt,
        };
      })
      .sort((a, b) => b.requestCount - a.requestCount);

    const limit = Math.max(1, Math.min(100, Number(query.limit) || 40));
    const offset = Math.max(0, Number(query.offset) || 0);
    const pagedRows = rows.slice(offset, offset + limit);

    const recentErrors = rows
      .filter((r) => r.status === 'FAILED' || r.status === 'BLOCKED' || Boolean(r.error_message))
      .slice(0, 30)
      .map((r) => ({
        id: String(r.id),
        symbol: String(r.symbol),
        provider: String(r.provider),
        model: String(r.model),
        status: String(r.status),
        latencyMs: Number(r.latency_ms ?? 0),
        errorMessage: redactSensitiveText(String(r.error_message ?? 'Unknown failure'), 280),
        createdAt: toIso(r.created_at),
      }));

    const allLatencies = rows.map((r) => Number(r.latency_ms ?? 0));
    const overallLat = computeLatencyStats(allLatencies);
    const tokenRows = rows.filter(
      (r) => typeof r.total_tokens === 'number' && Number.isFinite(r.total_tokens),
    );
    const totalTokensMeasured =
      tokenRows.length > 0 ? tokenRows.reduce((s, r) => s + Number(r.total_tokens ?? 0), 0) : null;

    return {
      range: window.range,
      from: window.fromIso,
      to: window.toIso,
      summary: {
        totalRequests: rows.length,
        successCount: rows.filter((r) => r.status === 'SUCCESS').length,
        fallbackCount: rows.filter((r) => r.status === 'FALLBACK').length,
        failedCount: rows.filter((r) => r.status === 'FAILED').length,
        blockedCount: rows.filter((r) => r.status === 'BLOCKED').length,
        rateLimitErrors: rows.filter(
          (r) =>
            typeof r.error_message === 'string' &&
            (r.error_message.includes('429') || r.error_message.toLowerCase().includes('rate limit')),
        ).length,
        avgLatencyMs: rows.length > 0 ? overallLat.avgMs : null,
        p95LatencyMs: rows.length > 0 ? overallLat.p95Ms : null,
        totalTokensMeasured,
        estimatedCostUsd: null,
        pricingNote: 'Estimated cost unavailable: provider pricing table not configured.',
        providerConfigured: geminiConfigured,
        aiEnabled: cfg.ai_config.aiEnabled,
      },
      modelBreakdown,
      recentErrors,
      requests: pagedRows.map((r) => ({
        id: String(r.id),
        userId: r.user_id ? String(r.user_id) : null,
        symbol: String(r.symbol),
        // Mask private prompt details by default in general list views
        queryPreview: maskUserPromptSummary(String(r.query_preview ?? ''), String(r.symbol ?? '')),
        promptRedacted: true,
        feature: String(r.feature),
        provider: String(r.provider),
        model: String(r.model),
        status: String(r.status),
        latencyMs: Number(r.latency_ms ?? 0),
        promptTokens: r.prompt_tokens !== null && r.prompt_tokens !== undefined ? Number(r.prompt_tokens) : null,
        completionTokens:
          r.completion_tokens !== null && r.completion_tokens !== undefined
            ? Number(r.completion_tokens)
            : null,
        totalTokens: r.total_tokens !== null && r.total_tokens !== undefined ? Number(r.total_tokens) : null,
        errorMessage: r.error_message ? redactSensitiveText(String(r.error_message), 240) : null,
        createdAt: toIso(r.created_at),
      })),
      total: rows.length,
      limit,
      offset,
      trends: buildTimeBuckets(
        rows.map((r) => ({ ts: toIso(r.created_at), isError: r.status === 'FAILED' })),
        window,
      ),
    };
  }

  async function inspectSensitiveAiRequest(
    actor: ObservabilityActor,
    requestId: string,
  ): Promise<
    ObsOutcome<{
      id: string;
      userId: string | null;
      symbol: string;
      queryPreviewSanitized: string;
      feature: string;
      provider: string;
      model: string;
      status: string;
      latencyMs: number;
      errorMessage: string | null;
      createdAt: string;
    }>
  > {
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM ai_request_logs WHERE id = ?',
      'SELECT * FROM ai_request_logs WHERE id = $1',
      [requestId],
    );
    if (!row) {
      return { ok: false, status: 404, error: 'AI telemetry record not found.' };
    }

    await writeAuditLog({
      actor,
      action: 'ADMIN_AI_SENSITIVE_INSPECT',
      resourceType: 'ai_request_log',
      resourceId: requestId,
      newValue: { symbol: row.symbol, feature: row.feature },
    });

    return {
      ok: true,
      status: 200,
      data: {
        id: String(row.id),
        userId: row.user_id ? String(row.user_id) : null,
        symbol: String(row.symbol),
        queryPreviewSanitized: redactSensitiveText(String(row.query_preview ?? ''), 300),
        feature: String(row.feature),
        provider: String(row.provider),
        model: String(row.model),
        status: String(row.status),
        latencyMs: Number(row.latency_ms ?? 0),
        errorMessage: row.error_message ? redactSensitiveText(String(row.error_message), 300) : null,
        createdAt: toIso(row.created_at),
      },
    };
  }

  // ---- 4. Market Data Observability ----
  async function getObservabilityMarketData(limit = 25) {
    const cfg = await runtimeConfigManager.getConfig();
    const md = cfg.market_data_config;
    const staleThresholdMins = cfg.alert_thresholds?.marketSyncStaleMinutes ?? 1440;

    const healthRows = await db.queryAll<Record<string, unknown>>(
      'SELECT * FROM market_data_health ORDER BY checked_at DESC LIMIT ?',
      'SELECT * FROM market_data_health ORDER BY checked_at DESC LIMIT $1',
      [Math.max(1, Math.min(100, Number(limit) || 25))],
    );

    const history: MarketDataHealthDto[] = healthRows.map((r) => ({
      id: String(r.id),
      providerId: String(r.provider_id),
      providerName: String(r.provider_name),
      status: String(r.status) as MarketDataHealthDto['status'],
      classification: String(r.classification) as MarketDataHealthDto['classification'],
      symbolsProcessed: Number(r.symbols_processed ?? 0),
      failureCount: Number(r.failure_count ?? 0),
      validationFailures: Number(r.validation_failures ?? 0),
      latencyMs: r.latency_ms !== null && r.latency_ms !== undefined ? Number(r.latency_ms) : null,
      detail: String(r.detail ?? ''),
      checkedAt: toIso(r.checked_at),
    }));

    const latestRun = history[0] ?? null;
    const syncRefIso = latestRun?.checkedAt ?? md.lastSyncAt;
    let freshnessStatus: 'FRESH' | 'STALE' | 'NEVER_SYNCED' = 'NEVER_SYNCED';
    let ageMinutes: number | null = null;
    if (syncRefIso) {
      const parsed = Date.parse(syncRefIso);
      if (Number.isFinite(parsed)) {
        ageMinutes = Math.max(0, Math.round((Date.now() - parsed) / 60_000));
        freshnessStatus = ageMinutes <= staleThresholdMins ? 'FRESH' : 'STALE';
      }
    }

    const totalFailures = history.reduce((sum, h) => sum + h.failureCount, 0);
    const totalValidationFailures = history.reduce((sum, h) => sum + h.validationFailures, 0);

    const liveOverview = marketService ? await marketService.getOverview().catch(() => null) : null;
    const providerSnapshots = liveOverview?.providers ?? marketService?.getProviderRegistryStatus() ?? [];

    const mappedProviders =
      providerSnapshots.length > 0
        ? providerSnapshots.map((p) => {
            const matchedRun = history.find((h) => h.providerId === p.id);
            return {
              id: p.id,
              name: p.name,
              classification: p.classification,
              status: p.status,
              symbolsProcessed: matchedRun?.symbolsProcessed ?? p.categories.length,
              failureCount: matchedRun?.failureCount ?? 0,
              validationFailures: matchedRun?.validationFailures ?? 0,
              lastSuccessfulSync: matchedRun?.checkedAt ?? p.lastCheckedAt,
              lastFailedSync:
                history.find((h) => h.providerId === p.id && (h.status === 'DEGRADED' || h.status === 'UNAVAILABLE'))
                  ?.checkedAt ?? null,
              latencyMs: matchedRun?.latencyMs ?? p.latencyMs,
              note: p.detail,
            };
          })
        : [
            {
              id: 'yahoo-finance',
              name: 'Yahoo Finance Chart & Search API',
              classification: md.dataClassification,
              status: md.lastSyncStatus === 'FAILED' ? 'DEGRADED' : 'HEALTHY',
              symbolsProcessed: latestRun?.symbolsProcessed ?? CATALOG_INSTRUMENTS.length,
              failureCount: latestRun?.failureCount ?? 0,
              validationFailures: totalValidationFailures,
              lastSuccessfulSync: md.lastSyncAt,
              lastFailedSync:
                history.find((h) => h.status === 'DEGRADED' || h.status === 'UNAVAILABLE')?.checkedAt ?? null,
              latencyMs: latestRun?.latencyMs ?? null,
              note: md.lastSyncNote,
            },
          ];

    return {
      freshness: {
        status: freshnessStatus,
        lastSyncAt: syncRefIso,
        ageMinutes,
        staleThresholdMinutes: staleThresholdMins,
      },
      summary: {
        classification: liveOverview?.summary.overallStatus ?? md.dataClassification,
        totalInstruments: CATALOG_INSTRUMENTS.length,
        enabledRegions: md.enabledRegions,
        disabledSymbolsCount: md.disabledSymbols.length,
        recordedSyncRuns: history.length,
        totalFailures,
        totalValidationFailures,
      },
      providers: mappedProviders,
      history,
    };
  }

  // ---- 5. Background Jobs Observability ----
  async function getObservabilityJobs() {
    const { jobs, runs, workerHeartbeat } = await jobManager.listJobs();
    const waitSamples = runs.map((r) => r.waitMs).filter((n) => Number.isFinite(n));
    const avgWaitMs =
      waitSamples.length > 0
        ? Math.round(waitSamples.reduce((s, v) => s + v, 0) / waitSamples.length)
        : 0;
    const durationSamples = runs
      .map((r) => r.durationMs)
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
    const durationStats = computeLatencyStats(durationSamples);

    const trends = buildTimeBuckets(
      runs.map((r) => ({ ts: r.startedAt, isError: r.status === 'FAILED' })),
      resolveObservabilityWindow('7d'),
    );

    return {
      workerHeartbeat,
      summary: {
        registeredCount: jobs.length,
        runningCount: jobs.filter((j) => j.status === 'RUNNING').length,
        failedJobsCount: jobs.filter((j) => j.status === 'FAILED').length,
        stuckJobsCount: jobs.filter((j) => j.isStuck).length,
        queuePaused: workerHeartbeat.queuePaused,
        totalRunsSampled: runs.length,
        failedRunsCount: runs.filter((r) => r.status === 'FAILED').length,
        avgWaitMs,
        avgDurationMs: durationSamples.length > 0 ? durationStats.avgMs : null,
      },
      jobs,
      runs,
      trends,
    };
  }

  // ---- 6. Security Observability ----
  async function getObservabilitySecurity(query: {
    range?: unknown;
    from?: unknown;
    to?: unknown;
    severity?: string;
    eventType?: string;
    userId?: string;
    limit?: number;
    offset?: number;
  }) {
    const window = resolveObservabilityWindow(query.range ?? '7d', query.from, query.to);
    const conditions: string[] = [];
    const args: unknown[] = [];
    let pgIdx = 1;

    if (window.fromIso) {
      conditions.push(isPg ? `created_at >= $${pgIdx++}::timestamptz` : 'created_at >= ?');
      args.push(window.fromIso);
    }
    conditions.push(isPg ? `created_at <= $${pgIdx++}::timestamptz` : 'created_at <= ?');
    args.push(window.toIso);

    const eventTypeFilter = stripControlChars(query.eventType ?? '', 64).toLowerCase();
    if (eventTypeFilter && eventTypeFilter !== 'all') {
      conditions.push(isPg ? `LOWER(event_type) LIKE $${pgIdx++}` : 'LOWER(event_type) LIKE ?');
      args.push(`%${eventTypeFilter}%`);
    }

    const userIdFilter = stripControlChars(query.userId ?? '', 80);
    if (userIdFilter) {
      conditions.push(isPg ? `user_id = $${pgIdx++}` : 'user_id = ?');
      args.push(userIdFilter);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rawRows = await db.queryAll<Record<string, unknown>>(
      `SELECT id, user_id, event_type, ip_address, user_agent, detail, created_at
       FROM auth_security_events ${whereClause}
       ORDER BY created_at DESC LIMIT 1000`,
      `SELECT id, user_id, event_type, ip_address, user_agent, detail, created_at
       FROM auth_security_events ${whereClause}
       ORDER BY created_at DESC LIMIT 1000`,
      args,
    );

    const enriched = rawRows.map((e) => {
      const evType = String(e.event_type);
      const detail = redactSensitiveText(String(e.detail ?? ''), 240);
      return {
        id: String(e.id),
        userId: e.user_id ? String(e.user_id) : null,
        eventType: evType,
        severity: classifySecurityEventSeverity(evType, detail),
        ipAddress: String(e.ip_address),
        userAgent: String(e.user_agent),
        detail,
        createdAt: toIso(e.created_at),
      };
    });

    const severityFilter = stripControlChars(query.severity ?? '', 16).toUpperCase();
    const filtered =
      severityFilter && severityFilter !== 'ALL'
        ? enriched.filter((e) => e.severity === severityFilter)
        : enriched;

    // Suspicious pattern grouping (strictly thresholded — never flags a single event)
    const failedByIp = new Map<string, number>();
    for (const ev of enriched) {
      if (ev.eventType === 'login_failed' || ev.eventType === 'login_blocked') {
        failedByIp.set(ev.ipAddress, (failedByIp.get(ev.ipAddress) ?? 0) + 1);
      }
    }
    const repeatedFailureSources = Array.from(failedByIp.entries())
      .filter(([, count]) => count >= 3)
      .map(([ipAddress, count]) => ({
        ipAddress,
        failedAttempts: count,
        classification: 'REPEATED_FAILURES_REVIEW',
      }))
      .sort((a, b) => b.failedAttempts - a.failedAttempts);

    const limit = Math.max(1, Math.min(100, Number(query.limit) || 40));
    const offset = Math.max(0, Number(query.offset) || 0);
    const pagedEvents = filtered.slice(offset, offset + limit);

    const trends = buildTimeBuckets(
      filtered.map((e) => ({
        ts: e.createdAt,
        isError: e.severity === 'CRITICAL' || e.severity === 'HIGH',
      })),
      window,
    );

    return {
      range: window.range,
      from: window.fromIso,
      to: window.toIso,
      summary: {
        totalEvents: filtered.length,
        criticalCount: filtered.filter((e) => e.severity === 'CRITICAL').length,
        highCount: filtered.filter((e) => e.severity === 'HIGH').length,
        mediumCount: filtered.filter((e) => e.severity === 'MEDIUM').length,
        lowCount: filtered.filter((e) => e.severity === 'LOW').length,
        repeatedFailureSources,
      },
      events: pagedEvents,
      total: filtered.length,
      limit,
      offset,
      trends,
    };
  }

  // ---- 7. Alerting & Threshold Rules ----
  async function getThresholdsConfig(): Promise<ObservabilityThresholdsConfig> {
    const cfg = await runtimeConfigManager.getConfig();
    return cfg.alert_thresholds;
  }

  async function updateThresholdsConfig(
    actor: ObservabilityActor,
    patch: Record<string, unknown>,
  ): Promise<ObsOutcome<{ thresholds: ObservabilityThresholdsConfig }>> {
    const current = await getThresholdsConfig();
    const num = (val: unknown, fallback: number, min: number, max: number) => {
      if (val === undefined || val === null) return fallback;
      const n = Number(val);
      if (!Number.isFinite(n)) return NaN;
      return n < min || n > max ? NaN : Math.round(n);
    };

    const next: ObservabilityThresholdsConfig = {
      apiErrorRateCriticalPct: num(patch.apiErrorRateCriticalPct, current.apiErrorRateCriticalPct, 1, 100),
      apiP95LatencyWarningMs: num(patch.apiP95LatencyWarningMs, current.apiP95LatencyWarningMs, 100, 30000),
      aiFailureRateWarningPct: num(patch.aiFailureRateWarningPct, current.aiFailureRateWarningPct, 1, 100),
      failedLoginsBurstThreshold: num(patch.failedLoginsBurstThreshold, current.failedLoginsBurstThreshold, 2, 500),
      marketSyncStaleMinutes: num(patch.marketSyncStaleMinutes, current.marketSyncStaleMinutes, 5, 43200),
      stuckJobMinutes: num(patch.stuckJobMinutes, current.stuckJobMinutes, 1, 1440),
      alertCooldownMinutes: num(patch.alertCooldownMinutes, current.alertCooldownMinutes, 1, 1440),
      retentionDays: num(patch.retentionDays, current.retentionDays, 7, 90),
    };

    if (Object.values(next).some((v) => !Number.isFinite(v))) {
      return {
        ok: false,
        status: 400,
        error: 'Threshold values must be finite numbers within safe operational bounds (retentionDays 7–90).',
      };
    }

    const { previous } = await runtimeConfigManager.updateSetting(
      'alert_thresholds',
      next,
      actor.userId,
      'Observability alert threshold policy update',
    );

    await writeAuditLog({
      actor,
      action: 'OBSERVABILITY_THRESHOLDS_UPDATE',
      resourceType: 'platform_settings',
      resourceId: 'alert_thresholds',
      previousValue: previous,
      newValue: next,
    });

    return { ok: true, status: 200, data: { thresholds: next } };
  }

  async function evaluateAlerts(actor?: ObservabilityActor) {
    await telemetryCollector.flushNow();
    const cfg = await runtimeConfigManager.getConfig();
    const thresholds = cfg.alert_thresholds;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const oneHourAgoIso = new Date(nowMs - 60 * 60 * 1000).toISOString();
    const fifteenMinAgoIso = new Date(nowMs - 15 * 60 * 1000).toISOString();

    const [apiRows, aiRows, secFailRow, jobsState] = await Promise.all([
      db.queryAll<{ status_code: number; latency_ms: number; rate_limited: number | boolean }>(
        'SELECT status_code, latency_ms, rate_limited FROM api_request_logs WHERE created_at >= ?',
        'SELECT status_code, latency_ms, rate_limited FROM api_request_logs WHERE created_at >= $1::timestamptz',
        [oneHourAgoIso],
      ),
      db.queryAll<{ status: string }>(
        'SELECT status FROM ai_request_logs WHERE created_at >= ?',
        'SELECT status FROM ai_request_logs WHERE created_at >= $1::timestamptz',
        [oneHourAgoIso],
      ),
      db.queryOne<{ cnt: number | string }>(
        `SELECT COUNT(*) AS cnt FROM auth_security_events
         WHERE event_type IN ('login_failed', 'login_blocked') AND created_at >= ?`,
        `SELECT COUNT(*) AS cnt FROM auth_security_events
         WHERE event_type IN ('login_failed', 'login_blocked') AND created_at >= $1::timestamptz`,
        [fifteenMinAgoIso],
      ),
      jobManager.listJobs(),
    ]);

    const apiLat = computeLatencyStats(apiRows.map((r) => Number(r.latency_ms ?? 0)));
    const apiErrors = apiRows.filter((r) => Number(r.status_code) >= 500).length;
    const apiErrorRatePct =
      apiRows.length > 0 ? Number(((apiErrors / apiRows.length) * 100).toFixed(1)) : 0;

    const aiFailed = aiRows.filter((r) => r.status === 'FAILED').length;
    const aiErrorRatePct =
      aiRows.length > 0 ? Number(((aiFailed / aiRows.length) * 100).toFixed(1)) : 0;

    const mdSyncAgeMins = cfg.market_data_config.lastSyncAt
      ? Math.max(0, (nowMs - Date.parse(cfg.market_data_config.lastSyncAt)) / 60_000)
      : null;

    const stuckJobs = jobsState.jobs.filter((j) => j.isStuck);
    const failedJobs = jobsState.jobs.filter((j) => j.status === 'FAILED');

    const candidates = evaluateAlertCandidates(
      {
        apiTotal: apiRows.length,
        api5xxCount: apiErrors,
        apiErrorRatePct,
        apiP95LatencyMs: apiLat.p95Ms,
        apiRateLimitCount: apiRows.filter((r) => toBool(r.rate_limited)).length,
        aiTotal: aiRows.length,
        aiFailedCount: aiFailed,
        aiErrorRatePct,
        failedLoginsWindow: Number(secFailRow?.cnt ?? 0),
        marketLastSyncAgeMinutes:
          mdSyncAgeMins !== null && Number.isFinite(mdSyncAgeMins) ? mdSyncAgeMins : null,
        marketLastSyncStatus: cfg.market_data_config.lastSyncStatus,
        stuckJobsCount: stuckJobs.length,
        failedJobsCount: failedJobs.length,
        stuckJobIds: stuckJobs.map((j) => j.id),
        failedJobIds: failedJobs.map((j) => j.id),
      },
      thresholds,
    );

    const created: OperationalAlertDto[] = [];
    const updated: OperationalAlertDto[] = [];
    const cooldownMs = thresholds.alertCooldownMinutes * 60 * 1000;
    const nextCooldownIso = new Date(nowMs + cooldownMs).toISOString();

    for (const cand of candidates) {
      const existing = await db.queryOne<Record<string, unknown>>(
        'SELECT * FROM operational_alerts WHERE fingerprint = ?',
        'SELECT * FROM operational_alerts WHERE fingerprint = $1',
        [cand.fingerprint],
      );

      if (!existing) {
        const alertId = crypto.randomUUID();
        await db.execute(
          `INSERT INTO operational_alerts
           (id, fingerprint, category, title, description, severity, status, source, service_id,
            metric_value, threshold_value, occurrence_count, event_refs_json, internal_notes,
            first_detected_at, last_detected_at, cooldown_until, resolved_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'OPEN', 'threshold_engine', ?, ?, ?, 1, ?, '', ?, ?, ?, NULL, ?)`,
          `INSERT INTO operational_alerts
           (id, fingerprint, category, title, description, severity, status, source, service_id,
            metric_value, threshold_value, occurrence_count, event_refs_json, internal_notes,
            first_detected_at, last_detected_at, cooldown_until, resolved_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', 'threshold_engine', $7, $8, $9, 1, $10, '', $11::timestamptz, $12::timestamptz, $13::timestamptz, NULL, $14::timestamptz)`,
          [
            alertId,
            cand.fingerprint,
            cand.category,
            cand.title.slice(0, 180),
            cand.description,
            cand.severity,
            cand.serviceId,
            cand.metricValue,
            cand.thresholdValue,
            JSON.stringify(cand.eventRefs),
            nowIso,
            nowIso,
            nextCooldownIso,
            nowIso,
          ],
        );

        await db.execute(
          `INSERT INTO alert_history (id, alert_id, previous_status, new_status, actor_id, actor_email, note, created_at)
           VALUES (?, ?, NULL, 'OPEN', ?, ?, ?, ?)`,
          `INSERT INTO alert_history (id, alert_id, previous_status, new_status, actor_id, actor_email, note, created_at)
           VALUES ($1, $2, NULL, 'OPEN', $3, $4, $5, $6::timestamptz)`,
          [
            crypto.randomUUID(),
            alertId,
            actor?.userId ?? null,
            actor?.email ?? 'alert_engine',
            `Alert triggered: metric=${cand.metricValue} vs threshold=${cand.thresholdValue}`,
            nowIso,
          ],
        );

        const row = await db.queryOne<Record<string, unknown>>(
          'SELECT * FROM operational_alerts WHERE id = ?',
          'SELECT * FROM operational_alerts WHERE id = $1',
          [alertId],
        );
        if (row) created.push(mapAlertRow(row));
      } else {
        const prevStatus = String(existing.status) as AlertStatus;
        const prevSeverity = String(existing.severity) as AlertSeverity;
        const cooldownActive =
          existing.cooldown_until && Date.parse(toIso(existing.cooldown_until)) > nowMs;
        const escalated = shouldBypassCooldownOnSeverityEscalation(prevSeverity, cand.severity);

        let nextStatus = prevStatus;
        if (prevStatus === 'RESOLVED' && (!cooldownActive || escalated)) {
          nextStatus = 'OPEN';
        } else if (prevStatus === 'SUPPRESSED' && !cooldownActive && escalated) {
          nextStatus = 'OPEN';
        }

        await db.execute(
          `UPDATE operational_alerts
           SET title = ?, description = ?, severity = ?, status = ?, metric_value = ?, threshold_value = ?,
               occurrence_count = occurrence_count + 1, last_detected_at = ?, updated_at = ?,
               resolved_at = CASE WHEN ? = 'OPEN' THEN NULL ELSE resolved_at END
           WHERE id = ?`,
          `UPDATE operational_alerts
           SET title = $1, description = $2, severity = $3, status = $4, metric_value = $5, threshold_value = $6,
               occurrence_count = occurrence_count + 1, last_detected_at = $7::timestamptz, updated_at = $8::timestamptz,
               resolved_at = CASE WHEN $9 = 'OPEN' THEN NULL ELSE resolved_at END
           WHERE id = $10`,
          [
            cand.title.slice(0, 180),
            cand.description,
            cand.severity,
            nextStatus,
            cand.metricValue,
            cand.thresholdValue,
            nowIso,
            nowIso,
            nextStatus,
            String(existing.id),
          ],
        );

        if (nextStatus !== prevStatus) {
          await db.execute(
            `INSERT INTO alert_history (id, alert_id, previous_status, new_status, actor_id, actor_email, note, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            `INSERT INTO alert_history (id, alert_id, previous_status, new_status, actor_id, actor_email, note, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
            [
              crypto.randomUUID(),
              String(existing.id),
              prevStatus,
              nextStatus,
              actor?.userId ?? null,
              actor?.email ?? 'alert_engine',
              escalated ? 'Re-opened due to severity escalation' : 'Re-opened after cooldown expiry',
              nowIso,
            ],
          );
        }

        const refreshed = await db.queryOne<Record<string, unknown>>(
          'SELECT * FROM operational_alerts WHERE id = ?',
          'SELECT * FROM operational_alerts WHERE id = $1',
          [String(existing.id)],
        );
        if (refreshed) updated.push(mapAlertRow(refreshed));
      }
    }

    return {
      evaluatedAt: nowIso,
      candidatesDetected: candidates.length,
      createdCount: created.length,
      updatedCount: updated.length,
      created,
      updated,
    };
  }

  async function listAlerts(query: {
    status?: string;
    severity?: string;
    category?: string;
    limit?: number;
    offset?: number;
  }) {
    const conditions: string[] = [];
    const args: unknown[] = [];
    let pgIdx = 1;

    const statusFilter = stripControlChars(query.status ?? '', 20).toUpperCase();
    if (
      statusFilter === 'OPEN' ||
      statusFilter === 'ACKNOWLEDGED' ||
      statusFilter === 'RESOLVED' ||
      statusFilter === 'SUPPRESSED'
    ) {
      conditions.push(isPg ? `status = $${pgIdx++}` : 'status = ?');
      args.push(statusFilter);
    }

    const sevFilter = stripControlChars(query.severity ?? '', 16).toUpperCase();
    if (sevFilter === 'CRITICAL' || sevFilter === 'HIGH' || sevFilter === 'MEDIUM' || sevFilter === 'LOW') {
      conditions.push(isPg ? `severity = $${pgIdx++}` : 'severity = ?');
      args.push(sevFilter);
    }

    const catFilter = stripControlChars(query.category ?? '', 24).toUpperCase();
    if (
      catFilter === 'API' ||
      catFilter === 'AI' ||
      catFilter === 'SECURITY' ||
      catFilter === 'MARKET_DATA' ||
      catFilter === 'BACKGROUND_JOB' ||
      catFilter === 'SYSTEM'
    ) {
      conditions.push(isPg ? `category = $${pgIdx++}` : 'category = ?');
      args.push(catFilter);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 40));
    const offset = Math.max(0, Number(query.offset) || 0);

    const [totalRow, rows, summaryRows] = await Promise.all([
      db.queryOne<{ cnt: number | string }>(
        `SELECT COUNT(*) AS cnt FROM operational_alerts ${whereClause}`,
        `SELECT COUNT(*) AS cnt FROM operational_alerts ${whereClause}`,
        args,
      ),
      db.queryAll<Record<string, unknown>>(
        `SELECT * FROM operational_alerts ${whereClause}
         ORDER BY last_detected_at DESC
         LIMIT ? OFFSET ?`,
        `SELECT * FROM operational_alerts ${whereClause}
         ORDER BY last_detected_at DESC
         LIMIT $${pgIdx++} OFFSET $${pgIdx++}`,
        [...args, limit, offset],
      ),
      db.queryAll<{ status: string; severity: string }>(
        'SELECT status, severity FROM operational_alerts',
        'SELECT status, severity FROM operational_alerts',
      ),
    ]);

    return {
      alerts: rows.map(mapAlertRow),
      total: Number(totalRow?.cnt ?? 0),
      limit,
      offset,
      summary: {
        open: summaryRows.filter((r) => r.status === 'OPEN').length,
        acknowledged: summaryRows.filter((r) => r.status === 'ACKNOWLEDGED').length,
        resolved: summaryRows.filter((r) => r.status === 'RESOLVED').length,
        suppressed: summaryRows.filter((r) => r.status === 'SUPPRESSED').length,
        criticalOpen: summaryRows.filter(
          (r) => (r.status === 'OPEN' || r.status === 'ACKNOWLEDGED') && r.severity === 'CRITICAL',
        ).length,
      },
    };
  }

  async function getAlertDetail(alertId: string): Promise<
    ObsOutcome<{ alert: OperationalAlertDto; history: AlertHistoryDto[] }>
  > {
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM operational_alerts WHERE id = ?',
      'SELECT * FROM operational_alerts WHERE id = $1',
      [alertId],
    );
    if (!row) {
      return { ok: false, status: 404, error: 'Operational alert not found.' };
    }
    const historyRows = await db.queryAll<Record<string, unknown>>(
      'SELECT * FROM alert_history WHERE alert_id = ? ORDER BY created_at DESC LIMIT 50',
      'SELECT * FROM alert_history WHERE alert_id = $1 ORDER BY created_at DESC LIMIT 50',
      [alertId],
    );
    return {
      ok: true,
      status: 200,
      data: {
        alert: mapAlertRow(row),
        history: historyRows.map((h) => ({
          id: String(h.id),
          alertId: String(h.alert_id),
          previousStatus: h.previous_status ? String(h.previous_status) : null,
          newStatus: String(h.new_status),
          actorId: h.actor_id ? String(h.actor_id) : null,
          actorEmail: String(h.actor_email ?? 'system'),
          note: String(h.note ?? ''),
          createdAt: toIso(h.created_at),
        })),
      },
    };
  }

  async function updateAlertStatus(
    actor: ObservabilityActor,
    alertId: string,
    payload: { action?: unknown; note?: unknown; suppressMinutes?: unknown },
  ): Promise<ObsOutcome<{ alert: OperationalAlertDto }>> {
    const existing = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM operational_alerts WHERE id = ?',
      'SELECT * FROM operational_alerts WHERE id = $1',
      [alertId],
    );
    if (!existing) {
      return { ok: false, status: 404, error: 'Operational alert not found.' };
    }

    const action = typeof payload.action === 'string' ? payload.action.trim().toUpperCase() : '';
    const note = stripControlChars(
      typeof payload.note === 'string' ? payload.note : '',
      1000,
      { allowNewlines: true },
    );
    const prevStatus = String(existing.status) as AlertStatus;
    let nextStatus: AlertStatus = prevStatus;

    if (action === 'ACKNOWLEDGE') nextStatus = 'ACKNOWLEDGED';
    else if (action === 'RESOLVE') nextStatus = 'RESOLVED';
    else if (action === 'SUPPRESS') nextStatus = 'SUPPRESSED';
    else if (action === 'REOPEN') nextStatus = 'OPEN';
    else if (action !== 'NOTE') {
      return {
        ok: false,
        status: 400,
        error: 'Action must be one of ACKNOWLEDGE, RESOLVE, SUPPRESS, REOPEN, or NOTE.',
      };
    }

    const nowIso = new Date().toISOString();
    const cfg = await getThresholdsConfig();
    const suppressMins = Math.max(
      5,
      Math.min(10080, Number(payload.suppressMinutes) || cfg.alertCooldownMinutes || 60),
    );
    const cooldownUntil =
      nextStatus === 'SUPPRESSED' || nextStatus === 'RESOLVED'
        ? new Date(Date.now() + suppressMins * 60_000).toISOString()
        : existing.cooldown_until
          ? toIso(existing.cooldown_until)
          : null;

    const resolvedAt =
      nextStatus === 'RESOLVED'
        ? existing.resolved_at
          ? toIso(existing.resolved_at)
          : nowIso
        : nextStatus === 'OPEN'
          ? null
          : existing.resolved_at
            ? toIso(existing.resolved_at)
            : null;

    const acknowledgedBy =
      nextStatus === 'ACKNOWLEDGED'
        ? actor.userId
        : existing.acknowledged_by
          ? String(existing.acknowledged_by)
          : null;
    const resolvedBy =
      nextStatus === 'RESOLVED'
        ? actor.userId
        : nextStatus === 'OPEN'
          ? null
          : existing.resolved_by
            ? String(existing.resolved_by)
            : null;

    const mergedNotes = note
      ? existing.internal_notes
        ? `${String(existing.internal_notes)}\n[${nowIso} · ${actor.email}] ${note}`.slice(-2500)
        : `[${nowIso} · ${actor.email}] ${note}`
      : String(existing.internal_notes ?? '');

    await db.execute(
      `UPDATE operational_alerts
       SET status = ?, internal_notes = ?, acknowledged_by = ?, resolved_by = ?, cooldown_until = ?, resolved_at = ?, updated_at = ?
       WHERE id = ?`,
      `UPDATE operational_alerts
       SET status = $1, internal_notes = $2, acknowledged_by = $3, resolved_by = $4, cooldown_until = $5::timestamptz, resolved_at = $6::timestamptz, updated_at = $7::timestamptz
       WHERE id = $8`,
      [nextStatus, mergedNotes, acknowledgedBy, resolvedBy, cooldownUntil, resolvedAt, nowIso, alertId],
    );

    await db.execute(
      `INSERT INTO alert_history (id, alert_id, previous_status, new_status, actor_id, actor_email, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      `INSERT INTO alert_history (id, alert_id, previous_status, new_status, actor_id, actor_email, note, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
      [
        crypto.randomUUID(),
        alertId,
        prevStatus,
        nextStatus,
        actor.userId,
        actor.email,
        note || `${action} triggered by administrator`,
        nowIso,
      ],
    );

    await writeAuditLog({
      actor,
      action: `ALERT_${action}`,
      resourceType: 'operational_alert',
      resourceId: alertId,
      previousValue: { status: prevStatus },
      newValue: { status: nextStatus, note },
    });

    const updated = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM operational_alerts WHERE id = ?',
      'SELECT * FROM operational_alerts WHERE id = $1',
      [alertId],
    );
    return { ok: true, status: 200, data: { alert: mapAlertRow(updated!) } };
  }

  // ---- 8. Incident Response & Immutable Timeline ----
  async function listIncidents(query: {
    status?: string;
    severity?: string;
    limit?: number;
    offset?: number;
  }) {
    const conditions: string[] = [];
    const args: unknown[] = [];
    let pgIdx = 1;

    const statusFilter = stripControlChars(query.status ?? '', 24).toUpperCase();
    if (
      statusFilter === 'OPEN' ||
      statusFilter === 'INVESTIGATING' ||
      statusFilter === 'IDENTIFIED' ||
      statusFilter === 'MONITORING' ||
      statusFilter === 'MITIGATED' ||
      statusFilter === 'RESOLVED'
    ) {
      conditions.push(isPg ? `status = $${pgIdx++}` : 'status = ?');
      args.push(statusFilter);
    }

    const sevFilter = stripControlChars(query.severity ?? '', 16).toUpperCase();
    if (sevFilter === 'CRITICAL' || sevFilter === 'HIGH' || sevFilter === 'MEDIUM' || sevFilter === 'LOW') {
      conditions.push(isPg ? `severity = $${pgIdx++}` : 'severity = ?');
      args.push(sevFilter);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 40));
    const offset = Math.max(0, Number(query.offset) || 0);

    const [totalRow, rows] = await Promise.all([
      db.queryOne<{ cnt: number | string }>(
        `SELECT COUNT(*) AS cnt FROM admin_incidents ${whereClause}`,
        `SELECT COUNT(*) AS cnt FROM admin_incidents ${whereClause}`,
        args,
      ),
      db.queryAll<Record<string, unknown>>(
        `SELECT * FROM admin_incidents ${whereClause}
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        `SELECT * FROM admin_incidents ${whereClause}
         ORDER BY created_at DESC LIMIT $${pgIdx++} OFFSET $${pgIdx++}`,
        [...args, limit, offset],
      ),
    ]);

    return {
      incidents: rows.map(mapIncidentRow),
      total: Number(totalRow?.cnt ?? 0),
      limit,
      offset,
    };
  }

  async function getIncidentDetail(
    incidentId: string,
  ): Promise<ObsOutcome<{ incident: AdminIncidentDto; timeline: IncidentEventDto[] }>> {
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM admin_incidents WHERE id = ?',
      'SELECT * FROM admin_incidents WHERE id = $1',
      [incidentId],
    );
    if (!row) {
      return { ok: false, status: 404, error: 'Incident not found.' };
    }
    const eventRows = await db.queryAll<Record<string, unknown>>(
      'SELECT * FROM incident_events WHERE incident_id = ? ORDER BY created_at ASC',
      'SELECT * FROM incident_events WHERE incident_id = $1 ORDER BY created_at ASC',
      [incidentId],
    );
    const incident = mapIncidentRow(row);
    const timeline = eventRows.map(mapIncidentEventRow);
    incident.timeline = timeline;
    return { ok: true, status: 200, data: { incident, timeline } };
  }

  async function createIncident(
    actor: ObservabilityActor,
    input: {
      title: unknown;
      description: unknown;
      severity?: unknown;
      source?: unknown;
      ownerEmail?: unknown;
      linkedAlertIds?: unknown;
      linkedEventRefs?: unknown;
    },
  ): Promise<ObsOutcome<{ incident: AdminIncidentDto }>> {
    const title = stripControlChars(typeof input.title === 'string' ? input.title : '', 160);
    const description = stripControlChars(
      typeof input.description === 'string' ? input.description : '',
      2000,
      { allowNewlines: true },
    );
    const severity: IncidentSeverity =
      input.severity === 'CRITICAL' ||
      input.severity === 'HIGH' ||
      input.severity === 'MEDIUM' ||
      input.severity === 'LOW'
        ? input.severity
        : 'MEDIUM';
    const source = stripControlChars(typeof input.source === 'string' ? input.source : 'admin_manual', 64) || 'admin_manual';
    const ownerEmail = stripControlChars(
      typeof input.ownerEmail === 'string' && input.ownerEmail.trim()
        ? input.ownerEmail
        : actor.email,
      180,
    );

    const linkedAlertIds = Array.isArray(input.linkedAlertIds)
      ? Array.from(
          new Set(
            input.linkedAlertIds
              .filter((x): x is string => typeof x === 'string')
              .map((x) => stripControlChars(x, 80))
              .filter(Boolean),
          ),
        ).slice(0, 20)
      : [];
    const linkedEventRefs = Array.isArray(input.linkedEventRefs)
      ? Array.from(
          new Set(
            input.linkedEventRefs
              .filter((x): x is string => typeof x === 'string')
              .map((x) => stripControlChars(x, 120))
              .filter(Boolean),
          ),
        ).slice(0, 20)
      : [];

    if (title.length < 3 || description.length < 5) {
      return { ok: false, status: 400, error: 'Incident title and description are required.' };
    }

    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    await db.withTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO admin_incidents
         (id, title, description, severity, status, source, assigned_admin_id, owner_email, linked_alert_ids_json, linked_event_refs_json, resolution_notes, created_by, created_at, updated_at, resolved_at)
         VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, '', ?, ?, ?, NULL)`,
        `INSERT INTO admin_incidents
         (id, title, description, severity, status, source, assigned_admin_id, owner_email, linked_alert_ids_json, linked_event_refs_json, resolution_notes, created_by, created_at, updated_at, resolved_at)
         VALUES ($1, $2, $3, $4, 'OPEN', $5, $6, $7, $8, $9, '', $10, $11::timestamptz, $12::timestamptz, NULL)`,
        [
          id,
          title,
          description,
          severity,
          source,
          actor.userId,
          ownerEmail,
          JSON.stringify(linkedAlertIds),
          JSON.stringify(linkedEventRefs),
          actor.userId,
          nowIso,
          nowIso,
        ],
      );

      await tx.execute(
        `INSERT INTO incident_events
         (id, incident_id, event_type, previous_status, new_status, actor_id, actor_email, note, linked_alert_id, linked_event_ref, created_at)
         VALUES (?, ?, 'CREATED', NULL, 'OPEN', ?, ?, ?, ?, ?, ?)`,
        `INSERT INTO incident_events
         (id, incident_id, event_type, previous_status, new_status, actor_id, actor_email, note, linked_alert_id, linked_event_ref, created_at)
         VALUES ($1, $2, 'CREATED', NULL, 'OPEN', $3, $4, $5, $6, $7, $8::timestamptz)`,
        [
          crypto.randomUUID(),
          id,
          actor.userId,
          actor.email,
          `Incident created (${severity}): ${title}`,
          linkedAlertIds[0] ?? null,
          linkedEventRefs[0] ?? null,
          nowIso,
        ],
      );
    });

    await writeAuditLog({
      actor,
      action: 'INCIDENT_CREATE',
      resourceType: 'admin_incident',
      resourceId: id,
      newValue: { title, severity, status: 'OPEN', ownerEmail, linkedAlertIds },
    });

    const detail = await getIncidentDetail(id);
    if (!detail.ok) return detail;
    return { ok: true, status: 201, data: { incident: detail.data.incident } };
  }

  async function updateIncident(
    actor: ObservabilityActor,
    incidentId: string,
    patch: {
      status?: unknown;
      resolutionNotes?: unknown;
      assignedAdminId?: unknown;
      ownerEmail?: unknown;
      note?: unknown;
      linkAlertId?: unknown;
      linkEventRef?: unknown;
    },
  ): Promise<ObsOutcome<{ incident: AdminIncidentDto }>> {
    const existing = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM admin_incidents WHERE id = ?',
      'SELECT * FROM admin_incidents WHERE id = $1',
      [incidentId],
    );
    if (!existing) {
      return { ok: false, status: 404, error: 'Incident not found.' };
    }

    const prevStatus = String(existing.status) as IncidentStatus;
    const allowedStatuses = new Set<IncidentStatus>([
      'OPEN',
      'INVESTIGATING',
      'IDENTIFIED',
      'MONITORING',
      'MITIGATED',
      'RESOLVED',
    ]);
    const requestedStatus =
      typeof patch.status === 'string' ? (patch.status.trim().toUpperCase() as IncidentStatus) : undefined;
    if (requestedStatus && !allowedStatuses.has(requestedStatus)) {
      return { ok: false, status: 400, error: 'Unsupported incident workflow status.' };
    }
    const nextStatus = requestedStatus ?? prevStatus;

    const nextNotes =
      typeof patch.resolutionNotes === 'string'
        ? stripControlChars(patch.resolutionNotes, 2000, { allowNewlines: true })
        : String(existing.resolution_notes ?? '');
    const noteText = stripControlChars(
      typeof patch.note === 'string' ? patch.note : '',
      1000,
      { allowNewlines: true },
    );
    const nextOwnerEmail =
      typeof patch.ownerEmail === 'string'
        ? stripControlChars(patch.ownerEmail, 180)
        : String(existing.owner_email ?? '');
    const nextAssignedAdminId =
      typeof patch.assignedAdminId === 'string'
        ? stripControlChars(patch.assignedAdminId, 80) || null
        : existing.assigned_admin_id
          ? String(existing.assigned_admin_id)
          : null;

    const linkedAlertIds = parseJsonStringArray(existing.linked_alert_ids_json);
    const linkAlertId =
      typeof patch.linkAlertId === 'string' ? stripControlChars(patch.linkAlertId, 80) : '';
    if (linkAlertId && !linkedAlertIds.includes(linkAlertId)) {
      linkedAlertIds.push(linkAlertId);
    }

    const linkedEventRefs = parseJsonStringArray(existing.linked_event_refs_json);
    const linkEventRef =
      typeof patch.linkEventRef === 'string' ? stripControlChars(patch.linkEventRef, 120) : '';
    if (linkEventRef && !linkedEventRefs.includes(linkEventRef)) {
      linkedEventRefs.push(linkEventRef);
    }

    const nowIso = new Date().toISOString();
    const resolvedAt =
      nextStatus === 'RESOLVED'
        ? existing.resolved_at
          ? toIso(existing.resolved_at)
          : nowIso
        : null;

    await db.withTransaction(async (tx) => {
      await tx.execute(
        `UPDATE admin_incidents
         SET status = ?, resolution_notes = ?, assigned_admin_id = ?, owner_email = ?,
             linked_alert_ids_json = ?, linked_event_refs_json = ?, updated_at = ?, resolved_at = ?
         WHERE id = ?`,
        `UPDATE admin_incidents
         SET status = $1, resolution_notes = $2, assigned_admin_id = $3, owner_email = $4,
             linked_alert_ids_json = $5, linked_event_refs_json = $6, updated_at = $7::timestamptz, resolved_at = $8::timestamptz
         WHERE id = $9`,
        [
          nextStatus,
          nextNotes,
          nextAssignedAdminId,
          nextOwnerEmail,
          JSON.stringify(linkedAlertIds),
          JSON.stringify(linkedEventRefs),
          nowIso,
          resolvedAt,
          incidentId,
        ],
      );

      if (nextStatus !== prevStatus) {
        await tx.execute(
          `INSERT INTO incident_events (id, incident_id, event_type, previous_status, new_status, actor_id, actor_email, note, linked_alert_id, linked_event_ref, created_at)
           VALUES (?, ?, 'STATUS_CHANGED', ?, ?, ?, ?, ?, NULL, NULL, ?)`,
          `INSERT INTO incident_events (id, incident_id, event_type, previous_status, new_status, actor_id, actor_email, note, linked_alert_id, linked_event_ref, created_at)
           VALUES ($1, $2, 'STATUS_CHANGED', $3, $4, $5, $6, $7, NULL, NULL, $8::timestamptz)`,
          [
            crypto.randomUUID(),
            incidentId,
            prevStatus,
            nextStatus,
            actor.userId,
            actor.email,
            noteText || `Status transitioned from ${prevStatus} to ${nextStatus}`,
            nowIso,
          ],
        );
      } else if (noteText) {
        await tx.execute(
          `INSERT INTO incident_events (id, incident_id, event_type, previous_status, new_status, actor_id, actor_email, note, linked_alert_id, linked_event_ref, created_at)
           VALUES (?, ?, 'NOTE_ADDED', NULL, NULL, ?, ?, ?, NULL, NULL, ?)`,
          `INSERT INTO incident_events (id, incident_id, event_type, previous_status, new_status, actor_id, actor_email, note, linked_alert_id, linked_event_ref, created_at)
           VALUES ($1, $2, 'NOTE_ADDED', NULL, NULL, $3, $4, $5, NULL, NULL, $6::timestamptz)`,
          [crypto.randomUUID(), incidentId, actor.userId, actor.email, noteText, nowIso],
        );
      }

      if (nextOwnerEmail !== String(existing.owner_email ?? '')) {
        await tx.execute(
          `INSERT INTO incident_events (id, incident_id, event_type, previous_status, new_status, actor_id, actor_email, note, linked_alert_id, linked_event_ref, created_at)
           VALUES (?, ?, 'OWNER_ASSIGNED', NULL, NULL, ?, ?, ?, NULL, NULL, ?)`,
          `INSERT INTO incident_events (id, incident_id, event_type, previous_status, new_status, actor_id, actor_email, note, linked_alert_id, linked_event_ref, created_at)
           VALUES ($1, $2, 'OWNER_ASSIGNED', NULL, NULL, $3, $4, $5, NULL, NULL, $6::timestamptz)`,
          [
            crypto.randomUUID(),
            incidentId,
            actor.userId,
            actor.email,
            `Owner assigned to ${nextOwnerEmail || 'unassigned'}`,
            nowIso,
          ],
        );
      }

      if (linkAlertId) {
        await tx.execute(
          `INSERT INTO incident_events (id, incident_id, event_type, previous_status, new_status, actor_id, actor_email, note, linked_alert_id, linked_event_ref, created_at)
           VALUES (?, ?, 'ALERT_LINKED', NULL, NULL, ?, ?, ?, ?, NULL, ?)`,
          `INSERT INTO incident_events (id, incident_id, event_type, previous_status, new_status, actor_id, actor_email, note, linked_alert_id, linked_event_ref, created_at)
           VALUES ($1, $2, 'ALERT_LINKED', NULL, NULL, $3, $4, $5, $6, NULL, $7::timestamptz)`,
          [
            crypto.randomUUID(),
            incidentId,
            actor.userId,
            actor.email,
            `Linked operational alert ${linkAlertId}`,
            linkAlertId,
            nowIso,
          ],
        );
      }

      if (linkEventRef) {
        await tx.execute(
          `INSERT INTO incident_events (id, incident_id, event_type, previous_status, new_status, actor_id, actor_email, note, linked_alert_id, linked_event_ref, created_at)
           VALUES (?, ?, 'TELEMETRY_LINKED', NULL, NULL, ?, ?, ?, NULL, ?, ?)`,
          `INSERT INTO incident_events (id, incident_id, event_type, previous_status, new_status, actor_id, actor_email, note, linked_alert_id, linked_event_ref, created_at)
           VALUES ($1, $2, 'TELEMETRY_LINKED', NULL, NULL, $3, $4, $5, NULL, $6, $7::timestamptz)`,
          [
            crypto.randomUUID(),
            incidentId,
            actor.userId,
            actor.email,
            `Linked telemetry reference ${linkEventRef}`,
            linkEventRef,
            nowIso,
          ],
        );
      }
    });

    await writeAuditLog({
      actor,
      action: 'INCIDENT_UPDATE',
      resourceType: 'admin_incident',
      resourceId: incidentId,
      previousValue: { status: prevStatus, ownerEmail: existing.owner_email },
      newValue: { status: nextStatus, ownerEmail: nextOwnerEmail, note: noteText },
    });

    const detail = await getIncidentDetail(incidentId);
    if (!detail.ok) return detail;
    return { ok: true, status: 200, data: { incident: detail.data.incident } };
  }

  return {
    getObservabilityOverview,
    getObservabilityApi,
    getObservabilityAi,
    inspectSensitiveAiRequest,
    getObservabilityMarketData,
    getObservabilityJobs,
    getObservabilitySecurity,
    getThresholdsConfig,
    updateThresholdsConfig,
    evaluateAlerts,
    listAlerts,
    getAlertDetail,
    updateAlertStatus,
    listIncidents,
    getIncidentDetail,
    createIncident,
    updateIncident,
  };
}

function apiTotalOrNull(count: number, avgMs: number): number | null {
  return count > 0 ? avgMs : null;
}

export type ObservabilityService = ReturnType<typeof createObservabilityService>;
