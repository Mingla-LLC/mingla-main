import { useState } from "react";
import { GitBranch, RotateCcw, GitCompare } from "lucide-react";
import { Button } from "../ui/Button";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";

const fmtRelative = (iso) => {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.max(0, (Date.now() - then) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
};

export function VersionHistoryList({
  versions,
  loading,
  error,
  versionsForDiff,
  onSelectForDiff,
  onRollback,
  rollbackInflight,
}) {
  const [confirmRollback, setConfirmRollback] = useState(null); // {version, reason}

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-[var(--gray-100)] animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-[13px] text-[var(--color-error-700)] text-center py-6">
        Couldn't load history: {error}
      </p>
    );
  }

  if (!versions || versions.length === 0) {
    return (
      <p className="text-[13px] text-[var(--color-text-tertiary)] text-center py-6">
        No version history yet.
      </p>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {versions.map((v) => {
          const isInDiffA = versionsForDiff?.a === v.id;
          const isInDiffB = versionsForDiff?.b === v.id;
          const inDiff = isInDiffA || isInDiffB;

          return (
            <div
              key={v.id}
              className={[
                "border rounded-lg p-3",
                inDiff
                  ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                  : "border-[var(--gray-200)] bg-[var(--color-background-primary)]",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <GitBranch className="w-3.5 h-3.5 text-[var(--color-text-tertiary)]" />
                    <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                      v{v.version_number}
                    </span>
                    {v.is_current && (
                      <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--color-success-50)] text-[var(--color-success-700)]">
                        Current
                      </span>
                    )}
                    {isInDiffA && (
                      <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--color-brand-100)] text-[var(--color-brand-700)]">
                        Compare A
                      </span>
                    )}
                    {isInDiffB && (
                      <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--color-brand-100)] text-[var(--color-brand-700)]">
                        Compare B
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-[var(--color-text-primary)] line-clamp-2">
                    {v.change_summary || <span className="italic text-[var(--color-text-tertiary)]">(no summary)</span>}
                  </p>
                  <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">
                    {v.created_by_email || "unknown"} · {fmtRelative(v.created_at)} · {v.entry_count} entries
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant={inDiff ? "primary" : "secondary"}
                    icon={GitCompare}
                    onClick={() => onSelectForDiff(v.id)}
                  >
                    {inDiff ? "Selected" : "Compare"}
                  </Button>
                  {!v.is_current && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={RotateCcw}
                      onClick={() => setConfirmRollback({ version: v, reason: "" })}
                    >
                      Rollback
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        open={!!confirmRollback}
        onClose={() => setConfirmRollback(null)}
        title={confirmRollback ? `Roll back to v${confirmRollback.version.version_number}?` : ""}
        size="sm"
        destructive
      >
        <ModalBody>
          <p className="text-[13px] text-[var(--color-text-primary)] mb-3">
            This creates a new version matching v{confirmRollback?.version.version_number}.
            The current version stays in history. Reason is required.
          </p>
          <textarea
            value={confirmRollback?.reason || ""}
            onChange={(e) => setConfirmRollback((p) => ({ ...p, reason: e.target.value }))}
            placeholder="Why are you rolling back?"
            rows={3}
            className={[
              "w-full px-3 py-2 text-sm rounded-lg outline-none resize-none",
              "bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
              "border border-[var(--gray-300)]",
              "focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]",
            ].join(" ")}
            autoFocus
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConfirmRollback(null)} disabled={rollbackInflight}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!confirmRollback?.reason?.trim() || rollbackInflight}
            onClick={() => {
              onRollback(confirmRollback.version.id, confirmRollback.reason.trim());
              setConfirmRollback(null);
            }}
          >
            {rollbackInflight ? "Rolling back..." : "Confirm rollback"}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
