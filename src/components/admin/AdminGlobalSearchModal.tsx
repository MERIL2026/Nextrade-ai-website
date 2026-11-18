import React, { useEffect, useState } from 'react';
import {
  AlertOctagon,
  ArrowRight,
  Bell,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Search,
  ShieldAlert,
  Workflow,
  X,
} from 'lucide-react';
import type { GlobalSearchResultItemDto } from '../../admin/types';
import { adminApi, type ActionCentreResponse } from '../../lib/adminApi';

interface AdminGlobalSearchModalProps {
  mode: 'SEARCH' | 'ACTION_CENTRE' | null;
  initialQuery?: string;
  onClose: () => void;
  onNavigate: (href: string) => void;
}

export const AdminGlobalSearchModal: React.FC<AdminGlobalSearchModalProps> = ({
  mode,
  initialQuery = '',
  onClose,
  onNavigate,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [entityFilter, setEntityFilter] = useState<string>('ALL');
  const [results, setResults] = useState<GlobalSearchResultItemDto[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [actionCentre, setActionCentre] = useState<ActionCentreResponse | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'SEARCH') {
      setQuery(initialQuery);
    }
  }, [mode, initialQuery]);

  useEffect(() => {
    if (!mode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, onClose]);

  useEffect(() => {
    if (mode !== 'SEARCH') return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearchTotal(0);
      setSearchError(null);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);
      try {
        const res = await adminApi.globalSearch(trimmed, 30, 0);
        if (active) {
          setResults(res.results);
          setSearchTotal(res.total);
        }
      } catch (err) {
        if (active) {
          setSearchError(err instanceof Error ? err.message : 'Global search failed.');
        }
      } finally {
        if (active) setSearchLoading(false);
      }
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [mode, query]);

  useEffect(() => {
    if (mode !== 'ACTION_CENTRE') return;
    let active = true;
    setActionLoading(true);
    setActionError(null);
    adminApi
      .getActionCentre()
      .then((res) => {
        if (active) setActionCentre(res);
      })
      .catch((err) => {
        if (active) {
          setActionError(err instanceof Error ? err.message : 'Unable to load Action Centre.');
        }
      })
      .finally(() => {
        if (active) setActionLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode]);

  if (!mode) return null;

  const filteredResults =
    entityFilter === 'ALL' ? results : results.filter((r) => r.entityType === entityFilter);

  const entityTypes = ['ALL', ...Array.from(new Set(results.map((r) => r.entityType)))];

  const jump = (href: string) => {
    onClose();
    onNavigate(href);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[#080B12]/60 backdrop-blur-[2px] p-4 pt-14"
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'SEARCH' ? 'Permission-filtered Global Admin Search' : 'Global Admin Action Centre'}
    >
      <div className="w-full max-w-2xl rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#E4E8F2] px-5 py-3.5">
          <div className="flex items-center gap-2">
            {mode === 'SEARCH' ? (
              <Search className="h-4 w-4 text-[#2D46E6]" />
            ) : (
              <ClipboardCheck className="h-4 w-4 text-[#2D46E6]" />
            )}
            <div>
              <h2 className="font-display text-sm font-bold text-[#080B12]">
                {mode === 'SEARCH' ? 'Global Admin Search' : 'Global Admin Action Centre'}
              </h2>
              <p className="font-mono text-[10px] uppercase tracking-wider text-[#667085]">
                {mode === 'SEARCH'
                  ? 'Results strictly filtered by your server-enforced RBAC permissions'
                  : 'Operational backlog, peer approvals & cross-module shortcuts'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-md p-1.5 text-[#667085] hover:bg-[#F7F8FA] hover:text-[#080B12] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {mode === 'SEARCH' ? (
          <div className="p-5 space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#667085]" />
              <input
                type="search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search users, incidents, alerts, jobs, workflows, backups, audit actions..."
                className="w-full h-10 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] pl-9 pr-3 text-xs text-[#080B12] focus:border-[#2D46E6] focus:bg-[#FFFFFF] focus:outline-none"
              />
            </div>

            {entityTypes.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {entityTypes.map((et) => (
                  <button
                    key={et}
                    type="button"
                    onClick={() => setEntityFilter(et)}
                    className={`rounded border px-2 py-1 font-mono text-[10px] font-semibold uppercase cursor-pointer ${
                      entityFilter === et
                        ? 'border-[#2D46E6] bg-[#EFF2FA] text-[#2D46E6]'
                        : 'border-[#E4E8F2] bg-[#FFFFFF] text-[#475467]'
                    }`}
                  >
                    {et.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            )}

            {searchError && (
              <div role="alert" className="rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#B91C1C]">
                {searchError}
              </div>
            )}

            <div className="max-h-96 overflow-y-auto divide-y divide-[#F1F5F9] rounded-lg border border-[#E4E8F2]">
              {searchLoading ? (
                <div className="flex items-center justify-center gap-2 p-8 text-xs text-[#667085]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#2D46E6]" />
                  <span>Searching authorized records...</span>
                </div>
              ) : query.trim().length < 2 ? (
                <div className="p-8 text-center text-xs text-[#667085]">
                  Type at least 2 characters to search across permitted admin domains.
                </div>
              ) : filteredResults.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#667085]">
                  No matching authorized records found for "{query.trim()}".
                </div>
              ) : (
                filteredResults.map((item) => (
                  <button
                    key={`${item.entityType}-${item.id}`}
                    type="button"
                    onClick={() => jump(item.href)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[#F7F8FA] cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded border border-[#E4E8F2] bg-[#F7F8FA] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#2D46E6]">
                          {item.entityType.replace(/_/g, ' ')}
                        </span>
                        <span className="text-xs font-semibold text-[#080B12] truncate">
                          {item.title}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#667085] truncate">{item.subtitle}</div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <span className="rounded border border-[#E4E8F2] bg-[#FFFFFF] px-2 py-0.5 font-mono text-[10px] text-[#475467]">
                        {item.status}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-[#94A3B8]" />
                    </div>
                  </button>
                ))
              )}
            </div>
            {searchTotal > 0 && (
              <div className="text-right font-mono text-[10px] text-[#667085]">
                Showing {filteredResults.length} of {searchTotal} permitted matches
              </div>
            )}
          </div>
        ) : (
          <div className="p-5 max-h-[75vh] overflow-y-auto space-y-4">
            {actionError && (
              <div role="alert" className="rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#B91C1C]">
                {actionError}
              </div>
            )}
            {actionLoading ? (
              <div className="flex items-center justify-center gap-2 p-10 text-xs text-[#667085]">
                <Loader2 className="h-4 w-4 animate-spin text-[#2D46E6]" />
                <span>Aggregating operational backlog...</span>
              </div>
            ) : actionCentre ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-3">
                    <div className="text-[10px] text-[#667085]">Pending Approvals</div>
                    <div className="font-mono text-lg font-bold text-[#080B12]">
                      {actionCentre.pendingApprovals.length}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-3">
                    <div className="text-[10px] text-[#667085]">Active Alerts</div>
                    <div className="font-mono text-lg font-bold text-[#080B12]">
                      {actionCentre.activeAlerts.length}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-3">
                    <div className="text-[10px] text-[#667085]">Open Incidents</div>
                    <div className="font-mono text-lg font-bold text-[#080B12]">
                      {actionCentre.assignedOrOpenIncidents.length}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-3">
                    <div className="text-[10px] text-[#667085]">Privacy & Jobs Queue</div>
                    <div className="font-mono text-lg font-bold text-[#080B12]">
                      {actionCentre.pendingGovernanceTasks.length + actionCentre.failedJobs.length}
                    </div>
                  </div>
                </div>

                {actionCentre.pendingApprovals.length > 0 && (
                  <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB]/60 p-3 space-y-2">
                    <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase text-[#B45309]">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      <span>Peer Approvals Needed</span>
                    </div>
                    {actionCentre.pendingApprovals.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => jump(p.href)}
                        className="w-full flex items-center justify-between rounded border border-[#FDE68A] bg-[#FFFFFF] px-3 py-2 text-left text-xs hover:bg-[#FFFBEB] cursor-pointer"
                      >
                        <span>
                          <strong>{p.actionType}</strong> · requested by {p.requestedByEmail}
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 text-[#B45309]" />
                      </button>
                    ))}
                  </div>
                )}

                {actionCentre.activeAlerts.length > 0 && (
                  <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3 space-y-2">
                    <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase text-[#080B12]">
                      <Bell className="h-3.5 w-3.5 text-[#DC2626]" />
                      <span>Open Operational Alerts</span>
                    </div>
                    {actionCentre.activeAlerts.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => jump(a.href)}
                        className="w-full flex items-center justify-between rounded border border-[#F1F5F9] px-3 py-2 text-left text-xs hover:bg-[#F7F8FA] cursor-pointer"
                      >
                        <span className="truncate">{a.title}</span>
                        <span className="ml-2 shrink-0 font-mono text-[10px] text-[#DC2626]">
                          {a.severity}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {actionCentre.assignedOrOpenIncidents.length > 0 && (
                  <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3 space-y-2">
                    <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase text-[#080B12]">
                      <AlertOctagon className="h-3.5 w-3.5 text-[#B45309]" />
                      <span>Open Incidents</span>
                    </div>
                    {actionCentre.assignedOrOpenIncidents.map((inc) => (
                      <button
                        key={inc.id}
                        type="button"
                        onClick={() => jump(inc.href)}
                        className="w-full flex items-center justify-between rounded border border-[#F1F5F9] px-3 py-2 text-left text-xs hover:bg-[#F7F8FA] cursor-pointer"
                      >
                        <span className="truncate">{inc.title}</span>
                        <span className="ml-2 shrink-0 font-mono text-[10px] text-[#475467]">
                          {inc.status} · {inc.severity}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {actionCentre.pendingApprovals.length === 0 &&
                  actionCentre.activeAlerts.length === 0 &&
                  actionCentre.assignedOrOpenIncidents.length === 0 &&
                  actionCentre.pendingGovernanceTasks.length === 0 &&
                  actionCentre.failedJobs.length === 0 && (
                    <div className="flex items-center gap-2 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] p-3 text-xs text-[#15803D]">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span>No open alerts, pending approvals, or failed jobs detected in your queue.</span>
                    </div>
                  )}

                <div className="space-y-2 pt-1">
                  <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase text-[#667085]">
                    <Workflow className="h-3.5 w-3.5" />
                    <span>Authorized Quick Launchers</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {actionCentre.quickModules.map((m) => (
                      <button
                        key={m.href}
                        type="button"
                        onClick={() => jump(m.href)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] cursor-pointer"
                      >
                        <span>{m.label}</span>
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};
