// ORCH-0553 — Refresh pipeline UI (parallel to SeedTab).
// Spec: outputs/SPEC_ORCH-0553_REFRESH_PIPELINE.md §4.2 + §7
//
// Mirrors SeedTab UX shell but for the place_pool refresh pipeline.
// All edge fn calls go through invokeWithRefresh (per ORCH-0541) to survive
// stale sessions.
//
// CRITICAL — auto-run pitfall (per investigation §9 discovery #5):
//   The runAll() loop deliberately does NOT call onRefresh() between iterations.
//   onRefresh() bumps parent refreshKey, which key={refreshKey} remounts
//   RefreshTab, killing the loop mid-flight. onRefresh() fires ONCE after the
//   loop completes. Test T-22 catches regression here.

import { useState, useEffect, useRef, useMemo } from "react";
import {
  RefreshCw, AlertTriangle, Loader, Play, Zap, XCircle, CheckCircle, Clock,
} from "lucide-react";
import { supabase, invokeWithRefresh } from "../../lib/supabase";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui/Button";
import { SectionCard, StatCard } from "../ui/Card";
import { Input } from "../ui/Input";
import { Badge } from "../ui/Badge";
import { CATEGORY_LABELS, CATEGORY_COLORS, ALL_CATEGORIES } from "../../constants/categories";
import { HARD_CAP_USD, formatCost } from "../../lib/seedingFormat";
import { CostPreviewCard } from "./CostPreviewCard";
import { BatchProgressRow } from "./BatchProgressRow";

const UNCATEGORIZED = "(uncategorized)";
const DEFAULT_STALE_DAYS = 30;
const DEFAULT_BATCH_SIZE = 50;

