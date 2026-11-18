import type { UserRole } from './db';

export const ROLES = {
  USER: 'user',
  VIEWER: 'viewer',
  SUPPORT_ADMIN: 'support_admin',
  DATA_ADMIN: 'data_admin',
  AI_ADMIN: 'ai_admin',
  SECURITY_ADMIN: 'security_admin',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
} as const satisfies Record<string, UserRole>;

export const ADMIN_ROLES: readonly UserRole[] = [
  ROLES.VIEWER,
  ROLES.SUPPORT_ADMIN,
  ROLES.DATA_ADMIN,
  ROLES.AI_ADMIN,
  ROLES.SECURITY_ADMIN,
  ROLES.ADMIN,
  ROLES.SUPER_ADMIN,
];

export const PERMISSIONS = {
  // End-user workspace permissions
  WORKSPACE_READ: 'workspace:read',
  PORTFOLIO_READ: 'portfolio:read',
  PORTFOLIO_WRITE: 'portfolio:write',
  WATCHLIST_READ: 'watchlist:read',
  WATCHLIST_WRITE: 'watchlist:write',
  PAPER_TRADING_READ: 'paper_trading:read',
  PAPER_TRADING_EXECUTE: 'paper_trading:execute',
  RESEARCH_READ: 'research:read',
  RESEARCH_EXECUTE: 'research:execute',
  RESEARCH_WRITE: 'research:write',
  REPORTS_READ: 'reports:read',
  REPORTS_WRITE: 'reports:write',
  PREFERENCES_READ: 'preferences:read',
  PREFERENCES_WRITE: 'preferences:write',
  ACCOUNT_SELF: 'account:self',

  // Phase 3 Admin Control Centre granular permissions
  ADMIN_CONSOLE_READ: 'admin:console:read',
  ADMIN_USERS_READ: 'admin:users:read',
  ADMIN_USERS_MANAGE: 'admin:users:manage',
  ADMIN_USERS_DELETE: 'admin:users:delete',
  ADMIN_SESSIONS_MANAGE: 'admin:sessions:manage',
  ADMIN_AI_READ: 'admin:ai:read',
  ADMIN_AI_MANAGE: 'admin:ai:manage',
  ADMIN_MARKETS_READ: 'admin:markets:read',
  ADMIN_MARKETS_MANAGE: 'admin:markets:manage',
  ADMIN_APIS_READ: 'admin:apis:read',
  ADMIN_APIS_MANAGE: 'admin:apis:manage',
  ADMIN_SECURITY_READ: 'admin:security:read',
  ADMIN_SECURITY_MANAGE: 'admin:security:manage',
  ADMIN_INFRASTRUCTURE_READ: 'admin:infrastructure:read',
  ADMIN_JOBS_READ: 'admin:jobs:read',
  ADMIN_JOBS_MANAGE: 'admin:jobs:manage',
  ADMIN_SYSTEM_READ: 'admin:system:read',
  ADMIN_SYSTEM_MANAGE: 'admin:system:manage',
  ADMIN_AUDIT_READ: 'admin:audit:read',
  ADMIN_ROLES_READ: 'admin:roles:read',
  ADMIN_ROLES_ASSIGN: 'admin:roles:assign',
  ADMIN_ANNOUNCEMENTS_READ: 'admin:announcements:read',
  ADMIN_ANNOUNCEMENTS_MANAGE: 'admin:announcements:manage',
  ADMIN_SUPPORT_READ: 'admin:support:read',
  ADMIN_SUPPORT_MANAGE: 'admin:support:manage',
  ADMIN_EMERGENCY_EXECUTE: 'admin:emergency:execute',

  // Phase 4 Platform Intelligence, Alerting & Incident Response permissions
  ADMIN_ALERTS_READ: 'admin:alerts:read',
  ADMIN_ALERTS_MANAGE: 'admin:alerts:manage',
  ADMIN_INCIDENTS_READ: 'admin:incidents:read',
  ADMIN_INCIDENTS_MANAGE: 'admin:incidents:manage',
  ADMIN_AI_INSPECT_SENSITIVE: 'admin:ai:inspect_sensitive',

  // Phase 5 Platform Governance, Privacy, Recovery, Feature Flags & Release permissions
  ADMIN_USERS_LIFECYCLE: 'admin:users:lifecycle',
  ADMIN_PRIVACY_READ: 'admin:privacy:read',
  ADMIN_PRIVACY_MANAGE: 'admin:privacy:manage',
  ADMIN_BACKUP_READ: 'admin:backup:read',
  ADMIN_BACKUP_CREATE: 'admin:backup:create',
  ADMIN_BACKUP_RESTORE: 'admin:backup:restore',
  ADMIN_FEATURES_READ: 'admin:features:read',
  ADMIN_FEATURES_MANAGE: 'admin:features:manage',
  ADMIN_RELEASES_READ: 'admin:releases:read',
  ADMIN_RELEASES_MANAGE: 'admin:releases:manage',
  ADMIN_MAINTENANCE_MANAGE: 'admin:maintenance:manage',
  ADMIN_GOVERNANCE_READ: 'admin:governance:read',
  ADMIN_GOVERNANCE_EXPORT: 'admin:governance:export',

  // Phase 6 Super Admin Operations, Automation, Access Reviews & Emergency permissions
  ADMIN_SUPER_CONTROL_READ: 'admin:super_control:read',
  ADMIN_AUTOMATION_READ: 'admin:automation:read',
  ADMIN_AUTOMATION_MANAGE: 'admin:automation:manage',
  ADMIN_AUTOMATION_EXECUTE: 'admin:automation:execute',
  ADMIN_ACCESS_REVIEW_READ: 'admin:access_review:read',
  ADMIN_ACCESS_REVIEW_MANAGE: 'admin:access_review:manage',
  ADMIN_PRIVILEGED_ACTIONS_REQUEST: 'admin:privileged_actions:request',
  ADMIN_PRIVILEGED_ACTIONS_APPROVE: 'admin:privileged_actions:approve',
  ADMIN_AI_POLICY_READ: 'admin:ai_policy:read',
  ADMIN_AI_POLICY_MANAGE: 'admin:ai_policy:manage',
  ADMIN_EMERGENCY_READ: 'admin:emergency:read',
  ADMIN_EMERGENCY_MANAGE: 'admin:emergency:manage',
  ADMIN_INTELLIGENCE_READ: 'admin:intelligence:read',
  ADMIN_GLOBAL_SEARCH_READ: 'admin:global_search:read',

  // Compatibility aliases from Phase 2
  SUPER_ADMIN_ROLES_ASSIGN: 'super_admin:roles:assign',
  SUPER_ADMIN_PLATFORM_CONTROL: 'super_admin:platform:control',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const USER_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.WORKSPACE_READ,
  PERMISSIONS.PORTFOLIO_READ,
  PERMISSIONS.PORTFOLIO_WRITE,
  PERMISSIONS.WATCHLIST_READ,
  PERMISSIONS.WATCHLIST_WRITE,
  PERMISSIONS.PAPER_TRADING_READ,
  PERMISSIONS.PAPER_TRADING_EXECUTE,
  PERMISSIONS.RESEARCH_READ,
  PERMISSIONS.RESEARCH_EXECUTE,
  PERMISSIONS.RESEARCH_WRITE,
  PERMISSIONS.REPORTS_READ,
  PERMISSIONS.REPORTS_WRITE,
  PERMISSIONS.PREFERENCES_READ,
  PERMISSIONS.PREFERENCES_WRITE,
  PERMISSIONS.ACCOUNT_SELF,
];

