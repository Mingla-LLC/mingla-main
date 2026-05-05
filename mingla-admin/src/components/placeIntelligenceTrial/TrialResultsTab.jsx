/**
 * TrialResultsTab — ORCH-0712
 *
 * Top: aggregate stats + Run trial button (gated on prerequisites).
 * Below: scrollable list of past runs with per-place expandable cards
 * showing collage + Q1 (open exploration) + Q2 (per-signal evaluation).
 */

import { useEffect, useState, useCallback, useRef } from "react";
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
        {/* ORCH-0713 Gemini A/B — model badge distinguishes Anthropic vs Gemini runs at a glance. */}
        {row.model && (
          <span
            className={[
              "text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded shrink-0",
              row.model.startsWith("gemini")
                ? "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]"
                : "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
            ].join(" ")}
            title={`Model: ${row.model}${row.model_version ? ` (${row.model_version})` : ""}`}
          >
            {row.model.startsWith("gemini") ? "Gemini" : "Haiku"}
          </span>
        )}
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
                {q2.evaluations.map((e, i) => {
                  // ORCH-0713 Phase 0.5 — score_0_to_100 is the v2 shape; old v1 rows
                  // surface confidence_0_to_10 (× 10 ≈ score). Strong_match dropped in v2;
                  // tier color derived from score for both shapes.
                  const score = e.score_0_to_100 != null
                    ? Number(e.score_0_to_100)
                    : (e.confidence_0_to_10 != null ? Number(e.confidence_0_to_10) * 10 : null);
                  const tierClass = e.inappropriate_for
                    ? "bg-[var(--color-error-50)]"
                    : score == null
                    ? "bg-[var(--gray-50)]"
                    : score >= 70
                    ? "bg-[var(--color-success-50)]"
                    : score >= 30
                    ? "bg-[var(--color-warning-50)]"
                    : "bg-[var(--color-error-50)]";
                  const scoreColor = e.inappropriate_for
                    ? "text-[var(--color-error-700)]"
                    : score == null
                    ? "text-[var(--color-text-tertiary)]"
                    : score >= 70
                    ? "text-[var(--color-success-700)]"
                    : score >= 30
                    ? "text-[var(--color-warning-700)]"
                    : "text-[var(--color-error-700)]";
                  return (
                    <div
                      key={i}
                      className={["flex items-baseline gap-2 p-1.5 rounded", tierClass].join(" ")}
                    >
                      {e.inappropriate_for ? (
                        <XCircle className="w-3 h-3 text-[var(--color-error-700)] shrink-0" title="Structurally inappropriate (hard veto)" />
                      ) : score != null && score >= 70 ? (
                        <CheckCircle className="w-3 h-3 text-[var(--color-success-700)] shrink-0" title="Strong fit" />
                      ) : (
                        <span className="w-3 h-3 shrink-0 inline-block rounded-full border border-[var(--gray-300)]" />
                      )}
                      <span className="font-semibold w-24 shrink-0">{e.signal_id}</span>
                      <span className={["w-12 shrink-0 font-bold tabular-nums", scoreColor].join(" ")}>
                        {e.inappropriate_for ? "VETO" : score != null ? `${Math.round(score)}/100` : "—"}
                      </span>
                      <span className="text-[var(--color-text-secondary)] truncate flex-1" title={e.reasoning}>{e.reasoning}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tab ─────────────────────────────────────────────────────────────────────

// ORCH-0733 — Anthropic dropped per DEC-101; Gemini sole provider.
// Browser-side per-place throttle for Gemini Flash 2.5: free tier is 15 RPM
// (~4s floor); paid tier 1 is effectively unbounded. 1s pad keeps under both.
// Map shape preserved (defensive) so legacy v1/v2/v3 historical Anthropic rows
// continue to render correctly via the model badge in PlaceResultCard.
const PER_PLACE_BROWSER_THROTTLE_MS = 1_000;

// ORCH-0733 — Anthropic dropped per DEC-101; Gemini sole provider.
// Per-place cost for Gemini 2.5 Flash on v3/v4 prompt: ~$0.0038 measured on
// run fe15cb99 (32 anchors → $0.1212). Used for confirm-dialog estimate.
const PER_PLACE_COST_USD = 0.0038;

export function TrialResultsTab() {
  const { addToast } = useToast();
  const [committedCount, setCommittedCount] = useState(0);
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [running, setRunning] = useState(false);
  // ORCH-0733 — Anthropic dropped per DEC-101; Gemini sole provider; provider state removed.

  // Live progress for the currently-running prepare or trial loop
  const [progress, setProgress] = useState(null); // { phase, current, total, succeeded, failed, costSoFar }
  const stopRef = useState({ stop: false })[0];

  // Synchronous guard against double-invocation (React state is async, so
  // disabled={preparing} can let a fast double-click squeeze through before
  // React applies the disabled state).
  const isRunningRef = useRef(false);

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

  async function loadCommittedAnchors() {
    const { data, error } = await supabase
      .from("signal_anchors")
      .select("place_pool_id, signal_id, anchor_index, place:place_pool!place_pool_id(name)")
      .not("committed_at", "is", null)
      .order("signal_id");
    if (error) throw error;
    return data || [];
  }

  async function handlePrepareAll() {
    // Synchronous guard — prevents double-invocation race (React state async)
    if (isRunningRef.current) return;
    isRunningRef.current = true;

    if (committedCount === 0) {
      addToast({ variant: "warning", title: "No anchors committed yet" });
      isRunningRef.current = false;
      return;
    }
    setPreparing(true);
    stopRef.stop = false;

    let succeeded = 0;
    let failed = 0;
    try {
      const anchors = await loadCommittedAnchors();
      setProgress({ phase: "prepare", current: 0, total: anchors.length, succeeded: 0, failed: 0 });

      for (let i = 0; i < anchors.length; i++) {
        if (stopRef.stop) break;
        const a = anchors[i];
        setProgress((p) => ({ ...p, current: i + 1, currentPlace: a.place?.name || a.place_pool_id }));

        try {
          // Fetch reviews
          const { error: rErr } = await invokeWithRefresh("run-place-intelligence-trial", {
            body: { action: "fetch_reviews", place_pool_id: a.place_pool_id, force_refresh: false },
          });
          if (rErr) throw new Error(await extractFunctionError(rErr, "fetch_reviews failed"));

          // Compose collage
          const { error: cErr } = await invokeWithRefresh("run-place-intelligence-trial", {
            body: { action: "compose_collage", place_pool_id: a.place_pool_id, force: false },
          });
          if (cErr) throw new Error(await extractFunctionError(cErr, "compose_collage failed"));

          succeeded++;
        } catch (err) {
          console.error(`[TrialResultsTab] prepare ${a.place_pool_id} failed:`, err);
          failed++;
        }
        setProgress((p) => ({ ...p, succeeded, failed }));
      }
      addToast({
        variant: succeeded === anchors.length ? "success" : "warning",
        title: `Prepared ${succeeded} of ${anchors.length} places`,
        description: failed > 0 ? `${failed} failed — see console for details. Some places may have no photos or unreachable URLs.` : "Reviews + collages ready. Click Run trial.",
      });
    } catch (err) {
      console.error("[TrialResultsTab] prepare loop failed:", err);
      addToast({ variant: "error", title: "Prepare failed", description: err.message });
    } finally {
      setPreparing(false);
      setProgress(null);
      isRunningRef.current = false;
    }
  }

  async function handleRunTrial() {
    // Synchronous guard against double-invocation race
    if (isRunningRef.current) return;
    isRunningRef.current = true;

    const estCost = (committedCount * PER_PLACE_COST_USD).toFixed(2);

    if (!window.confirm(
      `About to run trial for ${committedCount} places using Gemini 2.5 Flash. Estimated cost ~$${estCost}, ~${Math.ceil(committedCount * 1.2)} minute wall time. Don't refresh the page during the run. Continue?`
    )) {
      isRunningRef.current = false;
      return;
    }

    setRunning(true);
    stopRef.stop = false;

    try {
      // Step 1: create run_id + pending rows
      const { data: created, error: startErr } = await invokeWithRefresh("run-place-intelligence-trial", {
        body: { action: "start_run" },
      });
      if (startErr) throw new Error(await extractFunctionError(startErr, "start_run failed"));
      const runId = created?.runId;
      const anchors = created?.anchors || [];
      if (!runId || anchors.length === 0) throw new Error("start_run returned no anchors");

      addToast({
        variant: "info",
        title: `Trial started`,
        description: `${anchors.length} places · est ${formatCost(created.estimatedCostUsd)} · run ${runId.slice(0, 8)}…`,
      });

      let succeeded = 0;
      let failed = 0;
      let totalCost = 0;
      setProgress({ phase: "trial", current: 0, total: anchors.length, succeeded: 0, failed: 0, runId });

      for (let i = 0; i < anchors.length; i++) {
        if (stopRef.stop) break;
        const a = anchors[i];

        // Throttle BEFORE each call (skip first). Gemini-only per ORCH-0733; 1s pad keeps
        // under Gemini Flash 2.5 free-tier 15-RPM floor with ample headroom.
        if (i > 0) {
          await new Promise((r) => setTimeout(r, PER_PLACE_BROWSER_THROTTLE_MS));
        }
        setProgress((p) => ({ ...p, current: i + 1, currentPlace: `${a.signal_id} #${a.anchor_index}` }));

        try {
          const { data: result, error: e } = await invokeWithRefresh("run-place-intelligence-trial", {
            body: {
              action: "run_trial_for_place",
              run_id: runId,
              place_pool_id: a.place_pool_id,
              signal_id: a.signal_id,
              anchor_index: a.anchor_index,
            },
          });
          if (e) throw new Error(await extractFunctionError(e, "run_trial_for_place failed"));
          totalCost += Number(result?.cost_usd || 0);
          succeeded++;
        } catch (err) {
          console.error(`[TrialResultsTab] run_trial_for_place ${a.place_pool_id} failed:`, err);
          failed++;
        }
        setProgress((p) => ({ ...p, succeeded, failed, costSoFar: totalCost }));
      }

      addToast({
        variant: succeeded === anchors.length ? "success" : "warning",
        title: `Trial complete`,
        description: `${succeeded} succeeded · ${failed} failed · cost ${formatCost(totalCost)}`,
      });
      await refresh();
    } catch (err) {
      console.error("[TrialResultsTab] trial loop failed:", err);
      addToast({ variant: "error", title: "Trial failed", description: err.message });
    } finally {
      setRunning(false);
      setProgress(null);
      isRunningRef.current = false;
    }
  }

  function handleCancel() {
    stopRef.stop = true;
    addToast({ variant: "info", title: "Cancelling…", description: "Will stop after the current place." });
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
        <div className="flex flex-col gap-3 p-4 border border-[var(--gray-200)] rounded-lg bg-[var(--gray-50)]">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Trial run</h4>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                Step 1: Fetch reviews + build collages for all committed anchors.
                Step 2: Run Q2 per place via Gemini 2.5 Flash. Step 3: Read results below.
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
            {(preparing || running) && (
              <Button variant="danger" size="sm" icon={Square} onClick={handleCancel}>
                Cancel
              </Button>
            )}
          </div>
          {/* ORCH-0733 — Provider toggle removed. Gemini 2.5 Flash is sole provider per DEC-101. */}
          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-[var(--gray-200)]">
            <span className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wide font-mono shrink-0">AI Provider</span>
            <span className="text-xs">
              <span className="font-medium text-[var(--color-text-primary)]">Gemini 2.5 Flash</span>
              <span className="text-[var(--color-text-tertiary)]">{` · est $${(committedCount * PER_PLACE_COST_USD).toFixed(2)} · v4 prompt`}</span>
            </span>
            <span className="text-[10px] text-[var(--color-text-tertiary)] italic ml-auto">
              Locked sole provider. Anthropic dropped 2026-05-05 after A/B comparison.
            </span>
          </div>
        </div>

        {progress && (
          <div className="border border-[var(--gray-200)] rounded-lg p-3 space-y-2 bg-[var(--color-info-50)]">
            <div className="flex items-baseline justify-between">
              <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                {progress.phase === "prepare" ? "Preparing data" : "Running trial"}
              </h4>
              <span className="text-xs font-mono text-[var(--color-text-secondary)]">
                {progress.current} / {progress.total}
                {progress.currentPlace && <span className="ml-2 text-[var(--color-text-tertiary)]">· {progress.currentPlace}</span>}
              </span>
            </div>
            <div className="h-2 bg-[var(--gray-200)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--color-brand-500)] transition-all duration-200"
                style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
              />
            </div>
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="text-[var(--color-success-700)]">✓ {progress.succeeded || 0}</span>
              <span className="text-[var(--color-error-700)]">✗ {progress.failed || 0}</span>
              {progress.costSoFar != null && (
                <span className="text-[var(--color-text-secondary)] ml-auto">cost so far: {formatCost(progress.costSoFar)}</span>
              )}
            </div>
          </div>
        )}

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
