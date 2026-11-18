import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  Bell,
  Bot,
  Briefcase,
  ClipboardCheck,
  Cpu,
  Database,
  FileText,
  Flag,
  Globe,
  HardDrive,
  HardDriveDownload,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  Scale,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Sliders,
  Sparkles,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import { PERMISSIONS, Permission, isAdminRole } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import { adminApi, type AdminNotificationsResponse } from '../../lib/adminApi';
import { BrandLogo } from '../BrandLogo';
import { AdminGlobalSearchModal } from './AdminGlobalSearchModal';

export interface AdminNavItem {
  id: string;
  label: string;
  href: string;
  section: 'OVERVIEW' | 'MANAGEMENT' | 'OPERATIONS' | 'SECURITY' | 'COMMUNICATION' | 'PERSONAL';
  permission: Permission;
  icon: React.ComponentType<{ className?: string }>;
}

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  {
    id: 'overview',
    label: 'Command Centre',
    href: '/admin',
    section: 'OVERVIEW',
    permission: PERMISSIONS.ADMIN_CONSOLE_READ,
    icon: LayoutDashboard,
  },
  {
    id: 'super-control',
    label: 'Super Control',
    href: '/admin/super-control',
    section: 'OVERVIEW',
    permission: PERMISSIONS.ADMIN_SUPER_CONTROL_READ,
    icon: ShieldAlert,
  },
  {
    id: 'intelligence',
    label: 'Platform Intelligence',
    href: '/admin/intelligence',
    section: 'OVERVIEW',
    permission: PERMISSIONS.ADMIN_INTELLIGENCE_READ,
    icon: Sparkles,
  },
  {
    id: 'users',
    label: 'Users',
    href: '/admin/users',
    section: 'MANAGEMENT',
    permission: PERMISSIONS.ADMIN_USERS_READ,
    icon: Users,
  },
  {
    id: 'privacy',
    label: 'Privacy Centre',
    href: '/admin/privacy',
    section: 'MANAGEMENT',
    permission: PERMISSIONS.ADMIN_PRIVACY_READ,
    icon: ShieldCheck,
  },
  {
    id: 'ai',
    label: 'AI Control',
    href: '/admin/ai',
    section: 'OPERATIONS',
    permission: PERMISSIONS.ADMIN_AI_READ,
    icon: Cpu,
  },
  {
    id: 'markets',
    label: 'Market Data',
    href: '/admin/markets',
    section: 'OPERATIONS',
    permission: PERMISSIONS.ADMIN_MARKETS_READ,
    icon: Globe,
  },
  {
    id: 'apis',
    label: 'APIs & Integrations',
    href: '/admin/apis',
    section: 'OPERATIONS',
    permission: PERMISSIONS.ADMIN_APIS_READ,
    icon: Activity,
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    href: '/admin/infrastructure',
    section: 'OPERATIONS',
    permission: PERMISSIONS.ADMIN_INFRASTRUCTURE_READ,
    icon: HardDrive,
  },
  {
    id: 'jobs',
    label: 'Background Jobs',
    href: '/admin/jobs',
    section: 'OPERATIONS',
    permission: PERMISSIONS.ADMIN_JOBS_READ,
    icon: Briefcase,
  },
  {
    id: 'backups',
    label: 'Backups & DR',
    href: '/admin/backups',
    section: 'OPERATIONS',
    permission: PERMISSIONS.ADMIN_BACKUP_READ,
    icon: HardDriveDownload,
  },
  {
    id: 'features',
    label: 'Feature Flags',
    href: '/admin/features',
    section: 'OPERATIONS',
    permission: PERMISSIONS.ADMIN_FEATURES_READ,
    icon: Flag,
  },
  {
    id: 'ai-policies',
    label: 'AI Policies',
    href: '/admin/ai-policies',
    section: 'OPERATIONS',
    permission: PERMISSIONS.ADMIN_AI_POLICY_READ,
    icon: Bot,
  },
  {
    id: 'automation',
    label: 'Automation Engine',
    href: '/admin/automation',
    section: 'OPERATIONS',
    permission: PERMISSIONS.ADMIN_AUTOMATION_READ,
    icon: Workflow,
  },
  {
    id: 'releases',
    label: 'Releases & Maint.',
    href: '/admin/releases',
    section: 'OPERATIONS',
    permission: PERMISSIONS.ADMIN_RELEASES_READ,
    icon: Rocket,
  },
  {
    id: 'security',
    label: 'Security Centre',
    href: '/admin/security',
    section: 'SECURITY',
    permission: PERMISSIONS.ADMIN_SECURITY_READ,
    icon: Shield,
  },
  {
    id: 'alerts',
    label: 'Operational Alerts',
    href: '/admin/alerts',
    section: 'SECURITY',
    permission: PERMISSIONS.ADMIN_ALERTS_READ,
    icon: Bell,
  },
  {
    id: 'incidents',
    label: 'Incident Response',
    href: '/admin/incidents',
    section: 'SECURITY',
    permission: PERMISSIONS.ADMIN_INCIDENTS_READ,
    icon: AlertOctagon,
  },
  {
    id: 'emergency',
    label: 'Emergency Centre',
    href: '/admin/emergency',
    section: 'SECURITY',
    permission: PERMISSIONS.ADMIN_EMERGENCY_READ,
    icon: Siren,
  },
  {
    id: 'access-control',
    label: 'Access Control',
    href: '/admin/access-control',
    section: 'SECURITY',
    permission: PERMISSIONS.ADMIN_ROLES_READ,
    icon: Lock,
  },
  {
    id: 'access-reviews',
    label: 'Access Governance',
    href: '/admin/access-reviews',
    section: 'SECURITY',
    permission: PERMISSIONS.ADMIN_ACCESS_REVIEW_READ,
    icon: KeyRound,
  },
  {
    id: 'configuration',
    label: 'System Config',
    href: '/admin/configuration',
    section: 'SECURITY',
    permission: PERMISSIONS.ADMIN_SYSTEM_READ,
    icon: Sliders,
  },
  {
    id: 'audit-logs',
    label: 'Audit Logs',
    href: '/admin/audit-logs',
    section: 'SECURITY',
    permission: PERMISSIONS.ADMIN_AUDIT_READ,
    icon: FileText,
  },
  {
    id: 'governance',
    label: 'Governance & Reports',
    href: '/admin/governance',
    section: 'SECURITY',
    permission: PERMISSIONS.ADMIN_GOVERNANCE_READ,
    icon: Scale,
  },
  {
    id: 'announcements',
    label: 'Announcements',
    href: '/admin/announcements',
    section: 'COMMUNICATION',
    permission: PERMISSIONS.ADMIN_ANNOUNCEMENTS_READ,
    icon: Megaphone,
  },
  {
    id: 'support',
    label: 'Support Tickets',
    href: '/admin/support',
    section: 'COMMUNICATION',
    permission: PERMISSIONS.ADMIN_SUPPORT_READ,
    icon: MessageSquare,
  },
  {
    id: 'settings',
    label: 'Admin Settings',
    href: '/admin/settings',
    section: 'PERSONAL',
    permission: PERMISSIONS.ADMIN_CONSOLE_READ,
    icon: Settings,
  },
];

