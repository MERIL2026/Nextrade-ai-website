import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  HardDriveDownload,
  Loader2,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import type { BackupRecordDto, BackupVerificationEventDto } from '../../admin/types';
import { PERMISSIONS } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import { adminApi } from '../../lib/adminApi';
import { AdminReauthModal } from './AdminReauthModal';

export const AdminBackupsView: React.FC = () => {
  const { user } = useAuth();
  const perms = new Set<string>(user?.permissions ?? []);
  const canCreate = perms.has(PERMISSIONS.ADMIN_BACKUP_CREATE);
  const canRestore = perms.has(PERMISSIONS.ADMIN_BACKUP_RESTORE) && user?.role === 'super_admin';

  const [capabilities, setCapabilities] = useState<{
    dialect: string;
    environment: string;
    isSqliteFile: boolean;
    fullDatabaseBackupSupported: boolean;
    fullDatabaseBackupStatus: 'AVAILABLE' | 'NOT_CONFIGURED';
    fullDatabaseReason: string;
    configSnapshotSupported: boolean;
    configSnapshotNote: string;
  } | null>(null);
  const [backups, setBackups] = useState<BackupRecordDto[]>([]);
  const [events, setEvents] = useState<BackupVerificationEventDto[]>([]);

  const [loading, setLoading] = useState(true);
  const [creatingType, setCreatingType] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupRecordDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.listBackups();
      setCapabilities(res.capabilities);
      setBackups(res.backups);
      setEvents(res.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load backup and recovery telemetry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (backupType: 'CONFIG_SNAPSHOT' | 'SQLITE_SNAPSHOT' | 'FULL_DATABASE') => {
    setCreatingType(backupType);
    setError(null);
    setFeedback(null);
    try {
      const res = await adminApi.createBackup(backupType);
      setFeedback(
        `Created ${res.backup.backupType} (${res.backup.status}) with SHA-256 ${res.backup.checksumSha256?.slice(0, 12) ?? ''}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup creation failed.');
      await load();
    } finally {
      setCreatingType(null);
    }
  };

  const handleVerify = async (id: string) => {
    setVerifyingId(id);
    setError(null);
    setFeedback(null);
    try {
      const res = await adminApi.verifyBackup(id);
      setFeedback(`Backup ${res.backup.id.slice(0, 8)} verified: ${res.backup.verificationDetail}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Integrity verification failed.');
      await load();
    } finally {
      setVerifyingId(null);
    }
  };

  if (loading && !capabilities) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] text-xs text-[#667085]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#2D46E6]" />
        Inspecting Backup & Disaster Recovery Capabilities...
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

      {/* Honest Runtime Capabilities Banner */}
      {capabilities && (
        <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              <Database className="h-4 w-4 text-[#2D46E6]" />
              <span>Runtime Backup & Recovery Capability Matrix</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[10px]">
              <span className="rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2 py-0.5 uppercase text-[#475467]">
                env: {capabilities.environment}
              </span>
              <span className="rounded border border-[#E4E8F2] bg-[#F7F8FA] px-2 py-0.5 uppercase text-[#475467]">
                dialect: {capabilities.dialect}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div
              className={`rounded-md border p-3 text-xs space-y-1.5 ${
                capabilities.fullDatabaseBackupSupported
                  ? 'border-[#BBF7D0] bg-[#F0FDF4]'
                  : 'border-[#FDE68A] bg-[#FFFBEB]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#080B12]">Full Database Physical Backup</span>
                <span
                  className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                    capabilities.fullDatabaseBackupSupported
                      ? 'bg-[#DCFCE7] text-[#15803D]'
                      : 'bg-[#FEF3C7] text-[#B45309]'
                  }`}
                >
                  {capabilities.fullDatabaseBackupStatus}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-[#475467]">
                {capabilities.fullDatabaseReason}
              </p>
            </div>

            <div className="rounded-md border border-[#BFDBFE] bg-[#EFF6FF] p-3 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#080B12]">Governance & Config Snapshot</span>
                <span className="rounded bg-[#DBEAFE] px-2 py-0.5 font-mono text-[10px] font-bold text-[#1D4ED8]">
                  AVAILABLE
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-[#1E40AF]">
                {capabilities.configSnapshotNote}
              </p>
            </div>
          </div>

          {canCreate && (
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                disabled={Boolean(creatingType)}
                onClick={() => void handleCreate('CONFIG_SNAPSHOT')}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2D46E6] px-3.5 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] disabled:opacity-50 cursor-pointer"
              >
                <HardDriveDownload className="h-3.5 w-3.5" />
                <span>
                  {creatingType === 'CONFIG_SNAPSHOT'
                    ? 'Creating Config Snapshot...'
                    : 'Create Configuration Snapshot'}
                </span>
              </button>

              {capabilities.isSqliteFile ? (
                <button
                  type="button"
                  disabled={Boolean(creatingType)}
                  onClick={() => void handleCreate('SQLITE_SNAPSHOT')}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#080B12] px-3.5 text-xs font-semibold text-[#FFFFFF] hover:bg-[#1E293B] disabled:opacity-50 cursor-pointer"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>
                    {creatingType === 'SQLITE_SNAPSHOT'
                      ? 'Running VACUUM INTO...'
                      : 'Create Verified SQLite Snapshot'}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={Boolean(creatingType)}
                  onClick={() => void handleCreate('FULL_DATABASE')}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-3.5 text-xs font-semibold text-[#92400E] hover:bg-[#FEF3C7] disabled:opacity-50 cursor-pointer"
                  title="Logs an honest NOT_CONFIGURED attempt when remote provider credentials or pg_dump are unavailable"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>Attempt Full DB Snapshot (Provider Status Check)</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Backup Records Ledger */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="flex items-center justify-between border-b border-[#E4E8F2] px-4 py-3">
          <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            Backup & Snapshot Ledger ({backups.length})
          </h2>
          <span className="font-mono text-[10px] text-[#667085]">
            Restore Requires Super Admin + Fresh Re-Auth + Exact Phrase
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                <th className="px-4 py-2">Snapshot</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Integrity / SHA-256</th>
                <th className="px-3 py-2">Triggered By</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {backups.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-[#667085]">
                    No backup snapshots created yet.
                  </td>
                </tr>
              ) : (
                backups.map((b) => (
                  <tr key={b.id} className="h-12 hover:bg-[#F7F8FA]">
                    <td className="px-4 py-2">
                      <div className="font-mono text-[11px] font-semibold text-[#080B12]">
                        {b.id.slice(0, 12)}
                      </div>
                      <div className="font-mono text-[10px] text-[#667085]">
                        {new Date(b.createdAt).toLocaleString()}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-[#080B12]">{b.backupType}</td>
                    <td className="px-3 py-2 font-mono text-[10px] font-semibold">
                      <span
                        className={`rounded border px-2 py-0.5 ${
                          b.status === 'VERIFIED' || b.status === 'RESTORED'
                            ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                            : b.status === 'NOT_CONFIGURED'
                              ? 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]'
                              : b.status === 'FAILED'
                                ? 'border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]'
                                : 'border-[#CBD5E1] bg-[#F8FAFC] text-[#475467]'
                        }`}
                      >
                        {b.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[#475467] max-w-[260px]">
                      <div className="truncate">{b.failureReason || b.verificationDetail || '—'}</div>
                      {b.checksumSha256 && (
                        <div className="font-mono text-[10px] text-[#94A3B8]">
                          sha256:{b.checksumSha256.slice(0, 16)} · {b.byteSize ?? 0} B
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[#475467]">{b.triggeredByEmail}</td>
                    <td className="px-4 py-2 text-right">
                      {b.status !== 'NOT_CONFIGURED' && (
                        <div className="inline-flex items-center gap-1.5">
                          {canCreate && (
                            <button
                              type="button"
                              disabled={verifyingId === b.id}
                              onClick={() => void handleVerify(b.id)}
                              className="rounded border border-[#E4E8F2] bg-[#FFFFFF] px-2.5 py-1 text-[11px] font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] cursor-pointer"
                            >
                              {verifyingId === b.id ? 'Verifying...' : 'Verify'}
                            </button>
                          )}
                          {canRestore && (b.status === 'VERIFIED' || b.status === 'RESTORED') && (
                            <button
                              type="button"
                              onClick={() => setRestoreTarget(b)}
                              className="inline-flex items-center gap-1 rounded border border-[#FECACA] bg-[#FEF2F2] px-2.5 py-1 text-[11px] font-semibold text-[#DC2626] hover:bg-[#FEE2E2] cursor-pointer"
                            >
                              <RotateCcw className="h-3 w-3" />
                              <span>Restore</span>
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Verification & Recovery Events */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="border-b border-[#E4E8F2] px-4 py-3">
          <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            Verification & Recovery Event History ({events.length})
          </h2>
        </div>
        <div className="divide-y divide-[#F1F5F9] max-h-72 overflow-y-auto">
          {events.length === 0 ? (
            <div className="p-4 text-xs text-[#667085]">No backup verification or recovery events recorded.</div>
          ) : (
            events.map((ev) => (
              <div key={ev.id} className="px-4 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="font-mono text-[11px]">
                    <span className="font-semibold text-[#080B12]">{ev.action}</span>{' '}
                    <span className="text-[#667085]">({ev.backupId.slice(0, 8)})</span>{' '}
                    <span
                      className={`font-semibold ${
                        ev.status === 'SUCCESS'
                          ? 'text-[#15803D]'
                          : ev.status === 'NOT_CONFIGURED'
                            ? 'text-[#B45309]'
                            : 'text-[#DC2626]'
                      }`}
                    >
                      [{ev.status}]
                    </span>
                  </div>
                  <div className="text-[#475467]">{ev.detail}</div>
                </div>
                <div className="font-mono text-[10px] text-[#667085] text-right">
                  <div>{ev.actorEmail}</div>
                  <div>{new Date(ev.createdAt).toLocaleString()}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <AdminReauthModal
        open={Boolean(restoreTarget)}
        title={`Restore ${restoreTarget?.backupType ?? 'Snapshot'}`}
        description={`Environment: ${capabilities?.environment.toUpperCase() ?? 'UNKNOWN'} (${capabilities?.dialect ?? ''}). Restoring "${restoreTarget?.id.slice(0, 12)}" overwrites live configuration flags or creates a pre-restore SQLite safeguard before swapping the database. Enter your password and type exact confirmation phrase.`}
        confirmLabel="Execute Verified Restore"
        danger
        requireTypedMatch="RESTORE BACKUP"
        requireTypedLabel='Type "RESTORE BACKUP" to confirm'
        onCancel={() => setRestoreTarget(null)}
        onConfirm={async ({ confirmPassword, typedMatch }) => {
          if (!restoreTarget) return;
          const res = await adminApi.restoreBackup(restoreTarget.id, confirmPassword, typedMatch);
          setRestoreTarget(null);
          setFeedback(res.detail);
          await load();
        }}
      />
    </div>
  );
};
