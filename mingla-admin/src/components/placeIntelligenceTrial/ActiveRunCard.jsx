/**
 * ActiveRunCard — ORCH-1013 Finding B
 *
 * Per-run card rendered inside <ActiveRunsControlTower />. Displays:
 *   - city + mode + status pill + processed/total + percent
 *   - progress bar (matches existing token language at TrialResultsTab L718-L723)
 *   - succeeded / failed / cost so far / live ETA
 *   - Gemini cost cross-check (processed * the server's own per-place rate
 *     vs cost_so_far) with a
 *     ±$0.0010/place tolerance warning when drift > 25%
 *   - soft-cancel button (lucide-react X) → CancelRunConfirmModal → POST
 *     {action:'cancel_trial', run_id}
 *   - terminal-state pills (Cancelled / Done / Failed) + View affordance
 *
 * Gemini pricing reference (COMMS-0003):
 * issue #3526 — the cost cross-check now compares the server against its own
 * per-place estimate; this card holds no pricing constant or citation.
 *
 * SPEC §3 B.3 + §7-D5 (icon=X not Square).
 */

import { useMemo, useState } from "react";
import {
  Globe,
  Clock,
  ArrowRight,
  RotateCcw,
  X,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "../ui/Button";
import { CancelRunConfirmModal } from "./CancelRunConfirmModal";
import { invokeWithRefresh } from "../../lib/supabase";
import { extractFunctionError } from "../../lib/edgeFunctionError";
import { useToast } from "../../context/ToastContext";

// issue #3526 P0-1 — this card held its own $0.004 baseline and a 0.001
// tolerance COMMENTED as "±25% of $0.0040". When the server's rate moved to
// $0.0089 the baseline was 45% low and the tolerance had silently become ±11%,
// so the "Cost drift > 25% — verify Gemini pricing" badge would have fired on
// EVERY run — an alarm that is always on is an alarm nobody reads.
//
// There is no client constant now, and none is needed: the server already told
// us what IT priced this very run at, in run.estimated_cost_usd over
// run.total_count. That is the authoritative per-place rate for this run, so
// the cross-check compares the server against itself and the tolerance is a
// true fraction of it.
const COST_DRIFT_TOLERANCE_FRACTION = 0.25;
const COST_DRIFT_MIN_PROCESSED = 10;

function modeIcon(mode) {
  if (mode === "full_city") return Globe;
  if (mode === "sample") return Clock;
  if (mode === "remainder") return ArrowRight;
  if (mode === "retry_failed") return RotateCcw;
  return Clock;
}

function statusPillClasses(status) {
  if (status === "complete") {
    return "bg-[var(--color-success-50)] text-[var(--color-success-700)]";
  }
  if (status === "cancelled") {
    return "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]";
  }
  if (status === "failed") {
    return "bg-[var(--color-error-50)] text-[var(--color-error-700)]";
  }
  if (status === "running") {
    return "bg-[var(--color-info-50)] text-[var(--color-info-700)]";
  }
  if (status === "cancelling") {
    return "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]";
  }
  // ORCH-1032: queued is a calm waiting state — neutral gray, NEVER
  // error/warning. Reads as "waiting for a slot," not "problem."
  if (status === "queued") {
    return "bg-[var(--gray-100)] text-[var(--color-text-secondary)]";
  }
  return "bg-[var(--gray-100)] text-[var(--color-text-tertiary)]";
}

function statusLabel(status) {
  if (status === "complete") return "Done";
  if (status === "cancelled") return "Cancelled";
  if (status === "failed") return "Failed";
  if (status === "queued") return "Queued"; // ORCH-1032
  return status;
}

function formatEta(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `~${Math.round(seconds)}s`;
  const min = Math.round(seconds / 60);
  if (min < 90) return `~${min} min`;
  const hrs = (min / 60).toFixed(1);
  return `~${hrs} hrs`;
}

export function ActiveRunCard({ run, onCancelled, onViewRun }) {
  const { addToast } = useToast();
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);

  const Icon = modeIcon(run.mode);
  const total = Number(run.total_count || 0);
  const processed = Number(run.processed_count || 0);
  const succeeded = Number(run.succeeded_count || 0);
  const failed = Number(run.failed_count || 0);
  const costSoFar = Number(run.cost_so_far_usd || 0);
  const estCost = Number(run.estimated_cost_usd || 0);
  const pct = total > 0 ? (processed / total) * 100 : 0;
  const pctLabel = total > 0 ? Math.round(pct) : 0;

  // The rate the SERVER priced this run at. null when the run carries no
  // estimate — in which case there is nothing to cross-check against and the
  // badge stays silent rather than firing on a number we invented.
  const serverPerPlaceCost = useMemo(() => {
    if (!(total > 0) || !(estCost > 0)) return null;
    return estCost / total;
  }, [estCost, total]);
  const expectedCost = useMemo(
    () => (serverPerPlaceCost === null ? null : +(processed * serverPerPlaceCost).toFixed(4)),
    [processed, serverPerPlaceCost],
  );
  const costDriftWarn = useMemo(() => {
    if (processed < COST_DRIFT_MIN_PROCESSED) return false;
    if (expectedCost === null || serverPerPlaceCost === null) return false;
    const diff = Math.abs(costSoFar - expectedCost);
    const tolerance = processed * serverPerPlaceCost * COST_DRIFT_TOLERANCE_FRACTION;
    return diff > tolerance;
  }, [processed, costSoFar, expectedCost, serverPerPlaceCost]);

  const isTerminal = ["complete", "cancelled", "failed"].includes(run.status);
  const isRunning = run.status === "running";
  const isCancelling = run.status === "cancelling";
  const isQueued = run.status === "queued"; // ORCH-1032

  async function handleCancelConfirmed() {
    if (!run.id) return;
    setCancelLoading(true);
    try {
      const { error } = await invokeWithRefresh("run-place-intelligence-trial", {
        body: { action: "cancel_trial", run_id: run.id },
      });
      if (error) {
        addToast({
          variant: "error",
          title: "Couldn't cancel",
          description: await extractFunctionError(error, "cancel_trial failed"),
        });
        return;
      }
      addToast({
        variant: "info",
        title: "Cancelling…",
        description: "Run will stop after current chunk (~30-90s).",
      });
      setCancelModalOpen(false);
      onCancelled?.(run.id);
    } catch (err) {
      addToast({
        variant: "error",
        title: "Couldn't cancel",
        description: err?.message || "Unknown error",
      });
    } finally {
      setCancelLoading(false);
    }
  }

  return (
    <>
      <div
        className="border border-[var(--color-brand-200)] rounded-lg p-4 bg-[var(--color-brand-50)] space-y-3"
        data-testid="active-run-card"
        data-run-id={run.id}
        data-run-status={run.status}
      >
        {/* Top row: city + mode + status pill + counts */}
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
            <Icon className="w-4 h-4 inline" aria-hidden="true" />
            <span>{run.city_name}</span>
            <span className="text-xs font-normal text-[var(--color-text-tertiary)]">
              · {run.mode}
            </span>
          </h4>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={[
                "text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded",
                statusPillClasses(run.status),
              ].join(" ")}
            >
              {statusLabel(run.status)}
            </span>
            <span className="text-xs font-mono tabular-nums text-[var(--color-text-secondary)]">
              {processed.toLocaleString()} / {total.toLocaleString()} ({pctLabel}%)
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div
          className="h-2 bg-[var(--color-brand-200)] rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={pctLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${run.city_name} progress ${pctLabel}%`}
        >
          <div
            className="h-full bg-[var(--color-brand-500)] transition-all duration-200"
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </div>

        {/* Metrics row */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-[var(--color-success-700)] font-mono tabular-nums">
            ✓ {succeeded}
          </span>
          <span className="text-[var(--color-error-700)] font-mono tabular-nums">
            ✗ {failed}
          </span>
          <span className="text-[var(--color-text-secondary)] font-mono tabular-nums">
            cost: ${costSoFar.toFixed(4)} of ~${estCost.toFixed(2)}
          </span>
          <span
            className="ml-auto text-[var(--color-text-secondary)] font-mono tabular-nums"
            title={
              run._liveRatePerMin
                ? `~${run._liveRatePerMin.toFixed(1)} places/min`
                : "Insufficient sample for ETA (< 30s)"
            }
          >
            ETA: {isRunning ? formatEta(run._liveEtaSeconds) : "—"}
          </span>
        </div>

        {/* Cost cross-check (italic, font-mono, optional warning) */}
        <div className="text-[10px] text-[var(--color-text-tertiary)] italic font-mono flex items-center gap-1.5">
          <span>
            {serverPerPlaceCost === null ? (
              <>{costSoFar.toFixed(4)} actual · no server estimate to compare</>
            ) : (
              <>
                {processed.toLocaleString()} × $
                {serverPerPlaceCost.toFixed(4)} = $
                {expectedCost.toFixed(4)} expected · $
                {costSoFar.toFixed(4)} actual
              </>
            )}
          </span>
          {costDriftWarn && (
            <AlertTriangle
              className="w-3 h-3 text-[var(--color-warning-700)] shrink-0"
              aria-label="Cost drift from the server's own per-place estimate > 25% — verify Gemini pricing"
            />
          )}
        </div>

        {/* Action row */}
        <div className="flex items-center gap-2">
          {isRunning && (
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              onClick={() => setCancelModalOpen(true)}
              aria-label="Cancel run"
            >
              Cancel
            </Button>
          )}
          {isCancelling && (
            <div className="flex items-center gap-2 text-xs text-[var(--color-warning-700)]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              <span>Cancelling… (~30-90s)</span>
            </div>
          )}
          {/* ORCH-1032: queued is idle (no slot yet), not working — calm copy,
              NO spinner. */}
          {isQueued && (
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Queued — waiting for a free slot</span>
            </div>
          )}
          {isTerminal && (
            <Button
              variant="ghost"
              size="sm"
              iconRight={ArrowRight}
              onClick={() => onViewRun?.(run.id)}
            >
              View
            </Button>
          )}
        </div>
      </div>

      <CancelRunConfirmModal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        onConfirm={handleCancelConfirmed}
        cityName={run.city_name}
        processedCount={processed}
        totalCount={total}
        loading={cancelLoading}
      />
    </>
  );
}

export default ActiveRunCard;
