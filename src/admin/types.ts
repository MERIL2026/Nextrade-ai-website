import type { AccountStatus, UserRole } from '../auth/db';
import type { Permission } from '../auth/rbac';
import type { MarketRegion, TimeframeKey } from '../lib/marketData';

export type AdminRangeKey = '24h' | '7d' | '30d' | 'all';
export type ObservabilityRangeKey = '15m' | '1h' | '24h' | '7d' | '30d' | 'all' | 'custom';

export interface MaintenanceModeConfig {
  enabled: boolean;
  message: string;
  allowAdminRecovery: boolean;
}

export interface FeatureFlagsConfig {
  aiResearchEnabled: boolean;
  paperTradingEnabled: boolean;
  publicRegistrationEnabled: boolean;
  announcementsBannerEnabled: boolean;
}

export interface AiRuntimeConfig {
  activeProvider: 'gemini';
  activeModel: string;
  fallbackModel: string;
  fallbackOnError: boolean;
  maxQueryChars: number;
  aiEnabled: boolean;
}

export interface MarketDataRuntimeConfig {
  primaryProvider: 'yahoo-finance' | 'coingecko' | 'finnhub' | 'alpha-vantage' | 'twelve-data';
  fallbackProvider: 'market-cache' | 'none';
  dataClassification: 'SIMULATED' | 'DELAYED' | 'LIVE' | 'END_OF_DAY' | 'CACHED' | 'UNAVAILABLE';
  enabledRegions: MarketRegion[];
  disabledSymbols: string[];
  lastSyncAt: string | null;
  lastSyncStatus: 'IDLE' | 'SUCCEEDED' | 'FAILED';
  lastSyncNote: string;
}

export interface RateLimitsRuntimeConfig {
  apiResearchMaxPerMin: number;
  workspaceMutationMaxPerMin: number;
  paperOrderMaxPerMin: number;
  contactMaxPer15Min: number;
}

export interface WorkspaceDefaultsConfig {
  defaultRegion: 'ALL' | MarketRegion;
  defaultCurrency: 'USD' | 'INR';
  defaultTimeframe: TimeframeKey;
}

export interface ObservabilityThresholdsConfig {
  apiErrorRateCriticalPct: number;
  apiP95LatencyWarningMs: number;
  aiFailureRateWarningPct: number;
  failedLoginsBurstThreshold: number;
  marketSyncStaleMinutes: number;
  stuckJobMinutes: number;
  alertCooldownMinutes: number;
  retentionDays: number;
}

export interface GovernancePoliciesConfig {
  platformDisplayName: string;
  environmentLabel: string;
  requireEmailVerificationForLogin: boolean;
  sessionTtlHours: number;
  rememberMeDays: number;
  exportLinkExpiryHours: number;
  deletionGracePeriodDays: number;
  telemetryRetentionDays: number;
  auditRetentionDays: number;
  securityDigestEnabled: boolean;
  alertEscalationEmailEnabled: boolean;
}

export interface PlatformConfigBundle {
  maintenance_mode: MaintenanceModeConfig;
  feature_flags: FeatureFlagsConfig;
  ai_config: AiRuntimeConfig;
  market_data_config: MarketDataRuntimeConfig;
  rate_limits: RateLimitsRuntimeConfig;
  workspace_defaults: WorkspaceDefaultsConfig;
  alert_thresholds: ObservabilityThresholdsConfig;
  governance_policies: GovernancePoliciesConfig;
}