const VIEWER_PERMISSIONS: readonly Permission[] = [
  ...USER_PERMISSIONS,
  PERMISSIONS.ADMIN_CONSOLE_READ,
  PERMISSIONS.ADMIN_USERS_READ,
  PERMISSIONS.ADMIN_AI_READ,
  PERMISSIONS.ADMIN_MARKETS_READ,
  PERMISSIONS.ADMIN_APIS_READ,
  PERMISSIONS.ADMIN_SECURITY_READ,
  PERMISSIONS.ADMIN_INFRASTRUCTURE_READ,
  PERMISSIONS.ADMIN_JOBS_READ,
  PERMISSIONS.ADMIN_SYSTEM_READ,
  PERMISSIONS.ADMIN_AUDIT_READ,
  PERMISSIONS.ADMIN_ROLES_READ,
  PERMISSIONS.ADMIN_ANNOUNCEMENTS_READ,
  PERMISSIONS.ADMIN_SUPPORT_READ,
  PERMISSIONS.ADMIN_ALERTS_READ,
  PERMISSIONS.ADMIN_INCIDENTS_READ,
  PERMISSIONS.ADMIN_PRIVACY_READ,
  PERMISSIONS.ADMIN_BACKUP_READ,
  PERMISSIONS.ADMIN_FEATURES_READ,
  PERMISSIONS.ADMIN_RELEASES_READ,
  PERMISSIONS.ADMIN_GOVERNANCE_READ,
  PERMISSIONS.ADMIN_AUTOMATION_READ,
  PERMISSIONS.ADMIN_ACCESS_REVIEW_READ,
  PERMISSIONS.ADMIN_AI_POLICY_READ,
  PERMISSIONS.ADMIN_EMERGENCY_READ,
  PERMISSIONS.ADMIN_INTELLIGENCE_READ,
  PERMISSIONS.ADMIN_GLOBAL_SEARCH_READ,
];

