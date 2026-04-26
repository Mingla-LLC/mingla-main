/**
 * SIGNAL LIBRARY PAGE — ORCH-0588 + ORCH-0598.11
 *
 * List active signals; pick a city; run Bouncer + Scorer for that city; preview
 * top-50 places with score + contributions breakdown; cohort serving slider.
 *
 * Per-city as of ORCH-0598.11 — no longer Raleigh-hardcoded. City list comes
 * from the `admin_city_picker_data()` RPC (sourced from `seeding_cities`).
 *
 * Weight editing is still NOT in this version — admin tunes by inserting a new
 * signal_definition_versions row directly via SQL until a future editor ships.
 */

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, ChevronRight, ChevronDown, RefreshCw, Play, AlertTriangle, Sparkles,
} from "lucide-react";
import { supabase, invokeWithRefresh } from "../lib/supabase";
import { useToast } from "../context/ToastContext";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/ui/Spinner";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatScore(s) {
  return s == null ? "—" : Number(s).toFixed(0);
}

function formatContribution(value) {
  if (typeof value === "number") {
    return value > 0 ? `+${value}` : String(value);
  }
  return String(value);
}

// ── Cohort slider ────────────────────────────────────────────────────────────

function CohortSlider({ signalId, onChange }) {
  const { showToast } = useToast();
  const [pct, setPct] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_get_signal_serving_pct", {
        p_signal_id: signalId,
      });
      if (error) throw error;
      setPct(Number(data ?? 0));
    } catch (err) {
      showToast(`Couldn't load cohort pct: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [signalId, showToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function setQuick(value) {
    if (saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("admin_set_signal_serving_pct", {
        p_signal_id: signalId,
        p_pct: value,
      });
      if (error) throw error;
      setPct(value);
      showToast(`Cohort set to ${value}% (takes effect within 60s)`, "success");
      onChange?.(value);
    } catch (err) {
      showToast(`Couldn't save cohort pct: ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[--color-text-secondary]">
        <Spinner size="sm" /> Loading cohort…
      </div>
    );
  }

  const presets = [0, 5, 25, 50, 100];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-[--color-text-secondary]">
          Cohort serving: <span className="font-mono font-semibold text-[--color-text-primary]">{pct}%</span> of users on new path
        </div>
        {saving && <Spinner size="sm" />}
      </div>
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <Button
            key={p}
            size="sm"
            variant={pct === p ? "primary" : "outline"}
            disabled={saving}
            onClick={() => setQuick(p)}
          >
            {p}%
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={refresh} disabled={saving}>
          <RefreshCw className="w-3 h-3" />
        </Button>
      </div>
      <div className="text-xs text-[--color-text-tertiary]">
        Edge fn caches for 60s — wait a minute after flipping before testing.
      </div>
    </div>
  );
}

// ── Bouncer pipeline (3 sequential steps; ORCH-0678 two-pass design) ────────
//
// Replaces the single RunBouncerButton with three explicit steps:
//   1. Pre-Photo Bouncer — runs all rules except B8 (stored photos check).
//      Writes passes_pre_photo_check column.
//   2. Photo Backfill — downloads photos for places that survived step 1.
//      Loops backfill-place-photos run_next_batch until done.
//   3. Final Bouncer — full ruleset including B8. Writes is_servable column.
//      Catches photo-download failures.
//
// All three buttons are always enabled when a city is selected. Operators
// read each button's status text to understand pipeline state. This is more
// robust than state-machine enablement because re-seed scenarios reset the
// pipeline implicitly.

function ClusterBreakdown({ data }) {
  if (!data) return null;
  return (
    <div className="text-xs text-[--color-text-tertiary] font-mono space-y-0.5">
      <div>pass={data.pass_count} · reject={data.reject_count} · written={data.written}</div>
      <div className="opacity-70">
        A={data.by_cluster?.A_COMMERCIAL?.pass}/{data.by_cluster?.A_COMMERCIAL?.reject} ·
        B={data.by_cluster?.B_CULTURAL?.pass}/{data.by_cluster?.B_CULTURAL?.reject} ·
        C={data.by_cluster?.C_NATURAL?.pass}/{data.by_cluster?.C_NATURAL?.reject} ·
        X={data.by_cluster?.EXCLUDED?.reject}
      </div>
    </div>
  );
}

