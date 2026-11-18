import React, { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, Search, UserCheck } from 'lucide-react';
import type { AdminUserSummaryDto } from '../../admin/types';
import { adminApi } from '../../lib/adminApi';

interface AdminUsersViewProps {
  onNavigate: (href: string) => void;
  initialSearch?: string;
}

export const AdminUsersView: React.FC<AdminUsersViewProps> = ({
  onNavigate,
  initialSearch = '',
}) => {
  const [search, setSearch] = useState(initialSearch);
  const [role, setRole] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [verified, setVerified] = useState('ALL');
  const [sort, setSort] = useState('created_desc');
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const [users, setUsers] = useState<AdminUserSummaryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSearch(initialSearch);
    setOffset(0);
  }, [initialSearch]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.listUsers({
        search: search.trim() || undefined,
        role,
        status,
        verified,
        sort,
        limit,
        offset,
      });
      setUsers(res.users);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load user directory.');
    } finally {
      setLoading(false);
    }
  }, [search, role, status, verified, sort, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="space-y-4">
      {/* Filter & Export Bar */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            <div className="relative min-w-[220px] flex-1 max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#667085]" />
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setOffset(0);
                  setSearch(e.target.value);
                }}
                placeholder="Search name or email..."
                aria-label="Search users"
                className="h-9 w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] pl-8 pr-3 text-xs text-[#080B12] focus:border-[#2D46E6] focus:bg-[#FFFFFF] focus:outline-none"
              />
            </div>

            <select
              value={role}
              onChange={(e) => {
                setOffset(0);
                setRole(e.target.value);
              }}
              aria-label="Filter by role"
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 text-xs text-[#080B12]"
            >
              <option value="ALL">All Roles</option>
              <option value="user">user</option>
              <option value="viewer">viewer</option>
              <option value="support_admin">support_admin</option>
              <option value="data_admin">data_admin</option>
              <option value="ai_admin">ai_admin</option>
              <option value="security_admin">security_admin</option>
              <option value="admin">admin</option>
              <option value="super_admin">super_admin</option>
            </select>

            <select
              value={status}
              onChange={(e) => {
                setOffset(0);
                setStatus(e.target.value);
              }}
              aria-label="Filter by account status"
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 text-xs text-[#080B12]"
            >
              <option value="ALL">All Statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="deleted">Deleted</option>
            </select>

            <select
              value={verified}
              onChange={(e) => {
                setOffset(0);
                setVerified(e.target.value);
              }}
              aria-label="Filter by email verification"
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 text-xs text-[#080B12]"
            >
              <option value="ALL">All Verification</option>
              <option value="true">Verified</option>
              <option value="false">Unverified</option>
            </select>

            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Sort users"
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 text-xs text-[#080B12]"
            >
              <option value="created_desc">Newest First</option>
              <option value="created_asc">Oldest First</option>
              <option value="name_asc">Name A–Z</option>
              <option value="last_login_desc">Recent Login</option>
            </select>
          </div>

          <a
            href="/api/admin/users/export"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6]"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </a>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-xs text-[#B91C1C]">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="flex items-center justify-between border-b border-[#E4E8F2] px-4 py-3">
          <div className="flex items-center gap-2 font-mono text-xs text-[#475467]">
            <UserCheck className="h-4 w-4 text-[#2D46E6]" />
            <span>
              <strong className="text-[#080B12] tabular-nums">{total.toLocaleString()}</strong> accounts matched
            </span>
          </div>
          <span className="font-mono text-[11px] text-[#667085] tabular-nums">
            Page {currentPage} / {totalPages}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#E4E8F2] bg-[#F7F8FA] font-mono text-[10px] uppercase tracking-wider text-[#667085]">
                <th className="px-4 py-2.5">User</th>
                <th className="px-3 py-2.5">Role</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Verified</th>
                <th className="px-3 py-2.5">Sessions</th>
                <th className="px-3 py-2.5">Last Login</th>
                <th className="px-4 py-2.5 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[#667085]">
                    <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin text-[#2D46E6]" />
                    Loading user directory...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[#667085]">
                    No user accounts matched the active filters.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => onNavigate(`/admin/users/${u.id}`)}
                    className="h-11 hover:bg-[#F7F8FA] cursor-pointer"
                  >
                    <td className="px-4 py-2">
                      <div className="font-semibold text-[#080B12]">{u.fullName}</div>
                      <div className="font-mono text-[11px] text-[#667085]">{u.email}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded border border-[#CBD5E1] bg-[#F8FAFC] px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-[#080B12]">
                        {u.role}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                          u.accountStatus === 'active'
                            ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                            : u.accountStatus === 'suspended'
                              ? 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]'
                              : 'border-[#E2E8F0] bg-[#F1F5F9] text-[#64748B]'
                        }`}
                      >
                        {u.accountStatus}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">
                      {u.emailVerified ? (
                        <span className="text-[#15803D]">YES</span>
                      ) : (
                        <span className="text-[#B45309]">PENDING</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums text-[#080B12]">
                      {u.activeSessionCount}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-[#667085]">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigate(`/admin/users/${u.id}`);
                        }}
                        className="rounded border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 py-1 text-[11px] font-semibold text-[#2D46E6] hover:border-[#2D46E6] cursor-pointer"
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-[#E4E8F2] px-4 py-2.5 text-xs">
          <span className="font-mono text-[11px] text-[#667085] tabular-nums">
            Showing {total === 0 ? 0 : offset + 1}–{Math.min(offset + limit, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
              className="h-8 rounded border border-[#E4E8F2] bg-[#FFFFFF] px-3 text-xs font-semibold text-[#080B12] disabled:opacity-40 cursor-pointer"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={offset + limit >= total}
              onClick={() => setOffset(offset + limit)}
              className="h-8 rounded border border-[#E4E8F2] bg-[#FFFFFF] px-3 text-xs font-semibold text-[#080B12] disabled:opacity-40 cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
