import type { UserRole } from '../auth/db';
import type { Permission } from '../auth/rbac';
import type {
  AdminAnnouncementDto,
  AdminAuditLogDto,
  AdminIncidentDto,
  AdminRangeKey,
  AdminUserDetailDto,
  AdminUserLifecycleDetailDto,
  AdminUserSummaryDto,
  AiPolicyVersionDto,
  AiPromptVersionDto,
  AlertHistoryDto,
  AnnouncementCategory,
  AnnouncementSeverity,
  AnnouncementStatus,
  AutomationActionType,
  AutomationEventDto,
  AutomationRunDto,
  AutomationTriggerType,
  AutomationWorkflowDto,
  BackgroundJobDto,
  BackgroundJobRunDto,
  BackupRecordDto,
  BackupVerificationEventDto,
  DataDeletionRequestDto,
  DataExportRequestDto,
  EmergencyAccessGrantDto,
  EmergencyEventDto,
  EmergencyPlaybookDto,
  FeatureEnvScope,
  FeatureFlagDto,
  FeatureFlagHistoryDto,
  GlobalSearchResultItemDto,
  GovernanceConfigEntryView,
  GovernanceEventSummaryDto,
  IncidentEventDto,
  IncidentSeverity,
  IncidentStatus,
  MaintenanceWindowDto,
  MarketDataHealthDto,
  ObservabilityRangeKey,
  ObservabilityThresholdsConfig,
  OperationalAlertDto,
  OperationalRecommendationDto,
  PlatformConfigBundle,
  PrivilegedAccessReviewDto,
  PrivilegedAccountInspectionDto,
  PrivilegedActionHistoryDto,
  PrivilegedActionRequestDto,
  PrivilegedActionType,
  ReleaseRecordDto,
  SecurityEventSeverity,
  ServiceHealthItem,
  SupportTicketDto,
  SupportTicketPriority,
  SupportTicketStatus,
  TimeSeriesPoint,
  UnifiedTimelineItemDto,
  UserAdminNoteDto,
  UserLifecycleState,
  WorkerHeartbeatDto,
} from '../admin/types';

export class AdminApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.code = code;
  }
}

async function requestAdminJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  } & T;

  if (!response.ok) {
    throw new AdminApiError(
      payload.error || `Admin request failed (HTTP ${response.status})`,
      response.status,
      payload.code,
    );
  }
  return payload;
}

export interface AdminOverviewResponse {
  range: AdminRangeKey;
  maintenanceMode: boolean;
  userMetrics: {
    totalUsers: number;
    activeUsers: number;
    newRegistrations: number;
    verifiedUsers: number;
    suspendedUsers: number;
  };
  aiMetrics: {
    totalRequests: number;
    providerConfigured: boolean;
    aiEnabled: boolean;
    activeModel: string;
    avgLatencyMs: number | null;
    failedRequests: number;
    totalTokensMeasured: number | null;
    estimatedCostUsd: number | null;
  };
  marketMetrics: {
    activeProviders: number;
    classification: 'SIMULATED' | 'DELAYED' | 'LIVE' | 'CACHED' | 'END_OF_DAY' | 'UNAVAILABLE';
    enabledRegions: ('IN' | 'US' | 'GLOBAL')[];
    instrumentCount: number;
    lastSyncAt: string | null;
    lastSyncStatus: 'IDLE' | 'SUCCEEDED' | 'FAILED';
    failedSyncJobs: number;
  };
  apiMetrics: {
    requestVolume: number;
    errorCount: number;
    errorRatePct: number;
    rateLimitEvents: number;
    avgLatencyMs: number | null;
  };
  infrastructure: {
    backendHealth: string;
    dbDialect: string;
    dbLatencyMs: number;
    uptimeSeconds: number;
    nodeVersion: string;
    registeredJobsCount: number;
    failedJobsCount: number;
  };
  securityMetrics: {
    openIncidents: number;
    failedLogins: number;
    blockedRequests: number;
    openSupportTickets: number;
  };
  charts: {
    userGrowth: TimeSeriesPoint[];
    apiTraffic: TimeSeriesPoint[];
    aiUsage: TimeSeriesPoint[];
  };
  serviceHealth: ServiceHealthItem[];
  recentActivity: Array<{
    id: string;
    adminEmail: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    result: string;
    createdAt: string;
  }>;
}

export interface AdminNotificationsResponse {
  totalCount: number;
  items: Array<{
    id: string;
    kind: 'ALERT' | 'INCIDENT' | 'JOB_FAILED' | 'SUPPORT_OPEN';
    title: string;
    href: string;
    createdAt: string;
  }>;
}

export interface AdminAiOverviewResponse {
  provider: {
    activeProvider: 'gemini';
    activeModel: string;
    fallbackModel: string;
    approvedModels: string[];
    geminiKeyConfigured: boolean;
    aiEnabled: boolean;
    fallbackOnError: boolean;
    maxQueryChars: number;
    researchRateLimitPerMin: number;
  };
  activePrompt: {
    id: string;
    versionNumber: number;
    title: string;
    systemPrompt: string;
    userPromptTemplate: string;
    modelTarget: string;
  };
  usage: {
    totalRequests: number;
    recentSampleSize: number;
    successCount: number;
    fallbackCount: number;
    failedCount: number;
    blockedCount: number;
    avgLatencyMs: number | null;
    totalTokensMeasured: number | null;
    estimatedCostUsd: number | null;
    byFeature: {
      workspace_research: number;
      public_research: number;
    };
    dailySeries: TimeSeriesPoint[];
  };
  requests: Array<{
    id: string;
    userId: string | null;
    symbol: string;
    queryPreview: string;
    feature: string;
    provider: string;
    model: string;
    status: string;
    latencyMs: number;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    errorMessage: string | null;
    createdAt: string;
  }>;
}

export interface AdminMarketsOverviewResponse {
  providers: Array<{
    id: string;
    name: string;
    classification: 'SIMULATED' | 'DELAYED' | 'LIVE' | 'CACHED' | 'END_OF_DAY' | 'UNAVAILABLE';
    status: string;
    exchanges: string[];
    lastSuccessfulSync: string | null;
    note: string;
    latencyMs: number | null;
    quotaStatus: string;
  }>;
  config: PlatformConfigBundle['market_data_config'];
  coverage: {
    indiaCount: number;
    usCount: number;
    globalCount: number;
    totalInstruments: number;
    enabledCount: number;
  };
  symbols: Array<{
    symbol: string;
    name: string;
    exchange: string;
    region: 'IN' | 'US' | 'GLOBAL';
    currency: 'USD' | 'INR';
    sector: string;
    category?: string;
    latestPrice: number | null;
    providerName?: string;
    enabled: boolean;
    classification: 'SIMULATED' | 'DELAYED' | 'LIVE' | 'CACHED' | 'END_OF_DAY' | 'UNAVAILABLE';
  }>;
}

