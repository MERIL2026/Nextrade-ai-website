import React from 'react';
import { BookmarkPlus, FileText, Search, Trash2 } from 'lucide-react';
import type {
  WorkspaceResearchItem,
  WorkspaceSavedReport,
} from '../../workspace/types';

interface ResearchHistoryPanelProps {
  history: WorkspaceResearchItem[];
  savedReports: WorkspaceSavedReport[];
  historySearch: string;
  onHistorySearchChange: (val: string) => void;
  onSelectHistoryItem: (item: WorkspaceResearchItem) => void;
  onDeleteHistoryItem: (id: string) => void;
  onSaveAsReport: (item: WorkspaceResearchItem) => void;
  onSelectSavedReport: (report: WorkspaceSavedReport) => void;
  onDeleteSavedReport: (id: string) => void;
  savingReportId: string | null;
}

export const ResearchHistoryPanel: React.FC<ResearchHistoryPanelProps> = ({
  history,
  savedReports,
  historySearch,
  onHistorySearchChange,
  onSelectHistoryItem,
  onDeleteHistoryItem,
  onSaveAsReport,
  onSelectSavedReport,
  onDeleteSavedReport,
  savingReportId,
}) => {
  const filteredHistory = history.filter((item) => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return true;
    return (
      item.symbol.toLowerCase().includes(q) ||
      item.query.toLowerCase().includes(q) ||
      item.result.summary.toLowerCase().includes(q)
    );
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Saved AI Research History */}
      <div className="lg:col-span-7 rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] overflow-hidden shadow-[0_8px_24px_rgba(15,23,42,0.03)]">
        <div className="border-b border-[#E4E8F2] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-bold text-[#080B12]">
              Your Saved Research History ({history.length})
            </h2>
            <p className="text-[11px] text-[#667085]">
              Private to your account · Search or reload prior explainable briefs
            </p>
          </div>
          <div className="relative w-full sm:w-52">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#667085]"
              aria-hidden="true"
            />
            <input
              type="search"
              value={historySearch}
              onChange={(e) => onHistorySearchChange(e.target.value)}
              placeholder="Filter ticker or topic..."
              aria-label="Filter saved research history"
              className="w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] pl-8 pr-2.5 py-1.5 text-xs text-[#080B12] placeholder:text-[#94A3B8] focus:border-[#2D46E6] focus:bg-[#FFFFFF] focus:outline-none"
            />
          </div>
        </div>

        {filteredHistory.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#667085]">
            {history.length === 0
              ? 'No saved AI research runs yet. Submit a research question above to persist your first brief.'
              : 'No saved research entries match your filter.'}
          </div>
        ) : (
          <div className="divide-y divide-[#E4E8F2] max-h-[380px] overflow-y-auto">
            {filteredHistory.map((item) => (
              <div
                key={item.id}
                className="px-5 py-3.5 flex items-start justify-between gap-3 hover:bg-[#EFF2FA]/45 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => onSelectHistoryItem(item)}
                  className="text-left min-w-0 flex-1 space-y-1 cursor-pointer"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-[#080B12]">
                      {item.symbol}
                    </span>
                    <span className="rounded bg-[#EFF2FA] px-2 py-0.5 font-mono text-[10px] font-medium text-[#2D46E6]">
                      {item.source === 'gemini' ? 'Gemini AI' : 'Fallback Brief'}
                    </span>
                    <span className="text-[10px] text-[#94A3B8] font-mono">
                      {new Date(item.createdAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="text-xs font-medium text-[#080B12] line-clamp-1">
                    {item.query}
                  </div>
                  <div className="text-[11px] text-[#667085] line-clamp-2">
                    {item.result.summary}
                  </div>
                </button>

                <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                  <button
                    type="button"
                    disabled={savingReportId === item.id}
                    onClick={() => onSaveAsReport(item)}
                    title="Save as Report"
                    aria-label={`Save ${item.symbol} research as report`}
                    className="rounded border border-[#E4E8F2] bg-[#FFFFFF] p-1.5 text-[#667085] hover:border-[#2D46E6] hover:text-[#2D46E6] disabled:opacity-50 cursor-pointer"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteHistoryItem(item.id)}
                    title="Delete research entry"
                    aria-label={`Delete ${item.symbol} research entry`}
                    className="rounded border border-[#E4E8F2] bg-[#FFFFFF] p-1.5 text-[#667085] hover:border-[#FECACA] hover:text-[#DC2626] cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Saved Reports */}
      <div className="lg:col-span-5 rounded-2xl border border-[#E4E8F2] bg-[#FFFFFF] overflow-hidden shadow-[0_8px_24px_rgba(15,23,42,0.03)]">
        <div className="border-b border-[#E4E8F2] px-5 py-3.5">
          <h2 className="font-display text-sm font-bold text-[#080B12]">
            Saved Reports ({savedReports.length})
          </h2>
          <p className="text-[11px] text-[#667085]">
            Pinned analytical reports stored in your account
          </p>
        </div>

        {savedReports.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#667085]">
            No saved reports yet. Click the bookmark icon on any research brief to save a report.
          </div>
        ) : (
          <div className="divide-y divide-[#E4E8F2] max-h-[380px] overflow-y-auto">
            {savedReports.map((rep) => (
              <div
                key={rep.id}
                className="px-5 py-3.5 flex items-start justify-between gap-3 hover:bg-[#EFF2FA]/45 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => onSelectSavedReport(rep)}
                  className="text-left min-w-0 flex-1 space-y-1 cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-[#2D46E6] shrink-0" aria-hidden="true" />
                    <span className="font-mono text-xs font-bold text-[#080B12]">
                      {rep.symbol}
                    </span>
                    <span className="text-[10px] font-mono text-[#94A3B8]">
                      {new Date(rep.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="text-xs font-medium text-[#080B12] line-clamp-2">
                    {rep.title}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteSavedReport(rep.id)}
                  title="Delete saved report"
                  aria-label={`Delete report ${rep.title}`}
                  className="rounded border border-[#E4E8F2] bg-[#FFFFFF] p-1.5 text-[#667085] hover:border-[#FECACA] hover:text-[#DC2626] cursor-pointer shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
