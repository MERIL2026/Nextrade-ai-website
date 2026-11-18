import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, BarChart3, Lightbulb, Loader2 } from 'lucide-react';
import type { ObservabilityRangeKey } from '../../admin/types';
import { adminApi, type PlatformIntelligenceResponse } from '../../lib/adminApi';

interface AdminIntelligenceViewProps {
  onNavigate: (href: string) => void;
}

const RANGES: ObservabilityRangeKey[] = ['15m', '1h', '24h', '7d', '30d'];

export const AdminIntelligenceView: React.FC<AdminIntelligenceViewProps> = ({ onNavigate }) => {
  const [range, setRange] = useState<ObservabilityRangeKey>('24h');
  const [data, setData] = useState<PlatformIntelligenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getPlatformIntelligence(range);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Platform Intelligence.');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-12 text-xs text-[#667085]">
        <Loader2 className="h-4 w-4 animate-spin text-[#2D46E6]" />
        <span>Computing cross-platform operational intelligence...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div role="alert" className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-4 text-xs text-[#B91C1C]">
        {error || 'Platform intelligence unavailable.'}
      </div>
    );
  }

  const c = data.categories;
  const domainCards = [
    {
      title: '1. User Activity',
      factType: c.userActivity.factType,
      metric: `${c.userActivity.activeUsersInWindow}/${c.userActivity.totalUsers}`,
      detail: `Active / total accounts · Δ ${c.userActivity.newRegistrationsDeltaPct ?? 'N/A'}%`,
    },
    {
      title: '2. Platform Availability',
      factType: c.platformAvailability.factType,
      metric: `${c.platformAvailability.healthyServices}/${c.platformAvailability.totalServices}`,
      detail: 'Services passing live health checks',
    },
    {
      title: '3. API Performance',
      factType: c.apiPerformance.factType,
      metric: `${c.apiPerformance.requestCount} req`,
      detail: `Error ${c.apiPerformance.errorRatePct}% · P95 ${c.apiPerformance.p95LatencyMs ?? 'N/A'}ms`,
    },
    {
      title: '4. AI Provider Health',
      factType: c.aiProviderHealth.factType,
      metric: `${c.aiProviderHealth.totalRequests} runs`,
      detail: `Success ${c.aiProviderHealth.successCount} · Fallback ${c.aiProviderHealth.fallbackCount} · Failed ${c.aiProviderHealth.failedCount}`,
    },
    {
      title: '5. Market Data Freshness',
      factType: c.marketDataFreshness.factType,
      metric: c.marketDataFreshness.classification,
      detail: c.marketDataFreshness.stale ? 'Snapshot stale vs threshold' : 'Within threshold',
    },
    {
      title: '6. Background Jobs',
      factType: c.backgroundJobReliability.factType,
      metric: `${c.backgroundJobReliability.failedJobs}/${c.backgroundJobReliability.totalJobs} failed`,
      detail: `Worker heartbeat: ${c.backgroundJobReliability.workerStatus}`,
    },
    {
      title: '7. Security Activity',
      factType: c.securityActivity.factType,
      metric: `${c.securityActivity.failedLoginsInWindow} fails`,
      detail: `${c.securityActivity.eventsCount} total security events logged`,
    },
    {
      title: '8. Governance Workload',
      factType: c.governanceWorkload.factType,
      metric: `${c.governanceWorkload.pendingApprovals} pending`,
      detail: `${c.governanceWorkload.pendingAccessReviews} unreviewed privileged accounts`,
    },
    {
      title: '9. Privacy Backlog',
      factType: c.privacyBacklog.factType,
      metric: `${c.privacyBacklog.pendingExports + c.privacyBacklog.pendingDeletions}`,
      detail: `Exports: ${c.privacyBacklog.pendingExports} · Deletions: ${c.privacyBacklog.pendingDeletions}`,
    },
    {
      title: '10. Backup Readiness',
      factType: c.backupReadiness.factType,
      metric: `${c.backupReadiness.verifiedBackups} verified`,
      detail: `Full DB dump: ${c.backupReadiness.fullDatabaseBackupSupported ? 'Yes' : 'Logical snapshot only'}`,
    },
    {
      title: '11. Feature Flags',
      factType: c.featureFlagDistribution.factType,
      metric: `${c.featureFlagDistribution.enabledFlags}/${c.featureFlagDistribution.totalFlags} on`,
      detail: `Active kill switches: ${c.featureFlagDistribution.killSwitchesActive}`,
    },
    {
      title: '12. Incident Trends',
      factType: c.incidentTrends.factType,
      metric: `${c.incidentTrends.openIncidents} open`,
      detail: `${c.incidentTrends.resolvedIncidents} resolved historically`,
    },
    {
      title: '13. Automation Engine',
      factType: c.automationPerformance.factType,
      metric: `${c.automationPerformance.succeededRuns} ok / ${c.automationPerformance.failedRuns} err`,
      detail: `${c.automationPerformance.enabledWorkflows} active · avg ${c.automationPerformance.avgDurationMs}ms`,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] px-4 py-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-[#2D46E6]" />
          <span className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            Cross-Domain Platform Intelligence Window
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded border px-2.5 py-1 font-mono text-[11px] font-semibold cursor-pointer ${
                range === r
                  ? 'border-[#2D46E6] bg-[#2D46E6] text-[#FFFFFF]'
                  : 'border-[#E4E8F2] bg-[#FFFFFF] text-[#475467]'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* 13 Intelligence Categories */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {domainCards.map((card) => (
          <div key={card.title} className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-3.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#080B12]">{card.title}</span>
              <span className="rounded border border-[#BBF7D0] bg-[#F0FDF4] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#15803D]">
                {card.factType}
              </span>
            </div>
            <div className="font-mono text-lg font-bold tabular-nums text-[#080B12]">{card.metric}</div>
            <div className="text-[11px] text-[#667085]">{card.detail}</div>
          </div>
        ))}
      </div>

      {/* Evidence-Backed Recommendations */}
      <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF]">
        <div className="flex items-center justify-between border-b border-[#E4E8F2] px-4 py-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-[#2D46E6]" />
            <h2 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
              Evidence-Backed Operational Recommendations
            </h2>
          </div>
          <span className="rounded border border-[#C7D2FE] bg-[#EFF2FA] px-2 py-0.5 font-mono text-[10px] font-bold text-[#2D46E6]">
            DERIVED FROM MEASURED TELEMETRY
          </span>
        </div>
        <div className="divide-y divide-[#F1F5F9]">
          {data.recommendations.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#15803D]">
              All 13 measured operational domains are within healthy thresholds.
            </div>
          ) : (
            data.recommendations.map((rec) => (
              <div key={rec.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                        rec.severity === 'CRITICAL' || rec.severity === 'HIGH'
                          ? 'border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]'
                          : 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]'
                      }`}
                    >
                      {rec.severity} · {rec.category}
                    </span>
                    <span className="text-xs font-semibold text-[#080B12]">{rec.title}</span>
                  </div>
                  <p className="text-xs text-[#475467]">
                    {rec.rationale}{' '}
                    <span className="font-mono text-[11px] text-[#667085]">
                      ({rec.supportingMetrics.join(', ')})
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate(rec.recommendedRoute)}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] cursor-pointer"
                >
                  <span>{rec.recommendedActionLabel}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
