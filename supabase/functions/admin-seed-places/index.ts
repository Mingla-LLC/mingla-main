import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timeoutFetch } from "../_shared/timeoutFetch.ts";
import { fetchWithGoogleBackoff } from "../_shared/googleBackoff.ts";
import {
  SEEDING_CATEGORIES,
  SEEDING_CATEGORY_MAP,
  ALL_SEEDING_CATEGORY_IDS,
  resolveCategoriesToConfigs,
  resolveSeedingCategory,
  type SeedingCategoryConfig,
} from "../_shared/seedingCategories.ts";
import {
  adminEditsByGooglePlaceId,
  buildSeedMergeUpdate,
  COVERAGE_PAGE_SIZE,
  loadAllCoverageRows,
} from "../_shared/placeGoogleMerge.ts";
import { derivePoolCategory } from "../_shared/derivePoolCategory.ts";
import {
  COST_PER_NEARBY_SEARCH,
  COST_PER_PHOTO,
  countGridTiles,
  EXPECTED_UNIQUE_PLACES_PER_TILE,
  HIGH_COST_USD,
  metersPerDegreeLng,
  METERS_PER_DEGREE_LAT,
  PHOTOS_PER_PLACE,
} from "../_shared/seedingGeometry.ts";
import {
  applyCityBox,
  citiesSearchStatus,
  citySearchStatus,
  generateTilesForCity,
  type GeocodeResult,
  PipelineRefusal,
  placesOutsideBox,
  planCityBox,
  previewFill,
  previewSplitLevel,
  retiredTileHistory,
  runCompletenessCheck,
  startFill,
  startSplitLevel,
} from "./searchPipeline.ts";
// Phase 2: type exclusion imports removed — AI is the sole quality gate
// import { GLOBAL_EXCLUDED_PLACE_TYPES, getExcludedTypesForCategory } from "../_shared/categoryPlaceTypes.ts";
import { seedCountryFields } from "./countryLogic.ts";

// ── Admin Seed Places Edge Function ──────────────────────────────────────────
// Actions:
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
//   One pipeline (#4276, see searchPipeline.ts):
//    preview_fill, start_fill, preview_split_level, start_split_level,
//    run_completeness_check, city_search_status, plan_city_box, apply_city_box,
//    places_outside_box, retired_tile_history

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const NEARBY_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchNearby";

// ORCH-0550.1 — Authoritative Google Places v1 FieldMask (48 fields).
// Invariants enforced:
//   I-FIELD-MASK-SINGLE-OWNER   — this list is the source of truth; admin-refresh-places
//                                 and admin-place-search mirror it field-for-field.
//   I-REFRESH-NEVER-DEGRADES    — refresh mask must be a SUPERSET of this list. Never trim.
// If you add fields here, also add corresponding columns (place_pool) and persistence
// logic in transformGooglePlaceForSeed + handleRunNextBatch + handleRetryBatch updates.
const FIELD_MASK = [
  // Identity
  "places.id",
  "places.displayName",
  "places.primaryTypeDisplayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.primaryType",

  // Ratings & price
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.priceRange",

  // Hours & photos
  "places.regularOpeningHours",
  // ORCH-0598.11.R-002 — `places.secondaryOpeningHours` removed from searchNearby
  // FieldMask. The new Google project (862310931802) hard-rejects it with
  // INVALID_ARGUMENT (old project silently dropped). admin-refresh-places'
  // DETAIL_FIELD_MASK already excluded it for the detail GET endpoint; this
  // change aligns seed with refresh. Field is still written by the transform
  // and update blocks as null-safe `gPlace.secondaryOpeningHours ?? null` —
  // undefined input → null output, no regression.
  "places.utcOffsetMinutes",
  "places.photos",

  // Links
  "places.websiteUri",
  "places.googleMapsUri",
  "places.nationalPhoneNumber",

  // Operational state
  "places.businessStatus",

  // Content (AI-heavy)
  "places.editorialSummary",
  "places.generativeSummary",
  "places.reviews",

  // Meal service booleans
  "places.servesBrunch",
  "places.servesLunch",
  "places.servesDinner",
  "places.servesBreakfast",
  "places.servesBeer",
  "places.servesWine",
  "places.servesCocktails",
  "places.servesCoffee",
  "places.servesDessert",
  "places.servesVegetarianFood",

  // Ambience & amenities
  "places.outdoorSeating",
  "places.liveMusic",
  "places.goodForGroups",
  "places.goodForChildren",
  "places.goodForWatchingSports",
  "places.allowsDogs",
  "places.restroom",
  "places.reservable",
  "places.menuForChildren",

  // Service options
  "places.dineIn",
  "places.takeout",
  "places.delivery",
  "places.curbsidePickup",

  // Access & facilities
  "places.accessibilityOptions",
  "places.parkingOptions",
  "places.paymentOptions",
].join(",");

