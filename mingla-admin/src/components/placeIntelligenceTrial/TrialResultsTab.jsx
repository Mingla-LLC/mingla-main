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
  CheckCircle, XCircle,
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

  // Live progress for the currently-running trial loop. Phase transitions
  // "preparing" → "trial" so operator sees both halves of the collapsed flow.
  const [progress, setProgress] = useState(null); // { phase, current, total, succeeded, failed, costSoFar }
  const stopRef = useState({ stop: false })[0];

  // Synchronous guard against double-invocation (React state is async, so
  // disabled={running} can let a fast double-click squeeze through before
  // React applies the disabled state).
  const isRunningRef = useRef(false);

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

  // ORCH-0734 — collapsed prepare→run flow into single button. Internally:
  // phase 1 (prepare): fetch_reviews + compose_collage per place.
  // phase 2 (trial): run_trial_for_place per place.
  // Operator sees progress through both phases; Stop covers both.
  async function handleRunTrial() {
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
  const effectiveSample = selectedCity ? Math.min(sampleSize, selectedCity.servable_count) : 0;
  const estCostUsd = (effectiveSample * PER_PLACE_COST_USD).toFixed(2);
  const estMinutes = Math.ceil((effectiveSample * PER_PLACE_WALL_SECONDS) / 60);
  const canRun = !!cityId && !running && !loading;

  return (
    <SectionCard
      title="Trial Results"
      subtitle={`${cities.length} cit${cities.length === 1 ? "y" : "ies"} available · ${runIds.length} historical run${runIds.length === 1 ? "" : "s"}`}
      action={
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={refresh} disabled={loading}>Refresh</Button>
      }
    >
      <div className="space-y-4">
        {/* ORCH-0734 — city + sample size + single Run button. Operator picks
            a city from servable-non-zero list, sets sample size 50-500, clicks
            Run. Internal flow runs prepare phase then trial phase per place
            with progress observable through both. */}
        <div className="flex flex-col gap-3 p-4 border border-[var(--gray-200)] rounded-lg bg-[var(--gray-50)]">
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
                disabled={running || loading}
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
                disabled={running || loading}
                className={[
                  "w-full h-10 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)]",
                  "border border-[var(--gray-300)] rounded-lg outline-none transition-all duration-150",
                  "px-3 tabular-nums",
                  "focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                ].join(" ")}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                icon={Play}
                onClick={handleRunTrial}
                loading={running}
                disabled={!canRun}
              >
                Run trial{selectedCity ? ` (${effectiveSample})` : ""}
              </Button>
              {running && (
                <Button variant="danger" size="sm" icon={Square} onClick={handleCancel}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
          <div className="text-xs text-[var(--color-text-tertiary)]">
            Stratified random — top half by review_count + random fill of bottom half.
            {selectedCity ? (
              <>
                {` ${effectiveSample} of ${selectedCity.servable_count} servable places · ~$${estCostUsd} · ~${estMinutes} min wall time`}
              </>
            ) : (
              <>{` Range ${SAMPLE_SIZE_MIN}-${SAMPLE_SIZE_MAX}, default ${SAMPLE_SIZE_DEFAULT}.`}</>
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
