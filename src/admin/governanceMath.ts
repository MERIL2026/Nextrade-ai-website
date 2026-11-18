import crypto from 'node:crypto';
import type { UserRole } from '../auth/db';
import type {
  FeatureFlagDto,
  GovernanceConfigEntryView,
  MaintenanceModeConfig,
  MaintenanceWindowDto,
  PlatformConfigBundle,
  UserLifecycleState,
} from './types';

export const USER_LIFECYCLE_STATES: readonly UserLifecycleState[] = [
  'active',
  'suspended',
  'pending_verification',
  'deletion_requested',
  'deletion_scheduled',
  'deleted_anonymized',
] as const;

export function resolveEffectiveLifecycleState(input: {
  storedState?: string | null;
  accountStatus: string;
  emailVerified: boolean;
  email: string;
}): UserLifecycleState {
  if (input.email.endsWith('@deleted.local') || input.storedState === 'deleted_anonymized') {
    return 'deleted_anonymized';
  }
  if (input.storedState === 'deletion_scheduled') return 'deletion_scheduled';
  if (input.storedState === 'deletion_requested') return 'deletion_requested';
  if (input.accountStatus === 'suspended' || input.storedState === 'suspended') {
    return 'suspended';
  }
  if (input.accountStatus === 'disabled') {
    return input.storedState === 'deletion_scheduled' ? 'deletion_scheduled' : 'deleted_anonymized';
  }
  if (!input.emailVerified) {
    return 'pending_verification';
  }
  return 'active';
}

export function canCancelDeletionStatus(status: string): boolean {
  return status === 'PENDING_REVIEW' || status === 'SCHEDULED';
}

export const FORBIDDEN_EXPORT_KEYS = new Set([
  'password_hash',
  'passwordHash',
  'session_token_hash',
  'sessionTokenHash',
  'token_hash',
  'tokenHash',
  'download_token_hash',
  'downloadTokenHash',
  'apiKey',
  'GEMINI_API_KEY',
  'EMAIL_API_KEY',
  'EMAILJS_PRIVATE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'SUPABASE_DB_URL',
]);

export function containsForbiddenExportKeys(obj: unknown): string[] {
  const hits: string[] = [];
  const visit = (val: unknown, prefix = '') => {
    if (!val || typeof val !== 'object') return;
    if (Array.isArray(val)) {
      val.forEach((item, idx) => visit(item, `${prefix}[${idx}]`));
      return;
    }
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (FORBIDDEN_EXPORT_KEYS.has(k)) {
        hits.push(prefix ? `${prefix}.${k}` : k);
      }
      visit(v, prefix ? `${prefix}.${k}` : k);
    }
  };
  visit(obj);
  return hits;
}

export function buildSafeUserDataExport(input: {
  exportId: string;
  generatedAt: string;
  user: {
    id: string;
    fullName: string;
    email: string;
    emailVerified: boolean;
    accountStatus: string;
    lifecycleState: UserLifecycleState;
    role: string;
    createdAt: string;
    lastLoginAt: string | null;
  };
  preferences: Record<string, unknown> | null;
  portfolios: Array<Record<string, unknown>>;
  watchlists: Array<Record<string, unknown>>;
  paperAccount: Record<string, unknown> | null;
  paperOrders: Array<Record<string, unknown>>;
  paperTransactions: Array<Record<string, unknown>>;
  aiResearchHistory: Array<Record<string, unknown>>;
  savedReports: Array<Record<string, unknown>>;
  sessionsSummary: Array<{
    id: string;
    userAgent: string;
    ipAddress: string;
    rememberMe: boolean;
    createdAt: string;
    lastActiveAt: string;
    expiresAt: string;
    revokedAt: string | null;
  }>;
  securityEvents: Array<{
    id: string;
    eventType: string;
    ipAddress: string;
    detail: string;
    createdAt: string;
  }>;
}) {
  return {
    exportMetadata: {
      exportId: input.exportId,
      schemaVersion: 'nextrade-privacy-export-v1',
      generatedAt: input.generatedAt,
      exclusionsNotice:
        'Password hashes, opaque session tokens, verification/reset token hashes, and server credentials are permanently excluded.',
      backupRetentionCaveat:
        'Automated infrastructure snapshots (if enabled externally) rotate on their own schedule and cannot be edited per user row.',
    },
    account: {
      id: input.user.id,
      fullName: input.user.fullName,
      email: input.user.email,
      emailVerified: input.user.emailVerified,
      accountStatus: input.user.accountStatus,
      lifecycleState: input.user.lifecycleState,
      role: input.user.role,
      createdAt: input.user.createdAt,
      lastLoginAt: input.user.lastLoginAt,
    },
    preferences: input.preferences,
    portfolios: input.portfolios,
    watchlists: input.watchlists,
    paperTrading: {
      account: input.paperAccount,
      orders: input.paperOrders,
      transactions: input.paperTransactions,
    },
    aiResearchHistory: input.aiResearchHistory,
    savedReports: input.savedReports,
    sessionsSummary: input.sessionsSummary,
    securityActivity: input.securityEvents,
  };
}

