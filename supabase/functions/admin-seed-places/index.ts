import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timeoutFetch } from "../_shared/timeoutFetch.ts";
import {
  SEEDING_CATEGORIES,
  SEEDING_CATEGORY_MAP,
  ALL_SEEDING_CATEGORY_IDS,
  type SeedingCategoryConfig,
} from "../_shared/seedingCategories.ts";
// Phase 2: type exclusion imports removed — AI is the sole quality gate
// import { GLOBAL_EXCLUDED_PLACE_TYPES, getExcludedTypesForCategory } from "../_shared/categoryPlaceTypes.ts";

// ── Admin Seed Places Edge Function ──────────────────────────────────────────
// Ten actions:
//   Setup:
//     1. generate_tiles  — compute tile grid from city bounding box
//     2. preview_cost    — calculate cost estimate
//     3. coverage_check  — per-category place counts for augmentation intelligence
//   Sequential batch seeding:
//     4. create_run      — prepare run: create all batch records, verify count, mark ready
//     5. run_next_batch  — execute exactly ONE batch, then pause for manual approval
//     6. retry_batch     — re-execute a specific failed batch, correct run counters
//     7. skip_batch      — skip one pending batch without running it
//     8. cancel_run      — stop a run, mark remaining pending batches as skipped
//     9. run_status      — load full run state for UI hydration on page load
//   City registration:
//    10. geocode_city    — geocode a city name → returns center + viewport bbox + tile estimates

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const NEARBY_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchNearby";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.primaryType",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.regularOpeningHours",
  "places.utcOffsetMinutes",
  "places.photos",
  "places.websiteUri",
  "places.businessStatus",
  "places.editorialSummary",
].join(",");

const COST_PER_NEARBY_SEARCH = 0.032;
const COST_PER_PHOTO = 0.007;
const HARD_CAP_USD = 500;
const EXPECTED_UNIQUE_PLACES_PER_TILE = 10; // conservative estimate for photo cost
const PHOTOS_PER_PLACE = 5;
const API_TIMEOUT_MS = 10000;

