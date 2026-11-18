import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  Sliders,
} from 'lucide-react';
import type {
  AlertHistoryDto,
  ObservabilityThresholdsConfig,
  OperationalAlertDto,
} from '../../admin/types';
import { PERMISSIONS } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import { adminApi, type AlertsListResponse } from '../../lib/adminApi';

interface AdminAlertsViewProps {
  onNavigate?: (href: string) => void;
}

function severityBadge(sev: string): string {
  if (sev === 'CRITICAL') return 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]';
  if (sev === 'HIGH') return 'border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]';
  if (sev === 'MEDIUM') return 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]';
  return 'border-[#E2E8F0] bg-[#F8FAFC] text-[#475467]';
}

function alertStatusBadge(status: string): string {
  if (status === 'OPEN') return 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]';
  if (status === 'ACKNOWLEDGED') return 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]';
  if (status === 'RESOLVED') return 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]';
  return 'border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B]';
}

export const AdminAlertsView: React.FC<AdminAlertsViewProps> = ({ onNavigate }) => {
  const { user } = useAuth();
  const canManage = new Set<string>(user?.permissions ?? []).has(PERMISSIONS.ADMIN_ALERTS_MANAGE);

  const [statusFilter, setStatusFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  const [data, setData] = useState<AlertsListResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<OperationalAlertDto | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<AlertHistoryDto[]>([]);
  const [thresholds, setThresholds] = useState<ObservabilityThresholdsConfig | null>(null);
  const [showThresholds, setShowThresholds] = useState(false);

  const [actionNote, setActionNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [savingThresholds, setSavingThresholds] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, th] = await Promise.all([
        adminApi.listAlerts({
          status: statusFilter,
          severity: severityFilter,
          category: categoryFilter,
          limit: 50,
          offset: 0,
        }),
        adminApi.getAlertThresholds(),
      ]);
      setData(res);
      setThresholds(th.thresholds);
      if (res.alerts.length > 0 && !selectedId) {
        setSelectedId(res.alerts[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load operational alerts.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, severityFilter, categoryFilter, selectedId]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await adminApi.getAlertDetail(id);
      setSelectedAlert(res.alert);
      setSelectedHistory(res.history);
    } catch {
      // ignore transient selection error
    }
  }, []);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    } else {
      setSelectedAlert(null);
      setSelectedHistory([]);
    }
  }, [selectedId, loadDetail]);

  const handleEvaluate = async () => {
    setEvaluating(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await adminApi.evaluateAlerts();
      setFeedback(
        `Threshold evaluation complete: ${res.candidatesDetected} condition(s) matched (${res.createdCount} new, ${res.updatedCount} updated).`,
      );
      await loadAlerts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Alert evaluation failed.');
    } finally {
      setEvaluating(false);
    }
  };

  const handleAlertAction = async (
    action: 'ACKNOWLEDGE' | 'RESOLVE' | 'SUPPRESS' | 'REOPEN' | 'NOTE',
  ) => {
    if (!selectedAlert) return;
    setError(null);
    setFeedback(null);
    try {
      await adminApi.updateAlert(selectedAlert.id, {
        action,
        note: actionNote.trim() || undefined,
        suppressMinutes: action === 'SUPPRESS' ? 120 : undefined,
      });
      setActionNote('');
      setFeedback(`Alert updated (${action}).`);
      await Promise.all([loadAlerts(), loadDetail(selectedAlert.id)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update alert status.');
    }
  };

  const handleSaveThresholds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!thresholds || !canManage) return;
    setSavingThresholds(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await adminApi.updateAlertThresholds(thresholds);
      setThresholds(res.thresholds);
      setFeedback('Alert thresholds and telemetry retention policy updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update threshold rules.');
    } finally {
      setSavingThresholds(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] text-xs text-[#667085]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#2D46E6]" />
        Loading Operational Alerting Engine...
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

      {/* Summary Counters */}
      {data && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5">
            <div className="text-[11px] text-[#667085]">Open Alerts</div>
            <div className="font-mono text-2xl font-bold tabular-nums text-[#DC2626]">
              {data.summary.open}
            </div>
          </div>
          <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5">
            <div className="text-[11px] text-[#667085]">Critical Active</div>
            <div className="font-mono text-2xl font-bold tabular-nums text-[#B91C1C]">
              {data.summary.criticalOpen}
            </div>
          </div>
          <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5">
            <div className="text-[11px] text-[#667085]">Acknowledged</div>
            <div className="font-mono text-2xl font-bold tabular-nums text-[#1D4ED8]">
              {data.summary.acknowledged}
            </div>
          </div>
          <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5">
            <div className="text-[11px] text-[#667085]">Suppressed</div>
            <div className="font-mono text-2xl font-bold tabular-nums text-[#64748B]">
              {data.summary.suppressed}
            </div>
          </div>
          <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5">
            <div className="text-[11px] text-[#667085]">Resolved</div>
            <div className="font-mono text-2xl font-bold tabular-nums text-[#15803D]">
              {data.summary.resolved}
            </div>
          </div>
        </div>
      )}

      {/* Controls & Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter alerts by status"
            className="h-8 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono text-xs"
          >
            <option value="ALL">All Statuses</option>
            <option value="OPEN">OPEN</option>
            <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
            <option value="SUPPRESSED">SUPPRESSED</option>
            <option value="RESOLVED">RESOLVED</option>
          </select>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            aria-label="Filter alerts by severity"
            className="h-8 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono text-xs"
          >
            <option value="ALL">All Severities</option>
            <option value="CRITICAL">CRITICAL</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter alerts by category"
            className="h-8 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono text-xs"
          >
            <option value="ALL">All Categories</option>
            <option value="API">API</option>
            <option value="AI">AI</option>
            <option value="SECURITY">SECURITY</option>
            <option value="MARKET_DATA">MARKET_DATA</option>
            <option value="BACKGROUND_JOB">BACKGROUND_JOB</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowThresholds((v) => !v)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] cursor-pointer"
          >
            <Sliders className="h-3.5 w-3.5" />
            <span>{showThresholds ? 'Hide Rules' : 'Threshold Rules'}</span>
          </button>
          {canManage && (
            <button
              type="button"
              disabled={evaluating}
              onClick={() => void handleEvaluate()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#2D46E6] px-3.5 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              <span>{evaluating ? 'Evaluating...' : 'Evaluate Thresholds Now'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Collapsible Threshold Policy Editor */}
      {showThresholds && thresholds && (
        <form
          onSubmit={handleSaveThresholds}
          className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              Alert Detection Thresholds & Retention Policy
            </h2>
            <span className="font-mono text-[10px] text-[#667085]">
              Persisted in platform_settings (alert_thresholds)
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
            {[
              { key: 'apiErrorRateCriticalPct', label: 'API 5xx Critical (%)', min: 1, max: 100 },
              { key: 'apiP95LatencyWarningMs', label: 'API P95 Warning (ms)', min: 100, max: 30000 },
              { key: 'aiFailureRateWarningPct', label: 'AI Failure Warning (%)', min: 1, max: 100 },
              { key: 'failedLoginsBurstThreshold', label: 'Failed Logins / 15m', min: 2, max: 500 },
              { key: 'marketSyncStaleMinutes', label: 'Market Sync Stale (min)', min: 5, max: 43200 },
              { key: 'stuckJobMinutes', label: 'Stuck Job Window (min)', min: 1, max: 1440 },
              { key: 'alertCooldownMinutes', label: 'Alert Cooldown (min)', min: 1, max: 1440 },
              { key: 'retentionDays', label: 'Telemetry Retention (days)', min: 7, max: 90 },
            ].map((field) => (
              <label key={field.key} className="space-y-1">
                <span className="block text-[11px] text-[#475467]">{field.label}</span>
                <input
                  type="number"
                  min={field.min}
                  max={field.max}
                  disabled={!canManage}
                  value={thresholds[field.key as keyof ObservabilityThresholdsConfig]}
                  onChange={(e) =>
                    setThresholds({
                      ...thresholds,
                      [field.key]: Number(e.target.value) || field.min,
                    })
                  }
                  className="h-8 w-full rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2 font-mono text-xs"
                />
              </label>
            ))}
          </div>
          {canManage && (
            <button
              type="submit"
              disabled={savingThresholds}
              className="h-8 rounded-md bg-[#080B12] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#1E293B] cursor-pointer disabled:opacity-50"
            >
              {savingThresholds ? 'Saving...' : 'Save Threshold Policy'}
            </button>
          )}
        </form>
      )}

      {/* Split Master-Detail */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="xl:col-span-7 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
          <div className="border-b border-[#E4E8F2] px-4 py-3 flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              <Bell className="h-4 w-4 text-[#2D46E6]" />
              <span>Operational Alerts ({data?.total ?? 0})</span>
            </h2>
            <span className="font-mono text-[10px] text-[#667085]">Deduplicated by fingerprint</span>
          </div>
          {!data || data.alerts.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#667085]">
              No operational alerts match the selected filters. Run threshold evaluation after telemetry events to test detection.
            </div>
          ) : (
            <div className="divide-y divide-[#F1F5F9] max-h-[540px] overflow-y-auto">
              {data.alerts.map((al) => {
                const active = selectedId === al.id;
                return (
                  <button
                    key={al.id}
                    type="button"
                    onClick={() => setSelectedId(al.id)}
                    className={`w-full px-4 py-3 text-left transition-colors cursor-pointer ${
                      active ? 'bg-[#EFF2FA]' : 'hover:bg-[#F7F8FA]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ${severityBadge(al.severity)}`}
                          >
                            {al.severity}
                          </span>
                          <span
                            className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ${alertStatusBadge(al.status)}`}
                          >
                            {al.status}
                          </span>
                          <span className="font-mono text-[10px] text-[#667085]">{al.category}</span>
                        </div>
                        <div className="text-xs font-semibold text-[#080B12]">{al.title}</div>
                        <p className="text-[11px] text-[#475467] line-clamp-2">{al.description}</p>
                      </div>
                      <div className="shrink-0 text-right font-mono text-[10px] text-[#667085] tabular-nums">
                        <div>{al.occurrenceCount}x</div>
                        <div>{new Date(al.lastDetectedAt).toLocaleTimeString()}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="xl:col-span-5 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-4">
          {!selectedAlert ? (
            <div className="py-16 text-center text-xs text-[#667085]">
              Select an operational alert to inspect details, transition status, or view history.
            </div>
          ) : (
            <>
              <div className="space-y-1.5 border-b border-[#F1F5F9] pb-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-[#667085]">{selectedAlert.fingerprint}</span>
                  <span
                    className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${alertStatusBadge(selectedAlert.status)}`}
                  >
                    {selectedAlert.status}
                  </span>
                </div>
                <h3 className="font-display text-sm font-bold text-[#080B12]">{selectedAlert.title}</h3>
                <p className="text-xs text-[#475467]">{selectedAlert.description}</p>
                <div className="grid grid-cols-3 gap-2 pt-2 font-mono text-[11px] tabular-nums">
                  <div className="rounded border border-[#E4E8F2] bg-[#F7F8FA] p-2">
                    <div className="text-[10px] text-[#667085]">Observed</div>
                    <div className="font-bold text-[#080B12]">
                      {selectedAlert.metricValue ?? 'N/A'}
                    </div>
                  </div>
                  <div className="rounded border border-[#E4E8F2] bg-[#F7F8FA] p-2">
                    <div className="text-[10px] text-[#667085]">Threshold</div>
                    <div className="font-bold text-[#080B12]">
                      {selectedAlert.thresholdValue ?? 'N/A'}
                    </div>
                  </div>
                  <div className="rounded border border-[#E4E8F2] bg-[#F7F8FA] p-2">
                    <div className="text-[10px] text-[#667085]">Occurrences</div>
                    <div className="font-bold text-[#080B12]">{selectedAlert.occurrenceCount}</div>
                  </div>
                </div>
              </div>

              {canManage && (
                <div className="space-y-2.5">
                  <textarea
                    rows={2}
                    value={actionNote}
                    onChange={(e) => setActionNote(e.target.value)}
                    placeholder="Optional investigation note or suppression rationale..."
                    className="w-full rounded border border-[#E4E8F2] bg-[#F7F8FA] p-2 text-xs"
                  />
                  <div className="flex flex-wrap gap-2">
                    {selectedAlert.status === 'OPEN' && (
                      <button
                        type="button"
                        onClick={() => void handleAlertAction('ACKNOWLEDGE')}
                        className="rounded bg-[#2D46E6] px-2.5 py-1 text-[11px] font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer"
                      >
                        Acknowledge
                      </button>
                    )}
                    {selectedAlert.status !== 'RESOLVED' && (
                      <button
                        type="button"
                        onClick={() => void handleAlertAction('RESOLVE')}
                        className="rounded bg-[#15803D] px-2.5 py-1 text-[11px] font-semibold text-[#FFFFFF] hover:bg-[#166534] cursor-pointer"
                      >
                        Resolve
                      </button>
                    )}
                    {selectedAlert.status !== 'SUPPRESSED' && selectedAlert.status !== 'RESOLVED' && (
                      <button
                        type="button"
                        onClick={() => void handleAlertAction('SUPPRESS')}
                        className="rounded border border-[#CBD5E1] bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-semibold text-[#475467] hover:bg-[#E2E8F0] cursor-pointer"
                      >
                        Suppress (2h)
                      </button>
                    )}
                    {(selectedAlert.status === 'RESOLVED' || selectedAlert.status === 'SUPPRESSED') && (
                      <button
                        type="button"
                        onClick={() => void handleAlertAction('REOPEN')}
                        className="rounded border border-[#FECACA] bg-[#FEF2F2] px-2.5 py-1 text-[11px] font-semibold text-[#B91C1C] cursor-pointer"
                      >
                        Reopen
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!actionNote.trim()}
                      onClick={() => void handleAlertAction('NOTE')}
                      className="rounded border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 py-1 text-[11px] font-semibold text-[#080B12] cursor-pointer disabled:opacity-40"
                    >
                      Save Note
                    </button>
                    {onNavigate && (
                      <button
                        type="button"
                        onClick={() =>
                          onNavigate(`/admin/incidents?alertId=${encodeURIComponent(selectedAlert.id)}`)
                        }
                        className="ml-auto inline-flex items-center gap-1 rounded border border-[#2D46E6] px-2.5 py-1 text-[11px] font-semibold text-[#2D46E6] hover:bg-[#EFF2FA] cursor-pointer"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        <span>Escalate to Incident</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Alert History Timeline */}
              <div className="space-y-2 border-t border-[#F1F5F9] pt-3">
                <div className="inline-flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                  <Clock className="h-3.5 w-3.5 text-[#2D46E6]" />
                  <span>Alert State History ({selectedHistory.length})</span>
                </div>
                <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                  {selectedHistory.map((h) => (
                    <div
                      key={h.id}
                      className="rounded border border-[#F1F5F9] bg-[#F7F8FA] px-3 py-2 text-[11px]"
                    >
                      <div className="flex items-center justify-between font-mono text-[10px]">
                        <span className="font-semibold text-[#080B12]">
                          {h.previousStatus ? `${h.previousStatus} → ` : ''}
                          {h.newStatus}
                        </span>
                        <span className="text-[#667085]">{new Date(h.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="mt-0.5 text-[#475467]">{h.note}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-[#94A3B8]">
                        Actor: {h.actorEmail}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
