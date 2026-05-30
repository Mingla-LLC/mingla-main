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

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Play, RefreshCw, Square,
  Globe, Clock, RotateCcw, ArrowRight, Info,
} from "lucide-react";
import { supabase, invokeWithRefresh } from "../../lib/supabase";
import { extractFunctionError } from "../../lib/edgeFunctionError";
import { useToast } from "../../context/ToastContext";
import { SectionCard, AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { RunHistoryGroups } from "./RunHistoryGroups";
import { SignalDistributionPanel } from "./SignalDistributionPanel";
import { CancelRunConfirmModal } from "./CancelRunConfirmModal";
import { RunRemainderConfirmModal } from "./RunRemainderConfirmModal";

function formatCost(n) {
  if (n == null) return "—";
  return `$${Number(n).toFixed(4)}`;
}

function formatPercent(n) {
  if (n == null) return "—";
  return `${Number(n).toFixed(1)}%`;
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
  // ORCH-1008 — extended with 'remainder' as a third option.
  const [mode, setMode] = useState("sample");

  // ORCH-0737 — active full-city run state. activeRunId set after start_run
  // OR via list_active_runs hydration on mount (cross-session resume).
  // activeRun is the polled parent row; updated every 5s while running.
  const [activeRunId, setActiveRunId] = useState(null);
  const [activeRun, setActiveRun] = useState(null);
  const [cityCoverage, setCityCoverage] = useState(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [retryingFailed, setRetryingFailed] = useState(false);
  // ORCH-1008 Phase 4 — modal state for cancel + remainder confirmation
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [remainderModalOpen, setRemainderModalOpen] = useState(false);
  // Dismissed-banner persistence for terminal active-run state (so we don't
  // keep showing a cancelled/failed banner once operator acknowledges).
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const fetchCityCoverage = useCallback(async (targetCityId, { quiet = false } = {}) => {
    if (!targetCityId) {
      setCityCoverage(null);
      return null;
    }
    setCoverageLoading(true);
    try {
      const { data, error } = await invokeWithRefresh("run-place-intelligence-trial", {
        body: { action: "city_coverage", city_id: targetCityId },
      });
      if (error) throw new Error(await extractFunctionError(error, "city_coverage failed"));
      setCityCoverage(data || null);
      return data || null;
    } catch (err) {
      if (!quiet) {
        addToast({ variant: "error", title: "Couldn't load city coverage", description: err.message });
      }
      setCityCoverage(null);
      return null;
    } finally {
      setCoverageLoading(false);
    }
  }, [addToast]);

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
      if (cityId) {
        await fetchCityCoverage(cityId, { quiet: true });
      }
    } catch (err) {
      console.error("[TrialResultsTab] load failed:", err);
      addToast({ variant: "error", title: "Couldn't load results", description: err.message });
    } finally {
      setLoading(false);
    }
  }, [addToast, cityId, fetchCityCoverage]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    fetchCityCoverage(cityId);
  }, [cityId, fetchCityCoverage]);

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

  // ORCH-1008 Phase 4d — pick most-recent run (by city if selected) whose
  // children include ≥10 completed rows. Drives SignalDistributionPanel.
  const { lastCompletedRunId, lastCompletedRunRows } = useMemo(() => {
    for (const rid of runIds) {
      const rows = runs[rid];
      if (cityId && rows[0]?.city_id !== cityId) continue;
      const completed = rows.filter((r) => r.status === "completed");
      if (completed.length >= 10) {
        return { lastCompletedRunId: rid, lastCompletedRunRows: rows };
      }
    }
    return { lastCompletedRunId: null, lastCompletedRunRows: [] };
    // Deps tracked through allRows (which drives runs + runIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, cityId]);

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
      } catch {
        // silent
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ORCH-0737 — poll active run status every 5s while activeRunId is set.
  // When run reaches terminal state (complete/cancelled/failed), stop polling
  // and refresh the run-history list.
  // ORCH-1008 Phase 4 — reset banner-dismissed when a new active run mounts
  useEffect(() => {
    if (activeRunId) setBannerDismissed(false);
  }, [activeRunId]);

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
              if (cityId) await fetchCityCoverage(cityId, { quiet: true });
              break;
            }
          }
        } catch {
          // silent — next poll will retry
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
    })();
    return () => { cancelled = true; };
  }, [activeRunId, cityId, fetchCityCoverage, refresh]);

  // ORCH-0737 — cancel active full-city run (calls cancel_trial action).
  // ORCH-1008 Phase 4 — replaced window.confirm with CancelRunConfirmModal.
  async function handleCancelActiveRunConfirmed() {
    if (!activeRunId) return;
    setCancelLoading(true);
    try {
      const { error } = await invokeWithRefresh("run-place-intelligence-trial", {
        body: { action: "cancel_trial", run_id: activeRunId },
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
    } finally {
      setCancelLoading(false);
      setCancelModalOpen(false);
    }
  }

  // ORCH-0737 — top-level dispatcher. Branches on mode.
  // ORCH-1008 — remainder mode uses the dedicated modal (same code path the
  //   Overview tab uses) for consistent cost-guard UX.
  async function handleRunTrial() {
    if (mode === "sample") {
      return handleRunSampleTrial();
    }
    if (mode === "remainder") {
      setRemainderModalOpen(true);
      return;
    }
    return handleRunFullCityTrial();
  }

  function handleResumeFromN() {
    if (!cityId || !activeRun) return;
    setMode("remainder");
    setBannerDismissed(true);
    setActiveRunId(null);
    setActiveRun(null);
    setRemainderModalOpen(true);
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
      setActiveRun({
        id: created.runId,
        city_name: created.cityName,
        mode: created.mode,
        total_count: created.totalPlaces,
        processed_count: 0,
        succeeded_count: 0,
        failed_count: 0,
        cost_so_far_usd: 0,
        estimated_cost_usd: created.estimatedCostUsd,
        status: "running",
      });
      await fetchCityCoverage(cityId, { quiet: true });
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
      await fetchCityCoverage(cityId, { quiet: true });
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

  async function handleRetryFailedPlaces() {
    if (!cityCoverage?.latest_run?.id || !selectedCity || retryingFailed || activeRunId) return;

    const retryCount = Number(cityCoverage.retryable_failed_count || 0);
    if (retryCount <= 0) {
      addToast({ variant: "info", title: "No retryable failures" });
      return;
    }

    const estimatedCost = Number(cityCoverage.estimated_retry_cost_usd || retryCount * PER_PLACE_COST_USD);
    if (!window.confirm(
      `Retry ${retryCount} failed ${selectedCity.name} places.\n\n` +
      `Estimated Gemini cost: ~$${estimatedCost.toFixed(2)}.\n` +
      `Successful places will not be rerun.\n\n` +
      `Continue?`
    )) {
      return;
    }

    const exceedsGuard = estimatedCost > 5;
    if (exceedsGuard && !window.confirm(
      `This retry will charge approximately $${estimatedCost.toFixed(2)} on the Gemini API.\n\n` +
      `The default cost guard is $5. Confirm override?`
    )) {
      return;
    }

    setRetryingFailed(true);
    try {
      const { data, error } = await invokeWithRefresh("run-place-intelligence-trial", {
        body: {
          action: "retry_failed_run",
          source_run_id: cityCoverage.latest_run.id,
          retry_filter: "retryable_only",
          confirm_high_cost: exceedsGuard,
        },
      });
      if (error) throw new Error(await extractFunctionError(error, "retry_failed_run failed"));

      addToast({
        variant: "info",
        title: "Retry run started",
        description: `${data.cityName} · ${data.retrySelectedCount} failed places · est ${formatCost(data.estimatedCostUsd)}.`,
      });

      setActiveRunId(data.runId);
      setActiveRun({
        id: data.runId,
        city_name: data.cityName,
        mode: data.mode,
        total_count: data.totalPlaces,
        processed_count: 0,
        succeeded_count: 0,
        failed_count: 0,
        cost_so_far_usd: 0,
        estimated_cost_usd: data.estimatedCostUsd,
        status: "running",
      });
      await refresh();
      await fetchCityCoverage(cityId, { quiet: true });
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't retry failed places", description: err.message });
    } finally {
      setRetryingFailed(false);
    }
  }

  const selectedCity = cities.find((c) => c.id === cityId) || null;
  // ORCH-1008 — remainder count = servable - scored (uses cityCoverage if loaded).
  const remainderCount = selectedCity && cityCoverage
    ? Math.max(
        0,
        Number(cityCoverage?.coverage?.servable_count ?? selectedCity.servable_count) -
          Number(cityCoverage?.coverage?.scored_count ?? 0),
      )
    : 0;
  // ORCH-0737 + ORCH-1008 — effectiveCount depends on mode.
  //   full_city  = all servable
  //   sample     = min(picker, servable)
  //   remainder  = servable - scored (from cityCoverage)
  const effectiveCount = !selectedCity
    ? 0
    : mode === "full_city"
      ? selectedCity.servable_count
      : mode === "remainder"
        ? remainderCount
        : Math.min(sampleSize, selectedCity.servable_count);
  const estCostNum = effectiveCount * PER_PLACE_COST_USD;
  const estCostUsd = estCostNum.toFixed(2);
  const estMinutes = Math.ceil((effectiveCount * PER_PLACE_WALL_SECONDS) / 60);
  const estTimeStr = estMinutes >= 60 ? `~${(estMinutes / 60).toFixed(1)} hrs` : `~${estMinutes} min`;
  const exceedsCostGuard = estCostNum > 5;
  // ORCH-0737 block while active full-city run; ORCH-1008: also block remainder
  // with zero remaining (avoids the no_remainder 400).
  const canRun = !!cityId
    && !running
    && !loading
    && !activeRunId
    && !retryingFailed
    && !(mode === "remainder" && remainderCount === 0);
  const retryableFailedCount = Number(cityCoverage?.retryable_failed_count || 0);
  const failedCount = Number(cityCoverage?.failed_count || 0);
  const nonretryableFailedCount = Number(cityCoverage?.nonretryable_failed_count || 0);
  const coverageSummary = cityCoverage?.coverage || cityCoverage || null;
  const canRetryFailed = !!cityCoverage?.latest_run?.id && retryableFailedCount > 0 && !activeRunId && !running && !retryingFailed;

  return (
    <SectionCard
      title="Trial Results"
      subtitle={`${cities.length} cit${cities.length === 1 ? "y" : "ies"} available · ${runIds.length} historical run${runIds.length === 1 ? "" : "s"}`}
      action={
        <Button
          size="sm"
          variant="ghost"
          icon={RefreshCw}
          onClick={async () => {
            await refresh();
            if (cityId) await fetchCityCoverage(cityId, { quiet: true });
          }}
          disabled={loading || coverageLoading}
        >
          Refresh
        </Button>
      }
    >
      <div className="space-y-4">
        {/* ORCH-0737 — active-run panel for full-city durable runs. Renders
            above the form when a full-city run is in flight. Survives tab
            close/refresh via list_active_runs hydration on mount.
            ORCH-1008 Phase 4 — banner can be dismissed once terminal; Resume
            button appears for cancelled runs (kicks remainder modal). */}
        {activeRun && !bannerDismissed && (
          <div className="border border-[var(--color-brand-200)] rounded-lg p-4 space-y-3 bg-[var(--color-brand-50)]">
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                {activeRun.mode === "retry_failed"
                  ? <><RotateCcw className="w-4 h-4 inline" /> Retry failed run</>
                  : activeRun.mode === "full_city"
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
              <Button variant="danger" size="sm" icon={Square} onClick={() => setCancelModalOpen(true)}>
                Cancel run
              </Button>
            )}
            {activeRun.status === "cancelling" && (
              <p className="text-xs text-[var(--color-warning-700)]">
                Cancelling… will stop after current chunk (~30-90s).
              </p>
            )}
            {activeRun.status === "cancelled" && cityId && (
              <Button
                variant="primary"
                size="sm"
                iconRight={ArrowRight}
                onClick={handleResumeFromN}
              >
                Resume from place {Number(activeRun.processed_count || 0) + 1}
              </Button>
            )}
            <p className="text-xs text-[var(--color-text-tertiary)] italic">
              {activeRun.mode === "retry_failed"
                ? "Retrying failed places on the server — safe to close this tab. Status updates every 5s while page is open."
                : (activeRun.mode === "full_city" || activeRun.mode === "remainder")
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
              <button
                type="button"
                onClick={() => setMode("remainder")}
                disabled={running || loading || !!activeRunId}
                aria-pressed={mode === "remainder"}
                className={[
                  "flex-1 h-9 text-sm font-medium rounded-md transition-colors duration-150",
                  mode === "remainder"
                    ? "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm cursor-pointer"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                ].join(" ")}
              >
                Remainder only
              </button>
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)]">
              {mode === "sample"
                ? "Stratified random sample. Runs in your browser — don't refresh. ~75 min for 200 places."
                : mode === "remainder"
                  ? "Only places we haven't scored yet. Runs on the server. Perfect for incremental backfills."
                  : "Every servable place in the city. Runs on the server — close the tab, come back later. Cancel anytime."}
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
          {/* ORCH-0737 + ORCH-1008 — live cost preview chip adapts to mode */}
          {!selectedCity ? (
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
              <Info className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                {mode === "sample"
                  ? `Pick a city to preview cost. Range ${SAMPLE_SIZE_MIN}-${SAMPLE_SIZE_MAX}, default ${SAMPLE_SIZE_DEFAULT}.`
                  : "Pick a city to preview cost + time."}
              </span>
            </div>
          ) : (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] font-mono mb-1.5">
                Cost preview
              </div>
              <div className="rounded-lg bg-[var(--gray-50)] border border-[var(--gray-200)] px-4 py-3">
                <div className="flex items-baseline justify-between gap-2 font-mono tabular-nums text-sm">
                  <span className="text-[var(--color-text-secondary)]">
                    {Number(effectiveCount).toLocaleString()} places × ${PER_PLACE_COST_USD.toFixed(4)}
                  </span>
                  <span
                    className={[
                      "font-semibold",
                      estCostNum > 10
                        ? "text-[var(--color-error-700)]"
                        : estCostNum > 5
                          ? "text-[var(--color-warning-700)]"
                          : "text-[var(--color-text-primary)]",
                    ].join(" ")}
                  >
                    ~${estCostUsd}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                  {estTimeStr} wall time
                  {mode === "sample" && " (browser-loop — don't refresh)"}
                  {(mode === "full_city" || mode === "remainder") && " (server-side; tab-close safe)"}
                </p>
                {mode === "remainder" && cityCoverage?.coverage && (
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                    {Number(cityCoverage.coverage.scored_count || 0).toLocaleString()} of{" "}
                    {Number(cityCoverage.coverage.servable_count || selectedCity.servable_count).toLocaleString()}{" "}
                    already scored — only the rest
                  </p>
                )}
                {mode === "remainder" && remainderCount === 0 && (
                  <p className="text-xs text-[var(--color-success-700)] mt-1">
                    Nothing to evaluate — city is fully scored.
                  </p>
                )}
              </div>
            </div>
          )}
          {!!activeRunId && (
            <p className="text-xs text-[var(--color-warning-700)]">
              Already a run in progress — wait or cancel above before starting another.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-[var(--gray-200)]">
            <span className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wide font-mono shrink-0">AI Provider</span>
            <span className="text-xs font-medium text-[var(--color-text-primary)]">Gemini 2.5 Flash</span>
            <span className="text-xs text-[var(--color-text-tertiary)]">· v4 prompt</span>
            <span className="text-[10px] text-[var(--color-text-tertiary)] italic ml-auto">
              Locked sole provider. Anthropic dropped 2026-05-05 after A/B comparison.
            </span>
          </div>
        </div>

        {selectedCity && (
          <div className="border border-[var(--gray-200)] rounded-lg p-4 space-y-3 bg-[var(--color-background-primary)]">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                  City scored coverage - {selectedCity.name}
                </h4>
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  {coverageLoading
                    ? "Loading coverage..."
                    : cityCoverage
                      ? `${coverageSummary.scored_count} / ${coverageSummary.servable_count} servable places scored (${formatPercent(coverageSummary.scored_percent)})`
                      : "Coverage unavailable"}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={RotateCcw}
                onClick={handleRetryFailedPlaces}
                loading={retryingFailed}
                disabled={!canRetryFailed}
              >
                Retry failed{retryableFailedCount > 0 ? ` (${retryableFailedCount})` : ""}
              </Button>
            </div>

            {cityCoverage && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="rounded-lg bg-[var(--gray-50)] border border-[var(--gray-200)] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] font-mono">Scored</div>
                    <div className="text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
                      {coverageSummary.scored_count}
                    </div>
                  </div>
                  <div className="rounded-lg bg-[var(--gray-50)] border border-[var(--gray-200)] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] font-mono">Unscored</div>
                    <div className="text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
                      {coverageSummary.unscored_count}
                    </div>
                  </div>
                  <div className="rounded-lg bg-[var(--gray-50)] border border-[var(--gray-200)] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] font-mono">Failed</div>
                    <div className="text-sm font-semibold text-[var(--color-error-700)] tabular-nums">
                      {failedCount}
                    </div>
                  </div>
                  <div className="rounded-lg bg-[var(--gray-50)] border border-[var(--gray-200)] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] font-mono">Retryable</div>
                    <div className="text-sm font-semibold text-[var(--color-warning-700)] tabular-nums">
                      {retryableFailedCount}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col md:flex-row md:items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                  <span>
                    Latest run: {cityCoverage.latest_run
                      ? `${cityCoverage.latest_run.id.slice(0, 8)}... (${cityCoverage.latest_run.status})`
                      : "none"}
                  </span>
                  <span className="hidden md:inline text-[var(--color-text-tertiary)]">·</span>
                  <span>
                    Nonretryable failures: {nonretryableFailedCount}
                  </span>
                  <span className="hidden md:inline text-[var(--color-text-tertiary)]">·</span>
                  <span>
                    Estimated retry cost: {formatCost(cityCoverage.estimated_retry_cost_usd)}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

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

        {!loading && allRows.length === 0 && (
          <AlertCard variant="info" title="No trials yet">
            Pick a city, choose a mode, then click Run trial. Results will appear here once the run completes.
          </AlertCard>
        )}

        {/* ORCH-1008 Phase 4d — per-signal verdict distribution for the most
            recent completed run on the selected city. Hidden if <10 completed. */}
        {selectedCity && lastCompletedRunRows.length >= 10 && (
          <SignalDistributionPanel
            runId={lastCompletedRunId}
            runRows={lastCompletedRunRows}
            onOpenPlace={(placeId) => {
              if (placeId) window.location.hash = `#/placepool?id=${placeId}`;
            }}
          />
        )}

        {/* ORCH-1008 Phase 4b — status-grouped run history replaces the
            per-run flat list. */}
        {allRows.length > 0 && (
          <RunHistoryGroups
            allRows={allRows}
            onFilterByRun={(rid) => {
              // No-op for now: deep-filter would require a dedicated tab state.
              // Lineage badge in the expanded card opens to that run id for
              // future deep-filter wiring.
              addToast({ variant: "info", title: `Run ${String(rid).slice(0, 8)}…`, description: "Lineage filter not yet wired." });
            }}
            onRetryFailed={canRetryFailed ? handleRetryFailedPlaces : undefined}
            retryFailedDisabled={!canRetryFailed}
            retryableFailedCount={retryableFailedCount}
          />
        )}
      </div>

      {/* ORCH-1008 Phase 4 — confirmation modals */}
      <CancelRunConfirmModal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        onConfirm={handleCancelActiveRunConfirmed}
        cityName={activeRun?.city_name}
        processedCount={activeRun?.processed_count || 0}
        totalCount={activeRun?.total_count || 0}
        loading={cancelLoading}
      />
      <RunRemainderConfirmModal
        open={remainderModalOpen}
        onClose={() => setRemainderModalOpen(false)}
        cityId={cityId}
        cityName={selectedCity?.name}
        remainingCount={remainderCount}
        perPlaceCostUsd={PER_PLACE_COST_USD}
        onStarted={({ runId: newRunId, cityName: newCityName }) => {
          setActiveRunId(newRunId);
          setActiveRun({
            id: newRunId,
            city_name: newCityName,
            mode: "remainder",
            total_count: remainderCount,
            processed_count: 0,
            succeeded_count: 0,
            failed_count: 0,
            cost_so_far_usd: 0,
            estimated_cost_usd: estCostNum,
            status: "running",
          });
        }}
        onConcurrentRun={() => {
          /* banner is already visible; just close the modal */
        }}
      />
    </SectionCard>
  );
}

export default TrialResultsTab;
