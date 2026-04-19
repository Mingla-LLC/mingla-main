import { Loader2, AlertTriangle, CheckCircle2, Info, MapPin } from "lucide-react";

const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : "—");

export function ImpactPreviewBanner({
  preview,
  loading,
  error,
  pendingChangeCount,
  cityIsSelected,
  onViewAffected,
}) {
  // Hide entirely if no pending changes and not currently computing
  if (!pendingChangeCount && !loading && !preview && !error) return null;

  if (!cityIsSelected) {
    return (
      <div className="border border-[var(--gray-300)] bg-[var(--gray-100)] rounded-lg p-3 flex items-start gap-2.5">
        <MapPin className="w-4 h-4 text-[var(--color-text-tertiary)] shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-[var(--color-text-primary)]">
            Pick a city to preview impact
          </p>
          <p className="text-[12px] text-[var(--color-text-secondary)] mt-0.5">
            Use the city picker in the page header. You can still save without a preview.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="border border-[var(--color-info-200)] bg-[var(--color-info-50)] rounded-lg p-3 flex items-center gap-2.5">
        <Loader2 className="w-4 h-4 text-[var(--color-info-700)] animate-spin shrink-0" />
        <p className="text-[13px] text-[var(--color-info-700)]">Calculating impact…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-[var(--gray-300)] bg-[var(--gray-100)] rounded-lg p-3 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-[var(--color-text-secondary)] shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-[var(--color-text-primary)]">
            Couldn't calculate impact
          </p>
          <p className="text-[12px] text-[var(--color-text-secondary)] mt-0.5">
            {error}. You can still save, but you'll be flying blind.
          </p>
        </div>
      </div>
    );
  }

  if (!preview) return null;

  const total = (preview.would_modify || 0) + (preview.would_reject || 0);

  if (total === 0) {
    return (
      <div className="border border-[#22c55e] bg-[var(--color-success-50)] rounded-lg p-3 flex items-start gap-2.5">
        <CheckCircle2 className="w-4 h-4 text-[#22c55e] shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-[var(--color-success-700)]">
            No impact
          </p>
          <p className="text-[12px] text-[var(--color-success-700)] opacity-90 mt-0.5">
            This rule edit affects no current places in the selected city.
            {preview.partial && " (Pool was sampled — actual count may differ.)"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-[#f59e0b] bg-[var(--color-warning-50)] rounded-lg p-3">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-[#f59e0b] shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-[var(--color-warning-700)]">
            This change would affect {fmt(total)} place{total === 1 ? "" : "s"}
          </p>
          <p className="text-[12px] text-[var(--color-warning-700)] opacity-90 mt-0.5">
            Modify: <strong>{fmt(preview.would_modify)}</strong> · Reject:{" "}
            <strong>{fmt(preview.would_reject)}</strong> · No-op:{" "}
            <strong>{fmt(preview.would_no_op)}</strong>
            {preview.partial && (
              <span className="ml-1 italic">(approximate — pool exceeds preview limit)</span>
            )}
          </p>
          {typeof onViewAffected === "function" && (preview.sample_affected || []).length > 0 && (
            <button
              type="button"
              onClick={onViewAffected}
              className="mt-2 text-[12px] font-medium text-[var(--color-warning-700)] underline hover:no-underline cursor-pointer"
            >
              View affected places ▸
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
