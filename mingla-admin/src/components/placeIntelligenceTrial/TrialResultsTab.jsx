/**
 * TrialResultsTab — ORCH-0712
 *
 * Top: aggregate stats + Run trial button (gated on prerequisites).
 * Below: scrollable list of past runs with per-place expandable cards
 * showing collage + Q1 (open exploration) + Q2 (per-signal evaluation).
 */

import { useEffect, useState, useCallback } from "react";
import {
  Play, RefreshCw, Square, Sparkles, ChevronDown, ChevronRight,
  CheckCircle, XCircle,
} from "lucide-react";
import { supabase, invokeWithRefresh } from "../../lib/supabase";
import { extractFunctionError } from "../../lib/edgeFunctionError";
import { useToast } from "../../context/ToastContext";
import { SectionCard, AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { MINGLA_SIGNAL_IDS, TOTAL_ANCHORS_TARGET } from "../../constants/placeIntelligenceTrial";

function formatCost(n) {
  if (n == null) return "—";
  return `$${Number(n).toFixed(4)}`;
}

// ── Per-place result card ───────────────────────────────────────────────────

function PlaceResultCard({ row }) {
  const [expanded, setExpanded] = useState(false);
  const place = row.place;
  const q1 = row.q1_response;
  const q2 = row.q2_response;
  const failed = row.status === "failed";

  return (
    <div className="border border-[var(--gray-200)] rounded-lg overflow-hidden bg-[var(--color-background-primary)]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[var(--gray-50)] transition-colors duration-150 cursor-pointer"
      >
        {expanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
        <span className="text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded bg-[var(--color-brand-50)] text-[var(--color-brand-700)]">
          {row.signal_id} #{row.anchor_index}
        </span>
        <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate flex-1 text-left">
          {place?.name || row.place_pool_id}
        </span>
        <span className={[
          "text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded",
          row.status === "completed" && "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
          row.status === "running" && "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
          row.status === "failed" && "bg-[var(--color-error-50)] text-[var(--color-error-700)]",
          row.status === "pending" && "bg-[var(--gray-100)] text-[var(--color-text-tertiary)]",
          row.status === "cancelled" && "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
        ].filter(Boolean).join(" ")}>
          {row.status}
        </span>
        <span className="text-xs text-[var(--color-text-tertiary)] font-mono shrink-0">
          {formatCost(row.cost_usd)}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--gray-200)] p-4 space-y-4">
          {row.collage_url && (
            <div className="flex justify-center">
              <img
                src={row.collage_url}
                alt="Photo collage"
                className="max-w-full max-h-[400px] rounded-lg border border-[var(--gray-200)]"
              />
            </div>
          )}

          {failed && row.error_message && (
            <AlertCard variant="error" title="Run failed">
              {row.error_message}
            </AlertCard>
          )}

          {q1 && (
            <div className="border border-[var(--gray-200)] rounded-lg p-3 space-y-2">
              <h5 className="text-xs uppercase tracking-wide text-[var(--color-text-tertiary)] font-mono">
                Q1 — Open Exploration
              </h5>
              {q1.proposed_vibes && q1.proposed_vibes.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] mb-1">Proposed vibes</div>
                  <div className="flex flex-wrap gap-1">
                    {q1.proposed_vibes.map((v, i) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-brand-50)] text-[var(--color-brand-700)]">{v}</span>
                    ))}
                  </div>
                </div>
              )}
              {q1.proposed_signals && q1.proposed_signals.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] mb-1">Proposed new signals</div>
                  <div className="space-y-1">
                    {q1.proposed_signals.map((s, i) => (
                      <div key={i} className="text-xs">
                        <span className="font-mono font-semibold">{s.name}</span> — {s.definition}
                        {s.rationale && <span className="text-[var(--color-text-secondary)]"> ({s.rationale})</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {q1.notable_observations && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] mb-1">Observations</div>
                  <p className="text-xs text-[var(--color-text-primary)] italic">{q1.notable_observations}</p>
                </div>
              )}
            </div>
          )}

          {q2 && q2.evaluations && (
            <div className="border border-[var(--gray-200)] rounded-lg p-3 space-y-2">
              <h5 className="text-xs uppercase tracking-wide text-[var(--color-text-tertiary)] font-mono">
                Q2 — Per-Signal Evaluation
              </h5>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-xs font-mono">
                {q2.evaluations.map((e, i) => (
                  <div
                    key={i}
                    className={[
                      "flex items-baseline gap-2 p-1.5 rounded",
                      e.strong_match
                        ? "bg-[var(--color-success-50)]"
                        : e.inappropriate_for
                        ? "bg-[var(--color-error-50)]"
                        : "bg-[var(--gray-50)]",
                    ].join(" ")}
                  >
                    {e.strong_match
                      ? <CheckCircle className="w-3 h-3 text-[var(--color-success-700)] shrink-0" />
                      : e.inappropriate_for
                      ? <XCircle className="w-3 h-3 text-[var(--color-error-700)] shrink-0" />
                      : <span className="w-3 h-3 shrink-0 inline-block rounded-full border border-[var(--gray-300)]" />}
                    <span className="font-semibold w-24 shrink-0">{e.signal_id}</span>
                    <span className="text-[var(--color-text-tertiary)]">conf {e.confidence_0_to_10}/10</span>
                    <span className="text-[var(--color-text-secondary)] truncate flex-1" title={e.reasoning}>{e.reasoning}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tab ─────────────────────────────────────────────────────────────────────

export function TrialResultsTab() {
  const { addToast } = useToast();
  const [committedCount, setCommittedCount] = useState(0);
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [running, setRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { count } = await supabase
        .from("signal_anchors")
        .select("id", { count: "exact", head: true })
        .not("committed_at", "is", null);
      setCommittedCount(count || 0);

      const { data, error } = await supabase
        .from("place_intelligence_trial_runs")
        .select("*, place:place_pool!place_pool_id(id, name, primary_type)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      setAllRows(data || []);
    } catch (err) {
      console.error("[TrialResultsTab] load failed:", err);
      addToast({ variant: "error", title: "Couldn't load results", description: err.message });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Group rows by run_id for display
  const runs = {};
  for (const row of allRows) {
    if (!runs[row.run_id]) runs[row.run_id] = [];
    runs[row.run_id].push(row);
  }
  const runIds = Object.keys(runs).sort((a, b) => {
    const aDate = runs[a][0]?.created_at || "";
    const bDate = runs[b][0]?.created_at || "";
    return bDate.localeCompare(aDate);
  });

  async function handlePrepareAll() {
    if (committedCount === 0) {
      addToast({ variant: "warning", title: "No anchors committed yet" });
      return;
    }
    setPreparing(true);
    try {
      const { data, error } = await invokeWithRefresh("run-place-intelligence-trial", {
        body: { action: "prepare_all", force_refresh: false },
      });
      if (error) {
        const msg = await extractFunctionError(error, "prepare_all failed");
        throw new Error(msg);
      }
      addToast({
        variant: "success",
        title: `Prepared ${data.totalPlaces} places`,
        description: "Reviews + collages ready. Click Run trial.",
      });
    } catch (err) {
      console.error("[TrialResultsTab] prepare_all failed:", err);
      addToast({ variant: "error", title: "Prepare failed", description: err.message });
    } finally {
      setPreparing(false);
    }
  }

  async function handleRunTrial() {
    if (!window.confirm(
      `About to run trial for ${committedCount} places. Estimated cost ~$${(committedCount * 0.045).toFixed(2)}, ~${Math.ceil(committedCount * 1.2)} minute wall time. Continue?`
    )) {
      return;
    }

    setRunning(true);
    try {
      const { data, error } = await invokeWithRefresh("run-place-intelligence-trial", {
        body: { action: "run_trial" },
      });
      if (error) {
        const msg = await extractFunctionError(error, "run_trial failed");
        throw new Error(msg);
      }
      setActiveRunId(data.runId);
      addToast({
        variant: "success",
        title: `Trial complete`,
        description: `${data.succeeded} succeeded, ${data.failed} failed, cost ${formatCost(data.totalCostUsd)}`,
      });
      await refresh();
    } catch (err) {
      console.error("[TrialResultsTab] run_trial failed:", err);
      addToast({ variant: "error", title: "Run trial failed", description: err.message });
    } finally {
      setRunning(false);
    }
  }

  const canRun = committedCount > 0 && !running && !preparing;

  return (
    <SectionCard
      title="Trial Results"
      subtitle={`${committedCount} anchors committed · ${runIds.length} historical run${runIds.length === 1 ? "" : "s"}`}
      action={
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={refresh} disabled={loading}>Refresh</Button>
      }
    >
      <div className="space-y-4">
        {/* Run controls */}
        <div className="flex flex-wrap items-center gap-2 p-4 border border-[var(--gray-200)] rounded-lg bg-[var(--gray-50)]">
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Trial run</h4>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
              Step 1: Fetch reviews + build collages for all committed anchors.
              Step 2: Run Claude Q1 + Q2 per place. Step 3: Read results below.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={Sparkles}
            onClick={handlePrepareAll}
            loading={preparing}
            disabled={preparing || running || committedCount === 0}
          >
            1. Prepare reviews + collages
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={Play}
            onClick={handleRunTrial}
            loading={running}
            disabled={!canRun}
          >
            2. Run trial ({committedCount} places)
          </Button>
        </div>

        {loading && allRows.length === 0 && (
          <div className="flex items-center justify-center py-12"><Spinner size="md" /></div>
        )}

        {!loading && runIds.length === 0 && (
          <AlertCard variant="info" title="No trials yet">
            Pick anchors on the Signal Anchors tab, prepare data, then run the trial.
          </AlertCard>
        )}

        {runIds.map((runId) => {
          const runRows = runs[runId];
          const succeeded = runRows.filter((r) => r.status === "completed").length;
          const failed = runRows.filter((r) => r.status === "failed").length;
          const totalCost = runRows.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
          const startedAt = runRows[0]?.created_at;
          return (
            <div key={runId} className="space-y-2">
              <div className="flex items-baseline justify-between gap-2 px-1">
                <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                  Run {runId.slice(0, 8)}…
                </h4>
                <span className="text-xs text-[var(--color-text-tertiary)] font-mono">
                  {runRows.length} places · ✓{succeeded} ✗{failed} · {formatCost(totalCost)} · {new Date(startedAt).toLocaleString()}
                </span>
              </div>
              <div className="space-y-1">
                {runRows.map((row) => (
                  <PlaceResultCard key={row.id} row={row} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

export default TrialResultsTab;
