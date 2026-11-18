import crypto from 'node:crypto';
import { stripControlChars } from '../lib/security';
import { redactSensitiveText } from './observabilityMath';
import {
  APPROVED_GEMINI_MODELS,
  type AutomationActionType,
  type AutomationTriggerType,
  type OperationalRecommendationDto,
  type PrivilegedActionType,
} from './types';

export const AUTOMATION_TRIGGER_TYPES: readonly AutomationTriggerType[] = [
  'SCHEDULED',
  'OPERATIONAL_EVENT',
  'ALERT_THRESHOLD',
  'JOB_FAILURE',
  'SECURITY_EVENT',
  'MANUAL',
];

export const AUTOMATION_ACTION_TYPES: readonly AutomationActionType[] = [
  'CREATE_ALERT',
  'ACKNOWLEDGE_ELIGIBLE_ALERT',
  'CREATE_INCIDENT',
  'ADD_INCIDENT_EVENT',
  'PAUSE_WORKER_QUEUE',
  'RESUME_WORKER_QUEUE',
  'DISABLE_FEATURE_FLAG',
  'GENERATE_GOVERNANCE_REMINDER',
  'RECORD_OPERATIONAL_EVENT',
];

export const HIGH_IMPACT_AUTOMATION_ACTIONS = new Set<AutomationActionType>([
  'PAUSE_WORKER_QUEUE',
  'DISABLE_FEATURE_FLAG',
  'CREATE_INCIDENT',
]);

export const FORBIDDEN_ACTION_KEYWORDS = [
  'SHELL',
  'EXEC',
  'EVAL',
  'SQL',
  'DROP_TABLE',
  'DELETE_USER',
  'DB_RESTORE',
  'GRANT_SUPER_ADMIN',
  'HTTP_REQUEST',
  'WEBHOOK_ARBITRARY',
];

export interface WorkflowValidationResult {
  valid: boolean;
  error?: string;
  normalized?: {
    workflowKey: string;
    name: string;
    description: string;
    triggerType: AutomationTriggerType;
    actionType: AutomationActionType;
    scheduleIntervalMinutes: number | null;
    requiresApproval: boolean;
    retryLimit: number;
    timeoutMs: number;
  };
}

