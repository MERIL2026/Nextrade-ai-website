import React from 'react';
import type { TimeSeriesPoint } from '../../admin/types';

interface AdminBarChartProps {
  title: string;
  subtitle?: string;
  data: TimeSeriesPoint[];
  accentColor?: string;
  showErrorsOverlay?: boolean;
  emptyLabel?: string;
}

export const AdminBarChart: React.FC<AdminBarChartProps> = ({
  title,
  subtitle,
  data,
  accentColor = '#2D46E6',
  showErrorsOverlay = false,
  emptyLabel = 'No recorded telemetry events for this period.',
}) => {
  const total = data.reduce((sum, pt) => sum + pt.count, 0);
  const maxVal = Math.max(1, ...data.map((d) => d.count));

  return (
    <div className="rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div>
          <h3 className="font-display text-xs font-bold uppercase tracking-wider text-[#080B12]">
            {title}
          </h3>
          {subtitle && <p className="text-[11px] text-[#667085]">{subtitle}</p>}
        </div>
        <span className="font-mono text-xs font-semibold tabular-nums text-[#080B12]">
          {total.toLocaleString()} total
        </span>
      </div>

      {data.length === 0 || total === 0 ? (
        <div className="flex h-28 items-center justify-center rounded border border-dashed border-[#E4E8F2] bg-[#F7F8FA] px-4 text-center text-xs text-[#667085]">
          {emptyLabel}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex h-28 items-end gap-1.5 border-b border-[#E4E8F2] pb-1">
            {data.map((pt) => {
              const pct = Math.max(4, Math.round((pt.count / maxVal) * 100));
              const errPct =
                showErrorsOverlay && pt.errors && pt.count > 0
                  ? Math.min(100, Math.round((pt.errors / pt.count) * 100))
                  : 0;
              return (
                <div
                  key={pt.bucket}
                  className="group relative flex h-full flex-1 flex-col items-center justify-end"
                  title={`${pt.bucket}: ${pt.count} total${pt.errors ? ` (${pt.errors} errors)` : ''}`}
                >
                  <div
                    className="relative w-full max-w-[34px] overflow-hidden rounded-t-sm transition-opacity group-hover:opacity-85"
                    style={{
                      height: `${pt.count === 0 ? 2 : pct}%`,
                      backgroundColor: pt.count === 0 ? '#E4E8F2' : accentColor,
                    }}
                  >
                    {errPct > 0 && (
                      <div
                        className="absolute inset-x-0 bottom-0 bg-[#DC2626]"
                        style={{ height: `${errPct}%` }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-1 font-mono text-[10px] tabular-nums text-[#667085]">
            <span>{(data[0]?.bucket.length ?? 0) > 6 ? data[0]?.bucket.slice(5) : data[0]?.bucket}</span>
            {showErrorsOverlay && (
              <span className="flex items-center gap-2 text-[10px]">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-xs" style={{ backgroundColor: accentColor }} />
                  Volume
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-xs bg-[#DC2626]" />
                  Errors
                </span>
              </span>
            )}
            <span>
              {(data[data.length - 1]?.bucket.length ?? 0) > 6
                ? data[data.length - 1]?.bucket.slice(5)
                : data[data.length - 1]?.bucket}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