const SUPPORT_ADMIN_PERMISSIONS: readonly Permission[] = [
  ...USER_PERMISSIONS,
  PERMISSIONS.ADMIN_CONSOLE_READ,
  PERMISSIONS.ADMIN_USERS_READ,
  PERMISSIONS.ADMIN_ANNOUNCEMENTS_READ,
  PERMISSIONS.ADMIN_ANNOUNCEMENTS_MANAGE,
  PERMISSIONS.ADMIN_SUPPORT_READ,
  PERMISSIONS.ADMIN_SUPPORT_MANAGE,
  PERMISSIONS.ADMIN_PRIVACY_READ,
  PERMISSIONS.ADMIN_GLOBAL_SEARCH_READ,
];

const DATA_ADMIN_PERMISSIONS: readonly Permission[] = [
  ...USER_PERMISSIONS,
  PERMISSIONS.ADMIN_CONSOLE_READ,
  PERMISSIONS.ADMIN_MARKETS_READ,
  PERMISSIONS.ADMIN_MARKETS_MANAGE,
  PERMISSIONS.ADMIN_JOBS_READ,
  PERMISSIONS.ADMIN_JOBS_MANAGE,
  PERMISSIONS.ADMIN_INFRASTRUCTURE_READ,
  PERMISSIONS.ADMIN_ALERTS_READ,
  PERMISSIONS.ADMIN_BACKUP_READ,
  PERMISSIONS.ADMIN_BACKUP_CREATE,
  PERMISSIONS.ADMIN_FEATURES_READ,
  PERMISSIONS.ADMIN_RELEASES_READ,
  PERMISSIONS.ADMIN_AUTOMATION_READ,
  PERMISSIONS.ADMIN_PRIVILEGED_ACTIONS_REQUEST,
  PERMISSIONS.ADMIN_INTELLIGENCE_READ,
  PERMISSIONS.ADMIN_GLOBAL_SEARCH_READ,
];

const AI_ADMIN_PERMISSIONS: readonly Permission[] = [
  ...USER_PERMISSIONS,
  PERMISSIONS.ADMIN_CONSOLE_READ,
  PERMISSIONS.ADMIN_AI_READ,
  PERMISSIONS.ADMIN_AI_MANAGE,
  PERMISSIONS.ADMIN_AI_INSPECT_SENSITIVE,
  PERMISSIONS.ADMIN_APIS_READ,
  PERMISSIONS.ADMIN_INFRASTRUCTURE_READ,
  PERMISSIONS.ADMIN_ALERTS_READ,
  PERMISSIONS.ADMIN_FEATURES_READ,
  PERMISSIONS.ADMIN_RELEASES_READ,
  PERMISSIONS.ADMIN_AI_POLICY_READ,
  PERMISSIONS.ADMIN_AI_POLICY_MANAGE,
  PERMISSIONS.ADMIN_PRIVILEGED_ACTIONS_REQUEST,
  PERMISSIONS.ADMIN_INTELLIGENCE_READ,
  PERMISSIONS.ADMIN_GLOBAL_SEARCH_READ,
];