export function validateAutomationWorkflowInput(input: {
  workflowKey?: unknown;
  name?: unknown;
  description?: unknown;
  triggerType?: unknown;
  actionType?: unknown;
  scheduleIntervalMinutes?: unknown;
  requiresApproval?: unknown;
  retryLimit?: unknown;
  timeoutMs?: unknown;
}): WorkflowValidationResult {
  const rawKey = typeof input.workflowKey === 'string' ? input.workflowKey.trim().toLowerCase() : '';
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(rawKey)) {
    return {
      valid: false,
      error: 'Workflow key must be 3–64 lowercase alphanumeric, hyphen, or underscore characters.',
    };
  }

  const name = typeof input.name === 'string' ? stripControlChars(input.name, 120).trim() : '';
  if (name.length < 3) {
    return { valid: false, error: 'Workflow name must be at least 3 characters.' };
  }

  const description =
    typeof input.description === 'string' ? stripControlChars(input.description, 400).trim() : '';

  const dangerousPattern = /\brm\s+-rf\b|\bexec\s*\(|\beval\s*\(|;\s*drop\s+table\b/i;
  if (dangerousPattern.test(name) || dangerousPattern.test(description)) {
    return {
      valid: false,
      error: 'Workflow name or description contains forbidden shell/eval/SQL execution patterns.',
    };
  }

  const triggerType =
    typeof input.triggerType === 'string' ? (input.triggerType.trim().toUpperCase() as AutomationTriggerType) : ('' as AutomationTriggerType);
  if (!AUTOMATION_TRIGGER_TYPES.includes(triggerType)) {
    return { valid: false, error: 'Unsupported automation trigger type.' };
  }

  const rawAction =
    typeof input.actionType === 'string' ? input.actionType.trim().toUpperCase() : '';
  if (FORBIDDEN_ACTION_KEYWORDS.some((kw) => rawAction.includes(kw))) {
    return {
      valid: false,
      error: 'Arbitrary execution, destructive user/database, or privilege escalation actions are forbidden in automation.',
    };
  }
  const actionType = rawAction as AutomationActionType;
  if (!AUTOMATION_ACTION_TYPES.includes(actionType)) {
    return { valid: false, error: 'Action must be chosen from the predefined safe action catalog.' };
  }

  let scheduleIntervalMinutes: number | null = null;
  if (input.scheduleIntervalMinutes !== null && input.scheduleIntervalMinutes !== undefined && input.scheduleIntervalMinutes !== '') {
    const num = Number(input.scheduleIntervalMinutes);
    if (!Number.isFinite(num) || num < 5 || num > 10080) {
      return { valid: false, error: 'Schedule interval must be between 5 and 10080 minutes.' };
    }
    scheduleIntervalMinutes = Math.round(num);
  }

  const retryLimitRaw = input.retryLimit === undefined ? 1 : Number(input.retryLimit);
  const retryLimit = Number.isFinite(retryLimitRaw)
    ? Math.max(0, Math.min(5, Math.round(retryLimitRaw)))
    : 1;

  const timeoutRaw = input.timeoutMs === undefined ? 5000 : Number(input.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw)
    ? Math.max(500, Math.min(60000, Math.round(timeoutRaw)))
    : 5000;

  // High-impact actions default to requiring human approval unless explicitly configured false by authorized admin;
  // keeping explicit opt-in/respecting boolean flag while capturing audit metadata.
  const requiresApproval =
    typeof input.requiresApproval === 'boolean'
      ? input.requiresApproval
      : HIGH_IMPACT_AUTOMATION_ACTIONS.has(actionType);

  return {
    valid: true,
    normalized: {
      workflowKey: rawKey,
      name,
      description,
      triggerType,
      actionType,
      scheduleIntervalMinutes,
      requiresApproval,
      retryLimit,
      timeoutMs,
    },
  };
}

export function normalizeIdempotencyKey(rawKey: unknown): string | null {
  if (typeof rawKey !== 'string') return null;
  const cleaned = stripControlChars(rawKey, 120).trim();
  if (!cleaned) return null;
  if (!/^[A-Za-z0-9:._-]{4,120}$/.test(cleaned)) {
    return crypto.createHash('sha256').update(cleaned).digest('hex').slice(0, 48);
  }
  return cleaned;
}

export function shouldSkipAutomationRun(params: {
  globalKillSwitchEnabled: boolean;
  workflowEnabled: boolean;
  workflowPaused: boolean;
  duplicateIdempotencyExists: boolean;
  activeRunInProgress: boolean;
}): { skip: boolean; status: 'BLOCKED' | 'SKIPPED'; reason?: string } {
  if (params.globalKillSwitchEnabled) {
    return {
      skip: true,
      status: 'BLOCKED',
      reason: 'Global automation kill switch is active.',
    };
  }
  if (!params.workflowEnabled) {
    return {
      skip: true,
      status: 'SKIPPED',
      reason: 'Workflow is currently disabled.',
    };
  }
  if (params.workflowPaused) {
    return {
      skip: true,
      status: 'SKIPPED',
      reason: 'Workflow is paused.',
    };
  }
  if (params.duplicateIdempotencyExists) {
    return {
      skip: true,
      status: 'SKIPPED',
      reason: 'Duplicate execution prevented by matching idempotency key.',
    };
  }
  if (params.activeRunInProgress) {
    return {
      skip: true,
      status: 'SKIPPED',
      reason: 'Concurrent duplicate execution prevented while a run is already active.',
    };
  }
  return { skip: false, status: 'SKIPPED' };
}

export const PRIVILEGED_ACTION_TYPES: readonly PrivilegedActionType[] = [
  'ROLE_PROMOTION',
  'SECURITY_POLICY_CHANGE',
  'PRODUCTION_RESTORE',
  'AI_POLICY_CRITICAL',
  'AUTOMATION_HIGH_IMPACT',
  'HIGH_IMPACT_OPERATION',
];

export function canApprovePrivilegedRequest(params: {
  requestedByUserId: string | null;
  reviewerUserId: string;
  reviewerRole: string;
  actionType: PrivilegedActionType;
}): { allowed: boolean; reason?: string } {
  if (params.requestedByUserId && params.requestedByUserId === params.reviewerUserId) {
    return {
      allowed: false,
      reason: 'Separation of duties violated: requester cannot approve or reject their own privileged action request.',
    };
  }

  const requiresSuperAdmin =
    params.actionType === 'ROLE_PROMOTION' || params.actionType === 'PRODUCTION_RESTORE';
  if (requiresSuperAdmin && params.reviewerRole !== 'super_admin') {
    return {
      allowed: false,
      reason: `Action type ${params.actionType} requires super_admin approval authority.`,
    };
  }

  return { allowed: true };
}

export interface AiPolicyValidationResult {
  valid: boolean;
  error?: string;
  normalized?: {
    name: string;
    allowedModels: string[];
    defaultModel: string;
    fallbackModel: string;
    fallbackEnabled: boolean;
    providerPriority: string[];
    rateLimitPerMin: number;
    maxInputChars: number;
    maxOutputTokens: number;
    timeoutMs: number;
    safetyMode: 'STRICT' | 'STANDARD';
    redactSensitiveInputs: boolean;
    blockPromptInjection: boolean;
    disabledCapabilities: string[];
    notes: string;
  };
}

export const ALLOWED_AI_CAPABILITIES = [
  'public_research',
  'workspace_research',
] as const;

export function validateAiPolicyInput(input: {
  name?: unknown;
  allowedModels?: unknown;
  defaultModel?: unknown;
  fallbackModel?: unknown;
  fallbackEnabled?: unknown;
  providerPriority?: unknown;
  rateLimitPerMin?: unknown;
  maxInputChars?: unknown;
  maxOutputTokens?: unknown;
  timeoutMs?: unknown;
  safetyMode?: unknown;
  redactSensitiveInputs?: unknown;
  blockPromptInjection?: unknown;
  disabledCapabilities?: unknown;
  notes?: unknown;
}): AiPolicyValidationResult {
  const name = typeof input.name === 'string' ? stripControlChars(input.name, 120).trim() : '';
  if (name.length < 3) {
    return { valid: false, error: 'AI policy name must be at least 3 characters.' };
  }

  const approvedSet = new Set<string>(APPROVED_GEMINI_MODELS);
  const rawModels = Array.isArray(input.allowedModels) ? input.allowedModels : [APPROVED_GEMINI_MODELS[0]];
  const allowedModels = Array.from(
    new Set(
      rawModels
        .filter((m): m is string => typeof m === 'string')
        .map((m) => m.trim())
        .filter((m) => approvedSet.has(m)),
    ),
  );

  if (allowedModels.length === 0) {
    return {
      valid: false,
      error: `At least one approved Gemini model must be included (${APPROVED_GEMINI_MODELS.join(', ')}).`,
    };
  }

  const defaultModel =
    typeof input.defaultModel === 'string' && allowedModels.includes(input.defaultModel.trim())
      ? input.defaultModel.trim()
      : allowedModels[0];

  const fallbackModelRaw =
    typeof input.fallbackModel === 'string' ? stripControlChars(input.fallbackModel, 64).trim() : 'none';
  const fallbackModel =
    fallbackModelRaw === 'none' ||
    fallbackModelRaw === 'building-mode' ||
    allowedModels.includes(fallbackModelRaw)
      ? fallbackModelRaw
      : 'none';

  const rateLimitPerMin = Number(input.rateLimitPerMin ?? 25);
  if (!Number.isFinite(rateLimitPerMin) || rateLimitPerMin < 1 || rateLimitPerMin > 500) {
    return { valid: false, error: 'Rate limit must be between 1 and 500 requests/minute.' };
  }

  const maxInputChars = Number(input.maxInputChars ?? 1000);
  if (!Number.isFinite(maxInputChars) || maxInputChars < 100 || maxInputChars > 4000) {
    return { valid: false, error: 'Max input length must be between 100 and 4000 characters.' };
  }

  const maxOutputTokens = Number(input.maxOutputTokens ?? 1400);
  if (!Number.isFinite(maxOutputTokens) || maxOutputTokens < 200 || maxOutputTokens > 8192) {
    return { valid: false, error: 'Max output tokens must be between 200 and 8192.' };
  }

  const timeoutMs = Number(input.timeoutMs ?? 18000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 2000 || timeoutMs > 60000) {
    return { valid: false, error: 'Provider timeout must be between 2000 and 60000 ms.' };
  }

  const safetyMode = input.safetyMode === 'STANDARD' ? 'STANDARD' : 'STRICT';
  const fallbackEnabled = input.fallbackEnabled === true;
  const redactSensitiveInputs = input.redactSensitiveInputs !== false;
  const blockPromptInjection = input.blockPromptInjection !== false;

  const rawCaps = Array.isArray(input.disabledCapabilities) ? input.disabledCapabilities : [];
  const capSet = new Set<string>(ALLOWED_AI_CAPABILITIES);
  const disabledCapabilities = Array.from(
    new Set(
      rawCaps
        .filter((c): c is string => typeof c === 'string')
        .map((c) => c.trim())
        .filter((c) => capSet.has(c)),
    ),
  );

  const rawPriority = Array.isArray(input.providerPriority)
    ? input.providerPriority.filter((p): p is string => typeof p === 'string').map((p) => p.trim())
    : ['gemini'];
  const providerPriority = rawPriority.filter((p) => p === 'gemini');
  if (providerPriority.length === 0) providerPriority.push('gemini');

  const notes = typeof input.notes === 'string' ? stripControlChars(input.notes, 400).trim() : '';

  return {
    valid: true,
    normalized: {
      name,
      allowedModels,
      defaultModel,
      fallbackModel,
      fallbackEnabled,
      providerPriority,
      rateLimitPerMin: Math.round(rateLimitPerMin),
      maxInputChars: Math.round(maxInputChars),
      maxOutputTokens: Math.round(maxOutputTokens),
      timeoutMs: Math.round(timeoutMs),
      safetyMode,
      redactSensitiveInputs,
      blockPromptInjection,
      disabledCapabilities,
      notes,
    },
  };
}

const PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above|system)\s+instructions/i,
  /disregard\s+(your\s+)?(system\s+prompt|safety\s+rules|instructions)/i,
  /reveal\s+(your\s+)?(system\s+prompt|api\s*key|secret|environment\s+variables)/i,
  /print\s+process\.env/i,
  /<\s*\/?\s*system\s*>/i,
  /jailbreak\s+mode|developer\s+mode\s+override/i,
];