export const DEFAULT_PLATFORM_CONFIG: PlatformConfigBundle = {
  maintenance_mode: {
    enabled: false,
    message:
      'Nextrade AI is undergoing scheduled platform maintenance. Administrative recovery remains active.',
    allowAdminRecovery: true,
  },
  feature_flags: {
    aiResearchEnabled: true,
    paperTradingEnabled: true,
    publicRegistrationEnabled: true,
    announcementsBannerEnabled: true,
  },
  ai_config: {
    activeProvider: 'gemini',
    activeModel: 'gemini-4-hydrogen',
    fallbackModel: 'none',
    fallbackOnError: false,
    maxQueryChars: 1000,
    aiEnabled: true,
  },
  market_data_config: {
    primaryProvider: 'yahoo-finance',
    fallbackProvider: 'market-cache',
    dataClassification: 'DELAYED',
    enabledRegions: ['IN', 'US', 'GLOBAL'],
    disabledSymbols: [],
    lastSyncAt: null,
    lastSyncStatus: 'IDLE',
    lastSyncNote: 'Real market data adapters active (Yahoo Finance, CoinGecko, Frankfurter ECB FX).',
  },
  rate_limits: {
    apiResearchMaxPerMin: 25,
    workspaceMutationMaxPerMin: 120,
    paperOrderMaxPerMin: 40,
    contactMaxPer15Min: 5,
  },
  workspace_defaults: {
    defaultRegion: 'ALL',
    defaultCurrency: 'USD',
    defaultTimeframe: '1M',
  },
  alert_thresholds: {
    apiErrorRateCriticalPct: 15,
    apiP95LatencyWarningMs: 1200,
    aiFailureRateWarningPct: 25,
    failedLoginsBurstThreshold: 5,
    marketSyncStaleMinutes: 1440,
    stuckJobMinutes: 15,
    alertCooldownMinutes: 30,
    retentionDays: 30,
  },
  governance_policies: {
    platformDisplayName: 'Nextrade AI',
    environmentLabel: 'production',
    requireEmailVerificationForLogin: true,
    sessionTtlHours: 24,
    rememberMeDays: 14,
    exportLinkExpiryHours: 24,
    deletionGracePeriodDays: 7,
    telemetryRetentionDays: 30,
    auditRetentionDays: 365,
    securityDigestEnabled: true,
    alertEscalationEmailEnabled: false,
  },
};

export const APPROVED_GEMINI_MODELS = [
  'gemini-4-hydrogen',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
] as const;

export type IncidentSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type IncidentStatus =
  | 'OPEN'
  | 'INVESTIGATING'
  | 'IDENTIFIED'
  | 'MONITORING'
  | 'MITIGATED'
  | 'RESOLVED';

export interface IncidentEventDto {
  id: string;
  incidentId: string;
  eventType:
    | 'CREATED'
    | 'STATUS_CHANGED'
    | 'OWNER_ASSIGNED'
    | 'NOTE_ADDED'
    | 'ALERT_LINKED'
    | 'TELEMETRY_LINKED';
  previousStatus: string | null;
  newStatus: string | null;
  actorId: string | null;
  actorEmail: string;
  note: string;
  linkedAlertId: string | null;
  linkedEventRef: string | null;
  createdAt: string;
}

export interface AdminIncidentDto {
  id: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  source: string;
  assignedAdminId: string | null;
  ownerEmail: string;
  linkedAlertIds: string[];
  linkedEventRefs: string[];
  resolutionNotes: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  timeline?: IncidentEventDto[];
}

export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SUPPRESSED';
export type AlertCategory = 'API' | 'AI' | 'SECURITY' | 'MARKET_DATA' | 'BACKGROUND_JOB' | 'SYSTEM';

export interface OperationalAlertDto {
  id: string;
  fingerprint: string;
  category: AlertCategory;
  title: string;
  description: string;
  severity: AlertSeverity;
  status: AlertStatus;
  source: string;
  serviceId: string | null;
  metricValue: number | null;
  thresholdValue: number | null;
  occurrenceCount: number;
  eventRefs: string[];
  internalNotes: string;
  acknowledgedBy: string | null;
  resolvedBy: string | null;
  firstDetectedAt: string;
  lastDetectedAt: string;
  cooldownUntil: string | null;
  resolvedAt: string | null;
  updatedAt: string;
}

export interface AlertHistoryDto {
  id: string;
  alertId: string;
  previousStatus: string | null;
  newStatus: string;
  actorId: string | null;
  actorEmail: string;
  note: string;
  createdAt: string;
}

export type SecurityEventSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type AnnouncementCategory = 'MAINTENANCE' | 'UPDATE' | 'SECURITY' | 'MARKET_NOTICE';
export type AnnouncementSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AnnouncementStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'UNPUBLISHED';

