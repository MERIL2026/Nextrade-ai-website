import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AccountStatus, AuthDatabase, UserRole } from '../auth/db';
import {
  ADMIN_ROLES,
  PERMISSIONS,
  ROLE_CATALOG,
  isValidUserRole,
  normalizeUserRole,
  resolveUserPermissions,
} from '../auth/rbac';
import type { AuthEmailSender } from '../auth/email';
import type { AuthService } from '../auth/service';
import { CATALOG_INSTRUMENTS, type MarketRegion } from '../lib/marketData';
import type { MarketService } from '../market';
import { stripControlChars } from '../lib/security';
import type { RuntimeConfigManager } from './runtimeSettings';
import type { BackgroundJobManager, TelemetryCollector } from './telemetry';
import { createObservabilityService } from './observabilityService';
import { createGovernanceService } from './governanceService';
import { createSuperOpsService } from './superOpsService';
import {
  APPROVED_GEMINI_MODELS,
  AdminAnnouncementDto,
  AdminAuditLogDto,
  AdminIncidentDto,
  AdminRangeKey,
  AdminUserDetailDto,
  AdminUserSummaryDto,
  AiPromptVersionDto,
  AnnouncementCategory,
  AnnouncementSeverity,
  AnnouncementStatus,
  IncidentSeverity,
  IncidentStatus,
  PlatformConfigBundle,
  ServiceHealthItem,
  SupportTicketDto,
  SupportTicketPriority,
  SupportTicketStatus,
  TimeSeriesPoint,
} from './types';

export interface AdminActor {
  userId: string;
  email: string;
  role: UserRole;
  ipAddress: string;
  userAgent: string;
  currentSessionId?: string;
}

export type AdminOutcome<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; code?: string };

const SENSITIVE_KEY_PATTERN = /(password|secret|token|apikey|api_key|private|service_role|hash|cookie)/i;

export function redactSensitiveObject(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    if (input.length > 300) return `${input.slice(0, 300)}...`;
    return input;
  }
  if (Array.isArray(input)) {
    return input.slice(0, 50).map((item) => redactSensitiveObject(item));
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactSensitiveObject(v);
      }
    }
    return out;
  }
  return input;
}

function serializeRedacted(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(redactSensitiveObject(value)).slice(0, 4000);
  } catch {
    return '[UNSERIALIZABLE]';
  }
}

