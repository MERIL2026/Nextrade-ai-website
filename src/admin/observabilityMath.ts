import type {
  AlertCategory,
  AlertSeverity,
  ObservabilityRangeKey,
  ObservabilityThresholdsConfig,
  SecurityEventSeverity,
} from './types';

export interface ResolvedTimeWindow {
  range: ObservabilityRangeKey;
  fromIso: string | null;
  toIso: string;
  previousFromIso: string | null;
  previousToIso: string | null;
  durationMs: number | null;
}

export function resolveObservabilityWindow(
  rawRange: unknown,
  rawFrom?: unknown,
  rawTo?: unknown,
  nowMs: number = Date.now(),
): ResolvedTimeWindow {
  const toDefaultIso = new Date(nowMs).toISOString();

  if (rawRange === 'custom') {
    const parsedFrom = typeof rawFrom === 'string' ? Date.parse(rawFrom) : NaN;
    const parsedTo = typeof rawTo === 'string' && rawTo.trim() ? Date.parse(rawTo) : nowMs;
    if (Number.isFinite(parsedFrom) && Number.isFinite(parsedTo) && parsedTo > parsedFrom) {
      // Clamp custom window to at most 90 days
      const clampedDuration = Math.min(parsedTo - parsedFrom, 90 * 24 * 60 * 60 * 1000);
      const effectiveTo = parsedTo;
      const effectiveFrom = effectiveTo - clampedDuration;
      return {
        range: 'custom',
        fromIso: new Date(effectiveFrom).toISOString(),
        toIso: new Date(effectiveTo).toISOString(),
        previousFromIso: new Date(effectiveFrom - clampedDuration).toISOString(),
        previousToIso: new Date(effectiveFrom).toISOString(),
        durationMs: clampedDuration,
      };
    }
  }

  const presetDurations: Record<Exclude<ObservabilityRangeKey, 'all' | 'custom'>, number> = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };

  if (
    rawRange === '15m' ||
    rawRange === '1h' ||
    rawRange === '24h' ||
    rawRange === '7d' ||
    rawRange === '30d'
  ) {
    const durationMs = presetDurations[rawRange];
    const fromMs = nowMs - durationMs;
    return {
      range: rawRange,
      fromIso: new Date(fromMs).toISOString(),
      toIso: toDefaultIso,
      previousFromIso: new Date(fromMs - durationMs).toISOString(),
      previousToIso: new Date(fromMs).toISOString(),
      durationMs,
    };
  }

  if (rawRange === 'all') {
    return {
      range: 'all',
      fromIso: null,
      toIso: toDefaultIso,
      previousFromIso: null,
      previousToIso: null,
      durationMs: null,
    };
  }

  // Default to 24h for observability views
  const defaultDuration = presetDurations['24h'];
  const fromMs = nowMs - defaultDuration;
  return {
    range: '24h',
    fromIso: new Date(fromMs).toISOString(),
    toIso: toDefaultIso,
    previousFromIso: new Date(fromMs - defaultDuration).toISOString(),
    previousToIso: new Date(fromMs).toISOString(),
    durationMs: defaultDuration,
  };
}

export interface LatencyStats {
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export function percentileFromSorted(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return Math.round(sortedAsc[0]);
  const rank = Math.ceil((p / 100) * sortedAsc.length) - 1;
  const idx = Math.max(0, Math.min(sortedAsc.length - 1, rank));
  return Math.round(sortedAsc[idx]);
}

export function computeLatencyStats(latencies: number[]): LatencyStats {
  const valid = latencies.filter((n) => Number.isFinite(n) && n >= 0);
  if (valid.length === 0) {
    return { count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  }
  const sorted = [...valid].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    avgMs: Math.round(sum / sorted.length),
    p50Ms: percentileFromSorted(sorted, 50),
    p95Ms: percentileFromSorted(sorted, 95),
    p99Ms: percentileFromSorted(sorted, 99),
    maxMs: Math.round(sorted[sorted.length - 1]),
  };
}

export function computePeriodDeltaPct(current: number, previous: number | null): number | null {
  if (previous === null) return null;
  if (previous === 0) {
    if (current === 0) return 0;
    return 100;
  }
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

export function sanitizeRoutePath(rawUrl: string): string {
  const pathOnly = (rawUrl || '/api').split('?')[0].split('#')[0] || '/api';
  return pathOnly
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/NXT-[A-Z0-9-]+/gi, '/:ticketId')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ':email')
    .replace(/(bearer|token|key|secret)[=:/][A-Za-z0-9._-]+/gi, '$1=[REDACTED]')
    .replace(/\/[0-9]{4,}/g, '/:num')
    .slice(0, 150);
}