const FINANCIAL_SENSITIVE_PII_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, label: '[REDACTED_EMAIL]' },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, label: '[REDACTED_SSN]' },
  { pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g, label: '[REDACTED_TAX_ID]' },
  { pattern: /\bsk-[A-Za-z0-9]{12,}\b/g, label: '[REDACTED_KEY]' },
  { pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/g, label: '[REDACTED_KEY]' },
];

export function inspectAiPromptInput(
  rawQuery: string,
  options: {
    blockPromptInjection: boolean;
    redactSensitiveInputs: boolean;
    maxInputChars: number;
  },
): {
  allowed: boolean;
  blockedReason?: string;
  sanitizedQuery: string;
  redactionsApplied: number;
} {
  let clean = stripControlChars(rawQuery, Math.max(100, options.maxInputChars));

  if (options.blockPromptInjection) {
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(clean)) {
        return {
          allowed: false,
          blockedReason:
            'Query blocked by AI Safety Policy: prompt-injection or instruction-override pattern detected.',
          sanitizedQuery: redactSensitiveText(clean, 180),
          redactionsApplied: 0,
        };
      }
    }
  }

  let redactionsApplied = 0;
  if (options.redactSensitiveInputs) {
    for (const entry of FINANCIAL_SENSITIVE_PII_PATTERNS) {
      const next = clean.replace(entry.pattern, () => {
        redactionsApplied += 1;
        return entry.label;
      });
      clean = next;
    }
    const furtherRedacted = redactSensitiveText(clean, options.maxInputChars);
    if (furtherRedacted !== clean) {
      redactionsApplied += 1;
    }
    clean = furtherRedacted;
  }

  return {
    allowed: true,
    sanitizedQuery: clean,
    redactionsApplied,
  };
}

