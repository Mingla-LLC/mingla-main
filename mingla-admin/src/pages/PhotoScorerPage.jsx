/**
 * PHOTO SCORER PAGE — ORCH-0708 Phase 1
 *
 * Operator-facing trigger for the score-place-photo-aesthetics edge function.
 * Per-city: preview eligible places, see estimated cost, run the scorer with
 * live progress (batch-by-batch), cancel/pause/resume, surface failures.
 *
 * Spec: §4 (edge function actions). Lives next to Photo Labeling under
 * Quality Gates in the sidebar.
 */

import { useEffect, useState, useCallback } from "react";
import { Sparkles, Play, RefreshCw, Pause, Square, AlertTriangle, CheckCircle, DollarSign } from "lucide-react";
import { supabase, invokeWithRefresh } from "../lib/supabase";
import { extractFunctionError } from "../lib/edgeFunctionError";
import { useToast } from "../context/ToastContext";
import { SectionCard, AlertCard, StatCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/ui/Spinner";
import { Toggle } from "../components/ui/Input";

const FIXTURE_CITIES = ["Raleigh", "Cary", "Durham"];
const POLL_INTERVAL_MS = 1500;

function formatCost(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `$${Number(n).toFixed(4)}`;
}

function formatPct(num, denom) {
  if (!denom) return "0%";
  return `${Math.round((num / denom) * 100)}%`;
}

// ── City scorer card ────────────────────────────────────────────────────────

function CityScorerCard({ city }) {
  const { addToast } = useToast();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [forceRescore, setForceRescore] = useState(false);
  const [useBatchApi, setUseBatchApi] = useState(false);

  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState(null);
  const [runProgress, setRunProgress] = useState(null);
  const [batches, setBatches] = useState([]);
  const stopRef = useState({ stop: false })[0];

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const { data, error } = await invokeWithRefresh("score-place-photo-aesthetics", {
        body: {
          action: "preview_run",
          scope_type: "city",
          city,
          force_rescore: forceRescore,
          use_batch_api: useBatchApi,
        },
      });
      if (error) {
        const msg = await extractFunctionError(error, "Preview failed");
        throw new Error(msg);
      }
      setPreview(data);
    } catch (err) {
      console.error(`[PhotoScorerPage:${city}] preview failed:`, err);
      addToast({ variant: "error", title: `${city} preview failed`, description: err.message });
    } finally {
      setPreviewLoading(false);
    }
  }, [city, forceRescore, useBatchApi, addToast]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  // Check for an active run on mount + when city changes
  const checkActiveRun = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("photo_aesthetic_runs")
        .select("id, status, total_places, total_batches, completed_batches, total_succeeded, total_failed, total_skipped, actual_cost_usd, estimated_cost_usd")
        .eq("city", city)
        .in("status", ["ready", "running", "paused"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        setRunId(data.id);
        setRunProgress(data);
      }
    } catch (err) {
      // Non-blocking — just log
      console.error(`[PhotoScorerPage:${city}] active-run check failed:`, err);
    }
  }, [city]);

  useEffect(() => {
    checkActiveRun();
  }, [checkActiveRun]);

  async function startRun() {
    setRunning(true);
    stopRef.stop = false;

    try {
      const { data: created, error: createErr } = await invokeWithRefresh("score-place-photo-aesthetics", {
        body: {
          action: "create_run",
          scope_type: "city",
          city,
          force_rescore: forceRescore,
          use_batch_api: useBatchApi,
          batch_size: 25,
        },
      });
      if (createErr) {
        const msg = await extractFunctionError(createErr, "Couldn't create run");
        throw new Error(msg);
      }
      if (created?.status === "nothing_to_do") {
        addToast({ variant: "info", title: `${city}: nothing to do`, description: created.reason });
        setRunning(false);
        return;
      }
      if (created?.status === "already_active") {
        addToast({ variant: "warning", title: `${city}: run already active`, description: `Run ${created.runId}` });
        setRunId(created.runId);
        await checkActiveRun();
        await loopRun(created.runId);
        return;
      }
      const newRunId = created?.runId;
      if (!newRunId) throw new Error("create_run returned no runId");

      addToast({
        variant: "info",
        title: `${city} run started`,
        description: `${created.totalPlaces} places, ${created.totalBatches} batches, est ${formatCost(created.estimatedCostUsd)}`,
      });
      setRunId(newRunId);
      await loopRun(newRunId);
    } catch (err) {
      console.error(`[PhotoScorerPage:${city}] start failed:`, err);
      addToast({ variant: "error", title: `${city} start failed`, description: err.message });
      setRunning(false);
    }
  }

  async function loopRun(currentRunId) {
    // Loop run_next_batch until done or cancelled
    while (!stopRef.stop) {
      let result;
      try {
        const { data, error } = await invokeWithRefresh("score-place-photo-aesthetics", {
          body: { action: "run_next_batch", run_id: currentRunId },
        });
        if (error) {
          const msg = await extractFunctionError(error, "Batch failed");
          throw new Error(msg);
        }
        result = data;
      } catch (err) {
        console.error(`[PhotoScorerPage:${city}] batch loop error:`, err);
        addToast({ variant: "error", title: `${city} batch failed`, description: err.message });
        break;
      }

      if (result?.runProgress) setRunProgress(result.runProgress);
      await refreshBatches(currentRunId);

      if (result?.done) {
        addToast({
          variant: "success",
          title: `${city} run complete`,
          description: `${result.runProgress?.total_succeeded ?? 0} succeeded, ${result.runProgress?.total_failed ?? 0} failed, cost ${formatCost(result.runProgress?.actual_cost_usd)}`,
        });
        setRunning(false);
        return;
      }

      // Brief pause between batches to avoid hammering Anthropic
      await new Promise((r) => setTimeout(r, 200));
    }
    setRunning(false);
  }

  async function refreshBatches(currentRunId) {
    try {
      const { data } = await supabase
        .from("photo_aesthetic_batches")
        .select("id, batch_index, status, succeeded, failed, skipped, cost_usd, error_message, place_count")
        .eq("run_id", currentRunId)
        .order("batch_index");
      if (data) setBatches(data);
    } catch (err) {
      console.error(`[PhotoScorerPage:${city}] batch refresh failed:`, err);
    }
  }

  async function cancelRun() {
    if (!runId) return;
    stopRef.stop = true;
    try {
      const { error } = await invokeWithRefresh("score-place-photo-aesthetics", {
        body: { action: "cancel_run", run_id: runId },
      });
      if (error) throw error;
      addToast({ variant: "info", title: `${city} cancelled` });
      await checkActiveRun();
      await refreshBatches(runId);
    } catch (err) {
      console.error(`[PhotoScorerPage:${city}] cancel failed:`, err);
      addToast({ variant: "error", title: `${city} cancel failed`, description: err.message || String(err) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <SectionCard
      title={city}
      action={
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={loadPreview} disabled={previewLoading || running}>
          Refresh preview
        </Button>
      }
    >
      <div className="space-y-4">
        {previewLoading && !preview && (
          <div className="flex items-center justify-center py-6">
            <Spinner size="md" />
          </div>
        )}

        {preview && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="bg-[var(--gray-50)] rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] font-mono mb-1">Eligible</div>
                <div className="text-xl font-mono font-semibold text-[var(--color-text-primary)]">{preview.totalPlaces}</div>
              </div>
              <div className="bg-[var(--gray-50)] rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] font-mono mb-1">Skipped (already scored)</div>
                <div className="text-xl font-mono font-semibold text-[var(--color-text-primary)]">{preview.skipped}</div>
              </div>
              <div className="bg-[var(--gray-50)] rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] font-mono mb-1">Batches</div>
                <div className="text-xl font-mono font-semibold text-[var(--color-text-primary)]">{preview.totalBatches}</div>
              </div>
              <div className="bg-[var(--gray-50)] rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] font-mono mb-1">Est. cost</div>
                <div className="text-xl font-mono font-semibold text-[var(--color-success-700)]">{formatCost(preview.estimatedCostUsd)}</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm">
              <Toggle
                label="Force re-score (overwrite existing)"
                checked={forceRescore}
                onChange={setForceRescore}
                disabled={running}
              />
              <Toggle
                label="Use Batch API (50% cheaper, slower)"
                checked={useBatchApi}
                onChange={setUseBatchApi}
                disabled={running}
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                icon={running ? null : Play}
                onClick={startRun}
                loading={running}
                disabled={running || preview.totalPlaces === 0}
              >
                {running ? "Running…" : `Run scorer for ${city}`}
              </Button>
              {running && runId && (
                <Button variant="danger" icon={Square} onClick={cancelRun}>
                  Cancel
                </Button>
              )}
            </div>
          </>
        )}

        {runProgress && (
          <div className="border-t border-[var(--gray-200)] pt-4">
            <div className="flex items-baseline justify-between mb-2">
              <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Current run</h4>
              <span className="text-xs text-[var(--color-text-tertiary)] font-mono">status: {runProgress.status}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs font-mono">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Batches</div>
                <div className="text-[var(--color-text-primary)]">{runProgress.completed_batches} / {runProgress.total_batches} ({formatPct(runProgress.completed_batches, runProgress.total_batches)})</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Succeeded</div>
                <div className="text-[var(--color-success-700)]">{runProgress.total_succeeded}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Failed</div>
                <div className="text-[var(--color-error-700)]">{runProgress.total_failed}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Skipped</div>
                <div className="text-[var(--color-text-secondary)]">{runProgress.total_skipped}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)]">Cost so far</div>
                <div className="text-[var(--color-success-700)]">{formatCost(runProgress.actual_cost_usd)}</div>
              </div>
            </div>

            {batches.length > 0 && (
              <details className="mt-3">
                <summary className="text-xs text-[var(--color-text-secondary)] cursor-pointer hover:text-[var(--color-text-primary)]">
                  Per-batch breakdown ({batches.length})
                </summary>
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto pr-1">
                  {batches.map((b) => (
                    <div key={b.id} className="flex items-baseline justify-between gap-2 text-[11px] font-mono px-2 py-1 rounded bg-[var(--gray-50)]">
                      <span className="text-[var(--color-text-tertiary)]">#{b.batch_index}</span>
                      <span
                        className={[
                          "px-1.5 py-0.5 rounded text-[10px] uppercase",
                          b.status === "completed" && "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
                          b.status === "running" && "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
                          b.status === "failed" && "bg-[var(--color-error-50)] text-[var(--color-error-700)]",
                          b.status === "pending" && "bg-[var(--gray-100)] text-[var(--color-text-tertiary)]",
                          b.status === "skipped" && "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
                        ].filter(Boolean).join(" ")}
                      >
                        {b.status}
                      </span>
                      <span className="text-[var(--color-text-secondary)] truncate flex-1">
                        {b.place_count} places · ✓{b.succeeded} ✗{b.failed} ⊘{b.skipped} · {formatCost(b.cost_usd)}
                      </span>
                      {b.error_message && (
                        <span className="text-[var(--color-error-700)] truncate text-[10px]" title={b.error_message}>
                          {b.error_message}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export function PhotoScorerPage() {
  return (
    <div className="max-w-[var(--content-max-width)] mx-auto px-6 py-6 space-y-6">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-[var(--color-brand-500)]" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
            Photo Aesthetic Scorer
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            Run Claude Haiku 4.5 vision against the place_pool to populate
            <code className="mx-1 px-1 py-0.5 rounded bg-[var(--gray-100)] text-[var(--color-text-primary)] text-xs">photo_aesthetic_data</code>.
            Idempotent — re-running skips places whose photos haven't changed.
          </p>
        </div>
      </div>

      <AlertCard variant="info" title="What this does">
        Each place gets one Claude vision call against its top 5 photos. Output is
        sanitized against the canonical enum set, fingerprinted by photo URLs (so
        photo rotation triggers automatic re-score), and persisted to
        <code className="mx-1 px-1 py-0.5 rounded bg-[var(--gray-100)] text-[var(--color-text-primary)] text-xs">place_pool.photo_aesthetic_data</code>.
        Once at least one fixture is scored, the Photo Labeling → Compare with Claude
        tab activates with per-fixture PASS/FAIL diffs.
      </AlertCard>

      <div className="grid grid-cols-1 gap-4">
        {FIXTURE_CITIES.map((city) => (
          <CityScorerCard key={city} city={city} />
        ))}
      </div>
    </div>
  );
}

export default PhotoScorerPage;
