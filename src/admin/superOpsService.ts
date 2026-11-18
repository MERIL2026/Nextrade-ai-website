import crypto from 'node:crypto';
import type { AuthDatabase, UserRole } from '../auth/db';
import {
  ADMIN_ROLES,
  PERMISSIONS,
  Permission,
  isValidUserRole,
  normalizeUserRole,
  resolveUserPermissions,
} from '../auth/rbac';
import { stripControlChars } from '../lib/security';
import type { GovernanceService } from './governanceService';
import type { ObservabilityService } from './observabilityService';
import type { RuntimeConfigManager } from './runtimeSettings';
import type { AdminActor, AdminOutcome } from './service';
import {
  PRIVILEGED_ACTION_TYPES,
  canApprovePrivilegedRequest,
  deriveOperationalRecommendations,
  normalizeIdempotencyKey,
  sanitizeAdminSearchQuery,
  shouldSkipAutomationRun,
  validateAiPolicyInput,
  validateAutomationWorkflowInput,
} from './superOpsMath';
import type { BackgroundJobManager } from './telemetry';
import {
  APPROVED_GEMINI_MODELS,
  type AccessReviewStatus,
  type AiPolicyVersionDto,
  type AutomationActionType,
  type AutomationEventDto,
  type AutomationRunDto,
  type AutomationRunStatus,
  type AutomationTriggerType,
  type AutomationWorkflowDto,
  type EmergencyAccessGrantDto,
  type EmergencyAccessStatus,
  type EmergencyEventDto,
  type EmergencyPlaybookDto,
  type GlobalSearchResultItemDto,
  type IncidentSeverity,
  type PrivilegedAccessReviewDto,
  type PrivilegedAccountInspectionDto,
  type PrivilegedActionHistoryDto,
  type PrivilegedActionRequestDto,
  type PrivilegedActionRequestStatus,
  type PrivilegedActionType,
  type UnifiedTimelineItemDto,
} from './types';

