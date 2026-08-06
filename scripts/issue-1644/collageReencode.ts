// Issue #1644 — Stage 2: the collage re-encode. PURE CORE (no I/O, no database).
//
// WHAT THIS IS
// ------------
// `place-collages` holds 34,024 objects / 33.35 GiB, 100% PNG, 768x768 RGBA,
// averaging ~1,028 KB. Re-encoding them to WebP q80 at the same 768x768 was
// measured at a 90.2% saving across 20 real objects (and 91.8% across a second,
// independent 3-object sample). That reclaims ~30 GiB WITHOUT deleting a single
// asset — which is the precondition for the next city launch, because the Stage 0
// guardrail refuses backfills above 85 GiB and we currently sit at 78.21 GiB,
// i.e. 92% of the ceiling with 6.79 GiB of room.
//
// THE TRAP THIS MODULE EXISTS TO AVOID
// ------------------------------------
// Every one of those 34,024 collages was generated with the transparent-fill bug
// fixed in `supabase/functions/_shared/imageCollage.ts` on 2026-08-05: the canvas
// was filled with `0xff_00_00_00`, annotated "ARGB black opaque", but ImageScript's
// `fill()` takes RGBA — high byte RED, low byte ALPHA. That constant is therefore
// fully TRANSPARENT RED. Measured on production objects, a 5-photo place in a 3x3
// grid carries 262,144 / 589,824 = exactly 44.444% of pixels at alpha=0 (the four
// unfilled cells); a 9-photo place measures 0%.
//
// A NAIVE PNG -> WebP CONVERSION PERMANENTLY BAKES THAT DEFECT INTO THE NEW
// FORMAT. Measured here, on the real object `32d478175a3e.png`:
//
//   original PNG          : alpha0 = 262,144 / 589,824, empty cell rgba(255,0,0,0)
//   naive PNG -> WebP q80 : alpha0 = 262,144 / 589,824, empty cell rgba(255,1,0,0)
//                           48,060 B, container VP8X + an ALPH chunk we pay to store
//   flattened  -> WebP q80: alpha0 = 0,                 empty cell rgba(0,0,0,255)
//                           47,700 B, container plain VP8, NO ALPH chunk
//
// So flattening is not cosmetic. It (a) corrects the corpus at the only cheap
// moment we will ever get — the re-encode already decodes every image — (b) drops
// an alpha channel we never wanted and would otherwise pay to store forever, and
// (c) compresses very slightly better as a result. Doing it later means redoing
// all 34,000.
//
// WHY WE DECODE AND ENCODE OURSELVES
// ----------------------------------
// Supabase's image-transformation endpoint (`/storage/v1/render/image/...`) is
// OFF-LIMITS: the spend cap is ARMED (COMMS-0133) and Pro includes only 100 origin
// images per MONTH. Routing 34,024 objects through it would trigger an org-wide
// Fair-Use restriction, which can put the database into read-only mode. So this
// module decodes and encodes in-process.
//
// DEPENDENCIES
// ------------
// - imagescript@1.2.17 — the SAME pinned version that GENERATED these collages
//   (`_shared/imageCollage.ts`), so the decode is exactly the inverse of the
//   encode. It has no WebP encoder at any published version (verified: the only
//   `encode*` symbols in ImageScript.js are `encode` (PNG) and `encodeJPEG`).
// - @jsquash/webp@1.5.0 — libwebp compiled to WASM, resolved through Deno's
//   native `npm:` specifier (NOT esm.sh, which drags in a large
//   deno.land/std node-polyfill graph). Cross-validated: its q80 output for the
//   three collages the orchestrator measured independently is byte-identical
//   (93,590 / 48,060 / 109,104 B).

import { Image, decode } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import encodeWebp from "npm:@jsquash/webp@1.5.0/encode.js";
import decodeWebp from "npm:@jsquash/webp@1.5.0/decode.js";
// Re-exported, NOT redefined. The collage generator and this re-encoder must
// agree on the TTL, or half the bucket ends up on a one-hour cache and nobody
// notices (Constitution #2 — one owner per truth).
export { COLLAGE_CACHE_CONTROL_SECONDS } from "../../supabase/functions/_shared/imageCollage.ts";

/** The bucket holding the collages. Content-addressed: `<placeId>/<fp12>.png`. */
export const COLLAGE_BUCKET = "place-collages";

/**
 * WebP quality. 80 is the sweep's measured operating point (90.2% saving over
 * 20 objects). q75 buys another 1.5 points and q82@512 buys 5 more, but 768x768
 * is what Gemini is calibrated on (`imageCollage.ts` TARGET_SIZE) and dropping
 * resolution is a model-quality change, not a storage change. We change the
 * container, not the picture.
 */