export interface AdminAnnouncementDto {
  id: string;
  title: string;
  content: string;
  category: AnnouncementCategory;
  severity: AnnouncementSeverity;
  status: AnnouncementStatus;
  createdBy: string | null;
  scheduledFor: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SupportTicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type SupportTicketPriority = 'LOW' | 'NORMAL' | 'HIGH';

export interface SupportTicketDto {
  id: string;
  ticketId: string;
  userId: string | null;
  name: string;
  email: string;
  topic: string;
  reference: string;
  message: string;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  assignedAdminId: string | null;
  resolutionNotes: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface AdminAuditLogDto {
  id: string;
  adminId: string | null;
  adminEmail: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  previousValueRedacted: string | null;
  newValueRedacted: string | null;
  ipAddress: string;
  userAgent: string;
  result: 'SUCCESS' | 'DENIED' | 'ERROR';
  correlationId: string;
  createdAt: string;
}

export interface AdminUserSummaryDto {
  id: string;
  fullName: string;
  email: string;
  accountStatus: AccountStatus;
  emailVerified: boolean;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  lastActivityAt: string | null;
  activeSessionCount: number;
}

export interface AdminUserDetailDto {
  user: AdminUserSummaryDto;
  permissions: Permission[];
  sessions: Array<{
    id: string;
    userAgent: string;
    ipAddress: string;
    rememberMe: boolean;
    createdAt: string;
    lastActiveAt: string;
    expiresAt: string;
    revokedAt: string | null;
  }>;
  workspaceSummary: {
    portfolioCount: number;
    watchlistCount: number;
    ordersCount: number;
    researchCount: number;
    savedReportsCount: number;
  };
  securityEvents: Array<{
    id: string;
    eventType: string;
    ipAddress: string;
    userAgent: string;
    detail: string;
    createdAt: string;
  }>;
  roleAssignments: Array<{
    id: string;
    previousRole: string;
    assignedRole: string;
    assignedBy: string | null;
    reason: string;
    createdAt: string;
  }>;
}

export interface AiPromptVersionDto {
  id: string;
  templateKey: string;
  versionNumber: number;
  title: string;
  systemPrompt: string;
  userPromptTemplate: string;
  modelTarget: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  notes: string;
  createdBy: string | null;
  activatedAt: string | null;
  createdAt: string;
}

export interface BackgroundJobDto {
  id: string;
  name: string;
  jobType: string;
  status: 'IDLE' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  scheduleLabel: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  retryCount: number;
  isPaused: boolean;
  isStuck?: boolean;
  updatedAt: string;
}

export interface BackgroundJobRunDto {
  id: string;
  jobId: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  triggeredBy: string | null;
  queuedAt: string | null;
  waitMs: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  summary: string;
  errorMessage: string | null;
}

export interface WorkerHeartbeatDto {
  workerId: string;
  status: 'HEALTHY' | 'PAUSED' | 'DEGRADED' | 'STOPPED';
  queuePaused: boolean;
  activeJobId: string | null;
  processedCount: number;
  failedCount: number;
  lastHeartbeatAt: string;
  updatedAt: string;
}

export interface MarketDataHealthDto {
  id: string;
  providerId: string;
  providerName: string;
  status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
  classification: 'LIVE' | 'DELAYED' | 'SIMULATED' | 'CACHE' | 'UNAVAILABLE';
  symbolsProcessed: number;
  failureCount: number;
  validationFailures: number;
  latencyMs: number | null;
  detail: string;
  checkedAt: string;
}

export interface TimeSeriesPoint {
  bucket: string;
  count: number;
  errors?: number;
}

export interface ServiceHealthItem {
  id: string;
  name: string;
  category: 'Core' | 'Database' | 'AI' | 'Market Data' | 'Messaging' | 'Jobs';
  status: 'HEALTHY' | 'DEGRADED' | 'NOT_CONFIGURED' | 'UNAVAILABLE';
  detail: string;
  latencyMs: number | null;
  checkedAt: string;
}

// ---- PHASE 5 TYPES ----

export type UserLifecycleState =
  | 'active'
  | 'suspended'
  | 'pending_verification'
  | 'deletion_requested'
  | 'deletion_scheduled'
  | 'deleted_anonymized';

export interface UserLifecycleEventDto {
  id: string;
  userId: string;
  previousState: string | null;
  newState: string;
  actorId: string | null;
  actorEmail: string;
  reason: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UserAdminNoteDto {
  id: string;
  userId: string;
  authorId: string | null;
  authorEmail: string;
  note: string;
  createdAt: string;
}

export interface AdminUserLifecycleDetailDto {
  userId: string;
  lifecycleState: UserLifecycleState;
  reason: string;
  deletionRequestedAt: string | null;
  deletionScheduledFor: string | null;
  anonymizedAt: string | null;
  updatedBy: string | null;
  updatedAt: string;
  events: UserLifecycleEventDto[];
  notes: UserAdminNoteDto[];
}

export type DataExportStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'PROCESSING'
  | 'READY'
  | 'REJECTED'
  | 'EXPIRED'
  | 'FAILED';

export interface DataExportRequestDto {
  id: string;
  userId: string;
  userEmail?: string;
  requestedByUserId: string | null;
  requestedByEmail: string;
  status: DataExportStatus;
  format: 'json';
  expiresAt: string | null;
  artifactChecksumSha256: string | null;
  byteSize: number | null;
  decisionNote: string;
  decidedBy: string | null;
  decidedAt: string | null;
  downloadAvailable: boolean;
  downloadSig?: string;
  downloadUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export type DataDeletionStatus =
  | 'PENDING_REVIEW'
  | 'SCHEDULED'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'REJECTED';

export interface DataDeletionRequestDto {
  id: string;
  userId: string;
  userEmail?: string;
  requestedByUserId: string | null;
  requestedByEmail: string;
  status: DataDeletionStatus;
  reason: string;
  scheduledFor: string | null;
  gracePeriodEndsAt: string | null;
  decisionNote: string;
  decidedBy: string | null;
  decidedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type BackupType = 'SQLITE_SNAPSHOT' | 'CONFIG_SNAPSHOT' | 'FULL_DATABASE_UNAVAILABLE';
export type BackupStatus =
  | 'CREATED'
  | 'VERIFIED'
  | 'FAILED'
  | 'NOT_CONFIGURED'
  | 'SCHEDULED'
  | 'RESTORED';

export interface BackupRecordDto {
  id: string;
  backupType: BackupType;
  environment: string;
  dialect: string;
  status: BackupStatus;
  storageLocation: string;
  checksumSha256: string | null;
  byteSize: number | null;
  verifiedAt: string | null;
  verificationDetail: string;
  failureReason: string | null;
  triggeredBy: string | null;
  triggeredByEmail: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface BackupVerificationEventDto {
  id: string;
  backupId: string;
  action: 'CREATE' | 'VERIFY' | 'RESTORE_ATTEMPT' | 'RESTORE_COMPLETED';
  status: 'SUCCESS' | 'FAILED' | 'NOT_CONFIGURED';
  actorId: string | null;
  actorEmail: string;
  detail: string;
  createdAt: string;
}

export type FeatureEnvScope = 'all' | 'production' | 'development' | 'staging';

export interface FeatureFlagDto {
  id: string;
  flagKey: string;
  name: string;
  description: string;
  enabled: boolean;
  environmentScope: FeatureEnvScope;
  rolloutPercentage: number;
  targetRoles: UserRole[];
  isKillSwitch: boolean;
  clientExposed: boolean;
  startsAt: string | null;
  endsAt: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeatureFlagHistoryDto {
  id: string;
  flagId: string;
  flagKey: string;
  previousSnapshot: Record<string, unknown> | null;
  newSnapshot: Record<string, unknown>;
  actorId: string | null;
  actorEmail: string;
  reason: string;
  createdAt: string;
}

export interface ReleaseRecordDto {
  id: string;
  version: string;
  releaseType: 'RUNTIME_BASELINE' | 'MANUAL' | 'CONFIG_ROLLOUT';
  environment: string;
  status: 'ACTIVE' | 'COMPLETED' | 'ROLLED_BACK' | 'SUPERSEDED';
  summary: string;
  commitRef: string;
  notes: string;
  deployedBy: string | null;
  deployedByEmail: string;
  deployedAt: string;
  createdAt: string;
}

export type MaintenanceWindowStatus = 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface MaintenanceWindowDto {
  id: string;
  title: string;
  message: string;
  status: MaintenanceWindowStatus;
  startsAt: string;
  endsAt: string | null;
  expectedCompletionNote: string;
  bypassRoles: UserRole[];
  createdBy: string | null;
  createdByEmail: string;
  activatedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GovernanceConfigEntryView {
  category:
    | 'Platform'
    | 'Authentication'
    | 'Security'
    | 'AI'
    | 'Market Data'
    | 'API'
    | 'Background Jobs'
    | 'Maintenance'
    | 'Privacy'
    | 'Notifications';
  key: string;
  label: string;
  classification: 'PUBLIC' | 'PRIVATE';
  valueType: 'string' | 'number' | 'boolean' | 'secret_status' | 'json';
  value: unknown;
  editableViaKey?: keyof PlatformConfigBundle;
  requiresReauth?: boolean;
}

export interface GovernanceEventSummaryDto {
  id: string;
  category: 'LIFECYCLE' | 'PRIVACY' | 'BACKUP' | 'FEATURE_FLAG' | 'CONFIG' | 'MAINTENANCE' | 'RBAC' | 'SECURITY';
  action: string;
  actorEmail: string;
  target: string;
  result: string;
  createdAt: string;
}

// ---- PHASE 6 TYPES ----

export type AutomationTriggerType =
  | 'SCHEDULED'
  | 'OPERATIONAL_EVENT'
  | 'ALERT_THRESHOLD'
  | 'JOB_FAILURE'
  | 'SECURITY_EVENT'
  | 'MANUAL';

export type AutomationActionType =
  | 'CREATE_ALERT'
  | 'ACKNOWLEDGE_ELIGIBLE_ALERT'
  | 'CREATE_INCIDENT'
  | 'ADD_INCIDENT_EVENT'
  | 'PAUSE_WORKER_QUEUE'
  | 'RESUME_WORKER_QUEUE'
  | 'DISABLE_FEATURE_FLAG'
  | 'GENERATE_GOVERNANCE_REMINDER'
  | 'RECORD_OPERATIONAL_EVENT';

export type AutomationRunStatus =
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED'
  | 'BLOCKED'
  | 'PENDING_APPROVAL'
  | 'TIMED_OUT';

export interface AutomationWorkflowDto {
  id: string;
  workflowKey: string;
  name: string;
  description: string;
  triggerType: AutomationTriggerType;
  triggerConfig: Record<string, unknown>;
  conditions: Record<string, unknown>;
  actionType: AutomationActionType;
  actionConfig: Record<string, unknown>;
  scheduleIntervalMinutes: number | null;
  requiresApproval: boolean;
  enabled: boolean;
  isPaused: boolean;
  ownerId: string | null;
  ownerEmail: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  retryLimit: number;
  timeoutMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunDto {
  id: string;
  workflowId: string;
  workflowName?: string;
  workflowKey?: string;
  triggerSource: string;
  idempotencyKey: string | null;
  status: AutomationRunStatus;
  retryCount: number;
  durationMs: number;
  summary: string;
  errorMessage: string | null;
  triggeredBy: string | null;
  triggeredByEmail: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface AutomationEventDto {
  id: string;
  workflowId: string;
  runId: string | null;
  eventType: string;
  actorId: string | null;
  actorEmail: string;
  detail: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type AccessReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED' | 'EXPIRED';

export interface PrivilegedAccountInspectionDto {
  userId: string;
  fullName: string;
  email: string;
  role: UserRole;
  accountStatus: AccountStatus;
  grantedPermissionsCount: number;
  grantedPermissions: Permission[];
  lastLoginAt: string | null;
  lastPrivilegedActionAt: string | null;
  lastPrivilegedAction: string | null;
  activeSessionCount: number;
  mfaStatus: 'NOT_CONFIGURED';
  latestReview: PrivilegedAccessReviewDto | null;
}

export interface PrivilegedAccessReviewDto {
  id: string;
  targetUserId: string;
  targetEmail: string;
  reviewedRole: string;
  reviewStatus: AccessReviewStatus;
  reviewerId: string | null;
  reviewerEmail: string;
  decisionNote: string;
  expiresAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export type PrivilegedActionType =
  | 'ROLE_PROMOTION'
  | 'SECURITY_POLICY_CHANGE'
  | 'PRODUCTION_RESTORE'
  | 'AI_POLICY_CRITICAL'
  | 'AUTOMATION_HIGH_IMPACT'
  | 'HIGH_IMPACT_OPERATION';

export type PrivilegedActionRequestStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXECUTED'
  | 'EXPIRED'
  | 'CANCELLED';

export interface PrivilegedActionRequestDto {
  id: string;
  actionType: PrivilegedActionType;
  targetResourceType: string;
  targetResourceId: string;
  payload: Record<string, unknown>;
  reason: string;
  status: PrivilegedActionRequestStatus;
  requestedBy: string | null;
  requestedByEmail: string;
  assignedReviewerId: string | null;
  approvedBy: string | null;
  approvedByEmail: string | null;
  rejectionReason: string;
  executionResult: string | null;
  expiresAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  createdAt: string;
}

export interface PrivilegedActionHistoryDto {
  id: string;
  requestId: string;
  eventType: string;
  actorId: string | null;
  actorEmail: string;
  detail: string;
  createdAt: string;
}

export type EmergencyAccessStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'REVIEWED';

export interface EmergencyAccessGrantDto {
  id: string;
  userId: string;
  userEmail: string;
  grantedBy: string | null;
  grantedByEmail: string;
  scopedPermissions: Permission[];
  justification: string;
  status: EmergencyAccessStatus;
  expiresAt: string;
  revokedAt: string | null;
  postIncidentReviewNote: string;
  reviewedByEmail: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface AiPolicyVersionDto {
  id: string;
  versionNumber: number;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
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
  createdBy: string | null;
  createdByEmail: string;
  activatedAt: string | null;
  createdAt: string;
}

export interface EmergencyPlaybookDto {
  id: string;
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
  updatedAt: string;
}

export interface EmergencyEventDto {
  id: string;
  eventType: string;
  severity: IncidentSeverity;
  title: string;
  summary: string;
  playbookKey: string | null;
  relatedIncidentId: string | null;
  actionTaken: string;
  actorId: string | null;
  actorEmail: string;
  rollbackHint: string;
  createdAt: string;
}

export interface UnifiedTimelineItemDto {
  id: string;
  category:
    | 'ADMIN_ACTION'
    | 'SECURITY_EVENT'
    | 'FEATURE_FLAG'
    | 'CONFIG_CHANGE'
    | 'INCIDENT'
    | 'MAINTENANCE'
    | 'AUTOMATION'
    | 'ACCESS_APPROVAL'
    | 'BACKUP';
  actor: string;
  timestamp: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  relatedResource: string;
  eventSource: string;
  summary: string;
}

export interface OperationalRecommendationDto {
  id: string;
  category:
    | 'API_LATENCY'
    | 'MARKET_DATA_STALE'
    | 'PRIVACY_OVERDUE'
    | 'JOB_FAILURES'
    | 'BACKUP_READINESS'
    | 'ACCESS_REVIEW'
    | 'AI_RELIABILITY';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  rationale: string;
  evidenceType: 'MEASURED' | 'DERIVED';
  supportingMetrics: string[];
  recommendedRoute: string;
  recommendedActionLabel: string;
}

export interface GlobalSearchResultItemDto {
  id: string;
  entityType:
    | 'user'
    | 'incident'
    | 'alert'
    | 'job'
    | 'feature_flag'
    | 'release'
    | 'audit_log'
    | 'privacy_request'
    | 'backup_record'
    | 'automation_workflow';
  title: string;
  subtitle: string;
  status: string;
  href: string;
  timestamp: string;
}