function BouncerStep({ stepNum, label, edgeFn, helpText, cityId, cityName, onComplete }) {
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  async function trigger() {
    if (!cityId) {
      showToast("Pick a city first", "error");
      return;
    }
    setRunning(true);
    setLastResult(null);
    try {
      const { data, error } = await invokeWithRefresh(edgeFn, {
        body: { city_id: cityId },
      });
      if (error) throw error;
      setLastResult(data);
      showToast(
        `${label} done: ${data?.pass_count ?? 0} pass / ${data?.reject_count ?? 0} reject (${data?.duration_ms ?? 0}ms)`,
        "success",
      );
      onComplete?.(data);
    } catch (err) {
      console.error(`[${edgeFn}]`, err);
      showToast(`${label} failed: ${err.message}`, "error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border border-[--color-border] rounded p-3">
      <div className="text-xs uppercase tracking-wide text-[--color-text-tertiary]">
        Step {stepNum} — {label}
      </div>
      <p className="text-xs text-[--color-text-secondary]">{helpText}</p>
      <Button onClick={trigger} disabled={running || !cityId} size="sm">
        {running ? <Spinner size="sm" /> : <Play className="w-3 h-3" />}
        {running ? `Running ${label}…` : `Run ${label} for ${cityName || "selected city"}`}
      </Button>
      <ClusterBreakdown data={lastResult} />
    </div>
  );
}

function PhotoBackfillStep({ stepNum, label, helpText, cityId, cityName, country }) {
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  // [TRANSITIONAL] inline cancel via ref — full-featured pause/resume lives on
  // PlacePoolManagementPage. ORCH-0678 admin UI surfaces a simpler launch+monitor.
  const stopRef = useState({ stop: false })[0];

  async function trigger() {
    if (!cityId || !cityName || !country) {
      showToast("Pick a city first (need name + country)", "error");
      return;
    }
    setRunning(true);
    setProgress({ phase: "creating_run", message: "Creating photo backfill run…" });
    stopRef.stop = false;

    try {
      // Step A: create the run with mode='pre_photo_passed' (ORCH-0678).
      const { data: runData, error: runErr } = await invokeWithRefresh("backfill-place-photos", {
        body: {
          action: "create_run",
          cityId,
          city: cityName,
          country,
          mode: "pre_photo_passed",
          batchSize: 20,
        },
      });
      if (runErr) throw runErr;
      if (runData?.status === "nothing_to_do") {
        setProgress({
          phase: "done",
          message: runData.reason || "Nothing to do — no eligible places.",
          summary: { succeeded: 0, failed: 0, skipped: 0, totalBatches: 0, runId: null },
        });
        showToast(runData.reason || "Nothing to do.", "info");
        return;
      }
      if (runData?.status === "already_active") {
        setProgress({
          phase: "error",
          message: `A run is already active for this city (runId ${runData.runId}). Resolve it on the Place Pool Management page first.`,
        });
        showToast("Existing run blocks new run", "error");
        return;
      }
      const runId = runData?.runId;
      if (!runId) throw new Error("create_run returned no runId");
      setProgress({
        phase: "running",
        runId,
        totalBatches: runData.totalBatches,
        completedBatches: 0,
        succeeded: 0,
        failed: 0,
        message: `Run created. Processing ${runData.totalPlaces} places in ${runData.totalBatches} batches…`,
      });

      // Step B: loop run_next_batch until done or cancelled.
      while (!stopRef.stop) {
        const { data: batchData, error: batchErr } = await invokeWithRefresh("backfill-place-photos", {
          body: { action: "run_next_batch", runId },
        });
        if (batchErr) throw batchErr;
        if (batchData?.done) {
          setProgress({
            phase: "done",
            runId,
            message: "All batches complete.",
            summary: {
              succeeded: batchData.runProgress?.totalSucceeded ?? 0,
              failed: batchData.runProgress?.totalFailed ?? 0,
              totalBatches: batchData.runProgress?.totalBatches ?? 0,
            },
          });
          showToast(
            `Photo backfill done: ${batchData.runProgress?.totalSucceeded ?? 0} succeeded, ${batchData.runProgress?.totalFailed ?? 0} failed`,
            "success",
          );
          break;
        }
        setProgress((prev) => ({
          ...prev,
          completedBatches: batchData.runProgress?.completedBatches ?? prev.completedBatches,
          succeeded: batchData.runProgress?.totalSucceeded ?? prev.succeeded,
          failed: batchData.runProgress?.totalFailed ?? prev.failed,
          totalBatches: batchData.runProgress?.totalBatches ?? prev.totalBatches,
          message: `Batch ${batchData.batchIndex + 1} of ${batchData.runProgress?.totalBatches ?? "?"}: ${batchData.runProgress?.totalSucceeded ?? 0} succeeded so far`,
        }));
      }
      if (stopRef.stop) {
        setProgress((prev) => ({ ...prev, phase: "cancelled", message: "Cancelled by operator." }));
        showToast("Photo backfill cancelled", "info");
      }
    } catch (err) {
      console.error("[backfill-place-photos]", err);
      setProgress({ phase: "error", message: err?.message || "Photo backfill failed" });
      showToast(`Photo backfill failed: ${err.message}`, "error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border border-[--color-border] rounded p-3">
      <div className="text-xs uppercase tracking-wide text-[--color-text-tertiary]">
        Step {stepNum} — {label}
      </div>
      <p className="text-xs text-[--color-text-secondary]">{helpText}</p>
      <div className="flex gap-2">
        <Button onClick={trigger} disabled={running || !cityId} size="sm">
          {running ? <Spinner size="sm" /> : <Play className="w-3 h-3" />}
          {running ? `Backfilling ${cityName || "city"}…` : `Run ${label} for ${cityName || "selected city"}`}
        </Button>
        {running && (
          <Button onClick={() => { stopRef.stop = true; }} size="sm" variant="outline">
            Cancel
          </Button>
        )}
      </div>
      {progress && (
        <div className="text-xs text-[--color-text-tertiary] font-mono space-y-0.5">
          <div>{progress.message}</div>
          {progress.phase === "running" && progress.totalBatches != null && (
            <div className="opacity-70">
              batch {progress.completedBatches}/{progress.totalBatches} · succeeded={progress.succeeded} · failed={progress.failed}
            </div>
          )}
          {progress.phase === "done" && progress.summary && (
            <div className="opacity-70">
              succeeded={progress.summary.succeeded} · failed={progress.summary.failed} · batches={progress.summary.totalBatches}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BouncerPipelineButtons({ cityId, cityName, country, onComplete }) {
  return (
    <div className="flex flex-col gap-3">
      <BouncerStep
        stepNum={1}
        label="Pre-Photo Bouncer"
        edgeFn="run-pre-photo-bouncer"
        helpText="Weeds out places lacking websites, hours, valid types, or google photo metadata. Run this FIRST after seeding — sets passes_pre_photo_check on every active place."
        cityId={cityId}
        cityName={cityName}
      />
      <PhotoBackfillStep
        stepNum={2}
        label="Photo Backfill"
        helpText={`Downloads photos from Google for places that survived Step 1. Cost ≈ $0.035 per place (~75% cheaper than running this without Step 1 first).`}
        cityId={cityId}
        cityName={cityName}
        country={country}
      />
      <BouncerStep
        stepNum={3}
        label="Final Bouncer"
        edgeFn="run-bouncer"
        helpText="Full ruleset including stored-photo check. Sets is_servable. Catches photo-download failures from Step 2."
        cityId={cityId}
        cityName={cityName}
        onComplete={onComplete}
      />
    </div>
  );
}

// ── Run-scorer trigger ───────────────────────────────────────────────────────

function RunScorerButton({ cityId, cityName, signalId, onComplete }) {
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  async function trigger() {
    if (!cityId) {
      showToast("Pick a city first", "error");
      return;
    }
    setRunning(true);
    setLastResult(null);
    try {
      const { data, error } = await invokeWithRefresh("run-signal-scorer", {
        body: { signal_id: signalId, city_id: cityId },
      });
      if (error) throw error;
      setLastResult(data);
      showToast(
        `Scorer done: ${data?.scored_count ?? 0} scored, ${data?.ineligible_count ?? 0} ineligible (${data?.duration_ms ?? 0}ms)`,
        "success",
      );
      onComplete?.(data);
    } catch (err) {
      console.error("[RunScorerButton]", err);
      showToast(`Scorer failed: ${err.message}`, "error");
    } finally {
      setRunning(false);
    }
  }

  const label = cityName || "selected city";

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={trigger} disabled={running || !cityId} size="sm">
        {running ? <Spinner size="sm" /> : <Play className="w-3 h-3" />}
        {running ? `Scoring ${label}…` : `Run scorer for ${label}`}
      </Button>
      {lastResult && (
        <div className="text-xs text-[--color-text-tertiary] font-mono">
          Last: scored={lastResult.scored_count} · ineligible={lastResult.ineligible_count} ·
          dist={JSON.stringify(lastResult.score_distribution ?? {})}
        </div>
      )}
    </div>
  );
}

// ── City Pipeline History — every seeded city at a glance ────────────────────
//
// ORCH-0633: table showing each city's progress through seed → refresh →
// AI-validate → Bouncer → Score → Photos. Admin clicks a city row to pick it
// as the active city below. Color-coded bars make "what still needs work"
// obvious at a glance.

function stageStatus(done, total) {
  if (!total || total === 0) return { pct: 0, tone: 'gray', label: '0' };
  const pct = Math.round((done / total) * 100);
  let tone = 'red';
  if (pct >= 95) tone = 'green';
  else if (pct >= 50) tone = 'yellow';
  else if (pct > 0) tone = 'orange';
  return { pct, tone, label: `${done.toLocaleString()} / ${total.toLocaleString()} (${pct}%)` };
}

function StageCell({ done, total }) {
  const s = stageStatus(done, total);
  const bg = {
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    orange: 'bg-orange-500',
    red: 'bg-red-500',
    gray: 'bg-gray-300',
  }[s.tone];
  return (
    <div className="flex flex-col gap-1 min-w-[110px]">
      <div className="h-2 bg-[--color-border] rounded overflow-hidden">
        <div className={`h-full ${bg} transition-all`} style={{ width: `${s.pct}%` }} />
      </div>
      <div className="text-[10px] font-mono text-[--color-text-tertiary]">{s.label}</div>
    </div>
  );
}

function formatRelative(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

function CityPipelineHistory({ selectedCityId, onPickCity }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_city_pipeline_status');
      if (rpcErr) throw rpcErr;
      setRows(data ?? []);
    } catch (err) {
      console.error('[CityPipelineHistory]', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[--color-text-secondary]">
        <Spinner size="sm" /> Loading pipeline history…
      </div>
    );
  }
  if (error) {
    return (
      <AlertCard kind="warning" icon={AlertTriangle} title="Couldn't load pipeline history">
        {error}. If this is the first load after pulling the ORCH-0633 migration,
        run <code>supabase db push</code> to apply <code>admin_city_pipeline_status</code>.
      </AlertCard>
    );
  }
  if (rows.length === 0) {
    return <div className="text-sm text-[--color-text-secondary]">No seeded cities yet.</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-[--color-text-secondary]">
          {rows.length} cities · click a row to select it below
        </div>
        <Button size="sm" variant="outline" onClick={refresh}>
          <RefreshCw className="w-3 h-3" />
          Refresh
        </Button>
      </div>

      <div className="overflow-x-auto border border-[--color-border] rounded">
        <table className="min-w-full text-xs">
          <thead className="bg-[--color-background-secondary]">
            <tr className="text-left">
              <th className="px-3 py-2 font-semibold">City</th>
              <th className="px-3 py-2 font-semibold">Total</th>
              <th className="px-3 py-2 font-semibold">Refreshed</th>
              <th className="px-3 py-2 font-semibold">Bouncer-judged</th>
              <th className="px-3 py-2 font-semibold">Bouncer-passed</th>
              <th className="px-3 py-2 font-semibold">Photos</th>
              <th className="px-3 py-2 font-semibold">Scored</th>
              <th className="px-3 py-2 font-semibold">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSelected = r.city_id === selectedCityId;
              const lastActivity = [r.last_place_update, r.last_refresh, r.last_bouncer_run, r.last_ai_run]
                .filter(Boolean)
                .map((s) => new Date(s).getTime())
                .sort((a, b) => b - a)[0];
              return (
                <tr
                  key={r.city_id}
                  className={`border-t border-[--color-border] cursor-pointer hover:bg-[--color-background-secondary] ${isSelected ? 'bg-[--color-background-secondary]' : ''}`}
                  onClick={() => onPickCity?.(r.city_id)}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {isSelected && <Badge variant="success">active</Badge>}
                      <div>
                        <div className="font-medium">{r.city_name}</div>
                        <div className="text-[10px] text-[--color-text-tertiary]">{r.country_code || r.country_name || ''} · {r.city_status || '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono">{Number(r.total_active ?? 0).toLocaleString()}</td>
                  <td className="px-3 py-2"><StageCell done={Number(r.refreshed_count ?? 0)} total={Number(r.total_active ?? 0)} /></td>
                  <td className="px-3 py-2"><StageCell done={Number(r.bouncer_judged_count ?? 0)} total={Number(r.total_active ?? 0)} /></td>
                  <td className="px-3 py-2"><StageCell done={Number(r.is_servable_count ?? 0)} total={Number(r.total_active ?? 0)} /></td>
                  <td className="px-3 py-2"><StageCell done={Number(r.has_real_photos_count ?? 0)} total={Number(r.total_active ?? 0)} /></td>
                  <td className="px-3 py-2"><StageCell done={Number(r.scored_count ?? 0)} total={Number(r.is_servable_count ?? 0)} /></td>
                  <td className="px-3 py-2 text-[--color-text-secondary]">{formatRelative(lastActivity ? new Date(lastActivity) : null)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-[10px] text-[--color-text-tertiary] leading-relaxed">
        <strong>Reading the columns:</strong>{' '}
        <span className="text-green-600">green</span> = 95%+ done ·{' '}
        <span className="text-yellow-600">yellow</span> = 50-94% ·{' '}
        <span className="text-orange-600">orange</span> = 1-49% ·{' '}
        <span className="text-red-600">red</span> = 0% ·{' '}
        <span className="text-gray-500">gray</span> = no data.{' '}
        <strong>Scored</strong> is measured against Bouncer-passed (not total) — only servable places need scoring.
      </div>
    </div>
  );
}

// ── Score-all-signals (whole city, one click) ────────────────────────────────
//
// ORCH-0631 UX fix: running the Bouncer for a city is one click, but scoring
// all 15 signals required 15 separate clicks. This button loops through every
// active signal sequentially and calls run-signal-scorer for each. Shows
// per-signal progress + a final summary so the admin can see what landed.

function ScoreAllSignalsButton({ cityId, cityName, signals, onComplete }) {
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, label: "" });
  const [summary, setSummary] = useState(null);

  async function trigger() {
    if (!cityId) {
      showToast("Pick a city first", "error");
      return;
    }
    if (!signals || signals.length === 0) {
      showToast("No signals loaded", "error");
      return;
    }
    const confirmed = window.confirm(
      `Score ALL ${signals.length} signals for ${cityName}?\n\nThis runs the scorer for each signal sequentially. Takes ~${signals.length * 2}s.`
    );
    if (!confirmed) return;

    setRunning(true);
    setSummary(null);
    const results = [];

    try {
      for (let i = 0; i < signals.length; i++) {
        const sig = signals[i];
        setProgress({ current: i + 1, total: signals.length, label: sig.label });

        try {
          const { data, error } = await invokeWithRefresh("run-signal-scorer", {
            body: { signal_id: sig.id, city_id: cityId },
          });
          if (error) throw error;
          results.push({
            signal_id: sig.id,
            label: sig.label,
            ok: true,
            scored: data?.scored_count ?? 0,
            ineligible: data?.ineligible_count ?? 0,
          });
        } catch (err) {
          console.error(`[ScoreAllSignalsButton] ${sig.id} failed:`, err);
          results.push({
            signal_id: sig.id,
            label: sig.label,
            ok: false,
            error: err.message,
          });
        }
      }

      const okCount = results.filter((r) => r.ok).length;
      const totalScored = results.reduce((acc, r) => acc + (r.scored ?? 0), 0);
      setSummary({ results, okCount, totalScored });

      if (okCount === signals.length) {
        showToast(
          `All ${signals.length} signals scored for ${cityName} · ${totalScored.toLocaleString()} total score rows`,
          "success"
        );
      } else {
        showToast(
          `${okCount}/${signals.length} signals scored — see details below`,
          "warning"
        );
      }
      onComplete?.(results);
    } finally {
      setRunning(false);
      setProgress({ current: 0, total: 0, label: "" });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        onClick={trigger}
        disabled={running || !cityId || !signals?.length}
        variant="primary"
      >
        {running ? <Spinner size="sm" /> : <Sparkles className="w-4 h-4" />}
        {running
          ? `Scoring signal ${progress.current}/${progress.total}: ${progress.label}…`
          : `Score ALL ${signals?.length ?? 0} signals for ${cityName || "selected city"}`}
      </Button>

      {running && progress.total > 0 && (
        <div className="w-full bg-[--color-border] rounded h-2 overflow-hidden">
          <div
            className="bg-[--color-accent-primary] h-full transition-all duration-300"
            style={{ width: `${(progress.current / progress.total) * 100}%` }}
          />
        </div>
      )}

      {summary && (
        <div className="border border-[--color-border] rounded p-3 text-xs">
          <div className="font-semibold mb-2">
            {summary.okCount}/{summary.results.length} signals scored · {summary.totalScored.toLocaleString()} total score rows
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1 font-mono">
            {summary.results.map((r) => (
              <div
                key={r.signal_id}
                className={r.ok ? "text-[--color-text-secondary]" : "text-[--color-red]"}
              >
                {r.ok ? "✓" : "✗"} {r.label}: {r.ok ? `${r.scored} scored, ${r.ineligible} ineligible` : r.error}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Top-50 places preview ────────────────────────────────────────────────────

function TopPlacesPreview({ cityId, cityName, signalId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(new Set());

  const refresh = useCallback(async () => {
    if (!cityId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from("place_scores")
        .select(`
          score,
          contributions,
          place_pool!inner (
            id, name, primary_type, rating, review_count, price_level,
            is_servable, city_id
          )
        `)
        .eq("signal_id", signalId)
        .eq("place_pool.city_id", cityId)
        .eq("place_pool.is_servable", true)
        .order("score", { ascending: false })
        .limit(50);
      if (queryError) throw queryError;
      setRows(data ?? []);
    } catch (err) {
      console.error("[TopPlacesPreview]", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [cityId, signalId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-[--color-text-secondary]">
        <Spinner /> Loading top 50…
      </div>
    );
  }

  if (error) {
    return (
      <AlertCard kind="error" icon={AlertTriangle} title="Couldn't load preview">
        {error}
      </AlertCard>
    );
  }

  if (rows.length === 0) {
    const cityLabel = cityName || "the selected city";
    return (
      <AlertCard kind="info" title="No scores yet">
        Run the Bouncer (above) for {cityLabel}, then click{" "}
        <strong>Run scorer for {cityLabel}</strong> to populate <code>place_scores</code>.
      </AlertCard>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-[--color-text-secondary]">
          Top {rows.length} {cityName || ""} places by <code>{signalId}</code> score
        </div>
        <Button size="sm" variant="ghost" onClick={refresh}>
          <RefreshCw className="w-3 h-3" />
        </Button>
      </div>
      <div className="space-y-1">
        {rows.map((row, idx) => {
          const place = row.place_pool;
          const isOpen = expanded.has(place.id);
          const contribs = row.contributions || {};
          return (
            <div
              key={place.id}
              className="rounded border border-[--color-border] bg-[--color-background-primary]"
            >
              <button
                type="button"
                onClick={() => toggle(place.id)}
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-[--color-background-secondary]"
              >
                <span className="text-xs font-mono text-[--color-text-tertiary] w-6">
                  #{idx + 1}
                </span>
                <span className="font-mono text-sm font-bold w-12 text-right">
                  {formatScore(row.score)}
                </span>
                <span className="flex-1 text-sm font-medium">{place.name}</span>
                <Badge variant="default">{place.primary_type}</Badge>
                <span className="text-xs text-[--color-text-tertiary]">
                  {place.rating != null ? `★ ${place.rating}` : ""}
                  {place.review_count != null ? ` · ${place.review_count.toLocaleString()}` : ""}
                </span>
                {isOpen ? (
                  <ChevronDown className="w-4 h-4 text-[--color-text-tertiary]" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-[--color-text-tertiary]" />
                )}
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden border-t border-[--color-border]"
                  >
                    <div className="p-3 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs font-mono">
                      {Object.entries(contribs).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between gap-2">
                          <span className="text-[--color-text-tertiary] truncate">{k}</span>
                          <span
                            className={
                              typeof v === "number" && v < 0
                                ? "text-red-500 font-semibold"
                                : typeof v === "number" && v > 0
                                  ? "text-green-600 font-semibold"
                                  : ""
                            }
                          >
                            {formatContribution(v)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function SignalLibraryPage() {
  const { showToast } = useToast();
  const [signals, setSignals] = useState([]);
  const [activeSignalId, setActiveSignalId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [previewKey, setPreviewKey] = useState(0); // bump to force preview refetch

  // ORCH-0598.11: per-city control. City list from admin_city_picker_data RPC.
  const [cities, setCities] = useState([]);
  const [citiesLoading, setCitiesLoading] = useState(true);
  const [citiesError, setCitiesError] = useState(null);
  const [selectedCityId, setSelectedCityId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: queryError } = await supabase
          .from("signal_definitions")
          .select("id, label, kind, is_active, current_version_id, updated_at")
          .order("created_at", { ascending: true });
        if (queryError) throw queryError;
        if (cancelled) return;
        setSignals(data ?? []);
        if ((data ?? []).length > 0 && activeSignalId == null) {
          setActiveSignalId(data[0].id);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSignalId]);

  // ORCH-0598.11 + ORCH-0646: load city list. Default to highest is_servable_places city
  // (typically Raleigh today) so an admin opening the page sees something.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCitiesLoading(true);
      setCitiesError(null);
      try {
        const { data, error: rpcError } = await supabase.rpc("admin_city_picker_data");
        if (rpcError) throw rpcError;
        if (cancelled) return;
        const sorted = (data ?? []).slice().sort(
          (a, b) => Number(b.is_servable_places ?? 0) - Number(a.is_servable_places ?? 0),
        );
        setCities(sorted);
        if (sorted.length > 0 && selectedCityId == null) {
          setSelectedCityId(sorted[0].city_id);
        }
      } catch (err) {
        console.error("[SignalLibraryPage] city list error:", err);
        if (!cancelled) {
          setCitiesError(err.message);
          showToast(`Couldn't load city list: ${err.message}`, "error");
        }
      } finally {
        if (!cancelled) setCitiesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCityId, showToast]);

  if (loading) {
    return (
      <div className="py-16 flex items-center justify-center">
        <Spinner /> <span className="ml-2 text-sm text-[--color-text-secondary]">Loading signals…</span>
      </div>
    );
  }

  if (error) {
    return (
      <AlertCard kind="error" icon={AlertTriangle} title="Couldn't load signal_definitions">
        {error}
      </AlertCard>
    );
  }

  if (signals.length === 0) {
    return (
      <div className="py-12">
        <AlertCard kind="info" icon={Sparkles} title="No signals defined yet">
          Add via the <code>signal_definitions</code> table. Slice 1 seeded only{" "}
          <code>fine_dining</code> — Slices 2-13 will add the rest.
        </AlertCard>
      </div>
    );
  }

  const active = signals.find((s) => s.id === activeSignalId) ?? signals[0];
  const selectedCity = cities.find((c) => c.city_id === selectedCityId) ?? null;
  const selectedCityName = selectedCity?.city_name ?? null;

  return (
    <div className="py-6 flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-[--color-accent]" />
          <div>
            <h1 className="text-2xl font-bold">Signal Library</h1>
            <p className="text-sm text-[--color-text-secondary]">
              Per-city Bouncer + signal scoring. Pick a city, run Bouncer, then run scorer for each signal.
            </p>
          </div>
        </div>
      </header>

      {/* ORCH-0598.11: city picker */}
      <SectionCard
        title="City"
        description="Select which city the Bouncer and Scorer will run against. Cities come from the seeding_cities table."
      >
        <div className="flex flex-col gap-4">
          {/* ORCH-0633: Pipeline history table — every seeded city at a glance */}
          <div>
            <div className="text-xs uppercase tracking-wide text-[--color-text-tertiary] mb-2">
              Pipeline history — all cities
            </div>
            <CityPipelineHistory
              selectedCityId={selectedCityId}
              onPickCity={(id) => setSelectedCityId(id)}
            />
          </div>

          <div className="border-t border-[--color-border]" />

          <div className="text-xs uppercase tracking-wide text-[--color-text-tertiary]">
            Or pick a city from dropdown
          </div>
          {citiesLoading && (
            <div className="flex items-center gap-2 text-sm text-[--color-text-secondary]">
              <Spinner size="sm" /> Loading cities…
            </div>
          )}
          {citiesError && (
            <AlertCard kind="error" icon={AlertTriangle} title="Couldn't load cities">
              {citiesError}
            </AlertCard>
          )}
          {!citiesLoading && !citiesError && cities.length === 0 && (
            <AlertCard kind="info" title="No seeded cities yet">
              Seed a city via the Place Pool Management page first.
            </AlertCard>
          )}
          {!citiesLoading && !citiesError && cities.length > 0 && (
            <select
              className="w-full md:w-2/3 p-2 rounded border border-[--color-border] bg-[--color-background-primary] text-sm"
              value={selectedCityId ?? ""}
              onChange={(e) => setSelectedCityId(e.target.value || null)}
              aria-label="Select city for Bouncer and Scorer"
            >
              {cities.map((c) => (
                <option key={c.city_id} value={c.city_id}>
                  {c.city_name}, {c.country_name}
                  {" — "}
                  {Number(c.is_servable_places ?? 0).toLocaleString()} servable /{" "}
                  {Number(c.total_active_places ?? 0).toLocaleString()} active
                  {c.city_status ? ` · ${c.city_status}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      </SectionCard>

      {/* Global: Bouncer pipeline — ORCH-0678 two-pass design.
          Three sequential steps: Pre-Photo Bouncer → Photo Backfill → Final Bouncer.
          All three buttons always-enabled when a city is picked; operators read
          per-step status text to understand pipeline state. */}
      <SectionCard
        title={`Bouncer pipeline (${selectedCityName ?? "select a city"})`}
        description="Two-pass deterministic gate with photo download in between. Run all three steps in order BEFORE scoring any signal. Step 1 → Step 2 → Step 3. Re-run after place_pool refreshes."
      >
        <BouncerPipelineButtons
          cityId={selectedCityId}
          cityName={selectedCityName}
          country={selectedCity?.country_name ?? null}
          onComplete={() => setPreviewKey((k) => k + 1)}
        />
      </SectionCard>

      {/* ORCH-0631: Score-all-signals shortcut — one click runs the scorer for every signal */}
      <SectionCard
        title={`Score all signals (${selectedCityName ?? "select a city"})`}
        description="Runs the scorer for every active signal sequentially. Use this after Bouncer. Per-signal scorer below is for re-running a single signal in isolation."
      >
        <div className="border border-[--color-border] rounded p-4">
          <ScoreAllSignalsButton
            cityId={selectedCityId}
            cityName={selectedCityName}
            signals={signals}
            onComplete={() => setPreviewKey((k) => k + 1)}
          />
        </div>
      </SectionCard>

      {/* Signal selector */}
      <div className="flex flex-wrap gap-2">
        {signals.map((s) => (
          <Button
            key={s.id}
            size="sm"
            variant={s.id === active.id ? "primary" : "outline"}
            onClick={() => setActiveSignalId(s.id)}
          >
            {s.label}
            <Badge variant={s.is_active ? "success" : "default"}>{s.kind}</Badge>
          </Button>
        ))}
      </div>

      {/* Active signal panel */}
      <SectionCard
        title={active.label}
        description={`Signal ID: ${active.id} · Kind: ${active.kind}`}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="border border-[--color-border] rounded p-4">
            <div className="text-xs uppercase tracking-wide text-[--color-text-tertiary] mb-2">
              Cohort rollout
            </div>
            <CohortSlider signalId={active.id} />
          </div>
          <div className="border border-[--color-border] rounded p-4">
            <div className="text-xs uppercase tracking-wide text-[--color-text-tertiary] mb-2">
              Score {selectedCityName ?? "selected city"}
            </div>
            <RunScorerButton
              cityId={selectedCityId}
              cityName={selectedCityName}
              signalId={active.id}
              onComplete={() => setPreviewKey((k) => k + 1)}
            />
          </div>
        </div>

        <TopPlacesPreview
          key={`${active.id}-${selectedCityId}-${previewKey}`}
          cityId={selectedCityId}
          cityName={selectedCityName}
          signalId={active.id}
        />
      </SectionCard>
    </div>
  );
}

export default SignalLibraryPage;
