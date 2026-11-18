import React, { useEffect, useState } from 'react';
import { KeyRound, Loader2, ShieldAlert, X } from 'lucide-react';

interface AdminReauthModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  requireReason?: boolean;
  reasonPlaceholder?: string;
  requireTypedMatch?: string;
  requireTypedLabel?: string;
  onCancel: () => void;
  onConfirm: (payload: { confirmPassword: string; reason: string; typedMatch: string }) => Promise<void>;
}

export const AdminReauthModal: React.FC<AdminReauthModalProps> = ({
  open,
  title,
  description,
  confirmLabel,
  danger = false,
  requireReason = false,
  reasonPlaceholder = 'Enter justification for the audit log...',
  requireTypedMatch,
  requireTypedLabel,
  onCancel,
  onConfirm,
}) => {
  const [confirmPassword, setConfirmPassword] = useState('');
  const [reason, setReason] = useState('');
  const [typedMatch, setTypedMatch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setConfirmPassword('');
      setReason('');
      setTypedMatch('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const matchSatisfied = !requireTypedMatch || typedMatch.trim() === requireTypedMatch;
  const reasonSatisfied = !requireReason || reason.trim().length >= 5;
  const canSubmit = confirmPassword.length > 0 && matchSatisfied && reasonSatisfied && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm({ confirmPassword, reason: reason.trim(), typedMatch: typedMatch.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#080B12]/60 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reauth-modal-title"
    >
      <div className="w-full max-w-md rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] shadow-[0_24px_48px_rgba(8,11,18,0.22)]">
        <div className="flex items-start justify-between gap-3 border-b border-[#E4E8F2] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-lg border ${
                danger
                  ? 'border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]'
                  : 'border-[#C7D2FE] bg-[#EFF2FA] text-[#2D46E6]'
              }`}
            >
              {danger ? <ShieldAlert className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
            </div>
            <div>
              <h2 id="reauth-modal-title" className="font-display text-sm font-bold text-[#080B12]">
                {title}
              </h2>
              <p className="font-mono text-[10px] uppercase tracking-wider text-[#667085]">
                Server Re-Authentication Required
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            aria-label="Close confirmation dialog"
            className="rounded-md p-1 text-[#667085] hover:bg-[#F7F8FA] hover:text-[#080B12] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <p className="text-xs leading-relaxed text-[#475467]">{description}</p>

          {requireTypedMatch && (
            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#080B12]">
                {requireTypedLabel || `Type "${requireTypedMatch}" to confirm`}
              </label>
              <input
                type="text"
                value={typedMatch}
                onChange={(e) => setTypedMatch(e.target.value)}
                placeholder={requireTypedMatch}
                className="w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 py-2 font-mono text-xs text-[#080B12] focus:border-[#2D46E6] focus:bg-[#FFFFFF] focus:outline-none"
                required
              />
            </div>
          )}

          {requireReason && (
            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#080B12]">
                Audit Reason (min 5 chars)
              </label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={reasonPlaceholder}
                className="w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 py-2 text-xs text-[#080B12] focus:border-[#2D46E6] focus:bg-[#FFFFFF] focus:outline-none"
                required
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#080B12]">
              Confirm Your Admin Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Enter administrator password"
              autoComplete="current-password"
              className="w-full rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 py-2 text-xs text-[#080B12] focus:border-[#2D46E6] focus:bg-[#FFFFFF] focus:outline-none"
              required
            />
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#B91C1C]"
            >
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-[#E4E8F2] pt-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="h-9 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3.5 text-xs font-semibold text-[#475467] hover:bg-[#F7F8FA] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-xs font-semibold text-[#FFFFFF] transition-colors cursor-pointer disabled:opacity-50 ${
                danger
                  ? 'bg-[#DC2626] hover:bg-[#B91C1C]'
                  : 'bg-[#2D46E6] hover:bg-[#2238C9]'
              }`}
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{confirmLabel}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
