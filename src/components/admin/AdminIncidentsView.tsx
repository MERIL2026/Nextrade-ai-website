import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertOctagon,
  CheckCircle2,
  Clock,
  Link2,
  Loader2,
  Plus,
  UserCheck,
} from 'lucide-react';
import type {
  AdminIncidentDto,
  IncidentEventDto,
  IncidentSeverity,
  IncidentStatus,
} from '../../admin/types';
import { PERMISSIONS } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import { adminApi } from '../../lib/adminApi';

interface AdminIncidentsViewProps {
  initialLinkedAlertId?: string;
}

const WORKFLOW_STATUSES: IncidentStatus[] = [
  'OPEN',
  'INVESTIGATING',
  'IDENTIFIED',
  'MONITORING',
  'MITIGATED',
  'RESOLVED',
];

function severityBadge(sev: string): string {
  if (sev === 'CRITICAL') return 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]';
  if (sev === 'HIGH') return 'border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]';
  if (sev === 'MEDIUM') return 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]';
  return 'border-[#E2E8F0] bg-[#F8FAFC] text-[#475467]';
}

function statusBadge(st: string): string {
  if (st === 'RESOLVED') return 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]';
  if (st === 'MONITORING' || st === 'MITIGATED') return 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]';
  if (st === 'INVESTIGATING' || st === 'IDENTIFIED') return 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]';
  return 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]';
}

