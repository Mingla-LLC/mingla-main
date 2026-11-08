/**
 * static-map — server-side proxy for the "Where you'll be" / "Where you'll
 * start" map image on event, venue, experience, trip and RSVP pages (buyer web,
 * Host app, Explorer app). Provider: Google Maps Static API (#4334).
 *
 * The Google key stays a server secret (GOOGLE_MAPS_API_KEY); the client only
 * ever loads `<SUPABASE_URL>/functions/v1/static-map?…`. Google's logo is part
 * of the image and is kept (Google terms; Seth decisions D5/D6).
 *
 * ── Public URL contract (unchanged for installed clients) ───────────────────
 *   GET /functions/v1/static-map
 *       ?lat=<-90..90>&lng=<-180..180>   (REQUIRED, finite)
 *       &accent=<6-hex>                   (optional pin colour; default eb7825)
 *       &zoom=<0..22 integer>             (optional; default 11; Google max 21)
 *       &w=<1..1280>&h=<1..1280>          (optional; default 600x300)
 *       &style=<allowlisted id>           (optional; old ids still accepted)
 *     → 200 image/* + Cache-Control: public, max-age=86400
 *     → 400 { error } for invalid input (public, unauthenticated: strict)
 *     → 502 { error: "map_unavailable" } when Google fails or answers with
 *       anything but an image (Google sends a 403 error IMAGE when the API is
 *       off). The client <Image onError> then hides the map
 *       (I-PROPOSED-1162-MAP-FAILSAFE-HIDES).
 *
 * Google sizes: at most 640×640 per side at scale=2, so a larger request is
 * scaled down keeping its aspect ratio.
 * https://developers.google.com/maps/documentation/maps-static/start
 * Styling: https://developers.google.com/maps/documentation/maps-static/styling
 *
 * Caching: the image is not stored by us; a 24 h HTTP/CDN cache is far inside
 * Google's 30-day caching limit (spec v2 §5).
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { recordApiCall } from "../_shared/apiHealthLog.ts";
import { captureEdgeException } from "../_shared/sentryEdge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export const GOOGLE_STATIC_BASE = "https://maps.googleapis.com/maps/api/staticmap";

/** Style ids installed clients may send. They are accepted, not forwarded. */
const ALLOWED_STYLES = new Set<string>([
  "dark-v11",
  "light-v11",
  "streets-v12",
  "outdoors-v12",
  "satellite-v9",
  "satellite-streets-v12",
  "navigation-day-v1",
  "navigation-night-v1",
]);

/**
 * Mingla dark style (Seth decision D6), recreated with Static Maps `style=`
 * parameters. Initial contract from spec v2 §5; the designer may refine the
 * hex values from a screenshot of today's tiles.
 */
export const MINGLA_DARK_STYLE: ReadonlyArray<string> = [
  "element:geometry|color:0x1d1f24",
  "element:labels.text.fill|color:0x9aa0a6",
  "element:labels.text.stroke|color:0x1d1f24",
  "feature:road|element:geometry|color:0x2c2f36",
  "feature:road.highway|element:geometry|color:0x3a3e46",
  "feature:water|element:geometry|color:0x0e1013",
  "feature:poi|visibility:off",
  "feature:transit|visibility:off",
  "feature:administrative|element:geometry.stroke|color:0x3a3e46",
];

const MIN_ZOOM = 0;
const MAX_ZOOM = 22;
export const GOOGLE_MAX_ZOOM = 21;
const DEFAULT_STYLE = "dark-v11";
const DEFAULT_ZOOM = 11;
const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 300;
const MAX_DIMENSION = 1280;
export const GOOGLE_MAX_SIDE = 640;
const FALLBACK_PIN_HEX = "eb7825";
const TIMEOUT_MS = 6000;

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export interface ValidatedStaticParams {
  lat: number;
  lng: number;
  pin: string;
  zoom: number;
  width: number;
  height: number;
  style: string;
}