export interface AdminApisOverviewResponse {
  range: AdminRangeKey;
  summary: {
    totalVolume: number;
    avgLatencyMs: number | null;
    statusBreakdown: { s2xx: number; s4xx: number; s5xx: number };
    rateLimitEvents: number;
  };
  rateLimits: PlatformConfigBundle['rate_limits'];
  integrations: Array<{
    name: string;
    configured: boolean;
    keyMasked: string;
  }>;
  endpoints: Array<{
    method: string;
    routePath: string;
    volume: number;
    errorCount: number;
    errorRatePct: number;
    rateLimitCount: number;
    avgLatencyMs: number;
  }>;
  failedRequests: Array<{
    method: string;
    routePath: string;
    statusCode: number;
    latencyMs: number;
    rateLimited: boolean;
    errorCode: string | null;
    createdAt: string;
  }>;
}

export interface AdminSecurityOverviewResponse {
  authMonitoring: {
    loginSuccesses: number;
    failedLogins: number;
    passwordResets: number;
    verificationEvents: number;
    activeSessions: number;
    revokedSessions: number;
  };
  configurationPosture: {
    cspMode: string;
    httpOnlyCookies: boolean;
    sameSitePolicy: string;
    csrfOriginCheckEnabled: boolean;
    argon2idPasswordHashing: boolean;
    dependencyVulnerabilityScanner: string;
  };
  historicalAudit: {
    source: string;
    auditDate: string;
    status: string;
    caveat: string;
    summaryCounts: {
      critical: number;
      high: number;
      mediumFixed: number;
      lowFixed: number;
    };
    artifactFiles: Array<{ file: string; presentInRepo: boolean }>;
    historicalFindings: Array<{
      id: string;
      severity: string;
      title: string;
      status: string;
    }>;
  };
  events: Array<{
    id: string;
    userId: string | null;
    eventType: string;
    ipAddress: string;
    userAgent: string;
    detail: string;
    createdAt: string;
  }>;
  incidents: AdminIncidentDto[];
}

export interface AdminInfraHealthResponse {
  runtime: {
    nodeVersion: string;
    platform: string;
    pid: number;
    uptimeSeconds: number;
    processStartedAt: string;
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    cpuLoadAvg1m: number;
    diskMetricsAvailable: boolean;
  };
  database: {
    dialect: string;
    status: string;
    latencyMs: number;
    poolMode: string;
  };
  maintenanceMode: PlatformConfigBundle['maintenance_mode'];
  services: ServiceHealthItem[];
  recentServerErrors: Array<{
    id: string;
    method: string;
    routePath: string;
    statusCode: number;
    latencyMs: number;
    errorCode: string | null;
    createdAt: string;
  }>;
}

export interface AdminSystemConfigResponse {
  config: PlatformConfigBundle;
  configAudit: Array<{
    id: string;
    adminId: string | null;
    configKey: string;
    previousValueRedacted: string | null;
    newValueRedacted: string | null;
    reason: string;
    createdAt: string;
  }>;
}

export interface AdminRoleCatalogEntry {
  role: UserRole;
  label: string;
  description: string;
  tier: string;
  permissions: Permission[];
}

export interface ObservabilityOverviewResponse {
  range: ObservabilityRangeKey;
  from: string | null;
  to: string;
  maintenanceMode: boolean;
  overallPlatformHealth: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
  userMetrics: {
    totalUsers: number;
    activeUsers: number;
    recentlyActiveUsers: number;
    newRegistrations: number;
    newRegistrationsDeltaPct: number | null;
    verifiedUsers: number;
    suspendedUsers: number;
    restrictedUsers: number;
    loginActivityCount: number;
    failedLogins: number;
    failedLoginsDeltaPct: number | null;
  };
  aiMetrics: {
    totalRequests: number;
    totalRequestsDeltaPct: number | null;
    providerConfigured: boolean;
    aiEnabled: boolean;
    activeModel: string;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
    failedRequests: number;
    totalTokensMeasured: number | null;
    estimatedCostUsd: number | null;
  };
  marketMetrics: {
    activeProviders: number;
    classification: 'SIMULATED' | 'DELAYED' | 'LIVE' | 'CACHED' | 'END_OF_DAY' | 'UNAVAILABLE';
    enabledRegions: ('IN' | 'US' | 'GLOBAL')[];
    instrumentCount: number;
    marketDataRequests: number;
    lastSyncAt: string | null;
    lastSyncStatus: 'IDLE' | 'SUCCEEDED' | 'FAILED';
    failedSyncJobs: number;
  };
  apiMetrics: {
    requestVolume: number;
    requestVolumeDeltaPct: number | null;
    errorCount: number;
    serverErrorCount: number;
    errorRatePct: number;
    rateLimitEvents: number;
    avgLatencyMs: number | null;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    p99LatencyMs: number | null;
  };
  usageMetrics: {
    paperTradingOrders: number;
    workspaceResearchSaved: number;
    marketDataRequests: number;
    failedOperations: number;
  };
  infrastructure: {
    backendHealth: string;
    dbDialect: string;
    dbLatencyMs: number;
    uptimeSeconds: number;
    nodeVersion: string;
    registeredJobsCount: number;
    failedJobsCount: number;
    stuckJobsCount: number;
    workerPaused: boolean;
  };
  securityMetrics: {
    openIncidents: number;
    openAlerts: number;
    criticalAlerts: number;
    failedLogins: number;
    blockedRequests: number;
    openSupportTickets: number;
  };
  charts: {
    userGrowth: TimeSeriesPoint[];
    apiTraffic: TimeSeriesPoint[];
    aiUsage: TimeSeriesPoint[];
  };
  serviceHealth: ServiceHealthItem[];
  recentActivity: Array<{
    id: string;
    adminEmail: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    result: string;
    createdAt: string;
  }>;
}

export interface ObservabilityApiResponse {
  range: ObservabilityRangeKey;
  from: string | null;
  to: string;
  summary: {
    totalVolume: number;
    avgLatencyMs: number | null;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    p99LatencyMs: number | null;
    errorRatePct: number;
    statusBreakdown: { s2xx: number; s4xx: number; s5xx: number };
    rateLimitEvents: number;
  };
  rateLimits: PlatformConfigBundle['rate_limits'];
  integrations: Array<{ name: string; configured: boolean; keyMasked: string }>;
  endpoints: Array<{
    method: string;
    routePath: string;
    volume: number;
    errorCount: number;
    errorRatePct: number;
    rateLimitCount: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    maxLatencyMs: number;
    isSlow: boolean;
    lastObservedAt: string;
  }>;
  totalEndpoints: number;
  limit: number;
  offset: number;
  slowEndpoints: Array<{
    method: string;
    routePath: string;
    volume: number;
    p95LatencyMs: number;
    avgLatencyMs: number;
    errorRatePct: number;
    isSlow: boolean;
  }>;
  failedRequests: Array<{
    method: string;
    routePath: string;
    statusCode: number;
    latencyMs: number;
    rateLimited: boolean;
    errorCode: string | null;
    createdAt: string;
  }>;
  trends: TimeSeriesPoint[];
}

