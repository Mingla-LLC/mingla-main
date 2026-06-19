/**
 * ORCH-1165 [Mapbox static map server-proxy]
 *
 * static-map (vendor-NEUTRAL public fn name) — server-side proxy for the "Where
 * you'll be"/"Where you'll start" static map on the public trip / event /
 * experience pages (buyer-web + business app + consumer app). Mirrors the
 * `mapbox-geocode` proxy: keeps MAPBOX_ACCESS_TOKEN strictly server-side, so the
 * client NEVER holds a Mapbox token and `api.mapbox.com` NEVER appears in client
 * network traffic. The Mapbox logo + attribution are stripped server-side
 * (`logo=false&attribution=false`). The PUBLIC fn name is deliberately
 * `static-map`, so the client `<Image>` URL `/functions/v1/static-map?…` carries
 * the substring "mapbox" NOWHERE — client traffic reveals nothing about the
 * upstream map vendor. (Internal var/log names below stay descriptive — they are
 * server-side only.)
 *
 * WHY a proxy (not a client `pk.*` token): Seth's requirement is to render the map
 * on ALL surfaces AND hide the tech stack — no Mapbox logo, no vendor host, no
 * "mapbox" in client traffic, no token in client traffic. A client token
 * (Approach A) cannot hide the host/token; only a server proxy that returns image
 * bytes from a *.supabase.co URL can.
 * (INVESTIGATE_ORCH-1162R_MAPBOX_RENDER_AND_STACK_HIDING.md, Approach B.)
 *
 * ── API surface (GET — it is an <Image source={{uri}}> target) ───────────────
 *   GET /functions/v1/static-map
 *       ?lat=<-90..90>&lng=<-180..180>          (REQUIRED, finite)
 *       &accent=<6-hex>                          (optional pin color; default eb7825)
 *       &zoom=<0..22 step allowlist>             (optional; default 11)
 *       &w=<1..1280>&h=<1..1280>                 (optional; default 600x300; clamped)
 *       &style=<allowlisted style id>            (optional; default dark-v11)
 *     → 200 image/png (Mapbox tile bytes) + Cache-Control: public, max-age=43200
 *     → 400 { error } for any invalid/out-of-range input (strict — this is a
 *            PUBLIC, unauthenticated proxy; reject open-image-fetcher abuse)
 *     → 502 { error } when Mapbox itself fails (client <Image> then hides — rule 9)
 *
 * Auth: verify_jwt = false (supabase/config.toml) — the buyer-web public page is
 * anonymous, exactly like mapbox-geocode's web peers. The strict input validation
 * + the allowlists below are the abuse guard in lieu of auth: the only thing this
 * proxy can ever fetch is a Mapbox static tile for in-range coords/size/zoom/style.
 *
 * Secret: reuses the EXISTING MAPBOX_ACCESS_TOKEN (mapbox-geocode v58 already uses
 * it) — NO new secret, NO hardcoded token.
 *
 * Mapbox Static Images API (docs cited):
 *   GET /styles/v1/mapbox/<style>/static/pin-s+<hex>(<lng>,<lat>)/<lng>,<lat>,<zoom>/<w>x<h>@2x
 *       ?logo=false&attribution=false&access_token=<token>
 *   https://docs.mapbox.com/api/maps/static-images/
 *   logo / attribution suppression params:
 *   https://docs.mapbox.com/api/maps/static-images/#optional-parameters
 *
 * OQ-1 (Mapbox ToS attribution): `attribution=false` removes the on-image credit.
 * Mapbox's standard terms generally require attribution to appear SOMEWHERE; a
 * discreet text credit on a legal/about page may be needed to stay compliant while
 * keeping the stack hidden from the map surface. Flagged for Seth/legal — NOT
 * resolved in this fn.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// https://docs.mapbox.com/api/maps/static-images/
const MAPBOX_STATIC_BASE = "https://api.mapbox.com/styles/v1/mapbox";

// Allowlisted Mapbox style ids the proxy will fetch. dark-v11 is the page default
// (matches the immersive chrome); the rest are the standard Mapbox core styles.
// Any other style id is rejected (defense against open-proxy abuse / typos).
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

// Allowlisted integer zoom levels (Mapbox static supports 0..22). We accept the
// integer levels only — the client never needs fractional zoom for a pin card.
const MIN_ZOOM = 0;
const MAX_ZOOM = 22;

const DEFAULT_STYLE = "dark-v11";
const DEFAULT_ZOOM = 11;
const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 300;
const MAX_DIMENSION = 1280; // Mapbox static @1x hard cap per side.
const FALLBACK_PIN_HEX = "eb7825"; // MINGLA_DEFAULT_THEME accent, '#'-stripped.

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

/**
 * STRICT validation of the public query params. Returns the sanitized/clamped
 * params, or an `{ error }` code for any invalid input (caller → 400). Pure +
 * exported for unit testing — never trusts a single client value.
 */