export function sanitizeAdminSearchQuery(rawQuery: unknown): string {
  if (typeof rawQuery !== 'string') return '';
  return stripControlChars(rawQuery, 80).trim();
}

export interface IntelligenceSnapshotMetrics {
  apiRequestCount: number;
  apiErrorRatePct: number;
  apiP95LatencyMs: number | null;
  aiTotalRequests: number;
  aiFailureCount: number;
  marketSyncStale: boolean;
  marketLastSyncAt: string | null;
  failedJobsCount: number;
  overduePrivacyCount: number;
  unverifiedBackupsCount: number;
  pendingAccessReviewsCount: number;
  openCriticalAlertsCount: number;
  openIncidentsCount: number;
}

export function deriveOperationalRecommendations(
  m: IntelligenceSnapshotMetrics,
): OperationalRecommendationDto[] {
  const recs: OperationalRecommendationDto[] = [];

  if (m.openCriticalAlertsCount > 0 || m.openIncidentsCount > 0) {
    recs.push({
      id: 'rec-critical-response',
      category: 'API_LATENCY',
      severity: 'CRITICAL',
      title: 'Triage active critical operational alerts & open incidents',
      rationale: `${m.openCriticalAlertsCount} critical alert(s) and ${m.openIncidentsCount} active incident(s) require operator verification or playbook execution.`,
      evidenceType: 'MEASURED',
      supportingMetrics: [
        `openCriticalAlerts=${m.openCriticalAlertsCount}`,
        `openIncidents=${m.openIncidentsCount}`,
      ],
      recommendedRoute: '/admin/emergency',
      recommendedActionLabel: 'Open Emergency Centre',
    });
  }

  if (m.apiP95LatencyMs !== null && m.apiP95LatencyMs >= 1000) {
    recs.push({
      id: 'rec-api-latency',
      category: 'API_LATENCY',
      severity: m.apiP95LatencyMs >= 2000 ? 'HIGH' : 'MEDIUM',
      title: 'Investigate elevated API P95 response latency',
      rationale: `Measured API P95 latency is ${m.apiP95LatencyMs}ms across recent /api/* requests.`,
      evidenceType: 'MEASURED',
      supportingMetrics: [
        `apiP95LatencyMs=${m.apiP95LatencyMs}`,
        `apiErrorRatePct=${m.apiErrorRatePct}%`,
        `apiRequests=${m.apiRequestCount}`,
      ],
      recommendedRoute: '/admin/apis',
      recommendedActionLabel: 'Inspect API Observability',
    });
  }

  if (m.aiTotalRequests > 0 && m.aiFailureCount / m.aiTotalRequests >= 0.2) {
    recs.push({
      id: 'rec-ai-reliability',
      category: 'AI_RELIABILITY',
      severity: 'HIGH',
      title: 'Review AI provider failure / fallback ratio and active AI policy',
      rationale: `${m.aiFailureCount} of ${m.aiTotalRequests} AI requests failed or fell back cleanly.`,
      evidenceType: 'DERIVED',
      supportingMetrics: [
        `aiFailedOrFallback=${m.aiFailureCount}`,
        `aiTotalRequests=${m.aiTotalRequests}`,
      ],
      recommendedRoute: '/admin/ai-policies',
      recommendedActionLabel: 'Review AI Policy & Fallback',
    });
  }

  if (m.marketSyncStale) {
    recs.push({
      id: 'rec-market-stale',
      category: 'MARKET_DATA_STALE',
      severity: 'MEDIUM',
      title: 'Run Market Catalog Snapshot verification job',
      rationale: m.marketLastSyncAt
        ? `Last market catalog verification ran at ${m.marketLastSyncAt} and exceeds stale threshold.`
        : 'Market catalog snapshot verification has not been executed yet.',
      evidenceType: 'DERIVED',
      supportingMetrics: [`lastSyncAt=${m.marketLastSyncAt ?? 'never'}`],
      recommendedRoute: '/admin/jobs',
      recommendedActionLabel: 'Run Market Sync Job',
    });
  }

  if (m.failedJobsCount > 0) {
    recs.push({
      id: 'rec-failed-jobs',
      category: 'JOB_FAILURES',
      severity: 'HIGH',
      title: 'Inspect failed background maintenance jobs',
      rationale: `${m.failedJobsCount} registered background job(s) currently report FAILED status.`,
      evidenceType: 'MEASURED',
      supportingMetrics: [`failedJobs=${m.failedJobsCount}`],
      recommendedRoute: '/admin/jobs',
      recommendedActionLabel: 'Inspect Worker & Jobs',
    });
  }

  if (m.overduePrivacyCount > 0) {
    recs.push({
      id: 'rec-overdue-privacy',
      category: 'PRIVACY_OVERDUE',
      severity: 'HIGH',
      title: 'Process pending user privacy export or deletion requests',
      rationale: `${m.overduePrivacyCount} privacy export/deletion request(s) remain awaiting review or action.`,
      evidenceType: 'MEASURED',
      supportingMetrics: [`pendingPrivacyRequests=${m.overduePrivacyCount}`],
      recommendedRoute: '/admin/privacy',
      recommendedActionLabel: 'Open Privacy Queue',
    });
  }

  if (m.unverifiedBackupsCount > 0) {
    recs.push({
      id: 'rec-backup-verify',
      category: 'BACKUP_READINESS',
      severity: 'MEDIUM',
      title: 'Verify unverified backup / configuration snapshots',
      rationale: `${m.unverifiedBackupsCount} backup record(s) are unverified or awaiting SHA-256 verification.`,
      evidenceType: 'MEASURED',
      supportingMetrics: [`unverifiedBackups=${m.unverifiedBackupsCount}`],
      recommendedRoute: '/admin/backups',
      recommendedActionLabel: 'Open Backups & DR',
    });
  }

  if (m.pendingAccessReviewsCount > 0) {
    recs.push({
      id: 'rec-access-review',
      category: 'ACCESS_REVIEW',
      severity: 'MEDIUM',
      title: 'Complete privileged administrator access reviews',
      rationale: `${m.pendingAccessReviewsCount} privileged account(s) have pending or overdue access governance reviews.`,
      evidenceType: 'DERIVED',
      supportingMetrics: [`pendingAccessReviews=${m.pendingAccessReviewsCount}`],
      recommendedRoute: '/admin/access-reviews',
      recommendedActionLabel: 'Review Privileged Access',
    });
  }

  return recs;
}