const SECURITY_ADMIN_PERMISSIONS: readonly Permission[] = [
  ...USER_PERMISSIONS,
  PERMISSIONS.ADMIN_CONSOLE_READ,
  PERMISSIONS.ADMIN_USERS_READ,
  PERMISSIONS.ADMIN_USERS_MANAGE,
  PERMISSIONS.ADMIN_USERS_LIFECYCLE,
  PERMISSIONS.ADMIN_SESSIONS_MANAGE,
  PERMISSIONS.ADMIN_APIS_READ,
  PERMISSIONS.ADMIN_SECURITY_READ,
  PERMISSIONS.ADMIN_SECURITY_MANAGE,
  PERMISSIONS.ADMIN_AUDIT_READ,
  PERMISSIONS.ADMIN_INFRASTRUCTURE_READ,
  PERMISSIONS.ADMIN_ROLES_READ,
  PERMISSIONS.ADMIN_ALERTS_READ,
  PERMISSIONS.ADMIN_ALERTS_MANAGE,
  PERMISSIONS.ADMIN_INCIDENTS_READ,
  PERMISSIONS.ADMIN_INCIDENTS_MANAGE,
  PERMISSIONS.ADMIN_PRIVACY_READ,
  PERMISSIONS.ADMIN_PRIVACY_MANAGE,
  PERMISSIONS.ADMIN_BACKUP_READ,
  PERMISSIONS.ADMIN_RELEASES_READ,
  PERMISSIONS.ADMIN_MAINTENANCE_MANAGE,
  PERMISSIONS.ADMIN_GOVERNANCE_READ,
  PERMISSIONS.ADMIN_GOVERNANCE_EXPORT,
  PERMISSIONS.ADMIN_AUTOMATION_READ,
  PERMISSIONS.ADMIN_ACCESS_REVIEW_READ,
  PERMISSIONS.ADMIN_ACCESS_REVIEW_MANAGE,
  PERMISSIONS.ADMIN_PRIVILEGED_ACTIONS_REQUEST,
  PERMISSIONS.ADMIN_PRIVILEGED_ACTIONS_APPROVE,
  PERMISSIONS.ADMIN_EMERGENCY_READ,
  PERMISSIONS.ADMIN_EMERGENCY_MANAGE,
  PERMISSIONS.ADMIN_INTELLIGENCE_READ,
  PERMISSIONS.ADMIN_GLOBAL_SEARCH_READ,
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...VIEWER_PERMISSIONS,
  PERMISSIONS.ADMIN_USERS_MANAGE,
  PERMISSIONS.ADMIN_USERS_LIFECYCLE,
  PERMISSIONS.ADMIN_SESSIONS_MANAGE,
  PERMISSIONS.ADMIN_AI_MANAGE,
  PERMISSIONS.ADMIN_AI_INSPECT_SENSITIVE,
  PERMISSIONS.ADMIN_MARKETS_MANAGE,
  PERMISSIONS.ADMIN_APIS_MANAGE,
  PERMISSIONS.ADMIN_SECURITY_MANAGE,
  PERMISSIONS.ADMIN_JOBS_MANAGE,
  PERMISSIONS.ADMIN_SYSTEM_MANAGE,
  PERMISSIONS.ADMIN_ANNOUNCEMENTS_MANAGE,
  PERMISSIONS.ADMIN_SUPPORT_MANAGE,
  PERMISSIONS.ADMIN_ALERTS_MANAGE,
  PERMISSIONS.ADMIN_INCIDENTS_MANAGE,
  PERMISSIONS.ADMIN_PRIVACY_MANAGE,
  PERMISSIONS.ADMIN_BACKUP_CREATE,
  PERMISSIONS.ADMIN_FEATURES_MANAGE,
  PERMISSIONS.ADMIN_RELEASES_MANAGE,
  PERMISSIONS.ADMIN_MAINTENANCE_MANAGE,
  PERMISSIONS.ADMIN_GOVERNANCE_EXPORT,
  PERMISSIONS.ADMIN_AUTOMATION_MANAGE,
  PERMISSIONS.ADMIN_AUTOMATION_EXECUTE,
  PERMISSIONS.ADMIN_PRIVILEGED_ACTIONS_REQUEST,
  PERMISSIONS.ADMIN_AI_POLICY_MANAGE,
  PERMISSIONS.ADMIN_EMERGENCY_MANAGE,
];

const SUPER_ADMIN_PERMISSIONS: readonly Permission[] = [
  ...ADMIN_PERMISSIONS,
  PERMISSIONS.ADMIN_USERS_DELETE,
  PERMISSIONS.ADMIN_BACKUP_RESTORE,
  PERMISSIONS.ADMIN_ROLES_ASSIGN,
  PERMISSIONS.ADMIN_EMERGENCY_EXECUTE,
  PERMISSIONS.ADMIN_SUPER_CONTROL_READ,
  PERMISSIONS.ADMIN_ACCESS_REVIEW_MANAGE,
  PERMISSIONS.ADMIN_PRIVILEGED_ACTIONS_APPROVE,
  PERMISSIONS.SUPER_ADMIN_ROLES_ASSIGN,
  PERMISSIONS.SUPER_ADMIN_PLATFORM_CONTROL,
];