export const WEBP_QUALITY = 80;

/** Storage content-type for the re-encoded objects. Gemini reads mime from this. */
export const WEBP_CONTENT_TYPE = "image/webp";

/** `<placeId>/<12-hex fingerprint>.png` — the shape every collage key has. */
export const COLLAGE_PNG_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{12}\.png$/;

/**
 * Derive the `.webp` key from a `.png` key.
 *
 * THROWS rather than returning the input on a non-matching key. A silent
 * pass-through would let a malformed key reach the uploader and write an object
 * at a path nothing points to — and then the delete step would happily remove a
 * PNG whose "replacement" never existed. The key rewrite is the one place where
 * being strict costs nothing and being lenient loses data.
 */
export function pngKeyToWebpKey(key: string): string {
  if (!COLLAGE_PNG_KEY_PATTERN.test(key)) {
    throw new Error(
      `pngKeyToWebpKey: refusing to rewrite "${key}" — expected ` +
        `<place-uuid>/<12-hex-fingerprint>.png`,
    );
  }
  return `${key.slice(0, -4)}.webp`;
}

/**
 * Count fully-transparent pixels in a straight (non-premultiplied) RGBA bitmap.
 * This is the measurement that produced the 44.444% production signature, and
 * the regression test asserts it lands at zero after re-encoding.
 */
export function countTransparentPixels(bitmap: ArrayLike<number>): number {
  let n = 0;
  for (let i = 3; i < bitmap.length; i += 4) {
    if (bitmap[i] === 0) n++;
  }
  return n;
}

/**
 * Composite a straight RGBA bitmap onto OPAQUE BLACK, in place, and drop alpha.
 *
 * For a destination of pure black, `out = src * a / 255` — the destination
 * contributes nothing, so this reduces to scaling by alpha. Fully transparent
 * pixels therefore become rgba(0,0,0,255), which is what the collage generator
 * always intended for empty grid cells.
 *
 * Handles PARTIAL alpha generally rather than special-casing 0/255. Production
 * collages only ever carry 0 or 255 (the fill vs. composited opaque photos), but
 * a source photo with real translucency would otherwise be blended wrong, and the
 * general form costs one multiply.
 *
 * Returns the number of pixels whose alpha was not already 255 — i.e. how much
 * of the defect this call corrected.
 */
export function flattenOntoOpaqueBlack(bitmap: { [i: number]: number; length: number }): number {
  let changed = 0;
  for (let i = 0; i < bitmap.length; i += 4) {
    const a = bitmap[i + 3];
    if (a === 255) continue;
    changed++;
    if (a === 0) {
      bitmap[i] = 0;
      bitmap[i + 1] = 0;
      bitmap[i + 2] = 0;
      bitmap[i + 3] = 255;
      continue;
    }
    bitmap[i] = Math.round((bitmap[i] * a) / 255);
    bitmap[i + 1] = Math.round((bitmap[i + 1] * a) / 255);
    bitmap[i + 2] = Math.round((bitmap[i + 2] * a) / 255);
    bitmap[i + 3] = 255;
  }
  return changed;
}

/**
 * True when a WebP byte stream carries an extended header with an alpha channel.
 *
 * A lossy WebP with alpha is stored as `RIFF....WEBPVP8X` plus an `ALPH` chunk;
 * a lossy WebP without alpha is plain `RIFF....WEBPVP8 `. Reading the container
 * is how we prove the alpha channel is GONE rather than merely uniformly opaque —
 * a uniformly-opaque alpha channel still costs bytes on every one of 34,024
 * objects.
 */
export function webpHasAlphaChunk(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 64)));
  if (!head.startsWith("RIFF") || head.slice(8, 12) !== "WEBP") {
    throw new Error("webpHasAlphaChunk: not a RIFF/WEBP container");
  }
  return head.includes("ALPH");
}

export interface ReencodeResult {
  /** The bytes to upload. */
  webpBytes: Uint8Array;
  width: number;
  height: number;
  pngByteLength: number;
  webpByteLength: number;
  /** Transparent pixels in the ORIGINAL — the defect we inherited. */
  transparentPixelsBefore: number;
  /** Transparent pixels after flattening. MUST be 0. */
  transparentPixelsAfter: number;
  /** Pixels whose alpha was not already 255 (i.e. corrected by the flatten). */
  flattenedPixels: number;
  totalPixels: number;
  /** 1 - (webp / png). 0.902 == the sweep's measured 90.2%. */
  savingRatio: number;
}

