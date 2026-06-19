/**
 * mapboxStaticUrl — the PURE Mapbox Static Images API URL assembly, with NO
 * `expo-constants` (or any RN) import anywhere in its chain, so it is unit-
 * testable under Deno. The runtime token read + the app-facing default-token
 * wrapper live in mapboxStaticImage.ts.
 *
 * ORCH-1162 Bug 2 (B.0): single owner of the URL contract shared by the trip /
 * event / experience public-page maps. FAIL-SAFE (rule 9): returns null when the
 * token is absent OR coords are missing/non-finite (caller hides the map).
 */

export interface StaticMapParams {
  lat: number | null | undefined;
  lng: number | null | undefined;
  /** Brand accent hex (e.g. "#eb7825" or "eb7825"); the pin is themed to it. */
  accentHex?: string | null;
  /** Mapbox style id; defaults to dark to match the immersive page chrome. */
  style?: string;
  zoom?: number;
  width?: number;
  height?: number;
  /** Token override (mainly for tests); defaults to the runtime public token. */
  token?: string | null;
}

const DEFAULT_STYLE = "dark-v11";
const DEFAULT_ZOOM = 11;
const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 300;
const FALLBACK_PIN_HEX = "eb7825"; // MINGLA_DEFAULT_THEME accent, '#'-stripped

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Mapbox pin color must be a bare 3/6-char hex (no '#'); sanitize + fall back. */
const normalizePinHex = (accentHex?: string | null): string => {
  if (typeof accentHex !== "string") return FALLBACK_PIN_HEX;
  const stripped = accentHex.replace(/^#/, "").trim();
  return /^[0-9a-fA-F]{6}$/.test(stripped) || /^[0-9a-fA-F]{3}$/.test(stripped)
    ? stripped.toLowerCase()
    : FALLBACK_PIN_HEX;
};

/**
 * Build a Mapbox Static Images API URL for a single destination pin, or null
 * when the (already-resolved) token is absent or coords are missing/non-finite.
 * Pure — the caller resolves the token first (see mapboxStaticImage.ts).
 */
export const buildStaticMapUrlWithToken = (
  params: StaticMapParams,
  token: string | null,
): string | null => {
  const { lat, lng } = params;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null;
  if (typeof token !== "string" || token.trim().length === 0) return null;

  const style = params.style ?? DEFAULT_STYLE;
  const zoom = params.zoom ?? DEFAULT_ZOOM;
  const width = params.width ?? DEFAULT_WIDTH;
  const height = params.height ?? DEFAULT_HEIGHT;
  const pin = normalizePinHex(params.accentHex);

  // pin-s+<color>(<lng>,<lat>)/<lng>,<lat>,<zoom>/<w>x<h>@2x
  const overlay = `pin-s+${pin}(${lng},${lat})`;
  const center = `${lng},${lat},${zoom}`;
  const size = `${width}x${height}@2x`;
  return (
    `https://api.mapbox.com/styles/v1/mapbox/${style}/static/` +
    `${overlay}/${center}/${size}` +
    `?access_token=${encodeURIComponent(token.trim())}`
  );
};
