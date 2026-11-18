import React, { useMemo, useState } from 'react';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { PERMISSIONS, Permission, isAdminRole } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import { AdminLayout } from './AdminLayout';
import { AdminOverviewView } from './AdminOverviewView';
import { AdminUsersView } from './AdminUsersView';
import { AdminUserDetailView } from './AdminUserDetailView';
import { AdminAiView } from './AdminAiView';
import { AdminMarketsView } from './AdminMarketsView';
import { AdminApisView } from './AdminApisView';
import { AdminSecurityView } from './AdminSecurityView';
import { AdminAlertsView } from './AdminAlertsView';
import { AdminIncidentsView } from './AdminIncidentsView';
import { AdminInfrastructureView, AdminJobsView } from './AdminInfraAndJobsViews';
import { AdminAuditLogsView, AdminConfigView } from './AdminConfigAndLogsViews';
import {
  AdminAccessControlView,
  AdminAnnouncementsView,
  AdminSettingsView,
  AdminSupportView,
} from './AdminAccessAndCommViews';
import { AdminPrivacyView } from './AdminPrivacyView';
import { AdminBackupsView } from './AdminBackupsView';
import { AdminFeaturesView } from './AdminFeaturesView';
import { AdminReleasesView } from './AdminReleasesView';
import { AdminGovernanceView } from './AdminGovernanceView';
import { AdminSuperControlView } from './AdminSuperControlView';
import { AdminAutomationView } from './AdminAutomationView';
import { AdminAccessReviewsView } from './AdminAccessReviewsView';
import { AdminAiPoliciesView } from './AdminAiPoliciesView';
import { AdminEmergencyView } from './AdminEmergencyView';
import { AdminIntelligenceView } from './AdminIntelligenceView';

interface AdminConsoleAppProps {
  pathname: string;
  search: string;
  onNavigate: (href: string) => void;
}

interface RouteMeta {
  title: string;
  subtitle: string;
  permission: Permission;
}

