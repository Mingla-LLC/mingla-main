// ORCH-0553 — Shared batch-row visualization for SeedTab + RefreshTab.
// Spec: outputs/SPEC_ORCH-0553_REFRESH_PIPELINE.md §4.3
//
// Renders one batch with status badge + per-batch metrics + retry/skip buttons.
// `kind` switches the metric/label rendering between the two pipelines.

import { useState } from "react";
import { CheckCircle, XCircle, AlertTriangle, Loader, SkipForward, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { formatCost } from "../../lib/seedingFormat";

const STATUS_VARIANT = {
  pending: "default",
  running: "info",
  completed: "success",
  failed: "error",
  skipped: "default",
};

export function BatchProgressRow({ batch, kind, onRetry, onSkip, retrying }) {
  const [expanded, setExpanded] = useState(false);
  const status = batch.status;
  const variant = STATUS_VARIANT[status] || "default";
  const isFailed = status === "failed";
  const isPending = status === "pending";
  const isRunning = status === "running";

  // Compute label and per-batch metric copy based on kind
  let labelLine = "";
  let metricLine = "";
  let detailsObj = null;

  if (kind === "seed") {
    labelLine = `Tile #${batch.tile_index} · ${batch.seeding_category || "?"}`;
    if (status === "completed") {
      metricLine = `${batch.places_new_inserted ?? 0} new · ${batch.places_duplicate_skipped ?? 0} dupes · ${batch.places_returned ?? 0} found · ${formatCost(batch.estimated_cost_usd)}`;
    } else if (isFailed) {
      metricLine = batch.error_message || "Batch failed";
    }
    detailsObj = batch.error_details;
  } else {
    // refresh
    const placeCount = Array.isArray(batch.place_ids) ? batch.place_ids.length : 0;
    labelLine = `Batch #${batch.batch_index} · ${placeCount} places`;
    if (status === "completed") {
      const succ = batch.success_count ?? 0;
      const fail = batch.failure_count ?? 0;
      metricLine = fail > 0
        ? `${succ} refreshed, ${fail} failed · ${formatCost(batch.estimated_cost_usd)}`
        : `${succ} refreshed · ${formatCost(batch.estimated_cost_usd)}`;
    } else if (isFailed) {
      metricLine = batch.error_message || "Batch failed";
    } else if (status === "skipped") {
      metricLine = "Skipped";
    }
    detailsObj = batch.results;
  }

  const canExpand = (status === "completed" && (batch.failure_count > 0 || (kind === "refresh" && Array.isArray(batch.results)))) ||
                    (isFailed && detailsObj);

  return (
    <div className={`rounded-lg border p-3 transition-colors ${
      isFailed ? "border-[var(--color-error-200)] bg-[var(--color-error-50)]" :
      isRunning ? "border-[var(--color-info-200)] bg-[var(--color-info-50)]" :
      status === "completed" ? "border-[var(--gray-200)]" :
      status === "skipped" ? "border-[var(--gray-200)] bg-[var(--gray-50)] opacity-60" :
      "border-[var(--gray-200)]"
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <div className="mt-0.5 shrink-0">
            {isRunning ? <Loader className="w-4 h-4 animate-spin text-[var(--color-info-500)]" /> :
             status === "completed" && (batch.failure_count ?? 0) === 0 ? <CheckCircle className="w-4 h-4 text-[var(--color-success-500)]" /> :
             status === "completed" ? <AlertTriangle className="w-4 h-4 text-[var(--color-warning-500)]" /> :
             isFailed ? <XCircle className="w-4 h-4 text-[var(--color-error-500)]" /> :
             status === "skipped" ? <SkipForward className="w-4 h-4 text-[var(--color-text-tertiary)]" /> :
             <div className="w-4 h-4 rounded-full border border-[var(--gray-300)]" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-[var(--color-text-primary)]">{labelLine}</span>
              <Badge variant={variant}>{status}</Badge>
              {batch.retry_count > 0 && <Badge variant="default">retry × {batch.retry_count}</Badge>}
            </div>
            {metricLine && (
              <div className={`text-xs mt-1 ${isFailed ? "text-[var(--color-error-700)]" : "text-[var(--color-text-secondary)]"}`}>
                {metricLine}
              </div>
            )}
            {canExpand && expanded && detailsObj && (
              <ExpandedDetails details={detailsObj} kind={kind} />
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {canExpand && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="p-1 rounded hover:bg-[var(--gray-100)] text-[var(--color-text-secondary)] cursor-pointer"
              aria-label={expanded ? "Collapse details" : "Expand details"}
            >
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          )}
          {isFailed && onRetry && (
            <Button size="xs" variant="secondary" icon={RotateCcw} loading={retrying} onClick={() => onRetry(batch.id)}>
              Retry
            </Button>
          )}
          {(isPending || isFailed) && onSkip && (
            <Button size="xs" variant="secondary" icon={SkipForward} onClick={() => onSkip(batch.id)}>
              Skip
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ExpandedDetails({ details, kind }) {
  if (kind === "refresh" && Array.isArray(details)) {
    // Per-place results array
    return (
      <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
        {details.map((r, i) => (
          <div key={i} className={`text-xs flex items-start gap-2 ${r.success ? "text-[var(--color-text-secondary)]" : "text-[var(--color-error-700)]"}`}>
            <span className="shrink-0">{r.success ? "✓" : "✗"}</span>
            <span className="font-medium truncate">{r.name || r.google_place_id}</span>
            {!r.success && r.error && <span className="text-[var(--color-error-600)] truncate">— {r.error}</span>}
          </div>
        ))}
      </div>
    );
  }
  // Seed: error_details JSONB
  return (
    <pre className="mt-2 text-xs bg-[var(--gray-50)] rounded p-2 overflow-x-auto max-h-32">
      {JSON.stringify(details, null, 2)}
    </pre>
  );
}