export const AdminIncidentsView: React.FC<AdminIncidentsViewProps> = ({
  initialLinkedAlertId = '',
}) => {
  const { user } = useAuth();
  const canManage = new Set<string>(user?.permissions ?? []).has(PERMISSIONS.ADMIN_INCIDENTS_MANAGE);

  const [statusFilter, setStatusFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [incidents, setIncidents] = useState<AdminIncidentDto[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<AdminIncidentDto | null>(null);
  const [timeline, setTimeline] = useState<IncidentEventDto[]>([]);

  const [showCreate, setShowCreate] = useState(Boolean(initialLinkedAlertId));
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newSeverity, setNewSeverity] = useState<IncidentSeverity>('HIGH');
  const [newOwnerEmail, setNewOwnerEmail] = useState(user?.email ?? '');
  const [newLinkedAlertId, setNewLinkedAlertId] = useState(initialLinkedAlertId);

  const [noteInput, setNoteInput] = useState('');
  const [ownerInput, setOwnerInput] = useState('');
  const [linkAlertInput, setLinkAlertInput] = useState('');
  const [linkRefInput, setLinkRefInput] = useState('');
  const [resolutionNotesInput, setResolutionNotesInput] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.listIncidents({
        status: statusFilter,
        severity: severityFilter,
        limit: 50,
        offset: 0,
      });
      setIncidents(res.incidents);
      setTotal(res.total);
      if (res.incidents.length > 0 && !selectedId) {
        setSelectedId(res.incidents[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load incidents.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, severityFilter, selectedId]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await adminApi.getIncidentDetail(id);
      setSelectedIncident(res.incident);
      setTimeline(res.timeline);
      setOwnerInput(res.incident.ownerEmail || '');
      setResolutionNotesInput(res.incident.resolutionNotes || '');
    } catch {
      // ignore transient selection error
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    } else {
      setSelectedIncident(null);
      setTimeline([]);
    }
  }, [selectedId, loadDetail]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await adminApi.createIncidentV4({
        title: newTitle.trim(),
        description: newDescription.trim(),
        severity: newSeverity,
        ownerEmail: newOwnerEmail.trim() || undefined,
        linkedAlertIds: newLinkedAlertId.trim() ? [newLinkedAlertId.trim()] : [],
      });
      setNewTitle('');
      setNewDescription('');
      setNewLinkedAlertId('');
      setShowCreate(false);
      setSelectedId(res.incident.id);
      setFeedback('Incident opened and immutable timeline initialized.');
      await loadList();
      await loadDetail(res.incident.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create incident.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (patch: {
    status?: IncidentStatus;
    note?: string;
    ownerEmail?: string;
    resolutionNotes?: string;
    linkAlertId?: string;
    linkEventRef?: string;
  }) => {
    if (!selectedIncident) return;
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      await adminApi.updateIncidentV4(selectedIncident.id, patch);
      setNoteInput('');
      setLinkAlertInput('');
      setLinkRefInput('');
      setFeedback('Incident timeline updated.');
      await Promise.all([loadList(), loadDetail(selectedIncident.id)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update incident.');
    } finally {
      setSaving(false);
    }
  };

  if (loading && incidents.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] text-xs text-[#667085]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#2D46E6]" />
        Loading Incident Response Console...
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

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter incidents by status"
            className="h-8 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono text-xs"
          >
            <option value="ALL">All Statuses</option>
            {WORKFLOW_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            aria-label="Filter incidents by severity"
            className="h-8 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono text-xs"
          >
            <option value="ALL">All Severities</option>
            <option value="CRITICAL">CRITICAL</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>
          <span className="font-mono text-[11px] text-[#667085]">{total} total</span>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#2D46E6] px-3.5 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{showCreate ? 'Close Form' : 'Open New Incident'}</span>
          </button>
        )}
      </div>

      {/* Create Incident Form */}
      {showCreate && canManage && (
        <form
          onSubmit={handleCreate}
          className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3"
        >
          <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            Open Operational / Security Incident
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
            <input
              type="text"
              required
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Incident title (e.g. Elevated AI fallback latency)..."
              className="h-9 sm:col-span-2 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-3"
            />
            <select
              value={newSeverity}
              onChange={(e) => setNewSeverity(e.target.value as IncidentSeverity)}
              className="h-9 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono"
            >
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
              <option value="CRITICAL">CRITICAL</option>
            </select>
          </div>
          <textarea
            rows={2}
            required
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Scope, impacted services, and initial observed symptoms..."
            className="w-full rounded border border-[#E4E8F2] bg-[#F7F8FA] p-2.5 text-xs"
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
            <input
              type="email"
              value={newOwnerEmail}
              onChange={(e) => setNewOwnerEmail(e.target.value)}
              placeholder="Incident commander / owner email..."
              className="h-9 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-3"
            />
            <input
              type="text"
              value={newLinkedAlertId}
              onChange={(e) => setNewLinkedAlertId(e.target.value)}
              placeholder="Optional linked operational alert ID..."
              className="h-9 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-3 font-mono"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="h-9 rounded-md bg-[#080B12] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#1E293B] cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create Incident'}
          </button>
        </form>
      )}

      {/* Split Master-Detail */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="xl:col-span-5 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
          <div className="border-b border-[#E4E8F2] px-4 py-3">
            <h2 className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              <AlertOctagon className="h-4 w-4 text-[#2D46E6]" />
              <span>Incident Queue ({incidents.length})</span>
            </h2>
          </div>
          {incidents.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#667085]">
              No operational or security incidents logged yet.
            </div>
          ) : (
            <div className="divide-y divide-[#F1F5F9] max-h-[580px] overflow-y-auto">
              {incidents.map((inc) => (
                <button
                  key={inc.id}
                  type="button"
                  onClick={() => setSelectedId(inc.id)}
                  className={`w-full px-4 py-3 text-left transition-colors cursor-pointer ${
                    selectedId === inc.id ? 'bg-[#EFF2FA]' : 'hover:bg-[#F7F8FA]'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold ${severityBadge(inc.severity)}`}>
                      {inc.severity}
                    </span>
                    <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold ${statusBadge(inc.status)}`}>
                      {inc.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs font-semibold text-[#080B12]">{inc.title}</div>
                  <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-[#667085]">
                    <span>Owner: {inc.ownerEmail || 'Unassigned'}</span>
                    <span>{new Date(inc.createdAt).toLocaleDateString()}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="xl:col-span-7 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-4">
          {!selectedIncident ? (
            <div className="py-16 text-center text-xs text-[#667085]">
              Select an incident from the queue to inspect workflow transitions, owner assignment, linked telemetry, and timeline history.
            </div>
          ) : (
            <>
              <div className="space-y-2 border-b border-[#F1F5F9] pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-[#667085]">
                    ID: {selectedIncident.id} · Source: {selectedIncident.source}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${severityBadge(selectedIncident.severity)}`}>
                      {selectedIncident.severity}
                    </span>
                    <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${statusBadge(selectedIncident.status)}`}>
                      {selectedIncident.status}
                    </span>
                  </div>
                </div>
                <h3 className="font-display text-base font-bold text-[#080B12]">
                  {selectedIncident.title}
                </h3>
                <p className="text-xs leading-relaxed text-[#475467]">
                  {selectedIncident.description}
                </p>

                {((selectedIncident.linkedAlertIds?.length ?? 0) > 0 ||
                  (selectedIncident.linkedEventRefs?.length ?? 0) > 0) && (
                  <div className="flex flex-wrap gap-2 pt-1 font-mono text-[10px]">
                    {selectedIncident.linkedAlertIds?.map((alId) => (
                      <span
                        key={alId}
                        className="inline-flex items-center gap-1 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2 py-0.5 text-[#080B12]"
                      >
                        <Link2 className="h-3 w-3 text-[#2D46E6]" />
                        Alert: {alId.slice(0, 12)}
                      </span>
                    ))}
                    {selectedIncident.linkedEventRefs?.map((ref) => (
                      <span
                        key={ref}
                        className="inline-flex items-center gap-1 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2 py-0.5 text-[#080B12]"
                      >
                        <Link2 className="h-3 w-3 text-[#0F766E]" />
                        Ref: {ref}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {canManage && (
                <div className="space-y-3 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 font-mono text-[10px] uppercase text-[#667085]">
                      Workflow:
                    </span>
                    {WORKFLOW_STATUSES.map((st) => (
                      <button
                        key={st}
                        type="button"
                        disabled={saving || selectedIncident.status === st}
                        onClick={() => void handleUpdate({ status: st })}
                        className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold cursor-pointer disabled:opacity-40 ${
                          selectedIncident.status === st
                            ? 'border-[#2D46E6] bg-[#2D46E6] text-[#FFFFFF]'
                            : 'border-[#E4E8F2] bg-[#FFFFFF] text-[#080B12] hover:border-[#2D46E6]'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="flex gap-1.5">
                      <input
                        type="email"
                        value={ownerInput}
                        onChange={(e) => setOwnerInput(e.target.value)}
                        placeholder="Owner email..."
                        className="h-8 flex-1 rounded border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 text-xs"
                      />
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleUpdate({ ownerEmail: ownerInput })}
                        className="inline-flex h-8 items-center gap-1 rounded border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 text-[11px] font-semibold hover:border-[#2D46E6] cursor-pointer"
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        <span>Assign</span>
                      </button>
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={linkRefInput}
                        onChange={(e) => setLinkRefInput(e.target.value)}
                        placeholder="Link telemetry ref / alert ID..."
                        className="h-8 flex-1 rounded border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 font-mono text-xs"
                      />
                      <button
                        type="button"
                        disabled={saving || (!linkRefInput.trim() && !linkAlertInput.trim())}
                        onClick={() =>
                          void handleUpdate({
                            linkEventRef: linkRefInput.trim() || undefined,
                            linkAlertId: linkAlertInput.trim() || undefined,
                          })
                        }
                        className="h-8 rounded border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 text-[11px] font-semibold hover:border-[#2D46E6] cursor-pointer disabled:opacity-40"
                      >
                        Link Ref
                      </button>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      placeholder="Add investigation note to immutable timeline..."
                      className="h-8 flex-1 rounded border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 text-xs"
                    />
                    <button
                      type="button"
                      disabled={saving || !noteInput.trim()}
                      onClick={() =>
                        void handleUpdate({
                          note: noteInput.trim(),
                          resolutionNotes: resolutionNotesInput,
                        })
                      }
                      className="h-8 rounded bg-[#080B12] px-3 text-[11px] font-semibold text-[#FFFFFF] cursor-pointer disabled:opacity-40"
                    >
                      Add Note
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={resolutionNotesInput}
                      onChange={(e) => setResolutionNotesInput(e.target.value)}
                      placeholder="Root cause & final resolution summary..."
                      className="h-8 flex-1 rounded border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 text-xs"
                    />
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleUpdate({ resolutionNotes: resolutionNotesInput })}
                      className="h-8 rounded border border-[#E4E8F2] bg-[#FFFFFF] px-3 text-[11px] font-semibold cursor-pointer"
                    >
                      Save Summary
                    </button>
                  </div>
                </div>
              )}

              {/* Immutable Timeline */}
              <div className="space-y-2 border-t border-[#F1F5F9] pt-3">
                <div className="inline-flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                  <Clock className="h-3.5 w-3.5 text-[#2D46E6]" />
                  <span>Incident Timeline ({timeline.length} events)</span>
                </div>
                {timeline.length === 0 ? (
                  <div className="rounded border border-dashed border-[#E4E8F2] p-4 text-center text-xs text-[#667085]">
                    No timeline events recorded for this legacy incident yet.
                  </div>
                ) : (
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {timeline.map((ev) => (
                      <div
                        key={ev.id}
                        className="rounded border border-[#F1F5F9] bg-[#F7F8FA] px-3 py-2 text-[11px]"
                      >
                        <div className="flex items-center justify-between font-mono text-[10px]">
                          <span className="font-semibold text-[#2D46E6]">
                            {ev.eventType}
                            {ev.previousStatus && ev.newStatus
                              ? ` (${ev.previousStatus} → ${ev.newStatus})`
                              : ''}
                          </span>
                          <span className="text-[#667085]">{new Date(ev.createdAt).toLocaleString()}</span>
                        </div>
                        <div className="mt-0.5 text-[#080B12]">{ev.note}</div>
                        <div className="mt-0.5 font-mono text-[10px] text-[#667085]">
                          By {ev.actorEmail}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