export function isValidFlagKey(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  return /^[a-z][a-z0-9_.-]{2,63}$/.test(raw.trim());
}

export function computeRolloutBucket(flagKey: string, subjectId: string): number {
  const digest = crypto.createHash('sha256').update(`${flagKey}:${subjectId}`).digest();
  // Use first 4 bytes unsigned int modulo 100 for uniform deterministic bucketing
  const val = digest.readUInt32BE(0);
  return val % 100;
}

export function evaluateFeatureFlag(
  flag: Pick<
    FeatureFlagDto,
    | 'flagKey'
    | 'enabled'
    | 'environmentScope'
    | 'rolloutPercentage'
    | 'targetRoles'
    | 'isKillSwitch'
    | 'startsAt'
    | 'endsAt'
  >,
  context: {
    environment: string;
    userId?: string | null;
    userRole?: UserRole | null;
    nowMs?: number;
  },
): { active: boolean; reason: string; bucket: number | null } {
  const now = context.nowMs ?? Date.now();

  if (!flag.enabled) {
    return { active: false, reason: 'DISABLED', bucket: null };
  }

  if (flag.environmentScope !== 'all' && flag.environmentScope !== context.environment) {
    return { active: false, reason: 'ENV_MISMATCH', bucket: null };
  }

  if (flag.startsAt) {
    const startMs = Date.parse(flag.startsAt);
    if (Number.isFinite(startMs) && now < startMs) {
      return { active: false, reason: 'BEFORE_SCHEDULE_START', bucket: null };
    }
  }

  if (flag.endsAt) {
    const endMs = Date.parse(flag.endsAt);
    if (Number.isFinite(endMs) && now > endMs) {
      return { active: false, reason: 'AFTER_SCHEDULE_END', bucket: null };
    }
  }

  if (flag.targetRoles.length > 0) {
    if (!context.userRole || !flag.targetRoles.includes(context.userRole)) {
      return { active: false, reason: 'ROLE_EXCLUDED', bucket: null };
    }
  }

  if (flag.rolloutPercentage >= 100) {
    return { active: true, reason: 'ENABLED_100_PCT', bucket: null };
  }
  if (flag.rolloutPercentage <= 0) {
    return { active: false, reason: 'ROLLOUT_0_PCT', bucket: null };
  }

  const subject = context.userId || 'anonymous-global';
  const bucket = computeRolloutBucket(flag.flagKey, subject);
  if (bucket < flag.rolloutPercentage) {
    return { active: true, reason: 'ROLLOUT_INCLUDED', bucket };
  }
  return { active: false, reason: 'ROLLOUT_EXCLUDED', bucket };
}

export function evaluateMaintenanceState(input: {
  manualConfig: MaintenanceModeConfig;
  windows: MaintenanceWindowDto[];
  userRole?: UserRole | null;
  nowMs?: number;
}): {
  inMaintenance: boolean;
  source: 'NONE' | 'MANUAL_FLAG' | 'SCHEDULED_WINDOW';
  message: string;
  expectedCompletionNote: string;
  endsAt: string | null;
  bypassAllowed: boolean;
  activeWindowId: string | null;
} {
  const now = input.nowMs ?? Date.now();

  const matchingWindow = input.windows.find((w) => {
    if (w.status === 'CANCELLED' || w.status === 'COMPLETED') return false;
    const startMs = Date.parse(w.startsAt);
    const endMs = w.endsAt ? Date.parse(w.endsAt) : null;
    if (w.status === 'ACTIVE') {
      if (endMs && Number.isFinite(endMs) && now > endMs) return false;
      return true;
    }
    if (w.status === 'SCHEDULED' && Number.isFinite(startMs) && now >= startMs) {
      if (endMs && Number.isFinite(endMs) && now > endMs) return false;
      return true;
    }
    return false;
  });

  if (input.manualConfig.enabled) {
    const bypassAllowed = input.userRole === 'super_admin' || input.userRole === 'admin';
    return {
      inMaintenance: true,
      source: 'MANUAL_FLAG',
      message: input.manualConfig.message,
      expectedCompletionNote: matchingWindow?.expectedCompletionNote || '',
      endsAt: matchingWindow?.endsAt || null,
      bypassAllowed,
      activeWindowId: matchingWindow?.id ?? null,
    };
  }

  if (matchingWindow) {
    const roleSet = new Set<UserRole>(['super_admin', ...matchingWindow.bypassRoles]);
    const bypassAllowed = Boolean(input.userRole && roleSet.has(input.userRole));
    return {
      inMaintenance: true,
      source: 'SCHEDULED_WINDOW',
      message: matchingWindow.message,
      expectedCompletionNote: matchingWindow.expectedCompletionNote,
      endsAt: matchingWindow.endsAt,
      bypassAllowed,
      activeWindowId: matchingWindow.id,
    };
  }

  return {
    inMaintenance: false,
    source: 'NONE',
    message: '',
    expectedCompletionNote: '',
    endsAt: null,
    bypassAllowed: false,
    activeWindowId: null,
  };
}