export const ROLE_PERMISSION_MATRIX: Record<UserRole, readonly Permission[]> = {
  user: USER_PERMISSIONS,
  viewer: VIEWER_PERMISSIONS,
  support_admin: SUPPORT_ADMIN_PERMISSIONS,
  data_admin: DATA_ADMIN_PERMISSIONS,
  ai_admin: AI_ADMIN_PERMISSIONS,
  security_admin: SECURITY_ADMIN_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  super_admin: SUPER_ADMIN_PERMISSIONS,
};

export interface RoleCatalogEntry {
  role: UserRole;
  label: string;
  description: string;
  tier: 'STANDARD' | 'SPECIALIST' | 'EXECUTIVE';
  permissions: readonly Permission[];
}

export const ROLE_CATALOG: readonly RoleCatalogEntry[] = [
  {
    role: 'super_admin',
    label: 'Super Admin',
    description: 'Complete platform control, role governance, user deletion, and emergency recovery.',
    tier: 'EXECUTIVE',
    permissions: SUPER_ADMIN_PERMISSIONS,
  },
  {
    role: 'admin',
    label: 'Platform Admin',
    description: 'Operational platform management across users, AI, markets, config, and communications.',
    tier: 'EXECUTIVE',
    permissions: ADMIN_PERMISSIONS,
  },
  {
    role: 'security_admin',
    label: 'Security Admin',
    description: 'Security Centre, sessions revocation, incident response, user suspension, and audit inspection.',
    tier: 'SPECIALIST',
    permissions: SECURITY_ADMIN_PERMISSIONS,
  },
  {
    role: 'ai_admin',
    label: 'AI Admin',
    description: 'AI provider model controls, fallback settings, prompt versioning, and AI usage telemetry.',
    tier: 'SPECIALIST',
    permissions: AI_ADMIN_PERMISSIONS,
  },
  {
    role: 'data_admin',
    label: 'Data Admin',
    description: 'Market data providers, exchange coverage, symbol mappings, and synchronization jobs.',
    tier: 'SPECIALIST',
    permissions: DATA_ADMIN_PERMISSIONS,
  },
  {
    role: 'support_admin',
    label: 'Support Admin',
    description: 'Support ticket triage, contact submission resolution, and platform announcements.',
    tier: 'SPECIALIST',
    permissions: SUPPORT_ADMIN_PERMISSIONS,
  },
  {
    role: 'viewer',
    label: 'Admin Viewer',
    description: 'Read-only administrative visibility across metrics, users, audits, and system health.',
    tier: 'SPECIALIST',
    permissions: VIEWER_PERMISSIONS,
  },
  {
    role: 'user',
    label: 'Standard User',
    description: 'Authenticated personal financial workspace without administrative console access.',
    tier: 'STANDARD',
    permissions: USER_PERMISSIONS,
  },
];

const VALID_ROLES = new Set<UserRole>(ROLE_CATALOG.map((r) => r.role));
const ADMIN_ROLE_SET = new Set<UserRole>(ADMIN_ROLES);

export function normalizeUserRole(rawRole: unknown): UserRole {
  if (typeof rawRole !== 'string') return 'user';
  const normalized = rawRole.trim().toLowerCase() as UserRole;
  return VALID_ROLES.has(normalized) ? normalized : 'user';
}

export function isValidUserRole(rawRole: unknown): rawRole is UserRole {
  if (typeof rawRole !== 'string') return false;
  return VALID_ROLES.has(rawRole.trim().toLowerCase() as UserRole);
}

export function isAdminRole(rawRole: unknown): boolean {
  return ADMIN_ROLE_SET.has(normalizeUserRole(rawRole));
}

export function resolveUserPermissions(role: unknown): Permission[] {
  const canonical = normalizeUserRole(role);
  return [...ROLE_PERMISSION_MATRIX[canonical]];
}

export function hasRole(userRole: unknown, allowedRoles: readonly UserRole[]): boolean {
  const canonical = normalizeUserRole(userRole);
  return allowedRoles.includes(canonical);
}

export function hasPermission(userRole: unknown, required: Permission): boolean {
  const canonical = normalizeUserRole(userRole);
  return ROLE_PERMISSION_MATRIX[canonical].includes(required);
}

export function hasAllPermissions(
  userRole: unknown,
  requiredPermissions: readonly Permission[],
): boolean {
  const canonical = normalizeUserRole(userRole);
  const granted = ROLE_PERMISSION_MATRIX[canonical];
  return requiredPermissions.every((perm) => granted.includes(perm));
}
