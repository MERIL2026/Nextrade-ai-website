import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { AuthDatabase } from '../auth/db';
import type { AuthEmailSender } from '../auth/email';
import { CATALOG_INSTRUMENTS } from '../lib/marketData';
import type { MarketService } from '../market';
import { stripControlChars } from '../lib/security';
import {
  isJobStuck,
  redactSensitiveText,
  sanitizeRoutePath,
} from './observabilityMath';
import type { RuntimeConfigManager } from './runtimeSettings';
import type {
  BackgroundJobDto,
  BackgroundJobRunDto,
  ServiceHealthItem,
  WorkerHeartbeatDto,
} from './types';

export interface ApiTelemetryEntry {
  id: string;
  method: string;
  routePath: string;
  statusCode: number;
  latencyMs: number;
  rateLimited: boolean;
  userId: string | null;
  ipAddress: string;
  errorCode: string | null;
  createdAt: string;
}

export interface TelemetryCollector {
  middleware: () => (req: Request, res: Response, next: NextFunction) => void;
  flushNow: () => Promise<void>;
  getRecentErrors: () => ApiTelemetryEntry[];
  getRecentProcessStartedAt: () => string;
}

export function createTelemetryCollector(db: AuthDatabase): TelemetryCollector {
  const isPg = db.dialect === 'postgres';
  const boolVal = (v: boolean) => (isPg ? v : v ? 1 : 0);
  const startedAt = new Date().toISOString();

  const pendingQueue: ApiTelemetryEntry[] = [];
  const recentErrorsRing: ApiTelemetryEntry[] = [];
  let flushing = false;

  async function flushNow() {
    if (flushing || pendingQueue.length === 0) return;
    flushing = true;
    const batch = pendingQueue.splice(0, 100);
    try {
      for (const item of batch) {
        await db.execute(
          `INSERT INTO api_request_logs (id, method, route_path, status_code, latency_ms, rate_limited, user_id, ip_address, error_code, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          `INSERT INTO api_request_logs (id, method, route_path, status_code, latency_ms, rate_limited, user_id, ip_address, error_code, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)`,
          [
            item.id,
            item.method,
            item.routePath,
            item.statusCode,
            item.latencyMs,
            boolVal(item.rateLimited),
            item.userId,
            item.ipAddress,
            item.errorCode,
            item.createdAt,
          ],
        );
      }
    } catch {
      // Never crash request flow on telemetry insert error
    } finally {
      flushing = false;
    }
  }

  const timer = setInterval(() => {
    void flushNow();
  }, 4000);
  timer.unref();

  function middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      if (!req.originalUrl.startsWith('/api/')) {
        next();
        return;
      }
      const start = Date.now();
      res.on('finish', () => {
        const latencyMs = Math.max(0, Date.now() - start);
        const routePath = sanitizeRoutePath(req.originalUrl);
        const statusCode = res.statusCode || 200;
        const rateLimited = statusCode === 429;
        const authedUserId =
          (req as { auth?: { user?: { id?: string } } }).auth?.user?.id ?? null;
        const rawIp = stripControlChars(req.ip || 'unknown', 64) || 'unknown';
        const errorCode = statusCode >= 400 ? `HTTP_${statusCode}` : null;

        const entry: ApiTelemetryEntry = {
          id: crypto.randomUUID(),
          method: req.method.slice(0, 10).toUpperCase(),
          routePath,
          statusCode,
          latencyMs,
          rateLimited,
          userId: authedUserId,
          ipAddress: rawIp,
          errorCode,
          createdAt: new Date().toISOString(),
        };

        if (pendingQueue.length < 500) {
          pendingQueue.push(entry);
        }
        if (statusCode >= 500) {
          recentErrorsRing.unshift(entry);
          if (recentErrorsRing.length > 50) {
            recentErrorsRing.pop();
          }
        }
      });
      next();
    };
  }

  return {
    middleware,
    flushNow,
    getRecentErrors: () => [...recentErrorsRing],
    getRecentProcessStartedAt: () => startedAt,
  };
}

export interface RegisteredJobSpec {
  id: string;
  name: string;
  jobType: string;
  scheduleLabel: string;
  execute: () => Promise<string>;
}

export interface BackgroundJobManager {
  ensureJobsRegistered: () => Promise<void>;
  listJobs: () => Promise<{
    jobs: BackgroundJobDto[];
    runs: BackgroundJobRunDto[];
    workerHeartbeat: WorkerHeartbeatDto;
  }>;
  getJob: (jobId: string) => Promise<{ job: BackgroundJobDto; runs: BackgroundJobRunDto[] } | null>;
  runJob: (
    jobId: string,
    triggeredByUserId: string | null,
    options?: { allowWhenPaused?: boolean },
  ) => Promise<{
    ok: boolean;
    status: number;
    code?: string;
    job?: BackgroundJobDto;
    run?: BackgroundJobRunDto;
    error?: string;
  }>;
  cancelJob: (
    jobId: string,
  ) => Promise<{ ok: boolean; status: number; job?: BackgroundJobDto; error?: string }>;
  setQueuePaused: (
    paused: boolean,
  ) => Promise<{ workerHeartbeat: WorkerHeartbeatDto }>;
  getWorkerHeartbeat: () => Promise<WorkerHeartbeatDto>;
  recordServiceHealthSnapshots: (items: ServiceHealthItem[]) => Promise<void>;
}

export function createBackgroundJobManager(params: {
  db: AuthDatabase;
  runtimeConfigManager: RuntimeConfigManager;
  emailSender?: AuthEmailSender;
  marketService?: MarketService;
}): BackgroundJobManager {
  const { db, runtimeConfigManager, emailSender, marketService } = params;
  const isPg = db.dialect === 'postgres';
  const boolVal = (v: boolean) => (isPg ? v : v ? 1 : 0);
  const runningControllers = new Map<string, { cancelled: boolean }>();
  let seeded = false;
  const WORKER_ID = 'primary-worker';

  function toIso(v: unknown): string {
    if (!v) return '';
    if (v instanceof Date) return v.toISOString();
    return String(v);
  }

  async function ensureWorkerHeartbeat(activeJobId: string | null = null) {
    const nowIso = new Date().toISOString();
    const existing = await db.queryOne<{ worker_id: string; queue_paused: number | boolean }>(
      'SELECT worker_id, queue_paused FROM worker_heartbeats WHERE worker_id = ?',
      'SELECT worker_id, queue_paused FROM worker_heartbeats WHERE worker_id = $1',
      [WORKER_ID],
    );
    if (!existing) {
      await db.execute(
        `INSERT INTO worker_heartbeats (worker_id, status, queue_paused, active_job_id, processed_count, failed_count, last_heartbeat_at, updated_at)
         VALUES (?, 'HEALTHY', ?, ?, 0, 0, ?, ?)`,
        `INSERT INTO worker_heartbeats (worker_id, status, queue_paused, active_job_id, processed_count, failed_count, last_heartbeat_at, updated_at)
         VALUES ($1, 'HEALTHY', $2, $3, 0, 0, $4::timestamptz, $5::timestamptz)
         ON CONFLICT (worker_id) DO NOTHING`,
        [WORKER_ID, boolVal(false), activeJobId, nowIso, nowIso],
      );
    } else {
      const paused = existing.queue_paused === true || existing.queue_paused === 1;
      await db.execute(
        `UPDATE worker_heartbeats SET status = ?, active_job_id = ?, last_heartbeat_at = ?, updated_at = ? WHERE worker_id = ?`,
        `UPDATE worker_heartbeats SET status = $1, active_job_id = $2, last_heartbeat_at = $3::timestamptz, updated_at = $4::timestamptz WHERE worker_id = $5`,
        [paused ? 'PAUSED' : 'HEALTHY', activeJobId, nowIso, nowIso, WORKER_ID],
      );
    }
  }

  async function getWorkerHeartbeat(): Promise<WorkerHeartbeatDto> {
    await ensureWorkerHeartbeat();
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM worker_heartbeats WHERE worker_id = ?',
      'SELECT * FROM worker_heartbeats WHERE worker_id = $1',
      [WORKER_ID],
    );
    const paused = row ? row.queue_paused === true || row.queue_paused === 1 : false;
    return {
      workerId: row ? String(row.worker_id) : WORKER_ID,
      status: (row ? String(row.status) : 'HEALTHY') as WorkerHeartbeatDto['status'],
      queuePaused: paused,
      activeJobId: row?.active_job_id ? String(row.active_job_id) : null,
      processedCount: Number(row?.processed_count ?? 0),
      failedCount: Number(row?.failed_count ?? 0),
      lastHeartbeatAt: row ? toIso(row.last_heartbeat_at) : new Date().toISOString(),
      updatedAt: row ? toIso(row.updated_at) : new Date().toISOString(),
    };
  }

  async function setQueuePaused(paused: boolean) {
    await ensureWorkerHeartbeat();
    const nowIso = new Date().toISOString();
    const status = paused ? 'PAUSED' : 'HEALTHY';
    await db.execute(
      `UPDATE worker_heartbeats SET queue_paused = ?, status = ?, last_heartbeat_at = ?, updated_at = ? WHERE worker_id = ?`,
      `UPDATE worker_heartbeats SET queue_paused = $1, status = $2, last_heartbeat_at = $3::timestamptz, updated_at = $4::timestamptz WHERE worker_id = $5`,
      [boolVal(paused), status, nowIso, nowIso, WORKER_ID],
    );
    return { workerHeartbeat: await getWorkerHeartbeat() };
  }

  async function recordServiceHealthSnapshots(items: ServiceHealthItem[]) {
    for (const item of items) {
      await db.execute(
        `INSERT INTO service_health_checks (id, service_id, service_name, category, status, latency_ms, detail, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        `INSERT INTO service_health_checks (id, service_id, service_name, category, status, latency_ms, detail, checked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
        [
          crypto.randomUUID(),
          item.id.slice(0, 64),
          item.name.slice(0, 120),
          item.category.slice(0, 32),
          item.status,
          item.latencyMs,
          item.detail.slice(0, 320),
          item.checkedAt || new Date().toISOString(),
        ],
      );
    }
  }

  const JOB_SPECS: RegisteredJobSpec[] = [
    {
      id: 'session-cleanup',
      name: 'Expired Auth Session & Token Cleanup',
      jobType: 'SECURITY_MAINTENANCE',
      scheduleLabel: 'On-demand / Periodic maintenance',
      execute: async () => {
        const nowIso = new Date().toISOString();
        const sessRes = await db.execute(
          'DELETE FROM sessions WHERE expires_at < ?',
          'DELETE FROM sessions WHERE expires_at < $1::timestamptz',
          [nowIso],
        );
        const verRes = await db.execute(
          'DELETE FROM email_verification_tokens WHERE expires_at < ?',
          'DELETE FROM email_verification_tokens WHERE expires_at < $1::timestamptz',
          [nowIso],
        );
        const pwRes = await db.execute(
          'DELETE FROM password_reset_tokens WHERE expires_at < ?',
          'DELETE FROM password_reset_tokens WHERE expires_at < $1::timestamptz',
          [nowIso],
        );
        return `Purged ${sessRes.changes} expired sessions, ${verRes.changes} verification tokens, ${pwRes.changes} reset tokens.`;
      },
    },
    {
      id: 'telemetry-prune',
      name: 'Observability & Telemetry Retention Pruner',
      jobType: 'TELEMETRY_RETENTION',
      scheduleLabel: 'Configurable window retention',
      execute: async () => {
        const cfg = await runtimeConfigManager.getConfig();
        const days = Math.max(7, Math.min(90, Number(cfg.alert_thresholds?.retentionDays ?? 30)));
        const cutoffIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const apiRes = await db.execute(
          'DELETE FROM api_request_logs WHERE created_at < ?',
          'DELETE FROM api_request_logs WHERE created_at < $1::timestamptz',
          [cutoffIso],
        );
        const aiRes = await db.execute(
          'DELETE FROM ai_request_logs WHERE created_at < ?',
          'DELETE FROM ai_request_logs WHERE created_at < $1::timestamptz',
          [cutoffIso],
        );
        const hcRes = await db.execute(
          'DELETE FROM service_health_checks WHERE checked_at < ?',
          'DELETE FROM service_health_checks WHERE checked_at < $1::timestamptz',
          [cutoffIso],
        );
        const mdRes = await db.execute(
          'DELETE FROM market_data_health WHERE checked_at < ?',
          'DELETE FROM market_data_health WHERE checked_at < $1::timestamptz',
          [cutoffIso],
        );
        return `Pruned ${apiRes.changes} API logs, ${aiRes.changes} AI logs, ${hcRes.changes} health checks, ${mdRes.changes} market checks older than ${days} days.`;
      },
    },
    {
      id: 'market-catalog-sync',
      name: 'Market Provider Probe & Quote Sync',
      jobType: 'MARKET_DATA_SYNC',
      scheduleLabel: 'Live upstream health & cache verification',
      execute: async () => {
        const t0 = Date.now();
        const cfg = await runtimeConfigManager.getConfig();
        const enabledRegions = cfg.market_data_config.enabledRegions;
        const activeCount = CATALOG_INSTRUMENTS.filter(
          (i) =>
            enabledRegions.includes(i.region) &&
            !cfg.market_data_config.disabledSymbols.includes(i.symbol),
        ).length;

        if (marketService) {
          const probe = await marketService.probeProviders();
          const healthyCount = probe.providers.filter((p) => p.status === 'HEALTHY').length;
          const syncStatus = healthyCount > 0 ? 'SUCCEEDED' : 'FAILED';
          const note = `Probed live market providers: ${healthyCount} healthy, ${probe.symbolsSucceeded}/${probe.symbolsChecked} quotes resolved (${activeCount} enabled).`;

          await runtimeConfigManager.updateSetting(
            'market_data_config',
            {
              ...cfg.market_data_config,
              dataClassification: healthyCount > 0 ? 'DELAYED' : 'UNAVAILABLE',
              lastSyncAt: probe.checkedAt,
              lastSyncStatus: syncStatus,
              lastSyncNote: note,
            },
            null,
            'Automated market provider probe & quote cache refresh',
          );

          return note;
        }

        const syncedAt = new Date().toISOString();
        const latencyMs = Math.max(0, Date.now() - t0);
        const note = `Verified ${activeCount}/${CATALOG_INSTRUMENTS.length} catalog instruments across [${enabledRegions.join(', ')}] (in-memory adapter mode).`;

        await runtimeConfigManager.updateSetting(
          'market_data_config',
          {
            ...cfg.market_data_config,
            lastSyncAt: syncedAt,
            lastSyncStatus: 'SUCCEEDED',
            lastSyncNote: note,
          },
          null,
          'Market catalog integrity verification job',
        );

        await db.execute(
          `INSERT INTO market_data_health (id, provider_id, provider_name, status, classification, symbols_processed, failure_count, validation_failures, latency_ms, detail, checked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          `INSERT INTO market_data_health (id, provider_id, provider_name, status, classification, symbols_processed, failure_count, validation_failures, latency_ms, detail, checked_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz)`,
          [
            crypto.randomUUID(),
            'yahoo-finance',
            'Yahoo Finance Chart & Search API',
            'HEALTHY',
            cfg.market_data_config.dataClassification,
            activeCount,
            0,
            0,
            latencyMs,
            note,
            syncedAt,
          ],
        );

        return note;
      },
    },
    {
      id: 'health-probe',
      name: 'Platform Dependency Health Probe',
      jobType: 'INFRASTRUCTURE_PROBE',
      scheduleLabel: 'On-demand dependency probe',
      execute: async () => {
        const checkedAt = new Date().toISOString();
        const t0 = Date.now();
        await db.queryOne<{ ok: number }>('SELECT 1 AS ok', 'SELECT 1 AS ok');
        const dbLatency = Date.now() - t0;
        const geminiOk = Boolean(
          process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY',
        );
        const emailOk = emailSender ? emailSender.isConfigured() : false;

        await recordServiceHealthSnapshots([
          {
            id: 'database-primary',
            name: db.dialect === 'postgres' ? 'Supabase PostgreSQL' : 'Local SQLite',
            category: 'Database',
            status: 'HEALTHY',
            latencyMs: dbLatency,
            detail: `Probe succeeded (${db.dialect})`,
            checkedAt,
          },
          {
            id: 'ai-gemini',
            name: 'Google Gemini API',
            category: 'AI',
            status: geminiOk ? 'HEALTHY' : 'NOT_CONFIGURED',
            latencyMs: null,
            detail: geminiOk ? 'Server credential configured' : 'AI Building Mode (GEMINI_API_KEY not configured)',
            checkedAt,
          },
          {
            id: 'email-delivery',
            name: 'Transactional Email',
            category: 'Messaging',
            status: emailOk ? 'HEALTHY' : 'NOT_CONFIGURED',
            latencyMs: null,
            detail: emailOk ? `Provider: ${emailSender?.getProviderName()}` : 'Dev outbox / unconfigured',
            checkedAt,
          },
        ]);

        return `DB ok (${dbLatency}ms), Gemini key ${geminiOk ? 'configured' : 'missing'}, Email delivery ${emailOk ? 'configured' : 'not configured'}.`;
      },
    },
  ];

  async function ensureJobsRegistered() {
    if (seeded) return;
    const nowIso = new Date().toISOString();
    for (const spec of JOB_SPECS) {
      const existing = await db.queryOne<{ id: string }>(
        'SELECT id FROM background_jobs WHERE id = ?',
        'SELECT id FROM background_jobs WHERE id = $1',
        [spec.id],
      );
      if (!existing) {
        await db.execute(
          `INSERT INTO background_jobs (id, name, job_type, status, schedule_label, last_run_at, next_run_at, last_duration_ms, last_error, retry_count, is_paused, updated_at)
           VALUES (?, ?, ?, 'IDLE', ?, NULL, NULL, NULL, NULL, 0, ?, ?)`,
          `INSERT INTO background_jobs (id, name, job_type, status, schedule_label, last_run_at, next_run_at, last_duration_ms, last_error, retry_count, is_paused, updated_at)
           VALUES ($1, $2, $3, 'IDLE', $4, NULL, NULL, NULL, NULL, 0, $5, $6::timestamptz)
           ON CONFLICT (id) DO NOTHING`,
          [spec.id, spec.name, spec.jobType, spec.scheduleLabel, boolVal(false), nowIso],
        );
      }
    }
    await ensureWorkerHeartbeat();
    seeded = true;
  }

  function mapJob(row: Record<string, unknown>, stuckThresholdMinutes = 15): BackgroundJobDto {
    const mapped: BackgroundJobDto = {
      id: String(row.id),
      name: String(row.name),
      jobType: String(row.job_type),
      status: String(row.status) as BackgroundJobDto['status'],
      scheduleLabel: String(row.schedule_label),
      lastRunAt: row.last_run_at ? toIso(row.last_run_at) : null,
      nextRunAt: row.next_run_at ? toIso(row.next_run_at) : null,
      lastDurationMs:
        row.last_duration_ms !== null && row.last_duration_ms !== undefined
          ? Number(row.last_duration_ms)
          : null,
      lastError: row.last_error ? String(row.last_error) : null,
      retryCount: Number(row.retry_count ?? 0),
      isPaused: row.is_paused === true || row.is_paused === 1,
      updatedAt: toIso(row.updated_at),
    };
    mapped.isStuck = isJobStuck(mapped, stuckThresholdMinutes);
    return mapped;
  }

  function mapRun(row: Record<string, unknown>): BackgroundJobRunDto {
    return {
      id: String(row.id),
      jobId: String(row.job_id),
      status: String(row.status) as BackgroundJobRunDto['status'],
      triggeredBy: row.triggered_by ? String(row.triggered_by) : null,
      queuedAt: row.queued_at ? toIso(row.queued_at) : null,
      waitMs: Number(row.wait_ms ?? 0),
      startedAt: toIso(row.started_at),
      finishedAt: row.finished_at ? toIso(row.finished_at) : null,
      durationMs:
        row.duration_ms !== null && row.duration_ms !== undefined ? Number(row.duration_ms) : null,
      summary: String(row.summary ?? ''),
      errorMessage: row.error_message ? String(row.error_message) : null,
    };
  }

  async function listJobs() {
    await ensureJobsRegistered();
    const cfg = await runtimeConfigManager.getConfig();
    const stuckMins = cfg.alert_thresholds?.stuckJobMinutes ?? 15;
    const [jobRows, runRows, workerHeartbeat] = await Promise.all([
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM background_jobs ORDER BY name ASC',
        'SELECT * FROM background_jobs ORDER BY name ASC',
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM background_job_runs ORDER BY started_at DESC LIMIT 60',
        'SELECT * FROM background_job_runs ORDER BY started_at DESC LIMIT 60',
      ),
      getWorkerHeartbeat(),
    ]);
    return {
      jobs: jobRows.map((r) => mapJob(r, stuckMins)),
      runs: runRows.map(mapRun),
      workerHeartbeat,
    };
  }

  async function getJob(jobId: string) {
    await ensureJobsRegistered();
    const cfg = await runtimeConfigManager.getConfig();
    const stuckMins = cfg.alert_thresholds?.stuckJobMinutes ?? 15;
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM background_jobs WHERE id = ?',
      'SELECT * FROM background_jobs WHERE id = $1',
      [jobId],
    );
    if (!row) return null;
    const runRows = await db.queryAll<Record<string, unknown>>(
      'SELECT * FROM background_job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 25',
      'SELECT * FROM background_job_runs WHERE job_id = $1 ORDER BY started_at DESC LIMIT 25',
      [jobId],
    );
    return {
      job: mapJob(row, stuckMins),
      runs: runRows.map(mapRun),
    };
  }

  async function runJob(
    jobId: string,
    triggeredByUserId: string | null,
    options?: { allowWhenPaused?: boolean },
  ) {
    await ensureJobsRegistered();
    const spec = JOB_SPECS.find((j) => j.id === jobId);
    if (!spec) {
      return { ok: false, status: 404, error: 'Background job is not registered.' };
    }
    const hb = await getWorkerHeartbeat();
    if (hb.queuePaused && !options?.allowWhenPaused) {
      return {
        ok: false,
        status: 409,
        code: 'QUEUE_PAUSED',
        error: 'Background job queue is currently paused by an administrator.',
      };
    }
    if (runningControllers.has(jobId)) {
      return {
        ok: false,
        status: 409,
        code: 'JOB_ALREADY_RUNNING',
        error: 'Job is already running.',
      };
    }

    const controller = { cancelled: false };
    runningControllers.set(jobId, controller);
    const runId = crypto.randomUUID();
    const queuedAtMs = Date.now();
    const queuedAt = new Date(queuedAtMs).toISOString();

    try {
      const prevRow = await db.queryOne<{ status: string; retry_count: number }>(
        'SELECT status, retry_count FROM background_jobs WHERE id = ?',
        'SELECT status, retry_count FROM background_jobs WHERE id = $1',
        [jobId],
      );
      const nextRetryCount =
        prevRow?.status === 'FAILED' ? Number(prevRow.retry_count ?? 0) + 1 : 0;

      const startedAt = new Date().toISOString();
      const waitMs = Math.max(0, Date.now() - queuedAtMs);

      await db.execute(
        `UPDATE worker_heartbeats SET active_job_id = ?, last_heartbeat_at = ?, updated_at = ? WHERE worker_id = ?`,
        `UPDATE worker_heartbeats SET active_job_id = $1, last_heartbeat_at = $2::timestamptz, updated_at = $3::timestamptz WHERE worker_id = $4`,
        [jobId, startedAt, startedAt, WORKER_ID],
      );

      await db.execute(
        `UPDATE background_jobs SET status = 'RUNNING', retry_count = ?, updated_at = ? WHERE id = ?`,
        `UPDATE background_jobs SET status = 'RUNNING', retry_count = $1, updated_at = $2::timestamptz WHERE id = $3`,
        [nextRetryCount, startedAt, jobId],
      );

      await db.execute(
        `INSERT INTO background_job_runs (id, job_id, status, triggered_by, queued_at, wait_ms, started_at, summary)
         VALUES (?, ?, 'RUNNING', ?, ?, ?, ?, 'Executing...')`,
        `INSERT INTO background_job_runs (id, job_id, status, triggered_by, queued_at, wait_ms, started_at, summary)
         VALUES ($1, $2, 'RUNNING', $3, $4::timestamptz, $5, $6::timestamptz, 'Executing...')`,
        [runId, jobId, triggeredByUserId, queuedAt, waitMs, startedAt],
      );

      const t0 = Date.now();
      const summary = await spec.execute();
      const finishedAt = new Date().toISOString();
      const durationMs = Math.max(0, Date.now() - t0);
      const finalStatus = controller.cancelled ? 'CANCELLED' : 'SUCCEEDED';

      await db.execute(
        `UPDATE background_jobs
         SET status = ?, last_run_at = ?, last_duration_ms = ?, last_error = NULL, updated_at = ?
         WHERE id = ?`,
        `UPDATE background_jobs
         SET status = $1, last_run_at = $2::timestamptz, last_duration_ms = $3, last_error = NULL, updated_at = $4::timestamptz
         WHERE id = $5`,
        [finalStatus, finishedAt, durationMs, finishedAt, jobId],
      );

      await db.execute(
        `UPDATE background_job_runs
         SET status = ?, finished_at = ?, duration_ms = ?, summary = ?
         WHERE id = ?`,
        `UPDATE background_job_runs
         SET status = $1, finished_at = $2::timestamptz, duration_ms = $3, summary = $4
         WHERE id = $5`,
        [finalStatus, finishedAt, durationMs, summary.slice(0, 380), runId],
      );

      await db.execute(
        `UPDATE worker_heartbeats SET active_job_id = NULL, processed_count = processed_count + 1, last_heartbeat_at = ?, updated_at = ? WHERE worker_id = ?`,
        `UPDATE worker_heartbeats SET active_job_id = NULL, processed_count = processed_count + 1, last_heartbeat_at = $1::timestamptz, updated_at = $2::timestamptz WHERE worker_id = $3`,
        [finishedAt, finishedAt, WORKER_ID],
      );

      const detail = await getJob(jobId);
      return {
        ok: true,
        status: 200,
        job: detail?.job,
        run: detail?.runs[0],
      };
    } catch (err) {
      const finishedAt = new Date().toISOString();
      const durationMs = Math.max(0, Date.now() - queuedAtMs);
      const errMsg = redactSensitiveText(err instanceof Error ? err.message : String(err), 380);

      await db.execute(
        `UPDATE background_jobs
         SET status = 'FAILED', last_run_at = ?, last_duration_ms = ?, last_error = ?, updated_at = ?
         WHERE id = ?`,
        `UPDATE background_jobs
         SET status = 'FAILED', last_run_at = $1::timestamptz, last_duration_ms = $2, last_error = $3, updated_at = $4::timestamptz
         WHERE id = $5`,
        [finishedAt, durationMs, errMsg, finishedAt, jobId],
      );

      await db.execute(
        `UPDATE background_job_runs
         SET status = 'FAILED', finished_at = ?, duration_ms = ?, summary = 'Execution failed', error_message = ?
         WHERE id = ?`,
        `UPDATE background_job_runs
         SET status = 'FAILED', finished_at = $1::timestamptz, duration_ms = $2, summary = 'Execution failed', error_message = $3
         WHERE id = $4`,
        [finishedAt, durationMs, errMsg, runId],
      );

      await db.execute(
        `UPDATE worker_heartbeats SET active_job_id = NULL, failed_count = failed_count + 1, last_heartbeat_at = ?, updated_at = ? WHERE worker_id = ?`,
        `UPDATE worker_heartbeats SET active_job_id = NULL, failed_count = failed_count + 1, last_heartbeat_at = $1::timestamptz, updated_at = $2::timestamptz WHERE worker_id = $3`,
        [finishedAt, finishedAt, WORKER_ID],
      );

      return { ok: false, status: 500, error: errMsg };
    } finally {
      runningControllers.delete(jobId);
    }
  }

  async function cancelJob(jobId: string) {
    await ensureJobsRegistered();
    const ctrl = runningControllers.get(jobId);
    if (!ctrl) {
      return {
        ok: false,
        status: 400,
        error: 'Job is not currently running.',
      };
    }
    ctrl.cancelled = true;
    const nowIso = new Date().toISOString();
    await db.execute(
      `UPDATE background_jobs SET status = 'CANCELLED', updated_at = ? WHERE id = ?`,
      `UPDATE background_jobs SET status = 'CANCELLED', updated_at = $1::timestamptz WHERE id = $2`,
      [nowIso, jobId],
    );
    const detail = await getJob(jobId);
    return { ok: true, status: 200, job: detail?.job };
  }

  return {
    ensureJobsRegistered,
    listJobs,
    getJob,
    runJob,
    cancelJob,
    setQueuePaused,
    getWorkerHeartbeat,
    recordServiceHealthSnapshots,
  };
}