export function RefreshTab({ city, cities: _cities, onRefresh, onRefreshChange, flagEnabled }) {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Filter state (setup phase)
  const [filterCategories, setFilterCategories] = useState(null); // null = all
  const [filterStaleDaysStr, setFilterStaleDaysStr] = useState(String(DEFAULT_STALE_DAYS));
  const [filterIncludeFailed, setFilterIncludeFailed] = useState(false);
  const [batchSizeStr, setBatchSizeStr] = useState(String(DEFAULT_BATCH_SIZE));
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Pool health (from admin_pool_stats_overview.refresh_health)
  const [poolHealth, setPoolHealth] = useState(null);

  // History (last 20 runs for this city)
  const [history, setHistory] = useState([]);

  // Run state
  const [activeRun, setActiveRun] = useState(null);
  const [batches, setBatches] = useState([]);
  const [creating, setCreating] = useState(false);
  const [runningBatch, setRunningBatch] = useState(false);
  const [retryingBatchId, setRetryingBatchId] = useState(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const stopAutoRef = useRef(false);

  // Hydrate active run on city change
  useEffect(() => {
    if (!city) {
      setActiveRun(null);
      setBatches([]);
      setPoolHealth(null);
      setHistory([]);
      return;
    }
    let cancelled = false;

    (async () => {
      // Active run check
      const { data: runs } = await supabase
        .from("refresh_runs")
        .select("*")
        .eq("city_id", city.id)
        .in("status", ["preparing", "ready", "running", "paused"])
        .order("created_at", { ascending: false })
        .limit(1);

      if (cancelled) return;

      if (runs && runs.length > 0) {
        const run = runs[0];
        setActiveRun(run);
        onRefreshChange?.(true);
        if (run.status !== "preparing") {
          const { data: batchData } = await supabase
            .from("refresh_batches")
            .select("*")
            .eq("run_id", run.id)
            .order("batch_index");
          if (!cancelled) setBatches(batchData || []);
        }
      } else {
        setActiveRun(null);
        setBatches([]);
        onRefreshChange?.(false);
      }

      // Pool health (admin_pool_stats_overview RPC)
      try {
        const { data: stats } = await supabase.rpc("admin_pool_stats_overview");
        if (!cancelled && stats?.refresh_health) {
          setPoolHealth(stats.refresh_health);
        }
      } catch (err) {
        console.warn("[RefreshTab] pool health load failed:", err?.message);
      }

      // Run history
      try {
        const { data, error } = await invokeWithRefresh("admin-refresh-places", {
          body: { action: "refresh_run_history", cityId: city.id, limit: 20 },
        });
        if (error) throw new Error(error.message || "history failed");
        if (data?.error) throw new Error(data.error);
        if (!cancelled) setHistory(data?.runs || []);
      } catch (err) {
        if (!cancelled) {
          console.warn("[RefreshTab] history load failed:", err?.message);
          setHistory([]);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [city]);

  // Filter helpers
  const toggleCategory = (id) => {
    setFilterCategories((prev) => {
      if (prev === null) {
        // First click: switch from "all" to a single-category filter
        return [id];
      }
      if (prev.includes(id)) {
        const next = prev.filter((c) => c !== id);
        return next.length === 0 ? null : next;
      }
      return [...prev, id];
    });
  };
  const clearCategoryFilter = () => setFilterCategories(null);

  // Compute parsed filter values for invoke body
  const parsedFilters = useMemo(() => {
    const staleDays = filterStaleDaysStr.trim() === "" ? null : Number(filterStaleDaysStr);
    const batchSize = batchSizeStr.trim() === "" ? DEFAULT_BATCH_SIZE : Number(batchSizeStr);
    return {
      filterCategories,
      filterStaleDays: Number.isFinite(staleDays) && staleDays > 0 ? staleDays : null,
      filterIncludeFailed,
      batchSize: Number.isFinite(batchSize) && batchSize >= 10 && batchSize <= 200 ? batchSize : DEFAULT_BATCH_SIZE,
    };
  }, [filterCategories, filterStaleDaysStr, filterIncludeFailed, batchSizeStr]);

  // Live cost preview when filters change (only when no active run)
  useEffect(() => {
    if (!city || activeRun) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);

    const t = setTimeout(async () => {
      try {
        const { data, error } = await invokeWithRefresh("admin-refresh-places", {
          body: {
            action: "preview_refresh_cost",
            cityId: city.id,
            ...parsedFilters,
          },
        });
        if (error) throw new Error(error.message || "Preview failed");
        if (data?.error) throw new Error(data.error);
        if (!cancelled) setPreview(data);
      } catch (err) {
        if (!cancelled) {
          setPreview(null);
          console.warn("[RefreshTab] preview failed:", err?.message);
        }
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    }, 300); // small debounce on rapid filter changes

    return () => { cancelled = true; clearTimeout(t); };
  }, [city, activeRun, parsedFilters]);

  // ── Run Actions ──

  const refreshHistory = async () => {
    if (!city) return;
    try {
      const { data, error } = await invokeWithRefresh("admin-refresh-places", {
        body: { action: "refresh_run_history", cityId: city.id, limit: 20 },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (mountedRef.current) setHistory(data?.runs || []);
    } catch (err) {
      console.warn("[RefreshTab] history reload failed:", err?.message);
    }
  };

  const reloadRunAndBatches = async (runId) => {
    const { data: run } = await supabase.from("refresh_runs").select("*").eq("id", runId).single();
    const { data: batchData } = await supabase
      .from("refresh_batches")
      .select("*")
      .eq("run_id", runId)
      .order("batch_index");
    if (mountedRef.current) {
      setActiveRun(run);
      setBatches(batchData || []);
    }
  };

  const createRun = async () => {
    if (!city || creating) return;

    setCreating(true);
    try {
      const { data, error } = await invokeWithRefresh("admin-refresh-places", {
        body: {
          action: "create_refresh_run",
          cityId: city.id,
          ...parsedFilters,
        },
      });
      if (error) throw new Error(error.message || "Failed to prepare run");
      if (data?.error) throw new Error(data.error);

      addToast({
        variant: "success",
        title: "Batches prepared",
        description: `${data.totalBatches} batches · ${formatCost(data.estimatedCostUsd)}`,
      });

      await reloadRunAndBatches(data.runId);
      onRefreshChange?.(true);
    } catch (err) {
      addToast({ variant: "error", title: "Preparation failed", description: err.message });
    } finally {
      if (mountedRef.current) setCreating(false);
    }
  };

  const runNextBatch = async () => {
    if (!activeRun || runningBatch) return;
    setRunningBatch(true);
    try {
      const { data, error } = await invokeWithRefresh("admin-refresh-places", {
        body: { action: "run_next_refresh_batch", runId: activeRun.id },
      });
      if (error) throw new Error(error.message || "Batch execution failed");
      if (data?.error) throw new Error(data.error);

      await reloadRunAndBatches(activeRun.id);
      onRefresh();

      if (data.done) {
        addToast({ variant: "success", title: "Refresh complete", description: "All batches finished" });
        onRefreshChange?.(false);
        await refreshHistory();
      }
    } catch (err) {
      addToast({ variant: "error", title: "Batch failed", description: err.message });
      await reloadRunAndBatches(activeRun.id);
    } finally {
      if (mountedRef.current) setRunningBatch(false);
    }
  };

  const runAll = async () => {
    if (!activeRun || autoRunning || runningBatch) return;
    setAutoRunning(true);
    stopAutoRef.current = false;

    while (true) { // eslint-disable-line no-constant-condition
      if (stopAutoRef.current || !mountedRef.current) break;

      try {
        setRunningBatch(true);
        const { data, error } = await invokeWithRefresh("admin-refresh-places", {
          body: { action: "run_next_refresh_batch", runId: activeRun.id },
        });
        if (error) throw new Error(error.message || "Batch execution failed");
        if (data?.error) throw new Error(data.error);

        if (mountedRef.current) {
          // Reload from DB but DO NOT call onRefresh() — would remount us via key=refreshKey
          await reloadRunAndBatches(activeRun.id);
        }

        if (mountedRef.current) setRunningBatch(false);

        if (data.done) {
          addToast({ variant: "success", title: "Refresh complete", description: "All batches finished" });
          onRefreshChange?.(false);
          break;
        }
      } catch (err) {
        addToast({ variant: "error", title: "Batch failed — auto-run paused", description: err.message });
        if (mountedRef.current) {
          await reloadRunAndBatches(activeRun.id);
          setRunningBatch(false);
        }
        break;
      }
    }

    if (mountedRef.current) {
      setAutoRunning(false);
      setRunningBatch(false);
      onRefresh(); // ONE refresh after the loop, NOT inside it (avoids remount)
      await refreshHistory();
    }
  };

  const stopAutoRun = () => { stopAutoRef.current = true; };

  const skipBatch = async (batchId) => {
    if (!activeRun) return;
    try {
      const { data, error } = await invokeWithRefresh("admin-refresh-places", {
        body: { action: "skip_refresh_batch", runId: activeRun.id, batchId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      await reloadRunAndBatches(activeRun.id);
      onRefresh();
    } catch (err) {
      addToast({ variant: "error", title: "Skip failed", description: err.message });
    }
  };

  const cancelRun = async () => {
    if (!activeRun) return;
    if (!confirm("Cancel this refresh run? All remaining batches will be skipped.")) return;
    try {
      const { data, error } = await invokeWithRefresh("admin-refresh-places", {
        body: { action: "cancel_refresh_run", runId: activeRun.id },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      addToast({ variant: "warning", title: "Run cancelled" });
      setActiveRun(null);
      setBatches([]);
      onRefreshChange?.(false);
      onRefresh();
      await refreshHistory();
    } catch (err) {
      addToast({ variant: "error", title: "Cancel failed", description: err.message });
    }
  };

  const retryBatch = async (batchId) => {
    if (!activeRun || retryingBatchId || runningBatch) return;
    setRetryingBatchId(batchId);
    try {
      const { data, error } = await invokeWithRefresh("admin-refresh-places", {
        body: { action: "retry_refresh_batch", runId: activeRun.id, batchId },
      });
      if (error) throw new Error(error.message || "Retry failed");
      if (data?.error) throw new Error(data.error);

      const verb = data.status === "completed" ? "succeeded" : "failed again";
      addToast({
        variant: data.status === "completed" ? "success" : "warning",
        title: `Retry ${verb}`,
        description: data.status === "completed"
          ? `${data.result?.successCount ?? 0} places refreshed`
          : data.result?.error || "Check batch log for details",
      });

      await reloadRunAndBatches(activeRun.id);
      onRefresh();
    } catch (err) {
      addToast({ variant: "error", title: "Retry failed", description: err.message });
      await reloadRunAndBatches(activeRun.id);
    } finally {
      if (mountedRef.current) setRetryingBatchId(null);
    }
  };

  // ── Render branches ──

  if (!flagEnabled) {
    return (
      <div className="text-center py-16 text-[var(--color-text-secondary)]">
        <Clock className="w-8 h-8 mx-auto mb-3 text-[var(--color-text-tertiary)]" />
        <div className="text-sm font-medium">Refresh tab — coming soon</div>
        <div className="text-xs mt-1">
          Enable <code className="text-xs">enable_refresh_tab</code> in admin_config to use.
        </div>
      </div>
    );
  }

  if (!city) {
    return (
      <div className="text-center py-12 text-[var(--color-text-secondary)]">
        Select a city to refresh its pool.
      </div>
    );
  }

  // ── Derived state for batch-by-batch view ──
  const nextPendingBatch = activeRun ? batches.find((b) => b.status === "pending") : null;
  const completedBatches = batches.filter((b) => ["completed", "failed", "skipped"].includes(b.status));
  const progressPct = activeRun
    ? Math.round(((activeRun.completed_batches + activeRun.failed_batches + (activeRun.skipped_batches || 0)) / Math.max(activeRun.total_batches, 1)) * 100)
    : 0;
  const isRunDone = activeRun && ["completed", "cancelled"].includes(activeRun.status);
  const isPreparing = activeRun && activeRun.status === "preparing";
  const isReady = activeRun && activeRun.status === "ready";
  const isFailedPreparing = activeRun && activeRun.status === "failed_preparing";
  const isApprovable = activeRun && ["ready", "running", "paused"].includes(activeRun.status);
  const failedRetryable = batches.filter((b) => b.status === "failed");
  const queueDrainedWithFailures = isApprovable && !nextPendingBatch && failedRetryable.length > 0 && !isRunDone;

  return (
    <div className="space-y-6">
      {/* ── Pool Health Card (always visible) ── */}
      {poolHealth && (
        <SectionCard title="Pool Freshness" subtitle="Across all active places (city scope: see Stale on filters card)">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Active places" value={(poolHealth.total_active_places ?? 0).toLocaleString()} />
            <StatCard label="Stale > 7d" value={(poolHealth.stale_7d ?? 0).toLocaleString()} />
            <StatCard label="Stale > 30d" value={(poolHealth.stale_30d ?? 0).toLocaleString()} />
            <StatCard label="Stale + recently served" value={(poolHealth.recently_served_and_stale ?? 0).toLocaleString()} />
          </div>
        </SectionCard>
      )}

      {/* ── Phase 1: Setup (no active run) ── */}
      {!activeRun && (
        <>
          {/* Filters Card */}
          <SectionCard
            title="Filters"
            subtitle="Pick what to refresh. Empty filters = refresh ALL active places in this city."
          >
            <div className="space-y-4">
              {/* Categories */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-[var(--color-text-secondary)]">Categories</p>
                  {filterCategories !== null && (
                    <button onClick={clearCategoryFilter}
                      className="text-xs text-[var(--color-brand-600)] hover:underline cursor-pointer">
                      Clear (refresh all categories)
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {ALL_CATEGORIES.map((id) => {
                    const isAllMode = filterCategories === null;
                    const selected = isAllMode ? false : filterCategories.includes(id);
                    return (
                      <button key={id} onClick={() => toggleCategory(id)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                          selected
                            ? "text-white border-transparent"
                            : "bg-transparent border-[var(--gray-300)] text-[var(--color-text-secondary)]"
                        }`}
                        style={selected ? { backgroundColor: CATEGORY_COLORS[id] } : {}}>
                        {CATEGORY_LABELS[id]}
                      </button>
                    );
                  })}
                  {/* Uncategorized pill */}
                  <button
                    onClick={() => toggleCategory(UNCATEGORIZED)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                      filterCategories?.includes(UNCATEGORIZED)
                        ? "bg-[var(--color-text-secondary)] text-white border-transparent"
                        : "bg-transparent border-[var(--gray-300)] text-[var(--color-text-secondary)] italic"
                    }`}>
                    (uncategorized)
                  </button>
                </div>
              </div>

              {/* Stale + batch + include-failed */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-[var(--color-text-secondary)]">Stale &gt; days</label>
                  <Input
                    type="number"
                    min="1"
                    max="365"
                    value={filterStaleDaysStr}
                    onChange={(e) => setFilterStaleDaysStr(e.target.value)}
                    placeholder="Blank = no filter"
                  />
                  <p className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">
                    Default 30. Blank to refresh ALL.
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-[var(--color-text-secondary)]">Batch size</label>
                  <Input
                    type="number"
                    min="10"
                    max="200"
                    value={batchSizeStr}
                    onChange={(e) => setBatchSizeStr(e.target.value)}
                    placeholder="50"
                  />
                  <p className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">
                    Range 10-200. Default 50.
                  </p>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filterIncludeFailed}
                      onChange={(e) => setFilterIncludeFailed(e.target.checked)}
                      className="w-4 h-4 rounded border-[var(--gray-300)]"
                    />
                    <span>Include chronically failed (≥3 prior failures)</span>
                  </label>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Cost preview + Prepare button */}
          {loadingPreview && !preview && (
            <SectionCard title="Cost Preview">
              <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] py-2">
                <Loader className="w-4 h-4 animate-spin" />
                Calculating…
              </div>
            </SectionCard>
          )}
          {preview && preview.totalPlaces === 0 && (
            <SectionCard title="Cost Preview">
              <div className="rounded-lg p-4 bg-[var(--gray-50)] text-sm text-[var(--color-text-secondary)]">
                No places match your filters. Adjust the filters above.
              </div>
            </SectionCard>
          )}
          {preview && preview.totalPlaces > 0 && (
            <CostPreviewCard
              preview={preview}
              primaryAction={createRun}
              primaryLabel={creating ? "Preparing batches…" : `Prepare ${preview.totalBatches} Batches`}
              primaryLoading={creating}
              primaryDisabled={creating}
              helperText={`All batches are created first. You then approve and run each one individually. Hard cap: ${formatCost(HARD_CAP_USD)}.`}
            />
          )}

          {/* Run history */}
          {history.length > 0 && (
            <SectionCard title="Run History" subtitle={`Last ${history.length} runs`}>
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {history.map((r) => (
                  <RunHistoryRow key={r.id} run={r} />
                ))}
              </div>
            </SectionCard>
          )}
        </>
      )}

      {/* ── Phase 2: Active Run ── */}
      {activeRun && (
        <>
          {/* Preparing State */}
          {isPreparing && (
            <SectionCard title="Preparing Batches">
              <div className="flex items-center gap-3 py-4">
                <Loader className="w-5 h-5 animate-spin text-[var(--color-brand-500)]" />
                <div>
                  <div className="text-sm font-medium">Creating {activeRun.total_batches} batch records…</div>
                  <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                    {activeRun.total_places} places. All batches must be created before approval begins.
                  </div>
                </div>
              </div>
            </SectionCard>
          )}

          {/* Failed Preparing */}
          {isFailedPreparing && (
            <SectionCard title="Preparation Failed">
              <div className="rounded-lg p-4 bg-[var(--color-error-50)] border border-[var(--color-error-200)]">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-[#ef4444] shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm font-medium text-[var(--color-error-700)]">Batch creation failed</div>
                    <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                      Not all batches could be created. Dismiss this run and start over.
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <Button variant="primary" onClick={() => {
                  setActiveRun(null);
                  setBatches([]);
                  onRefreshChange?.(false);
                  onRefresh();
                }}>Dismiss and Start Over</Button>
              </div>
            </SectionCard>
          )}

          {/* Ready State */}
          {isReady && (
            <SectionCard title="Run Ready"
              subtitle={`${activeRun.total_batches} batches · ${activeRun.total_places} places · ${formatCost(activeRun.total_cost_usd === 0 ? activeRun.total_places * 0.017 : activeRun.total_cost_usd)} estimated`}
              action={
                <div className="flex items-center gap-2">
                  <Badge variant="success">ready</Badge>
                  <Button size="sm" variant="secondary" icon={XCircle} onClick={cancelRun}>Cancel Run</Button>
                </div>
              }>
              <div className="rounded-lg p-4 bg-[var(--color-success-50)] border border-[var(--color-success-200)]">
                <div className="text-sm font-medium text-[var(--color-success-700)]">
                  All {activeRun.total_batches} batches prepared and ready for approval.
                </div>
                <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                  Click "Run This Batch" below to refresh the first {activeRun.batch_size} places. Each batch takes ~13 seconds.
                </div>
              </div>
            </SectionCard>
          )}

          {/* Progress (running/paused/done) */}
          {!isPreparing && !isFailedPreparing && !isReady && (
            <SectionCard title="Refresh Run"
              subtitle={`${activeRun.total_places} places · batch size ${activeRun.batch_size}`}
              action={
                <div className="flex items-center gap-2">
                  <Badge variant={activeRun.status === "paused" ? "warning" : activeRun.status === "running" ? "info" : "success"}>
                    {activeRun.status}
                  </Badge>
                  {!isRunDone && (
                    <Button size="sm" variant="secondary" icon={XCircle} onClick={cancelRun}>Cancel Run</Button>
                  )}
                </div>
              }>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-[var(--gray-100)] rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full bg-[var(--color-brand-500)] transition-all duration-300"
                      style={{ width: `${progressPct}%` }} />
                  </div>
                  <span className="text-sm font-medium w-32 text-right">
                    {activeRun.completed_batches + activeRun.failed_batches + (activeRun.skipped_batches || 0)} / {activeRun.total_batches} ({progressPct}%)
                  </span>
                </div>

                {autoRunning && (
                  <div className="flex items-center gap-2 text-sm text-[var(--color-brand-600)]">
                    <Zap className="w-4 h-4" />
                    <span className="font-medium">Auto-running — batches execute sequentially. Stops on error.</span>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                  <div><span className="text-[var(--color-text-secondary)]">Refreshed:</span> <strong className="text-[var(--color-success-700)]">{activeRun.places_succeeded}</strong></div>
                  <div><span className="text-[var(--color-text-secondary)]">Failed:</span> <strong className="text-[var(--color-error-700)]">{activeRun.places_failed}</strong></div>
                  <div><span className="text-[var(--color-text-secondary)]">Skipped batches:</span> <strong>{activeRun.skipped_batches || 0}</strong></div>
                  <div><span className="text-[var(--color-text-secondary)]">Cost:</span> <strong>{formatCost(activeRun.total_cost_usd)}</strong></div>
                </div>
              </div>
            </SectionCard>
          )}

          {/* Next Batch controls */}
          {nextPendingBatch && isApprovable && !isRunDone && (
            <SectionCard title="Next Batch">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-sm">
                  <span className="text-[var(--color-text-secondary)]">Batch {nextPendingBatch.batch_index + 1}:</span>{" "}
                  <strong>
                    {Array.isArray(nextPendingBatch.place_ids) ? nextPendingBatch.place_ids.length : 0} places
                  </strong>
                </div>
                <div className="flex gap-2">
                  {!autoRunning && (
                    <>
                      <Button variant="primary" icon={Play} loading={runningBatch && !autoRunning} onClick={runNextBatch}
                        disabled={runningBatch || !!retryingBatchId}>
                        {runningBatch ? "Running…" : "Run This Batch"}
                      </Button>
                      <Button variant="primary" icon={Zap} onClick={runAll}
                        disabled={runningBatch || !!retryingBatchId}>
                        Run All
                      </Button>
                    </>
                  )}
                  {autoRunning && (
                    <Button variant="secondary" icon={XCircle} onClick={stopAutoRun}>
                      {runningBatch ? "Stopping after current batch…" : "Stop Auto-Run"}
                    </Button>
                  )}
                </div>
              </div>
            </SectionCard>
          )}

          {queueDrainedWithFailures && (
            <SectionCard title="Queue Complete — Failed Batches Remain">
              <div className="rounded-lg p-4 bg-[var(--color-warning-50)] border border-[var(--color-warning-200)]">
                <div className="text-sm font-medium text-[var(--color-warning-700)]">
                  All {activeRun.total_batches} batches processed, but {failedRetryable.length} failed.
                </div>
                <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                  Retry or skip failed batches in the log below. The run auto-completes once all failed batches are resolved.
                </div>
              </div>
            </SectionCard>
          )}

          {isRunDone && (
            <SectionCard title={activeRun.status === "cancelled" ? "Run Cancelled" : "Run Complete"}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mb-4">
                <div>Refreshed: <strong className="text-[var(--color-success-700)]">{activeRun.places_succeeded}</strong></div>
                <div>Failed: <strong className="text-[var(--color-error-700)]">{activeRun.places_failed}</strong></div>
                <div>Skipped batches: <strong>{activeRun.skipped_batches || 0}</strong></div>
                <div>Cost: <strong>{formatCost(activeRun.total_cost_usd)}</strong></div>
              </div>
              <div className="mt-4">
                <Button variant="primary" icon={RefreshCw} onClick={() => {
                  setActiveRun(null);
                  setBatches([]);
                  onRefreshChange?.(false);
                  onRefresh();
                }}>Start New Run</Button>
              </div>
            </SectionCard>
          )}

          {/* Batch list */}
          {batches.length > 0 && (
            <SectionCard title="Batches" subtitle={`${batches.length} total · ${completedBatches.length} processed`}>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {batches.map((b) => (
                  <BatchProgressRow
                    key={b.id}
                    batch={b}
                    kind="refresh"
                    onRetry={isApprovable && !isRunDone ? retryBatch : undefined}
                    onSkip={isApprovable && !isRunDone ? skipBatch : undefined}
                    retrying={retryingBatchId === b.id}
                  />
                ))}
              </div>
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}

// ── Run history row ────────────────────────────────────────────────────────

function RunHistoryRow({ run }) {
  const startedDate = run.created_at ? new Date(run.created_at).toLocaleString() : "—";
  const variant = run.status === "completed" ? "success"
    : run.status === "cancelled" ? "warning"
    : run.status === "failed_preparing" ? "error"
    : "info";

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-[var(--gray-200)] text-xs">
      {run.status === "completed" ? (
        <CheckCircle className="w-4 h-4 text-[var(--color-success-500)] shrink-0" />
      ) : run.status === "failed_preparing" ? (
        <AlertTriangle className="w-4 h-4 text-[var(--color-error-500)] shrink-0" />
      ) : (
        <Clock className="w-4 h-4 text-[var(--color-text-tertiary)] shrink-0" />
      )}
      <span className="text-[var(--color-text-secondary)] w-44 shrink-0">{startedDate}</span>
      <Badge variant={variant}>{run.status}</Badge>
      <span className="text-[var(--color-text-secondary)]">
        {run.total_places} places · {run.places_succeeded} ok · {run.places_failed} failed
      </span>
      <span className="text-[var(--color-text-secondary)] ml-auto">
        {formatCost(run.total_cost_usd)}
      </span>
      {run.triggered_by_email && (
        <span className="text-[var(--color-text-tertiary)] truncate max-w-[180px]" title={run.triggered_by_email}>
          by {run.triggered_by_email}
        </span>
      )}
    </div>
  );
}