// RELIABILITY: These ranges MUST match app-mobile/src/constants/priceTiers.ts
// and supabase/functions/_shared/priceTiers.ts. All three are the same source of truth.
// If you change ranges here, update both other files. If they disagree, the client
// tier constants win — they're what users see.
const PRICE_LEVEL_MAP: Record<string, { tier: string; min: number; max: number }> = {
  PRICE_LEVEL_FREE: { tier: "chill", min: 0, max: 0 },
  PRICE_LEVEL_INEXPENSIVE: { tier: "chill", min: 0, max: 50 },
  PRICE_LEVEL_MODERATE: { tier: "comfy", min: 50, max: 150 },
  PRICE_LEVEL_EXPENSIVE: { tier: "bougie", min: 150, max: 300 },
  PRICE_LEVEL_VERY_EXPENSIVE: { tier: "lavish", min: 300, max: 500 },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Tile Grid Generation ────────────────────────────────────────────────────

interface TileData {
  tile_index: number;
  center_lat: number;
  center_lng: number;
  radius_m: number;
  row_idx: number;
  col_idx: number;
}

// BBOX MODEL (2026-04): Cities are defined by their Google Geocoding viewport
// bounding box, NOT by a center point + radius. The bbox_sw/ne columns on
// seeding_cities are the source of truth. coverage_radius_km is deprecated.
// See: outputs/SPEC_CITY_SEEDING_BOUNDING_BOX.md
function generateTileGrid(
  swLat: number,
  swLng: number,
  neLat: number,
  neLng: number,
  tileRadiusM: number,
): TileData[] {
  const spacingM = tileRadiusM * 1.4;

  // Convert to degrees (approximate, using center latitude)
  const metersPerDegreeLat = 111320;
  const centerLat = (swLat + neLat) / 2;
  const metersPerDegreeLng =
    111320 * Math.cos((centerLat * Math.PI) / 180);

  const spacingLat = spacingM / metersPerDegreeLat;
  const spacingLng = spacingM / metersPerDegreeLng;

  const tiles: TileData[] = [];
  let tileIndex = 0;
  let rowIdx = 0;

  for (let lat = swLat; lat <= neLat; lat += spacingLat) {
    let colIdx = 0;
    for (let lng = swLng; lng <= neLng; lng += spacingLng) {
      tiles.push({
        tile_index: tileIndex++,
        center_lat: lat,
        center_lng: lng,
        radius_m: tileRadiusM,
        row_idx: rowIdx,
        col_idx: colIdx,
      });
      colIdx++;
    }
    rowIdx++;
  }

  return tiles;
}

// ── Tile Estimate Calculator (pure math, no DB) ────────────────────────────

function calculateTileEstimates(
  swLat: number, swLng: number, neLat: number, neLng: number,
) {
  const metersPerDegreeLat = 111320;
  const centerLat = (swLat + neLat) / 2;
  const metersPerDegreeLng = 111320 * Math.cos((centerLat * Math.PI) / 180);

  const extentLatKm = (neLat - swLat) * metersPerDegreeLat / 1000;
  const extentLngKm = (neLng - swLng) * metersPerDegreeLng / 1000;
  const areaKm2 = extentLatKm * extentLngKm;

  function countTiles(tileRadiusM: number): { tiles: number; apiCalls: number; searchCostUsd: number } {
    const spacingM = tileRadiusM * 1.4;
    const spacingLat = spacingM / metersPerDegreeLat;
    const spacingLng = spacingM / metersPerDegreeLng;

    let tiles = 0;
    for (let lat = swLat; lat <= neLat; lat += spacingLat) {
      for (let lng = swLng; lng <= neLng; lng += spacingLng) {
        tiles++;
      }
    }

    const apiCalls = tiles * ALL_SEEDING_CATEGORY_IDS.length;
    const searchCostUsd = Math.round(apiCalls * COST_PER_NEARBY_SEARCH * 100) / 100;
    return { tiles, apiCalls, searchCostUsd };
  }

  return {
    atRadius1500: countTiles(1500),
    atRadius2000: countTiles(2000),
    atRadius2500: countTiles(2500),
    extentLatKm: Math.round(extentLatKm * 10) / 10,
    extentLngKm: Math.round(extentLngKm * 10) / 10,
    areaKm2: Math.round(areaKm2),
  };
}

// ── Google Place → place_pool row (selective fields for upsert) ─────────────

// deno-lint-ignore no-explicit-any
function transformGooglePlaceForSeed(gPlace: any, cityId: string, seedingCategory: string, country: string, city: string) {
  const priceLevel = gPlace.priceLevel as string | undefined;
  const priceInfo = PRICE_LEVEL_MAP[priceLevel ?? ""] ?? {
    tier: null,
    min: 0,
    max: 0,
  };
  const displayName = gPlace.displayName as { text?: string } | undefined;
  const location = gPlace.location as
    | { latitude?: number; longitude?: number }
    | undefined;
  const photos = (gPlace.photos ?? []) as Array<{
    name?: string;
    widthPx?: number;
    heightPx?: number;
  }>;

  return {
    google_place_id: gPlace.id as string,
    name: displayName?.text ?? "Unknown",
    address: gPlace.formattedAddress ?? null,
    lat: location?.latitude ?? 0,
    lng: location?.longitude ?? 0,
    types: gPlace.types ?? [],
    primary_type: gPlace.primaryType ?? null,
    rating: gPlace.rating ?? null,
    review_count: gPlace.userRatingCount ?? 0,
    price_level: priceLevel ?? null,
    price_min: priceInfo.min,
    price_max: priceInfo.max,
    price_tier: priceInfo.tier,
    price_tiers: priceInfo.tier ? [priceInfo.tier] : [],
    opening_hours: gPlace.regularOpeningHours ?? null,
    photos: photos.map((p) => ({
      name: p.name,
      widthPx: p.widthPx,
      heightPx: p.heightPx,
    })),
    website: gPlace.websiteUri ?? null,
    editorial_summary: (gPlace.editorialSummary as { text?: string })?.text ?? null,
    raw_google_data: gPlace,
    fetched_via: "nearby_search",
    last_detail_refresh: new Date().toISOString(),
    refresh_failures: 0,
    is_active: true,
    city_id: cityId,
    seeding_category: seedingCategory,
    country: country,
    city: city,
    utc_offset_minutes: (gPlace.utcOffsetMinutes as number) ?? null,
  };
}

// ── Post-fetch filters ──────────────────────────────────────────────────────

interface FilterResult {
  // deno-lint-ignore no-explicit-any
  passed: any[];
  rejectedNoPhotos: number;
  rejectedClosed: number;
  rejectedExcludedType: number;
}

// deno-lint-ignore no-explicit-any
function applyPostFetchFilters(places: any[], _categoryId: string): FilterResult {
  let rejectedNoPhotos = 0;
  let rejectedClosed = 0;

  // Phase 2: Type exclusions removed — AI is the sole quality gate.
  // All place types now enter the pool. AI validates quality post-seeding.

  // deno-lint-ignore no-explicit-any
  const passed = places.filter((p: any) => {
    // Reject permanently closed
    if (p.businessStatus === "CLOSED_PERMANENTLY") {
      rejectedClosed++;
      return false;
    }
    // Reject no photos
    if (!p.photos || p.photos.length === 0) {
      rejectedNoPhotos++;
      return false;
    }
    return true;
  });

  return { passed, rejectedNoPhotos, rejectedClosed, rejectedExcludedType: 0 };
}

// ── Parse country from formattedAddress ─────────────────────────────────────

function parseCountry(address: string | undefined | null, fallback: string): string {
  if (!address) return fallback;
  const parts = address.split(",");
  return parts[parts.length - 1]?.trim() || fallback;
}

// CITY TEXT EXTRACTION (Block 4 — hardened 2026-03-21)
// Extracts city name from Google addressComponents (locality type).
// Falls back to seeding_cities.name. Required for Pool Intelligence V2 RPCs.

// deno-lint-ignore no-explicit-any
function parseCity(gPlace: any, fallback: string): string {
  const components = gPlace?.addressComponents;
  if (Array.isArray(components)) {
    for (const comp of components) {
      if (Array.isArray(comp.types) && comp.types.includes('locality')) {
        const city = comp.longText || comp.shortText;
        if (city) return city;
      }
    }
  }
  return fallback;
}

// ── Action: generate_tiles ──────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function handleGenerateTiles(body: any, supabase: any) {
  const { cityId } = body;
  if (!cityId) throw new Error("cityId is required");

  // Load city
  const { data: city, error: cityErr } = await supabase
    .from("seeding_cities")
    .select("*")
    .eq("id", cityId)
    .single();
  if (cityErr || !city) throw new Error(`City not found: ${cityId}`);

  // Use bounding box (bbox model)
  if (!city.bbox_sw_lat || !city.bbox_ne_lat) {
    throw new Error("City has no bounding box. Re-register with geocoding.");
  }

  const tiles = generateTileGrid(
    city.bbox_sw_lat,
    city.bbox_sw_lng,
    city.bbox_ne_lat,
    city.bbox_ne_lng,
    city.tile_radius_m,
  );

  // Delete existing tiles for regeneration
  await supabase.from("seeding_tiles").delete().eq("city_id", cityId);

  // Insert new tiles — chunk if >500 rows (large cities)
  const CHUNK_SIZE = 500;
  const allInserted: Record<string, unknown>[] = [];

  for (let i = 0; i < tiles.length; i += CHUNK_SIZE) {
    const chunk = tiles.slice(i, i + CHUNK_SIZE).map((t) => ({
      city_id: cityId,
      ...t,
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from("seeding_tiles")
      .insert(chunk)
      .select("id, tile_index, center_lat, center_lng, radius_m, row_idx, col_idx");

    if (insertErr) throw new Error(`Failed to insert tiles (chunk ${Math.floor(i / CHUNK_SIZE) + 1}): ${insertErr.message}`);
    allInserted.push(...(inserted || []));
  }

  return {
    cityId,
    tileCount: allInserted.length,
    tiles: allInserted.map((t) => ({
      id: t.id,
      tileIndex: t.tile_index,
      centerLat: t.center_lat,
      centerLng: t.center_lng,
      radiusM: t.radius_m,
      row: t.row_idx,
      col: t.col_idx,
    })),
  };
}

// ── Action: preview_cost ────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function handlePreviewCost(body: any, supabase: any) {
  const { cityId, categories, tileIds, skipSeededCategories } = body;
  if (!cityId) throw new Error("cityId is required");

  // Resolve categories
  let categoryIds: string[] =
    !categories || categories[0] === "all"
      ? ALL_SEEDING_CATEGORY_IDS
      : categories;

  // If skipSeededCategories, exclude categories that already have completed ops with places
  if (skipSeededCategories) {
    const { data: completedOps } = await supabase
      .from("seeding_operations")
      .select("seeding_category")
      .eq("city_id", cityId)
      .eq("status", "completed")
      .gt("places_new_inserted", 0);

    const seededCategorySet = new Set(
      (completedOps || []).map((o: { seeding_category: string }) => o.seeding_category)
    );
    categoryIds = categoryIds.filter((id) => !seededCategorySet.has(id));
  }

  // Load tiles
  let tileQuery = supabase
    .from("seeding_tiles")
    .select("id")
    .eq("city_id", cityId);
  if (tileIds && tileIds.length > 0) {
    tileQuery = tileQuery.in("id", tileIds);
  }
  const { data: tiles, error: tileErr } = await tileQuery;
  if (tileErr) throw new Error(`Failed to load tiles: ${tileErr.message}`);

  const tileCount = tiles?.length ?? 0;
  const categoryCount = categoryIds.length;
  const totalApiCalls = tileCount * categoryCount;
  const estimatedSearchCost = totalApiCalls * COST_PER_NEARBY_SEARCH;
  const estimatedPhotoCost =
    tileCount * EXPECTED_UNIQUE_PLACES_PER_TILE * PHOTOS_PER_PLACE * COST_PER_PHOTO;
  const estimatedTotalCost = estimatedSearchCost + estimatedPhotoCost;

  const breakdown = categoryIds.map((catId) => {
    const config = SEEDING_CATEGORY_MAP[catId];
    return {
      category: config?.label ?? catId,
      tiles: tileCount,
      calls: tileCount,
      cost: tileCount * COST_PER_NEARBY_SEARCH,
    };
  });

  return {
    tileCount,
    categoryCount,
    totalApiCalls,
    estimatedSearchCost: Math.round(estimatedSearchCost * 100) / 100,
    estimatedPhotoCost: Math.round(estimatedPhotoCost * 100) / 100,
    estimatedTotalCost: Math.round(estimatedTotalCost * 100) / 100,
    exceedsHardCap: estimatedTotalCost > HARD_CAP_USD,
    hardCapUsd: HARD_CAP_USD,
    breakdown,
  };
}

// ── Action: coverage_check ──────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function handleCoverageCheck(body: any, supabase: any) {
  const { cityId } = body;
  if (!cityId) throw new Error("cityId is required");

  // Count places per seeding_category for this city
  // Must override Supabase default 1000-row limit to get accurate counts
  const { data: rows, error } = await supabase
    .from("place_pool")
    .select("seeding_category")
    .eq("city_id", cityId)
    .eq("is_active", true)
    .limit(10000);

  if (error) throw new Error(`Coverage check failed: ${error.message}`);

  // Tally per category
  const counts: Record<string, number> = {};
  for (const r of (rows || [])) {
    const cat = r.seeding_category || "unknown";
    counts[cat] = (counts[cat] || 0) + 1;
  }

  // Build coverage report with all 13 categories
  const coverage = ALL_SEEDING_CATEGORY_IDS.map((catId) => {
    const config = SEEDING_CATEGORY_MAP[catId];
    const count = counts[catId] || 0;
    return {
      categoryId: catId,
      label: config?.label ?? catId,
      appCategory: config?.appCategory ?? "",
      placeCount: count,
      hasGap: count < 10,
    };
  });

  const totalPlaces = Object.values(counts).reduce((s: number, n: number) => s + n, 0);
  const categoriesWithGaps = coverage.filter((c) => c.hasGap).length;

  return { cityId, totalPlaces, categoriesWithGaps, coverage };
}

// ── Action: create_run ───────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function handleCreateRun(body: any, supabase: any) {
  const { cityId, categories } = body;
  if (!cityId) throw new Error("cityId is required");

  // Load city
  const { data: city, error: cityErr } = await supabase
    .from("seeding_cities")
    .select("*")
    .eq("id", cityId)
    .single();
  if (cityErr || !city) throw new Error(`City not found: ${cityId}`);

  // Resolve categories
  const categoryIds: string[] =
    !categories || categories[0] === "all"
      ? ALL_SEEDING_CATEGORY_IDS
      : categories;

  const validConfigs = categoryIds
    .map((id: string) => SEEDING_CATEGORY_MAP[id])
    .filter(Boolean) as SeedingCategoryConfig[];

  if (validConfigs.length === 0) {
    throw new Error("No valid seeding categories provided");
  }

  // Load tiles ordered by tile_index
  const { data: tiles, error: tileErr } = await supabase
    .from("seeding_tiles")
    .select("id, tile_index, center_lat, center_lng, radius_m, row_idx, col_idx")
    .eq("city_id", cityId)
    .order("tile_index");
  if (tileErr) throw new Error(`Failed to load tiles: ${tileErr.message}`);
  if (!tiles || tiles.length === 0) {
    throw new Error("No tiles found. Generate tiles first.");
  }

  const totalBatches = tiles.length * validConfigs.length;

  // Calculate estimated cost (returned in response — admin acknowledges before proceeding)
  const estimatedSearchCost = totalBatches * COST_PER_NEARBY_SEARCH;
  const estimatedPhotoCost = tiles.length * EXPECTED_UNIQUE_PLACES_PER_TILE * PHOTOS_PER_PLACE * COST_PER_PHOTO;
  const estimatedTotalCost = estimatedSearchCost + estimatedPhotoCost;

  // Check for existing active run (includes preparing and ready states)
  const { data: existingRuns } = await supabase
    .from("seeding_runs")
    .select("id, status")
    .eq("city_id", cityId)
    .in("status", ["preparing", "ready", "running", "paused"])
    .limit(1);

  if (existingRuns && existingRuns.length > 0) {
    throw new Error(
      `City already has an active run (${existingRuns[0].id}, status: ${existingRuns[0].status}). Cancel it first.`
    );
  }

  // Phase 1: Create run in 'preparing' status
  const { data: run, error: runErr } = await supabase
    .from("seeding_runs")
    .insert({
      city_id: cityId,
      selected_categories: categoryIds,
      total_tiles: tiles.length,
      total_batches: totalBatches,
      status: "preparing",
    })
    .select("*")
    .single();

  if (runErr) throw new Error(`Failed to create run: ${runErr.message}`);

  // Phase 2: Build and insert all batch records
  const batchRows = [];
  let batchIndex = 0;
  for (const tile of tiles) {
    for (const config of validConfigs) {
      batchRows.push({
        run_id: run.id,
        city_id: cityId,
        tile_id: tile.id,
        tile_index: tile.tile_index,
        seeding_category: config.id,
        app_category: config.appCategory,
        batch_index: batchIndex++,
        status: "pending",
      });
    }
  }

  // Insert in chunks of 500 (Supabase limit)
  const CHUNK_SIZE = 500;
  let insertedTotal = 0;

  try {
    for (let i = 0; i < batchRows.length; i += CHUNK_SIZE) {
      const chunk = batchRows.slice(i, i + CHUNK_SIZE);
      const { error: batchErr } = await supabase
        .from("seeding_batches")
        .insert(chunk);
      if (batchErr) throw new Error(`Chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${batchErr.message}`);
      insertedTotal += chunk.length;
    }
  } catch (insertError) {
    // Batch insertion failed partway — mark run as failed_preparing
    await supabase
      .from("seeding_runs")
      .update({
        status: "failed_preparing",
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id);

    throw new Error(
      `Batch preparation failed after ${insertedTotal}/${totalBatches} batches. ` +
      `Run ${run.id} marked as failed_preparing. ` +
      (insertError instanceof Error ? insertError.message : String(insertError))
    );
  }

  // Phase 3: Verify actual batch count matches expected
  const { count: actualCount, error: countErr } = await supabase
    .from("seeding_batches")
    .select("id", { count: "exact", head: true })
    .eq("run_id", run.id);

  if (countErr || actualCount !== totalBatches) {
    // Count mismatch — mark as failed_preparing
    await supabase
      .from("seeding_runs")
      .update({
        status: "failed_preparing",
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id);

    throw new Error(
      `Batch count verification failed: expected ${totalBatches}, got ${actualCount ?? "unknown"}. ` +
      `Run ${run.id} marked as failed_preparing.`
    );
  }

  // Phase 4: All batches created and verified — transition to 'ready'
  await supabase
    .from("seeding_runs")
    .update({ status: "ready" })
    .eq("id", run.id);

  // Return queue preview (first 5 batches)
  const preview = batchRows.slice(0, 5).map((b) => ({
    batchIndex: b.batch_index,
    tileIndex: b.tile_index,
    category: b.seeding_category,
    categoryLabel: SEEDING_CATEGORY_MAP[b.seeding_category]?.label ?? b.seeding_category,
  }));

  return {
    runId: run.id,
    status: "ready",
    totalBatches,
    totalTiles: tiles.length,
    totalCategories: validConfigs.length,
    estimatedCostUsd: Math.round(estimatedTotalCost * 100) / 100,
    preview,
  };
}

// ── Action: run_next_batch ───────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function handleRunNextBatch(body: any, supabase: any) {
  const { runId } = body;
  if (!runId) throw new Error("runId is required");

  // Load run
  const { data: run, error: runErr } = await supabase
    .from("seeding_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (runErr || !run) throw new Error(`Run not found: ${runId}`);

  if (!["ready", "running", "paused"].includes(run.status)) {
    throw new Error(`Run status is '${run.status}' — cannot execute batches. Run must be in 'ready', 'running', or 'paused' state.`);
  }

  // Find next pending batch
  const { data: nextBatches, error: nextErr } = await supabase
    .from("seeding_batches")
    .select("*")
    .eq("run_id", runId)
    .eq("status", "pending")
    .order("batch_index")
    .limit(1);

  if (nextErr) throw new Error(`Failed to find next batch: ${nextErr.message}`);

  if (!nextBatches || nextBatches.length === 0) {
    // All done — mark run completed
    await supabase
      .from("seeding_runs")
      .update({
        status: "completed",
        current_batch_index: null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return { done: true, runId, message: "All batches completed" };
  }

  const batch = nextBatches[0];

  // Mark batch as running, mark run as running
  const now = new Date().toISOString();
  await supabase
    .from("seeding_batches")
    .update({ status: "running", started_at: now })
    .eq("id", batch.id);

  await supabase
    .from("seeding_runs")
    .update({
      status: "running",
      current_batch_index: batch.batch_index,
      ...(run.status === "ready" ? { started_at: now } : {}),
    })
    .eq("id", runId);

  // Load city for name/country
  const { data: city } = await supabase
    .from("seeding_cities")
    .select("name, country")
    .eq("id", batch.city_id)
    .single();
  const cityName = city?.name ?? "Unknown";
  const cityCountry = city?.country ?? "Unknown";

  // Load tile
  const { data: tile } = await supabase
    .from("seeding_tiles")
    .select("id, tile_index, center_lat, center_lng, radius_m")
    .eq("id", batch.tile_id)
    .single();

  if (!tile) {
    // Tile missing — mark batch failed
    await supabase
      .from("seeding_batches")
      .update({
        status: "failed",
        error_message: "Tile not found",
        completed_at: new Date().toISOString(),
      })
      .eq("id", batch.id);

    await supabase
      .from("seeding_runs")
      .update({
        status: "paused",
        failed_batches: run.failed_batches + 1,
      })
      .eq("id", runId);

    return {
      done: false,
      batchId: batch.id,
      batchIndex: batch.batch_index,
      status: "failed",
      error: "Tile not found",
    };
  }

  // Get category config
  const config = SEEDING_CATEGORY_MAP[batch.seeding_category];
  if (!config) {
    await supabase
      .from("seeding_batches")
      .update({
        status: "failed",
        error_message: `Unknown category: ${batch.seeding_category}`,
        completed_at: new Date().toISOString(),
      })
      .eq("id", batch.id);

    await supabase
      .from("seeding_runs")
      .update({
        status: "paused",
        failed_batches: run.failed_batches + 1,
      })
      .eq("id", runId);

    return {
      done: false,
      batchId: batch.id,
      batchIndex: batch.batch_index,
      status: "failed",
      error: `Unknown category: ${batch.seeding_category}`,
    };
  }

  // Execute ONE Google Nearby Search
  let batchStatus = "completed";
  let errorMessage: string | null = null;
  let errorDetails: unknown = null;
  let placesReturned = 0;
  let rejectedNoPhotos = 0;
  let rejectedClosed = 0;
  let rejectedExcludedType = 0;
  let newInserted = 0;
  let duplicateSkipped = 0;

  try {
    const requestBody = {
      includedTypes: config.includedTypes,
      excludedPrimaryTypes: config.excludedPrimaryTypes,
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: {
            latitude: tile.center_lat,
            longitude: tile.center_lng,
          },
          radius: tile.radius_m,
        },
      },
      rankPreference: "POPULARITY",
    };

    const response = await timeoutFetch(NEARBY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(requestBody),
      timeoutMs: API_TIMEOUT_MS,
    });

    if (!response.ok) {
      const respBody = await response.text();
      batchStatus = "failed";
      errorMessage = `Google API ${response.status}: ${respBody.substring(0, 200)}`;
      errorDetails = { http_status: response.status, response_body: respBody.substring(0, 500) };
    } else {
      const data = await response.json();
      const places = data.places || [];
      placesReturned = places.length;

      // Apply post-fetch filters
      const filterResult = applyPostFetchFilters(places, config.id);
      rejectedNoPhotos = filterResult.rejectedNoPhotos;
      rejectedClosed = filterResult.rejectedClosed;
      rejectedExcludedType = filterResult.rejectedExcludedType;

      // Deduplicate by google_place_id
      // deno-lint-ignore no-explicit-any
      const uniquePlaces = new Map<string, any>();
      for (const p of filterResult.passed) {
        if (p.id && !uniquePlaces.has(p.id)) {
          uniquePlaces.set(p.id, p);
        }
      }

      // Upsert to place_pool
      if (uniquePlaces.size > 0) {
        const rows = Array.from(uniquePlaces.values()).map((p) =>
          transformGooglePlaceForSeed(p, batch.city_id, config.id, parseCountry(p.formattedAddress, cityCountry), parseCity(p, cityName))
        );

        // Step 1: Insert new places only
        const { data: insertedData, error: insertErr } = await supabase
          .from("place_pool")
          .upsert(rows, { onConflict: "google_place_id", ignoreDuplicates: true })
          .select("google_place_id");

        if (insertErr) {
          errorMessage = `Upsert error: ${insertErr.message}`;
          errorDetails = { upsert_error: insertErr.message };
          // Don't mark as failed — partial success is still useful
        }

        const insertedIds = new Set(
          (insertedData ?? []).map((r: { google_place_id: string }) => r.google_place_id)
        );
        newInserted = insertedIds.size;

        // Step 2: Update existing places selectively (batched in groups of 10)
        const existingRows = rows.filter((r) => !insertedIds.has(r.google_place_id));
        duplicateSkipped = existingRows.length;
        const UPDATE_BATCH_SIZE = 10;

        for (let i = 0; i < existingRows.length; i += UPDATE_BATCH_SIZE) {
          const updateBatch = existingRows.slice(i, i + UPDATE_BATCH_SIZE);
          await Promise.all(
            updateBatch.map((row) =>
              supabase
                .from("place_pool")
                .update({
                  name: row.name,
                  address: row.address,
                  lat: row.lat,
                  lng: row.lng,
                  types: row.types,
                  primary_type: row.primary_type,
                  rating: row.rating,
                  review_count: row.review_count,
                  price_level: row.price_level,
                  opening_hours: row.opening_hours,
                  photos: row.photos,
                  website: row.website,
                  raw_google_data: row.raw_google_data,
                  last_detail_refresh: row.last_detail_refresh,
                  refresh_failures: 0,
                })
                .eq("google_place_id", row.google_place_id)
            )
          );
        }
      }
    }
  } catch (err) {
    batchStatus = "failed";
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    errorMessage = isTimeout ? "Request timed out" : (err instanceof Error ? err.message : String(err));
    errorDetails = { error_type: isTimeout ? "timeout" : "unknown" };
  }

  const completedAt = new Date().toISOString();
  const costUsd = COST_PER_NEARBY_SEARCH; // Always 1 API call per batch

  // Update batch record
  await supabase
    .from("seeding_batches")
    .update({
      status: batchStatus,
      google_api_calls: 1,
      places_returned: placesReturned,
      places_rejected_no_photos: rejectedNoPhotos,
      places_rejected_closed: rejectedClosed,
      places_rejected_excluded_type: rejectedExcludedType,
      places_new_inserted: newInserted,
      places_duplicate_skipped: duplicateSkipped,
      estimated_cost_usd: costUsd,
      error_message: errorMessage,
      error_details: errorDetails,
      completed_at: completedAt,
    })
    .eq("id", batch.id);

  // Update run aggregates
  const updateData: Record<string, unknown> = {
    status: "paused",
    total_api_calls: run.total_api_calls + 1,
    total_places_new: run.total_places_new + newInserted,
    total_places_duped: run.total_places_duped + duplicateSkipped,
    total_cost_usd: run.total_cost_usd + costUsd,
  };

  if (batchStatus === "completed") {
    updateData.completed_batches = run.completed_batches + 1;
  } else {
    updateData.failed_batches = run.failed_batches + 1;
  }

  // Check if there are remaining pending batches
  const { data: remainingBatches } = await supabase
    .from("seeding_batches")
    .select("id")
    .eq("run_id", runId)
    .eq("status", "pending")
    .limit(1);

  const noPending = !remainingBatches || remainingBatches.length === 0;

  if (noPending) {
    // Also check for failed batches — don't auto-complete if retryable batches remain
    const { data: failedBatches } = await supabase
      .from("seeding_batches")
      .select("id")
      .eq("run_id", runId)
      .eq("status", "failed")
      .limit(1);

    const noFailed = !failedBatches || failedBatches.length === 0;

    if (noFailed) {
      // All batches are completed/skipped — run is done
      updateData.status = "completed";
      updateData.current_batch_index = null;
      updateData.completed_at = completedAt;
    }
    // else: no pending but failed batches exist — stay paused for retry
  }

  await supabase
    .from("seeding_runs")
    .update(updateData)
    .eq("id", runId);

  // Get next batch preview
  let nextPreview = null;
  if (!noPending) {
    const { data: nextBatch } = await supabase
      .from("seeding_batches")
      .select("batch_index, tile_index, seeding_category")
      .eq("run_id", runId)
      .eq("status", "pending")
      .order("batch_index")
      .limit(1)
      .single();

    if (nextBatch) {
      nextPreview = {
        batchIndex: nextBatch.batch_index,
        tileIndex: nextBatch.tile_index,
        category: nextBatch.seeding_category,
        categoryLabel: SEEDING_CATEGORY_MAP[nextBatch.seeding_category]?.label ?? nextBatch.seeding_category,
      };
    }
  }

  return {
    done: updateData.status === "completed",
    batchId: batch.id,
    batchIndex: batch.batch_index,
    tileIndex: batch.tile_index,
    category: batch.seeding_category,
    categoryLabel: config.label,
    status: batchStatus,
    result: {
      placesReturned,
      rejectedNoPhotos,
      rejectedClosed,
      rejectedExcludedType,
      newInserted,
      duplicateSkipped,
      costUsd,
      error: errorMessage,
    },
    nextBatch: nextPreview,
    runProgress: {
      completedBatches: (updateData.completed_batches as number) ?? run.completed_batches,
      failedBatches: (updateData.failed_batches as number) ?? run.failed_batches,
      totalBatches: run.total_batches,
      totalPlacesNew: run.total_places_new + newInserted,
      totalPlacesDuped: run.total_places_duped + duplicateSkipped,
      totalCostUsd: Math.round((run.total_cost_usd + costUsd) * 1000) / 1000,
    },
  };
}

// ── Action: retry_batch ──────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function handleRetryBatch(body: any, supabase: any) {
  const { runId, batchId } = body;
  if (!runId || !batchId) throw new Error("runId and batchId are required");

  // Load run
  const { data: run, error: runErr } = await supabase
    .from("seeding_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (runErr || !run) throw new Error("Run not found");

  if (!["ready", "running", "paused"].includes(run.status)) {
    throw new Error(`Run status is '${run.status}' — retry only allowed when run is ready, running, or paused`);
  }

  // Load batch — must be failed AND belong to this run
  const { data: batch, error: batchErr } = await supabase
    .from("seeding_batches")
    .select("*")
    .eq("id", batchId)
    .eq("run_id", runId)
    .single();

  if (batchErr || !batch) throw new Error("Batch not found");
  if (batch.status !== "failed") {
    throw new Error(`Batch status is '${batch.status}' — can only retry failed batches`);
  }

  // One-at-a-time guard: no other batch should be running
  const { data: runningBatches } = await supabase
    .from("seeding_batches")
    .select("id")
    .eq("run_id", runId)
    .eq("status", "running")
    .limit(1);

  if (runningBatches && runningBatches.length > 0) {
    throw new Error("Another batch is already running. Wait for it to complete.");
  }

  // Save old batch contribution to run aggregates (for correction)
  const oldNewInserted = batch.places_new_inserted || 0;
  const oldDuped = batch.places_duplicate_skipped || 0;

  // Mark batch as running, increment retry_count
  const now = new Date().toISOString();
  await supabase
    .from("seeding_batches")
    .update({
      status: "running",
      started_at: now,
      completed_at: null,
      retry_count: (batch.retry_count || 0) + 1,
      // Clear old results — will be overwritten
      error_message: null,
      error_details: null,
    })
    .eq("id", batchId);

  // Mark run as running
  await supabase
    .from("seeding_runs")
    .update({
      status: "running",
      current_batch_index: batch.batch_index,
    })
    .eq("id", runId);

  // Load city for name/country
  const { data: city } = await supabase
    .from("seeding_cities")
    .select("name, country")
    .eq("id", batch.city_id)
    .single();
  const cityName = city?.name ?? "Unknown";
  const cityCountry = city?.country ?? "Unknown";

  // Load tile
  const { data: tile } = await supabase
    .from("seeding_tiles")
    .select("id, tile_index, center_lat, center_lng, radius_m")
    .eq("id", batch.tile_id)
    .single();

  if (!tile) {
    await supabase
      .from("seeding_batches")
      .update({
        status: "failed",
        error_message: "Tile not found",
        completed_at: new Date().toISOString(),
      })
      .eq("id", batchId);

    await supabase
      .from("seeding_runs")
      .update({ status: "paused" })
      .eq("id", runId);

    return {
      retried: true,
      batchId,
      batchIndex: batch.batch_index,
      status: "failed",
      error: "Tile not found",
    };
  }

  const config = SEEDING_CATEGORY_MAP[batch.seeding_category];
  if (!config) {
    await supabase
      .from("seeding_batches")
      .update({
        status: "failed",
        error_message: `Unknown category: ${batch.seeding_category}`,
        completed_at: new Date().toISOString(),
      })
      .eq("id", batchId);

    await supabase
      .from("seeding_runs")
      .update({ status: "paused" })
      .eq("id", runId);

    return {
      retried: true,
      batchId,
      batchIndex: batch.batch_index,
      status: "failed",
      error: `Unknown category: ${batch.seeding_category}`,
    };
  }

  // Execute ONE Google Nearby Search (identical logic to run_next_batch)
  let batchStatus = "completed";
  let errorMessage: string | null = null;
  let errorDetails: unknown = null;
  let placesReturned = 0;
  let rejectedNoPhotos = 0;
  let rejectedClosed = 0;
  let rejectedExcludedType = 0;
  let newInserted = 0;
  let duplicateSkipped = 0;

  try {
    const requestBody = {
      includedTypes: config.includedTypes,
      excludedPrimaryTypes: config.excludedPrimaryTypes,
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: {
            latitude: tile.center_lat,
            longitude: tile.center_lng,
          },
          radius: tile.radius_m,
        },
      },
      rankPreference: "POPULARITY",
    };

    const response = await timeoutFetch(NEARBY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(requestBody),
      timeoutMs: API_TIMEOUT_MS,
    });

    if (!response.ok) {
      const respBody = await response.text();
      batchStatus = "failed";
      errorMessage = `Google API ${response.status}: ${respBody.substring(0, 200)}`;
      errorDetails = { http_status: response.status, response_body: respBody.substring(0, 500) };
    } else {
      const data = await response.json();
      const places = data.places || [];
      placesReturned = places.length;

      const filterResult = applyPostFetchFilters(places, config.id);
      rejectedNoPhotos = filterResult.rejectedNoPhotos;
      rejectedClosed = filterResult.rejectedClosed;
      rejectedExcludedType = filterResult.rejectedExcludedType;

      // deno-lint-ignore no-explicit-any
      const uniquePlaces = new Map<string, any>();
      for (const p of filterResult.passed) {
        if (p.id && !uniquePlaces.has(p.id)) {
          uniquePlaces.set(p.id, p);
        }
      }

      if (uniquePlaces.size > 0) {
        const rows = Array.from(uniquePlaces.values()).map((p) =>
          transformGooglePlaceForSeed(p, batch.city_id, config.id, parseCountry(p.formattedAddress, cityCountry), parseCity(p, cityName))
        );

        // Step 1: Insert new places only
        const { data: insertedData, error: insertErr } = await supabase
          .from("place_pool")
          .upsert(rows, { onConflict: "google_place_id", ignoreDuplicates: true })
          .select("google_place_id");

        if (insertErr) {
          errorMessage = `Upsert error: ${insertErr.message}`;
          errorDetails = { upsert_error: insertErr.message };
        }

        const insertedIds = new Set(
          (insertedData ?? []).map((r: { google_place_id: string }) => r.google_place_id)
        );
        newInserted = insertedIds.size;

        // Step 2: Update existing places (batched in groups of 10)
        const existingRows = rows.filter((r) => !insertedIds.has(r.google_place_id));
        duplicateSkipped = existingRows.length;
        const UPDATE_BATCH_SIZE = 10;

        for (let i = 0; i < existingRows.length; i += UPDATE_BATCH_SIZE) {
          const updateBatch = existingRows.slice(i, i + UPDATE_BATCH_SIZE);
          await Promise.all(
            updateBatch.map((row) =>
              supabase
                .from("place_pool")
                .update({
                  name: row.name,
                  address: row.address,
                  lat: row.lat,
                  lng: row.lng,
                  types: row.types,
                  primary_type: row.primary_type,
                  rating: row.rating,
                  review_count: row.review_count,
                  price_level: row.price_level,
                  opening_hours: row.opening_hours,
                  photos: row.photos,
                  website: row.website,
                  raw_google_data: row.raw_google_data,
                  last_detail_refresh: row.last_detail_refresh,
                  refresh_failures: 0,
                })
                .eq("google_place_id", row.google_place_id)
            )
          );
        }
      }
    }
  } catch (err) {
    batchStatus = "failed";
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    errorMessage = isTimeout ? "Request timed out" : (err instanceof Error ? err.message : String(err));
    errorDetails = { error_type: isTimeout ? "timeout" : "unknown" };
  }

  const completedAt = new Date().toISOString();
  const costUsd = COST_PER_NEARBY_SEARCH;

  // Update batch record with new results
  await supabase
    .from("seeding_batches")
    .update({
      status: batchStatus,
      google_api_calls: (batch.google_api_calls || 0) + 1,
      places_returned: placesReturned,
      places_rejected_no_photos: rejectedNoPhotos,
      places_rejected_closed: rejectedClosed,
      places_rejected_excluded_type: rejectedExcludedType,
      places_new_inserted: newInserted,
      places_duplicate_skipped: duplicateSkipped,
      estimated_cost_usd: (batch.estimated_cost_usd || 0) + costUsd,
      error_message: errorMessage,
      error_details: errorDetails,
      completed_at: completedAt,
    })
    .eq("id", batchId);

  // Correct run aggregates:
  // - Always add the new API call and cost
  // - Adjust place counts: subtract old batch contribution, add new
  // - Adjust status counters: if retry succeeded, move from failed to completed
  const runUpdate: Record<string, unknown> = {
    status: "paused",
    total_api_calls: run.total_api_calls + 1,
    total_cost_usd: run.total_cost_usd + costUsd,
    total_places_new: run.total_places_new - oldNewInserted + newInserted,
    total_places_duped: run.total_places_duped - oldDuped + duplicateSkipped,
  };

  if (batchStatus === "completed") {
    // Batch moved from failed → completed
    runUpdate.failed_batches = run.failed_batches - 1;
    runUpdate.completed_batches = run.completed_batches + 1;

    // Check if run should now auto-complete (no pending, no failed remaining)
    const { data: pendingLeft } = await supabase
      .from("seeding_batches")
      .select("id")
      .eq("run_id", runId)
      .eq("status", "pending")
      .limit(1);

    const { data: failedLeft } = await supabase
      .from("seeding_batches")
      .select("id")
      .eq("run_id", runId)
      .eq("status", "failed")
      .limit(1);

    if ((!pendingLeft || pendingLeft.length === 0) && (!failedLeft || failedLeft.length === 0)) {
      runUpdate.status = "completed";
      runUpdate.current_batch_index = null;
      runUpdate.completed_at = completedAt;
    }
  }
  // If retry failed again, counters stay the same (batch was already counted as failed)

  await supabase
    .from("seeding_runs")
    .update(runUpdate)
    .eq("id", runId);

  return {
    retried: true,
    batchId,
    batchIndex: batch.batch_index,
    tileIndex: batch.tile_index,
    category: batch.seeding_category,
    categoryLabel: config.label,
    status: batchStatus,
    retryCount: (batch.retry_count || 0) + 1,
    result: {
      placesReturned,
      rejectedNoPhotos,
      rejectedClosed,
      rejectedExcludedType,
      newInserted,
      duplicateSkipped,
      costUsd,
      error: errorMessage,
    },
  };
}

