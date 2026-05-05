// ORCH-0712 — adaptive photo collage helper.
//
// Composes up to 16 photo URLs into a single TARGET_SIZE×TARGET_SIZE grid image (PNG).
// Adaptive sizing: 1 = 1x1, 2-4 = 2x2, 5-9 = 3x3, 10-16 = 4x4.
// Failed photo fetches leave that cell black; we proceed with what we can decode.
//
// Used by: supabase/functions/run-place-intelligence-trial/index.ts (compose_collage action)
//
// ORCH-0713 v3 cost reduction — TARGET_SIZE shrunk 1024→768. Anthropic image-token
// billing scales roughly with image area; 768×768 ≈ 56% of 1024×1024 area, cutting
// per-call image-token cost ~30-40%. Per-tile resolution stays acceptable on dense
// 3x3 (256px tiles) and 4x4 (192px tiles) grids — Claude Haiku 4.5 vision parses
// place context fine at this resolution. Reverse to 1024 if quality regression
// observed at full-Triangle scale.

import { Image, decode } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

export const TARGET_SIZE = 768;
export const MAX_PHOTOS = 16;

/**
 * Compute adaptive grid dimension for N photos.
 * Returns { grid, tile } where grid is the N-per-side and tile is pixel size per cell.
 */
export function computeGridDims(photoCount: number): { grid: number; tile: number } {
  if (photoCount <= 0) throw new Error("computeGridDims: photoCount must be > 0");
  let grid: number;
  if (photoCount <= 1) grid = 1;
  else if (photoCount <= 4) grid = 2;
  else if (photoCount <= 9) grid = 3;
  else grid = 4;
  const tile = Math.floor(TARGET_SIZE / grid);
  return { grid, tile };
}

/**
 * Compute SHA256 of a list of photo URLs (joined by '|').
 * Used for fingerprinting cached collages.
 */
export async function fingerprintPhotos(photoUrls: string[]): Promise<string> {
  const data = new TextEncoder().encode(photoUrls.join("|"));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Fetch a photo URL and decode to imagescript Image.
 * Returns null on failure (caller leaves cell blank).
 */
async function fetchAndDecode(url: string, timeoutMs = 12_000): Promise<Image | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      console.warn(`[imageCollage] fetch failed ${res.status} for ${url.slice(0, 80)}`);
      return null;
    }
    const buf = await res.arrayBuffer();
    const img = await decode(new Uint8Array(buf));
    // imagescript decode returns Image | GIF; we only handle Image
    if (img instanceof Image) return img;
    console.warn(`[imageCollage] decoded as non-Image (likely GIF) for ${url.slice(0, 80)}`);
    return null;
  } catch (err) {
    console.warn(`[imageCollage] decode error for ${url.slice(0, 80)}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Compose photos into a single TARGET_SIZE×TARGET_SIZE PNG.
 * Returns the encoded PNG bytes + the actual photo count successfully placed.
 */
export async function composeCollage(photoUrls: string[]): Promise<{
  pngBytes: Uint8Array;
  placedCount: number;
  failedCount: number;
  grid: number;
}> {
  if (!Array.isArray(photoUrls) || photoUrls.length === 0) {
    throw new Error("composeCollage: photoUrls must be non-empty array");
  }
  const limited = photoUrls.slice(0, MAX_PHOTOS);
  const { grid, tile } = computeGridDims(limited.length);

  // Canvas dimensions snap to grid * tile (may be slightly less than 1024 due to floor)
  const canvasSize = grid * tile;
  const canvas = new Image(canvasSize, canvasSize);
  // imagescript Image starts as transparent; fill black for clean appearance
  canvas.fill(0xff_00_00_00); // ARGB black opaque (high byte = alpha)

  let placed = 0;
  let failed = 0;

  for (let i = 0; i < limited.length; i++) {
    const img = await fetchAndDecode(limited[i]);
    if (!img) {
      failed++;
      continue;
    }
    try {
      img.resize(tile, tile);
      const x = (i % grid) * tile;
      const y = Math.floor(i / grid) * tile;
      canvas.composite(img, x, y);
      placed++;
    } catch (err) {
      console.warn(`[imageCollage] composite failed for index ${i}:`, err instanceof Error ? err.message : err);
      failed++;
    }
  }

  if (placed === 0) {
    throw new Error(`composeCollage: 0 of ${limited.length} photos could be decoded — all fetches failed`);
  }

  const pngBytes = await canvas.encode();
  return { pngBytes, placedCount: placed, failedCount: failed, grid };
}