const HARD_CAP_USD = HIGH_COST_USD;
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

// ── Tile Estimate Calculator (pure math, no DB) ────────────────────────────

function calculateTileEstimates(
  swLat: number, swLng: number, neLat: number, neLng: number,
) {
  const box = { swLat, swLng, neLat, neLng };
  const extentLatKm = (neLat - swLat) * METERS_PER_DEGREE_LAT / 1000;
  const extentLngKm = (neLng - swLng) * metersPerDegreeLng((swLat + neLat) / 2) / 1000;

  function countTiles(tileRadiusM: number): { tiles: number; apiCalls: number; searchCostUsd: number } {
    const tiles = countGridTiles(box, tileRadiusM);
    const apiCalls = tiles * SEEDING_CATEGORIES.length;
    const searchCostUsd = Math.round(apiCalls * COST_PER_NEARBY_SEARCH * 100) / 100;
    return { tiles, apiCalls, searchCostUsd };
  }

  return {
    atRadius1500: countTiles(1500),
    atRadius2000: countTiles(2000),
    atRadius2500: countTiles(2500),
    extentLatKm: Math.round(extentLatKm * 10) / 10,
    extentLngKm: Math.round(extentLngKm * 10) / 10,
    areaKm2: Math.round(extentLatKm * extentLngKm),
  };
}

// ── Google Place → place_pool row (selective fields for upsert) ─────────────

// deno-lint-ignore no-explicit-any
function transformGooglePlaceForSeed(
  // deno-lint-ignore no-explicit-any
  gPlace: any,
  cityId: string,
  country: string,
  city: string,
  // #1704 — ISO-3166-1 alpha-2 from `seeding_cities.country_code`. Passed
  // explicitly rather than left to the trigger so the row is correct at the
  // moment it is built, not one statement later.
  countryCode: string | null,
) {
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

  // ORCH-0550.1 — Nested field extractors. Google v1 returns some fields as
  // { text: "..." } objects or as nested structures; pull to flat primitives here.
  const editorialSummaryText = (gPlace.editorialSummary as { text?: string } | undefined)?.text ?? null;
  const generativeSummaryText =
    (gPlace.generativeSummary as { overview?: { text?: string } } | undefined)?.overview?.text ?? null;
  const primaryTypeDisplayNameText =
    (gPlace.primaryTypeDisplayName as { text?: string } | undefined)?.text ?? null;

  // priceRange is { startPrice: { currencyCode, units }, endPrice: { currencyCode, units } }
  // units is a string in Google's response (e.g. "50"); parseInt then ×100 to store cents.
  const priceRange = gPlace.priceRange as
    | {
        startPrice?: { currencyCode?: string; units?: string };
        endPrice?: { currencyCode?: string; units?: string };
      }
    | undefined;
  const priceRangeCurrency =
    priceRange?.startPrice?.currencyCode ?? priceRange?.endPrice?.currencyCode ?? null;
  const priceRangeStartCents = priceRange?.startPrice?.units
    ? parseInt(priceRange.startPrice.units, 10) * 100
    : null;
  const priceRangeEndCents = priceRange?.endPrice?.units
    ? parseInt(priceRange.endPrice.units, 10) * 100
    : null;

  return {
    google_place_id: gPlace.id as string,
    name: displayName?.text ?? "Unknown",
    address: gPlace.formattedAddress ?? null,
    lat: location?.latitude ?? 0,
    lng: location?.longitude ?? 0,
    types: gPlace.types ?? [],
    primary_type: gPlace.primaryType ?? null,
    primary_type_display_name: primaryTypeDisplayNameText,
    rating: gPlace.rating ?? null,
    review_count: gPlace.userRatingCount ?? 0,
    price_level: priceLevel ?? null,
    price_min: priceInfo.min,
    price_max: priceInfo.max,
    price_tier: priceInfo.tier,
    price_tiers: priceInfo.tier ? [priceInfo.tier] : [],
    price_range_currency: priceRangeCurrency,
    price_range_start_cents: priceRangeStartCents,
    price_range_end_cents: priceRangeEndCents,
    opening_hours: gPlace.regularOpeningHours ?? null,
    secondary_opening_hours: gPlace.secondaryOpeningHours ?? null,
    photos: photos.map((p) => ({
      name: p.name,
      widthPx: p.widthPx,
      heightPx: p.heightPx,
    })),
    website: gPlace.websiteUri ?? null,
    google_maps_uri: gPlace.googleMapsUri ?? null,
    national_phone_number: gPlace.nationalPhoneNumber ?? null,
    business_status: gPlace.businessStatus ?? null,
    editorial_summary: editorialSummaryText,
    generative_summary: generativeSummaryText,
    reviews: gPlace.reviews ?? null,

    // Meal service booleans (null = unknown; false = Google confirms not served)
    serves_brunch: gPlace.servesBrunch ?? null,
    serves_lunch: gPlace.servesLunch ?? null,
    serves_dinner: gPlace.servesDinner ?? null,
    serves_breakfast: gPlace.servesBreakfast ?? null,
    serves_beer: gPlace.servesBeer ?? null,
    serves_wine: gPlace.servesWine ?? null,
    serves_cocktails: gPlace.servesCocktails ?? null,
    serves_coffee: gPlace.servesCoffee ?? null,
    serves_dessert: gPlace.servesDessert ?? null,
    serves_vegetarian_food: gPlace.servesVegetarianFood ?? null,

    // Ambience & amenities
    outdoor_seating: gPlace.outdoorSeating ?? null,
    live_music: gPlace.liveMusic ?? null,
    good_for_groups: gPlace.goodForGroups ?? null,
    good_for_children: gPlace.goodForChildren ?? null,
    good_for_watching_sports: gPlace.goodForWatchingSports ?? null,
    allows_dogs: gPlace.allowsDogs ?? null,
    has_restroom: gPlace.restroom ?? null,
    reservable: gPlace.reservable ?? null,
    menu_for_children: gPlace.menuForChildren ?? null,

    // Service options
    dine_in: gPlace.dineIn ?? null,
    takeout: gPlace.takeout ?? null,
    delivery: gPlace.delivery ?? null,
    curbside_pickup: gPlace.curbsidePickup ?? null,

    // Access & facilities (JSONB — stored as Google returns them)
    accessibility_options: gPlace.accessibilityOptions ?? null,
    parking_options: gPlace.parkingOptions ?? null,
    payment_options: gPlace.paymentOptions ?? null,

    raw_google_data: gPlace,
    fetched_via: "nearby_search",
    // #4276 C7: a new place stays hidden until it has finished. This row is only ever
    // inserted (ignoreDuplicates), and the merge update below is an allowlist without
    // this column, so a place that already exists can't become held.
    serving_hold: true,
    last_detail_refresh: new Date().toISOString(),
    refresh_failures: 0,
    is_active: true,
    city_id: cityId,
    country: country,
    country_code: countryCode,
    city: city,
    utc_offset_minutes: (gPlace.utcOffsetMinutes as number) ?? null,
  };
}