// ── Action: skip_batch ───────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function handleSkipBatch(body: any, supabase: any) {
  const { runId, batchId } = body;
  if (!runId || !batchId) throw new Error("runId and batchId are required");

  // Load batch and verify it's pending
  const { data: batch, error: batchErr } = await supabase
    .from("seeding_batches")
    .select("*")
    .eq("id", batchId)
    .eq("run_id", runId)
    .single();

  if (batchErr || !batch) throw new Error("Batch not found");
  if (!["pending", "failed"].includes(batch.status)) {
    throw new Error(`Batch status is '${batch.status}' — can only skip pending or failed batches`);
  }

  const wasFailed = batch.status === "failed";

  // Mark as skipped
  await supabase
    .from("seeding_batches")
    .update({ status: "skipped", completed_at: new Date().toISOString() })
    .eq("id", batchId);

  // Update run
  const { data: run } = await supabase
    .from("seeding_runs")
    .select("*")
    .eq("id", runId)
    .single();

  if (run) {
    // Check for remaining actionable batches (pending or failed)
    const { data: pendingLeft } = await supabase
      .from("seeding_batches")
      .select("id")
      .eq("run_id", runId)
      .eq("status", "pending")
      .limit(1);

    const { data: failedLeft } = await supabase
      .from("seeding_batches")
      .select("id")
      .eq("run_id", runId)
      .eq("status", "failed")
      .limit(1);

    const noPending = !pendingLeft || pendingLeft.length === 0;
    const noFailed = !failedLeft || failedLeft.length === 0;
    const isDone = noPending && noFailed;

    const runUpdateData: Record<string, unknown> = {
      skipped_batches: (run.skipped_batches || 0) + 1,
    };

    // If skipping a failed batch, correct the failed counter
    if (wasFailed) {
      runUpdateData.failed_batches = run.failed_batches - 1;
    }

    if (isDone) {
      runUpdateData.status = "completed";
      runUpdateData.current_batch_index = null;
      runUpdateData.completed_at = new Date().toISOString();
    }

    await supabase
      .from("seeding_runs")
      .update(runUpdateData)
      .eq("id", runId);
  }

  return { skipped: true, batchId, batchIndex: batch.batch_index, wasFailed };
}

