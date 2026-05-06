/**
 * TrialResultsTab — ORCH-0712 → ORCH-0734
 *
 * ORCH-0712 originally targeted 32 committed anchors. ORCH-0734 (2026-05-05)
 * replaced anchor scope with city-scoped sampled-sync: operator picks a city +
 * sample size (50-500, default 200), edge fn loads stratified random sample of
 * is_servable place_pool rows, browser drives one row per place per run.
 * Legacy 32-anchor rows preserve signal_id + anchor_index as audit trail.
 *
 * Top: city picker + sample size + single "Run trial" button (collapses
 *      former two-step prepare→run flow into one button per operator decision).
 * Below: scrollable list of past runs with per-place expandable cards
 *        showing collage + Q2 (per-signal evaluation). Q1 dropped at v3.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Play, RefreshCw, Square, ChevronDown, ChevronRight,
  CheckCircle, XCircle, Globe, Clock,
} from "lucide-react";
import { supabase, invokeWithRefresh } from "../../lib/supabase";
import { extractFunctionError } from "../../lib/edgeFunctionError";
import { useToast } from "../../context/ToastContext";
import { SectionCard, AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";

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
        {/* ORCH-0734 — anchor badge only renders for legacy 32-anchor rows.
            City-runs rows (signal_id=null, city_id set) skip the badge. */}
        {row.signal_id && row.anchor_index != null && (
          <span className="text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded bg-[var(--color-brand-50)] text-[var(--color-brand-700)]">
            {row.signal_id} #{row.anchor_index}
          </span>
        )}
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

// ORCH-0733 — Anthropic dropped per DEC-101/DEC-102; Gemini sole provider.
// Browser-side per-place throttle for Gemini Flash 2.5: free tier is 15 RPM
// (~4s floor); paid tier 1 is effectively unbounded. 1s pad keeps under both.
const PER_PLACE_BROWSER_THROTTLE_MS = 1_000;

// ORCH-0734 — actual measured cost on run e15f5d8f (32 anchors → $0.1292).
// Used for confirm-dialog estimate. Adjusted from 0.0038 (rounded estimate
// from earlier v3 measurement) to 0.0040 (defensive over-estimate; harmless).
const PER_PLACE_COST_USD = 0.0040;

// ORCH-0734 — sample-mode bounds. Operator picks 50-500 places per city run.
const SAMPLE_SIZE_DEFAULT = 200;
const SAMPLE_SIZE_MIN = 50;
const SAMPLE_SIZE_MAX = 500;

// ORCH-0734 — combined per-place wall time estimate: ~22s Gemini + ~5s prepare
// (fetch_reviews + compose_collage) + 1s throttle ≈ 28-30s steady-state. 30s
// chosen for the confirm-dialog estimate to surface honest expectations.
const PER_PLACE_WALL_SECONDS = 30;

