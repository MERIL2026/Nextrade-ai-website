import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Download,
  Loader2,
  Scale,
  Search,
} from 'lucide-react';
import type { GovernanceEventSummaryDto } from '../../admin/types';
import { PERMISSIONS } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import { adminApi } from '../../lib/adminApi';

export const AdminGovernanceView: React.FC = () => {
  const { user } = useAuth();
  const perms = new Set<string>(user?.permissions ?? []);
  const canExport = perms.has(PERMISSIONS.ADMIN_GOVERNANCE_EXPORT);

  const [category, setCategory] = useState('ALL');
  const [actorFilter, setActorFilter] = useState('');
  const [summary, setSummary] = useState<{
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
  } | null>(null);
  const [disclaimer, setDisclaimer] = useState('');
  const [controlMatrix, setControlMatrix] = useState<
    Array<{ control: string; status: 'IMPLEMENTED' | 'NOT_CONFIGURED'; evidence: string }>
  >([]);
  const [events, setEvents] = useState<GovernanceEventSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getGovernanceReport({
        category,
        actor: actorFilter.trim() || undefined,
      });
      setSummary(res.summary);
      setDisclaimer(res.readinessDisclaimer);
      setControlMatrix(res.controlMatrix);
      setEvents(res.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load governance reporting.');
    } finally {
      setLoading(false);
    }
  }, [category, actorFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportQuery = new URLSearchParams();
  if (category !== 'ALL') exportQuery.set('category', category);
  if (actorFilter.trim()) exportQuery.set('actor', actorFilter.trim());

  return (
    <div className="space-y-5">
      {disclaimer && (
        <div className="flex items-start gap-2.5 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-4 text-xs text-[#92400E]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-bold uppercase tracking-wide text-[11px]">
              Operational Governance Readiness Notice (Not Legal Certification)
            </div>
            <p className="mt-0.5 leading-relaxed">{disclaimer}</p>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-2.5 text-xs text-[#B91C1C]">
          {error}
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: 'Total Accounts', val: summary.totalUsers },
            { label: 'Deletion Scheduled', val: summary.deletionScheduledCount },
            { label: 'Anonymized', val: summary.anonymizedAccountsCount },
            { label: 'Exports Ready', val: `${summary.exportReadyCount}/${summary.exportRequestsTotal}` },
            { label: 'Verified Backups', val: summary.verifiedBackupsCount },
            { label: 'Active Flags', val: `${summary.featureFlagsEnabled}/${summary.featureFlagsTotal}` },
          ].map((k) => (
            <div key={k.label} className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3">
              <div className="text-[11px] text-[#667085]">{k.label}</div>
              <div className="font-mono text-lg font-bold tabular-nums text-[#080B12]">{k.val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Control Readiness Matrix */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="flex items-center gap-2 border-b border-[#E4E8F2] px-4 py-3">
          <Scale className="h-4 w-4 text-[#2D46E6]" />
          <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            Control Readiness Evidence Matrix
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-xs">
            <thead>
              <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                <th className="px-4 py-2">Control Domain</th>
                <th className="px-3 py-2">Operational Status</th>
                <th className="px-4 py-2">Live Runtime Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {controlMatrix.map((c) => (
                <tr key={c.control} className="h-10 hover:bg-[#F7F8FA]">
                  <td className="px-4 py-2 font-semibold text-[#080B12]">{c.control}</td>
                  <td className="px-3 py-2 font-mono text-[10px] font-bold">
                    <span
                      className={`rounded border px-2 py-0.5 ${
                        c.status === 'IMPLEMENTED'
                          ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                          : 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]'
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-[#475467]">{c.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cross-Domain Governance Event Ledger + Formula-Safe CSV Export */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="border-b border-[#E4E8F2] p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Filter governance events by category"
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono text-xs text-[#080B12]"
            >
              <option value="ALL">All Domains</option>
              <option value="LIFECYCLE">LIFECYCLE</option>
              <option value="PRIVACY">PRIVACY</option>
              <option value="BACKUP">BACKUP</option>
              <option value="FEATURE_FLAG">FEATURE_FLAG</option>
              <option value="MAINTENANCE">MAINTENANCE</option>
              <option value="CONFIG">CONFIG</option>
              <option value="RBAC">RBAC</option>
              <option value="SECURITY">SECURITY</option>
            </select>
            <div className="relative min-w-[200px] max-w-xs flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#667085]" />
              <input
                type="search"
                value={actorFilter}
                onChange={(e) => setActorFilter(e.target.value)}
                placeholder="Filter by actor email..."
                className="h-9 w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] pl-8 pr-3 text-xs"
              />
            </div>
          </div>

          {canExport && (
            <a
              href={`/api/admin/governance/export?${exportQuery.toString()}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6]"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export Governance CSV</span>
            </a>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead>
              <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                <th className="px-4 py-2">Timestamp</th>
                <th className="px-3 py-2">Domain</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Target</th>
                <th className="px-4 py-2">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[#667085]">
                    <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin text-[#2D46E6]" />
                    Loading governance events...
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[#667085]">
                    No governance events matched the current filters.
                  </td>
                </tr>
              ) : (
                events.map((ev) => (
                  <tr key={ev.id} className="h-10 hover:bg-[#F7F8FA]">
                    <td className="px-4 py-2 font-mono text-[11px] whitespace-nowrap text-[#667085]">
                      {new Date(ev.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] font-semibold text-[#2D46E6]">
                      {ev.category}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] font-semibold text-[#080B12]">
                      {ev.action}
                    </td>
                    <td className="px-3 py-2 text-[#475467]">{ev.actorEmail}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-[#475467]">{ev.target}</td>
                    <td className="px-4 py-2 font-mono text-[10px] font-semibold text-[#15803D]">
                      {ev.result}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