// ── Post-fetch filters ──────────────────────────────────────────────────────

interface DroppedResult {
  google_place_id: string;
  reason: "no_photos" | "closed_permanently";
  name: string | null;
  primary_type: string | null;
}

interface FilterResult {
  // deno-lint-ignore no-explicit-any
  passed: any[];
  dropped: DroppedResult[];
  rejectedNoPhotos: number;
  rejectedClosed: number;
  rejectedExcludedType: number;
}

// deno-lint-ignore no-explicit-any
export function applyPostFetchFilters(places: any[], _categoryId: string): FilterResult {
  let rejectedNoPhotos = 0;
  let rejectedClosed = 0;
  const dropped: DroppedResult[] = [];

  // Phase 2: Type exclusions removed — AI is the sole quality gate.
  // All place types now enter the pool. AI validates quality post-seeding.

  // deno-lint-ignore no-explicit-any
  const drop = (p: any, reason: DroppedResult["reason"]) => {
    if (p.id) {
      dropped.push({
        google_place_id: p.id,
        reason,
        name: p.displayName?.text ?? null,
        primary_type: p.primaryType ?? null,
      });
    }
  };
  // deno-lint-ignore no-explicit-any
  const passed = places.filter((p: any) => {
    // Reject permanently closed
    if (p.businessStatus === "CLOSED_PERMANENTLY") {
      rejectedClosed++;
      drop(p, "closed_permanently");
      return false;
    }
    // Reject no photos
    if (!p.photos || p.photos.length === 0) {
      rejectedNoPhotos++;
      drop(p, "no_photos");
      return false;
    }
    return true;
  });

  return { passed, dropped, rejectedNoPhotos, rejectedClosed, rejectedExcludedType: 0 };
}