const SECTION_ORDER: AdminNavItem['section'][] = [
  'OVERVIEW',
  'MANAGEMENT',
  'OPERATIONS',
  'SECURITY',
  'COMMUNICATION',
  'PERSONAL',
];

interface AdminLayoutProps {
  currentPath: string;
  pageTitle: string;
  pageSubtitle?: string;
  maintenanceMode?: boolean;
  onNavigate: (href: string) => void;
  children: React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  currentPath,
  pageTitle,
  pageSubtitle,
  maintenanceMode = false,
  onNavigate,
  children,
}) => {
  const { user, logout } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<AdminNotificationsResponse | null>(null);
  const [drawerMode, setDrawerMode] = useState<'SEARCH' | 'ACTION_CENTRE' | null>(null);

  const userPerms = useMemo(() => new Set<string>(user?.permissions ?? []), [user?.permissions]);
  const visibleItems = useMemo(
    () =>
      ADMIN_NAV_ITEMS.filter((item) => {
        if (!user || !isAdminRole(user.role)) return false;
        return userPerms.has(item.permission);
      }),
    [user, userPerms],
  );

  useEffect(() => {
    let active = true;
    adminApi
      .getNotifications()
      .then((res) => {
        if (active) setNotifications(res);
      })
      .catch(() => {
        // non-blocking header poll
      });
    return () => {
      active = false;
    };
  }, [currentPath]);

  const handleGlobalSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (userPerms.has(PERMISSIONS.ADMIN_GLOBAL_SEARCH_READ)) {
      setDrawerMode('SEARCH');
      return;
    }
    const q = searchTerm.trim();
    if (!q) return;
    onNavigate(`/admin/users?search=${encodeURIComponent(q)}`);
  };

  const isNavActive = (href: string) => {
    if (href === '/admin') return currentPath === '/admin';
    return currentPath === href || currentPath.startsWith(`${href}/`);
  };

  const renderSidebarBody = (compact: boolean) => (
    <div className="flex h-full flex-col justify-between bg-[#101827] text-[#E2E8F0]">
      <div>
        <div className="flex items-center justify-between border-b border-[#1E293B] px-3.5 py-3.5">
          {!compact ? (
            <button
              type="button"
              onClick={() => onNavigate('/admin')}
              className="flex items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-[#2D46E6] cursor-pointer"
              aria-label="Nextrade AI Admin Console"
            >
              <BrandLogo variant="dark" symbolHeightClass="h-4" />
              <span className="rounded border border-[#334155] bg-[#1E293B] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-[#94A3B8]">
                Admin
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('/admin')}
              aria-label="Nextrade AI Admin Console"
              className="mx-auto flex h-7 w-7 items-center justify-center rounded bg-[#1E293B] font-mono text-xs font-bold text-[#FFFFFF] cursor-pointer"
            >
              NX
            </button>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden lg:inline-flex h-7 w-7 items-center justify-center rounded text-[#94A3B8] hover:bg-[#1E293B] hover:text-[#FFFFFF] cursor-pointer"
          >
            {compact ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
          </button>
        </div>

        <nav aria-label="Admin navigation" className="space-y-4 px-2.5 py-4 overflow-y-auto max-h-[calc(100vh-170px)]">
          {SECTION_ORDER.map((section) => {
            const items = visibleItems.filter((item) => item.section === section);
            if (items.length === 0) return null;
            return (
              <div key={section} className="space-y-1">
                {!compact && (
                  <div className="px-2 pb-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#64748B]">
                    {section}
                  </div>
                )}
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = isNavActive(item.href);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      title={compact ? item.label : undefined}
                      onClick={() => {
                        setMobileOpen(false);
                        onNavigate(item.href);
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#2D46E6] text-[#FFFFFF]'
                          : 'text-[#CBD5E1] hover:bg-[#1E293B] hover:text-[#FFFFFF]'
                      } ${compact ? 'justify-center px-0' : ''}`}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {!compact && <span className="truncate">{item.label}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-[#1E293B] p-3 space-y-2.5">
        {!compact && user && (
          <div className="rounded-md border border-[#1E293B] bg-[#0B111E] px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-semibold text-[#F8FAFC]">{user.fullName}</span>
              <span className="rounded bg-[#1E293B] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#93C5FD]">
                {user.role}
              </span>
            </div>
            <div className="truncate text-[11px] text-[#94A3B8]">{user.email}</div>
          </div>
        )}
        <div className={`flex items-center ${compact ? 'flex-col gap-2' : 'justify-between gap-2'}`}>
          <button
            type="button"
            onClick={() => onNavigate('/app')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#94A3B8] hover:text-[#FFFFFF] cursor-pointer"
            title="Return to User Workspace"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {!compact && <span>User App</span>}
          </button>
          <button
            type="button"
            onClick={async () => {
              await logout();
              onNavigate('/login');
            }}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#F87171] hover:text-[#FCA5A5] cursor-pointer"
            title="Sign Out"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            {!compact && <span>Sign Out</span>}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F7F8FA] text-[#080B12] flex">
      {/* Desktop Graphite Sidebar */}
      <aside
        className={`hidden lg:block shrink-0 border-r border-[#1E293B] sticky top-0 h-screen transition-all duration-150 ${
          sidebarCollapsed ? 'w-[64px]' : 'w-[244px]'
        }`}
      >
        {renderSidebarBody(sidebarCollapsed)}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-[#080B12]/60"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-[256px] h-full shadow-2xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close admin sidebar"
              className="absolute right-2 top-3 z-20 rounded p-1.5 text-[#CBD5E1] hover:bg-[#1E293B]"
            >
              <X className="h-4 w-4" />
            </button>
            {renderSidebarBody(false)}
          </aside>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Global Top Header */}
        <header className="sticky top-0 z-30 border-b border-[#E4E8F2] bg-[#FFFFFF]/95 backdrop-blur-sm px-4 py-2.5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open admin navigation"
                className="inline-flex lg:hidden h-9 w-9 items-center justify-center rounded-md border border-[#E4E8F2] bg-[#FFFFFF] text-[#080B12] cursor-pointer"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[#667085]">
                  <span>Admin Control Centre</span>
                  <span>/</span>
                  <span className="truncate text-[#2D46E6]">{currentPath}</span>
                </div>
                <h1 className="font-display text-base sm:text-lg font-bold tracking-tight text-[#080B12] truncate">
                  {pageTitle}
                </h1>
                {pageSubtitle && (
                  <p className="hidden sm:block text-xs text-[#667085] truncate">{pageSubtitle}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {/* Global Search */}
              <form onSubmit={handleGlobalSearchSubmit} className="relative hidden md:block">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#667085]"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onFocus={() => {
                    if (userPerms.has(PERMISSIONS.ADMIN_GLOBAL_SEARCH_READ) && searchTerm.trim().length >= 2) {
                      setDrawerMode('SEARCH');
                    }
                  }}
                  placeholder="Global admin search..."
                  aria-label="Search admin resources"
                  className="h-8 w-52 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] pl-8 pr-3 text-xs text-[#080B12] placeholder:text-[#94A3B8] focus:border-[#2D46E6] focus:bg-[#FFFFFF] focus:outline-none"
                />
              </form>

              {userPerms.has(PERMISSIONS.ADMIN_GLOBAL_SEARCH_READ) && (
                <button
                  type="button"
                  onClick={() => setDrawerMode('SEARCH')}
                  aria-label="Open global admin search"
                  className="inline-flex md:hidden h-8 w-8 items-center justify-center rounded-md border border-[#E4E8F2] bg-[#FFFFFF] text-[#475467] hover:border-[#2D46E6] hover:text-[#2D46E6] cursor-pointer"
                >
                  <Search className="h-3.5 w-3.5" />
                </button>
              )}

              <button
                type="button"
                onClick={() => setDrawerMode('ACTION_CENTRE')}
                aria-label="Open Admin Action Centre"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] cursor-pointer"
              >
                <ClipboardCheck className="h-3.5 w-3.5 text-[#2D46E6]" />
                <span className="hidden sm:inline">Action Centre</span>
              </button>

              {/* Environment / Maintenance Indicator (no pulsing dots) */}
              <div
                className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider ${
                  maintenanceMode
                    ? 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]'
                    : 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                }`}
              >
                {maintenanceMode ? (
                  <>
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                    <span>Maintenance</span>
                  </>
                ) : (
                  <>
                    <Database className="h-3 w-3" aria-hidden="true" />
                    <span>Operational</span>
                  </>
                )}
              </div>

              {/* Notifications Popover */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotifOpen((v) => !v)}
                  aria-label="Open admin notifications"
                  className="relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#E4E8F2] bg-[#FFFFFF] text-[#475467] hover:border-[#2D46E6] hover:text-[#2D46E6] cursor-pointer"
                >
                  <Bell className="h-4 w-4" />
                  {notifications && notifications.totalCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded bg-[#DC2626] px-1 font-mono text-[9px] font-bold text-[#FFFFFF]">
                      {notifications.totalCount}
                    </span>
                  )}
                </button>
                {notifOpen && (
                  <div className="absolute right-0 mt-2 w-80 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] shadow-xl z-40">
                    <div className="flex items-center justify-between border-b border-[#E4E8F2] px-3.5 py-2.5">
                      <span className="font-display text-xs font-bold text-[#080B12]">
                        Active Alerts & Queue
                      </span>
                      <span className="font-mono text-[10px] text-[#667085]">
                        {notifications?.totalCount ?? 0} open
                      </span>
                    </div>
                    <div className="max-h-72 overflow-y-auto divide-y divide-[#F1F5F9]">
                      {!notifications || notifications.items.length === 0 ? (
                        <div className="p-4 text-center text-xs text-[#667085]">
                          No open incidents, failed jobs, or unresolved tickets.
                        </div>
                      ) : (
                        notifications.items.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setNotifOpen(false);
                              onNavigate(item.href);
                            }}
                            className="w-full px-3.5 py-2.5 text-left hover:bg-[#F7F8FA] cursor-pointer"
                          >
                            <div className="font-mono text-[9px] font-semibold uppercase text-[#2D46E6]">
                              {item.kind}
                            </div>
                            <div className="text-xs font-medium text-[#080B12] line-clamp-2">
                              {item.title}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">{children}</main>
      </div>

      <AdminGlobalSearchModal
        mode={drawerMode}
        initialQuery={searchTerm}
        onClose={() => setDrawerMode(null)}
        onNavigate={onNavigate}
      />
    </div>
  );
};