function toIso(v: unknown): string {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function toBool(v: unknown): boolean {
  return v === true || v === 1 || v === '1';
}

function rangeCutoffIso(range: AdminRangeKey): string | null {
  const now = Date.now();
  if (range === '24h') return new Date(now - 24 * 60 * 60 * 1000).toISOString();
  if (range === '7d') return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (range === '30d') return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  return null;
}

function normalizeRange(raw: unknown): AdminRangeKey {
  if (raw === '24h' || raw === '7d' || raw === '30d' || raw === 'all') return raw;
  return '7d';
}

function buildDailyBuckets(timestamps: string[], daysCount: number): TimeSeriesPoint[] {
  const counts = new Map<string, number>();
  const now = new Date();
  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    counts.set(key, 0);
  }
  for (const ts of timestamps) {
    const day = ts.slice(0, 10);
    if (counts.has(day)) {
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries()).map(([bucket, count]) => ({ bucket, count }));
}

function csvEscape(val: unknown): string {
  const raw = val === null || val === undefined ? '' : String(val);
  // Neutralize CSV formula injection (=, +, -, @, tab, CR)
  const neutralized = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

export interface CreateAdminServiceOptions {
  db: AuthDatabase;
  authService: AuthService;
  emailSender: AuthEmailSender;
  runtimeConfigManager: RuntimeConfigManager;
  telemetryCollector: TelemetryCollector;
  jobManager: BackgroundJobManager;
  marketService?: MarketService;
  projectRoot: string;
}

export function createAdminService(options: CreateAdminServiceOptions) {
  const {
    db,
    authService,
    emailSender,
    runtimeConfigManager,
    telemetryCollector,
    jobManager,
    marketService,
    projectRoot,
  } = options;
  const isPg = db.dialect === 'postgres';
  const boolVal = (v: boolean) => (isPg ? v : v ? 1 : 0);

  async function writeAuditLog(params: {
    actor: AdminActor | { userId: string | null; email: string; ipAddress?: string; userAgent?: string };
    action: string;
    resourceType: string;
    resourceId?: string | null;
    previousValue?: unknown;
    newValue?: unknown;
    result?: 'SUCCESS' | 'DENIED' | 'ERROR';
  }) {
    const correlationId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    try {
      await db.execute(
        `INSERT INTO admin_audit_logs (id, admin_id, admin_email, action, resource_type, resource_id, previous_value_redacted, new_value_redacted, ip_address, user_agent, result, correlation_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `INSERT INTO admin_audit_logs (id, admin_id, admin_email, action, resource_type, resource_id, previous_value_redacted, new_value_redacted, ip_address, user_agent, result, correlation_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz)`,
        [
          crypto.randomUUID(),
          params.actor.userId,
          stripControlChars(params.actor.email || 'system', 180) || 'system',
          stripControlChars(params.action, 100),
          stripControlChars(params.resourceType, 64),
          params.resourceId ? stripControlChars(params.resourceId, 120) : null,
          serializeRedacted(params.previousValue),
          serializeRedacted(params.newValue),
          stripControlChars(params.actor.ipAddress ?? 'unknown', 64) || 'unknown',
          stripControlChars(params.actor.userAgent ?? 'unknown', 240) || 'unknown',
          params.result ?? 'SUCCESS',
          correlationId,
          nowIso,
        ],
      );
    } catch (err) {
      console.error('Admin audit log write failure:', err instanceof Error ? err.message : err);
    }
    return correlationId;
  }

  const observability = createObservabilityService({
    db,
    emailSender,
    runtimeConfigManager,
    telemetryCollector,
    jobManager,
    writeAuditLog,
  });

  async function countActiveSuperAdmins(): Promise<number> {
    const row = await db.queryOne<{ cnt: number | string }>(
      "SELECT COUNT(*) AS cnt FROM users WHERE role = 'super_admin' AND account_status = 'active'",
      "SELECT COUNT(*) AS cnt FROM users WHERE role = 'super_admin' AND account_status = 'active'",
    );
    return Number(row?.cnt ?? 0);
  }

  const governance = createGovernanceService({
    db,
    authService,
    emailSender,
    runtimeConfigManager,
    projectRoot,
    writeAuditLog,
    countActiveSuperAdmins,
  });

  const superOps = createSuperOpsService({
    db,
    runtimeConfigManager,
    jobManager,
    observability,
    governance,
    writeAuditLog: async (p) => {
      await writeAuditLog({
        ...p,
        actor: p.actor ?? { userId: null, email: 'system' },
      });
    },
    assignUserRole: (...args) => assignUserRole(...args),
    executeEmergencyOperation: (...args) => executeEmergencyOperation(...args),
    revokeTargetUserSession: (...args) => revokeTargetUserSession(...args),
  });

  // ---- 1. Overview / Command Centre ----
  async function getOverview(rawRange?: unknown) {
    const range = normalizeRange(rawRange);
    const cutoff = rangeCutoffIso(range);
    const cfg = await runtimeConfigManager.getConfig();
    const { jobs } = await jobManager.listJobs();

    const dbT0 = Date.now();
    await db.queryOne<{ ok: number }>('SELECT 1 AS ok', 'SELECT 1 AS ok');
    const dbLatencyMs = Date.now() - dbT0;

    const [
      userRows,
      aiLogRows,
      apiLogRows,
      securityEventRows,
      openIncidentsRow,
      recentAuditRows,
      openTicketsRow,
    ] = await Promise.all([
      db.queryAll<{
        id: string;
        account_status: string;
        email_verified: number | boolean;
        created_at: string | Date;
      }>(
        'SELECT id, account_status, email_verified, created_at FROM users',
        'SELECT id, account_status, email_verified, created_at FROM users',
      ),
      cutoff
        ? db.queryAll<{
            status: string;
            latency_ms: number;
            total_tokens: number | null;
            created_at: string | Date;
          }>(
            'SELECT status, latency_ms, total_tokens, created_at FROM ai_request_logs WHERE created_at >= ?',
            'SELECT status, latency_ms, total_tokens, created_at FROM ai_request_logs WHERE created_at >= $1::timestamptz',
            [cutoff],
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
      cutoff
        ? db.queryAll<{
            status_code: number;
            latency_ms: number;
            rate_limited: number | boolean;
            created_at: string | Date;
          }>(
            'SELECT status_code, latency_ms, rate_limited, created_at FROM api_request_logs WHERE created_at >= ?',
            'SELECT status_code, latency_ms, rate_limited, created_at FROM api_request_logs WHERE created_at >= $1::timestamptz',
            [cutoff],
          )
        : db.queryAll<{
            status_code: number;
            latency_ms: number;
            rate_limited: number | boolean;
            created_at: string | Date;
          }>(
            'SELECT status_code, latency_ms, rate_limited, created_at FROM api_request_logs',
            'SELECT status_code, latency_ms, rate_limited, created_at FROM api_request_logs',
          ),
      cutoff
        ? db.queryAll<{ event_type: string; created_at: string | Date }>(
            'SELECT event_type, created_at FROM auth_security_events WHERE created_at >= ?',
            'SELECT event_type, created_at FROM auth_security_events WHERE created_at >= $1::timestamptz',
            [cutoff],
          )
        : db.queryAll<{ event_type: string; created_at: string | Date }>(
            'SELECT event_type, created_at FROM auth_security_events',
            'SELECT event_type, created_at FROM auth_security_events',
          ),
      db.queryOne<{ cnt: number | string }>(
        "SELECT COUNT(*) AS cnt FROM admin_incidents WHERE status != 'RESOLVED'",
        "SELECT COUNT(*) AS cnt FROM admin_incidents WHERE status != 'RESOLVED'",
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT id, admin_email, action, resource_type, resource_id, result, created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT 12',
        'SELECT id, admin_email, action, resource_type, resource_id, result, created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT 12',
      ),
      db.queryOne<{ cnt: number | string }>(
        "SELECT COUNT(*) AS cnt FROM support_tickets WHERE status IN ('OPEN', 'IN_PROGRESS')",
        "SELECT COUNT(*) AS cnt FROM support_tickets WHERE status IN ('OPEN', 'IN_PROGRESS')",
      ),
    ]);

    const totalUsers = userRows.length;
    const activeUsers = userRows.filter((u) => u.account_status === 'active').length;
    const suspendedUsers = userRows.filter((u) => u.account_status === 'suspended').length;
    const verifiedUsers = userRows.filter((u) => toBool(u.email_verified)).length;
    const newRegistrations = cutoff
      ? userRows.filter((u) => toIso(u.created_at) >= cutoff).length
      : totalUsers;

    const totalAiRequests = aiLogRows.length;
    const failedAiRequests = aiLogRows.filter((r) => r.status === 'FAILED').length;
    const avgAiLatencyMs =
      totalAiRequests > 0
        ? Math.round(aiLogRows.reduce((s, r) => s + Number(r.latency_ms ?? 0), 0) / totalAiRequests)
        : null;
    const measuredTokensRows = aiLogRows.filter(
      (r) => typeof r.total_tokens === 'number' && Number.isFinite(r.total_tokens),
    );
    const totalTokensMeasured =
      measuredTokensRows.length > 0
        ? measuredTokensRows.reduce((s, r) => s + Number(r.total_tokens ?? 0), 0)
        : null;

    const geminiConfigured = Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY',
    );

    const totalApiRequests = apiLogRows.length;
    const apiErrorsCount = apiLogRows.filter((r) => Number(r.status_code) >= 400).length;
    const rateLimitEvents = apiLogRows.filter((r) => toBool(r.rate_limited)).length;
    const avgApiLatencyMs =
      totalApiRequests > 0
        ? Math.round(apiLogRows.reduce((s, r) => s + Number(r.latency_ms ?? 0), 0) / totalApiRequests)
        : null;

    const failedLogins = securityEventRows.filter(
      (e) => e.event_type === 'login_failed' || e.event_type === 'login_blocked',
    ).length;

    const daysWindow = range === '24h' ? 2 : range === '30d' ? 14 : 7;

    const userGrowthSeries = buildDailyBuckets(
      userRows.map((u) => toIso(u.created_at)),
      daysWindow,
    );
    const aiUsageSeries = buildDailyBuckets(
      aiLogRows.map((r) => toIso(r.created_at)),
      daysWindow,
    );

    const apiBucketsMap = new Map<string, { count: number; errors: number }>();
    for (const pt of buildDailyBuckets([], daysWindow)) {
      apiBucketsMap.set(pt.bucket, { count: 0, errors: 0 });
    }
    for (const row of apiLogRows) {
      const day = toIso(row.created_at).slice(0, 10);
      const b = apiBucketsMap.get(day);
      if (b) {
        b.count += 1;
        if (Number(row.status_code) >= 400) b.errors += 1;
      }
    }
    const apiTrafficSeries: TimeSeriesPoint[] = Array.from(apiBucketsMap.entries()).map(
      ([bucket, vals]) => ({
        bucket,
        count: vals.count,
        errors: vals.errors,
      }),
    );

    const failedJobsCount = jobs.filter((j) => j.status === 'FAILED').length;
    const nowIso = new Date().toISOString();

    const serviceHealth: ServiceHealthItem[] = [
      {
        id: 'backend-express',
        name: 'Express SSR & API Runtime',
        category: 'Core',
        status: cfg.maintenance_mode.enabled ? 'DEGRADED' : 'HEALTHY',
        detail: cfg.maintenance_mode.enabled
          ? 'Maintenance mode active (admin recovery routes open).'
          : `Uptime ${Math.round(process.uptime())}s`,
        latencyMs: avgApiLatencyMs,
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
        id: 'ai-gemini',
        name: `Gemini Research (${cfg.ai_config.activeModel})`,
        category: 'AI',
        status: !cfg.ai_config.aiEnabled
          ? 'UNAVAILABLE'
          : geminiConfigured
            ? 'HEALTHY'
            : 'NOT_CONFIGURED',
        detail: !cfg.ai_config.aiEnabled
          ? 'Disabled by admin toggle'
          : geminiConfigured
            ? 'Server-side GEMINI_API_KEY configured'
            : 'AI Building Mode (GEMINI_API_KEY not configured)',
        latencyMs: avgAiLatencyMs,
        checkedAt: nowIso,
      },
      {
        id: 'market-data',
        name: 'Market Data Providers',
        category: 'Market Data',
        status: cfg.market_data_config.lastSyncStatus === 'FAILED' ? 'DEGRADED' : 'HEALTHY',
        detail: `Classification: ${cfg.market_data_config.dataClassification} · ${CATALOG_INSTRUMENTS.length} catalog symbols`,
        latencyMs: null,
        checkedAt: cfg.market_data_config.lastSyncAt ?? nowIso,
      },
      {
        id: 'email-provider',
        name: `Email Delivery (${emailSender.getProviderName()})`,
        category: 'Messaging',
        status: emailSender.isConfigured() ? 'HEALTHY' : 'NOT_CONFIGURED',
        detail: emailSender.isConfigured()
          ? `Provider ${emailSender.getProviderName()} active`
          : 'Not configured; dev outbox mode',
        latencyMs: null,
        checkedAt: nowIso,
      },
      {
        id: 'background-jobs',
        name: 'Registered Background Jobs',
        category: 'Jobs',
        status: failedJobsCount > 0 ? 'DEGRADED' : 'HEALTHY',
        detail: `${jobs.length} registered · ${failedJobsCount} failed`,
        latencyMs: null,
        checkedAt: nowIso,
      },
    ];

    return {
      range,
      maintenanceMode: cfg.maintenance_mode.enabled,
      userMetrics: {
        totalUsers,
        activeUsers,
        newRegistrations,
        verifiedUsers,
        suspendedUsers,
      },
      aiMetrics: {
        totalRequests: totalAiRequests,
        providerConfigured: geminiConfigured,
        aiEnabled: cfg.ai_config.aiEnabled && cfg.feature_flags.aiResearchEnabled,
        activeModel: cfg.ai_config.activeModel,
        avgLatencyMs: avgAiLatencyMs,
        failedRequests: failedAiRequests,
        totalTokensMeasured,
        estimatedCostUsd: null, // Honest unavailability: pricing rates not configured server-side
      },
      marketMetrics: {
        activeProviders: 3,
        classification: cfg.market_data_config.dataClassification,
        enabledRegions: cfg.market_data_config.enabledRegions,
        instrumentCount: CATALOG_INSTRUMENTS.length,
        lastSyncAt: cfg.market_data_config.lastSyncAt,
        lastSyncStatus: cfg.market_data_config.lastSyncStatus,
        failedSyncJobs: jobs.filter(
          (j) => j.id === 'market-catalog-sync' && j.status === 'FAILED',
        ).length,
      },
      apiMetrics: {
        requestVolume: totalApiRequests,
        errorCount: apiErrorsCount,
        errorRatePct:
          totalApiRequests > 0 ? Number(((apiErrorsCount / totalApiRequests) * 100).toFixed(2)) : 0,
        rateLimitEvents,
        avgLatencyMs: avgApiLatencyMs,
      },
      infrastructure: {
        backendHealth: 'HEALTHY',
        dbDialect: db.dialect,
        dbLatencyMs,
        uptimeSeconds: Math.round(process.uptime()),
        nodeVersion: process.version,
        registeredJobsCount: jobs.length,
        failedJobsCount,
      },
      securityMetrics: {
        openIncidents: Number(openIncidentsRow?.cnt ?? 0),
        failedLogins,
        blockedRequests: rateLimitEvents,
        openSupportTickets: Number(openTicketsRow?.cnt ?? 0),
      },
      charts: {
        userGrowth: userGrowthSeries,
        apiTraffic: apiTrafficSeries,
        aiUsage: aiUsageSeries,
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

  // ---- 2. Notifications Header Summary (100% Real Data) ----
  async function getNotificationsSummary() {
    const [alerts, incidents, openTickets, failedJobs] = await Promise.all([
      db.queryAll<{ id: string; title: string; severity: string; last_detected_at: string | Date }>(
        "SELECT id, title, severity, last_detected_at FROM operational_alerts WHERE status IN ('OPEN', 'ACKNOWLEDGED') ORDER BY last_detected_at DESC LIMIT 6",
        "SELECT id, title, severity, last_detected_at FROM operational_alerts WHERE status IN ('OPEN', 'ACKNOWLEDGED') ORDER BY last_detected_at DESC LIMIT 6",
      ),
      db.queryAll<{ id: string; title: string; severity: string; created_at: string | Date }>(
        "SELECT id, title, severity, created_at FROM admin_incidents WHERE status != 'RESOLVED' ORDER BY created_at DESC LIMIT 5",
        "SELECT id, title, severity, created_at FROM admin_incidents WHERE status != 'RESOLVED' ORDER BY created_at DESC LIMIT 5",
      ),
      db.queryAll<{ id: string; ticket_id: string; topic: string; created_at: string | Date }>(
        "SELECT id, ticket_id, topic, created_at FROM support_tickets WHERE status = 'OPEN' ORDER BY created_at DESC LIMIT 5",
        "SELECT id, ticket_id, topic, created_at FROM support_tickets WHERE status = 'OPEN' ORDER BY created_at DESC LIMIT 5",
      ),
      db.queryAll<{ id: string; name: string; last_error: string | null; updated_at: string | Date }>(
        "SELECT id, name, last_error, updated_at FROM background_jobs WHERE status = 'FAILED' ORDER BY updated_at DESC LIMIT 5",
        "SELECT id, name, last_error, updated_at FROM background_jobs WHERE status = 'FAILED' ORDER BY updated_at DESC LIMIT 5",
      ),
    ]);

    const items = [
      ...alerts.map((a) => ({
        id: `alr-${a.id}`,
        kind: 'ALERT' as const,
        title: `[${a.severity}] ${a.title}`,
        href: '/admin/alerts',
        createdAt: toIso(a.last_detected_at),
      })),
      ...incidents.map((i) => ({
        id: `inc-${i.id}`,
        kind: 'INCIDENT' as const,
        title: `[${i.severity}] ${i.title}`,
        href: '/admin/incidents',
        createdAt: toIso(i.created_at),
      })),
      ...failedJobs.map((j) => ({
        id: `job-${j.id}`,
        kind: 'JOB_FAILED' as const,
        title: `Failed job: ${j.name}`,
        href: '/admin/jobs',
        createdAt: toIso(j.updated_at),
      })),
      ...openTickets.map((t) => ({
        id: `tkt-${t.id}`,
        kind: 'SUPPORT_OPEN' as const,
        title: `Open ticket ${t.ticket_id} (${t.topic})`,
        href: '/admin/support',
        createdAt: toIso(t.created_at),
      })),
    ];

    return {
      totalCount: items.length,
      items: items.slice(0, 12),
    };
  }

  // ---- 3. User Management ----
  async function listUsers(params: {
    search?: string;
    role?: string;
    status?: string;
    verified?: string;
    sort?: string;
    limit?: number;
    offset?: number;
  }) {
    const search = stripControlChars(params.search ?? '', 120).toLowerCase();
    const roleFilter = stripControlChars(params.role ?? '', 32).toLowerCase();
    const statusFilter = stripControlChars(params.status ?? '', 24).toLowerCase();
    const verifiedFilter = stripControlChars(params.verified ?? '', 12).toLowerCase();
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 25));
    const offset = Math.max(0, Number(params.offset) || 0);

    const conditions: string[] = [];
    const args: unknown[] = [];
    let pgIdx = 1;

    const addCond = (sqliteExpr: string, pgExprFn: (idx: number) => string, val: unknown) => {
      if (isPg) {
        conditions.push(pgExprFn(pgIdx++));
      } else {
        conditions.push(sqliteExpr);
      }
      args.push(val);
    };

    if (search) {
      const likeVal = `%${search}%`;
      if (isPg) {
        const p1 = pgIdx++;
        conditions.push(
          `(LOWER(u.email) LIKE $${p1} OR LOWER(u.full_name) LIKE $${p1} OR CAST(u.id AS TEXT) LIKE $${p1})`,
        );
        args.push(likeVal);
      } else {
        conditions.push(
          '(LOWER(u.email) LIKE ? OR LOWER(u.full_name) LIKE ? OR LOWER(u.id) LIKE ?)',
        );
        args.push(likeVal, likeVal, likeVal);
      }
    }

    if (roleFilter && isValidUserRole(roleFilter)) {
      addCond('u.role = ?', (idx) => `u.role = $${idx}`, roleFilter);
    }

    if (statusFilter === 'active' || statusFilter === 'suspended' || statusFilter === 'disabled') {
      addCond('u.account_status = ?', (idx) => `u.account_status = $${idx}`, statusFilter);
    }

    if (verifiedFilter === 'true' || verifiedFilter === 'false') {
      const want = verifiedFilter === 'true';
      addCond('u.email_verified = ?', (idx) => `u.email_verified = $${idx}`, boolVal(want));
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy =
      params.sort === 'last_login'
        ? 'u.last_login_at DESC'
        : params.sort === 'name'
          ? 'u.full_name ASC'
          : 'u.created_at DESC';

    const countSql = `SELECT COUNT(*) AS cnt FROM users u ${whereClause}`;
    const totalRow = await db.queryOne<{ cnt: number | string }>(countSql, countSql, args);
    const total = Number(totalRow?.cnt ?? 0);

    const listArgs = [...args, limit, offset];
    const limitSql = isPg
      ? `LIMIT $${pgIdx++} OFFSET $${pgIdx++}`
      : 'LIMIT ? OFFSET ?';

    const rows = await db.queryAll<Record<string, unknown>>(
      `SELECT
         u.id, u.full_name, u.email, u.account_status, u.email_verified, u.role, u.created_at, u.updated_at, u.last_login_at,
         (SELECT MAX(s.last_active_at) FROM sessions s WHERE s.user_id = u.id) AS last_activity_at,
         (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL) AS active_session_count
       FROM users u
       ${whereClause}
       ORDER BY ${orderBy}
       ${limitSql}`,
      `SELECT
         u.id, u.full_name, u.email, u.account_status, u.email_verified, u.role, u.created_at, u.updated_at, u.last_login_at,
         (SELECT MAX(s.last_active_at) FROM sessions s WHERE s.user_id = u.id) AS last_activity_at,
         (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL) AS active_session_count
       FROM users u
       ${whereClause}
       ORDER BY ${orderBy}
       ${limitSql}`,
      listArgs,
    );

    const users: AdminUserSummaryDto[] = rows.map((r) => ({
      id: String(r.id),
      fullName: String(r.full_name),
      email: String(r.email),
      accountStatus: String(r.account_status) as AccountStatus,
      emailVerified: toBool(r.email_verified),
      role: normalizeUserRole(r.role),
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
      lastLoginAt: r.last_login_at ? toIso(r.last_login_at) : null,
      lastActivityAt: r.last_activity_at ? toIso(r.last_activity_at) : null,
      activeSessionCount: Number(r.active_session_count ?? 0),
    }));

    return { users, total, limit, offset };
  }

  async function getUserDetail(userId: string): Promise<AdminOutcome<AdminUserDetailDto>> {
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT id, full_name, email, account_status, email_verified, role, created_at, updated_at, last_login_at FROM users WHERE id = ?',
      'SELECT id, full_name, email, account_status, email_verified, role, created_at, updated_at, last_login_at FROM users WHERE id = $1',
      [userId],
    );
    if (!row) {
      return { ok: false, status: 404, error: 'User account not found.', code: 'NOT_FOUND' };
    }

    const role = normalizeUserRole(row.role);
    const [
      sessions,
      events,
      roleAssignments,
      portfoliosCnt,
      watchlistsCnt,
      ordersCnt,
      researchCnt,
      reportsCnt,
    ] = await Promise.all([
      db.queryAll<Record<string, unknown>>(
        'SELECT id, user_agent, ip_address, remember_me, created_at, last_active_at, expires_at, revoked_at FROM sessions WHERE user_id = ? ORDER BY last_active_at DESC LIMIT 30',
        'SELECT id, user_agent, ip_address, remember_me, created_at, last_active_at, expires_at, revoked_at FROM sessions WHERE user_id = $1 ORDER BY last_active_at DESC LIMIT 30',
        [userId],
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT id, event_type, ip_address, user_agent, detail, created_at FROM auth_security_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 30',
        'SELECT id, event_type, ip_address, user_agent, detail, created_at FROM auth_security_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30',
        [userId],
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT id, previous_role, assigned_role, assigned_by, reason, created_at FROM admin_role_assignments WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
        'SELECT id, previous_role, assigned_role, assigned_by, reason, created_at FROM admin_role_assignments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
        [userId],
      ),
      db.queryOne<{ cnt: number | string }>(
        'SELECT COUNT(*) AS cnt FROM portfolios WHERE user_id = ?',
        'SELECT COUNT(*) AS cnt FROM portfolios WHERE user_id = $1',
        [userId],
      ),
      db.queryOne<{ cnt: number | string }>(
        'SELECT COUNT(*) AS cnt FROM watchlists WHERE user_id = ?',
        'SELECT COUNT(*) AS cnt FROM watchlists WHERE user_id = $1',
        [userId],
      ),
      db.queryOne<{ cnt: number | string }>(
        'SELECT COUNT(*) AS cnt FROM paper_orders WHERE user_id = ?',
        'SELECT COUNT(*) AS cnt FROM paper_orders WHERE user_id = $1',
        [userId],
      ),
      db.queryOne<{ cnt: number | string }>(
        'SELECT COUNT(*) AS cnt FROM ai_research_history WHERE user_id = ?',
        'SELECT COUNT(*) AS cnt FROM ai_research_history WHERE user_id = $1',
        [userId],
      ),
      db.queryOne<{ cnt: number | string }>(
        'SELECT COUNT(*) AS cnt FROM saved_reports WHERE user_id = ?',
        'SELECT COUNT(*) AS cnt FROM saved_reports WHERE user_id = $1',
        [userId],
      ),
    ]);

    const activeSessions = sessions.filter((s) => !s.revoked_at);

    return {
      ok: true,
      status: 200,
      data: {
        user: {
          id: String(row.id),
          fullName: String(row.full_name),
          email: String(row.email),
          accountStatus: String(row.account_status) as AccountStatus,
          emailVerified: toBool(row.email_verified),
          role,
          createdAt: toIso(row.created_at),
          updatedAt: toIso(row.updated_at),
          lastLoginAt: row.last_login_at ? toIso(row.last_login_at) : null,
          lastActivityAt: sessions[0] ? toIso(sessions[0].last_active_at) : null,
          activeSessionCount: activeSessions.length,
        },
        permissions: resolveUserPermissions(role),
        sessions: sessions.map((s) => ({
          id: String(s.id),
          userAgent: String(s.user_agent),
          ipAddress: String(s.ip_address),
          rememberMe: toBool(s.remember_me),
          createdAt: toIso(s.created_at),
          lastActiveAt: toIso(s.last_active_at),
          expiresAt: toIso(s.expires_at),
          revokedAt: s.revoked_at ? toIso(s.revoked_at) : null,
        })),
        workspaceSummary: {
          portfolioCount: Number(portfoliosCnt?.cnt ?? 0),
          watchlistCount: Number(watchlistsCnt?.cnt ?? 0),
          ordersCount: Number(ordersCnt?.cnt ?? 0),
          researchCount: Number(researchCnt?.cnt ?? 0),
          savedReportsCount: Number(reportsCnt?.cnt ?? 0),
        },
        securityEvents: events.map((e) => ({
          id: String(e.id),
          eventType: String(e.event_type),
          ipAddress: String(e.ip_address),
          userAgent: String(e.user_agent),
          detail: String(e.detail),
          createdAt: toIso(e.created_at),
        })),
        roleAssignments: roleAssignments.map((r) => ({
          id: String(r.id),
          previousRole: String(r.previous_role),
          assignedRole: String(r.assigned_role),
          assignedBy: r.assigned_by ? String(r.assigned_by) : null,
          reason: String(r.reason ?? ''),
          createdAt: toIso(r.created_at),
        })),
      },
    };
  }

  async function suspendUser(
    actor: AdminActor,
    targetUserId: string,
    reason = 'Suspended by platform administrator.',
  ): Promise<AdminOutcome<{ userId: string; accountStatus: AccountStatus }>> {
    if (actor.userId === targetUserId) {
      await writeAuditLog({
        actor,
        action: 'USER_SUSPEND',
        resourceType: 'user',
        resourceId: targetUserId,
        result: 'DENIED',
        newValue: { reason: 'Self-suspension prevented' },
      });
      return { ok: false, status: 400, error: 'Administrators cannot suspend their own account.', code: 'SELF_ACTION_FORBIDDEN' };
    }

    const target = await db.queryOne<{ id: string; role: string; account_status: string; email: string }>(
      'SELECT id, role, account_status, email FROM users WHERE id = ?',
      'SELECT id, role, account_status, email FROM users WHERE id = $1',
      [targetUserId],
    );
    if (!target) {
      return { ok: false, status: 404, error: 'User not found.' };
    }

    const targetRole = normalizeUserRole(target.role);
    if (targetRole === 'super_admin' && actor.role !== 'super_admin') {
      await writeAuditLog({
        actor,
        action: 'USER_SUSPEND',
        resourceType: 'user',
        resourceId: targetUserId,
        result: 'DENIED',
        newValue: { reason: 'Insufficient authority over super_admin' },
      });
      return { ok: false, status: 403, error: 'Only a Super Admin can suspend another Super Admin.', code: 'FORBIDDEN_TARGET_ADMIN' };
    }

    if (targetRole === 'super_admin' && (await countActiveSuperAdmins()) <= 1) {
      return {
        ok: false,
        status: 409,
        error: 'Cannot suspend the last active Super Admin.',
        code: 'LAST_SUPER_ADMIN_GUARD',
      };
    }

    const nowIso = new Date().toISOString();
    await db.withTransaction(async (tx) => {
      await tx.execute(
        "UPDATE users SET account_status = 'suspended', updated_at = ? WHERE id = ?",
        "UPDATE users SET account_status = 'suspended', updated_at = $1::timestamptz WHERE id = $2",
        [nowIso, targetUserId],
      );
      await tx.execute(
        'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
        'UPDATE sessions SET revoked_at = $1::timestamptz WHERE user_id = $2 AND revoked_at IS NULL',
        [nowIso, targetUserId],
      );
    });

    await authService.recordSecurityEvent({
      userId: targetUserId,
      eventType: 'account_suspended',
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      detail: `Suspended by ${actor.email}: ${stripControlChars(reason, 200)}`,
    });

    await writeAuditLog({
      actor,
      action: 'USER_SUSPEND',
      resourceType: 'user',
      resourceId: targetUserId,
      previousValue: { accountStatus: target.account_status },
      newValue: { accountStatus: 'suspended', reason: stripControlChars(reason, 200) },
      result: 'SUCCESS',
    });

    await governance.recordLifecycleTransition({
      userId: targetUserId,
      previousState: target.account_status,
      newState: 'suspended',
      actorId: actor.userId,
      actorEmail: actor.email,
      reason: stripControlChars(reason, 200) || 'Suspended by administrator',
    });

    return { ok: true, status: 200, data: { userId: targetUserId, accountStatus: 'suspended' } };
  }

  async function restoreUser(
    actor: AdminActor,
    targetUserId: string,
    reason = 'Restored by platform administrator.',
  ): Promise<AdminOutcome<{ userId: string; accountStatus: AccountStatus }>> {
    const target = await db.queryOne<{ id: string; role: string; account_status: string }>(
      'SELECT id, role, account_status FROM users WHERE id = ?',
      'SELECT id, role, account_status FROM users WHERE id = $1',
      [targetUserId],
    );
    if (!target) {
      return { ok: false, status: 404, error: 'User not found.' };
    }

    const nowIso = new Date().toISOString();
    await db.execute(
      "UPDATE users SET account_status = 'active', updated_at = ? WHERE id = ?",
      "UPDATE users SET account_status = 'active', updated_at = $1::timestamptz WHERE id = $2",
      [nowIso, targetUserId],
    );

    await authService.recordSecurityEvent({
      userId: targetUserId,
      eventType: 'account_restored',
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      detail: `Restored by ${actor.email}: ${stripControlChars(reason, 200)}`,
    });

    await writeAuditLog({
      actor,
      action: 'USER_RESTORE',
      resourceType: 'user',
      resourceId: targetUserId,
      previousValue: { accountStatus: target.account_status },
      newValue: { accountStatus: 'active', reason: stripControlChars(reason, 200) },
      result: 'SUCCESS',
    });

    await governance.recordLifecycleTransition({
      userId: targetUserId,
      previousState: target.account_status,
      newState: 'active',
      actorId: actor.userId,
      actorEmail: actor.email,
      reason: stripControlChars(reason, 200) || 'Restored by administrator',
    });

    return { ok: true, status: 200, data: { userId: targetUserId, accountStatus: 'active' } };
  }

  async function updateUserProfileAdmin(
    actor: AdminActor,
    targetUserId: string,
    updates: { fullName?: unknown; emailVerified?: unknown; accountStatus?: unknown },
  ): Promise<AdminOutcome<{ updated: true }>> {
    const target = await db.queryOne<{
      id: string;
      full_name: string;
      email_verified: number | boolean;
      account_status: AccountStatus;
      role: string;
    }>(
      'SELECT id, full_name, email_verified, account_status, role FROM users WHERE id = ?',
      'SELECT id, full_name, email_verified, account_status, role FROM users WHERE id = $1',
      [targetUserId],
    );
    if (!target) return { ok: false, status: 404, error: 'User not found.' };

    const nextFullName =
      typeof updates.fullName === 'string' && updates.fullName.trim().length >= 2
        ? stripControlChars(updates.fullName, 100)
        : target.full_name;
    const nextVerified =
      typeof updates.emailVerified === 'boolean'
        ? updates.emailVerified
        : toBool(target.email_verified);

    const nowIso = new Date().toISOString();
    await db.execute(
      'UPDATE users SET full_name = ?, email_verified = ?, updated_at = ? WHERE id = ?',
      'UPDATE users SET full_name = $1, email_verified = $2, updated_at = $3::timestamptz WHERE id = $4',
      [nextFullName, boolVal(nextVerified), nowIso, targetUserId],
    );

    await writeAuditLog({
      actor,
      action: 'USER_UPDATE',
      resourceType: 'user',
      resourceId: targetUserId,
      previousValue: {
        fullName: target.full_name,
        emailVerified: toBool(target.email_verified),
      },
      newValue: {
        fullName: nextFullName,
        emailVerified: nextVerified,
      },
    });

    return { ok: true, status: 200, data: { updated: true } };
  }

  async function revokeTargetUserSession(
    actor: AdminActor,
    targetUserId: string,
    sessionId?: string,
  ): Promise<AdminOutcome<{ revokedCount: number }>> {
    const nowIso = new Date().toISOString();
    let changes = 0;
    if (sessionId) {
      const res = await db.execute(
        'UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
        'UPDATE sessions SET revoked_at = $1::timestamptz WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL',
        [nowIso, sessionId, targetUserId],
      );
      changes = res.changes;
    } else {
      const res = await db.execute(
        'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
        'UPDATE sessions SET revoked_at = $1::timestamptz WHERE user_id = $2 AND revoked_at IS NULL',
        [nowIso, targetUserId],
      );
      changes = res.changes;
    }

    await writeAuditLog({
      actor,
      action: sessionId ? 'USER_SESSION_REVOKE' : 'USER_SESSIONS_REVOKE_ALL',
      resourceType: 'session',
      resourceId: sessionId ?? targetUserId,
      newValue: { targetUserId, revokedCount: changes },
    });

    return { ok: true, status: 200, data: { revokedCount: changes } };
  }

  async function deleteUserAccount(
    actor: AdminActor,
    targetUserId: string,
    confirmEmail: string,
  ): Promise<AdminOutcome<{ deleted: true; userId: string }>> {
    if (actor.userId === targetUserId) {
      return { ok: false, status: 400, error: 'Administrators cannot delete their own account.' };
    }
    const target = await db.queryOne<{ id: string; email: string; role: string }>(
      'SELECT id, email, role FROM users WHERE id = ?',
      'SELECT id, email, role FROM users WHERE id = $1',
      [targetUserId],
    );
    if (!target) {
      return { ok: false, status: 404, error: 'User account not found.' };
    }
    if (target.email.toLowerCase() !== stripControlChars(confirmEmail, 180).toLowerCase()) {
      return {
        ok: false,
        status: 400,
        error: 'Confirmation email does not match target account.',
        code: 'CONFIRMATION_MISMATCH',
      };
    }
    if (normalizeUserRole(target.role) === 'super_admin' && (await countActiveSuperAdmins()) <= 1) {
      return {
        ok: false,
        status: 409,
        error: 'Cannot delete the last active Super Admin.',
        code: 'LAST_SUPER_ADMIN_GUARD',
      };
    }

    await db.execute('DELETE FROM users WHERE id = ?', 'DELETE FROM users WHERE id = $1', [
      targetUserId,
    ]);

    await writeAuditLog({
      actor,
      action: 'USER_DELETE',
      resourceType: 'user',
      resourceId: targetUserId,
      previousValue: { email: target.email, role: target.role },
      newValue: { deleted: true },
    });

    return { ok: true, status: 200, data: { deleted: true, userId: targetUserId } };
  }

  async function assignUserRole(
    actor: AdminActor,
    targetUserId: string,
    rawNewRole: unknown,
    reason = '',
  ): Promise<AdminOutcome<{ userId: string; role: UserRole }>> {
    if (!isValidUserRole(rawNewRole)) {
      return { ok: false, status: 400, error: 'Invalid role specified.', code: 'INVALID_ROLE' };
    }
    const nextRole = normalizeUserRole(rawNewRole);

    if (actor.userId === targetUserId) {
      await writeAuditLog({
        actor,
        action: 'ROLE_ASSIGN',
        resourceType: 'user',
        resourceId: targetUserId,
        newValue: { attemptedRole: nextRole },
        result: 'DENIED',
      });
      return {
        ok: false,
        status: 403,
        error: 'Administrators cannot modify their own role or self-escalate privileges.',
        code: 'SELF_ROLE_MODIFICATION_FORBIDDEN',
      };
    }

    const target = await db.queryOne<{ id: string; email: string; role: string }>(
      'SELECT id, email, role FROM users WHERE id = ?',
      'SELECT id, email, role FROM users WHERE id = $1',
      [targetUserId],
    );
    if (!target) {
      return { ok: false, status: 404, error: 'Target user not found.' };
    }

    const previousRole = normalizeUserRole(target.role);

    if (nextRole === 'super_admin' && actor.role !== 'super_admin') {
      await writeAuditLog({
        actor,
        action: 'ROLE_ASSIGN',
        resourceType: 'user',
        resourceId: targetUserId,
        previousValue: { role: previousRole },
        newValue: { role: nextRole },
        result: 'DENIED',
      });
      return {
        ok: false,
        status: 403,
        error: 'Only an existing Super Admin can promote an account to Super Admin.',
        code: 'SUPER_ADMIN_REQUIRED',
      };
    }

    if (previousRole === 'super_admin' && nextRole !== 'super_admin') {
      const superAdmins = await countActiveSuperAdmins();
      if (superAdmins <= 1) {
        return {
          ok: false,
          status: 409,
          error: 'Cannot demote the last active Super Admin on the platform.',
          code: 'LAST_SUPER_ADMIN_GUARD',
        };
      }
    }

    const nowIso = new Date().toISOString();
    const cleanReason = stripControlChars(reason, 280) || 'Administrative role update';

    await db.withTransaction(async (tx) => {
      await tx.execute(
        'UPDATE users SET role = ?, updated_at = ? WHERE id = ?',
        'UPDATE users SET role = $1, updated_at = $2::timestamptz WHERE id = $3',
        [nextRole, nowIso, targetUserId],
      );
      await tx.execute(
        `INSERT INTO admin_role_assignments (id, user_id, previous_role, assigned_role, assigned_by, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        `INSERT INTO admin_role_assignments (id, user_id, previous_role, assigned_role, assigned_by, reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)`,
        [crypto.randomUUID(), targetUserId, previousRole, nextRole, actor.userId, cleanReason, nowIso],
      );
    });

    await authService.recordSecurityEvent({
      userId: targetUserId,
      eventType: 'role_changed',
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      detail: `Role changed from ${previousRole} to ${nextRole} by ${actor.email}.`,
    });

    await writeAuditLog({
      actor,
      action: 'ROLE_ASSIGN',
      resourceType: 'user',
      resourceId: targetUserId,
      previousValue: { role: previousRole },
      newValue: { role: nextRole, reason: cleanReason },
    });

    return { ok: true, status: 200, data: { userId: targetUserId, role: nextRole } };
  }

  async function exportUsersCsv(actor: AdminActor) {
    const { users } = await listUsers({ limit: 100, offset: 0 });
    const header = [
      'id',
      'fullName',
      'email',
      'role',
      'accountStatus',
      'emailVerified',
      'createdAt',
      'lastLoginAt',
    ].join(',');
    const lines = users.map((u) =>
      [
        u.id,
        u.fullName,
        u.email,
        u.role,
        u.accountStatus,
        u.emailVerified,
        u.createdAt,
        u.lastLoginAt ?? '',
      ]
        .map(csvEscape)
        .join(','),
    );

    await writeAuditLog({
      actor,
      action: 'USERS_EXPORT_CSV',
      resourceType: 'user_directory',
      newValue: { exportedCount: users.length },
    });

    return `${header}\n${lines.join('\n')}`;
  }

  // ---- 4. AI Control Centre ----
  async function getAiOverview() {
    const cfg = await runtimeConfigManager.getConfig();
    const activePrompt = await runtimeConfigManager.getActivePrompt();
    const logs = await db.queryAll<Record<string, unknown>>(
      'SELECT * FROM ai_request_logs ORDER BY created_at DESC LIMIT 60',
      'SELECT * FROM ai_request_logs ORDER BY created_at DESC LIMIT 60',
    );
    const totalRes = await db.queryOne<{ cnt: number | string }>(
      'SELECT COUNT(*) AS cnt FROM ai_request_logs',
      'SELECT COUNT(*) AS cnt FROM ai_request_logs',
    );
    const geminiConfigured = Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY',
    );

    const mapped = logs.map((r) => ({
      id: String(r.id),
      userId: r.user_id ? String(r.user_id) : null,
      symbol: String(r.symbol),
      queryPreview: String(r.query_preview),
      feature: String(r.feature),
      provider: String(r.provider),
      model: String(r.model),
      status: String(r.status),
      latencyMs: Number(r.latency_ms ?? 0),
      promptTokens: r.prompt_tokens !== null && r.prompt_tokens !== undefined ? Number(r.prompt_tokens) : null,
      completionTokens: r.completion_tokens !== null && r.completion_tokens !== undefined ? Number(r.completion_tokens) : null,
      totalTokens: r.total_tokens !== null && r.total_tokens !== undefined ? Number(r.total_tokens) : null,
      errorMessage: r.error_message ? String(r.error_message) : null,
      createdAt: toIso(r.created_at),
    }));

    const successCount = mapped.filter((m) => m.status === 'SUCCESS').length;
    const fallbackCount = mapped.filter((m) => m.status === 'FALLBACK').length;
    const failedCount = mapped.filter((m) => m.status === 'FAILED').length;
    const blockedCount = mapped.filter((m) => m.status === 'BLOCKED').length;
    const avgLatencyMs =
      mapped.length > 0
        ? Math.round(mapped.reduce((acc, m) => acc + m.latencyMs, 0) / mapped.length)
        : null;
    const measuredTokens = mapped.filter((m) => typeof m.totalTokens === 'number');
    const totalTokens =
      measuredTokens.length > 0
        ? measuredTokens.reduce((acc, m) => acc + (m.totalTokens ?? 0), 0)
        : null;

    const byFeature = {
      workspace_research: mapped.filter((m) => m.feature === 'workspace_research').length,
      public_research: mapped.filter((m) => m.feature === 'public_research').length,
    };

    return {
      provider: {
        activeProvider: cfg.ai_config.activeProvider,
        activeModel: cfg.ai_config.activeModel,
        fallbackModel: cfg.ai_config.fallbackModel,
        approvedModels: [...APPROVED_GEMINI_MODELS],
        geminiKeyConfigured: geminiConfigured,
        aiEnabled: cfg.ai_config.aiEnabled && cfg.feature_flags.aiResearchEnabled,
        fallbackOnError: cfg.ai_config.fallbackOnError,
        maxQueryChars: cfg.ai_config.maxQueryChars,
        researchRateLimitPerMin: cfg.rate_limits.apiResearchMaxPerMin,
      },
      activePrompt,
      usage: {
        totalRequests: Number(totalRes?.cnt ?? mapped.length),
        recentSampleSize: mapped.length,
        successCount,
        fallbackCount,
        failedCount,
        blockedCount,
        avgLatencyMs,
        totalTokensMeasured: totalTokens,
        estimatedCostUsd: null,
        byFeature,
        dailySeries: buildDailyBuckets(
          mapped.map((m) => m.createdAt),
          7,
        ),
      },
      requests: mapped,
    };
  }

  async function updateAiConfig(
    actor: AdminActor,
    patch: {
      activeModel?: unknown;
      fallbackOnError?: unknown;
      aiEnabled?: unknown;
      maxQueryChars?: unknown;
    },
  ): Promise<AdminOutcome<{ aiConfig: PlatformConfigBundle['ai_config'] }>> {
    const current = await runtimeConfigManager.getConfig();
    const next = { ...current.ai_config };

    if (typeof patch.activeModel === 'string') {
      if (!(APPROVED_GEMINI_MODELS as readonly string[]).includes(patch.activeModel)) {
        return {
          ok: false,
          status: 400,
          error: `Unsupported model. Approved models: ${APPROVED_GEMINI_MODELS.join(', ')}`,
        };
      }
      next.activeModel = patch.activeModel;
    }
    if (typeof patch.fallbackOnError === 'boolean') {
      next.fallbackOnError = patch.fallbackOnError;
    }
    if (typeof patch.aiEnabled === 'boolean') {
      next.aiEnabled = patch.aiEnabled;
    }
    if (patch.maxQueryChars !== undefined) {
      const n = Number(patch.maxQueryChars);
      if (!Number.isInteger(n) || n < 100 || n > 2000) {
        return { ok: false, status: 400, error: 'maxQueryChars must be an integer between 100 and 2000.' };
      }
      next.maxQueryChars = n;
    }

    const { previous } = await runtimeConfigManager.updateSetting(
      'ai_config',
      next,
      actor.userId,
      'AI Control Centre configuration update',
    );
    await writeAuditLog({
      actor,
      action: 'AI_CONFIG_UPDATE',
      resourceType: 'ai_config',
      resourceId: 'ai_config',
      previousValue: previous,
      newValue: next,
    });

    return { ok: true, status: 200, data: { aiConfig: next } };
  }

  async function listPromptVersions(): Promise<AiPromptVersionDto[]> {
    await runtimeConfigManager.ensureSeeded();
    const rows = await db.queryAll<Record<string, unknown>>(
      'SELECT * FROM ai_prompt_versions ORDER BY version_number DESC',
      'SELECT * FROM ai_prompt_versions ORDER BY version_number DESC',
    );
    return rows.map((r) => ({
      id: String(r.id),
      templateKey: String(r.template_key),
      versionNumber: Number(r.version_number),
      title: String(r.title),
      systemPrompt: String(r.system_prompt),
      userPromptTemplate: String(r.user_prompt_template),
      modelTarget: String(r.model_target),
      status: String(r.status) as AiPromptVersionDto['status'],
      notes: String(r.notes ?? ''),
      createdBy: r.created_by ? String(r.created_by) : null,
      activatedAt: r.activated_at ? toIso(r.activated_at) : null,
      createdAt: toIso(r.created_at),
    }));
  }

  async function createPromptVersion(
    actor: AdminActor,
    input: {
      title: unknown;
      systemPrompt: unknown;
      userPromptTemplate?: unknown;
      modelTarget?: unknown;
      notes?: unknown;
      activateImmediately?: unknown;
    },
  ): Promise<AdminOutcome<{ prompt: AiPromptVersionDto }>> {
    const title = stripControlChars(typeof input.title === 'string' ? input.title : '', 120);
    const systemPrompt = stripControlChars(
      typeof input.systemPrompt === 'string' ? input.systemPrompt : '',
      3000,
      { allowNewlines: true },
    );
    if (title.length < 3 || systemPrompt.length < 20) {
      return { ok: false, status: 400, error: 'Prompt title (>=3 chars) and systemPrompt (>=20 chars) are required.' };
    }

    const modelTarget =
      typeof input.modelTarget === 'string' &&
      (APPROVED_GEMINI_MODELS as readonly string[]).includes(input.modelTarget)
        ? input.modelTarget
        : APPROVED_GEMINI_MODELS[0];
    const userPromptTemplate =
      stripControlChars(
        typeof input.userPromptTemplate === 'string' ? input.userPromptTemplate : '',
        2000,
        { allowNewlines: true },
      ) || 'Analyze {{symbol}} based on {{query}}';
    const notes = stripControlChars(typeof input.notes === 'string' ? input.notes : '', 380);
    const activate = input.activateImmediately === true;
    const nowIso = new Date().toISOString();
    const id = crypto.randomUUID();

    const maxVerRow = await db.queryOne<{ max_ver: number | null }>(
      "SELECT MAX(version_number) AS max_ver FROM ai_prompt_versions WHERE template_key = 'equity_research_system'",
      "SELECT MAX(version_number) AS max_ver FROM ai_prompt_versions WHERE template_key = 'equity_research_system'",
    );
    const nextVersion = Number(maxVerRow?.max_ver ?? 0) + 1;

    await db.withTransaction(async (tx) => {
      if (activate) {
        await tx.execute(
          "UPDATE ai_prompt_versions SET status = 'ARCHIVED' WHERE template_key = 'equity_research_system' AND status = 'ACTIVE'",
          "UPDATE ai_prompt_versions SET status = 'ARCHIVED' WHERE template_key = 'equity_research_system' AND status = 'ACTIVE'",
        );
      }
      await tx.execute(
        `INSERT INTO ai_prompt_versions (id, template_key, version_number, title, system_prompt, user_prompt_template, model_target, status, notes, created_by, activated_at, created_at)
         VALUES (?, 'equity_research_system', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `INSERT INTO ai_prompt_versions (id, template_key, version_number, title, system_prompt, user_prompt_template, model_target, status, notes, created_by, activated_at, created_at)
         VALUES ($1, 'equity_research_system', $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz)`,
        [
          id,
          nextVersion,
          title,
          systemPrompt,
          userPromptTemplate,
          modelTarget,
          activate ? 'ACTIVE' : 'DRAFT',
          notes,
          actor.userId,
          activate ? nowIso : null,
          nowIso,
        ],
      );
    });

    runtimeConfigManager.invalidateCache();
    await writeAuditLog({
      actor,
      action: activate ? 'AI_PROMPT_CREATE_AND_ACTIVATE' : 'AI_PROMPT_CREATE',
      resourceType: 'ai_prompt_version',
      resourceId: id,
      newValue: { versionNumber: nextVersion, title, status: activate ? 'ACTIVE' : 'DRAFT' },
    });

    const versions = await listPromptVersions();
    const created = versions.find((v) => v.id === id)!;
    return { ok: true, status: 201, data: { prompt: created } };
  }

  async function activatePromptVersion(
    actor: AdminActor,
    promptId: string,
  ): Promise<AdminOutcome<{ prompt: AiPromptVersionDto }>> {
    const target = await db.queryOne<{ id: string; version_number: number; title: string }>(
      'SELECT id, version_number, title FROM ai_prompt_versions WHERE id = ?',
      'SELECT id, version_number, title FROM ai_prompt_versions WHERE id = $1',
      [promptId],
    );
    if (!target) {
      return { ok: false, status: 404, error: 'Prompt version not found.' };
    }

    const nowIso = new Date().toISOString();
    await db.withTransaction(async (tx) => {
      await tx.execute(
        "UPDATE ai_prompt_versions SET status = 'ARCHIVED' WHERE template_key = 'equity_research_system' AND status = 'ACTIVE'",
        "UPDATE ai_prompt_versions SET status = 'ARCHIVED' WHERE template_key = 'equity_research_system' AND status = 'ACTIVE'",
      );
      await tx.execute(
        "UPDATE ai_prompt_versions SET status = 'ACTIVE', activated_at = ? WHERE id = ?",
        "UPDATE ai_prompt_versions SET status = 'ACTIVE', activated_at = $1::timestamptz WHERE id = $2",
        [nowIso, promptId],
      );
    });

    runtimeConfigManager.invalidateCache();
    await writeAuditLog({
      actor,
      action: 'AI_PROMPT_ACTIVATE',
      resourceType: 'ai_prompt_version',
      resourceId: promptId,
      newValue: { versionNumber: target.version_number, title: target.title },
    });

    const versions = await listPromptVersions();
    const active = versions.find((v) => v.id === promptId)!;
    return { ok: true, status: 200, data: { prompt: active } };
  }

  // ---- 5. Market Data Management ----
  async function getMarketsOverview() {
    const cfg = await runtimeConfigManager.getConfig();
    const md = cfg.market_data_config;
    const disabledSet = new Set(md.disabledSymbols);

    const liveOverview = marketService ? await marketService.getOverview().catch(() => null) : null;
    const quoteBySymbol = new Map((liveOverview?.instruments ?? []).map((q) => [q.symbol, q]));

    const symbols = CATALOG_INSTRUMENTS.map((inst) => {
      const q = quoteBySymbol.get(inst.symbol);
      return {
        symbol: inst.symbol,
        name: inst.name,
        exchange: inst.exchange,
        region: inst.region,
        category: inst.category,
        currency: inst.currency,
        sector: inst.sector,
        latestPrice: q?.price ?? null,
        providerName: q?.providerName ?? 'Unavailable',
        enabled:
          md.enabledRegions.includes(inst.region) && !disabledSet.has(inst.symbol),
        classification: q?.status ?? md.dataClassification,
        fetchedAt: q?.fetchedAt ?? null,
      };
    });

    const providers = (liveOverview?.providers ?? marketService?.getProviderRegistryStatus() ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      classification: p.classification,
      status: p.status,
      exchanges: p.exchanges,
      lastSuccessfulSync: p.lastCheckedAt,
      note: p.detail,
      latencyMs: p.latencyMs,
      quotaStatus: p.requiresKey
        ? p.configured
          ? `${p.envKeyName} configured`
          : `Requires ${p.envKeyName}`
        : 'Public server-side adapter (rate-limited + cached)',
    }));

    return {
      providers,
      config: md,
      coverage: {
        indiaCount: CATALOG_INSTRUMENTS.filter((i) => i.region === 'IN').length,
        usCount: CATALOG_INSTRUMENTS.filter((i) => i.region === 'US').length,
        globalCount: CATALOG_INSTRUMENTS.filter((i) => i.region === 'GLOBAL').length,
        totalInstruments: CATALOG_INSTRUMENTS.length,
        enabledCount: symbols.filter((s) => s.enabled).length,
      },
      symbols,
    };
  }

  async function updateMarketConfig(
    actor: AdminActor,
    patch: { enabledRegions?: unknown; disabledSymbols?: unknown },
  ): Promise<AdminOutcome<{ marketConfig: PlatformConfigBundle['market_data_config'] }>> {
    const current = await runtimeConfigManager.getConfig();
    const next = { ...current.market_data_config };

    if (Array.isArray(patch.enabledRegions)) {
      const validRegions = patch.enabledRegions.filter(
        (r): r is MarketRegion => r === 'IN' || r === 'US' || r === 'GLOBAL',
      );
      if (validRegions.length === 0) {
        return { ok: false, status: 400, error: 'At least one market region (IN, US, or GLOBAL) must remain enabled.' };
      }
      next.enabledRegions = Array.from(new Set(validRegions));
    }

    if (Array.isArray(patch.disabledSymbols)) {
      const knownSymbols = new Set(CATALOG_INSTRUMENTS.map((i) => i.symbol));
      next.disabledSymbols = Array.from(
        new Set(
          patch.disabledSymbols
            .filter((s): s is string => typeof s === 'string')
            .map((s) => s.trim().toUpperCase())
            .filter((s) => knownSymbols.has(s)),
        ),
      );
    }

    const { previous } = await runtimeConfigManager.updateSetting(
      'market_data_config',
      next,
      actor.userId,
      'Market coverage / symbol control update',
    );
    await writeAuditLog({
      actor,
      action: 'MARKET_CONFIG_UPDATE',
      resourceType: 'market_data_config',
      resourceId: 'market_data_config',
      previousValue: previous,
      newValue: next,
    });
    return { ok: true, status: 200, data: { marketConfig: next } };
  }

  // ---- 6. API & Integration Management ----
  async function getApisOverview(rawRange?: unknown) {
    const range = normalizeRange(rawRange);
    const cutoff = rangeCutoffIso(range);
    const cfg = await runtimeConfigManager.getConfig();

    const rows = cutoff
      ? await db.queryAll<Record<string, unknown>>(
          'SELECT method, route_path, status_code, latency_ms, rate_limited, error_code, created_at FROM api_request_logs WHERE created_at >= ? ORDER BY created_at DESC LIMIT 500',
          'SELECT method, route_path, status_code, latency_ms, rate_limited, error_code, created_at FROM api_request_logs WHERE created_at >= $1::timestamptz ORDER BY created_at DESC LIMIT 500',
          [cutoff],
        )
      : await db.queryAll<Record<string, unknown>>(
          'SELECT method, route_path, status_code, latency_ms, rate_limited, error_code, created_at FROM api_request_logs ORDER BY created_at DESC LIMIT 500',
          'SELECT method, route_path, status_code, latency_ms, rate_limited, error_code, created_at FROM api_request_logs ORDER BY created_at DESC LIMIT 500',
        );

    const byEndpoint = new Map<
      string,
      { routePath: string; method: string; total: number; errors: number; rateLimited: number; latencySum: number }
    >();
    const statusBuckets = { s2xx: 0, s4xx: 0, s5xx: 0 };

    for (const r of rows) {
      const method = String(r.method);
      const routePath = String(r.route_path);
      const code = Number(r.status_code);
      const lat = Number(r.latency_ms ?? 0);
      const rl = toBool(r.rate_limited);

      if (code >= 500) statusBuckets.s5xx++;
      else if (code >= 400) statusBuckets.s4xx++;
      else statusBuckets.s2xx++;

      const key = `${method} ${routePath}`;
      const existing = byEndpoint.get(key) ?? {
        routePath,
        method,
        total: 0,
        errors: 0,
        rateLimited: 0,
        latencySum: 0,
      };
      existing.total += 1;
      if (code >= 400) existing.errors += 1;
      if (rl) existing.rateLimited += 1;
      existing.latencySum += lat;
      byEndpoint.set(key, existing);
    }

    const endpoints = Array.from(byEndpoint.values())
      .map((e) => ({
        method: e.method,
        routePath: e.routePath,
        volume: e.total,
        errorCount: e.errors,
        errorRatePct: e.total > 0 ? Number(((e.errors / e.total) * 100).toFixed(1)) : 0,
        rateLimitCount: e.rateLimited,
        avgLatencyMs: e.total > 0 ? Math.round(e.latencySum / e.total) : 0,
      }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 30);

    const failedRequests = rows
      .filter((r) => Number(r.status_code) >= 400)
      .slice(0, 40)
      .map((r) => ({
        method: String(r.method),
        routePath: String(r.route_path),
        statusCode: Number(r.status_code),
        latencyMs: Number(r.latency_ms ?? 0),
        rateLimited: toBool(r.rate_limited),
        errorCode: r.error_code ? String(r.error_code) : null,
        createdAt: toIso(r.created_at),
      }));

    return {
      range,
      summary: {
        totalVolume: rows.length,
        avgLatencyMs:
          rows.length > 0
            ? Math.round(rows.reduce((s, r) => s + Number(r.latency_ms ?? 0), 0) / rows.length)
            : null,
        statusBreakdown: statusBuckets,
        rateLimitEvents: rows.filter((r) => toBool(r.rate_limited)).length,
      },
      rateLimits: cfg.rate_limits,
      integrations: [
        {
          name: 'Google Gemini API (@google/genai)',
          configured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
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
      failedRequests,
    };
  }

  // ---- 7. Security Centre & Cloudflare Audit Provenance ----
  async function getSecurityOverview() {
    const [events, activeSessionsRow, revokedSessionsRow, incidentsRows] = await Promise.all([
      db.queryAll<Record<string, unknown>>(
        'SELECT id, user_id, event_type, ip_address, user_agent, detail, created_at FROM auth_security_events ORDER BY created_at DESC LIMIT 60',
        'SELECT id, user_id, event_type, ip_address, user_agent, detail, created_at FROM auth_security_events ORDER BY created_at DESC LIMIT 60',
      ),
      db.queryOne<{ cnt: number | string }>(
        'SELECT COUNT(*) AS cnt FROM sessions WHERE revoked_at IS NULL',
        'SELECT COUNT(*) AS cnt FROM sessions WHERE revoked_at IS NULL',
      ),
      db.queryOne<{ cnt: number | string }>(
        'SELECT COUNT(*) AS cnt FROM sessions WHERE revoked_at IS NOT NULL',
        'SELECT COUNT(*) AS cnt FROM sessions WHERE revoked_at IS NOT NULL',
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM admin_incidents ORDER BY created_at DESC LIMIT 50',
        'SELECT * FROM admin_incidents ORDER BY created_at DESC LIMIT 50',
      ),
    ]);

    const mappedEvents = events.map((e) => ({
      id: String(e.id),
      userId: e.user_id ? String(e.user_id) : null,
      eventType: String(e.event_type),
      ipAddress: String(e.ip_address),
      userAgent: String(e.user_agent),
      detail: String(e.detail),
      createdAt: toIso(e.created_at),
    }));

    const artifactPaths = [
      'REPORT.md',
      'findings.json',
      'coverage-ledger.json',
      'architecture.md',
    ].map((file) => ({
      file,
      presentInRepo:
        fs.existsSync(path.join(projectRoot, file)) ||
        fs.existsSync(path.join(projectRoot, 'security-audit', file)),
    }));

    return {
      authMonitoring: {
        loginSuccesses: mappedEvents.filter((e) => e.eventType === 'login_success').length,
        failedLogins: mappedEvents.filter(
          (e) => e.eventType === 'login_failed' || e.eventType === 'login_blocked',
        ).length,
        passwordResets: mappedEvents.filter((e) =>
          e.eventType.includes('password_reset'),
        ).length,
        verificationEvents: mappedEvents.filter((e) =>
          e.eventType.includes('verif'),
        ).length,
        activeSessions: Number(activeSessionsRow?.cnt ?? 0),
        revokedSessions: Number(revokedSessionsRow?.cnt ?? 0),
      },
      configurationPosture: {
        cspMode: process.env.NODE_ENV === 'production' ? 'Strict Nonce CSP' : 'Dev Vite CSP',
        httpOnlyCookies: true,
        sameSitePolicy: 'Lax',
        csrfOriginCheckEnabled: true,
        argon2idPasswordHashing: true,
        dependencyVulnerabilityScanner: 'Not configured in runtime',
      },
      historicalAudit: {
        source: 'Cloudflare Security Audit Historical Baseline',
        auditDate: '2026-11-13 (Pre-Phase 3 Baseline)',
        status: 'HISTORICAL_BASELINE',
        caveat:
          'Historical audit findings reflect point-in-time remediation prior to Phase 3. They are NOT a real-time guarantee or certification of current production security.',
        summaryCounts: {
          critical: 0,
          high: 0,
          mediumFixed: 3,
          lowFixed: 3,
        },
        artifactFiles: artifactPaths,
        historicalFindings: [
          {
            id: 'CF-MED-01',
            severity: 'MEDIUM',
            title: 'Open redirect / protocol-relative URL sanitization',
            status: 'FIXED_VERIFIED',
          },
          {
            id: 'CF-MED-02',
            severity: 'MEDIUM',
            title: 'JSON-LD / SSR script breakout escaping',
            status: 'FIXED_VERIFIED',
          },
          {
            id: 'CF-MED-03',
            severity: 'MEDIUM',
            title: 'Host/Proto header sanitization in canonical base URL resolution',
            status: 'FIXED_VERIFIED',
          },
          {
            id: 'CF-LOW-01',
            severity: 'LOW',
            title: 'Sliding-window IP rate limiter bounds & Retry-After headers',
            status: 'FIXED_VERIFIED',
          },
          {
            id: 'CF-LOW-02',
            severity: 'LOW',
            title: 'Control-character stripping and payload size clamping (32 KB)',
            status: 'FIXED_VERIFIED',
          },
          {
            id: 'CF-LOW-03',
            severity: 'LOW',
            title: 'Corrupted localStorage / paper-order finite number guards',
            status: 'FIXED_VERIFIED',
          },
        ],
      },
      events: mappedEvents,
      incidents: incidentsRows.map((r) => ({
        id: String(r.id),
        title: String(r.title),
        description: String(r.description),
        severity: String(r.severity) as IncidentSeverity,
        status: String(r.status) as IncidentStatus,
        source: String(r.source),
        assignedAdminId: r.assigned_admin_id ? String(r.assigned_admin_id) : null,
        resolutionNotes: String(r.resolution_notes ?? ''),
        createdBy: r.created_by ? String(r.created_by) : null,
        createdAt: toIso(r.created_at),
        updatedAt: toIso(r.updated_at),
        resolvedAt: r.resolved_at ? toIso(r.resolved_at) : null,
      })),
    };
  }

  async function createIncident(
    actor: AdminActor,
    input: {
      title: unknown;
      description: unknown;
      severity?: unknown;
      source?: unknown;
      ownerEmail?: unknown;
      linkedAlertIds?: unknown;
      linkedEventRefs?: unknown;
    },
  ): Promise<AdminOutcome<{ incident: AdminIncidentDto }>> {
    return observability.createIncident(actor, input);
  }

  async function updateIncident(
    actor: AdminActor,
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
  ): Promise<AdminOutcome<{ incident: AdminIncidentDto }>> {
    return observability.updateIncident(actor, incidentId, patch);
  }

  // ---- 8. Infrastructure Monitoring ----
  async function getInfrastructureHealth() {
    const dbT0 = Date.now();
    await db.queryOne<{ ok: number }>('SELECT 1 AS ok', 'SELECT 1 AS ok');
    const dbLatencyMs = Date.now() - dbT0;

    const mem = process.memoryUsage();
    const cfg = await runtimeConfigManager.getConfig();
    const overview = await getOverview('24h');

    return {
      runtime: {
        nodeVersion: process.version,
        platform: `${os.platform()} ${os.arch()}`,
        pid: process.pid,
        uptimeSeconds: Math.round(process.uptime()),
        processStartedAt: telemetryCollector.getRecentProcessStartedAt(),
        rssMb: Number((mem.rss / (1024 * 1024)).toFixed(1)),
        heapUsedMb: Number((mem.heapUsed / (1024 * 1024)).toFixed(1)),
        heapTotalMb: Number((mem.heapTotal / (1024 * 1024)).toFixed(1)),
        cpuLoadAvg1m: Number(os.loadavg()[0].toFixed(2)),
        diskMetricsAvailable: false, // Honest: container disk statfs not polled
      },
      database: {
        dialect: db.dialect,
        status: 'HEALTHY',
        latencyMs: dbLatencyMs,
        poolMode: db.dialect === 'postgres' ? 'Transaction Pooler (prepare: false, max: 10)' : 'SQLite WAL single-file',
      },
      maintenanceMode: cfg.maintenance_mode,
      services: overview.serviceHealth,
      recentServerErrors: telemetryCollector.getRecentErrors(),
    };
  }

  // ---- 9. System Configuration & Emergency Operations ----
  async function getSystemConfig() {
    const config = await runtimeConfigManager.getConfig();
    const auditRows = await db.queryAll<Record<string, unknown>>(
      'SELECT * FROM admin_config_audit ORDER BY created_at DESC LIMIT 40',
      'SELECT * FROM admin_config_audit ORDER BY created_at DESC LIMIT 40',
    );
    return {
      config,
      configAudit: auditRows.map((r) => ({
        id: String(r.id),
        adminId: r.admin_id ? String(r.admin_id) : null,
        configKey: String(r.config_key),
        previousValueRedacted: r.previous_value_redacted ? String(r.previous_value_redacted) : null,
        newValueRedacted: r.new_value_redacted ? String(r.new_value_redacted) : null,
        reason: String(r.reason ?? ''),
        createdAt: toIso(r.created_at),
      })),
    };
  }

  async function updateSystemConfig(
    actor: AdminActor,
    payload: {
      key: unknown;
      value: unknown;
      reason?: unknown;
    },
  ): Promise<AdminOutcome<{ config: PlatformConfigBundle }>> {
    const key = payload.key as keyof PlatformConfigBundle;
    const validKeys = new Set<keyof PlatformConfigBundle>([
      'maintenance_mode',
      'feature_flags',
      'ai_config',
      'market_data_config',
      'rate_limits',
      'workspace_defaults',
      'governance_policies',
    ]);
    if (!validKeys.has(key) || !payload.value || typeof payload.value !== 'object') {
      return { ok: false, status: 400, error: 'Invalid configuration key or value object.' };
    }

    const current = await runtimeConfigManager.getConfig();
    const v = payload.value as Record<string, unknown>;
    let validatedValue: PlatformConfigBundle[keyof PlatformConfigBundle];

    if (key === 'maintenance_mode') {
      validatedValue = {
        enabled: Boolean(v.enabled),
        message:
          stripControlChars(typeof v.message === 'string' ? v.message : '', 280) ||
          current.maintenance_mode.message,
        allowAdminRecovery: true,
      };
    } else if (key === 'feature_flags') {
      validatedValue = {
        aiResearchEnabled:
          typeof v.aiResearchEnabled === 'boolean'
            ? v.aiResearchEnabled
            : current.feature_flags.aiResearchEnabled,
        paperTradingEnabled:
          typeof v.paperTradingEnabled === 'boolean'
            ? v.paperTradingEnabled
            : current.feature_flags.paperTradingEnabled,
        publicRegistrationEnabled:
          typeof v.publicRegistrationEnabled === 'boolean'
            ? v.publicRegistrationEnabled
            : current.feature_flags.publicRegistrationEnabled,
        announcementsBannerEnabled:
          typeof v.announcementsBannerEnabled === 'boolean'
            ? v.announcementsBannerEnabled
            : current.feature_flags.announcementsBannerEnabled,
      };
    } else if (key === 'rate_limits') {
      const apiResearch = Number(v.apiResearchMaxPerMin ?? current.rate_limits.apiResearchMaxPerMin);
      const wsMut = Number(v.workspaceMutationMaxPerMin ?? current.rate_limits.workspaceMutationMaxPerMin);
      const orderMax = Number(v.paperOrderMaxPerMin ?? current.rate_limits.paperOrderMaxPerMin);
      const contactMax = Number(v.contactMaxPer15Min ?? current.rate_limits.contactMaxPer15Min);
      if (
        !Number.isInteger(apiResearch) ||
        apiResearch < 5 ||
        apiResearch > 300 ||
        !Number.isInteger(wsMut) ||
        wsMut < 20 ||
        wsMut > 600 ||
        !Number.isInteger(orderMax) ||
        orderMax < 5 ||
        orderMax > 300 ||
        !Number.isInteger(contactMax) ||
        contactMax < 1 ||
        contactMax > 60
      ) {
        return {
          ok: false,
          status: 400,
          error: 'Rate limits must remain within strict safety bounds (e.g. research 5–300, orders 5–300, contact 1–60).',
        };
      }
      validatedValue = {
        apiResearchMaxPerMin: apiResearch,
        workspaceMutationMaxPerMin: wsMut,
        paperOrderMaxPerMin: orderMax,
        contactMaxPer15Min: contactMax,
      };
    } else if (key === 'workspace_defaults') {
      const region = v.defaultRegion === 'IN' || v.defaultRegion === 'US' || v.defaultRegion === 'ALL'
        ? v.defaultRegion
        : current.workspace_defaults.defaultRegion;
      const currency = v.defaultCurrency === 'INR' || v.defaultCurrency === 'USD'
        ? v.defaultCurrency
        : current.workspace_defaults.defaultCurrency;
      const tf =
        v.defaultTimeframe === '1D' ||
        v.defaultTimeframe === '1W' ||
        v.defaultTimeframe === '1M' ||
        v.defaultTimeframe === '6M' ||
        v.defaultTimeframe === '1Y'
          ? v.defaultTimeframe
          : current.workspace_defaults.defaultTimeframe;
      validatedValue = {
        defaultRegion: region,
        defaultCurrency: currency,
        defaultTimeframe: tf,
      };
    } else if (key === 'ai_config') {
      const res = await updateAiConfig(actor, v);
      if (!res.ok) return res;
      return { ok: true, status: 200, data: { config: await runtimeConfigManager.getConfig() } };
    } else if (key === 'governance_policies') {
      const reasonText = stripControlChars(typeof payload.reason === 'string' ? payload.reason : '', 280);
      const res = await governance.updateGovernancePolicies(actor, v, reasonText || 'Updated governance_policies');
      if (!res.ok) return res;
      return { ok: true, status: 200, data: { config: await runtimeConfigManager.getConfig() } };
    } else {
      const res = await updateMarketConfig(actor, v);
      if (!res.ok) return res;
      return { ok: true, status: 200, data: { config: await runtimeConfigManager.getConfig() } };
    }

    const reason = stripControlChars(typeof payload.reason === 'string' ? payload.reason : '', 280);
    const { previous } = await runtimeConfigManager.updateSetting(
      key,
      validatedValue,
      actor.userId,
      reason || `Updated ${key}`,
    );

    await writeAuditLog({
      actor,
      action: 'SYSTEM_CONFIG_UPDATE',
      resourceType: 'platform_settings',
      resourceId: key,
      previousValue: previous,
      newValue: validatedValue,
    });

    return { ok: true, status: 200, data: { config: await runtimeConfigManager.getConfig() } };
  }

  async function rollbackConfigAudit(
    actor: AdminActor,
    auditEntryId: string,
  ): Promise<AdminOutcome<{ config: PlatformConfigBundle }>> {
    const entry = await db.queryOne<{
      id: string;
      config_key: string;
      previous_value_redacted: string | null;
    }>(
      'SELECT id, config_key, previous_value_redacted FROM admin_config_audit WHERE id = ?',
      'SELECT id, config_key, previous_value_redacted FROM admin_config_audit WHERE id = $1',
      [auditEntryId],
    );
    if (!entry || !entry.previous_value_redacted) {
      return { ok: false, status: 404, error: 'Rollback target configuration snapshot not found.' };
    }

    let parsedPrev: unknown;
    try {
      parsedPrev = JSON.parse(entry.previous_value_redacted);
    } catch {
      return { ok: false, status: 400, error: 'Stored snapshot is not valid JSON.' };
    }

    const res = await updateSystemConfig(actor, {
      key: entry.config_key,
      value: parsedPrev,
      reason: `Rollback to snapshot ${auditEntryId.slice(0, 8)}`,
    });
    if (!res.ok) return res;

    await writeAuditLog({
      actor,
      action: 'SYSTEM_CONFIG_ROLLBACK',
      resourceType: 'platform_settings',
      resourceId: entry.config_key,
      newValue: { restoredFromAuditId: auditEntryId },
    });

    return res;
  }

  async function executeEmergencyOperation(
    actor: AdminActor,
    operation: unknown,
    reason = '',
  ): Promise<AdminOutcome<{ operation: string; detail: string }>> {
    const op = typeof operation === 'string' ? operation.trim() : '';
    const cleanReason = stripControlChars(reason, 240) || 'Emergency administrative action';
    const current = await runtimeConfigManager.getConfig();

    if (op === 'ENABLE_MAINTENANCE_MODE' || op === 'DISABLE_MAINTENANCE_MODE') {
      const enabled = op === 'ENABLE_MAINTENANCE_MODE';
      await runtimeConfigManager.updateSetting(
        'maintenance_mode',
        { ...current.maintenance_mode, enabled },
        actor.userId,
        cleanReason,
      );
      await writeAuditLog({
        actor,
        action: `EMERGENCY_${op}`,
        resourceType: 'platform_settings',
        resourceId: 'maintenance_mode',
        previousValue: { enabled: current.maintenance_mode.enabled },
        newValue: { enabled, reason: cleanReason },
      });
      return {
        ok: true,
        status: 200,
        data: {
          operation: op,
          detail: enabled
            ? 'Platform maintenance mode enabled. Admin recovery endpoints remain accessible.'
            : 'Platform maintenance mode disabled. Normal traffic resumed.',
        },
      };
    }

    if (op === 'DISABLE_AI_RESEARCH' || op === 'ENABLE_AI_RESEARCH') {
      const enabled = op === 'ENABLE_AI_RESEARCH';
      await runtimeConfigManager.updateSetting(
        'ai_config',
        { ...current.ai_config, aiEnabled: enabled },
        actor.userId,
        cleanReason,
      );
      await writeAuditLog({
        actor,
        action: `EMERGENCY_${op}`,
        resourceType: 'ai_config',
        resourceId: 'ai_config',
        previousValue: { aiEnabled: current.ai_config.aiEnabled },
        newValue: { aiEnabled: enabled, reason: cleanReason },
      });
      return {
        ok: true,
        status: 200,
        data: {
          operation: op,
          detail: enabled
            ? 'AI research execution re-enabled.'
            : 'AI research endpoints disabled server-side immediately.',
        },
      };
    }

    if (op === 'REVOKE_OTHER_ADMIN_SESSIONS') {
      const nowIso = new Date().toISOString();
      const adminRolesList = ADMIN_ROLES.map((r) => `'${r}'`).join(',');
      const res = actor.currentSessionId
        ? await db.execute(
            `UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL AND id != ? AND user_id IN (SELECT id FROM users WHERE role IN (${adminRolesList}))`,
            `UPDATE sessions SET revoked_at = $1::timestamptz WHERE revoked_at IS NULL AND id != $2 AND user_id IN (SELECT id FROM users WHERE role IN (${adminRolesList}))`,
            [nowIso, actor.currentSessionId],
          )
        : await db.execute(
            `UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE role IN (${adminRolesList}))`,
            `UPDATE sessions SET revoked_at = $1::timestamptz WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE role IN (${adminRolesList}))`,
            [nowIso],
          );

      await writeAuditLog({
        actor,
        action: 'EMERGENCY_REVOKE_ADMIN_SESSIONS',
        resourceType: 'session',
        newValue: { revokedCount: res.changes, reason: cleanReason },
      });
      return {
        ok: true,
        status: 200,
        data: {
          operation: op,
          detail: `Revoked ${res.changes} other active administrator session(s).`,
        },
      };
    }

    return { ok: false, status: 400, error: 'Unsupported emergency operation.' };
  }

  // ---- 10. Audit Logs (Append-only) ----
  async function listAuditLogs(params: {
    search?: string;
    action?: string;
    resourceType?: string;
    result?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }) {
    const search = stripControlChars(params.search ?? '', 120).toLowerCase();
    const action = stripControlChars(params.action ?? '', 80);
    const resourceType = stripControlChars(params.resourceType ?? '', 64);
    const result = stripControlChars(params.result ?? '', 16).toUpperCase();
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 30));
    const offset = Math.max(0, Number(params.offset) || 0);

    const conditions: string[] = [];
    const args: unknown[] = [];
    let pgIdx = 1;

    if (search) {
      const likeVal = `%${search}%`;
      if (isPg) {
        const p1 = pgIdx++;
        conditions.push(
          `(LOWER(admin_email) LIKE $${p1} OR LOWER(action) LIKE $${p1} OR LOWER(COALESCE(resource_id, '')) LIKE $${p1})`,
        );
        args.push(likeVal);
      } else {
        conditions.push(
          "(LOWER(admin_email) LIKE ? OR LOWER(action) LIKE ? OR LOWER(COALESCE(resource_id, '')) LIKE ?)",
        );
        args.push(likeVal, likeVal, likeVal);
      }
    }
    if (action) {
      conditions.push(isPg ? `action = $${pgIdx++}` : 'action = ?');
      args.push(action);
    }
    if (resourceType) {
      conditions.push(isPg ? `resource_type = $${pgIdx++}` : 'resource_type = ?');
      args.push(resourceType);
    }
    if (result === 'SUCCESS' || result === 'DENIED' || result === 'ERROR') {
      conditions.push(isPg ? `result = $${pgIdx++}` : 'result = ?');
      args.push(result);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const totalRow = await db.queryOne<{ cnt: number | string }>(
      `SELECT COUNT(*) AS cnt FROM admin_audit_logs ${whereClause}`,
      `SELECT COUNT(*) AS cnt FROM admin_audit_logs ${whereClause}`,
      args,
    );
    const total = Number(totalRow?.cnt ?? 0);

    const listArgs = [...args, limit, offset];
    const limitSql = isPg ? `LIMIT $${pgIdx++} OFFSET $${pgIdx++}` : 'LIMIT ? OFFSET ?';
    const rows = await db.queryAll<Record<string, unknown>>(
      `SELECT * FROM admin_audit_logs ${whereClause} ORDER BY created_at DESC ${limitSql}`,
      `SELECT * FROM admin_audit_logs ${whereClause} ORDER BY created_at DESC ${limitSql}`,
      listArgs,
    );

    const logs: AdminAuditLogDto[] = rows.map((r) => ({
      id: String(r.id),
      adminId: r.admin_id ? String(r.admin_id) : null,
      adminEmail: String(r.admin_email),
      action: String(r.action),
      resourceType: String(r.resource_type),
      resourceId: r.resource_id ? String(r.resource_id) : null,
      previousValueRedacted: r.previous_value_redacted ? String(r.previous_value_redacted) : null,
      newValueRedacted: r.new_value_redacted ? String(r.new_value_redacted) : null,
      ipAddress: String(r.ip_address),
      userAgent: String(r.user_agent),
      result: String(r.result) as AdminAuditLogDto['result'],
      correlationId: String(r.correlation_id),
      createdAt: toIso(r.created_at),
    }));

    return { logs, total, limit, offset };
  }

  async function exportAuditLogsCsv(actor: AdminActor) {
    const { logs } = await listAuditLogs({ limit: 100, offset: 0 });
    const header = [
      'id',
      'createdAt',
      'adminEmail',
      'action',
      'resourceType',
      'resourceId',
      'result',
      'correlationId',
      'ipAddress',
    ].join(',');
    const lines = logs.map((l) =>
      [
        l.id,
        l.createdAt,
        l.adminEmail,
        l.action,
        l.resourceType,
        l.resourceId ?? '',
        l.result,
        l.correlationId,
        l.ipAddress,
      ]
        .map(csvEscape)
        .join(','),
    );
    await writeAuditLog({
      actor,
      action: 'AUDIT_LOGS_EXPORT',
      resourceType: 'admin_audit_logs',
      newValue: { exportedCount: logs.length },
    });
    return `${header}\n${lines.join('\n')}`;
  }

  // ---- 11. Announcements & Support Tickets ----
  function mapAnnouncement(r: Record<string, unknown>): AdminAnnouncementDto {
    return {
      id: String(r.id),
      title: String(r.title),
      content: String(r.content),
      category: String(r.category) as AnnouncementCategory,
      severity: String(r.severity) as AnnouncementSeverity,
      status: String(r.status) as AnnouncementStatus,
      createdBy: r.created_by ? String(r.created_by) : null,
      scheduledFor: r.scheduled_for ? toIso(r.scheduled_for) : null,
      publishedAt: r.published_at ? toIso(r.published_at) : null,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    };
  }

  async function listAnnouncements(): Promise<AdminAnnouncementDto[]> {
    const rows = await db.queryAll<Record<string, unknown>>(
      'SELECT * FROM admin_announcements ORDER BY updated_at DESC LIMIT 100',
      'SELECT * FROM admin_announcements ORDER BY updated_at DESC LIMIT 100',
    );
    return rows.map(mapAnnouncement);
  }

  async function listPublicActiveAnnouncements(): Promise<
    Array<{ id: string; title: string; content: string; category: AnnouncementCategory; severity: AnnouncementSeverity; publishedAt: string | null }>
  > {
    const cfg = await runtimeConfigManager.getConfig();
    if (!cfg.feature_flags.announcementsBannerEnabled) return [];
    const rows = await db.queryAll<Record<string, unknown>>(
      "SELECT id, title, content, category, severity, published_at FROM admin_announcements WHERE status = 'PUBLISHED' ORDER BY published_at DESC LIMIT 5",
      "SELECT id, title, content, category, severity, published_at FROM admin_announcements WHERE status = 'PUBLISHED' ORDER BY published_at DESC LIMIT 5",
    );
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      content: String(r.content),
      category: String(r.category) as AnnouncementCategory,
      severity: String(r.severity) as AnnouncementSeverity,
      publishedAt: r.published_at ? toIso(r.published_at) : null,
    }));
  }

  async function createAnnouncement(
    actor: AdminActor,
    input: { title: unknown; content: unknown; category?: unknown; severity?: unknown; status?: unknown },
  ): Promise<AdminOutcome<{ announcement: AdminAnnouncementDto }>> {
    const title = stripControlChars(
      typeof input.title === 'string' ? input.title.replace(/<[^>]*>/g, '') : '',
      160,
    );
    const content = stripControlChars(
      typeof input.content === 'string' ? input.content.replace(/<[^>]*>/g, '') : '',
      2000,
      { allowNewlines: true },
    );
    if (title.length < 3 || content.length < 5) {
      return { ok: false, status: 400, error: 'Announcement title and content are required.' };
    }
    const category: AnnouncementCategory =
      input.category === 'MAINTENANCE' ||
      input.category === 'SECURITY' ||
      input.category === 'MARKET_NOTICE' ||
      input.category === 'UPDATE'
        ? input.category
        : 'UPDATE';
    const severity: AnnouncementSeverity =
      input.severity === 'WARNING' || input.severity === 'CRITICAL' || input.severity === 'INFO'
        ? input.severity
        : 'INFO';
    const status: AnnouncementStatus =
      input.status === 'PUBLISHED' ||
      input.status === 'UNPUBLISHED' ||
      input.status === 'SCHEDULED' ||
      input.status === 'DRAFT'
        ? input.status
        : 'DRAFT';

    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const publishedAt = status === 'PUBLISHED' ? nowIso : null;

    await db.execute(
      `INSERT INTO admin_announcements (id, title, content, category, severity, status, created_by, scheduled_for, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      `INSERT INTO admin_announcements (id, title, content, category, severity, status, created_by, scheduled_for, published_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8::timestamptz, $9::timestamptz, $10::timestamptz)`,
      [id, title, content, category, severity, status, actor.userId, publishedAt, nowIso, nowIso],
    );

    await writeAuditLog({
      actor,
      action: 'ANNOUNCEMENT_CREATE',
      resourceType: 'admin_announcement',
      resourceId: id,
      newValue: { title, category, severity, status },
    });

    return {
      ok: true,
      status: 201,
      data: {
        announcement: {
          id,
          title,
          content,
          category,
          severity,
          status,
          createdBy: actor.userId,
          scheduledFor: null,
          publishedAt,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      },
    };
  }

  async function updateAnnouncement(
    actor: AdminActor,
    id: string,
    patch: { title?: unknown; content?: unknown; status?: unknown; severity?: unknown; category?: unknown },
  ): Promise<AdminOutcome<{ announcement: AdminAnnouncementDto }>> {
    const existing = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM admin_announcements WHERE id = ?',
      'SELECT * FROM admin_announcements WHERE id = $1',
      [id],
    );
    if (!existing) {
      return { ok: false, status: 404, error: 'Announcement not found.' };
    }

    const title =
      typeof patch.title === 'string' && patch.title.trim().length >= 3
        ? stripControlChars(patch.title, 160)
        : String(existing.title);
    const content =
      typeof patch.content === 'string' && patch.content.trim().length >= 5
        ? stripControlChars(patch.content, 2000, { allowNewlines: true })
        : String(existing.content);
    const status: AnnouncementStatus =
      patch.status === 'PUBLISHED' ||
      patch.status === 'UNPUBLISHED' ||
      patch.status === 'SCHEDULED' ||
      patch.status === 'DRAFT'
        ? patch.status
        : (String(existing.status) as AnnouncementStatus);
    const category: AnnouncementCategory =
      patch.category === 'MAINTENANCE' ||
      patch.category === 'SECURITY' ||
      patch.category === 'MARKET_NOTICE' ||
      patch.category === 'UPDATE'
        ? patch.category
        : (String(existing.category) as AnnouncementCategory);
    const severity: AnnouncementSeverity =
      patch.severity === 'WARNING' || patch.severity === 'CRITICAL' || patch.severity === 'INFO'
        ? patch.severity
        : (String(existing.severity) as AnnouncementSeverity);

    const nowIso = new Date().toISOString();
    const publishedAt =
      status === 'PUBLISHED'
        ? existing.published_at
          ? toIso(existing.published_at)
          : nowIso
        : null;

    await db.execute(
      `UPDATE admin_announcements SET title = ?, content = ?, category = ?, severity = ?, status = ?, published_at = ?, updated_at = ? WHERE id = ?`,
      `UPDATE admin_announcements SET title = $1, content = $2, category = $3, severity = $4, status = $5, published_at = $6::timestamptz, updated_at = $7::timestamptz WHERE id = $8`,
      [title, content, category, severity, status, publishedAt, nowIso, id],
    );

    await writeAuditLog({
      actor,
      action: 'ANNOUNCEMENT_UPDATE',
      resourceType: 'admin_announcement',
      resourceId: id,
      previousValue: { status: existing.status, title: existing.title },
      newValue: { status, title },
    });

    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM admin_announcements WHERE id = ?',
      'SELECT * FROM admin_announcements WHERE id = $1',
      [id],
    );
    return { ok: true, status: 200, data: { announcement: mapAnnouncement(row!) } };
  }

  async function deleteAnnouncement(
    actor: AdminActor,
    id: string,
  ): Promise<AdminOutcome<{ deleted: true }>> {
    const res = await db.execute(
      'DELETE FROM admin_announcements WHERE id = ?',
      'DELETE FROM admin_announcements WHERE id = $1',
      [id],
    );
    if (res.changes === 0) {
      return { ok: false, status: 404, error: 'Announcement not found.' };
    }
    await writeAuditLog({
      actor,
      action: 'ANNOUNCEMENT_DELETE',
      resourceType: 'admin_announcement',
      resourceId: id,
    });
    return { ok: true, status: 200, data: { deleted: true } };
  }

  async function ingestPublicSupportTicket(input: {
    ticketId: string;
    name: string;
    email: string;
    topic: string;
    reference: string;
    message: string;
    submittedAt: string;
    userId?: string | null;
  }) {
    await db.execute(
      `INSERT INTO support_tickets (id, ticket_id, user_id, name, email, topic, reference, message, status, priority, assigned_admin_id, resolution_notes, created_at, updated_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', 'NORMAL', NULL, '', ?, ?, NULL)`,
      `INSERT INTO support_tickets (id, ticket_id, user_id, name, email, topic, reference, message, status, priority, assigned_admin_id, resolution_notes, created_at, updated_at, resolved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'OPEN', 'NORMAL', NULL, '', $9::timestamptz, $10::timestamptz, NULL)
       ON CONFLICT (ticket_id) DO NOTHING`,
      [
        crypto.randomUUID(),
        input.ticketId,
        input.userId ?? null,
        input.name,
        input.email,
        input.topic,
        input.reference,
        input.message,
        input.submittedAt,
        input.submittedAt,
      ],
    );
  }

  async function listSupportTickets(params: { status?: string; search?: string; limit?: number; offset?: number }) {
    const status = stripControlChars(params.status ?? '', 24).toUpperCase();
    const search = stripControlChars(params.search ?? '', 120).toLowerCase();
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 30));
    const offset = Math.max(0, Number(params.offset) || 0);

    const conditions: string[] = [];
    const args: unknown[] = [];
    let pgIdx = 1;

    if (status === 'OPEN' || status === 'IN_PROGRESS' || status === 'RESOLVED' || status === 'CLOSED') {
      conditions.push(isPg ? `status = $${pgIdx++}` : 'status = ?');
      args.push(status);
    }
    if (search) {
      const likeVal = `%${search}%`;
      if (isPg) {
        const p = pgIdx++;
        conditions.push(`(LOWER(ticket_id) LIKE $${p} OR LOWER(email) LIKE $${p} OR LOWER(topic) LIKE $${p})`);
        args.push(likeVal);
      } else {
        conditions.push('(LOWER(ticket_id) LIKE ? OR LOWER(email) LIKE ? OR LOWER(topic) LIKE ?)');
        args.push(likeVal, likeVal, likeVal);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const totalRow = await db.queryOne<{ cnt: number | string }>(
      `SELECT COUNT(*) AS cnt FROM support_tickets ${whereClause}`,
      `SELECT COUNT(*) AS cnt FROM support_tickets ${whereClause}`,
      args,
    );
    const listArgs = [...args, limit, offset];
    const limitSql = isPg ? `LIMIT $${pgIdx++} OFFSET $${pgIdx++}` : 'LIMIT ? OFFSET ?';
    const rows = await db.queryAll<Record<string, unknown>>(
      `SELECT * FROM support_tickets ${whereClause} ORDER BY created_at DESC ${limitSql}`,
      `SELECT * FROM support_tickets ${whereClause} ORDER BY created_at DESC ${limitSql}`,
      listArgs,
    );

    const tickets: SupportTicketDto[] = rows.map((r) => ({
      id: String(r.id),
      ticketId: String(r.ticket_id),
      userId: r.user_id ? String(r.user_id) : null,
      name: String(r.name),
      email: String(r.email),
      topic: String(r.topic),
      reference: String(r.reference ?? ''),
      message: String(r.message),
      status: String(r.status) as SupportTicketStatus,
      priority: String(r.priority) as SupportTicketPriority,
      assignedAdminId: r.assigned_admin_id ? String(r.assigned_admin_id) : null,
      resolutionNotes: String(r.resolution_notes ?? ''),
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
      resolvedAt: r.resolved_at ? toIso(r.resolved_at) : null,
    }));

    return { tickets, total: Number(totalRow?.cnt ?? 0), limit, offset };
  }

  async function updateSupportTicket(
    actor: AdminActor,
    ticketUuid: string,
    patch: { status?: unknown; priority?: unknown; resolutionNotes?: unknown },
  ): Promise<AdminOutcome<{ ticket: SupportTicketDto }>> {
    const existing = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM support_tickets WHERE id = ?',
      'SELECT * FROM support_tickets WHERE id = $1',
      [ticketUuid],
    );
    if (!existing) return { ok: false, status: 404, error: 'Support ticket not found.' };

    const status: SupportTicketStatus =
      patch.status === 'OPEN' ||
      patch.status === 'IN_PROGRESS' ||
      patch.status === 'RESOLVED' ||
      patch.status === 'CLOSED'
        ? patch.status
        : (String(existing.status) as SupportTicketStatus);
    const priority: SupportTicketPriority =
      patch.priority === 'LOW' || patch.priority === 'NORMAL' || patch.priority === 'HIGH'
        ? patch.priority
        : (String(existing.priority) as SupportTicketPriority);
    const resolutionNotes =
      typeof patch.resolutionNotes === 'string'
        ? stripControlChars(patch.resolutionNotes, 2000, { allowNewlines: true })
        : String(existing.resolution_notes ?? '');
    const nowIso = new Date().toISOString();
    const resolvedAt =
      status === 'RESOLVED' || status === 'CLOSED'
        ? existing.resolved_at
          ? toIso(existing.resolved_at)
          : nowIso
        : null;

    await db.execute(
      `UPDATE support_tickets SET status = ?, priority = ?, resolution_notes = ?, assigned_admin_id = ?, updated_at = ?, resolved_at = ? WHERE id = ?`,
      `UPDATE support_tickets SET status = $1, priority = $2, resolution_notes = $3, assigned_admin_id = $4, updated_at = $5::timestamptz, resolved_at = $6::timestamptz WHERE id = $7`,
      [status, priority, resolutionNotes, actor.userId, nowIso, resolvedAt, ticketUuid],
    );

    await writeAuditLog({
      actor,
      action: 'SUPPORT_TICKET_UPDATE',
      resourceType: 'support_ticket',
      resourceId: String(existing.ticket_id),
      previousValue: { status: existing.status, priority: existing.priority },
      newValue: { status, priority },
    });

    const updated = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM support_tickets WHERE id = ?',
      'SELECT * FROM support_tickets WHERE id = $1',
      [ticketUuid],
    );

    return {
      ok: true,
      status: 200,
      data: {
        ticket: {
          id: String(updated!.id),
          ticketId: String(updated!.ticket_id),
          userId: updated!.user_id ? String(updated!.user_id) : null,
          name: String(updated!.name),
          email: String(updated!.email),
          topic: String(updated!.topic),
          reference: String(updated!.reference ?? ''),
          message: String(updated!.message),
          status: String(updated!.status) as SupportTicketStatus,
          priority: String(updated!.priority) as SupportTicketPriority,
          assignedAdminId: updated!.assigned_admin_id ? String(updated!.assigned_admin_id) : null,
          resolutionNotes: String(updated!.resolution_notes ?? ''),
          createdAt: toIso(updated!.created_at),
          updatedAt: toIso(updated!.updated_at),
          resolvedAt: updated!.resolved_at ? toIso(updated!.resolved_at) : null,
        },
      },
    };
  }

  // ---- 12. Access Control Metadata ----
  function getRolesAndPermissionsCatalog() {
    return {
      roles: ROLE_CATALOG.map((r) => ({
        role: r.role,
        label: r.label,
        description: r.description,
        tier: r.tier,
        permissions: [...r.permissions],
      })),
      allPermissions: Object.values(PERMISSIONS),
    };
  }

  return {
    writeAuditLog,
    getOverview,
    getNotificationsSummary,
    listUsers,
    getUserDetail,
    suspendUser,
    restoreUser,
    updateUserProfileAdmin,
    revokeTargetUserSession,
    deleteUserAccount,
    assignUserRole,
    exportUsersCsv,
    getAiOverview,
    updateAiConfig,
    listPromptVersions,
    createPromptVersion,
    activatePromptVersion,
    getMarketsOverview,
    updateMarketConfig,
    getApisOverview,
    getSecurityOverview,
    createIncident,
    updateIncident,
    getInfrastructureHealth,
    getSystemConfig,
    updateSystemConfig,
    rollbackConfigAudit,
    executeEmergencyOperation,
    listAuditLogs,
    exportAuditLogsCsv,
    listAnnouncements,
    listPublicActiveAnnouncements,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
    ingestPublicSupportTicket,
    listSupportTickets,
    updateSupportTicket,
    getRolesAndPermissionsCatalog,
    observability,
    governance,
    superOps,
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