export function TrialResultsTab() {
  const { addToast } = useToast();
  // ORCH-0734 — anchor scope replaced with city scope.
  const [cities, setCities] = useState([]); // [{id, name, country, servable_count}]
  const [cityId, setCityId] = useState(null);
  const [sampleSize, setSampleSize] = useState(SAMPLE_SIZE_DEFAULT);
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  // Live progress for the currently-running SAMPLE-mode trial loop. Phase transitions
  // "preparing" → "trial" so operator sees both halves of the collapsed flow.
  const [progress, setProgress] = useState(null); // { phase, current, total, succeeded, failed, costSoFar }
  const stopRef = useState({ stop: false })[0];

  // Synchronous guard against double-invocation (React state is async, so
  // disabled={running} can let a fast double-click squeeze through before
  // React applies the disabled state).
  const isRunningRef = useRef(false);

  // ORCH-0737 — mode toggle (sample default, full_city is async durable mode)
  const [mode, setMode] = useState("sample");

  // ORCH-0737 — active full-city run state. activeRunId set after start_run
  // OR via list_active_runs hydration on mount (cross-session resume).
  // activeRun is the polled parent row; updated every 5s while running.
  const [activeRunId, setActiveRunId] = useState(null);
  const [activeRun, setActiveRun] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // ORCH-0734 — load seeded cities + their servable counts. Filter to
      // cities with non-zero servable for the picker (zero-servable cities
      // can't be picked; would just produce empty runs).
      const [cityRowsRes, servableRes, runsRes] = await Promise.all([
        supabase
          .from("seeding_cities")
          .select("id, name, country")
          .eq("status", "seeded")
          .order("name"),
        supabase
          .from("place_pool")
          .select("city_id")
          .eq("is_servable", true),
        supabase
          .from("place_intelligence_trial_runs")
          .select("*, place:place_pool!place_pool_id(id, name, primary_type)")
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (cityRowsRes.error) throw cityRowsRes.error;
      if (servableRes.error) throw servableRes.error;
      if (runsRes.error) throw runsRes.error;

      // Aggregate servable counts client-side. At ~50K place_pool rows this
      // is a few-MB select; acceptable for an admin tool. If needed, lift
      // to a Postgres view in a future cycle.
      const countMap = new Map();
      for (const row of servableRes.data || []) {
        if (!row.city_id) continue;
        countMap.set(row.city_id, (countMap.get(row.city_id) || 0) + 1);
      }
      const enriched = (cityRowsRes.data || [])
        .map((c) => ({ ...c, servable_count: countMap.get(c.id) || 0 }))
        .filter((c) => c.servable_count > 0);
      setCities(enriched);

      setAllRows(runsRes.data || []);
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

  // ORCH-0737 — cross-session resume on mount. If any full-city run is currently
  // active (status pending/running/cancelling), hydrate UI immediately so the
  // operator sees in-progress state on tab reopen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await invokeWithRefresh("run-place-intelligence-trial", {
          body: { action: "list_active_runs" },
        });
        if (cancelled) return;
        if (error) return; // silent: feature is non-critical for hydration
        if (data?.runs?.length > 0) {
          // Pick the most recent active run; if multiple, panel shows newest first
          setActiveRunId(data.runs[0].id);
          setActiveRun(data.runs[0]);
        }
      } catch (_err) {
        // silent
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ORCH-0737 — poll active run status every 5s while activeRunId is set.
  // When run reaches terminal state (complete/cancelled/failed), stop polling
  // and refresh the run-history list.
  useEffect(() => {
    if (!activeRunId) return;
    let cancelled = false;
    (async () => {
      while (!cancelled) {
        try {
          const { data } = await invokeWithRefresh("run-place-intelligence-trial", {
            body: { action: "run_status", run_id: activeRunId },
          });
          if (cancelled) break;
          if (data?.parent) {
            setActiveRun(data.parent);
            if (["complete", "cancelled", "failed"].includes(data.parent.status)) {
              setActiveRunId(null);
              await refresh();
              break;
            }
          }
        } catch (_err) {
          // silent — next poll will retry
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
    })();
    return () => { cancelled = true; };
  }, [activeRunId, refresh]);

  // ORCH-0737 — cancel active full-city run (calls cancel_trial action).
  async function handleCancelActiveRun(runId) {
    if (!window.confirm("Cancel this run? Partial results will be preserved.")) return;
    try {
      const { error } = await invokeWithRefresh("run-place-intelligence-trial", {
        body: { action: "cancel_trial", run_id: runId },
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
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't cancel", description: err.message });
    }
  }

  // ORCH-0737 — top-level dispatcher. Branches on mode.
  async function handleRunTrial() {
    if (mode === "sample") {
      return handleRunSampleTrial();
    }
    return handleRunFullCityTrial();
  }

  // ORCH-0737 — full-city async mode. Submits start_run with mode=full_city,
  // optional confirm_high_cost flag (after double-confirm dialog), then sets
  // activeRunId so polling effect kicks in. Browser does NOT loop.
  async function handleRunFullCityTrial() {
    if (isRunningRef.current) return;
    isRunningRef.current = true;

    if (!cityId) {
      addToast({ variant: "warning", title: "Pick a city first" });
      isRunningRef.current = false;
      return;
    }
    const selectedCity = cities.find((c) => c.id === cityId);
    if (!selectedCity) {
      addToast({ variant: "error", title: "Selected city not found" });
      isRunningRef.current = false;
      return;
    }

    const totalPlaces = selectedCity.servable_count;
    const estCostNum = +(totalPlaces * PER_PLACE_COST_USD).toFixed(2);
    const estMinutes = Math.ceil((totalPlaces * PER_PLACE_WALL_SECONDS) / 60);
    const estTimeStr = estMinutes >= 60 ? `~${(estMinutes / 60).toFixed(1)} hrs` : `~${estMinutes} min`;

    // First confirm — standard cost+time disclosure
    if (!window.confirm(
      `About to run a FULL-CITY trial for ${totalPlaces} places in ${selectedCity.name}, ${selectedCity.country}.\n\n` +
      `Estimated cost: ~$${estCostNum.toFixed(2)} USD\n` +
      `Estimated wall time: ${estTimeStr}\n\n` +
      `The run will execute on Mingla's servers. You can close this tab and come back hours later — the run keeps going until you click Cancel.\n\n` +
      `Continue?`
    )) {
      isRunningRef.current = false;
      return;
    }

    // Second confirm if cost > $5 guard
    const exceedsGuard = estCostNum > 5;
    if (exceedsGuard && !window.confirm(
      `⚠️ This run will charge approximately $${estCostNum.toFixed(2)} on the Gemini API.\n\n` +
      `The default cost guard is $5. You're authorizing an override.\n\n` +
      `I understand this will charge ~$${estCostNum.toFixed(2)}. Confirm again?`
    )) {
      isRunningRef.current = false;
      return;
    }

    setRunning(true);
    try {
      const { data: created, error: startErr } = await invokeWithRefresh("run-place-intelligence-trial", {
        body: {
          action: "start_run",
          city_id: cityId,
          mode: "full_city",
          confirm_high_cost: exceedsGuard,
        },
      });
      if (startErr) throw new Error(await extractFunctionError(startErr, "start_run failed"));

      addToast({
        variant: "info",
        title: "Full-city run started",
        description:
          `${created.cityName} · ${created.totalPlaces} places · est ${formatCost(created.estimatedCostUsd)} · ` +
          `~${created.estimatedMinutes} min. You can close this tab.`,
      });

      // Trigger polling — fetches initial parent state on first tick
      setActiveRunId(created.runId);
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't start run", description: err.message });
    } finally {
      setRunning(false);
      isRunningRef.current = false;
    }
  }

  // ORCH-0734 — sample mode (browser-loop, prepare→trial phases).
  // ORCH-0737: renamed from handleRunTrial; functionally unchanged.
  async function handleRunSampleTrial() {
    // Synchronous guard against double-invocation race
    if (isRunningRef.current) return;
    isRunningRef.current = true;

    if (!cityId) {
      addToast({ variant: "warning", title: "Pick a city first" });
      isRunningRef.current = false;
      return;
    }
    const selectedCity = cities.find((c) => c.id === cityId);
    if (!selectedCity) {
      addToast({ variant: "error", title: "Selected city not found" });
      isRunningRef.current = false;
      return;
    }

    const effectiveSample = Math.min(sampleSize, selectedCity.servable_count);
    const estCost = (effectiveSample * PER_PLACE_COST_USD).toFixed(2);
    const estMinutes = Math.ceil((effectiveSample * PER_PLACE_WALL_SECONDS) / 60);

    if (!window.confirm(
      `About to run trial for ${effectiveSample} places sampled from ${selectedCity.name}, ${selectedCity.country} ` +
      `(${selectedCity.servable_count} servable total) using Gemini 2.5 Flash. ` +
      `Estimated cost ~$${estCost}, ~${estMinutes} minute wall time. ` +
      `Don't refresh the page during the run. Continue?`
    )) {
      isRunningRef.current = false;
      return;
    }

    setRunning(true);
    stopRef.stop = false;

    try {
      // Step 1: create run_id + pending rows for the sampled places
      const { data: created, error: startErr } = await invokeWithRefresh("run-place-intelligence-trial", {
        body: { action: "start_run", city_id: cityId, sample_size: sampleSize },
      });
      if (startErr) throw new Error(await extractFunctionError(startErr, "start_run failed"));
      const runId = created?.runId;
      const places = created?.anchors || []; // shape preserved for browser-loop compat
      if (!runId || places.length === 0) throw new Error("start_run returned no places");

      addToast({
        variant: "info",
        title: `Trial started`,
        description: `${created.cityName} · ${places.length} places · est ${formatCost(created.estimatedCostUsd)} · run ${runId.slice(0, 8)}…`,
      });

      // Phase 1: prepare (fetch_reviews + compose_collage per place).
      // Counts succeeded/failed at prepare phase but does NOT block phase 2 —
      // failed prepares result in run_trial_for_place errors which are
      // counted in phase 2's failure column. This honors operator's "one
      // button" choice while keeping per-phase observability.
      let prepareSucceeded = 0;
      let prepareFailed = 0;
      setProgress({ phase: "prepare", current: 0, total: places.length, succeeded: 0, failed: 0, runId });

      for (let i = 0; i < places.length; i++) {
        if (stopRef.stop) break;
        const p = places[i];
        setProgress((s) => ({ ...s, current: i + 1, currentPlace: p.place_pool_id.slice(0, 8) }));

        try {
          const { error: rErr } = await invokeWithRefresh("run-place-intelligence-trial", {
            body: { action: "fetch_reviews", place_pool_id: p.place_pool_id, force_refresh: false },
          });
          if (rErr) throw new Error(await extractFunctionError(rErr, "fetch_reviews failed"));

          const { error: cErr } = await invokeWithRefresh("run-place-intelligence-trial", {
            body: { action: "compose_collage", place_pool_id: p.place_pool_id, force: false },
          });
          if (cErr) throw new Error(await extractFunctionError(cErr, "compose_collage failed"));

          prepareSucceeded++;
        } catch (err) {
          console.error(`[TrialResultsTab] prepare ${p.place_pool_id} failed:`, err);
          prepareFailed++;
        }
        setProgress((s) => ({ ...s, succeeded: prepareSucceeded, failed: prepareFailed }));
      }

      // Phase 2: Gemini per place. Skip places that failed prepare; let the
      // edge fn surface "prerequisites_missing" for those (counted as failed
      // in phase 2 too, which double-counts a few places — acceptable for
      // the simpler UX of a single button).
      let succeeded = 0;
      let failed = 0;
      let totalCost = 0;
      setProgress({ phase: "trial", current: 0, total: places.length, succeeded: 0, failed: 0, runId });

      for (let i = 0; i < places.length; i++) {
        if (stopRef.stop) break;
        const p = places[i];

        // Throttle BEFORE each call (skip first). Gemini Flash 2.5 paid tier
        // 1 has effectively no RPM cap; 1s is defensive against accidental
        // free-tier deployment.
        if (i > 0) {
          await new Promise((r) => setTimeout(r, PER_PLACE_BROWSER_THROTTLE_MS));
        }
        setProgress((s) => ({ ...s, current: i + 1, currentPlace: p.place_pool_id.slice(0, 8) }));

        try {
          const { data: result, error: e } = await invokeWithRefresh("run-place-intelligence-trial", {
            body: {
              action: "run_trial_for_place",
              run_id: runId,
              place_pool_id: p.place_pool_id,
              // ORCH-0734 — signal_id and anchor_index intentionally omitted for city-runs.
            },
          });
          if (e) throw new Error(await extractFunctionError(e, "run_trial_for_place failed"));
          totalCost += Number(result?.cost_usd || 0);
          succeeded++;
        } catch (err) {
          console.error(`[TrialResultsTab] run_trial_for_place ${p.place_pool_id} failed:`, err);
          failed++;
        }
        setProgress((s) => ({ ...s, succeeded, failed, costSoFar: totalCost }));
      }

      const partialSuccess = succeeded > 0 && failed > 0;
      addToast({
        variant: succeeded === places.length ? "success" : (partialSuccess ? "warning" : "error"),
        title: `Trial complete`,
        description:
          `${succeeded} succeeded · ${failed} failed · cost ${formatCost(totalCost)}` +
          (failed > 0
            ? ` · Some failures expected from missing photos (~5-15%) or intermittent Gemini flakes.`
            : ""),
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

  const selectedCity = cities.find((c) => c.id === cityId) || null;
  // ORCH-0737 — effectiveCount depends on mode. full_city = all servable; sample = min(picker, servable)
  const effectiveCount = !selectedCity
    ? 0
    : mode === "full_city"
      ? selectedCity.servable_count
      : Math.min(sampleSize, selectedCity.servable_count);
  const estCostNum = effectiveCount * PER_PLACE_COST_USD;
  const estCostUsd = estCostNum.toFixed(2);
  const estMinutes = Math.ceil((effectiveCount * PER_PLACE_WALL_SECONDS) / 60);
  const estTimeStr = estMinutes >= 60 ? `~${(estMinutes / 60).toFixed(1)} hrs` : `~${estMinutes} min`;
  const exceedsCostGuard = estCostNum > 5;
  const canRun = !!cityId && !running && !loading && !activeRunId;          // ORCH-0737 block while active full-city run

  return (
    <SectionCard
      title="Trial Results"
      subtitle={`${cities.length} cit${cities.length === 1 ? "y" : "ies"} available · ${runIds.length} historical run${runIds.length === 1 ? "" : "s"}`}
      action={
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={refresh} disabled={loading}>Refresh</Button>
      }
    >
      <div className="space-y-4">
        {/* ORCH-0737 — active-run panel for full-city durable runs. Renders
            above the form when a full-city run is in flight. Survives tab
            close/refresh via list_active_runs hydration on mount. */}
        {activeRun && (
          <div className="border border-[var(--color-brand-200)] rounded-lg p-4 space-y-3 bg-[var(--color-brand-50)]">
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                {activeRun.mode === "full_city"
                  ? <><Globe className="w-4 h-4 inline" /> Full-city run</>
                  : <><Clock className="w-4 h-4 inline" /> Sample run</>}
                {" — "}{activeRun.city_name}
              </h4>
              <span className="text-xs font-mono text-[var(--color-text-secondary)]">
                {activeRun.processed_count} / {activeRun.total_count}
                {" "}({Math.round((activeRun.processed_count / Math.max(1, activeRun.total_count)) * 100)}%)
              </span>
            </div>
            <div className="h-2 bg-[var(--gray-200)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--color-brand-500)] transition-all duration-200"
                style={{ width: `${(activeRun.processed_count / Math.max(1, activeRun.total_count)) * 100}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="text-[var(--color-success-700)] font-mono">✓ {activeRun.succeeded_count}</span>
              <span className="text-[var(--color-error-700)] font-mono">✗ {activeRun.failed_count}</span>
              <span className="text-[var(--color-text-secondary)] font-mono">
                cost: ${Number(activeRun.cost_so_far_usd || 0).toFixed(4)} of ~${Number(activeRun.estimated_cost_usd || 0).toFixed(2)}
              </span>
              <span className="ml-auto">
                <span className={[
                  "text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded",
                  activeRun.status === "running" && "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
                  activeRun.status === "cancelling" && "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
                  activeRun.status === "pending" && "bg-[var(--gray-100)] text-[var(--color-text-tertiary)]",
                ].filter(Boolean).join(" ")}>
                  {activeRun.status}
                </span>
              </span>
            </div>
            {activeRun.status === "running" && (
              <Button variant="danger" size="sm" icon={Square} onClick={() => handleCancelActiveRun(activeRun.id)}>
                Cancel run
              </Button>
            )}
            {activeRun.status === "cancelling" && (
              <p className="text-xs text-[var(--color-warning-700)]">
                Cancelling… will stop after current chunk (~30-90s).
              </p>
            )}
            <p className="text-xs text-[var(--color-text-tertiary)] italic">
              {activeRun.mode === "full_city"
                ? "Running on the server — safe to close this tab. Status updates every 5s while page is open."
                : "Sample run in progress."}
            </p>
          </div>
        )}

        {/* ORCH-0734 — city picker + sample size. ORCH-0737 — added mode toggle.
            Sample mode: browser-loop, ~75 min/200 places.
            Whole city mode: durable async, server-side, hours but tab-close-safe. */}
        <div className="flex flex-col gap-3 p-4 border border-[var(--gray-200)] rounded-lg bg-[var(--gray-50)]">
          {/* ORCH-0737 — mode toggle (segmented control) */}
          <div className="flex flex-col gap-1.5">
            <label className="block text-sm font-medium text-[var(--color-text-primary)]">
              Mode
            </label>
            <div className="flex gap-1 p-1 bg-[var(--gray-100)] rounded-lg">
              <button
                type="button"
                onClick={() => setMode("sample")}
                disabled={running || loading || !!activeRunId}
                aria-pressed={mode === "sample"}
                className={[
                  "flex-1 h-9 text-sm font-medium rounded-md transition-colors duration-150",
                  mode === "sample"
                    ? "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm cursor-pointer"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                ].join(" ")}
              >
                Sample
              </button>
              <button
                type="button"
                onClick={() => setMode("full_city")}
                disabled={running || loading || !!activeRunId}
                aria-pressed={mode === "full_city"}
                className={[
                  "flex-1 h-9 text-sm font-medium rounded-md transition-colors duration-150",
                  mode === "full_city"
                    ? "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm cursor-pointer"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                ].join(" ")}
              >
                Whole city
              </button>
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)]">
              {mode === "sample"
                ? "Stratified random sample, runs in your browser (~75 min for 200 places). Don't refresh during the run."
                : "Process every servable place in the city. Runs on the server — close the tab, come back later. Cancel anytime."}
            </p>
          </div>

          <div className="flex flex-col md:flex-row md:items-end gap-3">
            <div className="flex-1 min-w-0">
              <label
                htmlFor="trial-city-picker"
                className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5"
              >
                City
              </label>
              <select
                id="trial-city-picker"
                value={cityId || ""}
                onChange={(e) => setCityId(e.target.value || null)}
                disabled={running || loading || !!activeRunId}
                className={[
                  "w-full h-10 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
                  "border border-[var(--gray-300)] rounded-lg outline-none transition-all duration-150",
                  "px-3 cursor-pointer",
                  "focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                ].join(" ")}
              >
                <option value="">Choose a city…</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}, {c.country} — {c.servable_count} servable
                  </option>
                ))}
              </select>
            </div>
            {/* ORCH-0737 — sample-size input only renders in sample mode */}
            {mode === "sample" && (
              <div className="w-full md:w-40">
                <label
                  htmlFor="trial-sample-size"
                  className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5"
                >
                  Sample size
                </label>
                <input
                  id="trial-sample-size"
                  type="number"
                  min={SAMPLE_SIZE_MIN}
                  max={SAMPLE_SIZE_MAX}
                  step={50}
                  value={sampleSize}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isInteger(n)) {
                      setSampleSize(Math.max(SAMPLE_SIZE_MIN, Math.min(SAMPLE_SIZE_MAX, n)));
                    }
                  }}
                  disabled={running || loading || !!activeRunId}
                  className={[
                    "w-full h-10 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
                    "border border-[var(--gray-300)] rounded-lg outline-none transition-all duration-150",
                    "px-3 tabular-nums",
                    "focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  ].join(" ")}
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                icon={Play}
                onClick={handleRunTrial}
                loading={running}
                disabled={!canRun}
              >
                Run trial{selectedCity ? ` (${effectiveCount})` : ""}
              </Button>
              {running && mode === "sample" && (
                <Button variant="danger" size="sm" icon={Square} onClick={handleCancel}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
          {/* ORCH-0737 — cost+time helper text adapts to mode */}
          <div className="text-xs text-[var(--color-text-tertiary)]">
            {selectedCity ? (
              <>
                {mode === "full_city" ? (
                  <>
                    {`Whole city: ${effectiveCount} servable places · ~$${estCostUsd} · ${estTimeStr} wall time`}
                    {exceedsCostGuard && (
                      <strong className="text-[var(--color-warning-700)]"> · cost guard requires double-confirm</strong>
                    )}
                  </>
                ) : (
                  <>
                    Stratified random — top half by review_count + random fill of bottom half.
                    {` ${effectiveCount} of ${selectedCity.servable_count} servable places · ~$${estCostUsd} · ${estTimeStr} wall time`}
                  </>
                )}
              </>
            ) : (
              mode === "sample"
                ? <>{` Range ${SAMPLE_SIZE_MIN}-${SAMPLE_SIZE_MAX}, default ${SAMPLE_SIZE_DEFAULT}.`}</>
                : <>Pick a city to see cost + time estimate for the full pool.</>
            )}
            {!!activeRunId && (
              <span className="block mt-1 text-[var(--color-warning-700)]">
                Already a run in progress — wait or cancel above before starting another.
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-[var(--gray-200)]">
            <span className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wide font-mono shrink-0">AI Provider</span>
            <span className="text-xs font-medium text-[var(--color-text-primary)]">Gemini 2.5 Flash</span>
            <span className="text-xs text-[var(--color-text-tertiary)]">· v4 prompt</span>
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
            Pick a city + sample size, then click Run trial. Results will appear here once the run completes.
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
