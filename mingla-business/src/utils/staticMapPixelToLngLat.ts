/**
 * staticMapPixelToLngLat — Issue #1363 [three-tier address · Tier-3 pin-drop]
 *
 * PURE Web-Mercator math (no imports) converting a tap at logical pixel (px,py)
 * on a Mapbox static image — centered at (lat0,lng0), integer `zoom`, logical
 * size W×H — into the geographic (lng,lat) under that pixel. It is the ONLY
 * coordinate-guessing step in the pin-drop flow, and it is deterministic +
 * trivially unit-testable (SPEC §6.4 / §12).
 *
 * Mapbox `styles/v1` static images use 512-px tiles; the requested W×H is the
 * LOGICAL size (`@2x` only doubles bitmap density, not the coordinate mapping),
 * so `worldPx = 512 * 2**zoom` and the tap offset from the image center maps
 * linearly in Mercator world-pixels.
 * https://docs.mapbox.com/api/maps/static-images/
 *
 * NOTE — the confirmed pin coordinate in PinDropSheet is the current map CENTER,
 * never a confirm-time pixel guess. This function is used only to RECENTER the
 * map on a tap (move `center` to the tapped point), so any small mapping error
 * self-corrects on the next fetch. It never fabricates the final coordinate.
 */

const TILE_SIZE = 512;
const HALF_PI_DEG = 85.05112878; // Web-Mercator latitude limit.

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/** Wrap a longitude into (-180, 180]. */
const normalizeLng = (lng: number): number => ((((lng + 540) % 360) + 360) % 360) - 180;

export interface StaticMapPixelInput {
  /** Center latitude the image was fetched at. */
  centerLat: number;
  /** Center longitude the image was fetched at. */
  centerLng: number;
  /** Integer Mapbox zoom the image was fetched at. */
  zoom: number;
  /** Logical image width in px (the `w` requested, NOT the @2x bitmap width). */
  width: number;
  /** Logical image height in px (the `h` requested). */
  height: number;
  /** Tap X from the image's top-left, in the same logical px space as width. */
  px: number;
  /** Tap Y from the image's top-left, in the same logical px space as height. */
  py: number;
}

export interface LngLat {
  lat: number;
  lng: number;
}

/**
 * Convert a logical-pixel tap on a static Mapbox image to (lng,lat). Pure +
 * deterministic. Returns the center's own coordinate exactly when (px,py) is the
 * image center. Latitude is clamped to the Web-Mercator limit; longitude wraps
 * to (-180,180].
 */
export function staticMapPixelToLngLat(input: StaticMapPixelInput): LngLat {
  const { centerLat, centerLng, zoom, width, height, px, py } = input;

  const worldPx = TILE_SIZE * Math.pow(2, zoom);

  // Center's world-pixel coordinate (Mercator).
  const cx = (worldPx * (centerLng + 180)) / 360;
  const s = Math.sin((centerLat * Math.PI) / 180);
  const cy = worldPx * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI));

  // Tapped pixel's world-pixel coordinate = center + offset from image center.
  const tx = cx + (px - width / 2);
  const ty = cy + (py - height / 2);

  const lng = (tx / worldPx) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * ty) / worldPx;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));

  return {
    lat: clamp(lat, -HALF_PI_DEG, HALF_PI_DEG),
    lng: normalizeLng(lng),
  };
}

export default staticMapPixelToLngLat;