export interface ObservabilityAiResponse {
  range: ObservabilityRangeKey;
  from: string | null;
  to: string;
  summary: {
    totalRequests: number;
    successCount: number;
    fallbackCount: number;
    failedCount: number;
    blockedCount: number;
    rateLimitErrors: number;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
    totalTokensMeasured: number | null;
    estimatedCostUsd: number | null;
    pricingNote: string;
    providerConfigured: boolean;
    aiEnabled: boolean;
  };
  modelBreakdown: Array<{
    provider: string;
    model: string;
    availabilityStatus: string;
    requestCount: number;
    successCount: number;
    fallbackCount: number;
    failedCount: number;
    blockedCount: number;
    successRatePct: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    totalTokensMeasured: number | null;
    estimatedCostUsd: number | null;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
  }>;
  recentErrors: Array<{
    id: string;
    symbol: string;
    provider: string;
    model: string;
    status: string;
    latencyMs: number;
    errorMessage: string;
    createdAt: string;
  }>;
  requests: Array<{
    id: string;
    userId: string | null;
    symbol: string;
    queryPreview: string;
    promptRedacted: boolean;
    feature: string;
    provider: string;
    model: string;
    status: string;
    latencyMs: number;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    errorMessage: string | null;
    createdAt: string;
  }>;
  total: number;
  limit: number;
  offset: number;
  trends: TimeSeriesPoint[];
}

export interface ObservabilityMarketDataResponse {
  freshness: {
    status: 'FRESH' | 'STALE' | 'NEVER_SYNCED';
    lastSyncAt: string | null;
    ageMinutes: number | null;
    staleThresholdMinutes: number;
  };
  summary: {
    classification: 'SIMULATED' | 'DELAYED' | 'LIVE' | 'CACHED' | 'END_OF_DAY' | 'UNAVAILABLE';
    totalInstruments: number;
    enabledRegions: ('IN' | 'US' | 'GLOBAL')[];
    disabledSymbolsCount: number;
    recordedSyncRuns: number;
    totalFailures: number;
    totalValidationFailures: number;
  };
  providers: Array<{
    id: string;
    name: string;
    classification: 'SIMULATED' | 'DELAYED' | 'LIVE' | 'CACHED' | 'END_OF_DAY' | 'UNAVAILABLE';
    status: string;
    symbolsProcessed: number;
    failureCount: number;
    validationFailures: number;
    lastSuccessfulSync: string | null;
    lastFailedSync: string | null;
    latencyMs: number | null;
    note: string;
  }>;
  history: MarketDataHealthDto[];
}

export interface ObservabilityJobsResponse {
  workerHeartbeat: WorkerHeartbeatDto;
  summary: {
    registeredCount: number;
    runningCount: number;
    failedJobsCount: number;
    stuckJobsCount: number;
    queuePaused: boolean;
    totalRunsSampled: number;
    failedRunsCount: number;
    avgWaitMs: number;
    avgDurationMs: number | null;
  };
  jobs: BackgroundJobDto[];
  runs: BackgroundJobRunDto[];
  trends: TimeSeriesPoint[];
}

export interface ObservabilitySecurityResponse {
  range: ObservabilityRangeKey;
  from: string | null;
  to: string;
  summary: {
    totalEvents: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    repeatedFailureSources: Array<{
      ipAddress: string;
      failedAttempts: number;
      classification: string;
    }>;
  };
  events: Array<{
    id: string;
    userId: string | null;
    eventType: string;
    severity: SecurityEventSeverity;
    ipAddress: string;
    userAgent: string;
    detail: string;
    createdAt: string;
  }>;
  total: number;
  limit: number;
  offset: number;
  trends: TimeSeriesPoint[];
}

export interface AlertsListResponse {
  alerts: OperationalAlertDto[];
  total: number;
  limit: number;
  offset: number;
  summary: {
    open: number;
    acknowledged: number;
    resolved: number;
    suppressed: number;
    criticalOpen: number;
  };
}

