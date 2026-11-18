import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Lock,
  Megaphone,
  MessageSquare,
  Plus,
  Trash2,
} from 'lucide-react';
import type {
  AdminAnnouncementDto,
  AnnouncementCategory,
  AnnouncementSeverity,
  AnnouncementStatus,
  SupportTicketDto,
  SupportTicketPriority,
  SupportTicketStatus,
} from '../../admin/types';
import { PERMISSIONS } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import { adminApi, type AdminRoleCatalogEntry } from '../../lib/adminApi';
import { AccountSettingsPanel, SecuritySessionsPanel } from '../auth/AccountSecurityPanels';

export const AdminAccessControlView: React.FC = () => {
  const [roles, setRoles] = useState<AdminRoleCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .getRolesAndPermissions()
      .then((res) => setRoles(res.roles))
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load RBAC matrix.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] text-xs text-[#667085]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#2D46E6]" />
        Loading RBAC Role & Permission Matrix...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <div role="alert" className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-2.5 text-xs text-[#B91C1C]">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4">
        <div className="mb-3 flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
          <Lock className="h-4 w-4 text-[#2D46E6]" />
          <span>Server-Enforced Roles & Permission Matrix ({roles.length} Roles)</span>
        </div>
        <p className="mb-4 text-xs text-[#667085]">
          Permissions are enforced inside Express middleware before any admin handler runs. To promote or demote an individual user, navigate to Users → Manage (Super Admin + Password Re-Auth required).
        </p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {roles.map((r) => (
            <div key={r.role} className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-display text-sm font-bold text-[#080B12]">{r.label}</div>
                  <div className="font-mono text-[11px] text-[#2D46E6]">{r.role}</div>
                </div>
                <span className="rounded border border-[#CBD5E1] bg-[#FFFFFF] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-[#475467]">
                  {r.tier}
                </span>
              </div>
              <p className="text-xs text-[#475467]">{r.description}</p>
              <div className="flex flex-wrap gap-1 pt-1">
                {r.permissions.map((perm) => (
                  <span
                    key={perm}
                    className="rounded border border-[#E2E8F0] bg-[#FFFFFF] px-1.5 py-0.5 font-mono text-[10px] text-[#334155]"
                  >
                    {perm}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const AdminAnnouncementsView: React.FC = () => {
  const { user } = useAuth();
  const canManage = new Set<string>(user?.permissions ?? []).has(
    PERMISSIONS.ADMIN_ANNOUNCEMENTS_MANAGE,
  );

  const [items, setItems] = useState<AdminAnnouncementDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<AnnouncementCategory>('UPDATE');
  const [severity, setSeverity] = useState<AnnouncementSeverity>('INFO');
  const [status, setStatus] = useState<AnnouncementStatus>('PUBLISHED');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.listAnnouncements();
      setItems(res.announcements);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load announcements.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setFeedback(null);
    try {
      await adminApi.createAnnouncement({
        title: title.trim(),
        content: content.trim(),
        category,
        severity,
        status,
      });
      setTitle('');
      setContent('');
      setFeedback('Announcement created.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create announcement.');
    } finally {
      setCreating(false);
    }
  };

  const handleTogglePublish = async (item: AdminAnnouncementDto) => {
    setError(null);
    setFeedback(null);
    try {
      const nextStatus: AnnouncementStatus =
        item.status === 'PUBLISHED' ? 'UNPUBLISHED' : 'PUBLISHED';
      await adminApi.updateAnnouncement(item.id, { status: nextStatus });
      setFeedback(`Announcement "${item.title}" ${nextStatus.toLowerCase()}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update announcement.');
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    setFeedback(null);
    try {
      await adminApi.deleteAnnouncement(id);
      setFeedback('Announcement deleted.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete announcement.');
    }
  };

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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {canManage && (
          <form
            onSubmit={handleCreate}
            className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3"
          >
            <div className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              <Plus className="h-4 w-4 text-[#2D46E6]" />
              <span>Compose Platform Announcement</span>
            </div>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Headline (plain text, sanitized)..."
              className="h-9 w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs"
            />
            <textarea
              rows={3}
              required
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Announcement body shown in workspace banner when published..."
              className="w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] p-2.5 text-xs"
            />
            <div className="grid grid-cols-3 gap-2 text-xs">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as AnnouncementCategory)}
                className="h-9 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2 font-mono text-[11px]"
              >
                <option value="UPDATE">UPDATE</option>
                <option value="MAINTENANCE">MAINTENANCE</option>
                <option value="SECURITY">SECURITY</option>
                <option value="MARKET_NOTICE">MARKET_NOTICE</option>
              </select>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as AnnouncementSeverity)}
                className="h-9 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2 font-mono text-[11px]"
              >
                <option value="INFO">INFO</option>
                <option value="WARNING">WARNING</option>
                <option value="CRITICAL">CRITICAL</option>
              </select>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as AnnouncementStatus)}
                className="h-9 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2 font-mono text-[11px]"
              >
                <option value="PUBLISHED">PUBLISHED</option>
                <option value="DRAFT">DRAFT</option>
                <option value="SCHEDULED">SCHEDULED</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={creating}
              className="h-9 rounded-md bg-[#2D46E6] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer disabled:opacity-50"
            >
              {creating ? 'Saving...' : 'Save Announcement'}
            </button>
          </form>
        )}

        <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
          <div className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            <Megaphone className="h-4 w-4 text-[#2D46E6]" />
            <span>Announcements ({items.length})</span>
          </div>
          {loading ? (
            <div className="py-8 text-center text-xs text-[#667085]">Loading...</div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#667085]">No announcements yet.</div>
          ) : (
            <div className="space-y-2.5 max-h-96 overflow-y-auto">
              {items.map((a) => (
                <div key={a.id} className="rounded border border-[#E4E8F2] bg-[#F7F8FA] p-3 text-xs space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#080B12]">{a.title}</span>
                    <div className="flex items-center gap-1 font-mono text-[10px]">
                      <span className="rounded border border-[#CBD5E1] bg-[#FFFFFF] px-1.5 py-0.5">
                        {a.severity}
                      </span>
                      <span
                        className={`rounded border px-1.5 py-0.5 ${
                          a.status === 'PUBLISHED'
                            ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                            : 'border-[#E2E8F0] bg-[#FFFFFF] text-[#64748B]'
                        }`}
                      >
                        {a.status}
                      </span>
                    </div>
                  </div>
                  <p className="text-[#475467]">{a.content}</p>
                  {canManage && (
                    <div className="flex items-center justify-end gap-3 pt-1">
                      <button
                        type="button"
                        onClick={() => void handleTogglePublish(a)}
                        className="text-[11px] font-semibold text-[#2D46E6] hover:underline cursor-pointer"
                      >
                        {a.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(a.id)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#DC2626] hover:underline cursor-pointer"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const AdminSupportView: React.FC = () => {
  const { user } = useAuth();
  const canManage = new Set<string>(user?.permissions ?? []).has(PERMISSIONS.ADMIN_SUPPORT_MANAGE);

  const [tickets, setTickets] = useState<SupportTicketDto[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.listSupportTickets({ status: statusFilter });
      setTickets(res.tickets);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load support queue.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpdateTicket = async (
    id: string,
    patch: { status?: SupportTicketStatus; priority?: SupportTicketPriority; resolutionNotes?: string },
  ) => {
    setError(null);
    setFeedback(null);
    try {
      await adminApi.updateSupportTicket(id, patch);
      setFeedback('Support ticket updated.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update ticket.');
    }
  };

  return (
    <div className="space-y-4">
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

      <div className="flex items-center justify-between rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4">
        <div className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
          <MessageSquare className="h-4 w-4 text-[#2D46E6]" />
          <span>Public Contact & Support Queue ({tickets.length})</span>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-8 rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 font-mono text-xs"
        >
          <option value="ALL">All Statuses</option>
          <option value="OPEN">OPEN</option>
          <option value="IN_PROGRESS">IN_PROGRESS</option>
          <option value="RESOLVED">RESOLVED</option>
          <option value="CLOSED">CLOSED</option>
        </select>
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-8 text-center text-xs text-[#667085]">
            Loading support queue...
          </div>
        ) : tickets.length === 0 ? (
          <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-8 text-center text-xs text-[#667085]">
            No support tickets match the selected status. Submissions from <code className="font-mono">/contact</code> appear here automatically.
          </div>
        ) : (
          tickets.map((t) => (
            <div key={t.id} className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-mono font-bold text-[#2D46E6]">{t.ticketId}</span>{' '}
                  <strong className="text-[#080B12]">· {t.topic}</strong> — {t.name} ({t.email})
                </div>
                <div className="flex items-center gap-1.5 font-mono text-[10px]">
                  <span className="rounded border border-[#CBD5E1] px-1.5 py-0.5">{t.priority}</span>
                  <span className="rounded border border-[#CBD5E1] px-1.5 py-0.5 font-semibold">
                    {t.status}
                  </span>
                </div>
              </div>
              <p className="text-[#475467] whitespace-pre-wrap">{t.message}</p>
              {canManage && (
                <div className="flex flex-wrap items-center gap-2 border-t border-[#F1F5F9] pt-2.5">
                  <input
                    type="text"
                    value={notesDraft[t.id] ?? t.resolutionNotes}
                    onChange={(e) => setNotesDraft({ ...notesDraft, [t.id]: e.target.value })}
                    placeholder="Internal resolution notes..."
                    className="h-8 flex-1 min-w-[200px] rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void handleUpdateTicket(t.id, {
                        status: 'IN_PROGRESS',
                        resolutionNotes: notesDraft[t.id] ?? t.resolutionNotes,
                      })
                    }
                    className="h-8 rounded border border-[#E4E8F2] px-2.5 text-[11px] font-semibold hover:border-[#2D46E6] cursor-pointer"
                  >
                    In Progress
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void handleUpdateTicket(t.id, {
                        status: 'RESOLVED',
                        resolutionNotes: notesDraft[t.id] ?? t.resolutionNotes,
                      })
                    }
                    className="h-8 rounded bg-[#15803D] px-3 text-[11px] font-semibold text-[#FFFFFF] cursor-pointer"
                  >
                    Mark Resolved
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export const AdminSettingsView: React.FC<{ onNavigate: (href: string) => void }> = ({
  onNavigate,
}) => {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4">
        <AccountSettingsPanel onNavigate={onNavigate} />
      </div>
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4">
        <SecuritySessionsPanel onNavigate={onNavigate} />
      </div>
    </div>
  );
};
