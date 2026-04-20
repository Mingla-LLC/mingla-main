// ORCH-0553 — SeedTab extracted from PlacePoolManagementPage.jsx (was inline at lines 1095-1931).
// Spec: outputs/SPEC_ORCH-0553_REFRESH_PIPELINE.md §4.1
//
// PURE RELOCATION — zero behavior change. The diff vs the inline version should be:
//   - new file with imports
//   - `function SeedTab` → `export function SeedTab`
//   - `HARD_CAP_USD` / `formatCost` / `TILE_RADIUS_OPTIONS` imported from ../../lib/seedingFormat
//   - `TYPE_TO_CATEGORY` + `guessCategory` moved into this file (they are SeedTab-only)
//
// CRITICAL — auto-run pitfall (preserved from original):
//   The runAll() loop deliberately does NOT call onRefresh() between iterations.
//   onRefresh() bumps parent refreshKey, which key={refreshKey} remounts SeedTab,
//   killing the loop mid-flight. onRefresh() fires ONCE after the loop completes.

import { useState, useEffect, useRef } from "react";
import {
  RefreshCw, AlertTriangle, Loader, Play, Zap, SkipForward, Search,
  ChevronDown, ChevronRight, CheckCircle, XCircle, RotateCcw,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui/Button";
import { SectionCard } from "../ui/Card";
import { Input } from "../ui/Input";
import { Badge } from "../ui/Badge";
import { CATEGORY_LABELS, CATEGORY_COLORS, ALL_CATEGORIES } from "../../constants/categories";
import { HARD_CAP_USD, formatCost, TILE_RADIUS_OPTIONS } from "../../lib/seedingFormat";

// ── Local: Google-type → Mingla-category mapping (used by ad-hoc search guess) ──

const TYPE_TO_CATEGORY = {
  // Nature & Views
  beach: "nature", botanical_garden: "nature", garden: "nature", hiking_area: "nature",
  national_park: "nature", nature_preserve: "nature", park: "nature", scenic_spot: "nature",
  state_park: "nature", observation_deck: "nature", tourist_attraction: "nature",
  garden_center: "nature", farm: "nature", picnic_ground: "nature",
  // Icebreakers
  book_store: "icebreakers", cafe: "icebreakers", coffee_shop: "icebreakers",
  tea_house: "icebreakers", bakery: "icebreakers", dessert_shop: "icebreakers",
  juice_shop: "icebreakers", bistro: "icebreakers", ice_cream_shop: "icebreakers",
  // Drinks & Music
  bar: "drinks_and_music", cocktail_bar: "drinks_and_music", lounge_bar: "drinks_and_music",
  wine_bar: "drinks_and_music", pub: "drinks_and_music", brewery: "drinks_and_music",
  beer_garden: "drinks_and_music", brewpub: "drinks_and_music", night_club: "drinks_and_music",
  // Brunch, Lunch & Casual
  restaurant: "brunch_lunch_casual", brunch_restaurant: "brunch_lunch_casual",
  breakfast_restaurant: "brunch_lunch_casual", diner: "brunch_lunch_casual",
  sandwich_shop: "brunch_lunch_casual", pizza_restaurant: "brunch_lunch_casual",
  hamburger_restaurant: "brunch_lunch_casual", mexican_restaurant: "brunch_lunch_casual",
  mediterranean_restaurant: "brunch_lunch_casual", thai_restaurant: "brunch_lunch_casual",
  vegetarian_restaurant: "brunch_lunch_casual",
  // Upscale & Fine Dining
  fine_dining_restaurant: "upscale_fine_dining", french_restaurant: "upscale_fine_dining",
  italian_restaurant: "upscale_fine_dining", steak_house: "upscale_fine_dining",
  seafood_restaurant: "upscale_fine_dining",
  // Movies & Theatre
  movie_theater: "movies_theatre", performing_arts_theater: "movies_theatre",
  concert_hall: "movies_theatre", opera_house: "movies_theatre",
  philharmonic_hall: "movies_theatre", amphitheatre: "movies_theatre",
  comedy_club: "movies_theatre", event_venue: "movies_theatre",
  arena: "movies_theatre", live_music_venue: "movies_theatre",
  // Creative & Arts
  art_gallery: "creative_arts", art_museum: "creative_arts", art_studio: "creative_arts",
  museum: "creative_arts", history_museum: "creative_arts", cultural_center: "creative_arts",
  cultural_landmark: "creative_arts", sculpture: "creative_arts", library: "creative_arts",
  // Play
  amusement_center: "play", bowling_alley: "play", miniature_golf_course: "play",
  go_karting_venue: "play", paintball_center: "play", video_arcade: "play",
  karaoke: "play", amusement_park: "play", ice_skating_rink: "play", indoor_playground: "play",
  // Flowers
  florist: "flowers",
  // Groceries
  grocery_store: "groceries", supermarket: "groceries",
};

function guessCategory(place) {
  // Try primaryType first (most specific)
  if (place.primaryType && TYPE_TO_CATEGORY[place.primaryType]) return TYPE_TO_CATEGORY[place.primaryType];
  // Then try types array
  for (const t of (place.types || [])) {
    if (TYPE_TO_CATEGORY[t]) return TYPE_TO_CATEGORY[t];
  }
  return null;
}

// ── SeedTab component ──────────────────────────────────────────────────────

export function SeedTab({ city, tiles, onRefresh, onDeleteCity, onSeedingChange }) {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Tile radius state (for ORCH-0333 — change tile radius on seeded city)
  const [selectedRadius, setSelectedRadius] = useState(String(city?.tile_radius_m || 1500));
  const [regenerating, setRegenerating] = useState(false);

  // Sync selectedRadius when city changes
  useEffect(() => {
    if (city?.tile_radius_m) setSelectedRadius(String(city.tile_radius_m));
  }, [city?.tile_radius_m]);

  // Setup state (before run starts)
  const [selectedCats, setSelectedCats] = useState(new Set(ALL_CATEGORIES));
  const [preview, setPreview] = useState(null);
  const [coverage, setCoverage] = useState(null);

  // Run state (batch-by-batch execution)
  const [activeRun, setActiveRun] = useState(null);       // seeding_runs row
  const [batches, setBatches] = useState([]);              // all seeding_batches for run
  const [runningBatch, setRunningBatch] = useState(false); // currently executing a batch
  const [creating, setCreating] = useState(false);         // creating run
  const [retryingBatchId, setRetryingBatchId] = useState(null); // batch being retried
  const [autoRunning, setAutoRunning] = useState(false);   // "Run All" mode
  const stopAutoRef = useRef(false);                        // signal to stop auto-run

  // Ad-hoc search
  const [adHocOpen, setAdHocOpen] = useState(false);
  const [adHocQuery, setAdHocQuery] = useState("");
  const [adHocResults, setAdHocResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [adHocCategories, setAdHocCategories] = useState({});

  // Hydrate: check for active run on city change
  useEffect(() => {
    if (!city) { setActiveRun(null); setBatches([]); setCoverage(null); return; }
    let cancelled = false;

    (async () => {
      // Check for active run (includes preparing and ready states)
      const { data: runs } = await supabase
        .from("seeding_runs")
        .select("*")
        .eq("city_id", city.id)
        .in("status", ["preparing", "ready", "running", "paused"])
        .order("created_at", { ascending: false })
        .limit(1);

      if (cancelled) return;

      if (runs && runs.length > 0) {
        const run = runs[0];
        setActiveRun(run);
        onSeedingChange?.(true);
        // Load batches (skip if still preparing — no batches yet)
        if (run.status !== "preparing") {
          const { data: batchData } = await supabase
            .from("seeding_batches")
            .select("*")
            .eq("run_id", run.id)
            .order("batch_index");
          if (!cancelled) setBatches(batchData || []);
        }
      } else {
        setActiveRun(null);
        setBatches([]);
        onSeedingChange?.(false);
      }

      // Fetch coverage
      const { data: cov } = await supabase.functions.invoke("admin-seed-places", {
        body: { action: "coverage_check", cityId: city.id },
      });
      if (!cancelled && cov) setCoverage(cov);
    })();

    return () => { cancelled = true; };
  }, [city]);

  const toggleCat = (id) => {
    setSelectedCats((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectOnlyGaps = () => {
    if (!coverage?.coverage) return;
    const gaps = new Set(coverage.coverage.filter((c) => c.hasGap).map((c) => c.categoryId));
    setSelectedCats(gaps.size > 0 ? gaps : new Set(ALL_CATEGORIES));
  };

  // Preview cost (only when no active run)
  useEffect(() => {
    if (!city || activeRun) return;
    const cats = Array.from(selectedCats);
    if (cats.length === 0) { setPreview(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.functions.invoke("admin-seed-places", {
        body: { action: "preview_cost", cityId: city.id, categories: cats },
      });
      if (!cancelled && data) setPreview(data);
    })();
    return () => { cancelled = true; };
  }, [city, selectedCats, activeRun]);

  // ── Run Actions ──

  const createRun = async () => {
    if (!city || creating) return;
    const cats = Array.from(selectedCats);
    if (cats.length === 0) return;

    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-seed-places", {
        body: { action: "create_run", cityId: city.id, categories: cats },
      });
      if (error) throw new Error(error.message || "Failed to prepare run");
      if (data?.error) throw new Error(data.error);

      addToast({ variant: "success", title: "Batches prepared", description: `${data.totalBatches} batches ready for approval` });

      // Hydrate the new run (now in 'ready' status)
      const { data: run } = await supabase
        .from("seeding_runs").select("*").eq("id", data.runId).single();
      const { data: batchData } = await supabase
        .from("seeding_batches").select("*").eq("run_id", data.runId).order("batch_index");

      if (mountedRef.current) {
        setActiveRun(run);
        setBatches(batchData || []);
        onSeedingChange?.(true);
      }
    } catch (err) {
      addToast({ variant: "error", title: "Preparation failed", description: err.message });
    } finally {
      setCreating(false);
    }
  };

  const runNextBatch = async () => {
    if (!activeRun || runningBatch) return;
    setRunningBatch(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-seed-places", {
        body: { action: "run_next_batch", runId: activeRun.id },
      });
      if (error) throw new Error(error.message || "Batch execution failed");
      if (data?.error) throw new Error(data.error);

      // Update local state
      if (mountedRef.current) {
        // Refresh batches from DB for accuracy
        const { data: batchData } = await supabase
          .from("seeding_batches").select("*").eq("run_id", activeRun.id).order("batch_index");
        setBatches(batchData || []);

        // Refresh run
        const { data: runData } = await supabase
          .from("seeding_runs").select("*").eq("id", activeRun.id).single();
        setActiveRun(runData);

        // Refresh parent data (stats, places, etc.) after every batch
        onRefresh();

        if (data.done) {
          addToast({ variant: "success", title: "Seeding complete", description: "All batches finished" });
          onSeedingChange?.(false);
        }
      }
    } catch (err) {
      addToast({ variant: "error", title: "Batch failed", description: err.message });
      // Refresh state anyway to show the failure
      const { data: batchData } = await supabase
        .from("seeding_batches").select("*").eq("run_id", activeRun.id).order("batch_index");
      if (mountedRef.current) setBatches(batchData || []);
      const { data: runData } = await supabase
        .from("seeding_runs").select("*").eq("id", activeRun.id).single();
      if (mountedRef.current) setActiveRun(runData);
    } finally {
      if (mountedRef.current) setRunningBatch(false);
    }
  };

  const runAll = async () => {
    if (!activeRun || autoRunning || runningBatch) return;
    setAutoRunning(true);
    stopAutoRef.current = false;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (stopAutoRef.current || !mountedRef.current) break;

      try {
        setRunningBatch(true);
        const { data, error } = await supabase.functions.invoke("admin-seed-places", {
          body: { action: "run_next_batch", runId: activeRun.id },
        });
        if (error) throw new Error(error.message || "Batch execution failed");
        if (data?.error) throw new Error(data.error);

        if (mountedRef.current) {
          const { data: batchData } = await supabase
            .from("seeding_batches").select("*").eq("run_id", activeRun.id).order("batch_index");
          setBatches(batchData || []);
          const { data: runData } = await supabase
            .from("seeding_runs").select("*").eq("id", activeRun.id).single();
          setActiveRun(runData);
          // NOTE: do NOT call onRefresh() here — it increments refreshKey which
          // remounts SeedTab via key={refreshKey}, killing this loop. Refresh
          // only after the loop completes.
        }

        if (mountedRef.current) setRunningBatch(false);

        if (data.done) {
          addToast({ variant: "success", title: "Seeding complete", description: "All batches finished" });
          onSeedingChange?.(false);
          break;
        }
      } catch (err) {
        // On error, stop auto-run and let user decide (retry/skip/continue)
        addToast({ variant: "error", title: "Batch failed — auto-run paused", description: err.message });
        if (mountedRef.current) {
          const { data: batchData } = await supabase
            .from("seeding_batches").select("*").eq("run_id", activeRun.id).order("batch_index");
          setBatches(batchData || []);
          const { data: runData } = await supabase
            .from("seeding_runs").select("*").eq("id", activeRun.id).single();
          setActiveRun(runData);
          setRunningBatch(false);
        }
        break;
      }
    }

    if (mountedRef.current) {
      setAutoRunning(false);
      setRunningBatch(false);
      onRefresh(); // Refresh AFTER loop completes — safe to remount now
    }
  };

  const stopAutoRun = () => {
    stopAutoRef.current = true;
  };

  const skipBatch = async (batchId) => {
    if (!activeRun) return;
    try {
      const { data, error } = await supabase.functions.invoke("admin-seed-places", {
        body: { action: "skip_batch", runId: activeRun.id, batchId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      // Refresh
      const { data: batchData } = await supabase
        .from("seeding_batches").select("*").eq("run_id", activeRun.id).order("batch_index");
      if (mountedRef.current) setBatches(batchData || []);
      const { data: runData } = await supabase
        .from("seeding_runs").select("*").eq("id", activeRun.id).single();
      if (mountedRef.current) setActiveRun(runData);
      onRefresh();
    } catch (err) {
      addToast({ variant: "error", title: "Skip failed", description: err.message });
    }
  };

  const cancelRun = async () => {
    if (!activeRun) return;
    if (!confirm("Cancel this run? All remaining batches will be skipped.")) return;
    try {
      const { data, error } = await supabase.functions.invoke("admin-seed-places", {
        body: { action: "cancel_run", runId: activeRun.id },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      addToast({ variant: "warning", title: "Run cancelled" });
      setActiveRun(null);
      setBatches([]);
      onSeedingChange?.(false);
      onRefresh();
    } catch (err) {
      addToast({ variant: "error", title: "Cancel failed", description: err.message });
    }
  };

  const retryBatch = async (batchId) => {
    if (!activeRun || retryingBatchId || runningBatch) return;
    setRetryingBatchId(batchId);
    try {
      const { data, error } = await supabase.functions.invoke("admin-seed-places", {
        body: { action: "retry_batch", runId: activeRun.id, batchId },
      });
      if (error) throw new Error(error.message || "Retry failed");
      if (data?.error) throw new Error(data.error);

      const verb = data.status === "completed" ? "succeeded" : "failed again";
      addToast({
        variant: data.status === "completed" ? "success" : "warning",
        title: `Retry ${verb}`,
        description: data.status === "completed"
          ? `${data.result?.newInserted || 0} new places from retried batch`
          : data.result?.error || "Check batch log for details",
      });

      // Refresh from DB
      if (mountedRef.current) {
        const { data: batchData } = await supabase
          .from("seeding_batches").select("*").eq("run_id", activeRun.id).order("batch_index");
        setBatches(batchData || []);
        const { data: runData } = await supabase
          .from("seeding_runs").select("*").eq("id", activeRun.id).single();
        setActiveRun(runData);
        onRefresh();
      }
    } catch (err) {
      addToast({ variant: "error", title: "Retry failed", description: err.message });
      // Refresh state anyway
      const { data: batchData } = await supabase
        .from("seeding_batches").select("*").eq("run_id", activeRun.id).order("batch_index");
      if (mountedRef.current) setBatches(batchData || []);
      const { data: runData } = await supabase
        .from("seeding_runs").select("*").eq("id", activeRun.id).single();
      if (mountedRef.current) setActiveRun(runData);
      onRefresh();
    } finally {
      if (mountedRef.current) setRetryingBatchId(null);
    }
  };

  // ── Ad-Hoc Search ──

  const handleAdHocSearch = async () => {
    if (!adHocQuery.trim()) return;
    setSearching(true);
    try {
      const { data } = await supabase.functions.invoke("admin-place-search", {
        body: {
          action: "search",
          textQuery: adHocQuery,
          ...(city && {
            lat: city.center_lat,
            lng: city.center_lng,
            radius: city.bbox_sw_lat && city.bbox_ne_lat
              ? Math.round(Math.sqrt(
                  Math.pow((city.bbox_ne_lat - city.bbox_sw_lat) * 111320, 2) +
                  Math.pow((city.bbox_ne_lng - city.bbox_sw_lng) * 111320 * Math.cos((city.center_lat * Math.PI) / 180), 2)
                ) / 2)
              : (city.coverage_radius_km || 10) * 1000,
          }),
        },
      });
      const places = data?.places || [];
      setAdHocResults(places);
      const cats = {};
      places.forEach((p, i) => { cats[i] = guessCategory(p); });
      setAdHocCategories(cats);
    } catch { setAdHocResults([]); setAdHocCategories({}); }
    finally { setSearching(false); }
  };

  const pushToPool = async (places, category) => {
    const { error } = await supabase.functions.invoke("admin-place-search", {
      body: { action: "push", places, seedingCategory: category || null, cityId: city?.id || null },
    });
    if (error) addToast({ variant: "error", title: "Push failed" });
    else { addToast({ variant: "success", title: `Pushed ${places.length} place(s)` }); onRefresh(); }
  };

  if (!city) return <div className="text-center py-12 text-[var(--color-text-secondary)]">Select a city to begin seeding.</div>;

  // ── Derived state for batch-by-batch view ──
  const nextPendingBatch = activeRun ? batches.find((b) => b.status === "pending") : null;
  const completedBatches = batches.filter((b) => ["completed", "failed", "skipped"].includes(b.status));
  const progressPct = activeRun ? Math.round(((activeRun.completed_batches + activeRun.failed_batches + (activeRun.skipped_batches || 0)) / activeRun.total_batches) * 100) : 0;
  const isRunDone = activeRun && ["completed", "cancelled"].includes(activeRun.status);
  const isPreparing = activeRun && activeRun.status === "preparing";
  const isReady = activeRun && activeRun.status === "ready";
  const isFailedPreparing = activeRun && activeRun.status === "failed_preparing";
  const isApprovable = activeRun && ["ready", "running", "paused"].includes(activeRun.status);
  const failedRetryable = batches.filter((b) => b.status === "failed");
  const queueDrainedWithFailures = isApprovable && !nextPendingBatch && failedRetryable.length > 0 && !isRunDone;

  return (
    <div className="space-y-6">
      {/* Tile Summary + Radius Picker */}
      <SectionCard title="Tile Grid" subtitle={`${tiles.length} tiles${city.bbox_sw_lat ? ' in bounding box' : ''}`}
        action={<div className="flex gap-2">
          <Button size="sm" icon={RefreshCw} variant="secondary" loading={regenerating} onClick={async () => {
            setRegenerating(true);
            try {
              const radiusNum = parseInt(selectedRadius);
              // Update radius if changed, then regenerate
              if (radiusNum !== city.tile_radius_m) {
                const { error: updateErr } = await supabase.from("seeding_cities").update({
                  tile_radius_m: radiusNum,
                  updated_at: new Date().toISOString(),
                }).eq("id", city.id);
                if (updateErr) throw updateErr;
              }
              const { data: result, error: tileErr } = await supabase.functions.invoke("admin-seed-places", {
                body: { action: "generate_tiles", cityId: city.id },
              });
              if (tileErr) throw tileErr;
              if (result?.error) throw new Error(result.error);
              addToast({ variant: "success", title: `Regenerated ${result?.tileCount || 0} tiles at ${radiusNum}m` });
              onRefresh();
            } catch (err) {
              addToast({ variant: "error", title: "Regenerate failed", description: err.message });
            } finally {
              if (mountedRef.current) setRegenerating(false);
            }
          }} disabled={!!activeRun || regenerating}>
            Regenerate
          </Button>
        </div>}>
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-text-secondary)]">
            {city.bbox_sw_lat && city.bbox_ne_lat
              ? `Bbox: ${((city.bbox_ne_lat - city.bbox_sw_lat) * 111.32).toFixed(1)}km × ${((city.bbox_ne_lng - city.bbox_sw_lng) * 111.32 * Math.cos((city.center_lat * Math.PI) / 180)).toFixed(1)}km`
              : `Coverage: ${city.coverage_radius_km}km radius`
            } · Spacing: {Math.round(parseInt(selectedRadius) * 1.4)}m
          </p>
          {/* Tile radius picker (ORCH-0333) */}
          {!activeRun && (
            <div>
              <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-2">Tile Radius</p>
              <div className="flex gap-2">
                {TILE_RADIUS_OPTIONS.map((opt) => {
                  const active = selectedRadius === opt.value;
                  return (
                    <button key={opt.value} onClick={() => setSelectedRadius(opt.value)}
                      className={[
                        "flex-1 rounded-lg border p-2 text-left transition-all cursor-pointer",
                        active
                          ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] ring-1 ring-[var(--color-brand-500)]"
                          : "border-[var(--gray-200)] hover:border-[var(--gray-300)]",
                      ].join(" ")}
                    >
                      <p className={`text-sm font-semibold ${active ? "text-[var(--color-brand-700)]" : "text-[var(--color-text-primary)]"}`}>{opt.label}</p>
                      <p className="text-xs text-[var(--color-text-tertiary)]">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
              {parseInt(selectedRadius) !== city.tile_radius_m && (
                <p className="text-xs text-[var(--color-brand-600)] mt-1.5">
                  Radius changed from {city.tile_radius_m}m → {selectedRadius}m. Click Regenerate to apply.
                </p>
              )}
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── Phase 1: Setup (no active run) ── */}
      {!activeRun && (
        <>
          {/* Category Pills with Coverage */}
          <SectionCard title="Categories"
            subtitle={coverage ? `${coverage.categoriesWithGaps} of 13 categories have gaps (<10 places)` : null}
            action={coverage?.categoriesWithGaps > 0 && (
              <Button size="sm" variant="secondary" icon={AlertTriangle} onClick={selectOnlyGaps}>
                Select Only Gaps
              </Button>
            )}>
            <div className="flex flex-wrap gap-2">
              {ALL_CATEGORIES.map((id) => {
                const catCoverage = coverage?.coverage?.find((c) => c.categoryId === id);
                const count = catCoverage?.placeCount ?? null;
                const hasGap = catCoverage?.hasGap;
                return (
                  <button key={id} onClick={() => toggleCat(id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                      selectedCats.has(id)
                        ? "text-white border-transparent"
                        : "bg-transparent border-[var(--gray-300)] text-[var(--color-text-secondary)]"
                    }`}
                    style={{
                      ...(selectedCats.has(id) ? { backgroundColor: CATEGORY_COLORS[id] } : {}),
                      ...(hasGap && !selectedCats.has(id) ? { borderColor: "#ef4444", borderWidth: 2 } : {}),
                    }}>
                    {CATEGORY_LABELS[id]}
                    {count !== null && (
                      <span className={`ml-1.5 inline-flex items-center justify-center min-w-[20px] px-1 py-0 rounded-full text-[10px] font-bold ${
                        selectedCats.has(id)
                          ? "bg-white/25 text-white"
                          : hasGap
                            ? "bg-[#fef2f2] text-[#ef4444]"
                            : "bg-[#f0fdf4] text-[#22c55e]"
                      }`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </SectionCard>

          {/* Cost Preview + Start */}
          {preview && (
            <SectionCard title="Cost Preview">
              <div className={`rounded-lg p-4 ${preview.exceedsHardCap ? "bg-[var(--color-error-50)] border border-[#ef4444]" : "bg-[var(--color-success-50)]"}`}>
                <div className="grid grid-cols-4 gap-4 text-sm">
                  <div><span className="text-[var(--color-text-secondary)]">Tiles:</span> {preview.tileCount}</div>
                  <div><span className="text-[var(--color-text-secondary)]">Categories:</span> {preview.categoryCount}</div>
                  <div><span className="text-[var(--color-text-secondary)]">API Calls:</span> {preview.totalApiCalls}</div>
                  <div className="font-semibold">Total: {formatCost(preview.estimatedTotalCost)}</div>
                </div>
                {preview.exceedsHardCap && (
                  <p className="mt-2 text-sm font-medium text-[#ef4444]">
                    <AlertTriangle className="inline w-4 h-4 mr-1" />
                    Exceeds ${HARD_CAP_USD} per-city cap. Reduce tiles, radius, or categories.
                  </p>
                )}
              </div>
              <div className="mt-4">
                <Button variant="primary" icon={Play} loading={creating} onClick={createRun}
                  disabled={selectedCats.size === 0 || creating || preview.exceedsHardCap}>
                  {creating ? "Preparing batches..." : `Prepare ${preview.totalApiCalls} Batches`}
                </Button>
                <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                  All batches are created first. You then approve and run each one individually.
                </p>
              </div>
            </SectionCard>
          )}
        </>
      )}

      {/* ── Phase 2: Active Run (preparing / ready / running / paused / done) ── */}
      {activeRun && (
        <>
          {/* Preparing State */}
          {isPreparing && (
            <SectionCard title="Preparing Batches">
              <div className="flex items-center gap-3 py-4">
                <Loader className="w-5 h-5 animate-spin text-[var(--color-brand-500)]" />
                <div>
                  <div className="text-sm font-medium">Creating {activeRun.total_batches} batch records...</div>
                  <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                    {activeRun.total_tiles} tiles × {activeRun.selected_categories?.length || 0} categories. Batches must all be created before approval begins.
                  </div>
                </div>
              </div>
            </SectionCard>
          )}

          {/* Failed Preparing State */}
          {isFailedPreparing && (
            <SectionCard title="Preparation Failed">
              <div className="rounded-lg p-4 bg-[var(--color-error-50)] border border-[var(--color-error-200)]">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-[#ef4444] shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm font-medium text-[var(--color-error-700)]">Batch creation failed</div>
                    <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                      Not all batches could be created. This run cannot be used for approval. Dismiss it and try again.
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <Button variant="primary" onClick={() => {
                  setActiveRun(null);
                  setBatches([]);
                  onSeedingChange?.(false);
                  onRefresh();
                }}>Dismiss and Start Over</Button>
              </div>
            </SectionCard>
          )}

          {/* Ready State — show clear "ready for approval" banner */}
          {isReady && (
            <SectionCard title="Run Ready"
              subtitle={`${activeRun.total_batches} batches prepared · ${activeRun.selected_categories?.length || 0} categories · ${activeRun.total_tiles} tiles`}
              action={
                <div className="flex items-center gap-2">
                  <Badge variant="success">ready</Badge>
                  <Button size="sm" variant="secondary" icon={XCircle} onClick={cancelRun}>Cancel Run</Button>
                </div>
              }>
              <div className="rounded-lg p-4 bg-[var(--color-success-50)] border border-[var(--color-success-200)]">
                <div className="text-sm font-medium text-[var(--color-success-700)]">
                  All {activeRun.total_batches} batches are prepared and ready for approval.
                </div>
                <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                  Click "Run This Batch" below to execute the first batch. Each batch runs one Google API call for one tile × category combination.
                </div>
              </div>
            </SectionCard>
          )}

          {/* Progress Bar (only once execution has started or run is done) */}
          {!isPreparing && !isFailedPreparing && !isReady && (
            <SectionCard title="Seeding Run"
              subtitle={`${activeRun.selected_categories?.length || 0} categories · ${activeRun.total_tiles} tiles`}
              action={
                <div className="flex items-center gap-2">
                  <Badge variant={activeRun.status === "paused" ? "warning" : activeRun.status === "running" ? "info" : "success"}>
                    {activeRun.status}
                  </Badge>
                  {!isRunDone && (
                    <Button size="sm" variant="secondary" icon={XCircle} onClick={cancelRun}>
                      Cancel Run
                    </Button>
                  )}
                </div>
              }>
              {/* Progress bar */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-[var(--gray-100)] rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full bg-[var(--color-brand-500)] transition-all duration-300"
                      style={{ width: `${progressPct}%` }} />
                  </div>
                  <span className="text-sm font-medium w-28 text-right">
                    {activeRun.completed_batches + activeRun.failed_batches + (activeRun.skipped_batches || 0)} / {activeRun.total_batches} ({progressPct}%)
                  </span>
                </div>

                {/* Auto-run indicator */}
                {autoRunning && (
                  <div className="flex items-center gap-2 text-sm text-[var(--color-brand-600)]">
                    <Zap className="w-4 h-4" />
                    <span className="font-medium">Auto-running — batches execute sequentially. Stops on error.</span>
                  </div>
                )}

                {/* Running totals */}
                <div className="grid grid-cols-4 gap-4 text-sm">
                  <div><span className="text-[var(--color-text-secondary)]">New places:</span> <strong className="text-[var(--color-success-700)]">{activeRun.total_places_new}</strong></div>
                  <div><span className="text-[var(--color-text-secondary)]">Duplicates:</span> <strong>{activeRun.total_places_duped}</strong></div>
                  <div><span className="text-[var(--color-text-secondary)]">Failed:</span> <strong className="text-[var(--color-error-700)]">{activeRun.failed_batches}</strong></div>
                  <div><span className="text-[var(--color-text-secondary)]">Cost:</span> <strong>{formatCost(activeRun.total_cost_usd)}</strong></div>
                </div>
              </div>
            </SectionCard>
          )}

          {/* Current / Next Batch (only when approvable) */}
          {nextPendingBatch && isApprovable && !isRunDone && (
            <SectionCard title="Next Batch">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="text-sm">
                    <span className="text-[var(--color-text-secondary)]">Batch {nextPendingBatch.batch_index + 1}:</span>{" "}
                    <strong>Tile #{nextPendingBatch.tile_index}</strong> × <span className="font-medium" style={{ color: CATEGORY_COLORS[nextPendingBatch.seeding_category] }}>
                      {CATEGORY_LABELS[nextPendingBatch.seeding_category] || nextPendingBatch.seeding_category}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  {!autoRunning && (
                    <>
                      <Button variant="secondary" size="sm" icon={SkipForward}
                        onClick={() => skipBatch(nextPendingBatch.id)}
                        disabled={runningBatch || !!retryingBatchId}>
                        Skip
                      </Button>
                      <Button variant="primary" icon={Play} loading={runningBatch && !autoRunning} onClick={runNextBatch}
                        disabled={runningBatch || !!retryingBatchId}>
                        {runningBatch ? "Running..." : "Run This Batch"}
                      </Button>
                      <Button variant="primary" icon={Zap} onClick={runAll}
                        disabled={runningBatch || !!retryingBatchId}>
                        Run All
                      </Button>
                    </>
                  )}
                  {autoRunning && (
                    <Button variant="secondary" icon={XCircle} onClick={stopAutoRun}>
                      {runningBatch ? "Stopping after current batch..." : "Stop Auto-Run"}
                    </Button>
                  )}
                </div>
              </div>
            </SectionCard>
          )}

          {/* Queue drained but failed batches remain — prompt retry */}
          {queueDrainedWithFailures && (
            <SectionCard title="Queue Complete — Failed Batches Remain">
              <div className="rounded-lg p-4 bg-[var(--color-warning-50)] border border-[var(--color-warning-200)]">
                <div className="text-sm font-medium text-[var(--color-warning-700)]">
                  All {activeRun.total_batches} batches have been processed, but {failedRetryable.length} failed.
                </div>
                <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                  Retry failed batches from the log below, or cancel to finish. The run will auto-complete once all failed batches are retried or skipped.
                </div>
              </div>
            </SectionCard>
          )}

          {/* Completion Card */}
          {isRunDone && (
            <SectionCard title={activeRun.status === "cancelled" ? "Run Cancelled" : "Run Complete"}>
              <div className="grid grid-cols-4 gap-4 text-sm mb-4">
                <div>Completed: <strong className="text-[var(--color-success-700)]">{activeRun.completed_batches}</strong></div>
                <div>Failed: <strong className="text-[var(--color-error-700)]">{activeRun.failed_batches}</strong></div>
                <div>Skipped: <strong>{activeRun.skipped_batches || 0}</strong></div>
                <div>Cost: <strong>{formatCost(activeRun.total_cost_usd)}</strong></div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>New places: <strong className="text-[var(--color-success-700)]">{activeRun.total_places_new}</strong></div>
                <div>Duplicates: <strong>{activeRun.total_places_duped}</strong></div>
              </div>
              <div className="mt-4">
                <Button variant="primary" onClick={() => {
                  setActiveRun(null);
                  setBatches([]);
                  onSeedingChange?.(false);
                  onRefresh();
                }}>Prepare New Run</Button>
              </div>
            </SectionCard>
          )}

          {/* Batch Log (scrollable) */}
          {completedBatches.length > 0 && (
            <SectionCard title="Batch Log" subtitle={`${completedBatches.length} processed`}>
              <div className="max-h-80 overflow-y-auto space-y-1">
                {completedBatches.slice().reverse().map((b) => (
                  <div key={b.id} className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded ${
                    b.status === "failed" ? "bg-[var(--color-error-50)]" : b.status === "skipped" ? "bg-[var(--gray-50)]" : ""
                  }`}>
                    {b.status === "completed" ? (
                      <CheckCircle className="w-3.5 h-3.5 text-[#22c55e] shrink-0" />
                    ) : b.status === "failed" ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-[#ef4444] shrink-0" />
                    ) : (
                      <SkipForward className="w-3.5 h-3.5 text-[var(--color-text-secondary)] shrink-0" />
                    )}
                    <span className="text-[var(--color-text-secondary)] w-12">#{b.batch_index + 1}</span>
                    <span className="w-12">Tile {b.tile_index}</span>
                    <span className="w-28 truncate font-medium" style={{ color: CATEGORY_COLORS[b.seeding_category] }}>
                      {CATEGORY_LABELS[b.seeding_category] || b.seeding_category}
                    </span>
                    {b.retry_count > 0 && (
                      <span className="inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-bold bg-[var(--gray-100)] text-[var(--color-text-secondary)]" title={`Retried ${b.retry_count} time(s)`}>
                        <RotateCcw className="w-2.5 h-2.5 mr-0.5" />{b.retry_count}
                      </span>
                    )}
                    {b.status === "completed" ? (
                      <span className="text-[var(--color-text-secondary)]">
                        {b.places_new_inserted} new · {b.places_duplicate_skipped} dupes · {b.places_returned} found · {formatCost(b.estimated_cost_usd)}
                      </span>
                    ) : b.status === "failed" ? (
                      <>
                        <span className="text-[var(--color-error-700)] truncate flex-1">{b.error_message || "Unknown error"}</span>
                        {isApprovable && !isRunDone && (
                          <span className="inline-flex gap-1 shrink-0">
                            <button
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--color-error-100)] text-[var(--color-error-700)] hover:bg-[var(--color-error-200)] transition-colors cursor-pointer disabled:opacity-50"
                              onClick={() => retryBatch(b.id)}
                              disabled={!!retryingBatchId || runningBatch}
                              title="Re-run this failed batch only"
                            >
                              {retryingBatchId === b.id ? (
                                <Loader className="w-3 h-3 animate-spin" />
                              ) : (
                                <RotateCcw className="w-3 h-3" />
                              )}
                              {retryingBatchId === b.id ? "Retrying..." : "Retry"}
                            </button>
                            <button
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--gray-100)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-200)] transition-colors cursor-pointer disabled:opacity-50"
                              onClick={() => skipBatch(b.id)}
                              disabled={!!retryingBatchId || runningBatch}
                              title="Skip this failed batch — give up on retry"
                            >
                              <SkipForward className="w-3 h-3" />
                              Skip
                            </button>
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-[var(--color-text-secondary)]">Skipped</span>
                    )}
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </>
      )}

      {/* Ad-Hoc Search (always visible) */}
      <SectionCard title="Ad-Hoc Search" subtitle="Free-text search for individual places"
        action={<Button size="sm" variant="ghost" onClick={() => setAdHocOpen(!adHocOpen)} icon={adHocOpen ? ChevronDown : ChevronRight}>
          {adHocOpen ? "Collapse" : "Expand"}
        </Button>}>
        {adHocOpen && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input value={adHocQuery} onChange={(e) => setAdHocQuery(e.target.value)}
                label="" placeholder="e.g. rooftop bars in Lagos" />
              <Button icon={Search} loading={searching} onClick={handleAdHocSearch}>Search</Button>
            </div>
            {adHocResults.length > 0 && (
              <div className="space-y-2">
                {adHocResults.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 border rounded-lg text-sm">
                    <div className="flex-1 min-w-0">
                      <strong>{p.name}</strong>
                      <span className="ml-2 text-[var(--color-text-secondary)]">{p.address?.substring(0, 60)}</span>
                    </div>
                    <select
                      className="rounded border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 py-1 text-xs min-w-[130px]"
                      value={adHocCategories[i] || ""}
                      onChange={(e) => setAdHocCategories((prev) => ({ ...prev, [i]: e.target.value }))}
                    >
                      <option value="">No Category</option>
                      {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                    </select>
                    <Button size="sm" onClick={() => pushToPool([{ ...p, seedingCategory: adHocCategories[i] || null }], adHocCategories[i])}>Push</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
