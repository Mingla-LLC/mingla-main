import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timeoutFetch } from "../_shared/timeoutFetch.ts";
import {
  SEEDING_CATEGORIES,
  SEEDING_CATEGORY_MAP,
  ALL_SEEDING_CATEGORY_IDS,
  type SeedingCategoryConfig,
} from "../_shared/seedingCategories.ts";
import { GLOBAL_EXCLUDED_PLACE_TYPES, getExcludedTypesForCategory } from "../_shared/categoryPlaceTypes.ts";

// ── Admin Seed Places Edge Function ──────────────────────────────────────────
// Three actions:
//   1. generate_tiles — compute tile grid from city center + radius
//   2. preview_cost   — calculate cost estimate, enforce $70 hard cap
//   3. seed           — execute seeding per tile × category via Nearby Search

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
  "places.photos",
  "places.websiteUri",
  "places.businessStatus",
].join(",");

const COST_PER_NEARBY_SEARCH = 0.032;
const COST_PER_PHOTO = 0.007;
const HARD_CAP_USD = 70;
const EXPECTED_UNIQUE_PLACES_PER_TILE = 10; // conservative estimate for photo cost
const PHOTOS_PER_PLACE = 5;
const TILE_DELAY_MS = 100;
const MAX_CONCURRENT_CATEGORIES = 4;
const API_TIMEOUT_MS = 10000;

