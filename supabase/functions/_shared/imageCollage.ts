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

// [CRITICAL — ORCH-0737 v6] Server-side photo resize via URL transform.
//
// Memory safety: native-resolution decode (the prior behavior) consumed up to
// ~92 MB per photo for native uploads (4800×4800 RGBA). v3 hit
// WORKER_RESOURCE_LIMIT 546 at parallel-6 with this. v4 retreated to serial-3
// prep within compose_collage. v6 fixes at the SOURCE — fetch the photo at
// the target tile resolution from the start.
//
// Verified live 2026-05-06:
//   - Supabase Storage transform: 173 KB → 10.7 KB (94%↓)
//   - Google CDN `=w192-h192`:     59 KB → 11.8 KB (80%↓)
// Per-photo memory drops 30-50×. Parallel-12 outer prep becomes safe.
//
// Returns the source URL UNCHANGED if pattern is not recognized (graceful
// fallback to native fetch + decode for unknown CDNs). Bounded because
// composeCollage processes photos sequentially within a single call.
//
// Kill-switch: `DISABLE_PHOTO_URL_TRANSFORM=true` env var bypasses transform
// without redeploy, useful if a CDN behavior change breaks the pattern.
export function transformPhotoUrlForTile(url: string, tileSize: number): string {
  if (!url || typeof url !== "string") return url;

  // ORCH-0737 v6 kill-switch: operator sets DISABLE_PHOTO_URL_TRANSFORM=true
  // to revert to native-resolution fetch without redeploying.
  if (Deno.env.get("DISABLE_PHOTO_URL_TRANSFORM") === "true") return url;

  // Pattern 1 — Supabase Storage public object URL.
  // Source:  https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
  // Target:  https://<project>.supabase.co/storage/v1/render/image/public/<bucket>/<path>?width=N&height=N&resize=cover
  const supabaseObjectPrefix = "/storage/v1/object/public/";
  if (url.includes(supabaseObjectPrefix)) {
    const transformedPath = url.replace(
      "/storage/v1/object/public/",
      "/storage/v1/render/image/public/",
    );
    // Strip any existing query params before re-appending — defensive.
    const [base] = transformedPath.split("?");
    return `${base}?width=${tileSize}&height=${tileSize}&resize=cover`;
  }

  // Pattern 2 — Google lh3/lh4/lh5/lh6 CDN (review photos via Serper).
  // Source:  https://lh3.googleusercontent.com/<path>=k-no  (or =w800-h600, =s1200, etc.)
  // Target:  https://lh3.googleusercontent.com/<path>=w<N>-h<N>
  // Verified: =w192-h192, =s192, =w192-h192-no all work and return ~12 KB.
  if (/^https:\/\/lh\d+\.googleusercontent\.com\//.test(url)) {
    // Strip ANY trailing =* suffix and append our own.
    const [base] = url.split("=");
    return `${base}=w${tileSize}-h${tileSize}`;
  }

  // Unknown URL pattern — fall back to native (bounded by sequential loop).
  return url;
}

/**
 * Fetch a photo URL and decode to imagescript Image.
 * Returns null on failure (caller leaves cell blank).
 *
 * ORCH-0737 v6: caller MUST pass tileSize so the URL is rewritten to request
 * tile-resolution from the remote (memory-safety contract — see helper above).
 */
async function fetchAndDecode(url: string, tileSize: number, timeoutMs = 12_000): Promise<Image | null> {
  const transformedUrl = transformPhotoUrlForTile(url, tileSize);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(transformedUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      console.warn(`[imageCollage] fetch failed ${res.status} for ${transformedUrl.slice(0, 80)}`);
      return null;
    }
    const buf = await res.arrayBuffer();
    const img = await decode(new Uint8Array(buf));
    // imagescript decode returns Image | GIF; we only handle Image
    if (img instanceof Image) return img;
    console.warn(`[imageCollage] decoded as non-Image (likely GIF) for ${transformedUrl.slice(0, 80)}`);
    return null;
  } catch (err) {
    console.warn(`[imageCollage] decode error for ${transformedUrl.slice(0, 80)}:`, err instanceof Error ? err.message : err);
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

  // [CRITICAL — ORCH-0737 v6] This loop stays SERIAL on purpose.
  // Per-call memory safety: ~5 MB peak per photo (URL-transformed at tile
  // resolution). The outer parallel-12 lives in `runPrepIteration` — DO NOT
  // also parallelize photos within a single compose call, or memory blows
  // (12 outer × 16 inner = 192 in-flight decoded buffers = 546 errors).
  for (let i = 0; i < limited.length; i++) {
    const img = await fetchAndDecode(limited[i], tile);                     // v6: pass tile for URL transform
    if (!img) {
      failed++;
      continue;
    }
    try {
      img.resize(tile, tile);                                               // safety net — usually a no-op (img already at tile size)
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