export function redactSensitiveText(raw: string, maxLen = 180): string {
  if (!raw) return '';
  let out = raw
    // Emails
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
    // Bearer / JWT / API keys (AIza..., sk_..., re_...)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bAIza[0-9A-Za-z_-]{16,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\b(sk|pk|re|eyJ)[A-Za-z0-9._-]{12,}\b/g, '[REDACTED_TOKEN]')
    // Key=value secrets
    .replace(/(password|passwd|secret|token|apikey|api_key|authorization|cookie)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    // Long digit strings (cards/phones/accounts >= 8 digits)
    .replace(/\b\d{8,}\b/g, '[REDACTED_NUMBER]');
  out = out.trim();
  if (out.length > maxLen) {
    return `${out.slice(0, maxLen)}…`;
  }
  return out;
}

export function maskUserPromptSummary(queryPreview: string, symbol: string): string {
  const redacted = redactSensitiveText(queryPreview, 64);
  if (!redacted) return `[Research query for ${symbol || 'MARKET'}]`;
  return `[Redacted Preview · ${symbol || 'MARKET'}] ${redacted.slice(0, 36)}${redacted.length > 36 ? '…' : ''}`;
}

export function classifySecurityEventSeverity(eventType: string, detail = ''): SecurityEventSeverity {
  const t = eventType.toLowerCase();
  const d = detail.toLowerCase();
  if (
    t.includes('account_deleted') ||
    t.includes('role_escalat') ||
    t.includes('csrf') ||
    t.includes('admin_reauth_failed') ||
    d.includes('brute') ||
    d.includes('suspended')
  ) {
    return 'CRITICAL';
  }
  if (
    t.includes('login_blocked') ||
    t.includes('session_revok') ||
    t.includes('password_reset_request') ||
    t.includes('rate_limit') ||
    t.includes('unauthorized')
  ) {
    return 'HIGH';
  }
  if (t.includes('login_failed') || t.includes('invalid') || t.includes('expired')) {
    return 'MEDIUM';
  }
  return 'LOW';
}

export function isJobStuck(
  job: { status: string; updatedAt: string; lastRunAt: string | null },
  thresholdMinutes: number,
  nowMs: number = Date.now(),
): boolean {
  if (job.status !== 'RUNNING') return false;
  const refIso = job.updatedAt || job.lastRunAt;
  if (!refIso) return false;
  const ts = Date.parse(refIso);
  if (!Number.isFinite(ts)) return false;
  return nowMs - ts > Math.max(1, thresholdMinutes) * 60 * 1000;
}

export interface AlertCandidate {
  fingerprint: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  description: string;
  serviceId: string;
  metricValue: number;
  thresholdValue: number;
  eventRefs: string[];
}

export interface AlertEvaluationSignals {
  apiTotal: number;
  api5xxCount: number;
  apiErrorRatePct: number;
  apiP95LatencyMs: number;
  apiRateLimitCount: number;
  aiTotal: number;
  aiFailedCount: number;
  aiErrorRatePct: number;
  failedLoginsWindow: number;
  marketLastSyncAgeMinutes: number | null;
  marketLastSyncStatus: 'IDLE' | 'SUCCEEDED' | 'FAILED';
  stuckJobsCount: number;
  failedJobsCount: number;
  stuckJobIds: string[];
  failedJobIds: string[];
}

export function evaluateAlertCandidates(
  signals: AlertEvaluationSignals,
  thresholds: ObservabilityThresholdsConfig,
): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];

  if (signals.apiTotal >= 10 && signals.apiErrorRatePct >= thresholds.apiErrorRateCriticalPct) {
    candidates.push({
      fingerprint: 'api:error-rate-high',
      category: 'API',
      severity: signals.api5xxCount >= 5 ? 'CRITICAL' : 'HIGH',
      title: `Elevated API Error Rate (${signals.apiErrorRatePct}%)`,
      description: `${signals.api5xxCount} HTTP 5xx / error responses detected across ${signals.apiTotal} recent API requests (threshold: ${thresholds.apiErrorRateCriticalPct}%).`,
      serviceId: 'backend-express',
      metricValue: signals.apiErrorRatePct,
      thresholdValue: thresholds.apiErrorRateCriticalPct,
      eventRefs: ['api_request_logs:recent'],
    });
  }

  if (signals.apiTotal >= 5 && signals.apiP95LatencyMs >= thresholds.apiP95LatencyWarningMs) {
    candidates.push({
      fingerprint: 'api:latency-p95-spike',
      category: 'API',
      severity: signals.apiP95LatencyMs >= thresholds.apiP95LatencyWarningMs * 2 ? 'CRITICAL' : 'HIGH',
      title: `API P95 Latency Spike (${signals.apiP95LatencyMs}ms)`,
      description: `Observed P95 response latency (${signals.apiP95LatencyMs}ms) exceeded configured threshold of ${thresholds.apiP95LatencyWarningMs}ms.`,
      serviceId: 'backend-express',
      metricValue: signals.apiP95LatencyMs,
      thresholdValue: thresholds.apiP95LatencyWarningMs,
      eventRefs: ['api_request_logs:p95'],
    });
  }

  if (signals.aiTotal >= 3 && signals.aiErrorRatePct >= thresholds.aiFailureRateWarningPct) {
    candidates.push({
      fingerprint: 'ai:failure-rate-elevated',
      category: 'AI',
      severity: 'HIGH',
      title: `AI Request Failure Rate (${signals.aiErrorRatePct}%)`,
      description: `${signals.aiFailedCount} of ${signals.aiTotal} recent AI research calls failed (threshold: ${thresholds.aiFailureRateWarningPct}%).`,
      serviceId: 'ai-gemini',
      metricValue: signals.aiErrorRatePct,
      thresholdValue: thresholds.aiFailureRateWarningPct,
      eventRefs: ['ai_request_logs:failed'],
    });
  }

  if (signals.failedLoginsWindow >= thresholds.failedLoginsBurstThreshold) {
    candidates.push({
      fingerprint: 'security:failed-login-burst',
      category: 'SECURITY',
      severity: signals.failedLoginsWindow >= thresholds.failedLoginsBurstThreshold * 2 ? 'CRITICAL' : 'HIGH',
      title: `Repeated Failed Login Activity (${signals.failedLoginsWindow} attempts)`,
      description: `${signals.failedLoginsWindow} failed or blocked authentication attempts detected within evaluation window (threshold: ${thresholds.failedLoginsBurstThreshold}).`,
      serviceId: 'auth-service',
      metricValue: signals.failedLoginsWindow,
      thresholdValue: thresholds.failedLoginsBurstThreshold,
      eventRefs: ['auth_security_events:login_failed'],
    });
  }

  if (signals.marketLastSyncStatus === 'FAILED') {
    candidates.push({
      fingerprint: 'market:catalog-sync-failed',
      category: 'MARKET_DATA',
      severity: 'HIGH',
      title: 'Market Data Verification Sync Failed',
      description: 'The most recent market catalog verification run reported FAILED status.',
      serviceId: 'market-data-engine',
      metricValue: 1,
      thresholdValue: 0,
      eventRefs: ['market_data_health:latest'],
    });
  } else if (
    signals.marketLastSyncAgeMinutes !== null &&
    signals.marketLastSyncAgeMinutes > thresholds.marketSyncStaleMinutes
  ) {
    candidates.push({
      fingerprint: 'market:catalog-sync-stale',
      category: 'MARKET_DATA',
      severity: 'MEDIUM',
      title: `Market Catalog Verification Stale (${Math.round(signals.marketLastSyncAgeMinutes)}m ago)`,
      description: `Last verified catalog sync occurred ${Math.round(signals.marketLastSyncAgeMinutes)} minutes ago (threshold: ${thresholds.marketSyncStaleMinutes}m).`,
      serviceId: 'market-data-engine',
      metricValue: Math.round(signals.marketLastSyncAgeMinutes),
      thresholdValue: thresholds.marketSyncStaleMinutes,
      eventRefs: ['market_data_health:stale'],
    });
  }

  if (signals.stuckJobsCount > 0) {
    candidates.push({
      fingerprint: 'jobs:stuck-job-detected',
      category: 'BACKGROUND_JOB',
      severity: 'CRITICAL',
      title: `Stuck Background Job Detected (${signals.stuckJobIds.join(', ')})`,
      description: `${signals.stuckJobsCount} job(s) remained in RUNNING state beyond ${thresholds.stuckJobMinutes} minutes.`,
      serviceId: 'background-jobs',
      metricValue: signals.stuckJobsCount,
      thresholdValue: 0,
      eventRefs: signals.stuckJobIds.map((id) => `job:${id}`),
    });
  }

  if (signals.failedJobsCount > 0) {
    candidates.push({
      fingerprint: 'jobs:execution-failed',
      category: 'BACKGROUND_JOB',
      severity: 'HIGH',
      title: `Background Job Failures (${signals.failedJobsCount})`,
      description: `${signals.failedJobsCount} registered background job(s) currently in FAILED state: ${signals.failedJobIds.join(', ')}.`,
      serviceId: 'background-jobs',
      metricValue: signals.failedJobsCount,
      thresholdValue: 0,
      eventRefs: signals.failedJobIds.map((id) => `job:${id}`),
    });
  }

  return candidates;
}

export function shouldBypassCooldownOnSeverityEscalation(
  previousSeverity: AlertSeverity,
  nextSeverity: AlertSeverity,
): boolean {
  const rank: Record<AlertSeverity, number> = {
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
    CRITICAL: 4,
  };
  return rank[nextSeverity] > rank[previousSeverity];
}