function resolveRouteMeta(pathname: string): RouteMeta {
  if (/^\/admin\/users\/[A-Za-z0-9_-]{4,80}$/.test(pathname)) {
    return {
      title: 'User Inspector',
      subtitle: 'Inspect identity, workspace counts, active sessions, and RBAC assignments',
      permission: PERMISSIONS.ADMIN_USERS_READ,
    };
  }
  switch (pathname) {
    case '/admin/users':
      return {
        title: 'User Management',
        subtitle: 'Search accounts, audit sessions, suspend/restore, and manage administrative roles',
        permission: PERMISSIONS.ADMIN_USERS_READ,
      };
    case '/admin/ai':
      return {
        title: 'AI Control Centre',
        subtitle: 'Gemini runtime policy, prompt template versioning, and request telemetry',
        permission: PERMISSIONS.ADMIN_AI_READ,
      };
    case '/admin/markets':
      return {
        title: 'Market Data Management',
        subtitle: 'Curated snapshot classification, region gating, and symbol governance',
        permission: PERMISSIONS.ADMIN_MARKETS_READ,
      };
    case '/admin/apis':
      return {
        title: 'API & Integration Operations',
        subtitle: 'Endpoint throughput, error rates, external credential status, and rate-limit rules',
        permission: PERMISSIONS.ADMIN_APIS_READ,
      };
    case '/admin/security':
      return {
        title: 'Security Centre',
        subtitle: 'Auth monitoring, severity classification, Cloudflare baseline, and repeated failure detection',
        permission: PERMISSIONS.ADMIN_SECURITY_READ,
      };
    case '/admin/alerts':
      return {
        title: 'Operational Alerts & Rules',
        subtitle: 'Threshold-driven alert lifecycle, deduplication, cooldowns, acknowledgements, and history',
        permission: PERMISSIONS.ADMIN_ALERTS_READ,
      };
    case '/admin/incidents':
      return {
        title: 'Incident Response & Timelines',
        subtitle: 'Structured incident triage workflow, owner assignment, linked telemetry, and immutable events',
        permission: PERMISSIONS.ADMIN_INCIDENTS_READ,
      };
    case '/admin/infrastructure':
      return {
        title: 'Infrastructure Monitoring',
        subtitle: 'Node.js process memory, database pool latency, and 5xx ring buffer',
        permission: PERMISSIONS.ADMIN_INFRASTRUCTURE_READ,
      };
    case '/admin/jobs':
      return {
        title: 'Background Jobs',
        subtitle: 'On-demand execution & history for registered maintenance and sync jobs',
        permission: PERMISSIONS.ADMIN_JOBS_READ,
      };
    case '/admin/configuration':
      return {
        title: 'System Configuration',
        subtitle: 'Feature flags, maintenance mode gate, snapshot rollback, and emergency controls',
        permission: PERMISSIONS.ADMIN_SYSTEM_READ,
      };
    case '/admin/audit-logs':
      return {
        title: 'Audit Logs',
        subtitle: 'Append-only immutable log of all privileged operations and access denials',
        permission: PERMISSIONS.ADMIN_AUDIT_READ,
      };
    case '/admin/announcements':
      return {
        title: 'Platform Announcements',
        subtitle: 'Compose and publish workspace & public system notices',
        permission: PERMISSIONS.ADMIN_ANNOUNCEMENTS_READ,
      };
    case '/admin/support':
      return {
        title: 'Support Tickets',
        subtitle: 'Triage public /contact submissions and record resolution notes',
        permission: PERMISSIONS.ADMIN_SUPPORT_READ,
      };
    case '/admin/access-control':
      return {
        title: 'Access Control & RBAC',
        subtitle: 'Inspect specialized admin roles and granular server-enforced permissions',
        permission: PERMISSIONS.ADMIN_ROLES_READ,
      };
    case '/admin/settings':
      return {
        title: 'Admin Profile & Sessions',
        subtitle: 'Personal administrator account details and active browser sessions',
        permission: PERMISSIONS.ADMIN_CONSOLE_READ,
      };
    case '/admin/privacy':
      return {
        title: 'Data Governance & Privacy Centre',
        subtitle: 'User personal data export queue, grace-period deletion workflows, and retention rules',
        permission: PERMISSIONS.ADMIN_PRIVACY_READ,
      };
    case '/admin/backups':
      return {
        title: 'Backup & Disaster Recovery',
        subtitle: 'Capability-honest database & config snapshots, integrity checks, and guarded restore',
        permission: PERMISSIONS.ADMIN_BACKUP_READ,
      };
    case '/admin/features':
      return {
        title: 'Feature Flags & Rollouts',
        subtitle: 'Deterministic percentage rollouts, role targeting, kill switches, and rollback history',
        permission: PERMISSIONS.ADMIN_FEATURES_READ,
      };
    case '/admin/releases':
      return {
        title: 'Releases & Maintenance Windows',
        subtitle: 'Process build metadata, release ledger, and scheduled maintenance governance',
        permission: PERMISSIONS.ADMIN_RELEASES_READ,
      };
    case '/admin/governance':
      return {
        title: 'Compliance & Governance Reporting',
        subtitle: 'Cross-domain governance ledger, control readiness matrix, and formula-safe CSV export',
        permission: PERMISSIONS.ADMIN_GOVERNANCE_READ,
      };
    case '/admin/super-control':
      return {
        title: 'Super Admin Command Centre',
        subtitle: 'Unified platform control plane, cross-domain status, and executive operational timeline',
        permission: PERMISSIONS.ADMIN_SUPER_CONTROL_READ,
      };
    case '/admin/automation':
      return {
        title: 'Governed Automation Engine',
        subtitle: 'Bounded predefined playbooks, idempotency protection, retries, approval gates & kill switch',
        permission: PERMISSIONS.ADMIN_AUTOMATION_READ,
      };
    case '/admin/access-reviews':
      return {
        title: 'Privileged Access Governance',
        subtitle: 'Access reviews, separation-of-duties approvals, and time-limited emergency access grants',
        permission: PERMISSIONS.ADMIN_ACCESS_REVIEW_READ,
      };
    case '/admin/ai-policies':
      return {
        title: 'AI Operations Governance',
        subtitle: 'Versioned model allowlists, safety & injection guards, rollback, and provider emergency controls',
        permission: PERMISSIONS.ADMIN_AI_POLICY_READ,
      };
    case '/admin/emergency':
      return {
        title: 'Emergency Response Centre',
        subtitle: 'Live crisis telemetry, documented runbooks, and reversible emergency circuit breakers',
        permission: PERMISSIONS.ADMIN_EMERGENCY_READ,
      };
    case '/admin/intelligence':
      return {
        title: 'Platform-Wide Intelligence',
        subtitle: '13-domain measured operational analytics and evidence-backed administrative recommendations',
        permission: PERMISSIONS.ADMIN_INTELLIGENCE_READ,
      };
    default:
      return {
        title: 'Command Centre',
        subtitle: 'Unified Nextrade AI operational overview',
        permission: PERMISSIONS.ADMIN_CONSOLE_READ,
      };
  }
}

