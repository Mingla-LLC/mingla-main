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

// ORCH-1107 — picnic grocery stops now come from the scored, servable
// place_pool via the live solo-deck RPC `query_servable_places_by_signal` (the
// same RPC discover-cards uses), NOT live Google Places. The RPC enforces
// is_servable + is_active + place_scores.score >= p_filter_min + real
// stored_photo_urls + a haversine radius, so the three serving gates come free.
const GROCERY_SIGNAL_ID = "groceries";
const GROCERY_FILTER_MIN = 120;
const GROCERY_RPC_LIMIT = 10;

// Build the RPC params for a grocery lookup around the picnic location.
// Exported for the regression test (ORCH-1107).
export function buildGroceryRpcParams(
  picnicLocation: { lat: number; lng: number },
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
    p_signal_id: GROCERY_SIGNAL_ID,
    p_filter_min: GROCERY_FILTER_MIN,
    p_lat: picnicLocation.lat,
    p_lng: picnicLocation.lng,
    p_radius_m: maxDistance,
    p_limit: GROCERY_RPC_LIMIT,
  };
}

// Map a query_servable_places_by_signal row → the grocery-store shape the
// client (stopReplacementService / ExpandedCardModal / picnic timeline) already
// expects. imageUrl is the first real stored photo — NO Unsplash placeholder
// (ORCH-1107 killed it). Exported for the regression test.
export function mapServableRowToGroceryStore(
  row: any,
  picnicLocation: { lat: number; lng: number },
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
  types: string[];
  distance: number;
} {
  const storedPhotos = Array.isArray(row.stored_photo_urls)
    ? row.stored_photo_urls
    : [];
  const lat = typeof row.lat === "number" ? row.lat : picnicLocation.lat;
  const lng = typeof row.lng === "number" ? row.lng : picnicLocation.lng;
  const distance = calculateDistance(
    picnicLocation.lat,
    picnicLocation.lng,
    lat,
    lng
  );
  return {
    id: row.place_id,
    name: row.name || "Unknown Store",
    location: { lat, lng },
    address: row.address || "",
    rating: row.rating ?? 0,
    reviewCount: row.review_count ?? 0,
    imageUrl: storedPhotos[0] ?? null,
    placeId: row.google_place_id ?? row.place_id,
    type: row.primary_type || GROCERY_SIGNAL_ID,
    types: Array.isArray(row.types) ? row.types : [],
    distance,
  };
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const picnic = body?.picnic || body?.picnicLocation;
    const maxDistance = body?.maxDistance ?? 2000; // meters, default 2km for grocery stores

    // Handle both full picnic object and simple location object
    const picnicLocation = picnic?.location || picnic;

    if (!picnicLocation?.lat || !picnicLocation?.lng) {
      return new Response(
        JSON.stringify({
          error: "Picnic location is required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Find a grocery store near the picnic location from the scored place_pool
    const groceryStore = await findGroceryStore(picnicLocation, maxDistance);

    if (!groceryStore) {
      return new Response(
        JSON.stringify({
          picnicData: null,
          message: "No grocery stores or markets found within range",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Normalize picnic object to have consistent structure
    const normalizedPicnic = picnic?.name
      ? picnic
      : {
          id: picnic?.id || "picnic-location",
          name: picnic?.name || picnic?.title || "Picnic Location",
          location: picnicLocation,
          address: picnic?.address || "",
        };

    const routeDuration = calculatePicnicRouteDuration();
    const timeline = buildPicnicRouteTimeline(
      groceryStore,
      normalizedPicnic,
      routeDuration
    );

    return new Response(
      JSON.stringify({
        picnicData: {
          picnic: normalizedPicnic,
          groceryStore,
          route: {
            duration: routeDuration,
            startLocation: groceryStore.location,
            endLocation: picnicLocation,
          },
          timeline,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in get-picnic-grocery:", error);
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

// Find a grocery store near a picnic location from the scored, servable
// place_pool. The RPC ranks by signal_score; among the returned servable rows
// we prefer the closest (then higher rating), matching prior UX. Graceful empty
// (no Google fallback, no throw) when the RPC returns 0 rows.
async function findGroceryStore(
  picnicLocation: { lat: number; lng: number },
  maxDistance: number = 2000 // meters
): Promise<any | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc(
      "query_servable_places_by_signal",
      buildGroceryRpcParams(picnicLocation, maxDistance)
    );

    if (error) {
      console.error("Error fetching grocery stores:", error.message);
      return null;
    }

    const rows: any[] = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      return null;
    }

    const stores = rows.map((row) =>
      mapServableRowToGroceryStore(row, picnicLocation)
    );

    // Prefer the closest store; if distances are within 100m, prefer higher rating.
    const sortedStores = stores.sort((a, b) => {
      if (Math.abs(a.distance - b.distance) > 100) {
        return a.distance - b.distance;
      }
      return (b.rating || 0) - (a.rating || 0);
    });

    return sortedStores[0];
  } catch (error) {
    console.error("Error fetching grocery stores:", error);
    return null;
  }
}

// Calculate distance between two coordinates using Haversine formula
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// Build route timeline for picnic cards
function buildPicnicRouteTimeline(
  groceryStore: any,
  picnic: any,
  routeDuration: number
): any[] {
  const timeline: any[] = [];

  // Step 1: Grocery Stop (Start)
  timeline.push({
    step: 1,
    type: "start",
    title: "Grocery Stop",
    location: groceryStore,
    description: `Pick up picnic supplies at ${groceryStore.name}`,
    duration: 20, // 15-20 minutes for shopping
  });

  // Step 2: Travel to Picnic Location
  const travelDuration = Math.max(10, routeDuration - 95); // Travel time, minimum 10 minutes
  timeline.push({
    step: 2,
    type: "travel",
    title: "Travel to Picnic Spot",
    location: picnic,
    description: `Head to ${picnic.name || "your picnic location"}`,
    duration: travelDuration,
  });

  // Step 3: Main Picnic Activity
  timeline.push({
    step: 3,
    type: "activity",
    title: "Picnic",
    location: picnic,
    description: `Set up and enjoy your picnic at ${
      picnic.name || "the picnic spot"
    }`,
    duration: 60, // 1 hour for the main picnic experience
  });

  // Step 4: Wrap-Up
  timeline.push({
    step: 4,
    type: "wrap-up",
    title: "Wrap-Up",
    location: picnic,
    description: `Clean up and enjoy final views before leaving`,
    duration: 15, // 15 minutes for cleanup
  });

  return timeline;
}

function calculatePicnicRouteDuration(): number {
  // Total duration: 20 min shopping + travel + 60 min picnic + 15 min cleanup
  // Average travel time: 15-20 minutes
  // Total: ~110-115 minutes, rounded to 120 minutes (2 hours)
  return 120;
}