/** STRICT validation of the public query params (unchanged contract). */
export function validateStaticParams(
  query: URLSearchParams,
): ValidatedStaticParams | { error: string } {
  const rawLat = query.get("lat");
  const rawLng = query.get("lng");
  if (rawLat === null || rawLng === null) return { error: "coordinates_required" };
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { error: "lat_out_of_range" };
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { error: "lng_out_of_range" };

  const rawAccent = query.get("accent");
  let pin = FALLBACK_PIN_HEX;
  if (rawAccent !== null && rawAccent.length > 0) {
    if (!/^[0-9a-fA-F]{6}$/.test(rawAccent)) return { error: "invalid_accent" };
    pin = rawAccent.toLowerCase();
  }

  let zoom = DEFAULT_ZOOM;
  const rawZoom = query.get("zoom");
  if (rawZoom !== null && rawZoom.length > 0) {
    const z = Number(rawZoom);
    if (!Number.isInteger(z) || z < MIN_ZOOM || z > MAX_ZOOM) return { error: "invalid_zoom" };
    zoom = z;
  }

  const width = clampDimension(query.get("w"), DEFAULT_WIDTH);
  if (typeof width === "object") return width;
  const height = clampDimension(query.get("h"), DEFAULT_HEIGHT);
  if (typeof height === "object") return height;

  let style = DEFAULT_STYLE;
  const rawStyle = query.get("style");
  if (rawStyle !== null && rawStyle.length > 0) {
    if (!ALLOWED_STYLES.has(rawStyle)) return { error: "invalid_style" };
    style = rawStyle;
  }

  return { lat, lng, pin, zoom, width, height, style };
}

function clampDimension(raw: string | null, fallback: number): number | { error: string } {
  if (raw === null || raw.length === 0) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return { error: "invalid_dimension" };
  return Math.min(n, MAX_DIMENSION);
}

/** Scale both sides down proportionally so neither exceeds 640. */
export function fitGoogleSize(width: number, height: number): { w: number; h: number } {
  const scale = Math.min(1, GOOGLE_MAX_SIDE / width, GOOGLE_MAX_SIDE / height);
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Compose the Google Static Maps URL. Satellite ids map to Google's satellite
 * and hybrid map types; every other id gets the Mingla dark style (D6).
 * Google takes latitude first in `center` and `markers`.
 */
export function buildGoogleStaticFetchUrl(p: ValidatedStaticParams, key: string): string {
  const { w, h } = fitGoogleSize(p.width, p.height);
  const zoom = Math.min(p.zoom, GOOGLE_MAX_ZOOM);
  const point = `${p.lat},${p.lng}`;
  const params = new URLSearchParams();
  params.set("center", point);
  params.set("zoom", String(zoom));
  params.set("size", `${w}x${h}`);
  params.set("scale", "2");
  params.set("markers", `size:mid|color:0x${p.pin}|${point}`);
  if (p.style === "satellite-v9") {
    params.set("maptype", "satellite");
  } else if (p.style === "satellite-streets-v12") {
    params.set("maptype", "hybrid");
  } else {
    for (const rule of MINGLA_DARK_STYLE) params.append("style", rule);
  }
  params.set("key", key);
  return `${GOOGLE_STATIC_BASE}?${params.toString()}`;
}

function mapUnavailable(reason: string, latencyMs: number, status?: number): Response {
  captureEdgeException(new Error(`static-map upstream failed: ${reason}`), {
    fn: "static-map",
    tags: { issue: "4334", code: "map_unavailable" },
    extra: { upstream_status: status ?? null, reason },
  });
  void recordApiCall("google_static_maps", false, latencyMs, status, {
    code: "map_unavailable",
    text: reason,
  });
  return jsonError("map_unavailable", 502);
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return jsonError("method_not_allowed", 405);

  const url = new URL(req.url);
  const validated = validateStaticParams(url.searchParams);
  if ("error" in validated) return jsonError(validated.error, 400);

  const key = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";
  if (!key) {
    captureEdgeException(new Error("GOOGLE_MAPS_API_KEY not configured"), {
      fn: "static-map",
      tags: { issue: "4334", code: "provider_key_missing" },
    });
    return jsonError("provider_key_missing", 500);
  }

  const t0 = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(buildGoogleStaticFetchUrl(validated, key), {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return mapUnavailable("fetch_exception", Date.now() - t0);
  }

  const contentType = upstream.headers.get("Content-Type") ?? "";
  if (!upstream.ok || !contentType.toLowerCase().startsWith("image/")) {
    // Never forward Google's body: a 403 error image must not render as a map.
    await upstream.body?.cancel();
    return mapUnavailable(
      upstream.ok ? `non_image:${contentType || "none"}` : `http_${upstream.status}`,
      Date.now() - t0,
      upstream.status,
    );
  }

  const bytes = await upstream.arrayBuffer();
  void recordApiCall("google_static_maps", true, Date.now() - t0, upstream.status);
  return new Response(bytes, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
}

if (import.meta.main) {
  serve(handler);
}