export const adminApi = {
  getOverview: (range: AdminRangeKey = '7d') =>
    requestAdminJson<AdminOverviewResponse>(`/api/admin/overview?range=${encodeURIComponent(range)}`),

  getNotifications: () => requestAdminJson<AdminNotificationsResponse>('/api/admin/notifications'),

  listUsers: (params: {
    search?: string;
    role?: string;
    status?: string;
    verified?: string;
    sort?: string;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set('search', params.search);
    if (params.role && params.role !== 'ALL') qs.set('role', params.role);
    if (params.status && params.status !== 'ALL') qs.set('status', params.status);
    if (params.verified && params.verified !== 'ALL') qs.set('verified', params.verified);
    if (params.sort) qs.set('sort', params.sort);
    qs.set('limit', String(params.limit ?? 25));
    qs.set('offset', String(params.offset ?? 0));
    return requestAdminJson<{ users: AdminUserSummaryDto[]; total: number; limit: number; offset: number }>(
      `/api/admin/users?${qs.toString()}`,
    );
  },

  getUserDetail: (id: string) =>
    requestAdminJson<AdminUserDetailDto>(`/api/admin/users/${encodeURIComponent(id)}`),

  updateUserProfile: (id: string, body: { fullName?: string; emailVerified?: boolean }) =>
    requestAdminJson<{ updated: true }>(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  suspendUser: (id: string, reason: string) =>
    requestAdminJson<{ userId: string; accountStatus: string }>(
      `/api/admin/users/${encodeURIComponent(id)}/suspend`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),

  restoreUser: (id: string, reason: string) =>
    requestAdminJson<{ userId: string; accountStatus: string }>(
      `/api/admin/users/${encodeURIComponent(id)}/restore`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),

  revokeUserSession: (id: string, sessionId?: string) =>
    requestAdminJson<{ revokedCount: number }>(
      `/api/admin/users/${encodeURIComponent(id)}/sessions/revoke`,
      { method: 'POST', body: JSON.stringify(sessionId ? { sessionId } : {}) },
    ),

  deleteUser: (id: string, confirmEmail: string, confirmPassword: string) =>
    requestAdminJson<{ deleted: true; userId: string }>(
      `/api/admin/users/${encodeURIComponent(id)}`,
      { method: 'DELETE', body: JSON.stringify({ confirmEmail, confirmPassword }) },
    ),

  assignUserRole: (id: string, role: UserRole, reason: string, confirmPassword: string) =>
    requestAdminJson<{ userId: string; role: UserRole }>(
      `/api/admin/users/${encodeURIComponent(id)}/role`,
      { method: 'PATCH', body: JSON.stringify({ role, reason, confirmPassword }) },
    ),

  getAiOverview: () => requestAdminJson<AdminAiOverviewResponse>('/api/admin/ai/overview'),

  updateAiConfig: (patch: {
    activeModel?: string;
    fallbackOnError?: boolean;
    aiEnabled?: boolean;
    maxQueryChars?: number;
  }) =>
    requestAdminJson<{ aiConfig: PlatformConfigBundle['ai_config'] }>('/api/admin/ai/config', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  listPrompts: () => requestAdminJson<{ prompts: AiPromptVersionDto[] }>('/api/admin/ai/prompts'),

  createPrompt: (body: {
    title: string;
    systemPrompt: string;
    userPromptTemplate: string;
    modelTarget?: string;
    notes?: string;
    activateImmediately?: boolean;
  }) =>
    requestAdminJson<{ prompt: AiPromptVersionDto }>('/api/admin/ai/prompts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  activatePrompt: (id: string) =>
    requestAdminJson<{ prompt: AiPromptVersionDto }>(
      `/api/admin/ai/prompts/${encodeURIComponent(id)}/activate`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  getMarketsOverview: async (): Promise<AdminMarketsOverviewResponse> => {
    const [providersRes, symbolsRes] = await Promise.all([
      requestAdminJson<{
        providers: AdminMarketsOverviewResponse['providers'];
        coverage: AdminMarketsOverviewResponse['coverage'];
        config: AdminMarketsOverviewResponse['config'];
      }>('/api/admin/markets/providers'),
      requestAdminJson<{ symbols: AdminMarketsOverviewResponse['symbols'] }>(
        '/api/admin/markets/symbols',
      ),
    ]);
    return {
      providers: providersRes.providers,
      coverage: providersRes.coverage,
      config: providersRes.config,
      symbols: symbolsRes.symbols,
    };
  },

  updateMarketConfig: (patch: { enabledRegions?: ('IN' | 'US' | 'GLOBAL')[]; disabledSymbols?: string[] }) =>
    requestAdminJson<{ marketConfig: PlatformConfigBundle['market_data_config'] }>(
      '/api/admin/markets/config',
      { method: 'PATCH', body: JSON.stringify(patch) },
    ),

  syncMarketCatalog: () =>
    requestAdminJson<{ job: BackgroundJobDto; run: BackgroundJobRunDto }>('/api/admin/markets/sync', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  getApisOverview: (range: AdminRangeKey = '7d') =>
    requestAdminJson<AdminApisOverviewResponse>(`/api/admin/apis/overview?range=${encodeURIComponent(range)}`),

  updateRateLimits: (patch: Partial<PlatformConfigBundle['rate_limits']>) =>
    requestAdminJson<{ rateLimits: PlatformConfigBundle['rate_limits'] }>('/api/admin/apis/rate-limits', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  getSecurityOverview: () =>
    requestAdminJson<AdminSecurityOverviewResponse>('/api/admin/security/overview'),

  createIncident: (body: { title: string; description: string; severity: IncidentSeverity }) =>
    requestAdminJson<{ incident: AdminIncidentDto }>('/api/admin/security/incidents', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateIncident: (
    id: string,
    body: { status?: IncidentStatus; resolutionNotes?: string },
  ) =>
    requestAdminJson<{ incident: AdminIncidentDto }>(
      `/api/admin/security/incidents/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

  getInfrastructureHealth: () =>
    requestAdminJson<AdminInfraHealthResponse>('/api/admin/infrastructure/health'),

  listJobs: () =>
    requestAdminJson<{ jobs: BackgroundJobDto[]; runs: BackgroundJobRunDto[] }>('/api/admin/jobs'),

  retryJob: (id: string) =>
    requestAdminJson<{ job: BackgroundJobDto; run: BackgroundJobRunDto }>(
      `/api/admin/jobs/${encodeURIComponent(id)}/retry`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  cancelJob: (id: string) =>
    requestAdminJson<{ job: BackgroundJobDto }>(
      `/api/admin/jobs/${encodeURIComponent(id)}/cancel`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  getSystemConfig: () => requestAdminJson<AdminSystemConfigResponse>('/api/admin/config'),

  updateSystemConfig: <K extends keyof PlatformConfigBundle>(
    key: K,
    value: PlatformConfigBundle[K],
    reason: string,
  ) =>
    requestAdminJson<{ config: PlatformConfigBundle }>('/api/admin/config', {
      method: 'PATCH',
      body: JSON.stringify({ key, value, reason }),
    }),

  rollbackSystemConfig: (auditId: string, confirmPassword: string) =>
    requestAdminJson<{ config: PlatformConfigBundle }>('/api/admin/config/rollback', {
      method: 'POST',
      body: JSON.stringify({ auditId, confirmPassword }),
    }),

  executeEmergency: (
    operation: 'ENABLE_MAINTENANCE' | 'DISABLE_AI' | 'REVOKE_ALL_NON_ADMIN_SESSIONS',
    reason: string,
    confirmPassword: string,
  ) =>
    requestAdminJson<{ operation: string; detail: string }>('/api/admin/emergency', {
      method: 'POST',
      body: JSON.stringify({ operation, reason, confirmPassword }),
    }),

  listAuditLogs: (params: {
    search?: string;
    action?: string;
    resourceType?: string;
    result?: string;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set('search', params.search);
    if (params.action) qs.set('action', params.action);
    if (params.resourceType && params.resourceType !== 'ALL') qs.set('resourceType', params.resourceType);
    if (params.result && params.result !== 'ALL') qs.set('result', params.result);
    qs.set('limit', String(params.limit ?? 30));
    qs.set('offset', String(params.offset ?? 0));
    return requestAdminJson<{ logs: AdminAuditLogDto[]; total: number; limit: number; offset: number }>(
      `/api/admin/audit-logs?${qs.toString()}`,
    );
  },

  listAnnouncements: () =>
    requestAdminJson<{ announcements: AdminAnnouncementDto[] }>('/api/admin/announcements'),

  createAnnouncement: (body: {
    title: string;
    content: string;
    category: AnnouncementCategory;
    severity: AnnouncementSeverity;
    status: AnnouncementStatus;
  }) =>
    requestAdminJson<{ announcement: AdminAnnouncementDto }>('/api/admin/announcements', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateAnnouncement: (
    id: string,
    patch: {
      title?: string;
      content?: string;
      category?: AnnouncementCategory;
      severity?: AnnouncementSeverity;
      status?: AnnouncementStatus;
    },
  ) =>
    requestAdminJson<{ announcement: AdminAnnouncementDto }>(
      `/api/admin/announcements/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    ),

  deleteAnnouncement: (id: string) =>
    requestAdminJson<{ deleted: true }>(`/api/admin/announcements/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  listSupportTickets: (params: { status?: string; search?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params.status && params.status !== 'ALL') qs.set('status', params.status);
    if (params.search) qs.set('search', params.search);
    qs.set('limit', String(params.limit ?? 30));
    qs.set('offset', String(params.offset ?? 0));
    return requestAdminJson<{ tickets: SupportTicketDto[]; total: number; limit: number; offset: number }>(
      `/api/admin/support?${qs.toString()}`,
    );
  },

  updateSupportTicket: (
    id: string,
    patch: { status?: SupportTicketStatus; priority?: SupportTicketPriority; resolutionNotes?: string },
  ) =>
    requestAdminJson<{ ticket: SupportTicketDto }>(`/api/admin/support/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  getRolesAndPermissions: () =>
    requestAdminJson<{ permissions: Permission[]; roles: AdminRoleCatalogEntry[] }>(
      '/api/admin/permissions',
    ),

  // ---- PHASE 4: OBSERVABILITY, ALERTS & INCIDENTS ----
  getObservabilityOverview: (params: {
    range?: ObservabilityRangeKey;
    from?: string;
    to?: string;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.range) qs.set('range', params.range);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    return requestAdminJson<ObservabilityOverviewResponse>(
      `/api/admin/observability/overview?${qs.toString()}`,
    );
  },

  getObservabilityApi: (params: {
    range?: ObservabilityRangeKey;
    from?: string;
    to?: string;
    endpoint?: string;
    method?: string;
    statusCode?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.range) qs.set('range', params.range);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.endpoint) qs.set('endpoint', params.endpoint);
    if (params.method && params.method !== 'ALL') qs.set('method', params.method);
    if (params.statusCode && params.statusCode !== 'ALL') qs.set('statusCode', params.statusCode);
    qs.set('limit', String(params.limit ?? 30));
    qs.set('offset', String(params.offset ?? 0));
    return requestAdminJson<ObservabilityApiResponse>(
      `/api/admin/observability/api?${qs.toString()}`,
    );
  },

  getObservabilityAi: (params: {
    range?: ObservabilityRangeKey;
    from?: string;
    to?: string;
    status?: string;
    model?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.range) qs.set('range', params.range);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.status && params.status !== 'ALL') qs.set('status', params.status);
    if (params.model && params.model !== 'ALL') qs.set('model', params.model);
    qs.set('limit', String(params.limit ?? 40));
    qs.set('offset', String(params.offset ?? 0));
    return requestAdminJson<ObservabilityAiResponse>(
      `/api/admin/observability/ai?${qs.toString()}`,
    );
  },

  inspectSensitiveAiRequest: (id: string) =>
    requestAdminJson<{
      request: {
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
      };
    }>(`/api/admin/observability/ai/requests/${encodeURIComponent(id)}/inspect`),

  getObservabilityMarketData: (limit = 25) =>
    requestAdminJson<ObservabilityMarketDataResponse>(
      `/api/admin/observability/market-data?limit=${limit}`,
    ),

  getObservabilityJobs: () =>
    requestAdminJson<ObservabilityJobsResponse>('/api/admin/observability/jobs'),

  pauseJobQueue: () =>
    requestAdminJson<{ workerHeartbeat: WorkerHeartbeatDto }>('/api/admin/jobs/queue/pause', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  resumeJobQueue: () =>
    requestAdminJson<{ workerHeartbeat: WorkerHeartbeatDto }>('/api/admin/jobs/queue/resume', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  getObservabilitySecurity: (params: {
    range?: ObservabilityRangeKey;
    from?: string;
    to?: string;
    severity?: string;
    eventType?: string;
    userId?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.range) qs.set('range', params.range);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.severity && params.severity !== 'ALL') qs.set('severity', params.severity);
    if (params.eventType && params.eventType !== 'ALL') qs.set('eventType', params.eventType);
    if (params.userId) qs.set('userId', params.userId);
    qs.set('limit', String(params.limit ?? 40));
    qs.set('offset', String(params.offset ?? 0));
    return requestAdminJson<ObservabilitySecurityResponse>(
      `/api/admin/observability/security?${qs.toString()}`,
    );
  },

  listAlerts: (params: {
    status?: string;
    severity?: string;
    category?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.status && params.status !== 'ALL') qs.set('status', params.status);
    if (params.severity && params.severity !== 'ALL') qs.set('severity', params.severity);
    if (params.category && params.category !== 'ALL') qs.set('category', params.category);
    qs.set('limit', String(params.limit ?? 40));
    qs.set('offset', String(params.offset ?? 0));
    return requestAdminJson<AlertsListResponse>(`/api/admin/alerts?${qs.toString()}`);
  },

  evaluateAlerts: () =>
    requestAdminJson<{
      evaluatedAt: string;
      candidatesDetected: number;
      createdCount: number;
      updatedCount: number;
      created: OperationalAlertDto[];
      updated: OperationalAlertDto[];
    }>('/api/admin/alerts/evaluate', { method: 'POST', body: JSON.stringify({}) }),

  getAlertThresholds: () =>
    requestAdminJson<{ thresholds: ObservabilityThresholdsConfig }>('/api/admin/alerts/thresholds'),

  updateAlertThresholds: (patch: Partial<ObservabilityThresholdsConfig>) =>
    requestAdminJson<{ thresholds: ObservabilityThresholdsConfig }>('/api/admin/alerts/thresholds', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  getAlertDetail: (id: string) =>
    requestAdminJson<{ alert: OperationalAlertDto; history: AlertHistoryDto[] }>(
      `/api/admin/alerts/${encodeURIComponent(id)}`,
    ),

  updateAlert: (
    id: string,
    body: {
      action: 'ACKNOWLEDGE' | 'RESOLVE' | 'SUPPRESS' | 'REOPEN' | 'NOTE';
      note?: string;
      suppressMinutes?: number;
    },
  ) =>
    requestAdminJson<{ alert: OperationalAlertDto }>(`/api/admin/alerts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  listIncidents: (params: { status?: string; severity?: string; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.status && params.status !== 'ALL') qs.set('status', params.status);
    if (params.severity && params.severity !== 'ALL') qs.set('severity', params.severity);
    qs.set('limit', String(params.limit ?? 40));
    qs.set('offset', String(params.offset ?? 0));
    return requestAdminJson<{ incidents: AdminIncidentDto[]; total: number; limit: number; offset: number }>(
      `/api/admin/incidents?${qs.toString()}`,
    );
  },

  getIncidentDetail: (id: string) =>
    requestAdminJson<{ incident: AdminIncidentDto; timeline: IncidentEventDto[] }>(
      `/api/admin/incidents/${encodeURIComponent(id)}`,
    ),

  createIncidentV4: (body: {
    title: string;
    description: string;
    severity: IncidentSeverity;
    source?: string;
    ownerEmail?: string;
    linkedAlertIds?: string[];
    linkedEventRefs?: string[];
  }) =>
    requestAdminJson<{ incident: AdminIncidentDto }>('/api/admin/incidents', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateIncidentV4: (
    id: string,
    body: {
      status?: IncidentStatus;
      resolutionNotes?: string;
      ownerEmail?: string;
      note?: string;
      linkAlertId?: string;
      linkEventRef?: string;
    },
  ) =>
    requestAdminJson<{ incident: AdminIncidentDto }>(`/api/admin/incidents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  // ---- PHASE 5: LIFECYCLE, PRIVACY, BACKUPS, FEATURE FLAGS, RELEASES, GOVERNANCE ----
  getUserLifecycle: (id: string) =>
    requestAdminJson<{ lifecycle: AdminUserLifecycleDetailDto }>(
      `/api/admin/users/${encodeURIComponent(id)}/lifecycle`,
    ),

  addUserAdminNote: (id: string, note: string) =>
    requestAdminJson<{ note: UserAdminNoteDto }>(
      `/api/admin/users/${encodeURIComponent(id)}/notes`,
      { method: 'POST', body: JSON.stringify({ note }) },
    ),

  initiateUserDeletion: (
    id: string,
    body: {
      mode: 'schedule' | 'anonymize_now';
      graceDays?: number;
      reason?: string;
      confirmPassword?: string;
    },
  ) =>
    requestAdminJson<{ lifecycleState: UserLifecycleState; scheduledFor: string | null }>(
      `/api/admin/users/${encodeURIComponent(id)}/lifecycle/deletion`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  cancelUserDeletion: (id: string, reason?: string) =>
    requestAdminJson<{ lifecycleState: UserLifecycleState }>(
      `/api/admin/users/${encodeURIComponent(id)}/lifecycle/deletion/cancel`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),

  getPrivacyQueue: () =>
    requestAdminJson<{
      exportRequests: DataExportRequestDto[];
      deletionRequests: DataDeletionRequestDto[];
      retentionPolicies: {
        exportLinkExpiryHours: number;
        deletionGracePeriodDays: number;
        telemetryRetentionDays: number;
        auditRetentionDays: number;
        backupRetentionCaveat: string;
      };
    }>('/api/admin/privacy/requests'),

  processExportRequest: (id: string, note?: string) =>
    requestAdminJson<{ request: DataExportRequestDto }>(
      `/api/admin/privacy/exports/${encodeURIComponent(id)}/process`,
      { method: 'POST', body: JSON.stringify({ note }) },
    ),

  rejectExportRequest: (id: string, reason: string) =>
    requestAdminJson<{ request: DataExportRequestDto }>(
      `/api/admin/privacy/exports/${encodeURIComponent(id)}/reject`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),

  handleDeletionAction: (
    id: string,
    body: {
      action: 'SCHEDULE' | 'COMPLETE' | 'CANCEL' | 'REJECT';
      graceDays?: number;
      reason?: string;
      confirmPassword?: string;
    },
  ) =>
    requestAdminJson<{ request: DataDeletionRequestDto }>(
      `/api/admin/privacy/deletions/${encodeURIComponent(id)}/action`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  listBackups: () =>
    requestAdminJson<{
      capabilities: {
        dialect: string;
        environment: string;
        isSqliteFile: boolean;
        fullDatabaseBackupSupported: boolean;
        fullDatabaseBackupStatus: 'AVAILABLE' | 'NOT_CONFIGURED';
        fullDatabaseReason: string;
        configSnapshotSupported: boolean;
        configSnapshotNote: string;
      };
      backups: BackupRecordDto[];
      events: BackupVerificationEventDto[];
    }>('/api/admin/backups'),

  createBackup: (backupType: 'CONFIG_SNAPSHOT' | 'SQLITE_SNAPSHOT' | 'FULL_DATABASE') =>
    requestAdminJson<{ backup: BackupRecordDto }>('/api/admin/backups', {
      method: 'POST',
      body: JSON.stringify({ backupType }),
    }),

  verifyBackup: (id: string) =>
    requestAdminJson<{ backup: BackupRecordDto }>(`/api/admin/backups/${encodeURIComponent(id)}/verify`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  restoreBackup: (id: string, confirmPassword: string, confirmPhrase: string) =>
    requestAdminJson<{ restoredType: string; detail: string }>(
      `/api/admin/backups/${encodeURIComponent(id)}/restore`,
      { method: 'POST', body: JSON.stringify({ confirmPassword, confirmPhrase }) },
    ),

  listFeatureFlags: () =>
    requestAdminJson<{
      environment: string;
      flags: FeatureFlagDto[];
      history: FeatureFlagHistoryDto[];
    }>('/api/admin/features'),

  createFeatureFlag: (body: {
    flagKey: string;
    name: string;
    description?: string;
    enabled?: boolean;
    environmentScope?: FeatureEnvScope;
    rolloutPercentage?: number;
    targetRoles?: UserRole[];
    isKillSwitch?: boolean;
    clientExposed?: boolean;
    startsAt?: string | null;
    endsAt?: string | null;
    reason?: string;
  }) =>
    requestAdminJson<{ flag: FeatureFlagDto }>('/api/admin/features', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateFeatureFlag: (
    id: string,
    patch: {
      name?: string;
      description?: string;
      enabled?: boolean;
      environmentScope?: FeatureEnvScope;
      rolloutPercentage?: number;
      targetRoles?: UserRole[];
      isKillSwitch?: boolean;
      clientExposed?: boolean;
      startsAt?: string | null;
      endsAt?: string | null;
      reason?: string;
    },
  ) =>
    requestAdminJson<{ flag: FeatureFlagDto }>(`/api/admin/features/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  rollbackFeatureFlag: (historyId: string) =>
    requestAdminJson<{ flag: FeatureFlagDto }>(
      `/api/admin/features/rollback/${encodeURIComponent(historyId)}`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  getReleasesAndMaintenance: () =>
    requestAdminJson<{
      runtimeMetadata: {
        appName: string;
        version: string;
        nodeVersion: string;
        environment: string;
        dialect: string;
        latestMigration: string;
        ciCdWebhookConfigured: boolean;
        ciCdNote: string;
      };
      effectiveMaintenance: {
        active: boolean;
        bypassed: boolean;
        source: 'manual' | 'window' | 'none';
        message: string;
        expectedCompletionNote: string;
        endsAt: string | null;
        windowId: string | null;
      };
      releases: ReleaseRecordDto[];
      maintenanceWindows: MaintenanceWindowDto[];
    }>('/api/admin/releases'),

  createManualRelease: (body: {
    version: string;
    summary: string;
    commitRef?: string;
    notes?: string;
  }) =>
    requestAdminJson<{ release: ReleaseRecordDto }>('/api/admin/releases', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createMaintenanceWindow: (body: {
    title: string;
    message: string;
    startsAt?: string;
    endsAt?: string | null;
    expectedCompletionNote?: string;
    bypassRoles?: UserRole[];
    activateImmediately?: boolean;
  }) =>
    requestAdminJson<{ window: MaintenanceWindowDto }>('/api/admin/maintenance-windows', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateMaintenanceWindow: (id: string, action: 'activate' | 'complete' | 'cancel') =>
    requestAdminJson<{ window: MaintenanceWindowDto }>(
      `/api/admin/maintenance-windows/${encodeURIComponent(id)}/${action}`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  getTenCategoryConfig: () =>
    requestAdminJson<{
      categories: string[];
      entries: GovernanceConfigEntryView[];
      governancePolicies: PlatformConfigBundle['governance_policies'];
    }>('/api/admin/config/governance'),

  updateGovernancePolicies: (
    policies: Partial<PlatformConfigBundle['governance_policies']>,
    reason: string,
    confirmPassword: string,
  ) =>
    requestAdminJson<{ governancePolicies: PlatformConfigBundle['governance_policies'] }>(
      '/api/admin/config/governance',
      { method: 'PATCH', body: JSON.stringify({ policies, reason, confirmPassword }) },
    ),

  getGovernanceReport: (params: { category?: string; actor?: string; from?: string; to?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.category && params.category !== 'ALL') qs.set('category', params.category);
    if (params.actor) qs.set('actor', params.actor);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    return requestAdminJson<{
      summary: {
        totalUsers: number;
        deletionScheduledCount: number;
        anonymizedAccountsCount: number;
        exportRequestsTotal: number;
        exportPendingCount: number;
        exportReadyCount: number;
        deletionRequestsTotal: number;
        deletionPendingCount: number;
        verifiedBackupsCount: number;
        failedBackupsCount: number;
        featureFlagsTotal: number;
        featureFlagsEnabled: number;
        activeMaintenanceWindows: number;
      };
      readinessDisclaimer: string;
      controlMatrix: Array<{
        control: string;
        status: 'IMPLEMENTED' | 'NOT_CONFIGURED';
        evidence: string;
      }>;
      events: GovernanceEventSummaryDto[];
    }>(`/api/admin/governance/report?${qs.toString()}`);
  },

  // ---- PHASE 6: SUPER CONTROL, AUTOMATION, ACCESS GOVERNANCE, AI POLICIES, EMERGENCY & INTELLIGENCE ----
  getSuperControlOverview: () =>
    requestAdminJson<SuperControlOverviewResponse>('/api/admin/super-control'),

  getAutomationOverview: () =>
    requestAdminJson<AutomationOverviewResponse>('/api/admin/automation'),

  createAutomationWorkflow: (body: {
    workflowKey: string;
    name: string;
    description: string;
    triggerType: AutomationTriggerType;
    actionType: AutomationActionType;
    actionConfig?: Record<string, unknown>;
    scheduleIntervalMinutes?: number | null;
    requiresApproval?: boolean;
    retryLimit?: number;
    timeoutMs?: number;
  }) =>
    requestAdminJson<{ workflow: AutomationWorkflowDto }>('/api/admin/automation/workflows', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateAutomationWorkflowState: (id: string, patch: { enabled?: boolean; isPaused?: boolean }) =>
    requestAdminJson<{ workflow: AutomationWorkflowDto }>(
      `/api/admin/automation/workflows/${encodeURIComponent(id)}/state`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    ),

  setAutomationKillSwitch: (active: boolean, reason: string, confirmPassword: string) =>
    requestAdminJson<{ killSwitchActive: boolean }>('/api/admin/automation/kill-switch', {
      method: 'POST',
      body: JSON.stringify({ active, reason, confirmPassword }),
    }),

  executeAutomationWorkflow: (id: string, body: { idempotencyKey?: string; triggerSource?: string } = {}) =>
    requestAdminJson<{ run: AutomationRunDto; approvalRequestId?: string }>(
      `/api/admin/automation/workflows/${encodeURIComponent(id)}/execute`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  getAccessGovernanceOverview: () =>
    requestAdminJson<AccessGovernanceOverviewResponse>('/api/admin/access-reviews'),

  submitAccessReview: (body: {
    targetUserId: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
    note: string;
    expiresInDays?: number;
  }) =>
    requestAdminJson<{ review: PrivilegedAccessReviewDto }>('/api/admin/access-reviews', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createPrivilegedRequest: (body: {
    actionType: PrivilegedActionType;
    targetResourceType: string;
    targetResourceId: string;
    payload?: Record<string, unknown>;
    reason: string;
    expiresInHours?: number;
  }) =>
    requestAdminJson<{ request: PrivilegedActionRequestDto }>('/api/admin/privileged-requests', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  decidePrivilegedRequest: (
    id: string,
    decision: 'APPROVE' | 'REJECT',
    reason: string,
    confirmPassword: string,
  ) =>
    requestAdminJson<{ request: PrivilegedActionRequestDto }>(
      `/api/admin/privileged-requests/${encodeURIComponent(id)}/decide`,
      { method: 'POST', body: JSON.stringify({ decision, reason, confirmPassword }) },
    ),

  executePrivilegedRequest: (id: string, confirmPassword: string) =>
    requestAdminJson<{ request: PrivilegedActionRequestDto; detail: string }>(
      `/api/admin/privileged-requests/${encodeURIComponent(id)}/execute`,
      { method: 'POST', body: JSON.stringify({ confirmPassword }) },
    ),

  grantEmergencyAccess: (body: {
    targetUserId: string;
    justification: string;
    durationMinutes: number;
    permissions?: Permission[];
    confirmPassword: string;
  }) =>
    requestAdminJson<{ grant: EmergencyAccessGrantDto }>('/api/admin/emergency-access/grant', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  actOnEmergencyAccessGrant: (
    id: string,
    mode: 'revoke' | 'review',
    body: { note: string; confirmPassword?: string },
  ) =>
    requestAdminJson<{ grant: EmergencyAccessGrantDto }>(
      `/api/admin/emergency-access/${encodeURIComponent(id)}/${mode}`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  getAiPoliciesOverview: () =>
    requestAdminJson<AiPolicyOverviewResponse>('/api/admin/ai-policies'),

  createAiPolicyVersion: (body: {
    name: string;
    allowedModels: string[];
    defaultModel: string;
    fallbackModel?: string;
    fallbackEnabled?: boolean;
    providerPriority?: string[];
    rateLimitPerMin?: number;
    maxInputChars?: number;
    maxOutputTokens?: number;
    timeoutMs?: number;
    safetyMode?: 'STANDARD' | 'STRICT';
    redactSensitiveInputs?: boolean;
    blockPromptInjection?: boolean;
    disabledCapabilities?: string[];
    notes?: string;
    activateNow?: boolean;
  }) =>
    requestAdminJson<{ policy: AiPolicyVersionDto }>('/api/admin/ai-policies', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  activateOrRollbackAiPolicy: (
    id: string,
    action: 'activate' | 'rollback',
    confirmPassword: string,
  ) =>
    requestAdminJson<{ policy: AiPolicyVersionDto }>(
      `/api/admin/ai-policies/${encodeURIComponent(id)}/${action}`,
      { method: 'POST', body: JSON.stringify({ confirmPassword }) },
    ),

  executeAiEmergencyControl: (body: {
    control: 'DISABLE_PROVIDER' | 'ENABLE_PROVIDER' | 'ACTIVATE_SAFE_FALLBACK' | 'DISABLE_MODEL' | 'DISABLE_CAPABILITY' | 'ENABLE_CAPABILITY';
    targetValue?: string;
    reason: string;
    confirmPassword: string;
  }) =>
    requestAdminJson<{ detail: string }>('/api/admin/ai-policies/emergency-control', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getEmergencyOverview: () =>
    requestAdminJson<EmergencyOverviewResponse>('/api/admin/emergency-centre'),

  executeEmergencyCentreAction: (body: {
    action: string;
    reason: string;
    playbookKey?: string;
    targetId?: string;
    title?: string;
    severity?: IncidentSeverity;
    confirmPassword?: string;
  }) =>
    requestAdminJson<{ detail: string; event: EmergencyEventDto }>('/api/admin/emergency-centre/action', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getPlatformIntelligence: (range: ObservabilityRangeKey = '24h') =>
    requestAdminJson<PlatformIntelligenceResponse>(
      `/api/admin/intelligence?range=${encodeURIComponent(range)}`,
    ),

  getActionCentre: () => requestAdminJson<ActionCentreResponse>('/api/admin/action-centre'),

  globalSearch: (q: string, limit = 20, offset = 0) =>
    requestAdminJson<{
      query: string;
      results: GlobalSearchResultItemDto[];
      total: number;
      limit: number;
      offset: number;
    }>(
      `/api/admin/search?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`,
    ),
};

export interface SuperControlOverviewResponse {
  operationalStatus: 'OPERATIONAL' | 'DEGRADED' | 'MAINTENANCE';
  metrics: {
    totalUsers: number;
    activeUsers: number;
    suspendedUsers: number;
    openCriticalAlerts: number;
    activeIncidents: number;
    maintenanceActive: boolean;
    pendingPrivacyRequests: number;
    pendingApprovals: number;
    activeEmergencyGrants: number;
    verifiedBackups: number;
    totalBackups: number;
    workflowsCount: number;
    enabledWorkflowsCount: number;
    failedAutomationRuns: number;
    automationKillSwitchActive: boolean;
  };
  serviceStatus: {
    apiHealth: string;
    aiProviderHealth: string;
    marketDataHealth: string;
    workerHealth: string;
    databaseHealth: string;
    fullDatabaseBackupStatus: string;
  };
  unavailableSources: Array<{ key: string; status: string; detail: string }>;
  timeline: UnifiedTimelineItemDto[];
}

export interface AutomationOverviewResponse {
  killSwitchActive: boolean;
  workflows: AutomationWorkflowDto[];
  runs: AutomationRunDto[];
  events: AutomationEventDto[];
  monitoring: {
    successfulExecutions: number;
    failedExecutions: number;
    skippedOrBlockedExecutions: number;
    queuedExecutions: number;
    avgDurationMs: number;
    totalRetries: number;
  };
}

export interface AccessGovernanceOverviewResponse {
  accounts: PrivilegedAccountInspectionDto[];
  reviews: PrivilegedAccessReviewDto[];
  requests: PrivilegedActionRequestDto[];
  requestHistory: PrivilegedActionHistoryDto[];
  emergencyGrants: EmergencyAccessGrantDto[];
  mfaImplementationNote: string;
}

export interface AiPolicyOverviewResponse {
  activePolicy: AiPolicyVersionDto | null;
  versions: AiPolicyVersionDto[];
  approvedModels: string[];
  providerGovernance: {
    primaryProvider: string;
    geminiSecretStatus: 'CONFIGURED' | 'NOT_CONFIGURED';
    aiEnabled: boolean;
    activeModel: string;
    fallbackModel: string;
    fallbackEnabled: boolean;
    providerPriority: string[];
    recentFailureCount: number;
    recentFallbackCount: number;
    recentBlockedCount: number;
  };
  nonAdvisoryDisclaimer: string;
}

export interface EmergencyOverviewResponse {
  overview: {
    activeCriticalAlerts: OperationalAlertDto[];
    openCriticalIncidents: AdminIncidentDto[];
    unhealthyServices: ServiceHealthItem[];
    failedOrStuckJobs: BackgroundJobDto[];
    workerHeartbeat: WorkerHeartbeatDto;
    maintenanceActive: boolean;
    maintenanceMessage: string;
    securityEscalations: Array<{
      id: string;
      eventType: string;
      severity: SecurityEventSeverity;
      ipAddress: string;
      detail: string;
      createdAt: string;
    }>;
  };
  playbooks: EmergencyPlaybookDto[];
  events: EmergencyEventDto[];
}

export interface PlatformIntelligenceResponse {
  window: { range: ObservabilityRangeKey; from: string | null; to: string };
  categories: {
    userActivity: { factType: 'MEASURED' | 'DERIVED'; totalUsers: number; activeUsersInWindow: number; newRegistrationsDeltaPct: number | null };
    platformAvailability: { factType: 'MEASURED' | 'DERIVED'; healthyServices: number; totalServices: number };
    apiPerformance: { factType: 'MEASURED' | 'DERIVED'; requestCount: number; errorRatePct: number; p95LatencyMs: number | null; requestDeltaPct: number | null };
    aiProviderHealth: { factType: 'MEASURED' | 'DERIVED'; totalRequests: number; successCount: number; fallbackCount: number; failedCount: number; avgLatencyMs: number | null };
    marketDataFreshness: { factType: 'MEASURED' | 'DERIVED'; classification: string; lastSyncAt: string | null; stale: boolean };
    backgroundJobReliability: { factType: 'MEASURED' | 'DERIVED'; totalJobs: number; failedJobs: number; workerStatus: string };
    securityActivity: { factType: 'MEASURED' | 'DERIVED'; eventsCount: number; failedLoginsInWindow: number };
    governanceWorkload: { factType: 'MEASURED' | 'DERIVED'; pendingApprovals: number; pendingAccessReviews: number };
    privacyBacklog: { factType: 'MEASURED' | 'DERIVED'; pendingExports: number; pendingDeletions: number };
    backupReadiness: { factType: 'MEASURED' | 'DERIVED'; fullDatabaseBackupSupported: boolean; verifiedBackups: number; unverifiedBackups: number };
    featureFlagDistribution: { factType: 'MEASURED' | 'DERIVED'; totalFlags: number; enabledFlags: number; killSwitchesActive: number };
    incidentTrends: { factType: 'MEASURED' | 'DERIVED'; openIncidents: number; resolvedIncidents: number };
    automationPerformance: { factType: 'MEASURED' | 'DERIVED'; enabledWorkflows: number; succeededRuns: number; failedRuns: number; avgDurationMs: number };
  };
  recommendations: OperationalRecommendationDto[];
}

export interface ActionCentreResponse {
  pendingApprovals: Array<{
    id: string;
    actionType: string;
    targetResourceId: string;
    requestedByEmail: string;
    createdAt: string;
    href: string;
  }>;
  activeAlerts: Array<{
    id: string;
    title: string;
    severity: string;
    category: string;
    href: string;
  }>;
  assignedOrOpenIncidents: Array<{
    id: string;
    title: string;
    severity: string;
    status: string;
    ownerEmail: string;
    href: string;
  }>;
  pendingGovernanceTasks: Array<{
    id: string;
    type: 'DATA_EXPORT' | 'ACCOUNT_DELETION';
    email: string;
    status: string;
    href: string;
  }>;
  failedJobs: Array<{
    id: string;
    name: string;
    href: string;
  }>;
  quickModules: Array<{ label: string; href: string; perm: string }>;
}

export interface UserPrivacySummaryResponse {
  dataInventory: {
    portfolios: number;
    watchlists: number;
    paperOrders: number;
    aiResearchRuns: number;
    savedReports: number;
  };
  retentionPolicies: {
    exportLinkExpiryHours: number;
    deletionGracePeriodDays: number;
    telemetryRetentionDays: number;
    auditRetentionDays: number;
    backupRetentionCaveat: string;
  };
  exportRequests: DataExportRequestDto[];
  deletionRequests: DataDeletionRequestDto[];
  privacyActivity: Array<{
    id: string;
    eventType: string;
    ipAddress: string;
    detail: string;
    createdAt: string;
  }>;
}

export const privacyApi = {
  getSummary: () => requestAdminJson<UserPrivacySummaryResponse>('/api/privacy/summary'),
  requestExport: () =>
    requestAdminJson<{ request: DataExportRequestDto }>('/api/privacy/export', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  requestDeletion: (reason: string) =>
    requestAdminJson<{ request: DataDeletionRequestDto }>('/api/privacy/deletion', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  cancelDeletion: (id: string) =>
    requestAdminJson<{ request: DataDeletionRequestDto }>(
      `/api/privacy/deletion/${encodeURIComponent(id)}/cancel`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
};