/**
 * Decode a stored collage PNG, composite it onto opaque black, drop alpha, and
 * re-encode as WebP at the SAME pixel dimensions.
 *
 * Deliberately does NOT resize. The 768x768 geometry is what the vision prompt is
 * calibrated on; shrinking it is a model-quality decision, not a storage one, and
 * it is not what this stage was approved to do.
 *
 * FAILS CLOSED on a residual transparent pixel. If the flatten did not fully
 * take, we would be about to write the defect into the new format permanently and
 * then delete the only copy of the original. Throwing here is the difference
 * between a failed job row and an unrecoverable corpus.
 */
export async function reencodeCollagePngToWebp(
  pngBytes: Uint8Array,
  opts: { quality?: number } = {},
): Promise<ReencodeResult> {
  const quality = opts.quality ?? WEBP_QUALITY;

  const decoded = await decode(pngBytes);
  if (!(decoded instanceof Image)) {
    throw new Error("reencodeCollagePngToWebp: decoded payload is not a still image");
  }
  const { width, height } = decoded;
  const totalPixels = width * height;

  const transparentPixelsBefore = countTransparentPixels(decoded.bitmap);
  const flattenedPixels = flattenOntoOpaqueBlack(decoded.bitmap);
  const transparentPixelsAfter = countTransparentPixels(decoded.bitmap);

  if (transparentPixelsAfter !== 0) {
    throw new Error(
      `reencodeCollagePngToWebp: flatten left ${transparentPixelsAfter}/${totalPixels} ` +
        `transparent pixels — refusing to encode a still-defective image`,
    );
  }

  // A real `ImageData` rather than a structural stand-in: it is the exact type
  // jsquash declares, so no cast is needed, and its constructor asserts
  // data.length === width * height * 4 — a cheap, free check that the bitmap and
  // the dimensions have not drifted apart.
  const encoded = await encodeWebp(
    new ImageData(new Uint8ClampedArray(decoded.bitmap), width, height),
    { quality },
  );
  const webpBytes = new Uint8Array(encoded);

  if (webpBytes.length === 0) {
    throw new Error("reencodeCollagePngToWebp: encoder returned zero bytes");
  }

  return {
    webpBytes,
    width,
    height,
    pngByteLength: pngBytes.length,
    webpByteLength: webpBytes.length,
    transparentPixelsBefore,
    transparentPixelsAfter,
    flattenedPixels,
    totalPixels,
    savingRatio: 1 - webpBytes.length / pngBytes.length,
  };
}

/**
 * Decode a WebP back to RGBA. Used by the verification pass and the regression
 * test to assert observable OUTPUT (what a decoder actually sees) rather than the
 * value of a constant — imagescript cannot decode WebP, so this is the only route.
 */
export async function decodeWebpToRgba(
  bytes: Uint8Array,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  // jsquash's decoder takes an ArrayBuffer. Slicing by the view's own offset and
  // length (rather than handing over `bytes.buffer`) is correct for a Uint8Array
  // that is a VIEW into a larger buffer — which is what `subarray` produces and
  // what a careless `.buffer` would silently mis-read.
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const img = await decodeWebp(ab);
  // libwebp always yields 8-bit RGBA; the DOM `ImageDataArray` union admits wider
  // element types that this codec never produces, so re-wrap the same bytes in the
  // concrete view the callers (and the pixel probes) expect.
  const data = new Uint8ClampedArray(
    img.data.buffer,
    img.data.byteOffset,
    img.data.byteLength,
  );
  return { data, width: img.width, height: img.height };
}

/**
 * Read one pixel out of an RGBA buffer. Small, but it keeps the pixel-index
 * arithmetic in exactly one place — the tests and the verifier both sample
 * specific grid cells and an off-by-one there would silently sample a photo tile
 * instead of an empty cell and pass for the wrong reason.
 */
export function pixelAt(
  data: ArrayLike<number>,
  width: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const o = (y * width + x) * 4;
  return [data[o], data[o + 1], data[o + 2], data[o + 3]];
}

/**
 * Centre coordinate of cell (col,row) in a `grid`x`grid` collage of side `size`.
 * A 5-photo place lays out 3x3 with cells 5..8 empty, which is precisely where
 * the transparent-red defect lives.
 */
export function gridCellCentre(
  size: number,
  grid: number,
  col: number,
  row: number,
): { x: number; y: number } {
  const tile = Math.floor(size / grid);
  return {
    x: col * tile + Math.floor(tile / 2),
    y: row * tile + Math.floor(tile / 2),
  };
}
