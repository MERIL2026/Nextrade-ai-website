import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Workflow,
} from 'lucide-react';
import { adminApi, type SuperControlOverviewResponse } from '../../lib/adminApi';

interface AdminSuperControlViewProps {
  onNavigate: (href: string) => void;
}

const QUICK_LINKS = [
  { label: 'Automation Engine', href: '/admin/automation', desc: 'Predefined playbooks, retries, kill switch' },
  { label: 'Access Governance', href: '/admin/access-reviews', desc: 'Peer approvals, SoD & emergency grants' },
  { label: 'AI Policies', href: '/admin/ai-policies', desc: 'Versioned allowlists, injection guard & rollback' },
  { label: 'Emergency Centre', href: '/admin/emergency', desc: 'Runbooks & reversible crisis controls' },
  { label: 'Platform Intelligence', href: '/admin/intelligence', desc: '13-domain telemetry & evidence actions' },
  { label: 'Backups & DR', href: '/admin/backups', desc: 'Snapshots, verification & recovery honesty' },
  { label: 'Feature Flags', href: '/admin/features', desc: 'Rollouts & runtime kill switches' },
  { label: 'Governance Ledger', href: '/admin/governance', desc: 'Readiness matrix & formula-safe export' },
];

export const AdminSuperControlView: React.FC<AdminSuperControlViewProps> = ({ onNavigate }) => {
  const [data, setData] = useState<SuperControlOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getSuperControlOverview();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Super Admin Command Centre.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-12 text-xs text-[#667085]">
        <Loader2 className="h-4 w-4 animate-spin text-[#2D46E6]" />
        <span>Aggregating unified Super Admin control plane...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div role="alert" className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-4 text-xs text-[#B91C1C]">
        {error || 'Failed to load Super Admin control data.'}
      </div>
    );
  }

  const m = data.metrics;
  const s = data.serviceStatus;
  const categories = ['ALL', ...Array.from(new Set(data.timeline.map((t) => t.category)))];
  const filteredTimeline =
    categoryFilter === 'ALL'
      ? data.timeline
      : data.timeline.filter((t) => t.category === categoryFilter);

  const statusStyles =
    data.operationalStatus === 'MAINTENANCE'
      ? 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]'
      : data.operationalStatus === 'DEGRADED'
        ? 'border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]'
        : 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]';

  return (
    <div className="space-y-5">
      {/* Unified Operational Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#C7D2FE] bg-[#EFF2FA] text-[#2D46E6]">
            <ShieldAlert className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display text-sm font-bold text-[#080B12]">
                Super Admin Executive Control Plane
              </span>
              <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${statusStyles}`}>
                {data.operationalStatus}
              </span>
            </div>
            <p className="text-xs text-[#667085]">
              Cross-domain summary uniting Phases 1–6 metrics, active governance queues, and unified platform activity.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'Active / Total Users', value: `${m.activeUsers}/${m.totalUsers}` },
          { label: 'Critical Alerts', value: m.openCriticalAlerts, warn: m.openCriticalAlerts > 0 },
          { label: 'Open Incidents', value: m.activeIncidents, warn: m.activeIncidents > 0 },
          { label: 'Pending Approvals', value: m.pendingApprovals, warn: m.pendingApprovals > 0 },
          { label: 'Privacy Backlog', value: m.pendingPrivacyRequests },
          { label: 'Enabled Workflows', value: `${m.enabledWorkflowsCount}/${m.workflowsCount}` },
        ].map((card) => (
          <div key={card.label} className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5">
            <div className="text-[11px] text-[#667085]">{card.label}</div>
            <div
              className={`mt-1 font-mono text-xl font-bold tabular-nums ${
                card.warn ? 'text-[#DC2626]' : 'text-[#080B12]'
              }`}
            >
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Subsystem Health + Honest Unavailable Sources */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
          <div className="flex items-center gap-2 border-b border-[#F1F5F9] pb-2.5">
            <Activity className="h-4 w-4 text-[#2D46E6]" />
            <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              Subsystem Operational Health
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-2.5 text-xs sm:grid-cols-2">
            {[
              { name: 'Primary Database', status: s.databaseHealth },
              { name: 'API Gateway', status: s.apiHealth },
              { name: 'AI Provider (Gemini)', status: s.aiProviderHealth },
              { name: 'Market Data Feed', status: s.marketDataHealth },
              { name: 'Background Worker', status: s.workerHealth },
              { name: 'Full DB pg_dump', status: s.fullDatabaseBackupStatus },
            ].map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between gap-2 rounded-md border border-[#F1F5F9] bg-[#F7F8FA] px-3 py-2"
              >
                <span className="font-medium text-[#080B12]">{item.name}</span>
                <span className="font-mono text-[10px] font-semibold uppercase text-[#475467]">
                  {item.status}
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-[#667085]">
            <span>Verified Backups: <strong className="font-mono text-[#080B12]">{m.verifiedBackups}/{m.totalBackups}</strong></span>
            <span>Active Emergency Grants: <strong className="font-mono text-[#080B12]">{m.activeEmergencyGrants}</strong></span>
            <span>Automation Kill Switch: <strong className={`font-mono ${m.automationKillSwitchActive ? 'text-[#DC2626]' : 'text-[#15803D]'}`}>{m.automationKillSwitchActive ? 'ACTIVE' : 'DISARMED'}</strong></span>
          </div>
        </div>

        <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
          <div className="flex items-center gap-2 border-b border-[#F1F5F9] pb-2.5">
            <AlertTriangle className="h-4 w-4 text-[#B45309]" />
            <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              Transparent Telemetry & Capability Boundaries
            </h2>
          </div>
          <div className="space-y-2">
            {data.unavailableSources.map((src) => (
              <div
                key={src.key}
                className="flex items-start justify-between gap-3 rounded-md border border-[#FDE68A] bg-[#FFFBEB]/60 px-3 py-2 text-xs"
              >
                <div>
                  <div className="font-mono text-[10px] font-bold uppercase text-[#92400E]">
                    {src.key}
                  </div>
                  <div className="text-[#78350F]">{src.detail}</div>
                </div>
                <span className="shrink-0 rounded border border-[#FDE68A] bg-[#FFFFFF] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#B45309]">
                  {src.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Control Modules */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Workflow className="h-4 w-4 text-[#2D46E6]" />
          <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            Super Admin Control Modules
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_LINKS.map((item) => (
            <button
              key={item.href}
              type="button"
              onClick={() => onNavigate(item.href)}
              className="flex items-center justify-between rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 py-2.5 text-left hover:border-[#2D46E6] hover:bg-[#FFFFFF] cursor-pointer"
            >
              <div className="min-w-0 pr-2">
                <div className="text-xs font-semibold text-[#080B12]">{item.label}</div>
                <div className="text-[11px] text-[#667085] truncate">{item.desc}</div>
              </div>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#2D46E6]" />
            </button>
          ))}
        </div>
      </div>

      {/* Unified Cross-Domain Timeline */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E4E8F2] px-4 py-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-[#2D46E6]" />
            <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              Unified Cross-Domain Activity Timeline
            </h2>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase cursor-pointer ${
                  categoryFilter === cat
                    ? 'border-[#2D46E6] bg-[#EFF2FA] text-[#2D46E6]'
                    : 'border-[#E4E8F2] bg-[#FFFFFF] text-[#475467]'
                }`}
              >
                {cat.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead>
              <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                <th className="px-4 py-2">Time</th>
                <th className="px-4 py-2">Category</th>
                <th className="px-4 py-2">Actor</th>
                <th className="px-4 py-2">Resource</th>
                <th className="px-4 py-2">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {filteredTimeline.map((evt) => (
                <tr key={evt.id} className="hover:bg-[#F7F8FA]">
                  <td className="px-4 py-2 font-mono text-[11px] text-[#667085] whitespace-nowrap">
                    {evt.timestamp ? new Date(evt.timestamp).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2 font-mono text-[10px] font-semibold text-[#2D46E6]">
                    {evt.category}
                  </td>
                  <td className="px-4 py-2 text-[#080B12]">{evt.actor}</td>
                  <td className="px-4 py-2 font-mono text-[11px] text-[#475467]">
                    {evt.relatedResource}
                  </td>
                  <td className="px-4 py-2 text-[#475467]">{evt.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