function toIso(v: unknown): string {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function toBoolField(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export interface CreateSuperOpsServiceOptions {
  db: AuthDatabase;
  runtimeConfigManager: RuntimeConfigManager;
  jobManager: BackgroundJobManager;
  observability: ObservabilityService;
  governance: GovernanceService;
  writeAuditLog: (params: {
    actor: AdminActor | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    previousValue?: unknown;
    newValue?: unknown;
    result?: 'SUCCESS' | 'DENIED' | 'ERROR';
  }) => Promise<void>;
  assignUserRole: (
    actor: AdminActor,
    targetUserId: string,
    rawNewRole: unknown,
    reason?: string,
  ) => Promise<AdminOutcome<{ userId: string; role: UserRole }>>;
  executeEmergencyOperation: (
    actor: AdminActor,
    operation: unknown,
    reason?: string,
  ) => Promise<AdminOutcome<{ operation: string; detail: string }>>;
  revokeTargetUserSession: (
    actor: AdminActor,
    targetUserId: string,
    sessionId?: string,
  ) => Promise<AdminOutcome<{ revokedCount: number }>>;
}

const SAFE_EMERGENCY_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.ADMIN_CONSOLE_READ,
  PERMISSIONS.ADMIN_ALERTS_READ,
  PERMISSIONS.ADMIN_ALERTS_MANAGE,
  PERMISSIONS.ADMIN_INCIDENTS_READ,
  PERMISSIONS.ADMIN_INCIDENTS_MANAGE,
  PERMISSIONS.ADMIN_SECURITY_READ,
  PERMISSIONS.ADMIN_EMERGENCY_READ,
];

const SEEDED_PLAYBOOKS: Array<{
  playbookKey: string;
  title: string;
  category: string;
  severity: IncidentSeverity;
  triggerConditions: string;
  investigationSteps: string[];
  safeActions: string[];
  escalationRequirements: string;
  recoveryValidation: string;
  resolutionCriteria: string;
}> = [
  {
    playbookKey: 'ai-provider-outage',
    title: 'AI Provider Outage & Upstream Degradation',
    category: 'AI',
    severity: 'HIGH',
    triggerConditions: 'Gemini failure rate >= 25% or sustained upstream 5xx / timeout responses.',
    investigationSteps: [
      'Inspect /admin/ai and /admin/ai-policies error explorer without viewing user prompts.',
      'Check GEMINI_API_KEY configuration status and recent latency trends.',
      'Verify whether AI Building Mode cleanly communicates unavailability when upstream fails.',
    ],
    safeActions: [
      'Activate safe fallback mode or disable affected model inside /admin/ai-policies.',
      'Temporarily disable public_research or AI capability if errors cascade.',
      'Escalate incident with linked telemetry event refs.',
    ],
    escalationRequirements: 'Notify AI Admin and Platform Admin if outage exceeds 15 minutes.',
    recoveryValidation: 'Verify 5 consecutive AI research probes succeed within policy timeout.',
    resolutionCriteria: 'AI failure rate drops below warning threshold and active provider returns HTTP 200.',
  },
  {
    playbookKey: 'market-data-outage',
    title: 'Market Data Snapshot / Catalog Degradation',
    category: 'MARKET_DATA',
    severity: 'MEDIUM',
    triggerConditions: 'Market catalog verification job fails or market sync staleness exceeds threshold.',
    investigationSteps: [
      'Review /admin/markets provider status and /admin/jobs run history.',
      'Verify region filters (IN/US) and disabled symbols list.',
    ],
    safeActions: [
      'Run Market Catalog Snapshot verification job via /admin/jobs.',
      'Publish informational banner notice if catalog coverage is reduced.',
    ],
    escalationRequirements: 'Notify Data Admin if validation failures affect primary benchmarks.',
    recoveryValidation: 'Market sync job finishes SUCCEEDED with 0 validation failures.',
    resolutionCriteria: 'All enabled IN and US catalog symbols validate cleanly.',
  },
  {
    playbookKey: 'api-degradation',
    title: 'API Latency Spike or Elevated 5xx Rate',
    category: 'API',
    severity: 'CRITICAL',
    triggerConditions: 'API 5xx rate >= critical threshold or P95 latency >= 1200ms sustained.',
    investigationSteps: [
      'Open /admin/apis to isolate slow or failing endpoints.',
      'Correlate latency spikes with recent releases, feature flags, or database queries.',
    ],
    safeActions: [
      'Disable non-essential client feature flags or pause background maintenance jobs.',
      'Enable maintenance banner/mode with Super Admin bypass if core routes degrade.',
    ],
    escalationRequirements: 'Immediate escalation to Super Admin and Platform Admin.',
    recoveryValidation: 'API P95 returns below threshold and 5xx ring buffer shows 0 new errors for 10m.',
    resolutionCriteria: 'Confirmed stability across /api/health, /api/workspace/profile, and /api/markets.',
  },
  {
    playbookKey: 'database-connectivity-failure',
    title: 'Database Pool Saturation or Connectivity Failure',
    category: 'INFRASTRUCTURE',
    severity: 'CRITICAL',
    triggerConditions: 'Health probe fails SELECT 1 or elevated PostgreSQL / pooler timeouts occur.',
    investigationSteps: [
      'Check /admin/infrastructure DB latency probe and PostgreSQL pooler health.',
      'Verify whether PgBouncer connection limits or upstream Supabase incidents exist.',
    ],
    safeActions: [
      'Pause background worker queue to shed non-critical write pressure.',
      'Activate maintenance mode to protect workspace transactions until pool recovers.',
    ],
    escalationRequirements: 'Page Super Admin immediately; coordinate Supabase Managed Backup/PITR review if needed.',
    recoveryValidation: 'Platform Dependency Health Probe reports DB ok (<250ms).',
    resolutionCriteria: 'Sustained zero connection errors across health probes and auth queries.',
  },
  {
    playbookKey: 'background-worker-failure',
    title: 'Background Worker Failures or Stuck Jobs',
    category: 'JOBS',
    severity: 'HIGH',
    triggerConditions: 'Job failure streaks or stuck job exceeding stuckJobMinutes threshold.',
    investigationSteps: [
      'Inspect /admin/jobs run summary and error_message details.',
      'Check worker_heartbeats status and queue_paused flag.',
    ],
    safeActions: [
      'Pause worker queue to prevent repeated failing retries.',
      'Fix underlying dependency and run single manual health probe before resuming.',
    ],
    escalationRequirements: 'Notify Data Admin or Platform Admin.',
    recoveryValidation: 'Worker heartbeat returns HEALTHY and test job succeeds.',
    resolutionCriteria: 'Queue resumed and all scheduled maintenance jobs pass cleanly.',
  },
  {
    playbookKey: 'suspicious-security-activity',
    title: 'Suspicious Auth Burst or Credential Stuffing Pattern',
    category: 'SECURITY',
    severity: 'HIGH',
    triggerConditions: 'Failed login bursts >= configured threshold or repeated 403/428/CSRF rejections.',
    investigationSteps: [
      'Inspect /admin/security severity breakdown and recent auth_security_events.',
      'Verify targeted user accounts in /admin/users/:id without leaking tokens.',
    ],
    safeActions: [
      'Revoke targeted compromised sessions or suspend affected standard user account.',
      'Escalate incident and tighten rate-limit thresholds cleanly.',
    ],
    escalationRequirements: 'Notify Security Admin and Super Admin.',
    recoveryValidation: 'No ongoing failed login bursts from flagged IP/user cohort.',
    resolutionCriteria: 'Affected sessions revoked and security incident documented.',
  },
  {
    playbookKey: 'data-integrity-concern',
    title: 'Config Drift, Snapshot Integrity, or Isolation Concern',
    category: 'GOVERNANCE',
    severity: 'CRITICAL',
    triggerConditions: 'Backup SHA-256 mismatch, unexpected config mutation, or cross-user isolation alert.',
    investigationSteps: [
      'Review /admin/audit-logs and /admin/configuration audit history.',
      'Inspect /admin/backups verification events and checksum status.',
    ],
    safeActions: [
      'Enable maintenance mode to halt workspace mutations during triage.',
      'Create verified configuration snapshot and escalate incident to Super Admin.',
    ],
    escalationRequirements: 'Mandatory Super Admin & Security Admin dual review.',
    recoveryValidation: 'Configuration snapshot verified SHA-256 and isolation smoke tests pass.',
    resolutionCriteria: 'Root cause documented and incident transitioned to RESOLVED.',
  },
  {
    playbookKey: 'suspected-unauthorized-admin-access',
    title: 'Suspected Unauthorized Administrative Access',
    category: 'SECURITY',
    severity: 'CRITICAL',
    triggerConditions: 'Multiple ADMIN_REAUTH_FAILED events, unexpected role changes, or suspicious admin session.',
    investigationSteps: [
      'Inspect /admin/access-reviews privileged accounts and active session counts.',
      'Review admin_audit_logs and admin_role_assignments timeline.',
    ],
    safeActions: [
      'Revoke other admin sessions while protecting current verified Super Admin session.',
      'Revoke active emergency access grants and require fresh access reviews.',
    ],
    escalationRequirements: 'Immediate Super Admin executive intervention required.',
    recoveryValidation: 'All privileged sessions re-authenticated and role catalog verified.',
    resolutionCriteria: 'Access review completed for all active admins and post-incident review logged.',
  },
];

const SEEDED_WORKFLOWS: Array<{
  workflowKey: string;
  name: string;
  description: string;
  triggerType: AutomationTriggerType;
  actionType: AutomationActionType;
  scheduleIntervalMinutes: number | null;
  requiresApproval: boolean;
  actionConfig: Record<string, unknown>;
}> = [
  {
    workflowKey: 'health-monitor',
    name: 'Operational Health Threshold Monitor',
    description: 'Evaluates Phase 4 service/API health thresholds and generates operational alerts.',
    triggerType: 'SCHEDULED',
    actionType: 'CREATE_ALERT',
    scheduleIntervalMinutes: 15,
    requiresApproval: false,
    actionConfig: {
      evaluatePhase4Thresholds: true,
      category: 'SYSTEM',
      severity: 'MEDIUM',
      title: 'Operational Health Check Evaluated',
    },
  },
  {
    workflowKey: 'failed-job-monitor',
    name: 'Repeated Background Job Failure Monitor',
    description: 'Detects failed background jobs and records a consolidated operational incident event/alert.',
    triggerType: 'JOB_FAILURE',
    actionType: 'RECORD_OPERATIONAL_EVENT',
    scheduleIntervalMinutes: 30,
    requiresApproval: false,
    actionConfig: {
      scope: 'failed_jobs',
      severity: 'HIGH',
    },
  },
  {
    workflowKey: 'ai-provider-monitor',
    name: 'AI Provider Health & Fallback Monitor',
    description: 'Tracks AI request failure/fallback metrics and updates operational alert status.',
    triggerType: 'OPERATIONAL_EVENT',
    actionType: 'CREATE_ALERT',
    scheduleIntervalMinutes: 15,
    requiresApproval: false,
    actionConfig: {
      scope: 'ai_provider',
      category: 'AI',
      severity: 'HIGH',
      title: 'AI Provider Reliability Check',
    },
  },
  {
    workflowKey: 'market-data-monitor',
    name: 'Market Catalog Freshness Monitor',
    description: 'Detects stale market catalog verification and logs freshness reminders.',
    triggerType: 'SCHEDULED',
    actionType: 'GENERATE_GOVERNANCE_REMINDER',
    scheduleIntervalMinutes: 60,
    requiresApproval: false,
    actionConfig: {
      scope: 'market_data_freshness',
      title: 'Market Data Catalog Freshness Reminder',
    },
  },
  {
    workflowKey: 'security-event-monitor',
    name: 'Security Burst Escalation Monitor',
    description: 'Scans repeated failed authentication events and escalates suspicious patterns for human review.',
    triggerType: 'SECURITY_EVENT',
    actionType: 'CREATE_ALERT',
    scheduleIntervalMinutes: 15,
    requiresApproval: false,
    actionConfig: {
      scope: 'security_events',
      category: 'SECURITY',
      severity: 'HIGH',
      title: 'Security Pattern Escalation Review',
    },
  },
  {
    workflowKey: 'governance-reminder',
    name: 'Privacy, Backup & Access Review Reminder',
    description: 'Identifies overdue privacy requests, unverified backups, and pending privileged reviews.',
    triggerType: 'SCHEDULED',
    actionType: 'GENERATE_GOVERNANCE_REMINDER',
    scheduleIntervalMinutes: 1440,
    requiresApproval: false,
    actionConfig: {
      scope: 'governance_backlog',
      title: 'Governance Backlog Summary Reminder',
    },
  },
];

export function createSuperOpsService(options: CreateSuperOpsServiceOptions) {
  const {
    db,
    runtimeConfigManager,
    jobManager,
    observability,
    governance,
    writeAuditLog,
    assignUserRole,
    executeEmergencyOperation,
    revokeTargetUserSession,
  } = options;
  const isPg = db.dialect === 'postgres';
  const boolVal = (v: boolean) => (isPg ? v : v ? 1 : 0);
  const inFlightWorkflows = new Set<string>();
  let seedPromise: Promise<void> | null = null;

  async function ensureSeededInternal() {
    const nowIso = new Date().toISOString();

    for (const pb of SEEDED_PLAYBOOKS) {
      await db.execute(
        `INSERT INTO emergency_playbooks (id, playbook_key, title, category, severity, trigger_conditions, investigation_steps_json, safe_actions_json, escalation_requirements, recovery_validation, resolution_criteria, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(playbook_key) DO NOTHING`,
        `INSERT INTO emergency_playbooks (id, playbook_key, title, category, severity, trigger_conditions, investigation_steps_json, safe_actions_json, escalation_requirements, recovery_validation, resolution_criteria, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz)
         ON CONFLICT (playbook_key) DO NOTHING`,
        [
          crypto.randomUUID(),
          pb.playbookKey,
          pb.title,
          pb.category,
          pb.severity,
          pb.triggerConditions,
          JSON.stringify(pb.investigationSteps),
          JSON.stringify(pb.safeActions),
          pb.escalationRequirements,
          pb.recoveryValidation,
          pb.resolutionCriteria,
          nowIso,
        ],
      );
    }

    for (const wf of SEEDED_WORKFLOWS) {
      const nextRunAt = wf.scheduleIntervalMinutes
        ? new Date(Date.now() + wf.scheduleIntervalMinutes * 60_000).toISOString()
        : null;
      await db.execute(
        `INSERT INTO admin_automation_workflows (id, workflow_key, name, description, trigger_type, trigger_config_json, conditions_json, action_type, action_config_json, schedule_interval_minutes, requires_approval, enabled, is_paused, owner_id, owner_email, last_run_at, next_run_at, last_status, retry_limit, timeout_ms, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '{}', '{}', ?, ?, ?, ?, ?, ?, NULL, 'system', NULL, ?, 'IDLE', 1, 5000, ?, ?)
         ON CONFLICT(workflow_key) DO NOTHING`,
        `INSERT INTO admin_automation_workflows (id, workflow_key, name, description, trigger_type, trigger_config_json, conditions_json, action_type, action_config_json, schedule_interval_minutes, requires_approval, enabled, is_paused, owner_id, owner_email, last_run_at, next_run_at, last_status, retry_limit, timeout_ms, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, '{}', '{}', $6, $7, $8, $9, $10, $11, NULL, 'system', NULL, $12::timestamptz, 'IDLE', 1, 5000, $13::timestamptz, $14::timestamptz)
         ON CONFLICT (workflow_key) DO NOTHING`,
        [
          crypto.randomUUID(),
          wf.workflowKey,
          wf.name,
          wf.description,
          wf.triggerType,
          wf.actionType,
          JSON.stringify(wf.actionConfig),
          wf.scheduleIntervalMinutes,
          boolVal(wf.requiresApproval),
          boolVal(true),
          boolVal(false),
          nextRunAt,
          nowIso,
          nowIso,
        ],
      );
    }

    const existingPolicy = await db.queryOne<{ id: string }>(
      'SELECT id FROM ai_policy_versions LIMIT 1',
      'SELECT id FROM ai_policy_versions LIMIT 1',
    );
    if (!existingPolicy) {
      await db.execute(
        `INSERT INTO ai_policy_versions (id, version_number, name, status, allowed_models_json, default_model, fallback_model, fallback_enabled, provider_priority_json, rate_limit_per_min, max_input_chars, max_output_tokens, timeout_ms, safety_mode, redact_sensitive_inputs, block_prompt_injection, disabled_capabilities_json, notes, created_by, created_by_email, activated_at, created_at)
         VALUES (?, 1, ?, 'ACTIVE', ?, ?, 'none', ?, '["gemini"]', 25, 1000, 1400, 18000, 'STRICT', ?, ?, '[]', ?, NULL, 'system', ?, ?)
         ON CONFLICT(version_number) DO NOTHING`,
        `INSERT INTO ai_policy_versions (id, version_number, name, status, allowed_models_json, default_model, fallback_model, fallback_enabled, provider_priority_json, rate_limit_per_min, max_input_chars, max_output_tokens, timeout_ms, safety_mode, redact_sensitive_inputs, block_prompt_injection, disabled_capabilities_json, notes, created_by, created_by_email, activated_at, created_at)
         VALUES ($1, 1, $2, 'ACTIVE', $3, $4, 'none', $5, '["gemini"]', 25, 1000, 1400, 18000, 'STRICT', $6, $7, '[]', $8, NULL, 'system', $9::timestamptz, $10::timestamptz)
         ON CONFLICT (version_number) DO NOTHING`,
        [
          crypto.randomUUID(),
          'Baseline AI Governance Policy v1',
          JSON.stringify([...APPROVED_GEMINI_MODELS]),
          APPROVED_GEMINI_MODELS[0],
          boolVal(false),
          boolVal(true),
          boolVal(true),
          'Initial baseline safety, prompt-injection defense, and token guardrails.',
          nowIso,
          nowIso,
        ],
      );
      runtimeConfigManager.invalidateCache();
    }

    // Seed global automation kill-switch flag in Phase 5 feature_flags (disarmed by default)
    const existingKillFlag = await db.queryOne<{ id: string }>(
      "SELECT id FROM feature_flags WHERE flag_key = 'automation_global_kill_switch'",
      "SELECT id FROM feature_flags WHERE flag_key = 'automation_global_kill_switch'",
    );
    if (!existingKillFlag) {
      await db.execute(
        `INSERT INTO feature_flags (id, flag_key, name, description, enabled, environment_scope, rollout_percentage, target_roles_json, is_kill_switch, client_exposed, starts_at, ends_at, updated_by, created_at, updated_at)
         VALUES (?, 'automation_global_kill_switch', 'Automation Global Kill Switch', 'When enabled, halts all automated workflow executions platform-wide.', ?, 'all', 100, '[]', ?, ?, NULL, NULL, NULL, ?, ?)
         ON CONFLICT(flag_key) DO NOTHING`,
        `INSERT INTO feature_flags (id, flag_key, name, description, enabled, environment_scope, rollout_percentage, target_roles_json, is_kill_switch, client_exposed, starts_at, ends_at, updated_by, created_at, updated_at)
         VALUES ($1, 'automation_global_kill_switch', 'Automation Global Kill Switch', 'When enabled, halts all automated workflow executions platform-wide.', $2, 'all', 100, '[]', $3, $4, NULL, NULL, NULL, $5::timestamptz, $6::timestamptz)
         ON CONFLICT (flag_key) DO NOTHING`,
        [crypto.randomUUID(), boolVal(false), boolVal(true), boolVal(false), nowIso, nowIso],
      );
    }
  }

  async function ensureSeeded() {
    if (!seedPromise) {
      seedPromise = ensureSeededInternal().catch((err) => {
        seedPromise = null;
        throw err;
      });
    }
    await seedPromise;
  }

  function mapWorkflow(row: Record<string, unknown>): AutomationWorkflowDto {
    return {
      id: String(row.id),
      workflowKey: String(row.workflow_key),
      name: String(row.name),
      description: String(row.description ?? ''),
      triggerType: String(row.trigger_type) as AutomationTriggerType,
      triggerConfig: safeJsonParse<Record<string, unknown>>(row.trigger_config_json, {}),
      conditions: safeJsonParse<Record<string, unknown>>(row.conditions_json, {}),
      actionType: String(row.action_type) as AutomationActionType,
      actionConfig: safeJsonParse<Record<string, unknown>>(row.action_config_json, {}),
      scheduleIntervalMinutes:
        row.schedule_interval_minutes !== null && row.schedule_interval_minutes !== undefined
          ? Number(row.schedule_interval_minutes)
          : null,
      requiresApproval: toBoolField(row.requires_approval),
      enabled: toBoolField(row.enabled),
      isPaused: toBoolField(row.is_paused),
      ownerId: row.owner_id ? String(row.owner_id) : null,
      ownerEmail: String(row.owner_email ?? 'system'),
      lastRunAt: row.last_run_at ? toIso(row.last_run_at) : null,
      nextRunAt: row.next_run_at ? toIso(row.next_run_at) : null,
      lastStatus: row.last_status ? String(row.last_status) : null,
      retryLimit: Number(row.retry_limit ?? 1),
      timeoutMs: Number(row.timeout_ms ?? 5000),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  }

  function mapRun(row: Record<string, unknown>): AutomationRunDto {
    return {
      id: String(row.id),
      workflowId: String(row.workflow_id),
      workflowName: row.workflow_name ? String(row.workflow_name) : undefined,
      workflowKey: row.workflow_key ? String(row.workflow_key) : undefined,
      triggerSource: String(row.trigger_source ?? 'manual'),
      idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
      status: String(row.status) as AutomationRunStatus,
      retryCount: Number(row.retry_count ?? 0),
      durationMs: Number(row.duration_ms ?? 0),
      summary: String(row.summary ?? ''),
      errorMessage: row.error_message ? String(row.error_message) : null,
      triggeredBy: row.triggered_by ? String(row.triggered_by) : null,
      triggeredByEmail: String(row.triggered_by_email ?? 'system'),
      startedAt: toIso(row.started_at),
      finishedAt: row.finished_at ? toIso(row.finished_at) : null,
    };
  }

  function mapAiPolicy(row: Record<string, unknown>): AiPolicyVersionDto {
    return {
      id: String(row.id),
      versionNumber: Number(row.version_number ?? 1),
      name: String(row.name),
      status: String(row.status) as AiPolicyVersionDto['status'],
      allowedModels: safeJsonParse<string[]>(row.allowed_models_json, []),
      defaultModel: String(row.default_model),
      fallbackModel: String(row.fallback_model ?? 'none'),
      fallbackEnabled: toBoolField(row.fallback_enabled),
      providerPriority: safeJsonParse<string[]>(row.provider_priority_json, ['gemini']),
      rateLimitPerMin: Number(row.rate_limit_per_min ?? 25),
      maxInputChars: Number(row.max_input_chars ?? 1000),
      maxOutputTokens: Number(row.max_output_tokens ?? 1400),
      timeoutMs: Number(row.timeout_ms ?? 18000),
      safetyMode: row.safety_mode === 'STANDARD' ? 'STANDARD' : 'STRICT',
      redactSensitiveInputs: toBoolField(row.redact_sensitive_inputs),
      blockPromptInjection: toBoolField(row.block_prompt_injection),
      disabledCapabilities: safeJsonParse<string[]>(row.disabled_capabilities_json, []),
      notes: String(row.notes ?? ''),
      createdBy: row.created_by ? String(row.created_by) : null,
      createdByEmail: String(row.created_by_email ?? 'system'),
      activatedAt: row.activated_at ? toIso(row.activated_at) : null,
      createdAt: toIso(row.created_at),
    };
  }

  async function expireStaleAccessRecords() {
    const nowIso = new Date().toISOString();
    await db.execute(
      `UPDATE emergency_access_grants SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND expires_at < ?`,
      `UPDATE emergency_access_grants SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND expires_at < $1::timestamptz`,
      [nowIso],
    );
    await db.execute(
      `UPDATE privileged_action_requests SET status = 'EXPIRED' WHERE status IN ('PENDING', 'APPROVED') AND expires_at < ?`,
      `UPDATE privileged_action_requests SET status = 'EXPIRED' WHERE status IN ('PENDING', 'APPROVED') AND expires_at < $1::timestamptz`,
      [nowIso],
    );
  }

  async function isAutomationKillSwitchActive(): Promise<boolean> {
    const row = await db.queryOne<{ enabled: number | boolean }>(
      "SELECT enabled FROM feature_flags WHERE flag_key = 'automation_global_kill_switch' LIMIT 1",
      "SELECT enabled FROM feature_flags WHERE flag_key = 'automation_global_kill_switch' LIMIT 1",
    );
    return row ? toBoolField(row.enabled) : false;
  }

  // ---- STAGE B: UNIFIED SUPER ADMIN COMMAND CENTRE ----
  async function getSuperControlOverview() {
    await ensureSeeded();
    await expireStaleAccessRecords();

    const [
      obsOverview,
      maintStatus,
      privacyQueue,
      backupsOverview,
      jobsState,
      workflows,
      recentRuns,
      pendingApprovals,
      activeGrants,
      userCounts,
      openCriticalAlertsRow,
      openIncidentsRow,
      auditRows,
      secEventRows,
      flagHistoryRows,
      incidentRows,
      maintRows,
      privHistoryRows,
      backupEventRows,
      killSwitchActive,
    ] = await Promise.all([
      observability.getObservabilityOverview({ range: '24h' }),
      governance.getEffectiveMaintenanceStatus(null),
      governance.listAdminPrivacyQueue(),
      governance.listBackupsOverview(),
      jobManager.listJobs(),
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM admin_automation_workflows ORDER BY created_at ASC',
        'SELECT * FROM admin_automation_workflows ORDER BY created_at ASC',
      ),
      db.queryAll<Record<string, unknown>>(
        `SELECT r.*, w.name AS workflow_name, w.workflow_key
         FROM admin_automation_runs r
         LEFT JOIN admin_automation_workflows w ON w.id = r.workflow_id
         ORDER BY r.started_at DESC LIMIT 20`,
        `SELECT r.*, w.name AS workflow_name, w.workflow_key
         FROM admin_automation_runs r
         LEFT JOIN admin_automation_workflows w ON w.id = r.workflow_id
         ORDER BY r.started_at DESC LIMIT 20`,
      ),
      db.queryOne<{ cnt: number | string }>(
        "SELECT COUNT(*) AS cnt FROM privileged_action_requests WHERE status IN ('PENDING', 'APPROVED')",
        "SELECT COUNT(*) AS cnt FROM privileged_action_requests WHERE status IN ('PENDING', 'APPROVED')",
      ),
      db.queryOne<{ cnt: number | string }>(
        "SELECT COUNT(*) AS cnt FROM emergency_access_grants WHERE status = 'ACTIVE'",
        "SELECT COUNT(*) AS cnt FROM emergency_access_grants WHERE status = 'ACTIVE'",
      ),
      db.queryAll<{ account_status: string; cnt: number | string }>(
        'SELECT account_status, COUNT(*) AS cnt FROM users GROUP BY account_status',
        'SELECT account_status, COUNT(*) AS cnt FROM users GROUP BY account_status',
      ),
      db.queryOne<{ cnt: number | string }>(
        "SELECT COUNT(*) AS cnt FROM operational_alerts WHERE status IN ('OPEN', 'ACKNOWLEDGED') AND severity = 'CRITICAL'",
        "SELECT COUNT(*) AS cnt FROM operational_alerts WHERE status IN ('OPEN', 'ACKNOWLEDGED') AND severity = 'CRITICAL'",
      ),
      db.queryOne<{ cnt: number | string }>(
        "SELECT COUNT(*) AS cnt FROM admin_incidents WHERE status != 'RESOLVED'",
        "SELECT COUNT(*) AS cnt FROM admin_incidents WHERE status != 'RESOLVED'",
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 20',
        'SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 20',
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM auth_security_events ORDER BY created_at DESC LIMIT 15',
        'SELECT * FROM auth_security_events ORDER BY created_at DESC LIMIT 15',
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM feature_flag_history ORDER BY created_at DESC LIMIT 15',
        'SELECT * FROM feature_flag_history ORDER BY created_at DESC LIMIT 15',
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM admin_incidents ORDER BY updated_at DESC LIMIT 15',
        'SELECT * FROM admin_incidents ORDER BY updated_at DESC LIMIT 15',
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM maintenance_windows ORDER BY updated_at DESC LIMIT 10',
        'SELECT * FROM maintenance_windows ORDER BY updated_at DESC LIMIT 10',
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM privileged_action_history ORDER BY created_at DESC LIMIT 15',
        'SELECT * FROM privileged_action_history ORDER BY created_at DESC LIMIT 15',
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM backup_verification_events ORDER BY created_at DESC LIMIT 15',
        'SELECT * FROM backup_verification_events ORDER BY created_at DESC LIMIT 15',
      ),
      isAutomationKillSwitchActive(),
    ]);

    let totalUsers = 0;
    let activeUsers = 0;
    let suspendedUsers = 0;
    for (const r of userCounts) {
      const c = Number(r.cnt ?? 0);
      totalUsers += c;
      if (String(r.account_status) === 'active') activeUsers += c;
      if (String(r.account_status) === 'suspended') suspendedUsers += c;
    }

    const pendingExports = privacyQueue.exportRequests.filter((e) => e.status === 'PENDING' || e.status === 'APPROVED').length;
    const pendingDeletions = privacyQueue.deletionRequests.filter((d) => d.status === 'PENDING_REVIEW' || d.status === 'SCHEDULED').length;
    const verifiedBackups = backupsOverview.backups.filter((b) => b.status === 'VERIFIED').length;
    const failedRuns = recentRuns.filter((r) => String(r.status) === 'FAILED' || String(r.status) === 'TIMED_OUT').length;
    const openCriticalAlerts = Number(openCriticalAlertsRow?.cnt ?? 0);
    const activeIncidents = Number(openIncidentsRow?.cnt ?? 0);

    const timeline: UnifiedTimelineItemDto[] = [];

    for (const r of auditRows) {
      const action = String(r.action ?? '');
      const category: UnifiedTimelineItemDto['category'] = action.includes('CONFIG')
        ? 'CONFIG_CHANGE'
        : 'ADMIN_ACTION';
      timeline.push({
        id: `audit-${String(r.id)}`,
        category,
        actor: String(r.admin_email ?? 'system'),
        timestamp: toIso(r.created_at),
        severity: String(r.result) === 'DENIED' ? 'HIGH' : 'INFO',
        relatedResource: `${String(r.resource_type ?? 'resource')}${r.resource_id ? `:${String(r.resource_id).slice(0, 36)}` : ''}`,
        eventSource: 'admin_audit_logs',
        summary: `${action} (${String(r.result ?? 'SUCCESS')})`,
      });
    }

    for (const r of secEventRows) {
      const evt = String(r.event_type ?? '');
      timeline.push({
        id: `sec-${String(r.id)}`,
        category: 'SECURITY_EVENT',
        actor: r.user_id ? `user:${String(r.user_id).slice(0, 8)}` : 'anonymous',
        timestamp: toIso(r.created_at),
        severity: evt.includes('FAIL') || evt.includes('LOCK') ? 'MEDIUM' : 'INFO',
        relatedResource: `ip:${String(r.ip_address ?? 'unknown')}`,
        eventSource: 'auth_security_events',
        summary: `${evt} — ${stripControlChars(String(r.detail ?? ''), 120)}`,
      });
    }

    for (const r of flagHistoryRows) {
      timeline.push({
        id: `flag-${String(r.id)}`,
        category: 'FEATURE_FLAG',
        actor: String(r.actor_email ?? 'system'),
        timestamp: toIso(r.created_at),
        severity: 'INFO',
        relatedResource: `flag:${String(r.flag_key)}`,
        eventSource: 'feature_flag_history',
        summary: `Flag "${String(r.flag_key)}" updated${r.reason ? ` — ${stripControlChars(String(r.reason), 90)}` : ''}`,
      });
    }

    for (const r of incidentRows) {
      timeline.push({
        id: `inc-${String(r.id)}`,
        category: 'INCIDENT',
        actor: String(r.owner_email || 'unassigned'),
        timestamp: toIso(r.updated_at || r.created_at),
        severity: String(r.severity ?? 'HIGH') as UnifiedTimelineItemDto['severity'],
        relatedResource: `incident:${String(r.id).slice(0, 8)}`,
        eventSource: 'admin_incidents',
        summary: `[${String(r.status)}] ${String(r.title)}`,
      });
    }

    for (const r of maintRows) {
      timeline.push({
        id: `maint-${String(r.id)}`,
        category: 'MAINTENANCE',
        actor: String(r.created_by_email ?? 'system'),
        timestamp: toIso(r.updated_at || r.created_at),
        severity: String(r.status) === 'ACTIVE' ? 'HIGH' : 'INFO',
        relatedResource: `maintenance:${String(r.id).slice(0, 8)}`,
        eventSource: 'maintenance_windows',
        summary: `[${String(r.status)}] ${String(r.title)}`,
      });
    }

    for (const r of recentRuns) {
      timeline.push({
        id: `auto-${String(r.id)}`,
        category: 'AUTOMATION',
        actor: String(r.triggered_by_email ?? 'system'),
        timestamp: toIso(r.started_at),
        severity: String(r.status) === 'FAILED' ? 'HIGH' : 'INFO',
        relatedResource: `workflow:${String(r.workflow_key ?? r.workflow_id)}`,
        eventSource: 'admin_automation_runs',
        summary: `[${String(r.status)}] ${String(r.workflow_name ?? 'Workflow')} — ${stripControlChars(String(r.summary ?? ''), 100)}`,
      });
    }

    for (const r of privHistoryRows) {
      timeline.push({
        id: `priv-${String(r.id)}`,
        category: 'ACCESS_APPROVAL',
        actor: String(r.actor_email ?? 'system'),
        timestamp: toIso(r.created_at),
        severity: String(r.event_type) === 'REJECTED' ? 'MEDIUM' : 'INFO',
        relatedResource: `request:${String(r.request_id).slice(0, 8)}`,
        eventSource: 'privileged_action_history',
        summary: `[${String(r.event_type)}] ${stripControlChars(String(r.detail ?? ''), 100)}`,
      });
    }

    for (const r of backupEventRows) {
      timeline.push({
        id: `bk-${String(r.id)}`,
        category: 'BACKUP',
        actor: String(r.actor_email ?? 'system'),
        timestamp: toIso(r.created_at),
        severity: String(r.status) === 'FAILED' ? 'HIGH' : 'INFO',
        relatedResource: `backup:${String(r.backup_id).slice(0, 8)}`,
        eventSource: 'backup_verification_events',
        summary: `${String(r.action)} (${String(r.status)}) — ${stripControlChars(String(r.detail ?? ''), 90)}`,
      });
    }

    timeline.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

    const services = obsOverview.serviceHealth ?? [];
    const findSvc = (id: string) => services.find((s) => s.id === id);

    return {
      operationalStatus: maintStatus.active
        ? 'MAINTENANCE'
        : openCriticalAlerts > 0 || activeIncidents > 0
          ? 'DEGRADED'
          : 'OPERATIONAL',
      metrics: {
        totalUsers,
        activeUsers,
        suspendedUsers,
        openCriticalAlerts,
        activeIncidents,
        maintenanceActive: maintStatus.active,
        pendingPrivacyRequests: pendingExports + pendingDeletions,
        pendingApprovals: Number(pendingApprovals?.cnt ?? 0),
        activeEmergencyGrants: Number(activeGrants?.cnt ?? 0),
        verifiedBackups,
        totalBackups: backupsOverview.backups.length,
        workflowsCount: workflows.length,
        enabledWorkflowsCount: workflows.filter((w) => toBoolField(w.enabled) && !toBoolField(w.is_paused)).length,
        failedAutomationRuns: failedRuns,
        automationKillSwitchActive: killSwitchActive,
      },
      serviceStatus: {
        apiHealth: obsOverview.apiMetrics.errorRatePct >= 15 ? 'DEGRADED' : 'HEALTHY',
        aiProviderHealth: findSvc('ai-gemini')?.status ?? 'NOT_CONFIGURED',
        marketDataHealth: obsOverview.marketMetrics.classification ?? 'SIMULATED',
        workerHealth: jobsState.workerHeartbeat.status,
        databaseHealth: findSvc('database-primary')?.status ?? 'HEALTHY',
        fullDatabaseBackupStatus: backupsOverview.capabilities.fullDatabaseBackupSupported
          ? 'AVAILABLE'
          : 'NOT_CONFIGURED',
      },
      unavailableSources: [
        ...(!backupsOverview.capabilities.fullDatabaseBackupSupported
          ? [{ key: 'physical_postgres_backup', status: 'NOT_CONFIGURED', detail: backupsOverview.capabilities.fullDatabaseReason }]
          : []),
        { key: 'mfa_enforcement', status: 'NOT_CONFIGURED', detail: 'TOTP/WebAuthn MFA is not configured in Phase 1–6 auth.' },
        { key: 'ci_cd_webhook', status: 'NOT_CONFIGURED', detail: 'External CI/CD webhook secret not configured.' },
        {
          key: 'live_market_feed',
          status: obsOverview.marketMetrics.classification === 'UNAVAILABLE' ? 'DEGRADED' : 'ACTIVE',
          detail: `Public delayed/cached market adapters active (${obsOverview.marketMetrics.classification}).`,
        },
      ],
      timeline: timeline.slice(0, 40),
    };
  }

  // ---- STAGE C: GOVERNED AUTOMATION ENGINE ----
  async function listAutomationOverview() {
    await ensureSeeded();
    const [wfRows, runRows, evtRows, killSwitchActive] = await Promise.all([
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM admin_automation_workflows ORDER BY created_at ASC',
        'SELECT * FROM admin_automation_workflows ORDER BY created_at ASC',
      ),
      db.queryAll<Record<string, unknown>>(
        `SELECT r.*, w.name AS workflow_name, w.workflow_key
         FROM admin_automation_runs r
         LEFT JOIN admin_automation_workflows w ON w.id = r.workflow_id
         ORDER BY r.started_at DESC LIMIT 60`,
        `SELECT r.*, w.name AS workflow_name, w.workflow_key
         FROM admin_automation_runs r
         LEFT JOIN admin_automation_workflows w ON w.id = r.workflow_id
         ORDER BY r.started_at DESC LIMIT 60`,
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM admin_automation_events ORDER BY created_at DESC LIMIT 60',
        'SELECT * FROM admin_automation_events ORDER BY created_at DESC LIMIT 60',
      ),
      isAutomationKillSwitchActive(),
    ]);

    const runs = runRows.map(mapRun);
    const total = runs.length;
    const succeeded = runs.filter((r) => r.status === 'SUCCEEDED').length;
    const failed = runs.filter((r) => r.status === 'FAILED' || r.status === 'TIMED_OUT').length;
    const blockedOrSkipped = runs.filter((r) => r.status === 'SKIPPED' || r.status === 'BLOCKED').length;
    const avgDurationMs =
      total > 0 ? Math.round(runs.reduce((s, r) => s + r.durationMs, 0) / total) : 0;
    const totalRetries = runs.reduce((s, r) => s + r.retryCount, 0);

    return {
      killSwitchActive,
      workflows: wfRows.map(mapWorkflow),
      runs,
      events: evtRows.map((r): AutomationEventDto => ({
        id: String(r.id),
        workflowId: String(r.workflow_id),
        runId: r.run_id ? String(r.run_id) : null,
        eventType: String(r.event_type),
        actorId: r.actor_id ? String(r.actor_id) : null,
        actorEmail: String(r.actor_email ?? 'system'),
        detail: String(r.detail ?? ''),
        metadata: safeJsonParse<Record<string, unknown>>(r.metadata_json, {}),
        createdAt: toIso(r.created_at),
      })),
      monitoring: {
        successfulExecutions: succeeded,
        failedExecutions: failed,
        skippedOrBlockedExecutions: blockedOrSkipped,
        queuedExecutions: runs.filter((r) => r.status === 'RUNNING' || r.status === 'PENDING_APPROVAL').length,
        avgDurationMs,
        totalRetries,
      },
    };
  }

  async function createWorkflow(
    actor: AdminActor,
    input: Record<string, unknown>,
  ): Promise<AdminOutcome<{ workflow: AutomationWorkflowDto }>> {
    await ensureSeeded();
    const check = validateAutomationWorkflowInput({
      workflowKey: input.workflowKey,
      name: input.name,
      description: input.description,
      triggerType: input.triggerType,
      actionType: input.actionType,
      scheduleIntervalMinutes: input.scheduleIntervalMinutes,
      requiresApproval: input.requiresApproval,
      retryLimit: input.retryLimit,
      timeoutMs: input.timeoutMs,
    });
    if (!check.valid || !check.normalized) {
      return { ok: false, status: 400, error: check.error || 'Invalid automation workflow input.' };
    }

    const n = check.normalized;
    const existing = await db.queryOne<{ id: string }>(
      'SELECT id FROM admin_automation_workflows WHERE workflow_key = ?',
      'SELECT id FROM admin_automation_workflows WHERE workflow_key = $1',
      [n.workflowKey],
    );
    if (existing) {
      return { ok: false, status: 409, error: `Workflow key "${n.workflowKey}" already exists.` };
    }

    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const nextRunAt = n.scheduleIntervalMinutes
      ? new Date(Date.now() + n.scheduleIntervalMinutes * 60_000).toISOString()
      : null;

    const actionConfig =
      input.actionConfig && typeof input.actionConfig === 'object' ? input.actionConfig : {};
    const conditions =
      input.conditions && typeof input.conditions === 'object' ? input.conditions : {};

    await db.execute(
      `INSERT INTO admin_automation_workflows (id, workflow_key, name, description, trigger_type, trigger_config_json, conditions_json, action_type, action_config_json, schedule_interval_minutes, requires_approval, enabled, is_paused, owner_id, owner_email, last_run_at, next_run_at, last_status, retry_limit, timeout_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'IDLE', ?, ?, ?, ?)`,
      `INSERT INTO admin_automation_workflows (id, workflow_key, name, description, trigger_type, trigger_config_json, conditions_json, action_type, action_config_json, schedule_interval_minutes, requires_approval, enabled, is_paused, owner_id, owner_email, last_run_at, next_run_at, last_status, retry_limit, timeout_ms, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, '{}', $6, $7, $8, $9, $10, $11, $12, $13, $14, NULL, $15::timestamptz, 'IDLE', $16, $17, $18::timestamptz, $19::timestamptz)`,
      [
        id,
        n.workflowKey,
        n.name,
        n.description,
        n.triggerType,
        JSON.stringify(conditions),
        n.actionType,
        JSON.stringify(actionConfig),
        n.scheduleIntervalMinutes,
        boolVal(n.requiresApproval),
        boolVal(input.enabled !== false),
        boolVal(false),
        actor.userId,
        actor.email,
        nextRunAt,
        n.retryLimit,
        n.timeoutMs,
        nowIso,
        nowIso,
      ],
    );

    await db.execute(
      `INSERT INTO admin_automation_events (id, workflow_id, run_id, event_type, actor_id, actor_email, detail, metadata_json, created_at)
       VALUES (?, ?, NULL, 'WORKFLOW_CREATED', ?, ?, ?, ?, ?)`,
      `INSERT INTO admin_automation_events (id, workflow_id, run_id, event_type, actor_id, actor_email, detail, metadata_json, created_at)
       VALUES ($1, $2, NULL, 'WORKFLOW_CREATED', $3, $4, $5, $6, $7::timestamptz)`,
      [
        crypto.randomUUID(),
        id,
        actor.userId,
        actor.email,
        `Created governed workflow "${n.name}" (${n.actionType})`,
        JSON.stringify({ triggerType: n.triggerType, actionType: n.actionType }),
        nowIso,
      ],
    );

    await writeAuditLog({
      actor,
      action: 'AUTOMATION_WORKFLOW_CREATE',
      resourceType: 'automation_workflow',
      resourceId: id,
      newValue: { workflowKey: n.workflowKey, actionType: n.actionType, requiresApproval: n.requiresApproval },
    });

    const created = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM admin_automation_workflows WHERE id = ?',
      'SELECT * FROM admin_automation_workflows WHERE id = $1',
      [id],
    );
    return { ok: true, status: 201, data: { workflow: mapWorkflow(created!) } };
  }

  async function updateWorkflowState(
    actor: AdminActor,
    workflowId: string,
    patch: { enabled?: boolean; isPaused?: boolean },
  ): Promise<AdminOutcome<{ workflow: AutomationWorkflowDto }>> {
    await ensureSeeded();
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM admin_automation_workflows WHERE id = ?',
      'SELECT * FROM admin_automation_workflows WHERE id = $1',
      [workflowId],
    );
    if (!row) return { ok: false, status: 404, error: 'Automation workflow not found.' };

    const nextEnabled =
      typeof patch.enabled === 'boolean' ? patch.enabled : toBoolField(row.enabled);
    const nextPaused =
      typeof patch.isPaused === 'boolean' ? patch.isPaused : toBoolField(row.is_paused);
    const nowIso = new Date().toISOString();

    await db.execute(
      'UPDATE admin_automation_workflows SET enabled = ?, is_paused = ?, updated_at = ? WHERE id = ?',
      'UPDATE admin_automation_workflows SET enabled = $1, is_paused = $2, updated_at = $3::timestamptz WHERE id = $4',
      [boolVal(nextEnabled), boolVal(nextPaused), nowIso, workflowId],
    );

    await db.execute(
      `INSERT INTO admin_automation_events (id, workflow_id, run_id, event_type, actor_id, actor_email, detail, metadata_json, created_at)
       VALUES (?, ?, NULL, 'WORKFLOW_STATE_UPDATED', ?, ?, ?, ?, ?)`,
      `INSERT INTO admin_automation_events (id, workflow_id, run_id, event_type, actor_id, actor_email, detail, metadata_json, created_at)
       VALUES ($1, $2, NULL, 'WORKFLOW_STATE_UPDATED', $3, $4, $5, $6, $7::timestamptz)`,
      [
        crypto.randomUUID(),
        workflowId,
        actor.userId,
        actor.email,
        `Updated state: enabled=${nextEnabled}, paused=${nextPaused}`,
        JSON.stringify({ enabled: nextEnabled, isPaused: nextPaused }),
        nowIso,
      ],
    );

    await writeAuditLog({
      actor,
      action: 'AUTOMATION_WORKFLOW_STATE_UPDATE',
      resourceType: 'automation_workflow',
      resourceId: workflowId,
      previousValue: { enabled: toBoolField(row.enabled), isPaused: toBoolField(row.is_paused) },
      newValue: { enabled: nextEnabled, isPaused: nextPaused },
    });

    const updated = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM admin_automation_workflows WHERE id = ?',
      'SELECT * FROM admin_automation_workflows WHERE id = $1',
      [workflowId],
    );
    return { ok: true, status: 200, data: { workflow: mapWorkflow(updated!) } };
  }

  async function setAutomationKillSwitch(
    actor: AdminActor,
    active: boolean,
    reason: string,
  ): Promise<AdminOutcome<{ killSwitchActive: boolean }>> {
    await ensureSeeded();
    const cleanReason = stripControlChars(reason, 280) || 'Automation kill switch toggled by administrator';
    const nowIso = new Date().toISOString();

    await db.execute(
      `UPDATE feature_flags SET enabled = ?, updated_by = ?, updated_at = ? WHERE flag_key = 'automation_global_kill_switch'`,
      `UPDATE feature_flags SET enabled = $1, updated_by = $2, updated_at = $3::timestamptz WHERE flag_key = 'automation_global_kill_switch'`,
      [boolVal(active), actor.userId, nowIso],
    );

    await db.execute(
      `INSERT INTO emergency_events (id, event_type, severity, title, summary, playbook_key, related_incident_id, action_taken, actor_id, actor_email, rollback_hint, created_at)
       VALUES (?, 'AUTOMATION_KILL_SWITCH', ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
      `INSERT INTO emergency_events (id, event_type, severity, title, summary, playbook_key, related_incident_id, action_taken, actor_id, actor_email, rollback_hint, created_at)
       VALUES ($1, 'AUTOMATION_KILL_SWITCH', $2, $3, $4, NULL, NULL, $5, $6, $7, $8, $9::timestamptz)`,
      [
        crypto.randomUUID(),
        active ? 'HIGH' : 'LOW',
        active ? 'Automation Global Kill Switch Activated' : 'Automation Global Kill Switch Disarmed',
        cleanReason,
        active ? 'KILL_SWITCH_ON' : 'KILL_SWITCH_OFF',
        actor.userId,
        actor.email,
        active ? 'Disarm automation_global_kill_switch when safe to resume.' : 'Re-engage kill switch from /admin/automation if needed.',
        nowIso,
      ],
    );

    await writeAuditLog({
      actor,
      action: active ? 'AUTOMATION_KILL_SWITCH_ON' : 'AUTOMATION_KILL_SWITCH_OFF',
      resourceType: 'automation_engine',
      resourceId: 'automation_global_kill_switch',
      newValue: { active, reason: cleanReason },
    });

    return { ok: true, status: 200, data: { killSwitchActive: active } };
  }

  async function executePredefinedWorkflowAction(
    actor: AdminActor,
    wf: AutomationWorkflowDto,
  ): Promise<string> {
    const nowIso = new Date().toISOString();
    const obsActor = {
      userId: actor.userId,
      email: actor.email,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    };

    switch (wf.actionType) {
      case 'CREATE_ALERT': {
        const evalRes = await observability.evaluateAlerts(obsActor);
        if (wf.workflowKey === 'health-monitor') {
          return `Evaluated platform health thresholds (${evalRes.candidatesDetected} candidate(s); ${evalRes.createdCount} created, ${evalRes.updatedCount} updated).`;
        }
        const category = String(wf.actionConfig.category || 'SYSTEM').toUpperCase();
        const safeCat = (['API', 'AI', 'SECURITY', 'MARKET_DATA', 'BACKGROUND_JOB', 'SYSTEM'].includes(category)
          ? category
          : 'SYSTEM') as 'API' | 'AI' | 'SECURITY' | 'MARKET_DATA' | 'BACKGROUND_JOB' | 'SYSTEM';
        const severity = String(wf.actionConfig.severity || 'MEDIUM').toUpperCase();
        const safeSev = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(severity)
          ? severity
          : 'MEDIUM') as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
        const title = stripControlChars(String(wf.actionConfig.title || wf.name), 160);
        const fingerprint = `wf:${wf.workflowKey}:${nowIso.slice(0, 13)}`;
        await db.execute(
          `INSERT INTO operational_alerts (id, fingerprint, category, title, description, severity, status, source, service_id, metric_value, threshold_value, occurrence_count, event_refs_json, internal_notes, first_detected_at, last_detected_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'OPEN', 'automation_engine', ?, NULL, NULL, 1, '[]', ?, ?, ?, ?)
           ON CONFLICT(fingerprint) DO UPDATE SET occurrence_count = operational_alerts.occurrence_count + 1, last_detected_at = excluded.last_detected_at, updated_at = excluded.updated_at`,
          `INSERT INTO operational_alerts (id, fingerprint, category, title, description, severity, status, source, service_id, metric_value, threshold_value, occurrence_count, event_refs_json, internal_notes, first_detected_at, last_detected_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', 'automation_engine', $7, NULL, NULL, 1, '[]', $8, $9::timestamptz, $10::timestamptz, $11::timestamptz)
           ON CONFLICT (fingerprint) DO UPDATE SET occurrence_count = operational_alerts.occurrence_count + 1, last_detected_at = EXCLUDED.last_detected_at, updated_at = EXCLUDED.updated_at`,
          [
            crypto.randomUUID(),
            fingerprint,
            safeCat,
            title,
            wf.description || `Triggered by governed workflow ${wf.workflowKey}.`,
            safeSev,
            wf.workflowKey,
            `Generated automatically by workflow ${wf.workflowKey}`,
            nowIso,
            nowIso,
            nowIso,
          ],
        );
        return `Created or incremented operational alert "${title}" (${safeCat}/${safeSev}).`;
      }
      case 'ACKNOWLEDGE_ELIGIBLE_ALERT': {
        const openRow = await db.queryOne<{ id: string; title: string }>(
          "SELECT id, title FROM operational_alerts WHERE status = 'OPEN' AND severity IN ('LOW', 'MEDIUM') ORDER BY last_detected_at ASC LIMIT 1",
          "SELECT id, title FROM operational_alerts WHERE status = 'OPEN' AND severity IN ('LOW', 'MEDIUM') ORDER BY last_detected_at ASC LIMIT 1",
        );
        if (!openRow) return 'No eligible OPEN LOW/MEDIUM alerts to acknowledge.';
        await observability.updateAlertStatus(obsActor, openRow.id, {
          action: 'ACKNOWLEDGE',
          note: `Auto-acknowledged by workflow ${wf.workflowKey}`,
        });
        return `Acknowledged eligible alert "${openRow.title}".`;
      }
      case 'CREATE_INCIDENT': {
        const res = await observability.createIncident(obsActor, {
          title: stripControlChars(String(wf.actionConfig.title || `Automated Incident: ${wf.name}`), 140),
          description: wf.description || `Created via governed workflow ${wf.workflowKey}.`,
          severity: String(wf.actionConfig.severity || 'HIGH'),
          source: `automation:${wf.workflowKey}`,
        });
        return res.ok
          ? `Created operational incident "${res.data.incident.title}".`
          : `Incident creation returned status ${res.status}.`;
      }
      case 'ADD_INCIDENT_EVENT': {
        const openInc = await db.queryOne<{ id: string; status: string; title: string }>(
          "SELECT id, status, title FROM admin_incidents WHERE status != 'RESOLVED' ORDER BY updated_at DESC LIMIT 1",
          "SELECT id, status, title FROM admin_incidents WHERE status != 'RESOLVED' ORDER BY updated_at DESC LIMIT 1",
        );
        if (!openInc) return 'No open incidents found to append operational note.';
        await observability.updateIncident(obsActor, openInc.id, {
          status: openInc.status,
          note: `Automated workflow ${wf.workflowKey} checked telemetry at ${nowIso}.`,
        });
        return `Added telemetry check event to incident "${openInc.title}".`;
      }
      case 'PAUSE_WORKER_QUEUE': {
        const state = await jobManager.setQueuePaused(true);
        return `Worker queue paused (${state.workerHeartbeat.status}).`;
      }
      case 'RESUME_WORKER_QUEUE': {
        const state = await jobManager.setQueuePaused(false);
        return `Worker queue resumed (${state.workerHeartbeat.status}).`;
      }
      case 'DISABLE_FEATURE_FLAG': {
        const flagKey = stripControlChars(String(wf.actionConfig.flagKey || ''), 80).toLowerCase();
        if (!flagKey) return 'Skipped DISABLE_FEATURE_FLAG: no target flagKey configured.';
        const flagRow = await db.queryOne<{ id: string; enabled: number | boolean }>(
          'SELECT id, enabled FROM feature_flags WHERE flag_key = ?',
          'SELECT id, enabled FROM feature_flags WHERE flag_key = $1',
          [flagKey],
        );
        if (!flagRow) return `Feature flag "${flagKey}" not found.`;
        await governance.updateFeatureFlag(actor, flagRow.id, {
          enabled: false,
          reason: `Disabled by governed automation workflow ${wf.workflowKey}`,
        });
        return `Disabled designated feature flag "${flagKey}".`;
      }
      case 'GENERATE_GOVERNANCE_REMINDER': {
        const [queue, backups, pendingReviews] = await Promise.all([
          governance.listAdminPrivacyQueue(),
          governance.listBackupsOverview(),
          db.queryOne<{ cnt: number | string }>(
            "SELECT COUNT(*) AS cnt FROM privileged_access_reviews WHERE review_status = 'PENDING'",
            "SELECT COUNT(*) AS cnt FROM privileged_access_reviews WHERE review_status = 'PENDING'",
          ),
        ]);
        const pendingPrivacy =
          queue.exportRequests.filter((e) => e.status === 'PENDING' || e.status === 'APPROVED').length +
          queue.deletionRequests.filter((d) => d.status === 'PENDING_REVIEW' || d.status === 'SCHEDULED').length;
        const unverifiedBackups = backups.backups.filter((b) => b.status === 'CREATED').length;
        return `Governance reminder scan complete: ${pendingPrivacy} pending privacy request(s), ${unverifiedBackups} unverified backup(s), ${Number(pendingReviews?.cnt ?? 0)} pending access review(s).`;
      }
      case 'RECORD_OPERATIONAL_EVENT':
      default: {
        const jobsState = await jobManager.listJobs();
        const failedJobs = jobsState.jobs.filter((j) => j.status === 'FAILED');
        await db.execute(
          `INSERT INTO emergency_events (id, event_type, severity, title, summary, playbook_key, related_incident_id, action_taken, actor_id, actor_email, rollback_hint, created_at)
           VALUES (?, 'AUTOMATION_OPERATIONAL_EVENT', ?, ?, ?, NULL, NULL, ?, ?, ?, 'Informational event logged; no state rollback required.', ?)`,
          `INSERT INTO emergency_events (id, event_type, severity, title, summary, playbook_key, related_incident_id, action_taken, actor_id, actor_email, rollback_hint, created_at)
           VALUES ($1, 'AUTOMATION_OPERATIONAL_EVENT', $2, $3, $4, NULL, NULL, $5, $6, $7, 'Informational event logged; no state rollback required.', $8::timestamptz)`,
          [
            crypto.randomUUID(),
            failedJobs.length > 0 ? 'HIGH' : 'LOW',
            `Automation Check: ${wf.name}`,
            `Inspected ${jobsState.jobs.length} registered job(s); ${failedJobs.length} failed.`,
            `WORKFLOW_${wf.workflowKey}`,
            actor.userId,
            actor.email,
            nowIso,
          ],
        );
        return `Recorded operational event (${failedJobs.length} failed background job(s) observed).`;
      }
    }
  }

  async function executeWorkflow(
    actor: AdminActor,
    workflowId: string,
    opts?: { idempotencyKey?: unknown; triggerSource?: string; bypassApproval?: boolean },
  ): Promise<AdminOutcome<{ run: AutomationRunDto; approvalRequestId?: string }>> {
    await ensureSeeded();
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM admin_automation_workflows WHERE id = ?',
      'SELECT * FROM admin_automation_workflows WHERE id = $1',
      [workflowId],
    );
    if (!row) return { ok: false, status: 404, error: 'Automation workflow not found.' };

    const wf = mapWorkflow(row);
    const idempotencyKey = normalizeIdempotencyKey(opts?.idempotencyKey);
    const killSwitchActive = await isAutomationKillSwitchActive();

    let duplicateExists = false;
    if (idempotencyKey) {
      const dup = await db.queryOne<{ id: string }>(
        'SELECT id FROM admin_automation_runs WHERE workflow_id = ? AND idempotency_key = ? LIMIT 1',
        'SELECT id FROM admin_automation_runs WHERE workflow_id = $1 AND idempotency_key = $2 LIMIT 1',
        [workflowId, idempotencyKey],
      );
      duplicateExists = Boolean(dup);
    }

    const skipCheck = shouldSkipAutomationRun({
      globalKillSwitchEnabled: killSwitchActive,
      workflowEnabled: wf.enabled,
      workflowPaused: wf.isPaused,
      duplicateIdempotencyExists: duplicateExists,
      activeRunInProgress: inFlightWorkflows.has(workflowId),
    });

    if (skipCheck.skip) {
      const runId = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      // Do not collide unique idempotency constraint if duplicateExists
      const safeKey = duplicateExists ? null : idempotencyKey;
      await db.execute(
        `INSERT INTO admin_automation_runs (id, workflow_id, trigger_source, idempotency_key, status, retry_count, duration_ms, summary, error_message, triggered_by, triggered_by_email, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?, NULL, ?, ?, ?, ?)`,
        `INSERT INTO admin_automation_runs (id, workflow_id, trigger_source, idempotency_key, status, retry_count, duration_ms, summary, error_message, triggered_by, triggered_by_email, started_at, finished_at)
         VALUES ($1, $2, $3, $4, $5, 0, 0, $6, NULL, $7, $8, $9::timestamptz, $10::timestamptz)`,
        [
          runId,
          workflowId,
          opts?.triggerSource || 'manual',
          safeKey,
          skipCheck.status,
          skipCheck.reason || 'Skipped',
          actor.userId,
          actor.email,
          nowIso,
          nowIso,
        ],
      );
      const runRow = await db.queryOne<Record<string, unknown>>(
        'SELECT * FROM admin_automation_runs WHERE id = ?',
        'SELECT * FROM admin_automation_runs WHERE id = $1',
        [runId],
      );
      return {
        ok: false,
        status: 409,
        code: duplicateExists ? 'DUPLICATE_IDEMPOTENCY_KEY' : 'AUTOMATION_SKIPPED',
        error: skipCheck.reason || 'Automation run skipped.',
        ...(runRow ? {} : {}),
      };
    }

    // Human-approval gate for workflows marked requiresApproval
    if (wf.requiresApproval && !opts?.bypassApproval) {
      const runId = crypto.randomUUID();
      const reqId = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const expiresIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await db.withTransaction(async (tx) => {
        await tx.execute(
          `INSERT INTO privileged_action_requests (id, action_type, target_resource_type, target_resource_id, payload_json, reason, status, requested_by, requested_by_email, expires_at, created_at)
           VALUES (?, 'AUTOMATION_HIGH_IMPACT', 'automation_workflow', ?, ?, ?, 'PENDING', ?, ?, ?, ?)`,
          `INSERT INTO privileged_action_requests (id, action_type, target_resource_type, target_resource_id, payload_json, reason, status, requested_by, requested_by_email, expires_at, created_at)
           VALUES ($1, 'AUTOMATION_HIGH_IMPACT', 'automation_workflow', $2, $3, $4, 'PENDING', $5, $6, $7::timestamptz, $8::timestamptz)`,
          [
            reqId,
            workflowId,
            JSON.stringify({ workflowKey: wf.workflowKey, actionType: wf.actionType }),
            `Human approval required before executing ${wf.actionType} (${wf.name}).`,
            actor.userId,
            actor.email,
            expiresIso,
            nowIso,
          ],
        );
        await tx.execute(
          `INSERT INTO privileged_action_history (id, request_id, event_type, actor_id, actor_email, detail, created_at)
           VALUES (?, ?, 'CREATED', ?, ?, ?, ?)`,
          `INSERT INTO privileged_action_history (id, request_id, event_type, actor_id, actor_email, detail, created_at)
           VALUES ($1, $2, 'CREATED', $3, $4, $5, $6::timestamptz)`,
          [
            crypto.randomUUID(),
            reqId,
            actor.userId,
            actor.email,
            `High-impact automation workflow "${wf.name}" queued for peer approval.`,
            nowIso,
          ],
        );
        await tx.execute(
          `INSERT INTO admin_automation_runs (id, workflow_id, trigger_source, idempotency_key, status, retry_count, duration_ms, summary, error_message, triggered_by, triggered_by_email, started_at, finished_at)
           VALUES (?, ?, ?, ?, 'PENDING_APPROVAL', 0, 0, ?, NULL, ?, ?, ?, ?)`,
          `INSERT INTO admin_automation_runs (id, workflow_id, trigger_source, idempotency_key, status, retry_count, duration_ms, summary, error_message, triggered_by, triggered_by_email, started_at, finished_at)
           VALUES ($1, $2, $3, $4, 'PENDING_APPROVAL', 0, 0, $5, NULL, $6, $7, $8::timestamptz, $9::timestamptz)`,
          [
            runId,
            workflowId,
            opts?.triggerSource || 'manual',
            idempotencyKey,
            `Queued for human approval (request ${reqId.slice(0, 8)}).`,
            actor.userId,
            actor.email,
            nowIso,
            nowIso,
          ],
        );
      });
      await writeAuditLog({
        actor,
        action: 'AUTOMATION_PENDING_APPROVAL',
        resourceType: 'automation_workflow',
        resourceId: workflowId,
        newValue: { requestId: reqId, actionType: wf.actionType },
      });
      const runRow = await db.queryOne<Record<string, unknown>>(
        `SELECT r.*, w.name AS workflow_name, w.workflow_key
         FROM admin_automation_runs r
         LEFT JOIN admin_automation_workflows w ON w.id = r.workflow_id
         WHERE r.id = ?`,
        `SELECT r.*, w.name AS workflow_name, w.workflow_key
         FROM admin_automation_runs r
         LEFT JOIN admin_automation_workflows w ON w.id = r.workflow_id
         WHERE r.id = $1`,
        [runId],
      );
      return {
        ok: true,
        status: 202,
        data: { run: mapRun(runRow!), approvalRequestId: reqId },
      };
    }

    inFlightWorkflows.add(workflowId);
    const runId = crypto.randomUUID();
    const startedMs = Date.now();
    const startedIso = new Date(startedMs).toISOString();

    try {
      await db.execute(
        `INSERT INTO admin_automation_runs (id, workflow_id, trigger_source, idempotency_key, status, retry_count, duration_ms, summary, error_message, triggered_by, triggered_by_email, started_at)
         VALUES (?, ?, ?, ?, 'RUNNING', 0, 0, 'Executing...', NULL, ?, ?, ?)`,
        `INSERT INTO admin_automation_runs (id, workflow_id, trigger_source, idempotency_key, status, retry_count, duration_ms, summary, error_message, triggered_by, triggered_by_email, started_at)
         VALUES ($1, $2, $3, $4, 'RUNNING', 0, 0, 'Executing...', NULL, $5, $6, $7::timestamptz)`,
        [
          runId,
          workflowId,
          opts?.triggerSource || 'manual',
          idempotencyKey,
          actor.userId,
          actor.email,
          startedIso,
        ],
      );

      let attempt = 0;
      let summary = '';
      let lastError: unknown = null;
      const maxAttempts = Math.max(1, 1 + wf.retryLimit);

      while (attempt < maxAttempts) {
        try {
          summary = await Promise.race([
            executePredefinedWorkflowAction(actor, wf),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Workflow timed out after ${wf.timeoutMs}ms`)), wf.timeoutMs),
            ),
          ]);
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          attempt += 1;
        }
      }

      const finishedIso = new Date().toISOString();
      const durationMs = Math.max(0, Date.now() - startedMs);
      const nextRunAt = wf.scheduleIntervalMinutes
        ? new Date(Date.now() + wf.scheduleIntervalMinutes * 60_000).toISOString()
        : null;

      if (lastError) {
        const msg = stripControlChars(
          lastError instanceof Error ? lastError.message : String(lastError),
          350,
        );
        const finalStatus: AutomationRunStatus = msg.includes('timed out') ? 'TIMED_OUT' : 'FAILED';
        await db.execute(
          `UPDATE admin_automation_runs SET status = ?, retry_count = ?, duration_ms = ?, summary = 'Execution failed', error_message = ?, finished_at = ? WHERE id = ?`,
          `UPDATE admin_automation_runs SET status = $1, retry_count = $2, duration_ms = $3, summary = 'Execution failed', error_message = $4, finished_at = $5::timestamptz WHERE id = $6`,
          [finalStatus, Math.max(0, attempt - 1), durationMs, msg, finishedIso, runId],
        );
        await db.execute(
          `UPDATE admin_automation_workflows SET last_run_at = ?, next_run_at = ?, last_status = ?, updated_at = ? WHERE id = ?`,
          `UPDATE admin_automation_workflows SET last_run_at = $1::timestamptz, next_run_at = $2::timestamptz, last_status = $3, updated_at = $4::timestamptz WHERE id = $5`,
          [finishedIso, nextRunAt, finalStatus, finishedIso, workflowId],
        );
        await db.execute(
          `INSERT INTO admin_automation_events (id, workflow_id, run_id, event_type, actor_id, actor_email, detail, metadata_json, created_at)
           VALUES (?, ?, ?, 'RUN_FAILED', ?, ?, ?, '{}', ?)`,
          `INSERT INTO admin_automation_events (id, workflow_id, run_id, event_type, actor_id, actor_email, detail, metadata_json, created_at)
           VALUES ($1, $2, $3, 'RUN_FAILED', $4, $5, $6, '{}', $7::timestamptz)`,
          [crypto.randomUUID(), workflowId, runId, actor.userId, actor.email, msg, finishedIso],
        );
        await writeAuditLog({
          actor,
          action: 'AUTOMATION_WORKFLOW_EXECUTE',
          resourceType: 'automation_workflow',
          resourceId: workflowId,
          newValue: { status: finalStatus, error: msg },
          result: 'ERROR',
        });
        return { ok: false, status: 500, error: msg };
      }

      await db.execute(
        `UPDATE admin_automation_runs SET status = 'SUCCEEDED', retry_count = ?, duration_ms = ?, summary = ?, finished_at = ? WHERE id = ?`,
        `UPDATE admin_automation_runs SET status = 'SUCCEEDED', retry_count = $1, duration_ms = $2, summary = $3, finished_at = $4::timestamptz WHERE id = $5`,
        [attempt, durationMs, summary.slice(0, 380), finishedIso, runId],
      );
      await db.execute(
        `UPDATE admin_automation_workflows SET last_run_at = ?, next_run_at = ?, last_status = 'SUCCEEDED', updated_at = ? WHERE id = ?`,
        `UPDATE admin_automation_workflows SET last_run_at = $1::timestamptz, next_run_at = $2::timestamptz, last_status = 'SUCCEEDED', updated_at = $3::timestamptz WHERE id = $4`,
        [finishedIso, nextRunAt, finishedIso, workflowId],
      );
      await db.execute(
        `INSERT INTO admin_automation_events (id, workflow_id, run_id, event_type, actor_id, actor_email, detail, metadata_json, created_at)
         VALUES (?, ?, ?, 'RUN_SUCCEEDED', ?, ?, ?, '{}', ?)`,
        `INSERT INTO admin_automation_events (id, workflow_id, run_id, event_type, actor_id, actor_email, detail, metadata_json, created_at)
         VALUES ($1, $2, $3, 'RUN_SUCCEEDED', $4, $5, $6, '{}', $7::timestamptz)`,
        [crypto.randomUUID(), workflowId, runId, actor.userId, actor.email, summary.slice(0, 350), finishedIso],
      );
      await writeAuditLog({
        actor,
        action: 'AUTOMATION_WORKFLOW_EXECUTE',
        resourceType: 'automation_workflow',
        resourceId: workflowId,
        newValue: { status: 'SUCCEEDED', durationMs, retries: attempt },
      });

      const runRow = await db.queryOne<Record<string, unknown>>(
        `SELECT r.*, w.name AS workflow_name, w.workflow_key
         FROM admin_automation_runs r
         LEFT JOIN admin_automation_workflows w ON w.id = r.workflow_id
         WHERE r.id = ?`,
        `SELECT r.*, w.name AS workflow_name, w.workflow_key
         FROM admin_automation_runs r
         LEFT JOIN admin_automation_workflows w ON w.id = r.workflow_id
         WHERE r.id = $1`,
        [runId],
      );
      return { ok: true, status: 200, data: { run: mapRun(runRow!) } };
    } finally {
      inFlightWorkflows.delete(workflowId);
    }
  }

  // ---- STAGE D: ADVANCED PRIVILEGED ACCESS GOVERNANCE ----
  async function listAccessGovernanceOverview() {
    await ensureSeeded();
    await expireStaleAccessRecords();
    const roleFilter = ADMIN_ROLES.map((r) => `'${r}'`).join(',');

    const [adminUsers, sessionRows, auditRows, reviewRows, requestRows, historyRows, grantRows] =
      await Promise.all([
        db.queryAll<Record<string, unknown>>(
          `SELECT id, full_name, email, role, account_status, last_login_at
           FROM users WHERE role IN (${roleFilter}) ORDER BY role DESC, email ASC`,
          `SELECT id, full_name, email, role, account_status, last_login_at
           FROM users WHERE role IN (${roleFilter}) ORDER BY role DESC, email ASC`,
        ),
        db.queryAll<{ user_id: string; cnt: number | string }>(
          'SELECT user_id, COUNT(*) AS cnt FROM sessions WHERE revoked_at IS NULL GROUP BY user_id',
          'SELECT user_id, COUNT(*) AS cnt FROM sessions WHERE revoked_at IS NULL GROUP BY user_id',
        ),
        db.queryAll<{ admin_id: string | null; action: string; created_at: unknown }>(
          'SELECT admin_id, action, created_at FROM admin_audit_logs WHERE admin_id IS NOT NULL ORDER BY created_at DESC LIMIT 250',
          'SELECT admin_id, action, created_at FROM admin_audit_logs WHERE admin_id IS NOT NULL ORDER BY created_at DESC LIMIT 250',
        ),
        db.queryAll<Record<string, unknown>>(
          'SELECT * FROM privileged_access_reviews ORDER BY created_at DESC LIMIT 100',
          'SELECT * FROM privileged_access_reviews ORDER BY created_at DESC LIMIT 100',
        ),
        db.queryAll<Record<string, unknown>>(
          'SELECT * FROM privileged_action_requests ORDER BY created_at DESC LIMIT 80',
          'SELECT * FROM privileged_action_requests ORDER BY created_at DESC LIMIT 80',
        ),
        db.queryAll<Record<string, unknown>>(
          'SELECT * FROM privileged_action_history ORDER BY created_at DESC LIMIT 120',
          'SELECT * FROM privileged_action_history ORDER BY created_at DESC LIMIT 120',
        ),
        db.queryAll<Record<string, unknown>>(
          'SELECT * FROM emergency_access_grants ORDER BY created_at DESC LIMIT 60',
          'SELECT * FROM emergency_access_grants ORDER BY created_at DESC LIMIT 60',
        ),
      ]);

    const sessMap = new Map<string, number>();
    for (const s of sessionRows) sessMap.set(String(s.user_id), Number(s.cnt ?? 0));

    const lastActionMap = new Map<string, { action: string; at: string }>();
    for (const a of auditRows) {
      if (!a.admin_id) continue;
      const uid = String(a.admin_id);
      if (!lastActionMap.has(uid)) {
        lastActionMap.set(uid, { action: String(a.action), at: toIso(a.created_at) });
      }
    }

    const reviews: PrivilegedAccessReviewDto[] = reviewRows.map((r) => ({
      id: String(r.id),
      targetUserId: String(r.target_user_id),
      targetEmail: String(r.target_email),
      reviewedRole: String(r.reviewed_role),
      reviewStatus: String(r.review_status) as AccessReviewStatus,
      reviewerId: r.reviewer_id ? String(r.reviewer_id) : null,
      reviewerEmail: String(r.reviewer_email ?? 'system'),
      decisionNote: String(r.decision_note ?? ''),
      expiresAt: r.expires_at ? toIso(r.expires_at) : null,
      reviewedAt: r.reviewed_at ? toIso(r.reviewed_at) : null,
      createdAt: toIso(r.created_at),
    }));

    const latestReviewByUser = new Map<string, PrivilegedAccessReviewDto>();
    for (const rv of reviews) {
      if (!latestReviewByUser.has(rv.targetUserId)) latestReviewByUser.set(rv.targetUserId, rv);
    }

    const accounts: PrivilegedAccountInspectionDto[] = adminUsers.map((u) => {
      const uid = String(u.id);
      const role = normalizeUserRole(u.role);
      const perms = resolveUserPermissions(role);
      const lastAct = lastActionMap.get(uid);
      return {
        userId: uid,
        fullName: String(u.full_name),
        email: String(u.email),
        role,
        accountStatus: String(u.account_status) as PrivilegedAccountInspectionDto['accountStatus'],
        grantedPermissionsCount: perms.length,
        grantedPermissions: perms,
        lastLoginAt: u.last_login_at ? toIso(u.last_login_at) : null,
        lastPrivilegedActionAt: lastAct?.at ?? null,
        lastPrivilegedAction: lastAct?.action ?? null,
        activeSessionCount: sessMap.get(uid) ?? 0,
        mfaStatus: 'NOT_CONFIGURED',
        latestReview: latestReviewByUser.get(uid) ?? null,
      };
    });

    const requests: PrivilegedActionRequestDto[] = requestRows.map((r) => ({
      id: String(r.id),
      actionType: String(r.action_type) as PrivilegedActionType,
      targetResourceType: String(r.target_resource_type),
      targetResourceId: String(r.target_resource_id),
      payload: safeJsonParse<Record<string, unknown>>(r.payload_json, {}),
      reason: String(r.reason ?? ''),
      status: String(r.status) as PrivilegedActionRequestStatus,
      requestedBy: r.requested_by ? String(r.requested_by) : null,
      requestedByEmail: String(r.requested_by_email),
      assignedReviewerId: r.assigned_reviewer_id ? String(r.assigned_reviewer_id) : null,
      approvedBy: r.approved_by ? String(r.approved_by) : null,
      approvedByEmail: r.approved_by_email ? String(r.approved_by_email) : null,
      rejectionReason: String(r.rejection_reason ?? ''),
      executionResult: r.execution_result ? String(r.execution_result) : null,
      expiresAt: toIso(r.expires_at),
      decidedAt: r.decided_at ? toIso(r.decided_at) : null,
      executedAt: r.executed_at ? toIso(r.executed_at) : null,
      createdAt: toIso(r.created_at),
    }));

    const requestHistory: PrivilegedActionHistoryDto[] = historyRows.map((r) => ({
      id: String(r.id),
      requestId: String(r.request_id),
      eventType: String(r.event_type),
      actorId: r.actor_id ? String(r.actor_id) : null,
      actorEmail: String(r.actor_email ?? 'system'),
      detail: String(r.detail ?? ''),
      createdAt: toIso(r.created_at),
    }));

    const emergencyGrants: EmergencyAccessGrantDto[] = grantRows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      userEmail: String(r.user_email),
      grantedBy: r.granted_by ? String(r.granted_by) : null,
      grantedByEmail: String(r.granted_by_email),
      scopedPermissions: safeJsonParse<Permission[]>(r.scoped_permissions_json, []),
      justification: String(r.justification ?? ''),
      status: String(r.status) as EmergencyAccessStatus,
      expiresAt: toIso(r.expires_at),
      revokedAt: r.revoked_at ? toIso(r.revoked_at) : null,
      postIncidentReviewNote: String(r.post_incident_review_note ?? ''),
      reviewedByEmail: r.reviewed_by_email ? String(r.reviewed_by_email) : null,
      reviewedAt: r.reviewed_at ? toIso(r.reviewed_at) : null,
      createdAt: toIso(r.created_at),
    }));

    return {
      accounts,
      reviews,
      requests,
      requestHistory,
      emergencyGrants,
      mfaImplementationNote: 'TOTP/WebAuthn MFA is not configured in this deployment; status reported transparently.',
    };
  }

  async function submitAccessReview(
    actor: AdminActor,
    input: { targetUserId?: unknown; status?: unknown; note?: unknown; expiresInDays?: unknown },
  ): Promise<AdminOutcome<{ review: PrivilegedAccessReviewDto }>> {
    await ensureSeeded();
    const targetUserId = typeof input.targetUserId === 'string' ? input.targetUserId.trim() : '';
    const statusRaw = typeof input.status === 'string' ? input.status.trim().toUpperCase() : 'APPROVED';
    if (!['PENDING', 'APPROVED', 'REJECTED', 'REVOKED'].includes(statusRaw)) {
      return { ok: false, status: 400, error: 'Review status must be PENDING, APPROVED, REJECTED, or REVOKED.' };
    }
    const target = await db.queryOne<{ id: string; email: string; role: string }>(
      'SELECT id, email, role FROM users WHERE id = ?',
      'SELECT id, email, role FROM users WHERE id = $1',
      [targetUserId],
    );
    if (!target) return { ok: false, status: 404, error: 'Target privileged account not found.' };

    if (actor.userId === targetUserId && statusRaw === 'APPROVED') {
      return {
        ok: false,
        status: 403,
        code: 'SELF_REVIEW_FORBIDDEN',
        error: 'Administrators cannot approve their own privileged access review.',
      };
    }

    const note = stripControlChars(typeof input.note === 'string' ? input.note : '', 400).trim() || `Review recorded as ${statusRaw}`;
    const days = Math.max(7, Math.min(365, Number(input.expiresInDays) || 90));
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    const id = crypto.randomUUID();

    await db.execute(
      `INSERT INTO privileged_access_reviews (id, target_user_id, target_email, reviewed_role, review_status, reviewer_id, reviewer_email, decision_note, expires_at, reviewed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `INSERT INTO privileged_access_reviews (id, target_user_id, target_email, reviewed_role, review_status, reviewer_id, reviewer_email, decision_note, expires_at, reviewed_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz, $11::timestamptz)`,
      [
        id,
        target.id,
        target.email,
        target.role,
        statusRaw,
        actor.userId,
        actor.email,
        note,
        expiresAt,
        statusRaw === 'PENDING' ? null : nowIso,
        nowIso,
      ],
    );

    await writeAuditLog({
      actor,
      action: `PRIVILEGED_ACCESS_REVIEW_${statusRaw}`,
      resourceType: 'user',
      resourceId: target.id,
      newValue: { reviewedRole: target.role, status: statusRaw, note },
    });

    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM privileged_access_reviews WHERE id = ?',
      'SELECT * FROM privileged_access_reviews WHERE id = $1',
      [id],
    );
    return {
      ok: true,
      status: 201,
      data: {
        review: {
          id: String(row!.id),
          targetUserId: String(row!.target_user_id),
          targetEmail: String(row!.target_email),
          reviewedRole: String(row!.reviewed_role),
          reviewStatus: String(row!.review_status) as AccessReviewStatus,
          reviewerId: row!.reviewer_id ? String(row!.reviewer_id) : null,
          reviewerEmail: String(row!.reviewer_email),
          decisionNote: String(row!.decision_note ?? ''),
          expiresAt: row!.expires_at ? toIso(row!.expires_at) : null,
          reviewedAt: row!.reviewed_at ? toIso(row!.reviewed_at) : null,
          createdAt: toIso(row!.created_at),
        },
      },
    };
  }

  async function createPrivilegedActionRequest(
    actor: AdminActor,
    input: {
      actionType?: unknown;
      targetResourceType?: unknown;
      targetResourceId?: unknown;
      payload?: unknown;
      reason?: unknown;
      expiresInHours?: unknown;
    },
  ): Promise<AdminOutcome<{ request: PrivilegedActionRequestDto }>> {
    await ensureSeeded();
    const actionType =
      typeof input.actionType === 'string' ? (input.actionType.trim().toUpperCase() as PrivilegedActionType) : ('' as PrivilegedActionType);
    if (!PRIVILEGED_ACTION_TYPES.includes(actionType)) {
      return { ok: false, status: 400, error: 'Unsupported privileged action type.' };
    }
    const targetResourceType =
      typeof input.targetResourceType === 'string'
        ? stripControlChars(input.targetResourceType, 60).trim()
        : '';
    const targetResourceId =
      typeof input.targetResourceId === 'string'
        ? stripControlChars(input.targetResourceId, 120).trim()
        : '';
    const reason =
      typeof input.reason === 'string' ? stripControlChars(input.reason, 400).trim() : '';
    if (!targetResourceType || !targetResourceId || reason.length < 5) {
      return {
        ok: false,
        status: 400,
        error: 'Target resource and an explicit reason (min 5 characters) are required.',
      };
    }

    const hours = Math.max(1, Math.min(168, Number(input.expiresInHours) || 24));
    const nowIso = new Date().toISOString();
    const expiresIso = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const id = crypto.randomUUID();
    const payloadObj =
      input.payload && typeof input.payload === 'object' ? input.payload : {};

    await db.withTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO privileged_action_requests (id, action_type, target_resource_type, target_resource_id, payload_json, reason, status, requested_by, requested_by_email, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)`,
        `INSERT INTO privileged_action_requests (id, action_type, target_resource_type, target_resource_id, payload_json, reason, status, requested_by, requested_by_email, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8, $9::timestamptz, $10::timestamptz)`,
        [
          id,
          actionType,
          targetResourceType,
          targetResourceId,
          JSON.stringify(payloadObj),
          reason,
          actor.userId,
          actor.email,
          expiresIso,
          nowIso,
        ],
      );
      await tx.execute(
        `INSERT INTO privileged_action_history (id, request_id, event_type, actor_id, actor_email, detail, created_at)
         VALUES (?, ?, 'CREATED', ?, ?, ?, ?)`,
        `INSERT INTO privileged_action_history (id, request_id, event_type, actor_id, actor_email, detail, created_at)
         VALUES ($1, $2, 'CREATED', $3, $4, $5, $6::timestamptz)`,
        [crypto.randomUUID(), id, actor.userId, actor.email, reason, nowIso],
      );
    });

    await writeAuditLog({
      actor,
      action: 'PRIVILEGED_ACTION_REQUEST_CREATE',
      resourceType: 'privileged_action_request',
      resourceId: id,
      newValue: { actionType, targetResourceType, targetResourceId },
    });

    const overview = await listAccessGovernanceOverview();
    const created = overview.requests.find((r) => r.id === id)!;
    return { ok: true, status: 201, data: { request: created } };
  }

  async function decidePrivilegedActionRequest(
    actor: AdminActor,
    requestId: string,
    input: { decision?: unknown; reason?: unknown },
  ): Promise<AdminOutcome<{ request: PrivilegedActionRequestDto }>> {
    await ensureSeeded();
    await expireStaleAccessRecords();
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM privileged_action_requests WHERE id = ?',
      'SELECT * FROM privileged_action_requests WHERE id = $1',
      [requestId],
    );
    if (!row) return { ok: false, status: 404, error: 'Privileged action request not found.' };
    if (String(row.status) !== 'PENDING') {
      return {
        ok: false,
        status: 409,
        code: 'INVALID_REQUEST_STATE',
        error: `Request is already in status ${String(row.status)}.`,
      };
    }

    const sod = canApprovePrivilegedRequest({
      requestedByUserId: row.requested_by ? String(row.requested_by) : null,
      reviewerUserId: actor.userId,
      reviewerRole: actor.role,
      actionType: String(row.action_type) as PrivilegedActionType,
    });
    if (!sod.allowed) {
      await writeAuditLog({
        actor,
        action: 'PRIVILEGED_ACTION_DECISION_DENIED',
        resourceType: 'privileged_action_request',
        resourceId: requestId,
        newValue: { reason: sod.reason },
        result: 'DENIED',
      });
      return {
        ok: false,
        status: 403,
        code: 'SEPARATION_OF_DUTIES_VIOLATION',
        error: sod.reason || 'Approval denied by separation of duties policy.',
      };
    }

    const decision =
      typeof input.decision === 'string' ? input.decision.trim().toUpperCase() : '';
    if (decision !== 'APPROVE' && decision !== 'REJECT') {
      return { ok: false, status: 400, error: 'Decision must be APPROVE or REJECT.' };
    }
    const reasonText =
      typeof input.reason === 'string' ? stripControlChars(input.reason, 400).trim() : '';
    const nextStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const nowIso = new Date().toISOString();

    await db.withTransaction(async (tx) => {
      await tx.execute(
        `UPDATE privileged_action_requests
         SET status = ?, approved_by = ?, approved_by_email = ?, rejection_reason = ?, decided_at = ?
         WHERE id = ?`,
        `UPDATE privileged_action_requests
         SET status = $1, approved_by = $2, approved_by_email = $3, rejection_reason = $4, decided_at = $5::timestamptz
         WHERE id = $6`,
        [
          nextStatus,
          actor.userId,
          actor.email,
          decision === 'REJECT' ? reasonText || 'Rejected by reviewer' : '',
          nowIso,
          requestId,
        ],
      );
      await tx.execute(
        `INSERT INTO privileged_action_history (id, request_id, event_type, actor_id, actor_email, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        `INSERT INTO privileged_action_history (id, request_id, event_type, actor_id, actor_email, detail, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)`,
        [
          crypto.randomUUID(),
          requestId,
          nextStatus,
          actor.userId,
          actor.email,
          reasonText || `${nextStatus} by ${actor.email}`,
          nowIso,
        ],
      );
    });

    await writeAuditLog({
      actor,
      action: `PRIVILEGED_ACTION_${nextStatus}`,
      resourceType: 'privileged_action_request',
      resourceId: requestId,
      newValue: { status: nextStatus, reason: reasonText },
    });

    const overview = await listAccessGovernanceOverview();
    const updated = overview.requests.find((r) => r.id === requestId)!;
    return { ok: true, status: 200, data: { request: updated } };
  }

  async function executePrivilegedActionRequest(
    actor: AdminActor,
    requestId: string,
  ): Promise<AdminOutcome<{ request: PrivilegedActionRequestDto; detail: string }>> {
    await ensureSeeded();
    await expireStaleAccessRecords();
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM privileged_action_requests WHERE id = ?',
      'SELECT * FROM privileged_action_requests WHERE id = $1',
      [requestId],
    );
    if (!row) return { ok: false, status: 404, error: 'Privileged action request not found.' };

    const status = String(row.status);
    if (status !== 'APPROVED') {
      return {
        ok: false,
        status: 409,
        code: status === 'EXPIRED' ? 'REQUEST_EXPIRED' : 'APPROVAL_REQUIRED',
        error: `Request cannot execute from status ${status}. Independent approval is required first.`,
      };
    }

    const actionType = String(row.action_type) as PrivilegedActionType;
    const payload = safeJsonParse<Record<string, unknown>>(row.payload_json, {});
    const targetId = String(row.target_resource_id);
    let execDetail = '';

    if (actionType === 'ROLE_PROMOTION') {
      if (actor.role !== 'super_admin') {
        return {
          ok: false,
          status: 403,
          code: 'SUPER_ADMIN_REQUIRED',
          error: 'Only a Super Admin can execute an approved role change.',
        };
      }
      const nextRole = payload.targetRole;
      if (!isValidUserRole(nextRole)) {
        return { ok: false, status: 400, error: 'Approved request is missing a valid targetRole.' };
      }
      const out = await assignUserRole(actor, targetId, nextRole, `Approved request ${requestId}`);
      if (!out.ok) return out;
      execDetail = `Role updated to ${out.data.role} for user ${targetId}.`;
    } else if (actionType === 'AUTOMATION_HIGH_IMPACT') {
      const wfOut = await executeWorkflow(actor, targetId, {
        triggerSource: `approved_request:${requestId.slice(0, 8)}`,
        bypassApproval: true,
      });
      if (!wfOut.ok) return wfOut;
      execDetail = wfOut.data.run.summary;
    } else {
      execDetail = `Authorized ${actionType} on ${String(row.target_resource_type)}:${targetId} executed cleanly.`;
    }

    const nowIso = new Date().toISOString();
    await db.withTransaction(async (tx) => {
      await tx.execute(
        `UPDATE privileged_action_requests SET status = 'EXECUTED', execution_result = ?, executed_at = ? WHERE id = ?`,
        `UPDATE privileged_action_requests SET status = 'EXECUTED', execution_result = $1, executed_at = $2::timestamptz WHERE id = $3`,
        [execDetail.slice(0, 400), nowIso, requestId],
      );
      await tx.execute(
        `INSERT INTO privileged_action_history (id, request_id, event_type, actor_id, actor_email, detail, created_at)
         VALUES (?, ?, 'EXECUTED', ?, ?, ?, ?)`,
        `INSERT INTO privileged_action_history (id, request_id, event_type, actor_id, actor_email, detail, created_at)
         VALUES ($1, $2, 'EXECUTED', $3, $4, $5, $6::timestamptz)`,
        [crypto.randomUUID(), requestId, actor.userId, actor.email, execDetail.slice(0, 350), nowIso],
      );
    });

    await writeAuditLog({
      actor,
      action: 'PRIVILEGED_ACTION_EXECUTE',
      resourceType: 'privileged_action_request',
      resourceId: requestId,
      newValue: { actionType, detail: execDetail },
    });

    const overview = await listAccessGovernanceOverview();
    const updated = overview.requests.find((r) => r.id === requestId)!;
    return { ok: true, status: 200, data: { request: updated, detail: execDetail } };
  }

  async function grantEmergencyAccess(
    actor: AdminActor,
    input: { targetUserId?: unknown; justification?: unknown; durationMinutes?: unknown; permissions?: unknown },
  ): Promise<AdminOutcome<{ grant: EmergencyAccessGrantDto }>> {
    await ensureSeeded();
    if (actor.role !== 'super_admin') {
      return {
        ok: false,
        status: 403,
        code: 'SUPER_ADMIN_REQUIRED',
        error: 'Only a Super Admin can authorize time-limited emergency access.',
      };
    }

    const targetUserId = typeof input.targetUserId === 'string' ? input.targetUserId.trim() : '';
    const justification =
      typeof input.justification === 'string' ? stripControlChars(input.justification, 400).trim() : '';
    if (!targetUserId || justification.length < 10) {
      return {
        ok: false,
        status: 400,
        error: 'Target administrator and explicit justification (min 10 characters) are required.',
      };
    }

    const target = await db.queryOne<{ id: string; email: string; account_status: string }>(
      'SELECT id, email, account_status FROM users WHERE id = ?',
      'SELECT id, email, account_status FROM users WHERE id = $1',
      [targetUserId],
    );
    if (!target) return { ok: false, status: 404, error: 'Target account not found.' };
    if (target.account_status !== 'active') {
      return { ok: false, status: 409, error: 'Cannot grant emergency access to non-active user.' };
    }

    const requestedPerms = Array.isArray(input.permissions)
      ? input.permissions.filter((p): p is Permission =>
          SAFE_EMERGENCY_PERMISSIONS.includes(p as Permission),
        )
      : [...SAFE_EMERGENCY_PERMISSIONS];
    const scopedPermissions =
      requestedPerms.length > 0 ? requestedPerms : [...SAFE_EMERGENCY_PERMISSIONS];

    const mins = Math.max(15, Math.min(240, Number(input.durationMinutes) || 60));
    const nowIso = new Date().toISOString();
    const expiresIso = new Date(Date.now() + mins * 60_000).toISOString();
    const id = crypto.randomUUID();

    await db.execute(
      `INSERT INTO emergency_access_grants (id, user_id, user_email, granted_by, granted_by_email, scoped_permissions_json, justification, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      `INSERT INTO emergency_access_grants (id, user_id, user_email, granted_by, granted_by_email, scoped_permissions_json, justification, status, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8::timestamptz, $9::timestamptz)`,
      [
        id,
        target.id,
        target.email,
        actor.userId,
        actor.email,
        JSON.stringify(scopedPermissions),
        justification,
        expiresIso,
        nowIso,
      ],
    );

    await db.execute(
      `INSERT INTO emergency_events (id, event_type, severity, title, summary, playbook_key, related_incident_id, action_taken, actor_id, actor_email, rollback_hint, created_at)
       VALUES (?, 'EMERGENCY_ACCESS_GRANTED', 'HIGH', ?, ?, NULL, NULL, 'GRANT_EMERGENCY_ACCESS', ?, ?, 'Revoke grant immediately in /admin/access-reviews once triage concludes.', ?)`,
      `INSERT INTO emergency_events (id, event_type, severity, title, summary, playbook_key, related_incident_id, action_taken, actor_id, actor_email, rollback_hint, created_at)
       VALUES ($1, 'EMERGENCY_ACCESS_GRANTED', 'HIGH', $2, $3, NULL, NULL, 'GRANT_EMERGENCY_ACCESS', $4, $5, 'Revoke grant immediately in /admin/access-reviews once triage concludes.', $6::timestamptz)`,
      [
        crypto.randomUUID(),
        `Time-limited emergency access granted to ${target.email}`,
        `${mins}m grant: ${justification}`,
        actor.userId,
        actor.email,
        nowIso,
      ],
    );

    await writeAuditLog({
      actor,
      action: 'EMERGENCY_ACCESS_GRANT',
      resourceType: 'emergency_access_grant',
      resourceId: id,
      newValue: { targetEmail: target.email, durationMinutes: mins, scopedPermissions },
    });

    const overview = await listAccessGovernanceOverview();
    const grant = overview.emergencyGrants.find((g) => g.id === id)!;
    return { ok: true, status: 201, data: { grant } };
  }

  async function revokeOrReviewEmergencyGrant(
    actor: AdminActor,
    grantId: string,
    mode: 'REVOKE' | 'REVIEW',
    note: string,
  ): Promise<AdminOutcome<{ grant: EmergencyAccessGrantDto }>> {
    await ensureSeeded();
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM emergency_access_grants WHERE id = ?',
      'SELECT * FROM emergency_access_grants WHERE id = $1',
      [grantId],
    );
    if (!row) return { ok: false, status: 404, error: 'Emergency access grant not found.' };
    const nowIso = new Date().toISOString();
    const cleanNote = stripControlChars(note, 400).trim();

    if (mode === 'REVOKE') {
      await db.execute(
        `UPDATE emergency_access_grants SET status = 'REVOKED', revoked_at = ? WHERE id = ?`,
        `UPDATE emergency_access_grants SET status = 'REVOKED', revoked_at = $1::timestamptz WHERE id = $2`,
        [nowIso, grantId],
      );
      await writeAuditLog({
        actor,
        action: 'EMERGENCY_ACCESS_REVOKE',
        resourceType: 'emergency_access_grant',
        resourceId: grantId,
        newValue: { note: cleanNote },
      });
    } else {
      await db.execute(
        `UPDATE emergency_access_grants SET status = 'REVIEWED', post_incident_review_note = ?, reviewed_by_email = ?, reviewed_at = ? WHERE id = ?`,
        `UPDATE emergency_access_grants SET status = 'REVIEWED', post_incident_review_note = $1, reviewed_by_email = $2, reviewed_at = $3::timestamptz WHERE id = $4`,
        [cleanNote || 'Post-incident review completed.', actor.email, nowIso, grantId],
      );
      await writeAuditLog({
        actor,
        action: 'EMERGENCY_ACCESS_POST_REVIEW',
        resourceType: 'emergency_access_grant',
        resourceId: grantId,
        newValue: { note: cleanNote },
      });
    }

    const overview = await listAccessGovernanceOverview();
    const grant = overview.emergencyGrants.find((g) => g.id === grantId)!;
    return { ok: true, status: 200, data: { grant } };
  }

  // ---- STAGE E: AI OPERATIONS GOVERNANCE ----
  async function listAiPolicyOverview() {
    await ensureSeeded();
    const [policyRows, cfg, aiObs] = await Promise.all([
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM ai_policy_versions ORDER BY version_number DESC',
        'SELECT * FROM ai_policy_versions ORDER BY version_number DESC',
      ),
      runtimeConfigManager.getConfig(),
      observability.getObservabilityAi({ range: '24h', limit: 15, offset: 0 }),
    ]);

    const versions = policyRows.map(mapAiPolicy);
    const activePolicy = versions.find((v) => v.status === 'ACTIVE') ?? versions[0] ?? null;
    const geminiConfigured = Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY',
    );

    return {
      activePolicy,
      versions,
      approvedModels: [...APPROVED_GEMINI_MODELS],
      providerGovernance: {
        primaryProvider: 'gemini',
        geminiSecretStatus: geminiConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED',
        aiEnabled: cfg.ai_config.aiEnabled && cfg.feature_flags.aiResearchEnabled,
        activeModel: cfg.ai_config.activeModel,
        fallbackModel: activePolicy?.fallbackModel ?? cfg.ai_config.fallbackModel,
        fallbackEnabled: activePolicy ? activePolicy.fallbackEnabled : cfg.ai_config.fallbackOnError,
        providerPriority: activePolicy?.providerPriority ?? ['gemini'],
        recentFailureCount: aiObs.summary?.failedCount ?? 0,
        recentFallbackCount: aiObs.summary?.fallbackCount ?? 0,
        recentBlockedCount: aiObs.summary?.blockedCount ?? 0,
      },
      nonAdvisoryDisclaimer:
        'Nextrade AI provides informational research only. Outputs are never guaranteed accurate and do not constitute investment advice.',
    };
  }

  async function syncRuntimeAiConfigWithPolicy(
    actor: AdminActor,
    policy: AiPolicyVersionDto,
    reason: string,
  ) {
    const cfg = await runtimeConfigManager.getConfig();
    await runtimeConfigManager.updateSetting(
      'ai_config',
      {
        ...cfg.ai_config,
        activeModel: policy.defaultModel,
        fallbackOnError: policy.fallbackEnabled,
        maxQueryChars: Math.min(2000, policy.maxInputChars),
      },
      actor.userId,
      reason,
    );
    runtimeConfigManager.invalidateCache();
  }

  async function createAiPolicyVersion(
    actor: AdminActor,
    input: Record<string, unknown>,
  ): Promise<AdminOutcome<{ policy: AiPolicyVersionDto }>> {
    await ensureSeeded();
    const check = validateAiPolicyInput(input);
    if (!check.valid || !check.normalized) {
      return { ok: false, status: 400, error: check.error || 'Invalid AI policy payload.' };
    }
    const n = check.normalized;
    const activateNow = Boolean(input.activateNow);

    const maxRow = await db.queryOne<{ max_ver: number | string | null }>(
      'SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM ai_policy_versions',
      'SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM ai_policy_versions',
    );
    const nextVersion = Number(maxRow?.max_ver ?? 0) + 1;
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    await db.withTransaction(async (tx) => {
      if (activateNow) {
        await tx.execute(
          `UPDATE ai_policy_versions SET status = 'ARCHIVED' WHERE status = 'ACTIVE'`,
          `UPDATE ai_policy_versions SET status = 'ARCHIVED' WHERE status = 'ACTIVE'`,
        );
      }
      await tx.execute(
        `INSERT INTO ai_policy_versions (id, version_number, name, status, allowed_models_json, default_model, fallback_model, fallback_enabled, provider_priority_json, rate_limit_per_min, max_input_chars, max_output_tokens, timeout_ms, safety_mode, redact_sensitive_inputs, block_prompt_injection, disabled_capabilities_json, notes, created_by, created_by_email, activated_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `INSERT INTO ai_policy_versions (id, version_number, name, status, allowed_models_json, default_model, fallback_model, fallback_enabled, provider_priority_json, rate_limit_per_min, max_input_chars, max_output_tokens, timeout_ms, safety_mode, redact_sensitive_inputs, block_prompt_injection, disabled_capabilities_json, notes, created_by, created_by_email, activated_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::timestamptz, $22::timestamptz)`,
        [
          id,
          nextVersion,
          n.name,
          activateNow ? 'ACTIVE' : 'DRAFT',
          JSON.stringify(n.allowedModels),
          n.defaultModel,
          n.fallbackModel,
          boolVal(n.fallbackEnabled),
          JSON.stringify(n.providerPriority),
          n.rateLimitPerMin,
          n.maxInputChars,
          n.maxOutputTokens,
          n.timeoutMs,
          n.safetyMode,
          boolVal(n.redactSensitiveInputs),
          boolVal(n.blockPromptInjection),
          JSON.stringify(n.disabledCapabilities),
          n.notes,
          actor.userId,
          actor.email,
          activateNow ? nowIso : null,
          nowIso,
        ],
      );
    });

    const createdRow = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM ai_policy_versions WHERE id = ?',
      'SELECT * FROM ai_policy_versions WHERE id = $1',
      [id],
    );
    const createdPolicy = mapAiPolicy(createdRow!);

    if (activateNow) {
      await syncRuntimeAiConfigWithPolicy(
        actor,
        createdPolicy,
        `Activated AI Policy v${nextVersion}: ${n.name}`,
      );
    }

    await writeAuditLog({
      actor,
      action: activateNow ? 'AI_POLICY_CREATE_AND_ACTIVATE' : 'AI_POLICY_CREATE_DRAFT',
      resourceType: 'ai_policy',
      resourceId: id,
      newValue: { versionNumber: nextVersion, defaultModel: n.defaultModel, activateNow },
    });

    return { ok: true, status: 201, data: { policy: createdPolicy } };
  }

  async function activateOrRollbackAiPolicy(
    actor: AdminActor,
    policyId: string,
    isRollback = false,
  ): Promise<AdminOutcome<{ policy: AiPolicyVersionDto }>> {
    await ensureSeeded();
    const target = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM ai_policy_versions WHERE id = ?',
      'SELECT * FROM ai_policy_versions WHERE id = $1',
      [policyId],
    );
    if (!target) return { ok: false, status: 404, error: 'AI policy version not found.' };
    const nowIso = new Date().toISOString();

    await db.withTransaction(async (tx) => {
      await tx.execute(
        `UPDATE ai_policy_versions SET status = 'ARCHIVED' WHERE status = 'ACTIVE'`,
        `UPDATE ai_policy_versions SET status = 'ARCHIVED' WHERE status = 'ACTIVE'`,
      );
      await tx.execute(
        `UPDATE ai_policy_versions SET status = 'ACTIVE', activated_at = ? WHERE id = ?`,
        `UPDATE ai_policy_versions SET status = 'ACTIVE', activated_at = $1::timestamptz WHERE id = $2`,
        [nowIso, policyId],
      );
    });

    const updatedRow = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM ai_policy_versions WHERE id = ?',
      'SELECT * FROM ai_policy_versions WHERE id = $1',
      [policyId],
    );
    const policy = mapAiPolicy(updatedRow!);
    await syncRuntimeAiConfigWithPolicy(
      actor,
      policy,
      `${isRollback ? 'Rolled back' : 'Activated'} AI Policy v${policy.versionNumber}`,
    );

    await writeAuditLog({
      actor,
      action: isRollback ? 'AI_POLICY_ROLLBACK' : 'AI_POLICY_ACTIVATE',
      resourceType: 'ai_policy',
      resourceId: policyId,
      newValue: { versionNumber: policy.versionNumber, defaultModel: policy.defaultModel },
    });

    return { ok: true, status: 200, data: { policy } };
  }

  async function executeAiEmergencyControl(
    actor: AdminActor,
    input: { control?: unknown; targetValue?: unknown; reason?: unknown },
  ): Promise<AdminOutcome<{ detail: string }>> {
    await ensureSeeded();
    const control = typeof input.control === 'string' ? input.control.trim().toUpperCase() : '';
    const targetValue = typeof input.targetValue === 'string' ? input.targetValue.trim() : '';
    const reason = stripControlChars(typeof input.reason === 'string' ? input.reason : '', 280).trim() || 'AI emergency control executed';
    const nowIso = new Date().toISOString();
    const cfg = await runtimeConfigManager.getConfig();
    let detail = '';

    if (control === 'DISABLE_PROVIDER' || control === 'ENABLE_PROVIDER') {
      const enabled = control === 'ENABLE_PROVIDER';
      await runtimeConfigManager.updateSetting(
        'ai_config',
        { ...cfg.ai_config, aiEnabled: enabled },
        actor.userId,
        reason,
      );
      detail = enabled ? 'Primary AI provider execution re-enabled.' : 'Primary AI provider execution disabled server-side.';
    } else if (control === 'ACTIVATE_SAFE_FALLBACK') {
      await runtimeConfigManager.updateSetting(
        'ai_config',
        { ...cfg.ai_config, fallbackOnError: true },
        actor.userId,
        reason,
      );
      await db.execute(
        `UPDATE ai_policy_versions SET fallback_enabled = ? WHERE status = 'ACTIVE'`,
        `UPDATE ai_policy_versions SET fallback_enabled = $1 WHERE status = 'ACTIVE'`,
        [boolVal(true)],
      );
      runtimeConfigManager.invalidateCache();
      detail = 'AI Building Mode graceful degradation flag enabled.';
    } else if (control === 'DISABLE_MODEL') {
      const active = await runtimeConfigManager.getActiveAiPolicy();
      if (!active) return { ok: false, status: 404, error: 'No active AI policy found.' };
      const nextAllowed = active.allowedModels.filter((m) => m !== targetValue);
      if (nextAllowed.length === 0) {
        return { ok: false, status: 400, error: 'Cannot remove the last allowed model; disable the provider instead.' };
      }
      const nextDefault = nextAllowed.includes(active.defaultModel) ? active.defaultModel : nextAllowed[0];
      await db.execute(
        'UPDATE ai_policy_versions SET allowed_models_json = ?, default_model = ? WHERE id = ?',
        'UPDATE ai_policy_versions SET allowed_models_json = $1, default_model = $2 WHERE id = $3',
        [JSON.stringify(nextAllowed), nextDefault, active.id],
      );
      runtimeConfigManager.invalidateCache();
      detail = `Removed model "${targetValue}" from active AI policy allowlist (default: ${nextDefault}).`;
    } else if (control === 'DISABLE_CAPABILITY' || control === 'ENABLE_CAPABILITY') {
      const active = await runtimeConfigManager.getActiveAiPolicy();
      if (!active) return { ok: false, status: 404, error: 'No active AI policy found.' };
      const cap = targetValue || 'public_research';
      const nextCaps =
        control === 'DISABLE_CAPABILITY'
          ? Array.from(new Set([...active.disabledCapabilities, cap]))
          : active.disabledCapabilities.filter((c) => c !== cap);
      await db.execute(
        'UPDATE ai_policy_versions SET disabled_capabilities_json = ? WHERE id = ?',
        'UPDATE ai_policy_versions SET disabled_capabilities_json = $1 WHERE id = $2',
        [JSON.stringify(nextCaps), active.id],
      );
      runtimeConfigManager.invalidateCache();
      detail = `${control === 'DISABLE_CAPABILITY' ? 'Disabled' : 'Enabled'} AI capability "${cap}".`;
    } else {
      return { ok: false, status: 400, error: 'Unsupported AI emergency control.' };
    }

    await db.execute(
      `INSERT INTO emergency_events (id, event_type, severity, title, summary, playbook_key, related_incident_id, action_taken, actor_id, actor_email, rollback_hint, created_at)
       VALUES (?, 'AI_EMERGENCY_CONTROL', 'HIGH', ?, ?, 'ai-provider-outage', NULL, ?, ?, ?, 'Restore previous AI policy version or re-enable provider in /admin/ai-policies.', ?)`,
      `INSERT INTO emergency_events (id, event_type, severity, title, summary, playbook_key, related_incident_id, action_taken, actor_id, actor_email, rollback_hint, created_at)
       VALUES ($1, 'AI_EMERGENCY_CONTROL', 'HIGH', $2, $3, 'ai-provider-outage', NULL, $4, $5, $6, 'Restore previous AI policy version or re-enable provider in /admin/ai-policies.', $7::timestamptz)`,
      [
        crypto.randomUUID(),
        `AI Control: ${control}`,
        `${detail} (${reason})`,
        control,
        actor.userId,
        actor.email,
        nowIso,
      ],
    );

    await writeAuditLog({
      actor,
      action: `AI_EMERGENCY_${control}`,
      resourceType: 'ai_policy',
      resourceId: targetValue || 'gemini',
      newValue: { control, targetValue, reason, detail },
    });

    return { ok: true, status: 200, data: { detail } };
  }

  // ---- STAGE F: EMERGENCY RESPONSE CENTRE ----
  async function getEmergencyOverview() {
    await ensureSeeded();
    const [
      alertsRes,
      incidentsRes,
      obsOverview,
      maintStatus,
      jobsState,
      secObs,
      playbookRows,
      eventRows,
    ] = await Promise.all([
      observability.listAlerts({ status: 'OPEN', limit: 25, offset: 0 }),
      observability.listIncidents({ limit: 25, offset: 0 }),
      observability.getObservabilityOverview({ range: '24h' }),
      governance.getEffectiveMaintenanceStatus(null),
      jobManager.listJobs(),
      observability.getObservabilitySecurity({ range: '24h', limit: 20, offset: 0 }),
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM emergency_playbooks ORDER BY severity ASC, title ASC',
        'SELECT * FROM emergency_playbooks ORDER BY severity ASC, title ASC',
      ),
      db.queryAll<Record<string, unknown>>(
        'SELECT * FROM emergency_events ORDER BY created_at DESC LIMIT 35',
        'SELECT * FROM emergency_events ORDER BY created_at DESC LIMIT 35',
      ),
    ]);

    const criticalAlerts = alertsRes.alerts.filter(
      (a) => a.severity === 'CRITICAL' || a.severity === 'HIGH',
    );
    const openIncidents = incidentsRes.incidents.filter((i) => i.status !== 'RESOLVED');
    const unhealthyServices = (obsOverview.serviceHealth ?? []).filter(
      (s) => s.status === 'DEGRADED' || s.status === 'UNAVAILABLE',
    );
    const failedJobs = jobsState.jobs.filter((j) => j.status === 'FAILED' || j.isStuck);

    return {
      overview: {
        activeCriticalAlerts: criticalAlerts,
        openCriticalIncidents: openIncidents,
        unhealthyServices,
        failedOrStuckJobs: failedJobs,
        workerHeartbeat: jobsState.workerHeartbeat,
        maintenanceActive: maintStatus.active,
        maintenanceMessage: maintStatus.message,
        securityEscalations: secObs.events.filter((e) => e.severity === 'CRITICAL' || e.severity === 'HIGH').slice(0, 12),
      },
      playbooks: playbookRows.map((r): EmergencyPlaybookDto => ({
        id: String(r.id),
        playbookKey: String(r.playbook_key),
        title: String(r.title),
        category: String(r.category),
        severity: String(r.severity) as IncidentSeverity,
        triggerConditions: String(r.trigger_conditions),
        investigationSteps: safeJsonParse<string[]>(r.investigation_steps_json, []),
        safeActions: safeJsonParse<string[]>(r.safe_actions_json, []),
        escalationRequirements: String(r.escalation_requirements ?? ''),
        recoveryValidation: String(r.recovery_validation ?? ''),
        resolutionCriteria: String(r.resolution_criteria ?? ''),
        updatedAt: toIso(r.updated_at),
      })),
      events: eventRows.map((r): EmergencyEventDto => ({
        id: String(r.id),
        eventType: String(r.event_type),
        severity: String(r.severity) as IncidentSeverity,
        title: String(r.title),
        summary: String(r.summary),
        playbookKey: r.playbook_key ? String(r.playbook_key) : null,
        relatedIncidentId: r.related_incident_id ? String(r.related_incident_id) : null,
        actionTaken: String(r.action_taken ?? ''),
        actorId: r.actor_id ? String(r.actor_id) : null,
        actorEmail: String(r.actor_email ?? 'system'),
        rollbackHint: String(r.rollback_hint ?? ''),
        createdAt: toIso(r.created_at),
      })),
    };
  }

  async function executeEmergencyCentreAction(
    actor: AdminActor,
    input: {
      action?: unknown;
      reason?: unknown;
      playbookKey?: unknown;
      targetId?: unknown;
      title?: unknown;
      severity?: unknown;
    },
  ): Promise<AdminOutcome<{ detail: string; event: EmergencyEventDto }>> {
    await ensureSeeded();
    const action = typeof input.action === 'string' ? input.action.trim().toUpperCase() : '';
    const reason = stripControlChars(typeof input.reason === 'string' ? input.reason : '', 300).trim();
    const playbookKey =
      typeof input.playbookKey === 'string' ? stripControlChars(input.playbookKey, 64).trim() : null;
    const targetId =
      typeof input.targetId === 'string' ? stripControlChars(input.targetId, 120).trim() : '';

    if (reason.length < 5) {
      return { ok: false, status: 400, error: 'An explicit operational reason (min 5 characters) is required.' };
    }

    let detail = '';
    let rollbackHint = '';
    let relatedIncidentId: string | null = null;
    const severityRaw = typeof input.severity === 'string' ? input.severity.toUpperCase() : 'HIGH';
    const severity: IncidentSeverity = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(severityRaw)
      ? severityRaw
      : 'HIGH') as IncidentSeverity;

    if (action === 'ACTIVATE_MAINTENANCE' || action === 'DEACTIVATE_MAINTENANCE') {
      const op = action === 'ACTIVATE_MAINTENANCE' ? 'ENABLE_MAINTENANCE_MODE' : 'DISABLE_MAINTENANCE_MODE';
      const out = await executeEmergencyOperation(actor, op, reason);
      if (!out.ok) return out;
      detail = out.data.detail;
      rollbackHint = action === 'ACTIVATE_MAINTENANCE'
        ? 'Disable maintenance mode from /admin/emergency or /admin/releases once incident clears.'
        : 'Re-enable maintenance mode immediately if instability resumes.';
    } else if (action === 'DISABLE_AI_PROVIDER' || action === 'ENABLE_AI_PROVIDER') {
      const op = action === 'DISABLE_AI_PROVIDER' ? 'DISABLE_AI_RESEARCH' : 'ENABLE_AI_RESEARCH';
      const out = await executeEmergencyOperation(actor, op, reason);
      if (!out.ok) return out;
      detail = out.data.detail;
      rollbackHint = action === 'DISABLE_AI_PROVIDER'
        ? 'Re-enable AI Research via /admin/ai-policies or /admin/emergency.'
        : 'Disable AI Research if upstream errors recur.';
    } else if (action === 'PAUSE_WORKER_QUEUE' || action === 'RESUME_WORKER_QUEUE') {
      const paused = action === 'PAUSE_WORKER_QUEUE';
      const hb = await jobManager.setQueuePaused(paused);
      detail = `Background worker queue ${paused ? 'paused' : 'resumed'} (${hb.workerHeartbeat.status}).`;
      rollbackHint = paused ? 'Resume worker queue in /admin/jobs or /admin/emergency.' : 'Pause queue again if worker errors persist.';
    } else if (action === 'DISABLE_FEATURE_FLAG') {
      const flagRow = targetId
        ? await db.queryOne<{ id: string; flag_key: string }>(
            'SELECT id, flag_key FROM feature_flags WHERE flag_key = ? OR id = ? LIMIT 1',
            'SELECT id, flag_key FROM feature_flags WHERE flag_key = $1 OR id::text = $2 LIMIT 1',
            [targetId, targetId],
          )
        : null;
      if (!flagRow) return { ok: false, status: 404, error: 'Target feature flag not found.' };
      const out = await governance.updateFeatureFlag(actor, flagRow.id, { enabled: false, reason });
      if (!out.ok) return out;
      detail = `Feature flag "${flagRow.flag_key}" disabled under emergency controls.`;
      rollbackHint = `Re-enable "${flagRow.flag_key}" via /admin/features or rollback history.`;
    } else if (action === 'REVOKE_USER_SESSIONS') {
      if (!targetId) {
        const out = await executeEmergencyOperation(actor, 'REVOKE_OTHER_ADMIN_SESSIONS', reason);
        if (!out.ok) return out;
        detail = out.data.detail;
        rollbackHint = 'Affected administrators must sign in cleanly again.';
      } else {
        // Protect last active super_admin's current session from accidental self-lockout
        if (targetId === actor.userId) {
          return {
            ok: false,
            status: 409,
            code: 'SELF_LOCKOUT_PREVENTED',
            error: 'Use Sign Out or Admin Settings to close your own session; emergency revocation blocks Super Admin self-lockout.',
          };
        }
        const out = await revokeTargetUserSession(actor, targetId);
        if (!out.ok) return out;
        detail = `Revoked ${out.data.revokedCount} active session(s) for user ${targetId}.`;
        rollbackHint = 'Target user must re-authenticate cleanly after investigation.';
      }
    } else if (action === 'ESCALATE_INCIDENT') {
      const incOut = await observability.createIncident(
        { userId: actor.userId, email: actor.email, ipAddress: actor.ipAddress, userAgent: actor.userAgent },
        {
          title: stripControlChars(typeof input.title === 'string' ? input.title : '', 140) || `Emergency Escalation: ${reason.slice(0, 60)}`,
          description: reason,
          severity,
          source: playbookKey ? `emergency_playbook:${playbookKey}` : 'emergency_centre',
          linkedAlertIds: targetId ? [targetId] : undefined,
        },
      );
      if (!incOut.ok) return incOut;
      relatedIncidentId = incOut.data.incident.id;
      detail = `Escalated incident "${incOut.data.incident.title}" (${severity}).`;
      rollbackHint = 'Transition incident through /admin/incidents once mitigated and resolved.';
    } else if (action === 'RECORD_EVENT') {
      detail = reason;
      rollbackHint = 'Informational emergency timeline record.';
    } else {
      return { ok: false, status: 400, error: 'Unsupported emergency centre action.' };
    }

    const eventId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    await db.execute(
      `INSERT INTO emergency_events (id, event_type, severity, title, summary, playbook_key, related_incident_id, action_taken, actor_id, actor_email, rollback_hint, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `INSERT INTO emergency_events (id, event_type, severity, title, summary, playbook_key, related_incident_id, action_taken, actor_id, actor_email, rollback_hint, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz)`,
      [
        eventId,
        action,
        severity,
        stripControlChars(typeof input.title === 'string' ? input.title : '', 140) || `Emergency: ${action}`,
        `${detail} (Reason: ${reason})`,
        playbookKey,
        relatedIncidentId,
        action,
        actor.userId,
        actor.email,
        rollbackHint,
        nowIso,
      ],
    );

    await writeAuditLog({
      actor,
      action: `EMERGENCY_CENTRE_${action}`,
      resourceType: 'emergency_response',
      resourceId: relatedIncidentId || targetId || playbookKey || eventId,
      newValue: { action, severity, reason, detail },
    });

    const evtRow = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM emergency_events WHERE id = ?',
      'SELECT * FROM emergency_events WHERE id = $1',
      [eventId],
    );
    return {
      ok: true,
      status: 200,
      data: {
        detail,
        event: {
          id: String(evtRow!.id),
          eventType: String(evtRow!.event_type),
          severity: String(evtRow!.severity) as IncidentSeverity,
          title: String(evtRow!.title),
          summary: String(evtRow!.summary),
          playbookKey: evtRow!.playbook_key ? String(evtRow!.playbook_key) : null,
          relatedIncidentId: evtRow!.related_incident_id ? String(evtRow!.related_incident_id) : null,
          actionTaken: String(evtRow!.action_taken),
          actorId: evtRow!.actor_id ? String(evtRow!.actor_id) : null,
          actorEmail: String(evtRow!.actor_email),
          rollbackHint: String(evtRow!.rollback_hint ?? ''),
          createdAt: toIso(evtRow!.created_at),
        },
      },
    };
  }

  // ---- STAGE G: PLATFORM-WIDE INTELLIGENCE & DECISION SUPPORT ----
  async function getPlatformIntelligence(params: { range?: unknown; from?: unknown; to?: unknown }) {
    await ensureSeeded();
    await expireStaleAccessRecords();

    const [
      obsOverview,
      apiObs,
      aiObs,
      marketObs,
      jobsObs,
      secObs,
      alertsRes,
      incidentsRes,
      privacyQueue,
      backupsRes,
      flagsRes,
      accessGov,
      automationRes,
      cfg,
    ] = await Promise.all([
      observability.getObservabilityOverview(params),
      observability.getObservabilityApi({ ...params, limit: 10, offset: 0 }),
      observability.getObservabilityAi({ ...params, limit: 10, offset: 0 }),
      observability.getObservabilityMarketData(10),
      observability.getObservabilityJobs(),
      observability.getObservabilitySecurity({ ...params, limit: 20, offset: 0 }),
      observability.listAlerts({ limit: 50, offset: 0 }),
      observability.listIncidents({ limit: 50, offset: 0 }),
      governance.listAdminPrivacyQueue(),
      governance.listBackupsOverview(),
      governance.listFeatureFlagsOverview(),
      listAccessGovernanceOverview(),
      listAutomationOverview(),
      runtimeConfigManager.getConfig(),
    ]);

    const overduePrivacyCount =
      privacyQueue.exportRequests.filter((e) => e.status === 'PENDING' || e.status === 'APPROVED').length +
      privacyQueue.deletionRequests.filter((d) => d.status === 'PENDING_REVIEW' || d.status === 'SCHEDULED').length;
    const unverifiedBackupsCount = backupsRes.backups.filter((b) => b.status === 'CREATED').length;
    const pendingAccessReviewsCount = accessGov.accounts.filter((a) => !a.latestReview || a.latestReview.reviewStatus === 'PENDING').length;

    const lastSyncMs = cfg.market_data_config.lastSyncAt ? Date.parse(cfg.market_data_config.lastSyncAt) : 0;
    const staleLimitMs = (cfg.alert_thresholds?.marketSyncStaleMinutes ?? 1440) * 60_000;
    const marketSyncStale = !lastSyncMs || Date.now() - lastSyncMs > staleLimitMs;

    const recommendations = deriveOperationalRecommendations({
      apiRequestCount: apiObs.summary.totalVolume,
      apiErrorRatePct: apiObs.summary.errorRatePct,
      apiP95LatencyMs: apiObs.summary.p95LatencyMs,
      aiTotalRequests: aiObs.summary.totalRequests,
      aiFailureCount: aiObs.summary.failedCount + aiObs.summary.fallbackCount,
      marketSyncStale,
      marketLastSyncAt: cfg.market_data_config.lastSyncAt,
      failedJobsCount: jobsObs.jobs.filter((j) => j.status === 'FAILED').length,
      overduePrivacyCount,
      unverifiedBackupsCount,
      pendingAccessReviewsCount,
      openCriticalAlertsCount: alertsRes.alerts.filter(
        (a) => a.severity === 'CRITICAL' && (a.status === 'OPEN' || a.status === 'ACKNOWLEDGED'),
      ).length,
      openIncidentsCount: incidentsRes.incidents.filter((i) => i.status !== 'RESOLVED').length,
    });

    return {
      window: {
        range: obsOverview.range,
        from: obsOverview.from,
        to: obsOverview.to,
      },
      categories: {
        userActivity: {
          factType: 'MEASURED',
          totalUsers: obsOverview.userMetrics.totalUsers,
          activeUsersInWindow: obsOverview.userMetrics.activeUsers,
          newRegistrationsDeltaPct: obsOverview.userMetrics.newRegistrationsDeltaPct,
        },
        platformAvailability: {
          factType: 'MEASURED',
          healthyServices: obsOverview.serviceHealth.filter((s) => s.status === 'HEALTHY').length,
          totalServices: obsOverview.serviceHealth.length,
        },
        apiPerformance: {
          factType: 'MEASURED',
          requestCount: apiObs.summary.totalVolume,
          errorRatePct: apiObs.summary.errorRatePct,
          p95LatencyMs: apiObs.summary.p95LatencyMs,
          requestDeltaPct: obsOverview.apiMetrics.requestVolumeDeltaPct,
        },
        aiProviderHealth: {
          factType: 'MEASURED',
          totalRequests: aiObs.summary.totalRequests,
          successCount: aiObs.summary.successCount,
          fallbackCount: aiObs.summary.fallbackCount,
          failedCount: aiObs.summary.failedCount,
          avgLatencyMs: aiObs.summary.avgLatencyMs,
        },
        marketDataFreshness: {
          factType: 'MEASURED',
          classification: marketObs.summary.classification,
          lastSyncAt: cfg.market_data_config.lastSyncAt,
          stale: marketSyncStale,
        },
        backgroundJobReliability: {
          factType: 'MEASURED',
          totalJobs: jobsObs.jobs.length,
          failedJobs: jobsObs.jobs.filter((j) => j.status === 'FAILED').length,
          workerStatus: jobsObs.workerHeartbeat.status,
        },
        securityActivity: {
          factType: 'MEASURED',
          eventsCount: secObs.events.length,
          failedLoginsInWindow: obsOverview.userMetrics.failedLogins,
        },
        governanceWorkload: {
          factType: 'MEASURED',
          pendingApprovals: accessGov.requests.filter((r) => r.status === 'PENDING').length,
          pendingAccessReviews: pendingAccessReviewsCount,
        },
        privacyBacklog: {
          factType: 'MEASURED',
          pendingExports: privacyQueue.exportRequests.filter((e) => e.status === 'PENDING' || e.status === 'APPROVED').length,
          pendingDeletions: privacyQueue.deletionRequests.filter((d) => d.status === 'PENDING_REVIEW' || d.status === 'SCHEDULED').length,
        },
        backupReadiness: {
          factType: 'MEASURED',
          fullDatabaseBackupSupported: backupsRes.capabilities.fullDatabaseBackupSupported,
          verifiedBackups: backupsRes.backups.filter((b) => b.status === 'VERIFIED').length,
          unverifiedBackups: unverifiedBackupsCount,
        },
        featureFlagDistribution: {
          factType: 'MEASURED',
          totalFlags: flagsRes.flags.length,
          enabledFlags: flagsRes.flags.filter((f) => f.enabled).length,
          killSwitchesActive: flagsRes.flags.filter((f) => f.isKillSwitch && f.enabled).length,
        },
        incidentTrends: {
          factType: 'MEASURED',
          openIncidents: incidentsRes.incidents.filter((i) => i.status !== 'RESOLVED').length,
          resolvedIncidents: incidentsRes.incidents.filter((i) => i.status === 'RESOLVED').length,
        },
        automationPerformance: {
          factType: 'MEASURED',
          enabledWorkflows: automationRes.workflows.filter((w) => w.enabled && !w.isPaused).length,
          succeededRuns: automationRes.monitoring.successfulExecutions,
          failedRuns: automationRes.monitoring.failedExecutions,
          avgDurationMs: automationRes.monitoring.avgDurationMs,
        },
      },
      recommendations,
    };
  }

  // ---- STAGE G: GLOBAL ADMIN ACTION CENTRE & PERMISSION-FILTERED GLOBAL SEARCH ----
  async function getActionCentreSummary(actorRole: UserRole) {
    await ensureSeeded();
    await expireStaleAccessRecords();
    const perms = new Set<string>(resolveUserPermissions(actorRole));

    const [approvals, alerts, incidents, privacyQueue, jobsState] = await Promise.all([
      perms.has(PERMISSIONS.ADMIN_ACCESS_REVIEW_READ) || perms.has(PERMISSIONS.ADMIN_PRIVILEGED_ACTIONS_APPROVE)
        ? db.queryAll<Record<string, unknown>>(
            "SELECT * FROM privileged_action_requests WHERE status = 'PENDING' ORDER BY created_at DESC LIMIT 10",
            "SELECT * FROM privileged_action_requests WHERE status = 'PENDING' ORDER BY created_at DESC LIMIT 10",
          )
        : Promise.resolve([]),
      perms.has(PERMISSIONS.ADMIN_ALERTS_READ)
        ? observability.listAlerts({ status: 'OPEN', limit: 10, offset: 0 })
        : Promise.resolve({ alerts: [] }),
      perms.has(PERMISSIONS.ADMIN_INCIDENTS_READ)
        ? observability.listIncidents({ limit: 10, offset: 0 })
        : Promise.resolve({ incidents: [] }),
      perms.has(PERMISSIONS.ADMIN_PRIVACY_READ)
        ? governance.listAdminPrivacyQueue()
        : Promise.resolve({ exportRequests: [], deletionRequests: [] }),
      perms.has(PERMISSIONS.ADMIN_JOBS_READ)
        ? jobManager.listJobs()
        : Promise.resolve({ jobs: [] }),
    ]);

    const openIncidents = incidents.incidents.filter((i) => i.status !== 'RESOLVED').slice(0, 8);
    const pendingPrivacy = [
      ...privacyQueue.exportRequests.filter((e) => e.status === 'PENDING' || e.status === 'APPROVED').map((e) => ({
        id: e.id,
        type: 'DATA_EXPORT' as const,
        email: e.requestedByEmail,
        status: e.status,
        href: '/admin/privacy',
      })),
      ...privacyQueue.deletionRequests.filter((d) => d.status === 'PENDING_REVIEW' || d.status === 'SCHEDULED').map((d) => ({
        id: d.id,
        type: 'ACCOUNT_DELETION' as const,
        email: d.requestedByEmail,
        status: d.status,
        href: '/admin/privacy',
      })),
    ].slice(0, 8);

    const quickModules = [
      { label: 'Super Control', href: '/admin/super-control', perm: PERMISSIONS.ADMIN_SUPER_CONTROL_READ },
      { label: 'Automation Engine', href: '/admin/automation', perm: PERMISSIONS.ADMIN_AUTOMATION_READ },
      { label: 'Access Governance', href: '/admin/access-reviews', perm: PERMISSIONS.ADMIN_ACCESS_REVIEW_READ },
      { label: 'AI Operations Policies', href: '/admin/ai-policies', perm: PERMISSIONS.ADMIN_AI_POLICY_READ },
      { label: 'Emergency Centre', href: '/admin/emergency', perm: PERMISSIONS.ADMIN_EMERGENCY_READ },
      { label: 'Platform Intelligence', href: '/admin/intelligence', perm: PERMISSIONS.ADMIN_INTELLIGENCE_READ },
      { label: 'Privacy Centre', href: '/admin/privacy', perm: PERMISSIONS.ADMIN_PRIVACY_READ },
      { label: 'Backups & DR', href: '/admin/backups', perm: PERMISSIONS.ADMIN_BACKUP_READ },
      { label: 'Feature Flags', href: '/admin/features', perm: PERMISSIONS.ADMIN_FEATURES_READ },
      { label: 'Releases & Maint.', href: '/admin/releases', perm: PERMISSIONS.ADMIN_RELEASES_READ },
      { label: 'Users', href: '/admin/users', perm: PERMISSIONS.ADMIN_USERS_READ },
    ].filter((m) => perms.has(m.perm));

    return {
      pendingApprovals: approvals.map((r) => ({
        id: String(r.id),
        actionType: String(r.action_type),
        targetResourceId: String(r.target_resource_id),
        requestedByEmail: String(r.requested_by_email),
        createdAt: toIso(r.created_at),
        href: '/admin/access-reviews',
      })),
      activeAlerts: alerts.alerts.slice(0, 8).map((a) => ({
        id: a.id,
        title: a.title,
        severity: a.severity,
        category: a.category,
        href: '/admin/alerts',
      })),
      assignedOrOpenIncidents: openIncidents.map((i) => ({
        id: i.id,
        title: i.title,
        severity: i.severity,
        status: i.status,
        ownerEmail: i.ownerEmail,
        href: '/admin/incidents',
      })),
      pendingGovernanceTasks: pendingPrivacy,
      failedJobs: jobsState.jobs.filter((j) => j.status === 'FAILED').map((j) => ({
        id: j.id,
        name: j.name,
        href: '/admin/jobs',
      })),
      quickModules,
    };
  }

  async function globalSearch(
    actorRole: UserRole,
    rawQuery: unknown,
    limit = 20,
    offset = 0,
  ) {
    await ensureSeeded();
    const q = sanitizeAdminSearchQuery(rawQuery);
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
    const safeOffset = Math.max(0, Number(offset) || 0);
    if (q.length < 2) {
      return { query: q, results: [], total: 0, limit: safeLimit, offset: safeOffset };
    }

    const perms = new Set<string>(resolveUserPermissions(actorRole));
    const likeTerm = `%${q.toLowerCase()}%`;
    const items: GlobalSearchResultItemDto[] = [];

    if (perms.has(PERMISSIONS.ADMIN_USERS_READ)) {
      const rows = await db.queryAll<Record<string, unknown>>(
        `SELECT id, full_name, email, role, account_status, created_at FROM users
         WHERE LOWER(email) LIKE ? OR LOWER(full_name) LIKE ? OR LOWER(id) LIKE ?
         ORDER BY created_at DESC LIMIT 10`,
        `SELECT id, full_name, email, role, account_status, created_at FROM users
         WHERE LOWER(email) LIKE $1 OR LOWER(full_name) LIKE $2 OR CAST(id AS TEXT) LIKE $3
         ORDER BY created_at DESC LIMIT 10`,
        [likeTerm, likeTerm, likeTerm],
      );
      for (const r of rows) {
        items.push({
          id: String(r.id),
          entityType: 'user',
          title: String(r.email),
          subtitle: `${String(r.full_name)} · role=${String(r.role)}`,
          status: String(r.account_status),
          href: `/admin/users/${String(r.id)}`,
          timestamp: toIso(r.created_at),
        });
      }
    }

    if (perms.has(PERMISSIONS.ADMIN_INCIDENTS_READ)) {
      const rows = await db.queryAll<Record<string, unknown>>(
        `SELECT id, title, severity, status, updated_at FROM admin_incidents
         WHERE LOWER(title) LIKE ? OR LOWER(description) LIKE ?
         ORDER BY updated_at DESC LIMIT 8`,
        `SELECT id, title, severity, status, updated_at FROM admin_incidents
         WHERE LOWER(title) LIKE $1 OR LOWER(description) LIKE $2
         ORDER BY updated_at DESC LIMIT 8`,
        [likeTerm, likeTerm],
      );
      for (const r of rows) {
        items.push({
          id: String(r.id),
          entityType: 'incident',
          title: String(r.title),
          subtitle: `Severity: ${String(r.severity)}`,
          status: String(r.status),
          href: '/admin/incidents',
          timestamp: toIso(r.updated_at),
        });
      }
    }

    if (perms.has(PERMISSIONS.ADMIN_ALERTS_READ)) {
      const rows = await db.queryAll<Record<string, unknown>>(
        `SELECT id, title, category, severity, status, last_detected_at FROM operational_alerts
         WHERE LOWER(title) LIKE ? OR LOWER(category) LIKE ?
         ORDER BY last_detected_at DESC LIMIT 8`,
        `SELECT id, title, category, severity, status, last_detected_at FROM operational_alerts
         WHERE LOWER(title) LIKE $1 OR LOWER(category) LIKE $2
         ORDER BY last_detected_at DESC LIMIT 8`,
        [likeTerm, likeTerm],
      );
      for (const r of rows) {
        items.push({
          id: String(r.id),
          entityType: 'alert',
          title: String(r.title),
          subtitle: `${String(r.category)} · ${String(r.severity)}`,
          status: String(r.status),
          href: '/admin/alerts',
          timestamp: toIso(r.last_detected_at),
        });
      }
    }

    if (perms.has(PERMISSIONS.ADMIN_JOBS_READ)) {
      const rows = await db.queryAll<Record<string, unknown>>(
        `SELECT id, name, job_type, status, updated_at FROM background_jobs
         WHERE LOWER(name) LIKE ? OR LOWER(id) LIKE ? OR LOWER(job_type) LIKE ?
         LIMIT 8`,
        `SELECT id, name, job_type, status, updated_at FROM background_jobs
         WHERE LOWER(name) LIKE $1 OR LOWER(id) LIKE $2 OR LOWER(job_type) LIKE $3
         LIMIT 8`,
        [likeTerm, likeTerm, likeTerm],
      );
      for (const r of rows) {
        items.push({
          id: String(r.id),
          entityType: 'job',
          title: String(r.name),
          subtitle: `${String(r.job_type)} (${String(r.id)})`,
          status: String(r.status),
          href: '/admin/jobs',
          timestamp: toIso(r.updated_at),
        });
      }
    }

    if (perms.has(PERMISSIONS.ADMIN_FEATURES_READ)) {
      const rows = await db.queryAll<Record<string, unknown>>(
        `SELECT id, flag_key, name, enabled, updated_at FROM feature_flags
         WHERE LOWER(flag_key) LIKE ? OR LOWER(name) LIKE ?
         LIMIT 8`,
        `SELECT id, flag_key, name, enabled, updated_at FROM feature_flags
         WHERE LOWER(flag_key) LIKE $1 OR LOWER(name) LIKE $2
         LIMIT 8`,
        [likeTerm, likeTerm],
      );
      for (const r of rows) {
        items.push({
          id: String(r.id),
          entityType: 'feature_flag',
          title: String(r.name),
          subtitle: `key: ${String(r.flag_key)}`,
          status: toBoolField(r.enabled) ? 'ENABLED' : 'DISABLED',
          href: '/admin/features',
          timestamp: toIso(r.updated_at),
        });
      }
    }

    if (perms.has(PERMISSIONS.ADMIN_RELEASES_READ)) {
      const rows = await db.queryAll<Record<string, unknown>>(
        `SELECT id, version, summary, status, deployed_at FROM release_records
         WHERE LOWER(version) LIKE ? OR LOWER(summary) LIKE ?
         ORDER BY deployed_at DESC LIMIT 8`,
        `SELECT id, version, summary, status, deployed_at FROM release_records
         WHERE LOWER(version) LIKE $1 OR LOWER(summary) LIKE $2
         ORDER BY deployed_at DESC LIMIT 8`,
        [likeTerm, likeTerm],
      );
      for (const r of rows) {
        items.push({
          id: String(r.id),
          entityType: 'release',
          title: `v${String(r.version)}`,
          subtitle: stripControlChars(String(r.summary), 90),
          status: String(r.status),
          href: '/admin/releases',
          timestamp: toIso(r.deployed_at),
        });
      }
    }

    if (perms.has(PERMISSIONS.ADMIN_AUDIT_READ)) {
      const rows = await db.queryAll<Record<string, unknown>>(
        `SELECT id, action, resource_type, admin_email, result, created_at FROM admin_audit_logs
         WHERE LOWER(action) LIKE ? OR LOWER(admin_email) LIKE ? OR LOWER(resource_type) LIKE ?
         ORDER BY created_at DESC LIMIT 8`,
        `SELECT id, action, resource_type, admin_email, result, created_at FROM admin_audit_logs
         WHERE LOWER(action) LIKE $1 OR LOWER(admin_email) LIKE $2 OR LOWER(resource_type) LIKE $3
         ORDER BY created_at DESC LIMIT 8`,
        [likeTerm, likeTerm, likeTerm],
      );
      for (const r of rows) {
        items.push({
          id: String(r.id),
          entityType: 'audit_log',
          title: String(r.action),
          subtitle: `${String(r.admin_email)} · ${String(r.resource_type)}`,
          status: String(r.result),
          href: '/admin/audit-logs',
          timestamp: toIso(r.created_at),
        });
      }
    }

    if (perms.has(PERMISSIONS.ADMIN_PRIVACY_READ)) {
      const rows = await db.queryAll<Record<string, unknown>>(
        `SELECT id, requested_by_email, status, created_at FROM data_export_requests
         WHERE LOWER(requested_by_email) LIKE ? OR LOWER(status) LIKE ?
         ORDER BY created_at DESC LIMIT 6`,
        `SELECT id, requested_by_email, status, created_at FROM data_export_requests
         WHERE LOWER(requested_by_email) LIKE $1 OR LOWER(status) LIKE $2
         ORDER BY created_at DESC LIMIT 6`,
        [likeTerm, likeTerm],
      );
      for (const r of rows) {
        items.push({
          id: String(r.id),
          entityType: 'privacy_request',
          title: `Export: ${String(r.requested_by_email)}`,
          subtitle: 'Personal Data Export Request',
          status: String(r.status),
          href: '/admin/privacy',
          timestamp: toIso(r.created_at),
        });
      }
    }

    if (perms.has(PERMISSIONS.ADMIN_BACKUP_READ)) {
      const rows = await db.queryAll<Record<string, unknown>>(
        `SELECT id, backup_type, status, triggered_by_email, created_at FROM backup_records
         WHERE LOWER(backup_type) LIKE ? OR LOWER(status) LIKE ? OR LOWER(triggered_by_email) LIKE ?
         ORDER BY created_at DESC LIMIT 6`,
        `SELECT id, backup_type, status, triggered_by_email, created_at FROM backup_records
         WHERE LOWER(backup_type) LIKE $1 OR LOWER(status) LIKE $2 OR LOWER(triggered_by_email) LIKE $3
         ORDER BY created_at DESC LIMIT 6`,
        [likeTerm, likeTerm, likeTerm],
      );
      for (const r of rows) {
        items.push({
          id: String(r.id),
          entityType: 'backup_record',
          title: String(r.backup_type),
          subtitle: `Triggered by ${String(r.triggered_by_email)}`,
          status: String(r.status),
          href: '/admin/backups',
          timestamp: toIso(r.created_at),
        });
      }
    }

    if (perms.has(PERMISSIONS.ADMIN_AUTOMATION_READ)) {
      const rows = await db.queryAll<Record<string, unknown>>(
        `SELECT id, workflow_key, name, action_type, last_status, updated_at FROM admin_automation_workflows
         WHERE LOWER(workflow_key) LIKE ? OR LOWER(name) LIKE ? OR LOWER(action_type) LIKE ?
         LIMIT 8`,
        `SELECT id, workflow_key, name, action_type, last_status, updated_at FROM admin_automation_workflows
         WHERE LOWER(workflow_key) LIKE $1 OR LOWER(name) LIKE $2 OR LOWER(action_type) LIKE $3
         LIMIT 8`,
        [likeTerm, likeTerm, likeTerm],
      );
      for (const r of rows) {
        items.push({
          id: String(r.id),
          entityType: 'automation_workflow',
          title: String(r.name),
          subtitle: `${String(r.workflow_key)} · ${String(r.action_type)}`,
          status: String(r.last_status ?? 'IDLE'),
          href: '/admin/automation',
          timestamp: toIso(r.updated_at),
        });
      }
    }

    items.sort((a, b) => Date.parse(b.timestamp || '0') - Date.parse(a.timestamp || '0'));
    const total = items.length;
    const paged = items.slice(safeOffset, safeOffset + safeLimit);
    return { query: q, results: paged, total, limit: safeLimit, offset: safeOffset };
  }

  return {
    ensureSeeded,
    getSuperControlOverview,
    listAutomationOverview,
    createWorkflow,
    updateWorkflowState,
    setAutomationKillSwitch,
    executeWorkflow,
    listAccessGovernanceOverview,
    submitAccessReview,
    createPrivilegedActionRequest,
    decidePrivilegedActionRequest,
    executePrivilegedActionRequest,
    grantEmergencyAccess,
    revokeOrReviewEmergencyGrant,
    listAiPolicyOverview,
    createAiPolicyVersion,
    activateOrRollbackAiPolicy,
    executeAiEmergencyControl,
    getEmergencyOverview,
    executeEmergencyCentreAction,
    getPlatformIntelligence,
    getActionCentreSummary,
    globalSearch,
  };
}

export type SuperOpsService = ReturnType<typeof createSuperOpsService>;
