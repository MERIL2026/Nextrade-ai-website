import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BellRing,
  CheckCircle2,
  Flame,
  Loader2,
  Plus,
  Shield,
} from 'lucide-react';
import type {
  IncidentSeverity,
  IncidentStatus,
  ObservabilityRangeKey,
  SecurityEventSeverity,
} from '../../admin/types';
import { PERMISSIONS } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import {
  adminApi,
  type AdminSecurityOverviewResponse,
  type ObservabilitySecurityResponse,
} from '../../lib/adminApi';
import { AdminBarChart } from './AdminCharts';

interface AdminSecurityViewProps {
  onNavigate?: (href: string) => void;
}

function severityPillClass(sev: SecurityEventSeverity): string {
  switch (sev) {
    case 'CRITICAL':
      return 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]';
    case 'HIGH':
      return 'border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]';
    case 'MEDIUM':
      return 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]';
    case 'LOW':
    default:
      return 'border-[#E2E8F0] bg-[#F8FAFC] text-[#475467]';
  }
}

export const AdminSecurityView: React.FC<AdminSecurityViewProps> = ({ onNavigate }) => {
  const { user } = useAuth();
  const canManage = new Set<string>(user?.permissions ?? []).has(PERMISSIONS.ADMIN_SECURITY_MANAGE);

  const [data, setData] = useState<AdminSecurityOverviewResponse | null>(null);
  const [obs, setObs] = useState<ObservabilitySecurityResponse | null>(null);
  const [range, setRange] = useState<ObservabilityRangeKey>('7d');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<IncidentSeverity>('MEDIUM');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [secOverview, secObs] = await Promise.all([
        adminApi.getSecurityOverview(),
        adminApi.getObservabilitySecurity({
          range,
          severity: severityFilter !== 'ALL' ? severityFilter : undefined,
          eventType: eventTypeFilter.trim() ? eventTypeFilter.trim() : undefined,
          limit: 40,
        }),
      ]);
      setData(secOverview);
      setObs(secObs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Security Centre.');
    } finally {
      setLoading(false);
    }
  }, [range, severityFilter, eventTypeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreateIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setFeedback(null);
    try {
      await adminApi.createIncident({ title: title.trim(), description: description.trim(), severity });
      setTitle('');
      setDescription('');
      setFeedback('Security incident logged.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create security incident.');
    } finally {
      setCreating(false);
    }
  };

  const handleAdvanceIncident = async (id: string, nextStatus: IncidentStatus) => {
    setError(null);
    setFeedback(null);
    try {
      await adminApi.updateIncident(id, { status: nextStatus });
      setFeedback(`Incident status updated to ${nextStatus}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update incident status.');
    }
  };

  if (loading && !data) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] text-xs text-[#667085]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#2D46E6]" />
        Loading Security Centre...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {feedback && (
        <div className="flex items-center gap-2 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-2.5 text-xs text-[#15803D]">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-2.5 text-xs text-[#B91C1C]">
          {error}
        </div>
      )}

      {/* Quick Navigation Strip to Dedicated Alerts & Incidents */}
      {onNavigate && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] px-4 py-3">
          <div className="text-xs text-[#475467]">
            Security Telemetry Stream &amp; Threshold Operations
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate('/admin/alerts')}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] cursor-pointer"
            >
              <BellRing className="h-3.5 w-3.5 text-[#2D46E6]" />
              <span>Operational Alerts</span>
              <ArrowUpRight className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/admin/incidents')}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#080B12] px-3 text-xs font-semibold text-[#FFFFFF] hover:bg-[#1E293B] cursor-pointer"
            >
              <Flame className="h-3.5 w-3.5" />
              <span>Open Incident Center</span>
              <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {data && (
        <>
          {/* Auth & Session Counters */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
            {[
              { label: 'Login Success', val: data.authMonitoring.loginSuccesses },
              { label: 'Failed Logins', val: data.authMonitoring.failedLogins },
              { label: 'Password Resets', val: data.authMonitoring.passwordResets },
              { label: 'Verifications', val: data.authMonitoring.verificationEvents },
              { label: 'Active Sessions', val: data.authMonitoring.activeSessions },
              { label: 'Revoked Sessions', val: data.authMonitoring.revokedSessions },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5">
                <div className="text-[11px] text-[#667085]">{item.label}</div>
                <div className="font-mono text-xl font-bold tabular-nums text-[#080B12]">
                  {item.val}
                </div>
              </div>
            ))}
          </div>

          {/* Phase 4 Security Telemetry Summary, Trends & Repeated Failure Sources */}
          {obs && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <AdminBarChart
                title="Security Event Activity Trend"
                subtitle={`Total events in window: ${obs.summary.totalEvents} · Critical: ${obs.summary.criticalCount} · High: ${obs.summary.highCount}`}
                data={obs.trends}
                accentColor="#B91C1C"
              />

              <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                    Repeated Failure Sources ({obs.summary.repeatedFailureSources.length})
                  </h2>
                  <div className="flex items-center gap-1.5 font-mono text-[10px]">
                    <span className="rounded border border-[#FECACA] bg-[#FEF2F2] px-1.5 py-0.5 text-[#B91C1C]">
                      CRIT: {obs.summary.criticalCount}
                    </span>
                    <span className="rounded border border-[#FED7AA] bg-[#FFF7ED] px-1.5 py-0.5 text-[#C2410C]">
                      HIGH: {obs.summary.highCount}
                    </span>
                    <span className="rounded border border-[#FDE68A] bg-[#FFFBEB] px-1.5 py-0.5 text-[#B45309]">
                      MED: {obs.summary.mediumCount}
                    </span>
                  </div>
                </div>
                {obs.summary.repeatedFailureSources.length === 0 ? (
                  <div className="flex h-24 items-center justify-center rounded border border-dashed border-[#E4E8F2] bg-[#F7F8FA] text-xs text-[#667085]">
                    No repeated failure source IPs (&ge; 3 failed attempts) detected in this window.
                  </div>
                ) : (
                  <div className="divide-y divide-[#F1F5F9] max-h-36 overflow-y-auto text-xs">
                    {obs.summary.repeatedFailureSources.map((src) => (
                      <div key={src.ipAddress} className="flex items-center justify-between py-2">
                        <div>
                          <div className="font-mono font-semibold text-[#080B12]">{src.ipAddress}</div>
                          <div className="font-mono text-[10px] text-[#667085]">
                            {src.classification}
                          </div>
                        </div>
                        <span
                          className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                            src.failedAttempts >= 5
                              ? 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]'
                              : 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]'
                          }`}
                        >
                          {src.failedAttempts} failures · REPEATED_FAILURES_REVIEW
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Cloudflare Audit Provenance + Runtime Security Posture */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                  <Shield className="h-4 w-4 text-[#2D46E6]" />
                  <span>{data.historicalAudit.source}</span>
                </div>
                <span className="rounded border border-[#FDE68A] bg-[#FFFBEB] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#B45309]">
                  {data.historicalAudit.status}
                </span>
              </div>
              <div className="rounded border border-[#FDE68A] bg-[#FFFBEB]/60 p-2.5 text-[11px] text-[#92400E]">
                <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
                {data.historicalAudit.caveat}
              </div>
              <div className="grid grid-cols-4 gap-2 text-center font-mono text-xs">
                <div className="rounded border border-[#E4E8F2] p-2">
                  <div className="text-[10px] text-[#667085]">Critical</div>
                  <div className="font-bold text-[#080B12]">{data.historicalAudit.summaryCounts.critical}</div>
                </div>
                <div className="rounded border border-[#E4E8F2] p-2">
                  <div className="text-[10px] text-[#667085]">High</div>
                  <div className="font-bold text-[#080B12]">{data.historicalAudit.summaryCounts.high}</div>
                </div>
                <div className="rounded border border-[#E4E8F2] p-2">
                  <div className="text-[10px] text-[#667085]">Med Fixed</div>
                  <div className="font-bold text-[#15803D]">{data.historicalAudit.summaryCounts.mediumFixed}</div>
                </div>
                <div className="rounded border border-[#E4E8F2] p-2">
                  <div className="text-[10px] text-[#667085]">Low Fixed</div>
                  <div className="font-bold text-[#15803D]">{data.historicalAudit.summaryCounts.lowFixed}</div>
                </div>
              </div>
              <div className="space-y-1 text-[11px]">
                {data.historicalAudit.historicalFindings.map((f) => (
                  <div key={f.id} className="flex items-center justify-between border-b border-[#F1F5F9] py-1">
                    <span className="text-[#475467]">
                      <strong className="font-mono text-[#080B12]">{f.id}</strong> · {f.title}
                    </span>
                    <span className="font-mono text-[10px] font-semibold text-[#15803D]">
                      {f.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
              <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                Active Configuration Posture
              </h2>
              <div className="divide-y divide-[#F1F5F9] text-xs">
                {[
                  { label: 'Content-Security-Policy', val: data.configurationPosture.cspMode },
                  {
                    label: 'Session Cookies',
                    val: data.configurationPosture.httpOnlyCookies ? 'HttpOnly + SHA-256 hashed' : 'Standard',
                  },
                  { label: 'SameSite Policy', val: data.configurationPosture.sameSitePolicy },
                  {
                    label: 'CSRF Origin/Referer Check',
                    val: data.configurationPosture.csrfOriginCheckEnabled ? 'Enforced' : 'Disabled',
                  },
                  {
                    label: 'Password Hashing',
                    val: data.configurationPosture.argon2idPasswordHashing ? 'Argon2id' : 'Other',
                  },
                  { label: 'Dependency Scanner', val: data.configurationPosture.dependencyVulnerabilityScanner },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between py-2">
                    <span className="text-[#475467]">{row.label}</span>
                    <span className="font-mono text-[11px] font-semibold text-[#080B12]">{row.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Security Incidents CRUD + Filterable Auth Events Stream */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                  Security Incidents ({data.incidents.length})
                </h2>
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate('/admin/incidents')}
                    className="font-mono text-[11px] font-semibold text-[#2D46E6] hover:underline cursor-pointer"
                  >
                    Full Workflow &rarr;
                  </button>
                )}
              </div>

              {canManage && (
                <form onSubmit={handleCreateIncident} className="space-y-2 rounded border border-[#E4E8F2] bg-[#F7F8FA] p-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Incident title..."
                      className="h-8 flex-1 rounded border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 text-xs"
                    />
                    <select
                      value={severity}
                      onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
                      className="h-8 rounded border border-[#E4E8F2] bg-[#FFFFFF] px-2 font-mono text-xs"
                    >
                      <option value="LOW">LOW</option>
                      <option value="MEDIUM">MEDIUM</option>
                      <option value="HIGH">HIGH</option>
                      <option value="CRITICAL">CRITICAL</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Operational description & scope..."
                      className="h-8 flex-1 rounded border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={creating}
                      className="inline-flex h-8 items-center gap-1 rounded bg-[#080B12] px-3 text-xs font-semibold text-[#FFFFFF] cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Log</span>
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-2 max-h-80 overflow-y-auto">
                {data.incidents.length === 0 ? (
                  <div className="py-6 text-center text-xs text-[#667085]">
                    No recorded security incidents.
                  </div>
                ) : (
                  data.incidents.map((inc) => (
                    <div key={inc.id} className="rounded border border-[#E4E8F2] p-3 text-xs space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#080B12]">{inc.title}</span>
                        <div className="flex items-center gap-1.5 font-mono text-[10px]">
                          <span className="rounded border border-[#FECACA] bg-[#FEF2F2] px-1.5 py-0.5 text-[#B91C1C]">
                            {inc.severity}
                          </span>
                          <span className="rounded border border-[#CBD5E1] bg-[#F8FAFC] px-1.5 py-0.5">
                            {inc.status}
                          </span>
                        </div>
                      </div>
                      <p className="text-[#475467]">{inc.description}</p>
                      {canManage && inc.status !== 'RESOLVED' && (
                        <div className="flex gap-2 pt-1">
                          {inc.status !== 'INVESTIGATING' && (
                            <button
                              type="button"
                              onClick={() => void handleAdvanceIncident(inc.id, 'INVESTIGATING')}
                              className="text-[11px] font-semibold text-[#2D46E6] hover:underline cursor-pointer"
                            >
                              Mark Investigating
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleAdvanceIncident(inc.id, 'RESOLVED')}
                            className="text-[11px] font-semibold text-[#15803D] hover:underline cursor-pointer"
                          >
                            Resolve
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                  Auth &amp; Session Security Events ({obs?.total ?? data.events.length})
                </h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    aria-label="Filter security timeframe"
                    value={range}
                    onChange={(e) => setRange(e.target.value as ObservabilityRangeKey)}
                    className="h-7 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2 font-mono text-[11px]"
                  >
                    <option value="24h">24h</option>
                    <option value="7d">7d</option>
                    <option value="30d">30d</option>
                    <option value="all">All</option>
                  </select>
                  <select
                    aria-label="Filter security severity"
                    value={severityFilter}
                    onChange={(e) => setSeverityFilter(e.target.value)}
                    className="h-7 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2 font-mono text-[11px]"
                  >
                    <option value="ALL">All Severity</option>
                    <option value="CRITICAL">CRITICAL</option>
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="LOW">LOW</option>
                  </select>
                  <input
                    type="text"
                    value={eventTypeFilter}
                    onChange={(e) => setEventTypeFilter(e.target.value)}
                    placeholder="Event type..."
                    aria-label="Filter by event type"
                    className="h-7 w-28 rounded border border-[#E4E8F2] bg-[#FFFFFF] px-2 font-mono text-[11px]"
                  />
                </div>
              </div>
              <div className="divide-y divide-[#F1F5F9] max-h-96 overflow-y-auto">
                {(obs?.events ?? []).length === 0 ? (
                  <div className="py-6 text-center text-xs text-[#667085]">
                    No security events matched the active filter criteria.
                  </div>
                ) : (
                  (obs?.events ?? []).map((ev) => (
                    <div key={ev.id} className="py-2 text-xs space-y-0.5">
                      <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold ${severityPillClass(
                              ev.severity,
                            )}`}
                          >
                            {ev.severity}
                          </span>
                          <span className="font-semibold text-[#080B12]">{ev.eventType}</span>
                        </div>
                        <span className="text-[#667085]">{new Date(ev.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="text-[#475467]">{ev.detail}</div>
                      <div className="font-mono text-[10px] text-[#94A3B8]">IP: {ev.ipAddress}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