export function validateStaticParams(
  query: URLSearchParams,
): ValidatedStaticParams | { error: string } {
  const rawLat = query.get("lat");
  const rawLng = query.get("lng");
  if (rawLat === null || rawLng === null) {
    return { error: "coordinates_required" };
  }
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { error: "lat_out_of_range" };
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { error: "lng_out_of_range" };
  }

  // accent: optional bare 6-hex (the client already strips '#'); else default.
  const rawAccent = query.get("accent");
  let pin = FALLBACK_PIN_HEX;
  if (rawAccent !== null && rawAccent.length > 0) {
    if (!/^[0-9a-fA-F]{6}$/.test(rawAccent)) {
      return { error: "invalid_accent" };
    }
    pin = rawAccent.toLowerCase();
  }

  // zoom: optional integer in [0,22].
  let zoom = DEFAULT_ZOOM;
  const rawZoom = query.get("zoom");
  if (rawZoom !== null && rawZoom.length > 0) {
    const z = Number(rawZoom);
    if (!Number.isInteger(z) || z < MIN_ZOOM || z > MAX_ZOOM) {
      return { error: "invalid_zoom" };
    }
    zoom = z;
  }

  // width / height: optional positive integers, clamped to [1, MAX_DIMENSION].
  const width = clampDimension(query.get("w"), DEFAULT_WIDTH);
  if (typeof width === "object") return width;
  const height = clampDimension(query.get("h"), DEFAULT_HEIGHT);
  if (typeof height === "object") return height;

  // style: optional, allowlisted.
  let style = DEFAULT_STYLE;
  const rawStyle = query.get("style");
  if (rawStyle !== null && rawStyle.length > 0) {
    if (!ALLOWED_STYLES.has(rawStyle)) {
      return { error: "invalid_style" };
    }
    style = rawStyle;
  }

  return { lat, lng, pin, zoom, width, height, style };
}

/** Parse + clamp a dimension param; returns the number or an { error }. */
function clampDimension(
  raw: string | null,
  fallback: number,
): number | { error: string } {
  if (raw === null || raw.length === 0) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return { error: "invalid_dimension" };
  return Math.min(n, MAX_DIMENSION);
}

/**
 * Compose the server-side Mapbox Static Images URL with logo + attribution OFF.
 * Pure + exported for unit testing. The token is the server secret (never the
 * client's). lng,lat order (Mapbox is lon-first) in both the overlay + center.
 */
export function buildMapboxStaticFetchUrl(
  p: ValidatedStaticParams,
  token: string,
): string {
  const overlay = `pin-s+${p.pin}(${p.lng},${p.lat})`;
  const center = `${p.lng},${p.lat},${p.zoom}`;
  const size = `${p.width}x${p.height}@2x`;
  return (
    `${MAPBOX_STATIC_BASE}/${p.style}/static/${overlay}/${center}/${size}` +
    `?logo=false&attribution=false&access_token=${encodeURIComponent(token)}`
  );
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return jsonError("method_not_allowed", 405);
  }

  const token = Deno.env.get("MAPBOX_ACCESS_TOKEN") ?? "";
  if (!token) {
    console.error("[mapbox-static] MAPBOX_ACCESS_TOKEN not configured");
    return jsonError("mapbox_access_token_missing", 500);
  }

  const url = new URL(req.url);
  const validated = validateStaticParams(url.searchParams);
  if ("error" in validated) {
    return jsonError(validated.error, 400);
  }

  const fetchUrl = buildMapboxStaticFetchUrl(validated, token);

  let upstream: Response;
  try {
    upstream = await fetch(fetchUrl, { method: "GET" });
  } catch (e) {
    console.error("[mapbox-static] fetch error:", e);
    return jsonError("mapbox_fetch_exception", 502);
  }

  if (!upstream.ok) {
    console.warn("[mapbox-static] mapbox non-OK:", upstream.status);
    // Mapbox non-200 → return non-200 so the client <Image onError> hides the
    // map (rule 9 — never a fabricated tile). Do NOT leak the Mapbox body.
    return jsonError(
      `mapbox_${upstream.status}`,
      upstream.status >= 500 ? 502 : upstream.status,
    );
  }

  const bytes = await upstream.arrayBuffer();
  const contentType =
    upstream.headers.get("Content-Type") ?? "image/png";
  return new Response(bytes, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": contentType,
      // 12h browser/CDN cache — the tile for a fixed venue never changes.
      "Cache-Control": "public, max-age=43200",
    },
  });
}

if (import.meta.main) {
  serve(handler);
}