// ── Country ─────────────────────────────────────────────────────────────────
//
// #1704: `parseCountry` LIVED HERE and is deleted.
//
// It took `formattedAddress`, split on commas and returned the last piece, with
// the seeded city's country as a FALLBACK. Both call sites read
// `parseCountry(p.formattedAddress, cityCountry)` — so the clean, curated value
// was already in hand at the moment of the call, and the parse won over it.
// 88,411 rows were written that way: 'USA', 'UK', 'US' and 'United Kingdom' for
// the same two countries, plus rows reading 'U0邮政编码: SE18 5NR'.
//
// There is nothing to parse. `seeding_cities` carries `country` (prose, for
// display) AND `country_code` (ISO-3166-1 alpha-2, the field anything may branch
// on), and every place we seed belongs to exactly one seeded city. Both are now
// read from that row and passed straight through.
//
// A BEFORE INSERT/UPDATE trigger (`place_pool_fill_country_code_trg`) derives
// `country_code` from `city_id` for any writer that omits it, and a CHECK
// constraint rejects anything that is not two capitals — so this defect cannot
// come back through a different door.

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

// #4276: every page. A larger box can pass the server's row cap, and a capped read
// here would silently leave part of the city unsearched and under-priced.
const TILE_PAGE_SIZE = 1000;

