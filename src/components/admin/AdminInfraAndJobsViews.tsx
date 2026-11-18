import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Briefcase,
  CheckCircle2,
  HardDrive,
  Loader2,
  PauseCircle,
  Play,
  PlayCircle,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { PERMISSIONS } from '../../auth/rbacShared';
import { useAuth } from '../../lib/authContext';
import {
  adminApi,
  type AdminInfraHealthResponse,
  type ObservabilityJobsResponse,
} from '../../lib/adminApi';
import { AdminBarChart } from './AdminCharts';

export const AdminInfrastructureView: React.FC = () => {
  const [data, setData] = useState<AdminInfraHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getInfrastructureHealth();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load infrastructure health.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] text-xs text-[#667085]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#2D46E6]" />
        Probing runtime & database...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-2 text-xs text-[#667085]">
          <HardDrive className="h-4 w-4 text-[#2D46E6]" />
          <span>Honest Node.js process metrics, DB connection latency, and recent 5xx ring buffer</span>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3 text-xs font-semibold cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Re-Probe</span>
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-2.5 text-xs text-[#B91C1C]">
          {error}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4">
              <div className="text-[11px] text-[#667085]">Node Runtime</div>
              <div className="font-mono text-lg font-bold">{data.runtime.nodeVersion}</div>
              <div className="font-mono text-[10px] text-[#667085]">{data.runtime.platform}</div>
            </div>
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4">
              <div className="text-[11px] text-[#667085]">RSS / Heap Used</div>
              <div className="font-mono text-lg font-bold tabular-nums">
                {data.runtime.rssMb} / {data.runtime.heapUsedMb} MB
              </div>
              <div className="font-mono text-[10px] text-[#667085]">
                Load 1m: {data.runtime.cpuLoadAvg1m}
              </div>
            </div>
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4">
              <div className="text-[11px] text-[#667085]">Database Ping</div>
              <div className="font-mono text-lg font-bold tabular-nums text-[#15803D]">
                {data.database.latencyMs}ms
              </div>
              <div className="font-mono text-[10px] text-[#667085]">{data.database.dialect}</div>
            </div>
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4">
              <div className="text-[11px] text-[#667085]">Process Uptime</div>
              <div className="font-mono text-lg font-bold tabular-nums">
                {Math.floor(data.runtime.uptimeSeconds / 60)}m {data.runtime.uptimeSeconds % 60}s
              </div>
              <div className="font-mono text-[10px] text-[#667085]">PID {data.runtime.pid}</div>
            </div>
            <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4">
              <div className="text-[11px] text-[#667085]">Disk Volume Metrics</div>
              <div className="font-mono text-sm font-bold text-[#667085]">Unavailable</div>
              <div className="font-mono text-[10px] text-[#667085]">Statfs not polled</div>
            </div>
          </div>

          <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
            <div className="border-b border-[#E4E8F2] px-4 py-3">
              <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                Recent Server 5xx Errors ({data.recentServerErrors.length})
              </h2>
            </div>
            {data.recentServerErrors.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#667085]">
                No HTTP 5xx server errors recorded in the current process ring buffer.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                      <th className="px-4 py-2">Route</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Latency</th>
                      <th className="px-4 py-2">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9]">
                    {data.recentServerErrors.map((err) => (
                      <tr key={err.id} className="h-10">
                        <td className="px-4 py-2 font-mono">
                          {err.method} {err.routePath}
                        </td>
                        <td className="px-3 py-2 font-mono text-[#DC2626]">{err.statusCode}</td>
                        <td className="px-3 py-2 font-mono">{err.latencyMs}ms</td>
                        <td className="px-4 py-2 font-mono text-[#667085]">
                          {new Date(err.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export const AdminJobsView: React.FC = () => {
  const { user } = useAuth();
  const canManage = new Set<string>(user?.permissions ?? []).has(PERMISSIONS.ADMIN_JOBS_MANAGE);

  const [data, setData] = useState<ObservabilityJobsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [togglingQueue, setTogglingQueue] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getObservabilityJobs();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load background jobs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRun = async (id: string) => {
    setRunningJobId(id);
    setError(null);
    setFeedback(null);
    try {
      const res = await adminApi.retryJob(id);
      setFeedback(`${res.job.name}: ${res.run.summary}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Job execution failed.');
    } finally {
      setRunningJobId(null);
    }
  };

  const handleCancel = async (id: string) => {
    setError(null);
    setFeedback(null);
    try {
      await adminApi.cancelJob(id);
      setFeedback(`Cancellation requested for job "${id}".`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel job.');
    }
  };

  const handleToggleQueue = async () => {
    if (!data || !canManage) return;
    setTogglingQueue(true);
    setError(null);
    setFeedback(null);
    try {
      const paused = data.workerHeartbeat.queuePaused;
      if (paused) {
        await adminApi.resumeJobQueue();
        setFeedback('Worker queue resumed. Jobs can now execute.');
      } else {
        await adminApi.pauseJobQueue();
        setFeedback('Worker queue paused. New job triggers will be blocked until resumed.');
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle queue state.');
    } finally {
      setTogglingQueue(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] text-xs text-[#667085]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#2D46E6]" />
        Loading Background Jobs &amp; Worker Telemetry...
      </div>
    );
  }

  const jobs = data?.jobs ?? [];
  const runs = data?.runs ?? [];

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

      {/* Worker Heartbeat & Queue Control */}
      {data && (
        <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <Activity className="h-4 w-4 text-[#2D46E6]" />
              <span className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
                Worker Heartbeat &amp; Queue State
              </span>
              <span
                className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                  data.workerHeartbeat.queuePaused
                    ? 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]'
                    : 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                }`}
              >
                {data.workerHeartbeat.queuePaused ? 'QUEUE PAUSED' : data.workerHeartbeat.status}
              </span>
              {data.summary.stuckJobsCount > 0 && (
                <span className="rounded border border-[#FECACA] bg-[#FEF2F2] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#B91C1C]">
                  {data.summary.stuckJobsCount} STUCK
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void load()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3 text-xs font-semibold text-[#080B12] hover:bg-[#F7F8FA] cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
              {canManage && (
                <button
                  type="button"
                  disabled={togglingQueue}
                  onClick={() => void handleToggleQueue()}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold cursor-pointer disabled:opacity-50 ${
                    data.workerHeartbeat.queuePaused
                      ? 'bg-[#15803D] text-[#FFFFFF] hover:bg-[#166534]'
                      : 'border border-[#FDE68A] bg-[#FFFBEB] text-[#B45309] hover:bg-[#FEF3C7]'
                  }`}
                >
                  {data.workerHeartbeat.queuePaused ? (
                    <>
                      <PlayCircle className="h-3.5 w-3.5" />
                      <span>Resume Queue</span>
                    </>
                  ) : (
                    <>
                      <PauseCircle className="h-3.5 w-3.5" />
                      <span>Pause Queue</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-[#F1F5F9] pt-3 lg:grid-cols-6">
            <div>
              <div className="text-[10px] uppercase text-[#667085]">Worker ID</div>
              <div className="font-mono text-xs font-semibold text-[#080B12] truncate">
                {data.workerHeartbeat.workerId}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-[#667085]">Last Heartbeat</div>
              <div className="font-mono text-xs font-semibold text-[#080B12]">
                {new Date(data.workerHeartbeat.lastHeartbeatAt).toLocaleTimeString()}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-[#667085]">Avg Queue Wait</div>
              <div className="font-mono text-xs font-bold tabular-nums text-[#080B12]">
                {data.summary.avgWaitMs}ms
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-[#667085]">Avg Duration</div>
              <div className="font-mono text-xs font-bold tabular-nums text-[#080B12]">
                {data.summary.avgDurationMs !== null ? `${data.summary.avgDurationMs}ms` : 'N/A'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-[#667085]">Processed / Failed</div>
              <div className="font-mono text-xs font-bold tabular-nums text-[#080B12]">
                {data.workerHeartbeat.processedCount} /{' '}
                <span className={data.workerHeartbeat.failedCount > 0 ? 'text-[#DC2626]' : ''}>
                  {data.workerHeartbeat.failedCount}
                </span>
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-[#667085]">Active Job</div>
              <div className="font-mono text-xs text-[#475467] truncate">
                {data.workerHeartbeat.activeJobId ?? 'Idle'}
              </div>
            </div>
          </div>
        </div>
      )}

      {data && (
        <AdminBarChart
          title="Background Job Execution & Failure Trend"
          subtitle="Runs & errors over recent buckets"
          data={data.trends}
          accentColor="#2D46E6"
          showErrorsOverlay
        />
      )}

      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="border-b border-[#E4E8F2] px-4 py-3 flex items-center justify-between">
          <h2 className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            <Briefcase className="h-4 w-4 text-[#2D46E6]" />
            Registered Platform Maintenance Jobs ({jobs.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                <th className="px-4 py-2">Job</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Last Run</th>
                <th className="px-3 py-2">Schedule</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {jobs.map((job) => (
                <tr key={job.id} className="h-11 hover:bg-[#F7F8FA]">
                  <td className="px-4 py-2">
                    <div className="font-semibold text-[#080B12]">{job.name}</div>
                    <div className="font-mono text-[10px] text-[#667085]">
                      {job.id} · {job.jobType}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] font-semibold">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded border px-1.5 py-0.5 ${
                          job.status === 'FAILED'
                            ? 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]'
                            : job.status === 'RUNNING'
                              ? 'border-[#C7D2FE] bg-[#EEF2FF] text-[#2D46E6]'
                              : 'border-[#E2E8F0] bg-[#F8FAFC] text-[#475467]'
                        }`}
                      >
                        {job.status}
                      </span>
                      {job.isStuck && (
                        <span className="rounded border border-[#FECACA] bg-[#FEF2F2] px-1.5 py-0.5 text-[#B91C1C]">
                          IS STUCK
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-[#667085]">
                    {job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : 'Never'}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-[#475467]">
                    {job.scheduleLabel}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums">
                    {job.lastDurationMs !== null ? `${job.lastDurationMs}ms` : 'N/A'}
                  </td>
                  <td className="px-4 py-2 text-right space-x-2">
                    {canManage && (
                      <>
                        <button
                          type="button"
                          disabled={runningJobId === job.id || Boolean(data?.workerHeartbeat.queuePaused)}
                          onClick={() => void handleRun(job.id)}
                          className="inline-flex items-center gap-1 rounded bg-[#2D46E6] px-2.5 py-1 text-[11px] font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer disabled:opacity-50"
                        >
                          <Play className="h-3 w-3" />
                          <span>{runningJobId === job.id ? 'Running...' : 'Run Now'}</span>
                        </button>
                        {job.status === 'RUNNING' && (
                          <button
                            type="button"
                            onClick={() => void handleCancel(job.id)}
                            className="inline-flex items-center gap-1 rounded border border-[#FECACA] px-2.5 py-1 text-[11px] font-semibold text-[#DC2626] cursor-pointer"
                          >
                            <XCircle className="h-3 w-3" />
                            <span>Cancel</span>
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Execution History */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="border-b border-[#E4E8F2] px-4 py-3">
          <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            Recent Job Execution Runs ({runs.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#F1F5F9] bg-[#F7F8FA] font-mono text-[10px] uppercase text-[#667085]">
                <th className="px-4 py-2">Job ID</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Summary</th>
                <th className="px-3 py-2">Queue Wait</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-4 py-2">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-[#667085]">
                    No execution runs recorded yet.
                  </td>
                </tr>
              ) : (
                runs.map((r) => (
                  <tr key={r.id} className="h-10">
                    <td className="px-4 py-2 font-mono font-semibold text-[#080B12]">{r.jobId}</td>
                    <td className="px-3 py-2 font-mono text-[10px] font-semibold">{r.status}</td>
                    <td className="px-3 py-2 text-[#475467]">{r.summary || r.errorMessage || '—'}</td>
                    <td className="px-3 py-2 font-mono tabular-nums text-[#667085]">
                      {typeof r.waitMs === 'number' ? `${r.waitMs}ms` : '—'}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums">
                      {r.durationMs !== null ? `${r.durationMs}ms` : '—'}
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] text-[#667085]">
                      {new Date(r.startedAt).toLocaleString()}
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

