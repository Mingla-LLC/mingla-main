/**
 * #4334 F-1 — pure sizing helpers for StaticMapImage (no React Native import,
 * so Deno tests and servers can use them).
 */
/** The static-map proxy's per-side limit (supabase/functions/static-map MAX_DIMENSION). */
export const STATIC_MAP_PROXY_MAX_SIDE = 1280;

/**
 * Pure: the proxy URL re-sized to the measured box. Sets `w`/`h` to the box,
 * scaling both down together when a side exceeds the proxy limit, so the
 * requested aspect ratio always equals the box's. Returns null for an empty box.
 */
export function staticMapUriForBox(
  uri: string,
  boxWidth: number,
  boxHeight: number,
): string | null {
  if (!(boxWidth > 0) || !(boxHeight > 0)) return null;
  const scale = Math.min(
    1,
    STATIC_MAP_PROXY_MAX_SIDE / boxWidth,
    STATIC_MAP_PROXY_MAX_SIDE / boxHeight,
  );
  const w = Math.max(1, Math.round(boxWidth * scale));
  const h = Math.max(1, Math.round(boxHeight * scale));
  const q = uri.indexOf("?");
  const base = q < 0 ? uri : uri.slice(0, q);
  const params = new URLSearchParams(q < 0 ? "" : uri.slice(q + 1));
  params.set("w", String(w));
  params.set("h", String(h));
  return `${base}?${params.toString()}`;
}

/**
 * Pure: how much of the image `resizeMode="cover"` would crop on each axis
 * (as a fraction of the image) for an image of `imgW×imgH` in a `boxW×boxH`
 * box. 0 on both axes ⇒ nothing is cut, so both bottom corners survive.
 */
export function coverCropFraction(
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
): { x: number; y: number } {
  const scale = Math.max(boxW / imgW, boxH / imgH);
  return {
    x: Math.max(0, 1 - boxW / (imgW * scale)),
    y: Math.max(0, 1 - boxH / (imgH * scale)),
  };
}
