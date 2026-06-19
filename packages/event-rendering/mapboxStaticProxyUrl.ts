/**
 * mapboxStaticProxyUrl — the PURE composition of the SERVER-PROXY static-map URL,
 * with NO `expo-constants` (or any RN) import in its chain, so it is unit-testable
 * under Deno. The runtime functions-base read + the app-facing wrapper live in
 * mapboxStaticImage.ts (via mapboxFunctionsBase.ts).
 *
 * ORCH-1165 [Mapbox static map server-proxy]: the static map is now fetched
 * through the `mapbox-static` Supabase edge fn (server secret MAPBOX_ACCESS_TOKEN),
 * mirroring the `mapbox-geocode` proxy. The CLIENT URL is a plain
 * `<functionsBaseUrl>/mapbox-static?lat=…&lng=…&accent=…&w=…&h=…&zoom=…&style=…`
 * — it carries NO Mapbox token and the string "mapbox" never appears as the HOST
 * (only as the edge-fn path segment), so the device/browser network log never
 * exposes `api.mapbox.com` or an `access_token`. The Mapbox logo + attribution
 * are stripped server-side (`logo=false&attribution=false`).
 *
 * Supersedes the prior client-token URL contract (mapboxStaticUrl.ts, which is now
 * the SERVER-side Mapbox URL contract owned by the edge fn). The pin/style/zoom/
 * size params are forwarded as query params to the proxy; the proxy re-validates
 * and clamps every one of them (defense-in-depth — never trust the client).
 *
 * FAIL-SAFE (Constitution rule 9 / I-PROPOSED-1162-MAP-FAILSAFE-HIDES): returns
 * null when coords are missing/non-finite OR the functions base URL is absent, so
 * the caller HIDES the map (honest text/address fallback) — never a fabricated
 * tile, never a crash.
 */

/**
 * Static-map params (single canonical shape). Kept self-contained here (no cross-
 * file import) so this pure module type-checks standalone under Deno. The
 * server-side Mapbox URL contract (mapboxStaticUrl.ts) re-exports THIS type to
 * stay a single shape across the client proxy + server builders.
 */
export interface StaticMapParams {
  lat: number | null | undefined;
  lng: number | null | undefined;
  /** Brand accent hex (e.g. "#eb7825" or "eb7825"); the pin is themed to it. */
  accentHex?: string | null;
  /** Mapbox style id; the proxy defaults to dark to match the page chrome. */
  style?: string;
  zoom?: number;
  width?: number;
  height?: number;
  /**
   * ORCH-1165: Supabase Edge Functions base URL override (mainly for tests);
   * defaults to the runtime `<EXPO_PUBLIC_SUPABASE_URL>/functions/v1`.
   */
  functionsBaseUrl?: string | null;
  /**
   * RETAINED for the server-side Mapbox URL contract (buildStaticMapUrlWithToken
   * in mapboxStaticUrl.ts). The client proxy builder no longer reads it.
   */
  token?: string | null;
}

const FALLBACK_PIN_HEX = "eb7825"; // MINGLA_DEFAULT_THEME accent, '#'-stripped

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Bare 3/6-char hex (no '#'); sanitize + fall back to the Mingla default pin. */
const normalizePinHex = (accentHex?: string | null): string => {
  if (typeof accentHex !== "string") return FALLBACK_PIN_HEX;
  const stripped = accentHex.replace(/^#/, "").trim();
  return /^[0-9a-fA-F]{6}$/.test(stripped) || /^[0-9a-fA-F]{3}$/.test(stripped)
    ? stripped.toLowerCase()
    : FALLBACK_PIN_HEX;
};

/** Trim a trailing slash so `${base}/mapbox-static` never double-slashes. */
const normalizeBase = (base: string): string => base.replace(/\/+$/, "");

/**
 * Build the token-less, host-hidden proxy URL for the static map, or null when
 * coords are missing/non-finite OR the functions base URL is absent. Pure — the
 * caller resolves the functions base URL first (see mapboxStaticImage.ts).
 *
 * The proxy itself re-validates + clamps every param; we still normalize the pin
 * hex here so the query stays clean. `accent`, `zoom`, `style`, `w`, `h` are only
 * appended when explicitly provided, so the proxy applies its own defaults.
 */
export const buildProxyStaticMapUrl = (
  params: StaticMapParams,
  functionsBaseUrl: string | null,
): string | null => {
  const { lat, lng } = params;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null;
  if (
    typeof functionsBaseUrl !== "string" ||
    functionsBaseUrl.trim().length === 0
  ) {
    return null;
  }

  const query = new URLSearchParams();
  query.set("lat", String(lat));
  query.set("lng", String(lng));
  if (params.accentHex != null) {
    query.set("accent", normalizePinHex(params.accentHex));
  }
  if (isFiniteNumber(params.zoom)) query.set("zoom", String(params.zoom));
  if (isFiniteNumber(params.width)) query.set("w", String(params.width));
  if (isFiniteNumber(params.height)) query.set("h", String(params.height));
  if (typeof params.style === "string" && params.style.trim().length > 0) {
    query.set("style", params.style.trim());
  }

  return `${normalizeBase(functionsBaseUrl.trim())}/mapbox-static?${query.toString()}`;
};
