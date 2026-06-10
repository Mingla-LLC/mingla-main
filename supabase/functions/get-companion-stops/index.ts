import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabaseAdmin = createClient(SUPABASE_URL ?? '', SUPABASE_SERVICE_ROLE_KEY ?? '');

// ORCH-1107 — companion stops now come from the scored, servable place_pool via
// the live solo-deck RPC `query_servable_places_by_signal` (the same RPC
// discover-cards uses), NOT live Google Places. The RPC enforces is_servable +
// is_active + place_scores.score >= p_filter_min + real stored_photo_urls + a
// haversine radius, so the three serving gates come for free.
const COMPANION_SIGNAL_ID = "casual_food";
const COMPANION_FILTER_MIN = 120;
const COMPANION_RPC_LIMIT = 10;

// Build the RPC params for a companion-stop lookup around the stroll anchor.
// Exported for the regression test (ORCH-1107).
export function buildCompanionRpcParams(
  anchorLocation: { lat: number; lng: number },
  maxDistance: number,
): {
  p_signal_id: string;
  p_filter_min: number;
  p_lat: number;
  p_lng: number;
  p_radius_m: number;
  p_limit: number;
} {
  return {
    p_signal_id: COMPANION_SIGNAL_ID,
    p_filter_min: COMPANION_FILTER_MIN,
    p_lat: anchorLocation.lat,
    p_lng: anchorLocation.lng,
    p_radius_m: maxDistance,
    p_limit: COMPANION_RPC_LIMIT,
  };
}

// Map a query_servable_places_by_signal row → the companion-stop shape the
// client (stopReplacementService / ExpandedCardModal / CompanionStopsSection)
// already expects. imageUrl is the first real stored photo — NO Unsplash
// placeholder (ORCH-1107 killed it). Exported for the regression test.
export function mapServableRowToCompanionStop(
  row: any,
  anchorLocation: { lat: number; lng: number },
): {
  id: any;
  name: string;
  location: { lat: number; lng: number };
  address: string;
  rating: number;
  reviewCount: number;
  imageUrl: string | null;
  placeId: any;
  type: string;
} {
  const storedPhotos = Array.isArray(row.stored_photo_urls)
    ? row.stored_photo_urls
    : [];
  return {
    id: row.place_id,
    name: row.name || "Unknown Place",
    location: {
      lat: typeof row.lat === "number" ? row.lat : anchorLocation.lat,
      lng: typeof row.lng === "number" ? row.lng : anchorLocation.lng,
    },
    address: row.address || "",
    rating: row.rating ?? 0,
    reviewCount: row.review_count ?? 0,
    imageUrl: storedPhotos[0] ?? null,
    placeId: row.google_place_id ?? row.place_id,
    type: row.primary_type || COMPANION_SIGNAL_ID,
  };
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const anchor = body?.anchor;
    const maxDistance = body?.maxDistance ?? 500; // meters

    if (!anchor?.location?.lat || !anchor?.location?.lng) {
      return new Response(
        JSON.stringify({
          error: "Anchor location is required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch companion stops from the scored place_pool and keep only the top result
    const companionStops = await findCompanionStops(
      anchor.location,
      maxDistance
    );

    if (!companionStops.length) {
      return new Response(
        JSON.stringify({
          strollData: null,
          message: "No companion stops found within range",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const companionStop = companionStops[0];
    const routeDuration = calculateStrollRouteDuration();
    const timeline = buildStrollRouteTimeline(
      companionStop,
      anchor,
      routeDuration
    );

    return new Response(
      JSON.stringify({
        strollData: {
          anchor,
          companionStops,
          route: {
            duration: routeDuration,
            startLocation: companionStop.location,
            endLocation: anchor.location,
          },
          timeline,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in get-companion-stops:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// Only bind the HTTP server when running as an edge function — NOT when this
// module is imported by the ORCH-1107 regression test (which exercises the
// exported pure helpers without a listening socket).
if (!Deno.env.get("ORCH_TEST_NO_SERVE")) {
  serve(handleRequest);
}

// Find companion stops near a stroll anchor from the scored, servable place_pool.
// Sorted by signal_score desc; returns the top 1. Graceful empty (no Google
// fallback, no throw) when the RPC returns 0 rows.
async function findCompanionStops(
  anchorLocation: { lat: number; lng: number },
  maxDistance: number = 500 // meters
): Promise<any[]> {
  try {
    const { data, error } = await supabaseAdmin.rpc(
      "query_servable_places_by_signal",
      buildCompanionRpcParams(anchorLocation, maxDistance)
    );

    if (error) {
      console.error("Error fetching companion stops:", error.message);
      return [];
    }

    const rows: any[] = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      return [];
    }

    const sorted = [...rows].sort(
      (a, b) => Number(b.signal_score ?? 0) - Number(a.signal_score ?? 0)
    );

    return sorted
      .slice(0, 1)
      .map((row) => mapServableRowToCompanionStop(row, anchorLocation));
  } catch (error) {
    console.error(`Error fetching companion stops:`, error);
    return [];
  }
}

// Build route timeline for stroll cards (solo mode)
function buildStrollRouteTimeline(
  companionStop: any,
  anchor: any,
  routeDuration: number
): any[] {
  const timeline: any[] = [];

  timeline.push({
    step: 1,
    type: "start",
    title: "Arrival & Welcome",
    location: companionStop,
    description: `Begin at ${companionStop.name}`,
    duration: 0,
  });

  const walkDuration = routeDuration - 5;
  timeline.push({
    step: 2,
    type: "walk",
    title: "Main Activity",
    location: anchor,
    description: `Walk to ${anchor.name}`,
    duration: walkDuration,
  });

  if (routeDuration >= 30) {
    timeline.push({
      step: 3,
      type: "pause",
      title: "Pause & Enjoy",
      location: anchor,
      description: `Take a moment to enjoy ${anchor.name}`,
      duration: 5,
    });
  }

  timeline.push({
    step: timeline.length + 1,
    type: "wrap-up",
    title: "Closing Touch",
    location: anchor,
    description: `End at ${anchor.name}`,
    duration: 0,
  });

  return timeline;
}

function calculateStrollRouteDuration(): number {
  return 30; // Solo: 25-35 minutes, average 30
}