// ── Action: cancel_run ───────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function handleCancelRun(body: any, supabase: any) {
  const { runId } = body;
  if (!runId) throw new Error("runId is required");

  const { data: run, error: runErr } = await supabase
    .from("seeding_runs")
    .select("*")
    .eq("id", runId)
    .single();

  if (runErr || !run) throw new Error("Run not found");
  if (["completed", "cancelled", "failed_preparing"].includes(run.status)) {
    throw new Error(`Run is already '${run.status}'`);
  }

  // Count pending batches BEFORE marking them skipped (for accurate skipped_batches)
  const { count: pendingCount } = await supabase
    .from("seeding_batches")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("status", "pending");

  const skippedNow = pendingCount ?? 0;

  // Mark all pending batches as skipped
  await supabase
    .from("seeding_batches")
    .update({ status: "skipped", completed_at: new Date().toISOString() })
    .eq("run_id", runId)
    .eq("status", "pending");

  // Mark run as cancelled WITH correct skipped_batches count
  await supabase
    .from("seeding_runs")
    .update({
      status: "cancelled",
      current_batch_index: null,
      skipped_batches: (run.skipped_batches || 0) + skippedNow,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);

  return {
    cancelled: true,
    runId,
    completedBatches: run.completed_batches,
    failedBatches: run.failed_batches,
    skippedBatches: (run.skipped_batches || 0) + skippedNow,
  };
}

