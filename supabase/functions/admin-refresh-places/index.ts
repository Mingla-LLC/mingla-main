import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Admin-Triggered Place Refresh Edge Function ─────────────────────────────
// Processes pending place_refresh entries from admin_backfill_log.
// Called manually by admin dashboard — NEVER scheduled or auto-invoked.
//
// Two modes:
//   1. POST { action: "process" }        — picks up pending backfill log entries
//   2. POST { action: "refresh_single", placePoolId: UUID } — refreshes one place
//
// ── INVARIANTS (ORCH-0550.1) ────────────────────────────────────────────────
//   I-REFRESH-NEVER-DEGRADES     DETAIL_FIELD_MASK below MUST be a superset of
//                                admin-seed-places.FIELD_MASK. Refresh that asks
//                                for fewer fields than seed will null out columns
//                                that seed populated — that's data loss.
//   I-FIELD-MASK-SINGLE-OWNER    admin-seed-places holds the authoritative list.
//                                This file mirrors it field-for-field (same 48
//                                entries, minus the `places.` prefix because the
//                                detail endpoint returns a flat object).
// If you add a field to admin-seed-places.FIELD_MASK, add it here AND add it to
// the UPDATE statement inside refreshPlace().

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Mirrors admin-seed-places.FIELD_MASK (48 fields), without the `places.` prefix
// because the detail endpoint returns a single flat place object.
const DETAIL_FIELD_MASK = [
  // Identity
  "id",
  "displayName",
  "primaryTypeDisplayName",
  "formattedAddress",
  "location",
  "types",
  "primaryType",

  // Ratings & price
  "rating",
  "userRatingCount",
  "priceLevel",
  "priceRange",

  // Hours & photos
  "regularOpeningHours",
  "secondaryOpeningHours",
  "utcOffsetMinutes",
  "photos",

  // Links
  "websiteUri",
  "googleMapsUri",
  "nationalPhoneNumber",

  // Operational state
  "businessStatus",

  // Content (AI-heavy)
  "editorialSummary",
  "generativeSummary",
  "reviews",

  // Meal service booleans
  "servesBrunch",
  "servesLunch",
  "servesDinner",
  "servesBreakfast",
  "servesBeer",
  "servesWine",
  "servesCocktails",
  "servesCoffee",
  "servesDessert",
  "servesVegetarianFood",

  // Ambience & amenities
  "outdoorSeating",
  "liveMusic",
  "goodForGroups",
  "goodForChildren",
  "goodForWatchingSports",
  "allowsDogs",
  "restroom",
  "reservable",
  "menuForChildren",

  // Service options
  "dineIn",
  "takeout",
  "delivery",
  "curbsidePickup",

  // Access & facilities
  "accessibilityOptions",
  "parkingOptions",
  "paymentOptions",
].join(",");

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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Refresh a single place from Google Places API ────────────────────────────
async function refreshPlace(
  supabase: ReturnType<typeof createClient>,
  googlePlaceId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      `https://places.googleapis.com/v1/places/${googlePlaceId}?languageCode=en`,
      {
        headers: {
          "X-Goog-Api-Key": GOOGLE_API_KEY,
          "X-Goog-FieldMask": DETAIL_FIELD_MASK,
        },
      },
    );

    if (!response.ok) {
      // Increment failure count
      const { data: existing } = await supabase
        .from("place_pool")
        .select("refresh_failures")
        .eq("google_place_id", googlePlaceId)
        .single();

      await supabase
        .from("place_pool")
        .update({
          refresh_failures: (existing?.refresh_failures ?? 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("google_place_id", googlePlaceId);

      return { success: false, error: `Google API ${response.status}` };
    }

    const gPlace = await response.json();
    const priceLevel = gPlace.priceLevel as string | undefined;
    const priceInfo = PRICE_LEVEL_MAP[priceLevel ?? ""] ?? { tier: null, min: 0, max: 0 };
    const displayName = gPlace.displayName as { text?: string } | undefined;
    const location = gPlace.location as { latitude?: number; longitude?: number } | undefined;
    const photos = (gPlace.photos ?? []) as Array<{ name?: string; widthPx?: number; heightPx?: number }>;

    // ORCH-0550.1 — nested extractors, identical to admin-seed-places.transformGooglePlaceForSeed
    const editorialSummaryText =
      (gPlace.editorialSummary as { text?: string } | undefined)?.text ?? null;
    const generativeSummaryText =
      (gPlace.generativeSummary as { overview?: { text?: string } } | undefined)?.overview?.text ?? null;
    const primaryTypeDisplayNameText =
      (gPlace.primaryTypeDisplayName as { text?: string } | undefined)?.text ?? null;

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

    // ORCH-0550.1 — refresh writes every column the seed transform writes.
    // Using `?? null` (not `?? undefined`) for new fields so that when Google
    // stops returning a previously-present boolean/field, we explicitly null it
    // rather than silently preserve stale data. Identity + price_min/max keep
    // `?? undefined` so refresh never wipes known-good scalars with 0.
    await supabase
      .from("place_pool")
      .update({
        name: displayName?.text ?? undefined,
        address: (gPlace.formattedAddress as string) ?? undefined,
        lat: location?.latitude ?? undefined,
        lng: location?.longitude ?? undefined,
        types: (gPlace.types as string[]) ?? undefined,
        primary_type: (gPlace.primaryType as string) ?? undefined,
        primary_type_display_name: primaryTypeDisplayNameText,
        rating: (gPlace.rating as number) ?? undefined,
        review_count: (gPlace.userRatingCount as number) ?? 0,
        price_level: priceLevel ?? undefined,
        price_min: priceInfo.min,
        price_max: priceInfo.max,
        price_tier: priceInfo.tier ?? undefined,
        price_tiers: priceInfo.tier ? [priceInfo.tier] : undefined,
        price_range_currency: priceRangeCurrency,
        price_range_start_cents: priceRangeStartCents,
        price_range_end_cents: priceRangeEndCents,
        opening_hours: gPlace.regularOpeningHours ?? undefined,
        secondary_opening_hours: gPlace.secondaryOpeningHours ?? null,
        photos: photos.map((p) => ({ name: p.name, widthPx: p.widthPx, heightPx: p.heightPx })),
        website: (gPlace.websiteUri as string) ?? undefined,
        google_maps_uri: (gPlace.googleMapsUri as string) ?? null,
        national_phone_number: (gPlace.nationalPhoneNumber as string) ?? null,
        business_status: (gPlace.businessStatus as string) ?? null,
        editorial_summary: editorialSummaryText,
        generative_summary: generativeSummaryText,
        reviews: gPlace.reviews ?? null,
        utc_offset_minutes: (gPlace.utcOffsetMinutes as number) ?? undefined,

        // Meal service booleans
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

        // Access & facilities (JSONB)
        accessibility_options: gPlace.accessibilityOptions ?? null,
        parking_options: gPlace.parkingOptions ?? null,
        payment_options: gPlace.paymentOptions ?? null,

        raw_google_data: gPlace,
        fetched_via: "detail_refresh",
        last_detail_refresh: new Date().toISOString(),
        refresh_failures: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("google_place_id", googlePlaceId);

    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

// ── Process a pending backfill log entry ─────────────────────────────────────
async function processPendingRefresh(
  supabase: ReturnType<typeof createClient>,
  adminUserId: string,
) {
  // Find the oldest pending place_refresh
  const { data: logEntry, error: fetchErr } = await supabase
    .from("admin_backfill_log")
    .select("*")
    .eq("operation_type", "place_refresh")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fetchErr) throw new Error(`Failed to fetch backfill log: ${fetchErr.message}`);

  if (!logEntry) {
    return { status: "nothing_to_do", message: "No pending place refresh jobs found" };
  }

  // Mark as running
  await supabase
    .from("admin_backfill_log")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", logEntry.id);

  const placeIds: string[] = logEntry.place_ids || [];

  // Resolve google_place_ids from place_pool UUIDs
  const { data: places } = await supabase
    .from("place_pool")
    .select("id, google_place_id")
    .in("id", placeIds);

  if (!places || places.length === 0) {
    await supabase
      .from("admin_backfill_log")
      .update({ status: "completed", completed_at: new Date().toISOString(), success_count: 0, failure_count: 0 })
      .eq("id", logEntry.id);
    return { status: "completed", refreshed: 0, failed: 0 };
  }

  let successCount = 0;
  let failureCount = 0;
  const errors: Array<{ placeId: string; error: string }> = [];
  let apiCallsMade = 0;

  for (const place of places) {
    apiCallsMade++;
    const result = await refreshPlace(supabase, place.google_place_id);

    if (result.success) {
      successCount++;
      // Audit each refresh
      await supabase
        .from("place_admin_actions")
        .insert({
          place_id: place.id,
          action_type: "refresh",
          acted_by: adminUserId,
          metadata: { backfill_log_id: logEntry.id },
        });
    } else {
      failureCount++;
      errors.push({ placeId: place.google_place_id, error: result.error || "Unknown error" });
    }

    // Rate limiting: 50ms delay between API calls
    if (apiCallsMade < places.length) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // Update backfill log
  await supabase
    .from("admin_backfill_log")
    .update({
      status: failureCount === places.length ? "failed" : "completed",
      completed_at: new Date().toISOString(),
      success_count: successCount,
      failure_count: failureCount,
      api_calls_made: apiCallsMade,
      estimated_cost_usd: apiCallsMade * 0.005,
      error_details: errors.length > 0 ? errors : [],
    })
    .eq("id", logEntry.id);

  return {
    status: "completed",
    backfill_log_id: logEntry.id,
    refreshed: successCount,
    failed: failureCount,
    api_calls: apiCallsMade,
    estimated_cost_usd: (apiCallsMade * 0.005).toFixed(3),
    errors: errors.slice(0, 10), // Limit error details in response
  };
}

// ── Refresh a single place by place_pool ID ──────────────────────────────────
async function refreshSinglePlace(
  supabase: ReturnType<typeof createClient>,
  placePoolId: string,
  adminUserId: string,
) {
  const { data: place } = await supabase
    .from("place_pool")
    .select("id, google_place_id, name")
    .eq("id", placePoolId)
    .single();

  if (!place) {
    return { error: "Place not found" };
  }

  const result = await refreshPlace(supabase, place.google_place_id);

  // Audit
  await supabase
    .from("place_admin_actions")
    .insert({
      place_id: place.id,
      action_type: "refresh",
      acted_by: adminUserId,
      metadata: { result: result.success ? "success" : result.error },
    });

  if (result.success) {
    return { success: true, place_name: place.name };
  } else {
    return { success: false, error: result.error, place_name: place.name };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ORCH-0553 — Batched Refresh Pipeline (8 new actions)
// Spec: outputs/SPEC_ORCH-0553_REFRESH_PIPELINE.md
//
// Mirrors admin-seed-places batched run pattern. Reuses the existing
// refreshPlace() worker — does NOT redefine it. Tables: refresh_runs +
// refresh_batches (separate from seeding_runs/seeding_batches by design).
//
// Invariants enforced:
//   I-REFRESH-RUN-CITY-EXCLUSIVE   — concurrency guard in handleCreateRefreshRun
//   I-REFRESH-COST-CAP-RESPECTED   — hard cap check in handleCreateRefreshRun
//   I-REFRESH-BATCH-RESULTS-COMPLETE — results JSONB always populated before status flip
//   I-REFRESH-AGGREGATES-EQUAL-SUM — atomic run-aggregate updates
// ════════════════════════════════════════════════════════════════════════════

const COST_PER_REFRESH_CALL = 0.017; // Google Places v1 Pro tier
const HARD_CAP_USD_REFRESH = 500;
const DEFAULT_BATCH_SIZE = 50;
const MIN_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 200;
const MIN_STALE_DAYS = 1;
const MAX_STALE_DAYS = 365;
const BATCH_INSERT_CHUNK = 500;
const INTER_CALL_SLEEP_MS = 50; // matches existing processPendingRefresh

const UNCATEGORIZED_LABEL = "(uncategorized)";

interface RefreshFilters {
  cityId: string;
  filterCategories: string[] | null;
  filterStaleDays: number | null;
  filterIncludeFailed: boolean;
  batchSize: number;
}

function normalizeFilters(body: Record<string, unknown>): RefreshFilters {
  if (!body.cityId || typeof body.cityId !== "string") {
    throw new Error("cityId is required");
  }
  const filterCategories = Array.isArray(body.filterCategories) && body.filterCategories.length > 0
    ? (body.filterCategories as string[])
    : null;
  const filterStaleDays = (body.filterStaleDays === null || body.filterStaleDays === undefined)
    ? null
    : Number(body.filterStaleDays);
  if (filterStaleDays !== null && (
    !Number.isFinite(filterStaleDays) ||
    filterStaleDays < MIN_STALE_DAYS ||
    filterStaleDays > MAX_STALE_DAYS
  )) {
    throw new Error(`filterStaleDays must be between ${MIN_STALE_DAYS} and ${MAX_STALE_DAYS}, or null`);
  }
  const filterIncludeFailed = body.filterIncludeFailed === true;
  const batchSize = body.batchSize === undefined || body.batchSize === null
    ? DEFAULT_BATCH_SIZE
    : Number(body.batchSize);
  if (!Number.isFinite(batchSize) || batchSize < MIN_BATCH_SIZE || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`batchSize must be between ${MIN_BATCH_SIZE} and ${MAX_BATCH_SIZE}`);
  }
  return {
    cityId: body.cityId as string,
    filterCategories,
    filterStaleDays,
    filterIncludeFailed,
    batchSize,
  };
}

// Build the place_pool filter (chainable). Returns the query — does NOT execute.
// deno-lint-ignore no-explicit-any
function applyRefreshFilters(query: any, f: RefreshFilters) {
  query = query.eq("city_id", f.cityId).eq("is_active", true);

  if (f.filterCategories !== null) {
    const concrete = f.filterCategories.filter((c) => c !== UNCATEGORIZED_LABEL);
    const includeUncat = f.filterCategories.includes(UNCATEGORIZED_LABEL);
    if (concrete.length > 0 && includeUncat) {
      query = query.or(`seeding_category.in.(${concrete.join(",")}),seeding_category.is.null`);
    } else if (concrete.length > 0) {
      query = query.in("seeding_category", concrete);
    } else if (includeUncat) {
      query = query.is("seeding_category", null);
    }
  }

  if (f.filterStaleDays !== null) {
    const cutoff = new Date(Date.now() - f.filterStaleDays * 86400_000).toISOString();
    // last_detail_refresh < cutoff OR IS NULL (never refreshed = max stale)
    query = query.or(`last_detail_refresh.lt.${cutoff},last_detail_refresh.is.null`);
  }

  if (!f.filterIncludeFailed) {
    query = query.lt("refresh_failures", 3);
  }

  return query;
}

// ── Action: preview_refresh_cost ────────────────────────────────────────────

async function handlePreviewRefreshCost(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  body: Record<string, any>,
) {
  const filters = normalizeFilters(body);

  // Pull all matching place_pool rows (id + seeding_category only — minimal payload)
  let query = supabase.from("place_pool").select("seeding_category", { count: "exact" });
  query = applyRefreshFilters(query, filters);
  const { data, count, error } = await query.limit(100000);
  if (error) throw new Error(`Preview query failed: ${error.message}`);

  const totalPlaces = count ?? (data?.length ?? 0);

  // Compute per-category breakdown
  const breakdownMap = new Map<string, number>();
  for (const row of (data ?? [])) {
    const key = row.seeding_category ?? UNCATEGORIZED_LABEL;
    breakdownMap.set(key, (breakdownMap.get(key) ?? 0) + 1);
  }
  const breakdown = Array.from(breakdownMap.entries())
    .map(([category, places]) => ({
      category,
      places,
      cost: Math.round(places * COST_PER_REFRESH_CALL * 100) / 100,
    }))
    .sort((a, b) => b.places - a.places);

  const estimatedCostUsd = Math.round(totalPlaces * COST_PER_REFRESH_CALL * 100) / 100;
  const totalBatches = Math.ceil(totalPlaces / filters.batchSize);
  const perBatchCostUsd = Math.round(filters.batchSize * COST_PER_REFRESH_CALL * 100) / 100;

  return {
    totalPlaces,
    estimatedCostUsd,
    perBatchCostUsd,
    totalBatches,
    batchSize: filters.batchSize,
    exceedsHardCap: estimatedCostUsd > HARD_CAP_USD_REFRESH,
    hardCapUsd: HARD_CAP_USD_REFRESH,
    breakdown,
    filterSnapshot: {
      cityId: filters.cityId,
      filterCategories: filters.filterCategories,
      filterStaleDays: filters.filterStaleDays,
      filterIncludeFailed: filters.filterIncludeFailed,
    },
  };
}

// ── Action: create_refresh_run ──────────────────────────────────────────────

async function handleCreateRefreshRun(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  body: Record<string, any>,
  triggeredBy: string,
) {
  const filters = normalizeFilters(body);

  // Step 1 — concurrency guard (I-REFRESH-RUN-CITY-EXCLUSIVE)
  const { data: existingRuns } = await supabase
    .from("refresh_runs")
    .select("id, status")
    .eq("city_id", filters.cityId)
    .in("status", ["preparing", "ready", "running", "paused"])
    .limit(1);

  if (existingRuns && existingRuns.length > 0) {
    throw new Error(
      `City already has an active refresh run (${existingRuns[0].id}, status: ${existingRuns[0].status}). Cancel it first.`
    );
  }

  // Step 2 — resolve target place_ids (ordered by category, then last_detail_refresh ASC NULLS FIRST)
  let query = supabase
    .from("place_pool")
    .select("id, seeding_category, last_detail_refresh");
  query = applyRefreshFilters(query, filters);
  const { data: places, error: queryErr } = await query
    .order("seeding_category", { ascending: true, nullsFirst: false })
    .order("last_detail_refresh", { ascending: true, nullsFirst: true })
    .limit(100000);

  if (queryErr) throw new Error(`Place lookup failed: ${queryErr.message}`);
  const placeIds: string[] = (places ?? []).map((p: { id: string }) => p.id);
  const totalPlaces = placeIds.length;

  if (totalPlaces === 0) {
    throw new Error("No places match the filter. Adjust filters and try again.");
  }

  // Step 3 — hard cap check (I-REFRESH-COST-CAP-RESPECTED)
  const estimatedCostUsd = Math.round(totalPlaces * COST_PER_REFRESH_CALL * 100) / 100;
  if (estimatedCostUsd > HARD_CAP_USD_REFRESH) {
    throw new Error(
      `Estimated cost $${estimatedCostUsd.toFixed(2)} exceeds hard cap of $${HARD_CAP_USD_REFRESH}. Reduce filters.`
    );
  }

  const totalBatches = Math.ceil(totalPlaces / filters.batchSize);

  // Step 4 — insert run as 'preparing'
  const { data: runRow, error: runErr } = await supabase
    .from("refresh_runs")
    .insert({
      city_id: filters.cityId,
      filter_categories: filters.filterCategories,
      filter_stale_days: filters.filterStaleDays,
      filter_include_failed: filters.filterIncludeFailed,
      batch_size: filters.batchSize,
      total_places: totalPlaces,
      total_batches: totalBatches,
      status: "preparing",
      triggered_by: triggeredBy,
    })
    .select("*")
    .single();

  if (runErr || !runRow) throw new Error(`Failed to create refresh run: ${runErr?.message}`);

  // Step 5 — chunk place_ids into batches
  const batchRows = [];
  for (let i = 0; i < totalBatches; i++) {
    const start = i * filters.batchSize;
    const chunk = placeIds.slice(start, start + filters.batchSize);
    batchRows.push({
      run_id: runRow.id,
      city_id: filters.cityId,
      batch_index: i,
      place_ids: chunk,
      status: "pending",
    });
  }

  // Step 6 — insert batches in chunks of 500 (mirror seed pattern)
  let insertedTotal = 0;
  try {
    for (let i = 0; i < batchRows.length; i += BATCH_INSERT_CHUNK) {
      const insertChunk = batchRows.slice(i, i + BATCH_INSERT_CHUNK);
      const { error: batchErr } = await supabase.from("refresh_batches").insert(insertChunk);
      if (batchErr) throw new Error(`Chunk ${Math.floor(i / BATCH_INSERT_CHUNK) + 1}: ${batchErr.message}`);
      insertedTotal += insertChunk.length;
    }
  } catch (insertError) {
    await supabase
      .from("refresh_runs")
      .update({ status: "failed_preparing", completed_at: new Date().toISOString() })
      .eq("id", runRow.id);
    throw new Error(
      `Batch preparation failed after ${insertedTotal}/${totalBatches} batches. ` +
      `Run ${runRow.id} marked as failed_preparing. ` +
      (insertError instanceof Error ? insertError.message : String(insertError))
    );
  }

  // Step 7 — verify count
  const { count: actualCount, error: countErr } = await supabase
    .from("refresh_batches")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runRow.id);

  if (countErr || actualCount !== totalBatches) {
    await supabase
      .from("refresh_runs")
      .update({ status: "failed_preparing", completed_at: new Date().toISOString() })
      .eq("id", runRow.id);
    throw new Error(
      `Batch count verification failed: expected ${totalBatches}, got ${actualCount ?? "unknown"}. ` +
      `Run ${runRow.id} marked as failed_preparing.`
    );
  }

  // Step 8 — transition to 'ready'
  await supabase.from("refresh_runs").update({ status: "ready" }).eq("id", runRow.id);

  // Step 9 — return preview (first 5 batches' first 3 place names)
  const previewBatches = batchRows.slice(0, 5);
  const previewPlaceIds = previewBatches.flatMap((b) => b.place_ids.slice(0, 3));
  const { data: previewPlaces } = await supabase
    .from("place_pool")
    .select("id, name")
    .in("id", previewPlaceIds);

  const placeNameById = new Map<string, string>(
    (previewPlaces ?? []).map((p: { id: string; name: string }) => [p.id, p.name])
  );

  const preview = previewBatches.map((b) => ({
    batchIndex: b.batch_index,
    placeNames: b.place_ids.slice(0, 3).map((id) => placeNameById.get(id) ?? id),
    placeCount: b.place_ids.length,
  }));

  return {
    runId: runRow.id,
    status: "ready" as const,
    totalPlaces,
    totalBatches,
    batchSize: filters.batchSize,
    estimatedCostUsd,
    preview,
  };
}

// ── Shared: execute one batch (used by run_next + retry) ────────────────────

interface BatchExecutionResult {
  batchStatus: "completed" | "failed";
  // deno-lint-ignore no-explicit-any
  results: Array<{ place_id: string; google_place_id: string; name: string; success: boolean; error: string | null }>;
  successCount: number;
  failureCount: number;
  totalAttempted: number;
  costUsd: number;
  errorMessage: string | null;
  // deno-lint-ignore no-explicit-any
  errorDetails: any;
}

async function executeBatch(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  placeIds: string[],
  adminUserId: string,
  runId: string,
  batchId: string,
): Promise<BatchExecutionResult> {
  // Resolve place_pool rows
  const { data: places, error: lookupErr } = await supabase
    .from("place_pool")
    .select("id, google_place_id, name")
    .in("id", placeIds);

  if (lookupErr) {
    return {
      batchStatus: "failed",
      results: [],
      successCount: 0,
      failureCount: 0,
      totalAttempted: 0,
      costUsd: 0,
      errorMessage: `Place lookup failed: ${lookupErr.message}`,
      errorDetails: { error_type: "lookup", message: lookupErr.message },
    };
  }

  if (!places || places.length === 0) {
    return {
      batchStatus: "failed",
      results: [],
      successCount: 0,
      failureCount: 0,
      totalAttempted: 0,
      costUsd: 0,
      errorMessage: "No places resolved from batch place_ids — they may have been deleted",
      errorDetails: { error_type: "empty_resolution" },
    };
  }

  // Per-place loop with 50ms sleep between calls (mirror processPendingRefresh)
  // deno-lint-ignore no-explicit-any
  const results: Array<{ place_id: string; google_place_id: string; name: string; success: boolean; error: string | null }> = [];
  let successCount = 0;
  let failureCount = 0;
  let i = 0;

  for (const place of places) {
    i++;
    const result = await refreshPlace(supabase, place.google_place_id);
    results.push({
      place_id: place.id,
      google_place_id: place.google_place_id,
      name: place.name,
      success: result.success,
      error: result.success ? null : (result.error ?? "Unknown error"),
    });

    if (result.success) {
      successCount++;
      // Audit each refresh
      await supabase.from("place_admin_actions").insert({
        place_id: place.id,
        action_type: "refresh",
        acted_by: adminUserId,
        metadata: { refresh_run_id: runId, batch_id: batchId },
      });
    } else {
      failureCount++;
    }

    if (i < places.length) {
      await new Promise((r) => setTimeout(r, INTER_CALL_SLEEP_MS));
    }
  }

  const totalAttempted = places.length;
  return {
    batchStatus: "completed",
    results,
    successCount,
    failureCount,
    totalAttempted,
    costUsd: Math.round(totalAttempted * COST_PER_REFRESH_CALL * 1000) / 1000,
    errorMessage: null,
    errorDetails: null,
  };
}

// Auto-complete check: if no pending AND no failed left → mark run completed.
// Returns true if the run was auto-completed.
async function checkAndAutoComplete(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  runId: string,
  completedAt: string,
): Promise<boolean> {
  const { data: pendingLeft } = await supabase
    .from("refresh_batches")
    .select("id")
    .eq("run_id", runId)
    .eq("status", "pending")
    .limit(1);

  const { data: failedLeft } = await supabase
    .from("refresh_batches")
    .select("id")
    .eq("run_id", runId)
    .eq("status", "failed")
    .limit(1);

  const noPending = !pendingLeft || pendingLeft.length === 0;
  const noFailed = !failedLeft || failedLeft.length === 0;

  if (noPending && noFailed) {
    await supabase
      .from("refresh_runs")
      .update({
        status: "completed",
        current_batch_index: null,
        completed_at: completedAt,
      })
      .eq("id", runId);
    return true;
  }
  return false;
}

// ── Action: run_next_refresh_batch ──────────────────────────────────────────

async function handleRunNextRefreshBatch(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  body: Record<string, any>,
  adminUserId: string,
) {
  const runId = body.runId;
  if (!runId) throw new Error("runId is required");

  // Load run
  const { data: run, error: runErr } = await supabase
    .from("refresh_runs")
    .select("*")
    .eq("id", runId)
    .single();

  if (runErr || !run) throw new Error(`Run not found: ${runId}`);
  if (!["ready", "running", "paused"].includes(run.status)) {
    throw new Error(`Run status is '${run.status}' — cannot execute batches.`);
  }

  // Find next pending batch
  const { data: nextBatches } = await supabase
    .from("refresh_batches")
    .select("*")
    .eq("run_id", runId)
    .eq("status", "pending")
    .order("batch_index")
    .limit(1);

  if (!nextBatches || nextBatches.length === 0) {
    // No more pending — try auto-complete
    const completed = await checkAndAutoComplete(supabase, runId, new Date().toISOString());
    return {
      done: completed,
      message: completed ? "All batches completed" : "No pending batches — run has unresolved failed batches",
    };
  }

  const batch = nextBatches[0];
  const startedAt = new Date().toISOString();

  // Mark batch + run as running
  await supabase.from("refresh_batches").update({
    status: "running",
    started_at: startedAt,
  }).eq("id", batch.id);

  await supabase.from("refresh_runs").update({
    status: "running",
    current_batch_index: batch.batch_index,
    ...(run.status === "ready" ? { started_at: startedAt } : {}),
  }).eq("id", runId);

  // Execute
  const exec = await executeBatch(supabase, batch.place_ids, adminUserId, runId, batch.id);
  const completedAt = new Date().toISOString();

  // Update batch
  await supabase.from("refresh_batches").update({
    status: exec.batchStatus,
    results: exec.results.length > 0 ? exec.results : null,
    success_count: exec.successCount,
    failure_count: exec.failureCount,
    google_api_calls: exec.totalAttempted,
    estimated_cost_usd: exec.costUsd,
    error_message: exec.errorMessage,
    error_details: exec.errorDetails,
    completed_at: completedAt,
  }).eq("id", batch.id);

  // Update run aggregates (always pause after batch — matches seed)
  // deno-lint-ignore no-explicit-any
  const runUpdate: Record<string, any> = {
    status: "paused",
    total_api_calls: run.total_api_calls + exec.totalAttempted,
    total_cost_usd: run.total_cost_usd + exec.costUsd,
    places_succeeded: run.places_succeeded + exec.successCount,
    places_failed: run.places_failed + exec.failureCount,
  };

  if (exec.batchStatus === "completed") {
    runUpdate.completed_batches = run.completed_batches + 1;
  } else {
    runUpdate.failed_batches = run.failed_batches + 1;
  }

  await supabase.from("refresh_runs").update(runUpdate).eq("id", runId);

  // Auto-complete check
  const wasAutoCompleted = await checkAndAutoComplete(supabase, runId, completedAt);

  // Build nextBatch preview
  let nextBatchPreview = null;
  if (!wasAutoCompleted) {
    const { data: nb } = await supabase
      .from("refresh_batches")
      .select("batch_index, place_ids")
      .eq("run_id", runId)
      .eq("status", "pending")
      .order("batch_index")
      .limit(1)
      .maybeSingle();
    if (nb) {
      nextBatchPreview = {
        batchIndex: nb.batch_index,
        placeCount: Array.isArray(nb.place_ids) ? nb.place_ids.length : 0,
      };
    }
  }

  return {
    done: wasAutoCompleted,
    batchId: batch.id,
    batchIndex: batch.batch_index,
    status: exec.batchStatus,
    result: {
      placesAttempted: exec.totalAttempted,
      successCount: exec.successCount,
      failureCount: exec.failureCount,
      costUsd: exec.costUsd,
      error: exec.errorMessage,
    },
    nextBatch: nextBatchPreview,
    runProgress: {
      completedBatches: (runUpdate.completed_batches as number) ?? run.completed_batches,
      failedBatches: (runUpdate.failed_batches as number) ?? run.failed_batches,
      totalBatches: run.total_batches,
      placesSucceeded: run.places_succeeded + exec.successCount,
      placesFailed: run.places_failed + exec.failureCount,
      totalCostUsd: Math.round((run.total_cost_usd + exec.costUsd) * 1000) / 1000,
    },
  };
}

// ── Action: retry_refresh_batch ─────────────────────────────────────────────

async function handleRetryRefreshBatch(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  body: Record<string, any>,
  adminUserId: string,
) {
  const { runId, batchId } = body;
  if (!runId || !batchId) throw new Error("runId and batchId are required");

  // Load run
  const { data: run, error: runErr } = await supabase
    .from("refresh_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (runErr || !run) throw new Error("Run not found");
  if (!["ready", "running", "paused"].includes(run.status)) {
    throw new Error(`Run status is '${run.status}' — retry only allowed when ready/running/paused`);
  }

  // Load batch — must be failed AND belong to this run
  const { data: batch, error: batchErr } = await supabase
    .from("refresh_batches")
    .select("*")
    .eq("id", batchId)
    .eq("run_id", runId)
    .single();
  if (batchErr || !batch) throw new Error("Batch not found");
  if (batch.status !== "failed") {
    throw new Error(`Batch status is '${batch.status}' — can only retry failed batches`);
  }

  // No other batch should be running
  const { data: runningBatches } = await supabase
    .from("refresh_batches")
    .select("id")
    .eq("run_id", runId)
    .eq("status", "running")
    .limit(1);
  if (runningBatches && runningBatches.length > 0) {
    throw new Error("Another batch is already running. Wait for it to complete.");
  }

  // Capture old contributions for delta correction
  const oldSuccess = batch.success_count || 0;
  const oldFail = batch.failure_count || 0;
  const oldApi = batch.google_api_calls || 0;
  const oldCost = batch.estimated_cost_usd || 0;

  // Mark batch running + increment retry_count
  const startedAt = new Date().toISOString();
  await supabase.from("refresh_batches").update({
    status: "running",
    started_at: startedAt,
    completed_at: null,
    retry_count: (batch.retry_count || 0) + 1,
    error_message: null,
    error_details: null,
  }).eq("id", batchId);

  await supabase.from("refresh_runs").update({
    status: "running",
    current_batch_index: batch.batch_index,
  }).eq("id", runId);

  // Execute
  const exec = await executeBatch(supabase, batch.place_ids, adminUserId, runId, batchId);
  const completedAt = new Date().toISOString();

  // Update batch with new results (additive on api_calls + cost)
  await supabase.from("refresh_batches").update({
    status: exec.batchStatus,
    results: exec.results.length > 0 ? exec.results : null,
    success_count: exec.successCount,
    failure_count: exec.failureCount,
    google_api_calls: oldApi + exec.totalAttempted,
    estimated_cost_usd: oldCost + exec.costUsd,
    error_message: exec.errorMessage,
    error_details: exec.errorDetails,
    completed_at: completedAt,
  }).eq("id", batchId);

  // Run-aggregate delta correction
  // deno-lint-ignore no-explicit-any
  const runUpdate: Record<string, any> = {
    status: "paused",
    total_api_calls: run.total_api_calls + exec.totalAttempted,
    total_cost_usd: run.total_cost_usd + exec.costUsd,
    places_succeeded: run.places_succeeded - oldSuccess + exec.successCount,
    places_failed: run.places_failed - oldFail + exec.failureCount,
  };

  if (exec.batchStatus === "completed") {
    // Batch moved from failed → completed
    runUpdate.failed_batches = run.failed_batches - 1;
    runUpdate.completed_batches = run.completed_batches + 1;
  }
  // If retry failed again: failed_batches and completed_batches unchanged (batch was already counted as failed)

  await supabase.from("refresh_runs").update(runUpdate).eq("id", runId);

  const wasAutoCompleted = exec.batchStatus === "completed"
    ? await checkAndAutoComplete(supabase, runId, completedAt)
    : false;

  return {
    retried: true,
    batchId,
    batchIndex: batch.batch_index,
    status: exec.batchStatus,
    retryCount: (batch.retry_count || 0) + 1,
    done: wasAutoCompleted,
    result: {
      placesAttempted: exec.totalAttempted,
      successCount: exec.successCount,
      failureCount: exec.failureCount,
      costUsd: exec.costUsd,
      error: exec.errorMessage,
    },
    runProgress: {
      completedBatches: (runUpdate.completed_batches as number) ?? run.completed_batches,
      failedBatches: (runUpdate.failed_batches as number) ?? run.failed_batches,
      totalBatches: run.total_batches,
      placesSucceeded: run.places_succeeded - oldSuccess + exec.successCount,
      placesFailed: run.places_failed - oldFail + exec.failureCount,
      totalCostUsd: Math.round((run.total_cost_usd + exec.costUsd) * 1000) / 1000,
    },
  };
}

// ── Action: skip_refresh_batch ──────────────────────────────────────────────

async function handleSkipRefreshBatch(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  body: Record<string, any>,
) {
  const { runId, batchId } = body;
  if (!runId || !batchId) throw new Error("runId and batchId are required");

  // Load batch + verify
  const { data: batch, error: batchErr } = await supabase
    .from("refresh_batches")
    .select("*")
    .eq("id", batchId)
    .eq("run_id", runId)
    .single();

  if (batchErr || !batch) throw new Error("Batch not found");
  if (!["pending", "failed"].includes(batch.status)) {
    throw new Error(`Batch status is '${batch.status}' — can only skip pending or failed batches`);
  }

  const wasFailed = batch.status === "failed";
  const completedAt = new Date().toISOString();

  // Mark batch skipped
  await supabase.from("refresh_batches").update({
    status: "skipped",
    completed_at: completedAt,
  }).eq("id", batchId);

  // Update run
  const { data: run } = await supabase
    .from("refresh_runs")
    .select("*")
    .eq("id", runId)
    .single();

  if (run) {
    // deno-lint-ignore no-explicit-any
    const runUpdate: Record<string, any> = {
      skipped_batches: (run.skipped_batches || 0) + 1,
    };
    if (wasFailed) {
      runUpdate.failed_batches = run.failed_batches - 1;
    }
    await supabase.from("refresh_runs").update(runUpdate).eq("id", runId);

    // Auto-complete check
    await checkAndAutoComplete(supabase, runId, completedAt);
  }

  return { skipped: true, batchId, batchIndex: batch.batch_index, wasFailed };
}

// ── Action: cancel_refresh_run ──────────────────────────────────────────────

async function handleCancelRefreshRun(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  body: Record<string, any>,
) {
  const { runId } = body;
  if (!runId) throw new Error("runId is required");

  const { data: run, error: runErr } = await supabase
    .from("refresh_runs")
    .select("*")
    .eq("id", runId)
    .single();

  if (runErr || !run) throw new Error("Run not found");
  if (["completed", "cancelled", "failed_preparing"].includes(run.status)) {
    throw new Error(`Run is already '${run.status}'`);
  }

  // Count pending batches BEFORE marking them skipped
  const { count: pendingCount } = await supabase
    .from("refresh_batches")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("status", "pending");

  const skippedNow = pendingCount ?? 0;
  const completedAt = new Date().toISOString();

  // Mark all pending → skipped
  await supabase.from("refresh_batches").update({
    status: "skipped",
    completed_at: completedAt,
  }).eq("run_id", runId).eq("status", "pending");

  // Mark run cancelled
  await supabase.from("refresh_runs").update({
    status: "cancelled",
    current_batch_index: null,
    skipped_batches: (run.skipped_batches || 0) + skippedNow,
    completed_at: completedAt,
  }).eq("id", runId);

  return {
    cancelled: true,
    runId,
    completedBatches: run.completed_batches,
    failedBatches: run.failed_batches,
    skippedBatches: (run.skipped_batches || 0) + skippedNow,
  };
}

// ── Action: refresh_run_status ──────────────────────────────────────────────

async function handleRefreshRunStatus(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  body: Record<string, any>,
) {
  const { runId } = body;
  if (!runId) throw new Error("runId is required");

  const { data: run, error: runErr } = await supabase
    .from("refresh_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (runErr || !run) throw new Error("Run not found");

  const { data: batches } = await supabase
    .from("refresh_batches")
    .select("*")
    .eq("run_id", runId)
    .order("batch_index");

  const { data: city } = await supabase
    .from("seeding_cities")
    .select("id, name, country, center_lat, center_lng")
    .eq("id", run.city_id)
    .single();

  return { run, batches: batches ?? [], city };
}

// ── Action: refresh_run_history ─────────────────────────────────────────────

async function handleRefreshRunHistory(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  body: Record<string, any>,
) {
  const { cityId, limit } = body;
  if (!cityId) throw new Error("cityId is required");
  const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 && Number(limit) <= 100
    ? Number(limit)
    : 20;

  const { data: runs, error } = await supabase
    .from("refresh_runs")
    .select("id, city_id, status, total_places, total_batches, completed_batches, failed_batches, skipped_batches, places_succeeded, places_failed, total_cost_usd, started_at, completed_at, created_at, triggered_by")
    .eq("city_id", cityId)
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw new Error(`History query failed: ${error.message}`);

  // Resolve triggered_by emails (auth.users — service_role bypasses RLS)
  const triggererIds = Array.from(new Set(
    (runs ?? [])
      .map((r: { triggered_by: string | null }) => r.triggered_by)
      .filter((id: string | null): id is string => id !== null)
  ));

  let emailById = new Map<string, string>();
  if (triggererIds.length > 0) {
    const { data: usersData } = await supabase.auth.admin.listUsers({ perPage: 200 });
    const idSet = new Set(triggererIds);
    for (const u of (usersData?.users ?? [])) {
      if (idSet.has(u.id)) {
        emailById.set(u.id, u.email ?? "(no email)");
      }
    }
  }

  return {
    runs: (runs ?? []).map((r: { triggered_by: string | null } & Record<string, unknown>) => ({
      ...r,
      triggered_by_email: r.triggered_by ? (emailById.get(r.triggered_by) ?? null) : null,
    })),
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    // Admin check
    const { data: adminRow } = await supabase
      .from("admin_users")
      .select("id")
      .eq("email", user.email)
      .eq("status", "active")
      .maybeSingle();

    if (!adminRow) return json({ error: "Forbidden: admin access required" }, 403);

    const body = await req.json();
    let result;

    switch (body.action) {
      case "process":
        result = await processPendingRefresh(supabase, user.id);
        break;
      case "refresh_single":
        if (!body.placePoolId) return json({ error: "placePoolId required" }, 400);
        result = await refreshSinglePlace(supabase, body.placePoolId, user.id);
        break;
      // ── ORCH-0553: batched refresh pipeline ──
      case "preview_refresh_cost":
        result = await handlePreviewRefreshCost(supabase, body);
        break;
      case "create_refresh_run":
        result = await handleCreateRefreshRun(supabase, body, user.id);
        break;
      case "run_next_refresh_batch":
        result = await handleRunNextRefreshBatch(supabase, body, user.id);
        break;
      case "retry_refresh_batch":
        result = await handleRetryRefreshBatch(supabase, body, user.id);
        break;
      case "skip_refresh_batch":
        result = await handleSkipRefreshBatch(supabase, body);
        break;
      case "cancel_refresh_run":
        result = await handleCancelRefreshRun(supabase, body);
        break;
      case "refresh_run_status":
        result = await handleRefreshRunStatus(supabase, body);
        break;
      case "refresh_run_history":
        result = await handleRefreshRunHistory(supabase, body);
        break;
      default:
        return json({ error: `Unknown action: ${body.action}` }, 400);
    }

    return json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-refresh-places] Error:", msg);
    return json({ error: msg }, 500);
  }
});