const PRICE_LEVEL_MAP: Record<string, { tier: string; min: number; max: number }> = {
  PRICE_LEVEL_FREE: { tier: "chill", min: 0, max: 0 },
  PRICE_LEVEL_INEXPENSIVE: { tier: "chill", min: 5, max: 15 },
  PRICE_LEVEL_MODERATE: { tier: "comfy", min: 15, max: 40 },
  PRICE_LEVEL_EXPENSIVE: { tier: "bougie", min: 40, max: 100 },
  PRICE_LEVEL_VERY_EXPENSIVE: { tier: "lavish", min: 100, max: 500 },
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

function generateTileGrid(
  centerLat: number,
  centerLng: number,
  coverageRadiusKm: number,
  tileRadiusM: number,
): TileData[] {
  const coverageRadiusM = coverageRadiusKm * 1000;
  const spacingM = tileRadiusM * 1.4;

  // Convert to degrees (approximate)
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng =
    111320 * Math.cos((centerLat * Math.PI) / 180);

  const spacingLat = spacingM / metersPerDegreeLat;
  const spacingLng = spacingM / metersPerDegreeLng;

  const boundLat = coverageRadiusM / metersPerDegreeLat;
  const boundLng = coverageRadiusM / metersPerDegreeLng;

  const minLat = centerLat - boundLat;
  const maxLat = centerLat + boundLat;
  const minLng = centerLng - boundLng;
  const maxLng = centerLng + boundLng;

  const tiles: TileData[] = [];
  let tileIndex = 0;
  let rowIdx = 0;

  for (let lat = minLat; lat <= maxLat; lat += spacingLat) {
    let colIdx = 0;
    for (let lng = minLng; lng <= maxLng; lng += spacingLng) {
      // Filter out tiles outside coverage circle
      const dLat = (lat - centerLat) * metersPerDegreeLat;
      const dLng = (lng - centerLng) * metersPerDegreeLng;
      const distM = Math.sqrt(dLat * dLat + dLng * dLng);

      if (distM <= coverageRadiusM) {
        tiles.push({
          tile_index: tileIndex++,
          center_lat: lat,
          center_lng: lng,
          radius_m: tileRadiusM,
          row_idx: rowIdx,
          col_idx: colIdx,
        });
      }
      colIdx++;
    }
    rowIdx++;
  }

  return tiles;
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
    opening_hours: gPlace.regularOpeningHours ?? null,
    photos: photos.map((p) => ({
      name: p.name,
      widthPx: p.widthPx,
      heightPx: p.heightPx,
    })),
    website: gPlace.websiteUri ?? null,
    raw_google_data: gPlace,
    fetched_via: "nearby_search",
    last_detail_refresh: new Date().toISOString(),
    refresh_failures: 0,
    is_active: true,
    city_id: cityId,
    seeding_category: seedingCategory,
    country: country,
    city: city,
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
function applyPostFetchFilters(places: any[], categoryId: string): FilterResult {
  let rejectedNoPhotos = 0;
  let rejectedClosed = 0;
  let rejectedExcludedType = 0;

  // PER-CATEGORY TYPE EXCLUSION (Block 2 — hardened 2026-03-21)
  // Checks ALL types (not just primaryType) against full exclusion set.
  // getExcludedTypesForCategory returns global + category-specific exclusions.
  // This prevents places with excluded secondary types from entering the pool.
  const excludedTypes = getExcludedTypesForCategory(categoryId);
  const excludedSet = new Set(excludedTypes);

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
    // Check ALL types (not just primaryType) against full exclusion set (global + category-specific)
    const placeTypes: string[] = p.types ?? [];
    if (placeTypes.some((t: string) => excludedSet.has(t))) {
      rejectedExcludedType++;
      return false;
    }
    return true;
  });

  return { passed, rejectedNoPhotos, rejectedClosed, rejectedExcludedType };
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

// ── Delay helper ────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

  // Generate tile grid
  const tiles = generateTileGrid(
    city.center_lat,
    city.center_lng,
    city.coverage_radius_km,
    city.tile_radius_m,
  );

  // Delete existing tiles for regeneration
  await supabase.from("seeding_tiles").delete().eq("city_id", cityId);

  // Insert new tiles
  const tileRows = tiles.map((t) => ({
    city_id: cityId,
    ...t,
  }));

  const { data: inserted, error: insertErr } = await supabase
    .from("seeding_tiles")
    .insert(tileRows)
    .select("id, tile_index, center_lat, center_lng, radius_m, row_idx, col_idx");

  if (insertErr) throw new Error(`Failed to insert tiles: ${insertErr.message}`);

  return {
    cityId,
    tileCount: inserted.length,
    tiles: inserted.map((t: Record<string, unknown>) => ({
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
  const { cityId, categories, tileIds } = body;
  if (!cityId) throw new Error("cityId is required");

  // Resolve categories
  const categoryIds: string[] =
    !categories || categories[0] === "all"
      ? ALL_SEEDING_CATEGORY_IDS
      : categories;

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

// ── Action: seed ────────────────────────────────────────────────────────────

interface TileError {
  tile_id: string;
  tile_index: number;
  category: string;
  error_type: "google_api" | "timeout" | "parse" | "upsert" | "unknown";
  http_status?: number;
  response_body?: string;
  message: string;
  timestamp: string;
}

// deno-lint-ignore no-explicit-any
async function seedCategory(
  config: SeedingCategoryConfig,
  tiles: Array<{ id: string; tile_index: number; center_lat: number; center_lng: number; radius_m: number }>,
  cityId: string,
  cityName: string,
  cityCountry: string,
  dryRun: boolean,
  supabase: any,
): Promise<{
  apiCalls: number;
  placesReturned: number;
  rejected: { noPhotos: number; closed: number; excludedType: number };
  newInserted: number;
  duplicateSkipped: number;
  errors: TileError[];
  costUsd: number;
}> {
  const errors: TileError[] = [];
  let apiCalls = 0;
  let placesReturned = 0;
  let totalRejectedNoPhotos = 0;
  let totalRejectedClosed = 0;
  let totalRejectedExcludedType = 0;
  let newInserted = 0;
  let duplicateSkipped = 0;

  // deno-lint-ignore no-explicit-any
  const allPassedPlaces: any[] = [];

  for (const tile of tiles) {
    apiCalls++;

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
        const errorType =
          response.status === 408 || response.status === 504
            ? "timeout"
            : "google_api";
        errors.push({
          tile_id: tile.id,
          tile_index: tile.tile_index,
          category: config.id,
          error_type: errorType,
          http_status: response.status,
          response_body: respBody.substring(0, 500),
          message: `Google API ${response.status}: ${respBody.substring(0, 200)}`,
          timestamp: new Date().toISOString(),
        });
        // Continue to next tile — do not abort
        await delay(TILE_DELAY_MS);
        continue;
      }

      // deno-lint-ignore no-explicit-any
      let data: any;
      try {
        data = await response.json();
      } catch (parseErr) {
        errors.push({
          tile_id: tile.id,
          tile_index: tile.tile_index,
          category: config.id,
          error_type: "parse",
          message: `JSON parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
          timestamp: new Date().toISOString(),
        });
        await delay(TILE_DELAY_MS);
        continue;
      }

      const places = data.places || [];
      placesReturned += places.length;

      // Apply post-fetch filters
      const { passed, rejectedNoPhotos, rejectedClosed, rejectedExcludedType } =
        applyPostFetchFilters(places, config.id);
      totalRejectedNoPhotos += rejectedNoPhotos;
      totalRejectedClosed += rejectedClosed;
      totalRejectedExcludedType += rejectedExcludedType;

      allPassedPlaces.push(...passed);
    } catch (err) {
      const isTimeout =
        err instanceof DOMException && err.name === "AbortError";
      errors.push({
        tile_id: tile.id,
        tile_index: tile.tile_index,
        category: config.id,
        error_type: isTimeout ? "timeout" : "unknown",
        message: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
    }

    await delay(TILE_DELAY_MS);
  }

  // Deduplicate by google_place_id
  // deno-lint-ignore no-explicit-any
  const uniquePlaces = new Map<string, any>();
  for (const p of allPassedPlaces) {
    if (p.id && !uniquePlaces.has(p.id)) {
      uniquePlaces.set(p.id, p);
    }
  }

  // Upsert to place_pool (unless dry run)
  if (!dryRun && uniquePlaces.size > 0) {
    const rows = Array.from(uniquePlaces.values()).map((p) =>
      transformGooglePlaceForSeed(p, cityId, config.id, parseCountry(p.formattedAddress, cityCountry), parseCity(p, cityName))
    );

    // Batch upsert — selective: only overwrite Google-sourced fields
    // We use ignoreDuplicates: false with onConflict to do a real upsert
    // but Supabase JS upsert overwrites all columns. To preserve admin-edited
    // fields we use a raw SQL approach via RPC or a careful two-step:
    // 1. Attempt insert with ignoreDuplicates: true to get genuinely new places
    // 2. For existing places, update only Google-sourced fields

    // Step 1: Insert new places only
    const { data: insertedData, error: insertErr } = await supabase
      .from("place_pool")
      .upsert(rows, { onConflict: "google_place_id", ignoreDuplicates: true })
      .select("google_place_id");

    if (insertErr) {
      errors.push({
        tile_id: "",
        tile_index: -1,
        category: config.id,
        error_type: "upsert",
        message: `Batch insert error: ${insertErr.message}`,
        timestamp: new Date().toISOString(),
      });
    }

    const insertedIds = new Set(
      (insertedData ?? []).map((r: { google_place_id: string }) => r.google_place_id)
    );

    newInserted = insertedIds.size;

    // Step 2: For existing places, selectively update Google-sourced fields only
    // Batched in chunks of 10 to reduce N+1 overhead
    const existingRows = rows.filter((r) => !insertedIds.has(r.google_place_id));
    duplicateSkipped = existingRows.length;
    const BATCH_SIZE = 10;

    for (let i = 0; i < existingRows.length; i += BATCH_SIZE) {
      const batch = existingRows.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((row) =>
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
              // Preserve: price_tier, price_min, price_max, is_active,
              //           stored_photo_urls, city_id, seeding_category,
              //           city, country
            })
            .eq("google_place_id", row.google_place_id)
        ),
      );

      for (let j = 0; j < results.length; j++) {
        if (results[j].error) {
          errors.push({
            tile_id: "",
            tile_index: -1,
            category: config.id,
            error_type: "upsert",
            message: `Update ${batch[j].google_place_id}: ${results[j].error.message}`,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  } else if (dryRun) {
    // In dry run we can't know which are truly new vs duplicate without querying,
    // so report unique count as "would process" — not "new inserted"
    duplicateSkipped = 0;
    // Leave newInserted at 0 — dry run didn't insert anything
  }

  return {
    apiCalls,
    placesReturned,
    rejected: {
      noPhotos: totalRejectedNoPhotos,
      closed: totalRejectedClosed,
      excludedType: totalRejectedExcludedType,
    },
    newInserted,
    duplicateSkipped,
    errors,
    costUsd: apiCalls * COST_PER_NEARBY_SEARCH,
  };
}

// deno-lint-ignore no-explicit-any
async function handleSeed(body: any, supabase: any) {
  const { cityId, categories, tileIds, dryRun, acknowledgeHardCap } = body;
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
    .map((id) => SEEDING_CATEGORY_MAP[id])
    .filter(Boolean) as SeedingCategoryConfig[];

  if (validConfigs.length === 0) {
    throw new Error("No valid seeding categories provided");
  }

  // Load tiles
  let tileQuery = supabase
    .from("seeding_tiles")
    .select("id, tile_index, center_lat, center_lng, radius_m")
    .eq("city_id", cityId)
    .order("tile_index");
  if (tileIds && tileIds.length > 0) {
    tileQuery = tileQuery.in("id", tileIds);
  }
  const { data: tiles, error: tileErr } = await tileQuery;
  if (tileErr) throw new Error(`Failed to load tiles: ${tileErr.message}`);
  if (!tiles || tiles.length === 0) {
    throw new Error("No tiles found. Generate tiles first.");
  }

  // Check $70 cap — same formula as preview_cost (search + estimated photo cost)
  const estimatedSearchCost = tiles.length * validConfigs.length * COST_PER_NEARBY_SEARCH;
  const estimatedPhotoCost = tiles.length * EXPECTED_UNIQUE_PLACES_PER_TILE * PHOTOS_PER_PLACE * COST_PER_PHOTO;
  const estimatedTotalCost = estimatedSearchCost + estimatedPhotoCost;
  if (estimatedTotalCost > HARD_CAP_USD && !acknowledgeHardCap) {
    throw new Error(
      `Estimated cost $${estimatedTotalCost.toFixed(2)} exceeds $${HARD_CAP_USD} cap. Set acknowledgeHardCap: true to proceed.`
    );
  }

  // Update city status
  await supabase
    .from("seeding_cities")
    .update({ status: "seeding", updated_at: new Date().toISOString() })
    .eq("id", cityId);

  // Process categories with limited concurrency
  const operationIds: string[] = [];
  const perCategory: Record<string, unknown> = {};

  const summaryTotals = {
    totalApiCalls: 0,
    totalPlacesReturned: 0,
    totalRejected: { noPhotos: 0, closed: 0, excludedType: 0 },
    totalNewInserted: 0,
    totalDuplicateSkipped: 0,
    estimatedCostUsd: 0,
  };

  // Process in batches of MAX_CONCURRENT_CATEGORIES
  for (let i = 0; i < validConfigs.length; i += MAX_CONCURRENT_CATEGORIES) {
    const batch = validConfigs.slice(i, i + MAX_CONCURRENT_CATEGORIES);

    const batchResults = await Promise.all(
      batch.map(async (config) => {
        // Create operation record
        const { data: opRow, error: opErr } = await supabase
          .from("seeding_operations")
          .insert({
            city_id: cityId,
            seeding_category: config.id,
            app_category: config.appCategory,
            status: "running",
            started_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (opErr) {
          console.error(`Failed to create operation: ${opErr.message}`);
          return null;
        }

        const opId = opRow.id;

        try {
          const result = await seedCategory(
            config,
            tiles,
            cityId,
            city.name,
            city.country,
            dryRun ?? false,
            supabase,
          );

          // Build error_details JSONB
          const errorDetails =
            result.errors.length > 0
              ? {
                  tile_errors: result.errors,
                  summary: {
                    total_tile_calls: result.apiCalls,
                    successful_calls:
                      result.apiCalls - result.errors.length,
                    failed_calls: result.errors.length,
                    error_types: result.errors.reduce(
                      (acc: Record<string, number>, e) => {
                        acc[e.error_type] = (acc[e.error_type] || 0) + 1;
                        return acc;
                      },
                      {},
                    ),
                  },
                }
              : null;

          // Update operation record
          await supabase
            .from("seeding_operations")
            .update({
              status: result.errors.length > 0 && result.newInserted === 0 ? "failed" : "completed",
              google_api_calls: result.apiCalls,
              places_returned: result.placesReturned,
              places_rejected_no_photos: result.rejected.noPhotos,
              places_rejected_closed: result.rejected.closed,
              places_rejected_excluded_type: result.rejected.excludedType,
              places_new_inserted: result.newInserted,
              places_duplicate_skipped: result.duplicateSkipped,
              estimated_cost_usd: result.costUsd,
              error_message:
                result.errors.length > 0
                  ? `${result.errors.length} tile(s) had errors`
                  : null,
              error_details: errorDetails,
              completed_at: new Date().toISOString(),
            })
            .eq("id", opId);

          return { opId, config, result };
        } catch (err) {
          await supabase
            .from("seeding_operations")
            .update({
              status: "failed",
              error_message: err instanceof Error ? err.message : String(err),
              completed_at: new Date().toISOString(),
            })
            .eq("id", opId);
          return { opId, config, result: null, error: err };
        }
      }),
    );

    for (const br of batchResults) {
      if (!br) continue;
      operationIds.push(br.opId);
      if (br.result) {
        perCategory[br.config.id] = {
          apiCalls: br.result.apiCalls,
          placesReturned: br.result.placesReturned,
          rejected: br.result.rejected,
          newInserted: br.result.newInserted,
          duplicateSkipped: br.result.duplicateSkipped,
          errors: br.result.errors.map((e: TileError) => ({
            tileIndex: e.tile_index,
            errorType: e.error_type,
            message: e.message,
          })),
        };
        summaryTotals.totalApiCalls += br.result.apiCalls;
        summaryTotals.totalPlacesReturned += br.result.placesReturned;
        summaryTotals.totalRejected.noPhotos += br.result.rejected.noPhotos;
        summaryTotals.totalRejected.closed += br.result.rejected.closed;
        summaryTotals.totalRejected.excludedType += br.result.rejected.excludedType;
        summaryTotals.totalNewInserted += br.result.newInserted;
        summaryTotals.totalDuplicateSkipped += br.result.duplicateSkipped;
        summaryTotals.estimatedCostUsd += br.result.costUsd;
      }
    }
  }

  // Update city status — only "seeded" if at least one place was inserted
  const newStatus = summaryTotals.totalNewInserted > 0 ? "seeded" : "draft";
  await supabase
    .from("seeding_cities")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", cityId);

  return {
    operationIds,
    summary: {
      ...summaryTotals,
      estimatedCostUsd:
        Math.round(summaryTotals.estimatedCostUsd * 100) / 100,
    },
    perCategory,
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
      case "generate_tiles":
        return json(await handleGenerateTiles(body, supabase));
      case "preview_cost":
        return json(await handlePreviewCost(body, supabase));
      case "seed":
        return json(await handleSeed(body, supabase));
      default:
        return json({ error: `Unknown action: ${body.action}` }, 400);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