// ── Action: run_status ───────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function handleRunStatus(body: any, supabase: any) {
  const { runId } = body;
  if (!runId) throw new Error("runId is required");

  const { data: run, error: runErr } = await supabase
    .from("seeding_runs")
    .select("*")
    .eq("id", runId)
    .single();

  if (runErr || !run) throw new Error("Run not found");

  // Load all batches
  const { data: batches } = await supabase
    .from("seeding_batches")
    .select("*")
    .eq("run_id", runId)
    .order("batch_index");

  // Load city + tiles for context
  const { data: city } = await supabase
    .from("seeding_cities")
    .select("name, country, center_lat, center_lng")
    .eq("id", run.city_id)
    .single();

  return {
    run,
    batches: batches || [],
    city,
  };
}

// ── Action: geocode_city ────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function handleGeocodeCity(body: any) {
  const { query } = body;
  if (!query || typeof query !== "string" || query.trim().length < 2) {
    throw new Error("query is required (min 2 characters)");
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${
    encodeURIComponent(query.trim())
  }&key=${GOOGLE_API_KEY}`;

  const res = await timeoutFetch(url, { method: "GET" }, API_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error(`Geocoding API HTTP ${res.status}`);
  }

  const data = await res.json();

  if (data.status !== "OK" || !data.results || data.results.length === 0) {
    throw new Error(
      data.status === "REQUEST_DENIED"
        ? "Geocoding API not enabled. Enable it in Google Cloud Console."
        : `Geocoding failed: ${data.status} — ${data.error_message || "no results"}`
    );
  }

  const result = data.results[0];
  const geo = result.geometry;

  // Extract country and country code from address_components
  let country = "";
  let countryCode = "";
  let cityName = "";
  for (const comp of (result.address_components || [])) {
    if (comp.types?.includes("country")) {
      country = comp.long_name || "";
      countryCode = comp.short_name || "";
    }
    if (comp.types?.includes("locality")) {
      cityName = comp.long_name || "";
    }
  }

  // Fallback city name: first part of formatted_address
  if (!cityName) {
    cityName = (result.formatted_address || query).split(",")[0].trim();
  }

  return {
    cityName,
    country,
    countryCode,
    formattedAddress: result.formatted_address || "",
    center: {
      lat: geo.location.lat,
      lng: geo.location.lng,
    },
    viewport: {
      swLat: geo.viewport.southwest.lat,
      swLng: geo.viewport.southwest.lng,
      neLat: geo.viewport.northeast.lat,
      neLng: geo.viewport.northeast.lng,
    },
    tileEstimates: calculateTileEstimates(
      geo.viewport.southwest.lat,
      geo.viewport.southwest.lng,
      geo.viewport.northeast.lat,
      geo.viewport.northeast.lng,
    ),
  };
}

// ── Main Handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return json({ error: "No authorization header" }, 401);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Admin check
    const { data: adminRow } = await supabase
      .from("admin_users")
      .select("id")
      .eq("email", user.email)
      .eq("status", "active")
      .maybeSingle();

    if (!adminRow) {
      return json({ error: "Forbidden: admin access required" }, 403);
    }

    const body = await req.json();

    switch (body.action) {
      case "geocode_city":
        return json(await handleGeocodeCity(body));
      case "generate_tiles":
        return json(await handleGenerateTiles(body, supabase));
      case "preview_cost":
        return json(await handlePreviewCost(body, supabase));
      case "coverage_check":
        return json(await handleCoverageCheck(body, supabase));
      case "create_run":
        return json(await handleCreateRun(body, supabase));
      case "run_next_batch":
        return json(await handleRunNextBatch(body, supabase));
      case "retry_batch":
        return json(await handleRetryBatch(body, supabase));
      case "skip_batch":
        return json(await handleSkipBatch(body, supabase));
      case "cancel_run":
        return json(await handleCancelRun(body, supabase));
      case "run_status":
        return json(await handleRunStatus(body, supabase));
      default:
        return json({ error: `Unknown action: ${body.action}` }, 400);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
