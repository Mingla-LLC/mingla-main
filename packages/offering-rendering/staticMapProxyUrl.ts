/**
 * staticMapProxyUrl — the PURE composition of the static-map proxy URL,
 * `<functionsBase>/static-map?lat&lng&accent&zoom&w&h&style`. No expo import,
 * so it is Deno-unit-testable; the runtime functions-base read lives in
 * functionsBase.ts and the app-facing wrapper in staticMapImage.ts.
 *
 * The public URL contract is unchanged since ORCH-1165 (installed clients keep
 * working); the proxy behind it calls the Google Maps Static API (#4334). The
 * client URL carries no key and no provider host.
 */

/**
 * Static-map params (single canonical shape). Kept self-contained here (no cross-
 * file import) so this pure module type-checks standalone under Deno.
 */
export interface StaticMapParams {
  lat: number | null | undefined;
  lng: number | null | undefined;
  /** Brand accent hex (e.g. "#eb7825" or "eb7825"); the pin is themed to it. */
  accentHex?: string | null;
  /** Style id; the proxy defaults to the Mingla dark style. */
  style?: string;
  zoom?: number;
  width?: number;
  height?: number;
  /**
   * ORCH-1165: Supabase Edge Functions base URL override (mainly for tests);
   * defaults to the runtime `<EXPO_PUBLIC_SUPABASE_URL>/functions/v1`.
   */
  functionsBaseUrl?: string | null;
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

/** Trim a trailing slash so `${base}/static-map` never double-slashes. */
const normalizeBase = (base: string): string => base.replace(/\/+$/, "");

/**
 * Build the token-less, host-hidden proxy URL for the static map, or null when
 * coords are missing/non-finite OR the functions base URL is absent. Pure — the
 * caller resolves the functions base URL first (see staticMapImage.ts).
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

  return `${normalizeBase(functionsBaseUrl.trim())}/static-map?${query.toString()}`;
};
