/**
 * mapboxStaticImage — pure builder for a Mapbox Static Images API URL, used by
 * the public trip page "Where you'll be" map (ORCH-1138 Leg 1).
 *
 * A `pk.*` Mapbox token is client-safe by design (publishable, scoped), so the
 * static map is just a plain <Image> with this URL — NO new dependency, NO map
 * SDK, works on native AND react-native-web.
 *
 * Token read is inlining-safe: Constants.expoConfig.extra FIRST (the only path
 * that survives Hermes standalone/OTA builds), then a STATIC process.env
 * fallback (so the Metro-dev / web-export path still resolves). Mirrors the
 * proven GIPHY pattern (giphyEventCoverService.ts) — do NOT switch to a dynamic
 * process.env[name] read (babel-preset-expo does not inline it).
 *
 * FAIL-SAFE (Constitution rule 9): if the token is absent OR coords are missing/
 * non-finite, the builder returns null and the caller HIDES the map (honest
 * pin+caption fallback) — never a fabricated/placeholder tile, never a crash.
 */
import Constants from "expo-constants";

const TOKEN_EXTRA_KEY = "EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN";

/** Inlining-safe public Mapbox token read: extra FIRST, static process.env fallback. */
export const getPublicMapboxToken = (): string | null => {
  const extra = Constants.expoConfig?.extra as
    | Record<string, string | undefined>
    | undefined;
  // STATIC member access on the fallback so babel-preset-expo inlines it.
  const raw = extra?.[TOKEN_EXTRA_KEY] ?? process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
};

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
 * when the token is absent or coords are missing/non-finite (caller hides map).
 */
export const buildStaticMapUrl = (params: StaticMapParams): string | null => {
  const { lat, lng } = params;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null;

  const token =
    params.token !== undefined ? params.token : getPublicMapboxToken();
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