async function loadBaseTiles(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  cityId: string,
  tileIds?: string[],
) {
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  for (let from = 0;; from += TILE_PAGE_SIZE) {
    let query = supabase
      .from("seeding_tiles")
      .select("id, tile_index, center_lat, center_lng, radius_m, row_idx, col_idx")
      .eq("city_id", cityId)
      .is("retired_at", null)
      .in("kind", ["grid", "fill"]);
    if (tileIds && tileIds.length > 0) query = query.in("id", tileIds);
    const { data, error } = await query
      .order("tile_index")
      .range(from, from + TILE_PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to load tiles: ${error.message}`);
    out.push(...(data ?? []));
    if ((data ?? []).length < TILE_PAGE_SIZE) return out;
  }
}

// ── Action: preview_cost ────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function handlePreviewCost(body: any, supabase: any) {
  const { cityId, categories, tileIds, skipSeededCategories } = body;
  if (!cityId) throw new Error("cityId is required");

  // Resolve categories — accepts both old seeding IDs and new app slugs (ORCH-0434)
  let validConfigs: SeedingCategoryConfig[] =
    !categories || categories[0] === "all"
      ? [...SEEDING_CATEGORIES]
      : resolveCategoriesToConfigs(categories);

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
    // Filter by both old ID and new app slug to handle legacy + migrated rows
    validConfigs = validConfigs.filter((c) => !seededCategorySet.has(c.id) && !seededCategorySet.has(c.appCategorySlug));
  }
  const categoryIds = validConfigs.map(c => c.id);

  // Load tiles
  const tiles = await loadBaseTiles(supabase, cityId, tileIds);

  const tileCount = tiles?.length ?? 0;
  const categoryCount = categoryIds.length;
  const totalApiCalls = tileCount * categoryCount;
  const estimatedSearchCost = totalApiCalls * COST_PER_NEARBY_SEARCH;
  const estimatedPhotoCost =
    tileCount * EXPECTED_UNIQUE_PLACES_PER_TILE * PHOTOS_PER_PLACE * COST_PER_PHOTO;
  const estimatedTotalCost = estimatedSearchCost + estimatedPhotoCost;

  const breakdown = categoryIds.map((catId) => {
    const config = resolveSeedingCategory(catId);
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

  // ORCH-0700 Phase 3: count places per Mingla category, derived client-side from
  // primary_type + types (place_pool.seeding_category column dropped in Migration 6).
  // #4276 U5: page through every row. A fixed limit undercounted large cities, and
  // a server row cap can return fewer rows than any limit asks for.
  const rows = await loadAllCoverageRows(async (afterId) => {
    let page = supabase
      .from("place_pool")
      .select("id, primary_type, types")
      .eq("city_id", cityId)
      .eq("is_active", true)
      .order("id")
      .limit(COVERAGE_PAGE_SIZE);
    if (afterId) page = page.gt("id", afterId);
    const { data, error } = await page;
    if (error) throw new Error(`Coverage check failed: ${error.message}`);
    return data ?? [];
  });

  // Tally per derived category (matches the SQL helper byte-for-byte).
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const cat = derivePoolCategory(r.primary_type, r.types) ?? "unknown";
    counts[cat] = (counts[cat] || 0) + 1;
  }

  // Build coverage report grouped by app category slug (ORCH-0434: 10 categories, not 13).
  // The derived helper already returns app-slug-aligned values (e.g. "nature",
  // "casual_food"), so no second-pass aggregation is needed — the legacy
  // SEEDING_CATEGORIES.id → appCategorySlug fan-in disappears.
  const appSlugSet = new Set<string>();
  const appSlugConfigs: { slug: string; label: string; appCategory: string }[] = [];
  for (const cat of SEEDING_CATEGORIES) {
    if (!appSlugSet.has(cat.appCategorySlug)) {
      appSlugSet.add(cat.appCategorySlug);
      appSlugConfigs.push({ slug: cat.appCategorySlug, label: cat.label, appCategory: cat.appCategory });
    }
  }
  const coverage = appSlugConfigs.map(({ slug, label, appCategory }) => {
    const count = counts[slug] || 0;
    return {
      categoryId: slug,
      label,
      appCategory,
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

  // Resolve categories — accepts both old seeding IDs and new app slugs (ORCH-0434)
  const validConfigs = !categories || categories[0] === "all"
    ? [...SEEDING_CATEGORIES]
    : resolveCategoriesToConfigs(categories);

  if (validConfigs.length === 0) {
    throw new Error("No valid seeding categories provided");
  }

  const categoryIds = validConfigs.map((c) => c.appCategorySlug);

  // Load tiles ordered by tile_index
  const tiles = await loadBaseTiles(supabase, cityId);
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
        seeding_category: config.appCategorySlug,
        app_category: config.appCategory,
        // #4276: the category alone can't say which of its configs this search is.
        search_config_id: config.id,
        center_lat: tile.center_lat,
        center_lng: tile.center_lng,
        radius_m: tile.radius_m,
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
    categoryLabel: SEEDING_CATEGORY_MAP[b.search_config_id]?.label ?? b.seeding_category,
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

// ── One search, shared by run_next_batch and retry_batch ─────────────────────

interface SearchCircle {
  center_lat: number;
  center_lng: number;
  radius_m: number;
}

// #4276 T1: a search keeps its own centre and radius. Older rows fall back to the tile.
// deno-lint-ignore no-explicit-any
async function loadSearchCircle(supabase: any, batch: any): Promise<SearchCircle | null> {
  if (batch.center_lat != null && batch.center_lng != null && batch.radius_m != null) {
    return { center_lat: batch.center_lat, center_lng: batch.center_lng, radius_m: batch.radius_m };
  }
  if (!batch.tile_id) return null;
  const { data } = await supabase
    .from("seeding_tiles")
    .select("center_lat, center_lng, radius_m")
    .eq("id", batch.tile_id)
    .single();
  return data ?? null;
}

// #4276: a category can have several configs, and resolving it picks only the first,
// which ran the first config repeatedly and never ran the others. Rows that record
// their config run exactly that one. A recorded config that no longer exists fails
// the batch rather than quietly searching something else.
// deno-lint-ignore no-explicit-any
export function resolveBatchConfig(batch: any): SeedingCategoryConfig | undefined {
  if (batch.search_config_id) return SEEDING_CATEGORY_MAP[batch.search_config_id];
  // Handles both old seeding IDs and new app slugs (ORCH-0434)
  return resolveSeedingCategory(batch.seeding_category);
}

async function executeBatchSearch(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: {
    // deno-lint-ignore no-explicit-any
    batch: any;
    tile: SearchCircle;
    config: SeedingCategoryConfig;
    cityName: string;
    cityCountry: string;
    cityCountryCode: string | null;
  },
) {
  const { batch, tile, config, cityName, cityCountry, cityCountryCode } = args;
  let batchStatus = "completed";
  let errorMessage: string | null = null;
  // deno-lint-ignore no-explicit-any
  let errorDetails: any = null;
  let placesReturned = 0;
  let rejectedNoPhotos = 0;
  let rejectedClosed = 0;
  let rejectedExcludedType = 0;
  let newInserted = 0;
  let duplicateSkipped = 0;

  try {
    const requestBody = {
      // #4276 T5: at the minimum radius a capped search repeats on part of its types.
      includedTypes: batch.included_types_override ?? config.includedTypes,
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

    // #4276 C8: a rate limit waits and tries again rather than failing the search.
    const response = await fetchWithGoogleBackoff(() =>
      timeoutFetch(NEARBY_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_API_KEY,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify(requestBody),
        timeoutMs: API_TIMEOUT_MS,
      })
    );

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

      // #4276 T7: keep which places were dropped. The search itself succeeded, so a
      // failure here is reported on the batch rather than failing it.
      if (filterResult.dropped.length > 0) {
        const seenAt = new Date().toISOString();
        const { error: droppedErr } = await supabase
          .from("seeding_filtered_results")
          .upsert(
            filterResult.dropped.map((d) => ({ ...d, city_id: batch.city_id, last_seen_at: seenAt })),
            { onConflict: "city_id,google_place_id,reason" },
          );
        if (droppedErr) {
          console.error(`[admin-seed-places] dropped results not recorded: ${droppedErr.message}`);
          errorDetails = { filtered_results_error: droppedErr.message };
        }
      }

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
          transformGooglePlaceForSeed(p, batch.city_id, cityCountry, parseCity(p, cityName), cityCountryCode)
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

        // ORCH-0598.11.B-002 — surface per-row update errors instead of swallowing.
        // Previously: Promise.all resolved even when every update returned {error},
        // so 28 dupes silently failed while batch was marked completed.
        // Now: collect errors, log them, throw at batch level so outer catch marks
        // batch=failed and error_details contains the real PostgREST message.
        for (let i = 0; i < existingRows.length; i += UPDATE_BATCH_SIZE) {
          const updateBatch = existingRows.slice(i, i + UPDATE_BATCH_SIZE);
          // #4276 S3: read the admin markers for this batch, and stop rather than risk
          // writing over an admin's edit if they can't be read.
          const { data: markerRows, error: markerErr } = await supabase
            .from("place_pool_admin_edits")
            .select("google_place_id, edited_fields")
            .in("google_place_id", updateBatch.map((r) => r.google_place_id));
          if (markerErr) {
            throw new Error(`admin marker read failed: ${markerErr.message}`);
          }
          const adminEdits = adminEditsByGooglePlaceId(markerRows);
          const results = await Promise.all(
            updateBatch.map((row) =>
              supabase
                .from("place_pool")
                // I-REFRESH-NEVER-DEGRADES: a merge, never a blind overwrite. The columns
                // are an allowlist, which also keeps photo_aesthetic_data
                // (I-PHOTO-AESTHETIC-DATA-SOLE-OWNER) and photo_collage_url + fingerprint
                // (I-COLLAGE-SOLE-OWNER) out of a re-seed.
                .update(buildSeedMergeUpdate(row, adminEdits.get(row.google_place_id)))
                .eq("google_place_id", row.google_place_id)
                .select("google_place_id")
            )
          );
          // deno-lint-ignore no-explicit-any
          const failed = results.filter((r: any) => r.error || !r.data || r.data.length === 0);
          if (failed.length > 0) {
            // deno-lint-ignore no-explicit-any
            const sample = failed.slice(0, 3).map((r: any, idx: number) => {
              const row = updateBatch[results.indexOf(r)];
              return `row#${idx} gpid=${row?.google_place_id ?? '?'} error=${JSON.stringify(r.error ?? 'no rows affected')}`;
            }).join(' | ');
            console.error(`[admin-seed-places] Update failed on ${failed.length}/${updateBatch.length} rows. Sample: ${sample}`);
            throw new Error(`duplicate-update-path: ${failed.length}/${updateBatch.length} rows failed. First: ${sample}`);
          }
        }
      }
    }
  } catch (err) {
    batchStatus = "failed";
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    errorMessage = isTimeout ? "Request timed out" : (err instanceof Error ? err.message : String(err));
    errorDetails = { error_type: isTimeout ? "timeout" : "unknown", error_stack: err instanceof Error ? err.stack : undefined };
  }

  return {
    batchStatus,
    errorMessage,
    errorDetails,
    placesReturned,
    rejectedNoPhotos,
    rejectedClosed,
    rejectedExcludedType,
    newInserted,
    duplicateSkipped,
  };
}

