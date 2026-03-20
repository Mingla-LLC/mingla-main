import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Admin-Triggered Place Refresh Edge Function ─────────────────────────────
// Processes pending place_refresh entries from admin_backfill_log.
// Called manually by admin dashboard — NEVER scheduled or auto-invoked.
//
// Two modes:
//   1. POST { action: "process" }        — picks up pending backfill log entries
//   2. POST { action: "refresh_single", placePoolId: UUID } — refreshes one place

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DETAIL_FIELD_MASK =
  "id,displayName,formattedAddress,location,types,primaryType,rating,userRatingCount,priceLevel,regularOpeningHours,photos,websiteUri";

const PRICE_LEVEL_MAP: Record<string, { tier: string; min: number; max: number }> = {
  PRICE_LEVEL_FREE: { tier: "chill", min: 0, max: 0 },
  PRICE_LEVEL_INEXPENSIVE: { tier: "chill", min: 5, max: 15 },
  PRICE_LEVEL_MODERATE: { tier: "comfy", min: 15, max: 40 },
  PRICE_LEVEL_EXPENSIVE: { tier: "bougie", min: 40, max: 100 },
  PRICE_LEVEL_VERY_EXPENSIVE: { tier: "lavish", min: 100, max: 500 },
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

    await supabase
      .from("place_pool")
      .update({
        name: displayName?.text ?? undefined,
        address: (gPlace.formattedAddress as string) ?? undefined,
        lat: location?.latitude ?? undefined,
        lng: location?.longitude ?? undefined,
        types: (gPlace.types as string[]) ?? undefined,
        primary_type: (gPlace.primaryType as string) ?? undefined,
        rating: (gPlace.rating as number) ?? undefined,
        review_count: (gPlace.userRatingCount as number) ?? 0,
        price_level: priceLevel ?? undefined,
        price_min: priceInfo.min,
        price_max: priceInfo.max,
        price_tier: priceInfo.tier,
        opening_hours: gPlace.regularOpeningHours ?? undefined,
        photos: photos.map((p) => ({ name: p.name, widthPx: p.widthPx, heightPx: p.heightPx })),
        website: (gPlace.websiteUri as string) ?? undefined,
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
      default:
        return json({ error: `Unknown action: ${body.action}. Use 'process' or 'refresh_single'.` }, 400);
    }

    return json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-refresh-places] Error:", msg);
    return json({ error: msg }, 500);
  }
});