export const AdminConsoleApp: React.FC<AdminConsoleAppProps> = ({
  pathname,
  search,
  onNavigate,
}) => {
  const { user } = useAuth();
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  const userPerms = useMemo(() => new Set<string>(user?.permissions ?? []), [user?.permissions]);
  const initialUserSearch = useMemo(() => {
    try {
      return new URLSearchParams(search).get('search') ?? '';
    } catch {
      return '';
    }
  }, [search]);
  const initialAlertId = useMemo(() => {
    try {
      return new URLSearchParams(search).get('alertId') ?? '';
    } catch {
      return '';
    }
  }, [search]);
  const meta = resolveRouteMeta(pathname);

  if (!user || !isAdminRole(user.role)) {
    return (
      <div className="min-h-screen bg-[#F7F8FA] text-[#080B12] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-xl border border-[#FECACA] bg-[#FFFFFF] p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#DC2626]">
                HTTP 403 · Forbidden
              </p>
              <h1 className="font-display text-base font-bold text-[#080B12]">
                Administrative Privileges Required
              </h1>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-[#475467]">
            Your account does not hold an administrative role permitted to access the Nextrade AI Control Centre. This authorization boundary is enforced server-side.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => onNavigate('/app')}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2D46E6] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Return to Workspace</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="inline-flex h-9 items-center rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-4 text-xs font-semibold text-[#080B12] hover:bg-[#F7F8FA] cursor-pointer"
            >
              Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const hasRoutePermission = userPerms.has(meta.permission);
  const userDetailMatch = /^\/admin\/users\/([A-Za-z0-9_-]{4,80})$/.exec(pathname);

  const renderContent = () => {
    if (!hasRoutePermission) {
      return (
        <div className="rounded-lg border border-[#FECACA] bg-[#FFFFFF] p-6 space-y-2">
          <div className="font-mono text-xs font-bold uppercase text-[#DC2626]">
            Permission Required: {meta.permission}
          </div>
          <p className="text-xs text-[#475467]">
            Your current role (<code className="font-mono">{user.role}</code>) is scoped cleanly and cannot access this module.
          </p>
        </div>
      );
    }

    if (userDetailMatch) {
      return <AdminUserDetailView userId={userDetailMatch[1]} onNavigate={onNavigate} />;
    }

    switch (pathname) {
      case '/admin/users':
        return <AdminUsersView onNavigate={onNavigate} initialSearch={initialUserSearch} />;
      case '/admin/ai':
        return <AdminAiView />;
      case '/admin/markets':
        return <AdminMarketsView />;
      case '/admin/apis':
        return <AdminApisView />;
      case '/admin/security':
        return <AdminSecurityView onNavigate={onNavigate} />;
      case '/admin/alerts':
        return <AdminAlertsView onNavigate={onNavigate} />;
      case '/admin/incidents':
        return <AdminIncidentsView initialLinkedAlertId={initialAlertId} />;
      case '/admin/infrastructure':
        return <AdminInfrastructureView />;
      case '/admin/jobs':
        return <AdminJobsView />;
      case '/admin/configuration':
        return <AdminConfigView onMaintenanceUpdated={setMaintenanceMode} />;
      case '/admin/audit-logs':
        return <AdminAuditLogsView />;
      case '/admin/announcements':
        return <AdminAnnouncementsView />;
      case '/admin/support':
        return <AdminSupportView />;
      case '/admin/access-control':
        return <AdminAccessControlView />;
      case '/admin/settings':
        return <AdminSettingsView onNavigate={onNavigate} />;
      case '/admin/privacy':
        return <AdminPrivacyView />;
      case '/admin/backups':
        return <AdminBackupsView />;
      case '/admin/features':
        return <AdminFeaturesView />;
      case '/admin/releases':
        return <AdminReleasesView onMaintenanceUpdated={setMaintenanceMode} />;
      case '/admin/governance':
        return <AdminGovernanceView />;
      case '/admin/super-control':
        return <AdminSuperControlView onNavigate={onNavigate} />;
      case '/admin/automation':
        return <AdminAutomationView />;
      case '/admin/access-reviews':
        return <AdminAccessReviewsView />;
      case '/admin/ai-policies':
        return <AdminAiPoliciesView />;
      case '/admin/emergency':
        return <AdminEmergencyView />;
      case '/admin/intelligence':
        return <AdminIntelligenceView onNavigate={onNavigate} />;
      default:
        return (
          <AdminOverviewView
            onNavigate={onNavigate}
            onMaintenanceModeDetected={setMaintenanceMode}
          />
        );
    }
  };

  return (
    <AdminLayout
      currentPath={pathname}
      pageTitle={meta.title}
      pageSubtitle={meta.subtitle}
      maintenanceMode={maintenanceMode}
      onNavigate={onNavigate}
    >
      {renderContent()}
    </AdminLayout>
  );
};
