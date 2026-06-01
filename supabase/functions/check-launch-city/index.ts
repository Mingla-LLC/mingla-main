// ORCH-1027 [Launch Cities admin control] — public point-in-bbox endpoint.
//
// PUBLIC edge function (verify_jwt=false in config.toml): consumer-callable BEFORE
// sign-in, because the ORCH-1028 onboarding location gate runs at app launch,
// possibly pre-auth. It exposes ONLY non-sensitive city geometry (id/name/center/
// bbox) — no PII, no auth-scoped data (I-LC-PUBLIC-NO-PII).
//
// Contract (FROZEN for ORCH-1028 — SPEC_ORCH-1027 §C.3):
//   POST { lat:number, lng:number }
//   → 200 {
//       inLaunchCity: boolean,                 // true iff point ∈ ≥1 live city bbox
//       matchedCity: { id,name,center_lat,center_lng } | null,
//       liveCities: Array<{ id,name,center_lat,center_lng,
//                           bbox_sw_lat,bbox_sw_lng,bbox_ne_lat,bbox_ne_lng }>,
//     }
//   → 400 { error } on invalid lat/lng · 405 on wrong method · 500 { error } on DB error.
//
// NO external (third-party) API is called here — pure DB read against the live
// subset (seeding_cities WHERE is_live_for_consumers = true, using the partial
// index seeding_cities_live_for_consumers_idx). COMMS-0003 external-docs citation
// is therefore N/A to this function (it applies only to the admin boundary action,
// which reuses the existing admin-seed-places geocode_city call).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, accept-language",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface LiveCityRow {
  id: string;
  name: string;
  center_lat: number;
  center_lng: number;
  bbox_sw_lat: number;
  bbox_sw_lng: number;
  bbox_ne_lat: number;
  bbox_ne_lng: number;
}

interface LaunchCity {
  id: string;
  name: string;
  center_lat: number;
  center_lng: number;
}

const INVALID_LATLNG_MSG = "lat and lng are required finite numbers in range";

// Validate a coordinate component is a finite number within [min,max].
function validCoord(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min &&
    value <= max;
}

// Point-in-bbox, inclusive bounds (SPEC §C.5). Exported for the Deno test suite
// so the determination logic is unit-tested independently of the HTTP layer.
export function isInsideBbox(
  lat: number,
  lng: number,
  c: Pick<
    LiveCityRow,
    "bbox_sw_lat" | "bbox_ne_lat" | "bbox_sw_lng" | "bbox_ne_lng"
  >,
): boolean {
  // NULL-bbox guard (ORCH-1027 QA hardening): the bbox_* columns are NOT NULL
  // today, but a future nullable migration (or a hand-edited row) could surface
  // a live city with null bounds. In JS `null` coerces to 0 in numeric
  // comparison, so an unguarded all-null bbox would MATCH the point (0,0)
  // ("Null Island" — also the common GPS-failure default), wrongly reporting
  // inLaunchCity:true. A malformed row must match NOTHING, never something.
  if (
    !Number.isFinite(c.bbox_sw_lat) || !Number.isFinite(c.bbox_ne_lat) ||
    !Number.isFinite(c.bbox_sw_lng) || !Number.isFinite(c.bbox_ne_lng)
  ) {
    return false;
  }
  return c.bbox_sw_lat <= lat && c.bbox_ne_lat >= lat &&
    c.bbox_sw_lng <= lng && c.bbox_ne_lng >= lng;
}

// Squared great-circle-ish (planar) distance — enough for a deterministic
// nearest-center tiebreak between overlapping live bboxes (SPEC §C.3). We only
// compare relative distances, so no sqrt and no haversine is needed.
function centerDistSq(lat: number, lng: number, c: LiveCityRow): number {
  const dLat = c.center_lat - lat;
  const dLng = c.center_lng - lng;
  return dLat * dLat + dLng * dLng;
}

// Pure resolver: given the live set + a point, compute the frozen response shape.
// Exported so the test suite exercises the EXACT branching the handler ships.
export function resolveLaunchCity(
  lat: number,
  lng: number,
  liveCities: LiveCityRow[],
): {
  inLaunchCity: boolean;
  matchedCity: LaunchCity | null;
  liveCities: LiveCityRow[];
} {
  const matches = liveCities.filter((c) => isInsideBbox(lat, lng, c));

  let matchedCity: LaunchCity | null = null;
  if (matches.length > 0) {
    // Deterministic single match: nearest center to the input point. Ties break
    // by id asc so the answer is stable across calls.
    const nearest = matches.reduce((best, c) => {
      const d = centerDistSq(lat, lng, c);
      const bd = centerDistSq(lat, lng, best);
      if (d < bd) return c;
      if (d === bd && c.id < best.id) return c;
      return best;
    });
    matchedCity = {
      id: nearest.id,
      name: nearest.name,
      center_lat: nearest.center_lat,
      center_lng: nearest.center_lng,
    };
  }

  return {
    inLaunchCity: matchedCity !== null,
    matchedCity,
    // Full live set, name-asc, bbox included (so ORCH-1028 can render the
    // "available cities" UX without a second call).
    liveCities: [...liveCities].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// Exported so the test suite can exercise the handler directly without binding a
// port; `serve()` (below) is invoked only when this file runs as the edge entry.
export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: { lat?: unknown; lng?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: INVALID_LATLNG_MSG }, 400);
  }

  const { lat, lng } = body ?? {};
  if (!validCoord(lat, -90, 90) || !validCoord(lng, -180, 180)) {
    return json({ error: INVALID_LATLNG_MSG }, 400);
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase
      .from("seeding_cities")
      .select(
        "id, name, center_lat, center_lng, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng",
      )
      .eq("is_live_for_consumers", true)
      .order("name", { ascending: true });

    if (error) {
      console.error("[check-launch-city] live-city query failed", error.message);
      return json({ error: "Internal error" }, 500);
    }

    const liveCities = (data ?? []) as LiveCityRow[];
    return json(resolveLaunchCity(lat, lng, liveCities), 200);
  } catch (err) {
    console.error(
      "[check-launch-city] unexpected error",
      err instanceof Error ? err.message : String(err),
    );
    return json({ error: "Internal error" }, 500);
  }
}

// Run the HTTP server only when this module is the program entry point — NOT when
// imported by the test suite (which would otherwise try to bind a port).
if (import.meta.main) {
  serve(handler);
}