export function escapeCsvFormulaSafe(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const needsFormulaGuard = /^[=+\-@\t\r]/.test(raw);
  const safe = needsFormulaGuard ? `'${raw}` : raw;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function buildCsvDocument(headers: string[], rows: unknown[][]): string {
  const headLine = headers.map(escapeCsvFormulaSafe).join(',');
  const bodyLines = rows.map((row) => row.map(escapeCsvFormulaSafe).join(','));
  return `${headLine}\n${bodyLines.join('\n')}`;
}

export function buildTenCategoryConfigInventory(input: {
  config: PlatformConfigBundle;
  envStatus: {
    geminiConfigured: boolean;
    emailConfigured: boolean;
    databaseDialect: string;
    backupProviderConfigured: boolean;
  };
}): GovernanceConfigEntryView[] {
  const { config, envStatus } = input;
  return [
    // 1. Platform
    {
      category: 'Platform',
      key: 'governance_policies.platformDisplayName',
      label: 'Platform Display Name',
      classification: 'PUBLIC',
      valueType: 'string',
      value: config.governance_policies.platformDisplayName,
      editableViaKey: 'governance_policies',
    },
    {
      category: 'Platform',
      key: 'governance_policies.environmentLabel',
      label: 'Runtime Environment Label',
      classification: 'PUBLIC',
      valueType: 'string',
      value: config.governance_policies.environmentLabel,
      editableViaKey: 'governance_policies',
    },
    {
      category: 'Platform',
      key: 'workspace_defaults.defaultCurrency',
      label: 'Default Workspace Display Currency',
      classification: 'PUBLIC',
      valueType: 'string',
      value: config.workspace_defaults.defaultCurrency,
      editableViaKey: 'workspace_defaults',
    },
    // 2. Authentication
    {
      category: 'Authentication',
      key: 'governance_policies.requireEmailVerificationForLogin',
      label: 'Require Verified Email Before Sign-In',
      classification: 'PRIVATE',
      valueType: 'boolean',
      value: config.governance_policies.requireEmailVerificationForLogin,
      editableViaKey: 'governance_policies',
      requiresReauth: true,
    },
    {
      category: 'Authentication',
      key: 'governance_policies.sessionTtlHours',
      label: 'Standard Session TTL (hours)',
      classification: 'PRIVATE',
      valueType: 'number',
      value: config.governance_policies.sessionTtlHours,
      editableViaKey: 'governance_policies',
      requiresReauth: true,
    },
    {
      category: 'Authentication',
      key: 'governance_policies.rememberMeDays',
      label: 'Remember-Me Session Window (days)',
      classification: 'PRIVATE',
      valueType: 'number',
      value: config.governance_policies.rememberMeDays,
      editableViaKey: 'governance_policies',
    },
    // 3. Security
    {
      category: 'Security',
      key: 'rate_limits.apiResearchMaxPerMin',
      label: 'AI Research Rate Limit (req/min)',
      classification: 'PRIVATE',
      valueType: 'number',
      value: config.rate_limits.apiResearchMaxPerMin,
      editableViaKey: 'rate_limits',
    },
    {
      category: 'Security',
      key: 'rate_limits.workspaceMutationMaxPerMin',
      label: 'Workspace Mutation Rate Limit (req/min)',
      classification: 'PRIVATE',
      valueType: 'number',
      value: config.rate_limits.workspaceMutationMaxPerMin,
      editableViaKey: 'rate_limits',
    },
    {
      category: 'Security',
      key: 'secret.databaseConnection',
      label: `Database Connection (${envStatus.databaseDialect})`,
      classification: 'PRIVATE',
      valueType: 'secret_status',
      value: 'CONFIGURED',
    },
    // 4. AI
    {
      category: 'AI',
      key: 'ai_config.activeModel',
      label: 'Active Gemini Inference Model',
      classification: 'PRIVATE',
      valueType: 'string',
      value: config.ai_config.activeModel,
      editableViaKey: 'ai_config',
    },
    {
      category: 'AI',
      key: 'ai_config.aiEnabled',
      label: 'AI Financial Research Enabled',
      classification: 'PUBLIC',
      valueType: 'boolean',
      value: config.ai_config.aiEnabled,
      editableViaKey: 'ai_config',
    },
    {
      category: 'AI',
      key: 'secret.geminiApiKey',
      label: 'Server-Side GEMINI_API_KEY',
      classification: 'PRIVATE',
      valueType: 'secret_status',
      value: envStatus.geminiConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED',
    },
    // 5. Market Data
    {
      category: 'Market Data',
      key: 'market_data_config.dataClassification',
      label: 'Market Data Classification',
      classification: 'PUBLIC',
      valueType: 'string',
      value: config.market_data_config.dataClassification,
      editableViaKey: 'market_data_config',
    },
    {
      category: 'Market Data',
      key: 'market_data_config.enabledRegions',
      label: 'Enabled Market Regions',
      classification: 'PUBLIC',
      valueType: 'json',
      value: config.market_data_config.enabledRegions,
      editableViaKey: 'market_data_config',
    },
    // 6. API
    {
      category: 'API',
      key: 'rate_limits.paperOrderMaxPerMin',
      label: 'Paper Order Rate Limit (req/min)',
      classification: 'PRIVATE',
      valueType: 'number',
      value: config.rate_limits.paperOrderMaxPerMin,
      editableViaKey: 'rate_limits',
    },
    {
      category: 'API',
      key: 'rate_limits.contactMaxPer15Min',
      label: 'Contact Intake Rate Limit (req/15m)',
      classification: 'PRIVATE',
      valueType: 'number',
      value: config.rate_limits.contactMaxPer15Min,
      editableViaKey: 'rate_limits',
    },
    // 7. Background Jobs
    {
      category: 'Background Jobs',
      key: 'alert_thresholds.stuckJobMinutes',
      label: 'Stuck Background Job Threshold (minutes)',
      classification: 'PRIVATE',
      valueType: 'number',
      value: config.alert_thresholds.stuckJobMinutes,
      editableViaKey: 'alert_thresholds',
    },
    {
      category: 'Background Jobs',
      key: 'backup.providerStatus',
      label: 'Managed Remote Backup Provider',
      classification: 'PRIVATE',
      valueType: 'secret_status',
      value: envStatus.backupProviderConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED',
    },
    // 8. Maintenance
    {
      category: 'Maintenance',
      key: 'maintenance_mode.enabled',
      label: 'Immediate Maintenance Mode Gate',
      classification: 'PUBLIC',
      valueType: 'boolean',
      value: config.maintenance_mode.enabled,
      editableViaKey: 'maintenance_mode',
      requiresReauth: true,
    },
    // 9. Privacy
    {
      category: 'Privacy',
      key: 'governance_policies.exportLinkExpiryHours',
      label: 'User Data Export Expiry Window (hours)',
      classification: 'PUBLIC',
      valueType: 'number',
      value: config.governance_policies.exportLinkExpiryHours,
      editableViaKey: 'governance_policies',
    },
    {
      category: 'Privacy',
      key: 'governance_policies.deletionGracePeriodDays',
      label: 'Account Deletion Grace Period (days)',
      classification: 'PUBLIC',
      valueType: 'number',
      value: config.governance_policies.deletionGracePeriodDays,
      editableViaKey: 'governance_policies',
      requiresReauth: true,
    },
    {
      category: 'Privacy',
      key: 'governance_policies.auditRetentionDays',
      label: 'Immutable Audit Log Retention Target (days)',
      classification: 'PRIVATE',
      valueType: 'number',
      value: config.governance_policies.auditRetentionDays,
      editableViaKey: 'governance_policies',
    },
    // 10. Notifications
    {
      category: 'Notifications',
      key: 'governance_policies.securityDigestEnabled',
      label: 'Security & Governance Digest Enabled',
      classification: 'PRIVATE',
      valueType: 'boolean',
      value: config.governance_policies.securityDigestEnabled,
      editableViaKey: 'governance_policies',
    },
    {
      category: 'Notifications',
      key: 'secret.transactionalEmailProvider',
      label: 'Transactional Email Provider Credentials',
      classification: 'PRIVATE',
      valueType: 'secret_status',
      value: envStatus.emailConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED',
    },
  ];
}