// ── Finishing a search ───────────────────────────────────────────────────────

// #4276 C4: a search still running after this long lost its worker. A Nearby Search
// takes seconds, even with every backoff in fetchWithGoogleBackoff.
const STALE_BATCH_SECONDS = 300;

// deno-lint-ignore no-explicit-any
async function finishBatch(supabase: any, batch: any, r: {
  status: string;
  apiCalls?: number;
  costUsd?: number;
  placesReturned?: number;
  rejectedNoPhotos?: number;
  rejectedClosed?: number;
  rejectedExcludedType?: number;
  newInserted?: number;
  duplicateSkipped?: number;
  error?: string | null;
  errorDetails?: unknown;
}) {
  const { data, error } = await supabase.rpc("seeding_finish_batch", {
    p_batch_id: batch.id,
    p_claim_token: batch.claim_token,
    p_status: r.status,
    p_api_calls: r.apiCalls ?? 0,
    p_cost_usd: r.costUsd ?? 0,
    p_places_returned: r.placesReturned ?? 0,
    p_rejected_no_photos: r.rejectedNoPhotos ?? 0,
    p_rejected_closed: r.rejectedClosed ?? 0,
    p_rejected_excluded_type: r.rejectedExcludedType ?? 0,
    p_new_inserted: r.newInserted ?? 0,
    p_duplicate_skipped: r.duplicateSkipped ?? 0,
    p_error_message: r.error ?? null,
    p_error_details: r.errorDetails ?? null,
  });
  if (error) throw new Error(`Search ${batch.id} could not be recorded: ${error.message}`);
  if (data?.applied !== true) {
    console.warn(`[admin-seed-places] search ${batch.id} finished after its claim timed out; not counted`);
  }
  return data ?? {};
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

  // #4276 C3, C4: one statement claims one search, so two callers can't take the same
  // one. A search left running past the timeout comes back here without being recounted.
  const { data: claimed, error: claimErr } = await supabase.rpc("seeding_claim_next_batch", {
    p_run_id: runId,
    p_stale_after_seconds: STALE_BATCH_SECONDS,
  });
  if (claimErr) throw new Error(`Failed to claim next batch: ${claimErr.message}`);

  if (!claimed || claimed.length === 0) {
    const { data: stillRunning, error: runningErr } = await supabase
      .from("seeding_batches")
      .select("id")
      .eq("run_id", runId)
      .eq("status", "running")
      .limit(1);
    if (runningErr) throw new Error(`Failed to read running batches: ${runningErr.message}`);
    if (stillRunning && stillRunning.length > 0) {
      return { done: false, runId, waiting: true, message: "Another search is still running" };
    }

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

  const batch = claimed[0];

  // Mark run as running
  const now = new Date().toISOString();
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
    .select("name, country, country_code")
    .eq("id", batch.city_id)
    .single();
  const cityName = city?.name ?? "Unknown";
  // #1704 — both fields from the seeded city row. No address is consulted.
  const { country: cityCountry, countryCode: cityCountryCode } = seedCountryFields(city);

  // Load where this search looks
  const tile = await loadSearchCircle(supabase, batch);

  if (!tile) {
    // Tile missing — mark batch failed
    await finishBatch(supabase, batch, { status: "failed", error: "Tile not found" });
    return {
      done: false,
      batchId: batch.id,
      batchIndex: batch.batch_index,
      status: "failed",
      error: "Tile not found",
    };
  }

  const config = resolveBatchConfig(batch);
  if (!config) {
    const error = `Unknown category: ${batch.seeding_category}`;
    await finishBatch(supabase, batch, { status: "failed", error });
    return {
      done: false,
      batchId: batch.id,
      batchIndex: batch.batch_index,
      status: "failed",
      error,
    };
  }

  // Execute ONE Google Nearby Search
  const {
    batchStatus,
    errorMessage,
    errorDetails,
    placesReturned,
    rejectedNoPhotos,
    rejectedClosed,
    rejectedExcludedType,
    newInserted,
    duplicateSkipped,
  } = await executeBatchSearch(supabase, {
    batch,
    tile,
    config,
    cityName,
    cityCountry,
    cityCountryCode,
  });

  const costUsd = COST_PER_NEARBY_SEARCH; // Always 1 API call per batch

  // #4276 C3: the search and its run's counters change together, or not at all if
  // this claim timed out and another worker now holds the search.
  const finished = await finishBatch(supabase, batch, {
    status: batchStatus,
    apiCalls: 1,
    costUsd,
    placesReturned,
    rejectedNoPhotos,
    rejectedClosed,
    rejectedExcludedType,
    newInserted,
    duplicateSkipped,
    error: errorMessage,
    errorDetails,
  });

  // Get next batch preview
  const noPending = finished.has_pending !== true;
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
        categoryLabel: resolveSeedingCategory(nextBatch.seeding_category)?.label ?? nextBatch.seeding_category,
      };
    }
  }

  return {
    done: finished.run_status === "completed",
    superseded: finished.applied !== true,
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
      completedBatches: finished.completed_batches ?? run.completed_batches,
      failedBatches: finished.failed_batches ?? run.failed_batches,
      totalBatches: run.total_batches,
      totalPlacesNew: finished.total_places_new ?? run.total_places_new,
      totalPlacesDuped: finished.total_places_duped ?? run.total_places_duped,
      totalCostUsd: Math.round((finished.total_cost_usd ?? run.total_cost_usd) * 1000) / 1000,
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
  const { data: existingBatch, error: batchErr } = await supabase
    .from("seeding_batches")
    .select("id, status")
    .eq("id", batchId)
    .eq("run_id", runId)
    .single();

  if (batchErr || !existingBatch) throw new Error("Batch not found");
  if (existingBatch.status !== "failed") {
    throw new Error(`Batch status is '${existingBatch.status}' — can only retry failed batches`);
  }

  // #4276 C3: one statement checks it is still failed, that nothing else is running in
  // this run, and takes it.
  const { data: claimedRetry, error: claimRetryErr } = await supabase.rpc("seeding_claim_retry_batch", {
    p_run_id: runId,
    p_batch_id: batchId,
  });
  if (claimRetryErr) throw new Error(`Failed to claim retry: ${claimRetryErr.message}`);
  if (!claimedRetry || claimedRetry.length === 0) {
    throw new Error("Another batch is already running. Wait for it to complete.");
  }
  const batch = claimedRetry[0];

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
    .select("name, country, country_code")
    .eq("id", batch.city_id)
    .single();
  const cityName = city?.name ?? "Unknown";
  // #1704 — both fields from the seeded city row. No address is consulted.
  const { country: cityCountry, countryCode: cityCountryCode } = seedCountryFields(city);

  // Load where this search looks
  const tile = await loadSearchCircle(supabase, batch);

  if (!tile) {
    await finishBatch(supabase, batch, { status: "failed", error: "Tile not found" });
    return {
      retried: true,
      batchId,
      batchIndex: batch.batch_index,
      status: "failed",
      error: "Tile not found",
    };
  }

  const config = resolveBatchConfig(batch);
  if (!config) {
    const error = `Unknown category: ${batch.seeding_category}`;
    await finishBatch(supabase, batch, { status: "failed", error });
    return {
      retried: true,
      batchId,
      batchIndex: batch.batch_index,
      status: "failed",
      error,
    };
  }

  // Execute ONE Google Nearby Search
  const {
    batchStatus,
    errorMessage,
    errorDetails,
    placesReturned,
    rejectedNoPhotos,
    rejectedClosed,
    rejectedExcludedType,
    newInserted,
    duplicateSkipped,
  } = await executeBatchSearch(supabase, {
    batch,
    tile,
    config,
    cityName,
    cityCountry,
    cityCountryCode,
  });

  const costUsd = COST_PER_NEARBY_SEARCH;

  // #4276 C3: replaces what the failed attempt counted, in one transaction.
  await finishBatch(supabase, batch, {
    status: batchStatus,
    apiCalls: 1,
    costUsd,
    placesReturned,
    rejectedNoPhotos,
    rejectedClosed,
    rejectedExcludedType,
    newInserted,
    duplicateSkipped,
    error: errorMessage,
    errorDetails,
  });

  return {
    retried: true,
    batchId,
    batchIndex: batch.batch_index,
    tileIndex: batch.tile_index,
    category: batch.seeding_category,
    categoryLabel: config.label,
    status: batchStatus,
    retryCount: batch.retry_count,
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

  // Load city for context
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

  const res = await timeoutFetch(url, { method: "GET", timeoutMs: API_TIMEOUT_MS });
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
    // #4276 B1: tells a city from a state or region.
    resultTypes: Array.isArray(result.types) ? result.types : [],
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

const geocodeForPipeline = async (query: string): Promise<GeocodeResult> => {
  const r = await handleGeocodeCity({ query });
  return {
    center: r.center,
    viewport: r.viewport,
    resultTypes: r.resultTypes,
    formattedAddress: r.formattedAddress,
  };
};

// deno-lint-ignore no-explicit-any
export async function dispatchAction(body: any, supabase: any): Promise<Response> {
  switch (body.action) {
    case "geocode_city":
      return json(await handleGeocodeCity(body));
    case "generate_tiles":
      return json(await generateTilesForCity(supabase, body.cityId));
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
    case "city_search_status":
      return json(await citySearchStatus(supabase, body));
    case "cities_search_status":
      return json(await citiesSearchStatus(supabase));
    case "preview_fill":
      return json(await previewFill(supabase, body));
    case "start_fill":
      return json(await startFill(supabase, body));
    case "preview_split_level":
      return json(await previewSplitLevel(supabase, body));
    case "start_split_level":
      return json(await startSplitLevel(supabase, body));
    case "run_completeness_check":
      return json(await runCompletenessCheck(supabase, body, { googleApiKey: GOOGLE_API_KEY }));
    case "plan_city_box":
      return json(await planCityBox(supabase, body, geocodeForPipeline));
    case "apply_city_box":
      return json(await applyCityBox(supabase, body, geocodeForPipeline));
    case "places_outside_box":
      return json(await placesOutsideBox(supabase, body));
    case "retired_tile_history":
      return json(await retiredTileHistory(supabase, body));
    default:
      return json({ error: `Unknown action: ${body.action}` }, 400);
  }
}

export const httpHandler = async (req: Request): Promise<Response> => {
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

    // #4276: the server-driven conductor calls in with the service key. Everyone else
    // is a signed-in, active admin.
    if (token !== SUPABASE_SERVICE_ROLE_KEY) {
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
    }

    const body = await req.json();
    return await dispatchAction(body, supabase);
  } catch (e: unknown) {
    if (e instanceof PipelineRefusal) {
      return json({ error: e.message, code: e.code, ...e.detail }, e.status);
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-seed-places] FATAL:", msg, e instanceof Error ? e.stack : "");
    return json({ error: msg }, 500);
  }
};

// Importing this file for tests must not start a server.
if (import.meta.main) {
  serve(httpHandler);
}
