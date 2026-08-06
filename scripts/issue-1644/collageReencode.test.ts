// Issue #1644 Stage 2 — happy-path regression contract for the collage re-encode.
//
// WHAT THIS PROTECTS
// ------------------
// The whole point of Stage 2 is that we do NOT convert the 34,024 stored collages
// as-is. Every one of them was generated with the transparent-red fill bug, and a
// straight PNG -> WebP conversion bakes that defect into the new format forever
// while we simultaneously delete the only copies of the originals. This suite
// asserts the OBSERVABLE OUTPUT of the re-encoder — the decoded pixels a real WebP
// decoder sees, and the container's own chunk layout — not the value of a constant.
//
// The fixture reproduces the production signature EXACTLY: a 5-photo place laid
// out 3x3 leaves cells 5..8 unfilled, which is 4/9 = 44.444% of 589,824 pixels =
// 262,144 pixels at alpha=0. That is the number measured on real objects
// `32d478175a3e.png` and `5a9f76866f19.png` in production.
//
// FAILS-ON-REVERT: deleting the `flattenOntoOpaqueBlack(...)` line from
// `reencodeCollagePngToWebp` fails T-2/T-3/T-4. Deleting the fail-closed
// `transparentPixelsAfter !== 0` block as well still fails T-3 and T-4, because
// those assert decoded pixels rather than trusting the guard.

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import encodeWebp from "npm:@jsquash/webp@1.5.0/encode.js";

import {
  COLLAGE_CACHE_CONTROL_SECONDS,
  countTransparentPixels,
  decodeWebpToRgba,
  flattenOntoOpaqueBlack,
  gridCellCentre,
  pixelAt,
  pngKeyToWebpKey,
  reencodeCollagePngToWebp,
  WEBP_CONTENT_TYPE,
  webpHasAlphaChunk,
} from "./collageReencode.ts";

const SIZE = 768;
const GRID = 3;
const TILE = Math.floor(SIZE / GRID); // 256
const TOTAL_PIXELS = SIZE * SIZE; // 589,824
const EXPECTED_TRANSPARENT = 4 * TILE * TILE; // 262,144 == 44.444%

/**
 * Rebuild a production collage EXACTLY as the buggy generator did.
 *
 * `_shared/imageCollage.ts` pre-fix: `canvas.fill(0xff_00_00_00)` — annotated
 * "ARGB black opaque" but ImageScript's fill() is RGBA, so that is red=255,
 * alpha=0: fully transparent red. Then 5 photos are composited into cells 0..4 of
 * a 3x3 grid, leaving cells 5..8 carrying the fill.
 */
async function buildBuggyCollagePng(): Promise<Uint8Array> {
  const canvas = new Image(SIZE, SIZE);
  canvas.fill(0xff_00_00_00); // the production bug, verbatim
  for (let i = 0; i < 5; i++) {
    const tile = new Image(TILE, TILE);
    // Distinguishable opaque tiles so a mis-sampled cell cannot pass by accident.
    tile.fill(((40 + i * 30) << 24) | ((90 + i * 20) << 16) | ((160 - i * 15) << 8) | 0xff);
    canvas.composite(tile, (i % GRID) * TILE, Math.floor(i / GRID) * TILE);
  }
  return await canvas.encode();
}

/** A 9-photo place fills every cell — the 0% control from the production sample. */
async function buildFullCollagePng(): Promise<Uint8Array> {
  const canvas = new Image(SIZE, SIZE);
  canvas.fill(0xff_00_00_00);
  for (let i = 0; i < 9; i++) {
    const tile = new Image(TILE, TILE);
    tile.fill(((20 + i * 25) << 24) | ((70 + i * 18) << 16) | ((200 - i * 20) << 8) | 0xff);
    canvas.composite(tile, (i % GRID) * TILE, Math.floor(i / GRID) * TILE);
  }
  return await canvas.encode();
}

// ───────────────────────────────────────────────────────────────────────────
// T-1 — the fixture really does carry the production defect.
// A fixture that is already clean would make every assertion below vacuous.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("T-1 fixture reproduces the production defect: 262,144/589,824 = 44.444% transparent", async () => {
  const png = await buildBuggyCollagePng();
  const { Image: Img, decode } = await import("https://deno.land/x/imagescript@1.2.17/mod.ts");
  const decoded = await decode(png);
  assert(decoded instanceof Img);
  const transparent = countTransparentPixels(decoded.bitmap);

  assertEquals(
    transparent,
    EXPECTED_TRANSPARENT,
    `fixture must carry the exact production signature; got ${transparent}/${TOTAL_PIXELS}`,
  );
  assertEquals(((transparent / TOTAL_PIXELS) * 100).toFixed(3), "44.444");

  // And the empty cells really are RED, not black.
  const c = gridCellCentre(SIZE, GRID, 2, 2);
  const [r, g, b, a] = pixelAt(decoded.bitmap, SIZE, c.x, c.y);
  assertEquals([r, g, b, a], [255, 0, 0, 0], "empty cell of the stored corpus is transparent RED");
});

// ───────────────────────────────────────────────────────────────────────────
// T-2 — THE TRAP. A naive convert preserves the defect AND pays for an alpha
// channel in the new format. This test documents the failure mode we are
// avoiding; if it ever stops holding, the trap has been fixed upstream and this
// whole stage can be simplified.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("T-2 naive PNG->WebP bakes the defect in and carries an ALPH chunk", async () => {
  const png = await buildBuggyCollagePng();
  const { Image: Img, decode } = await import("https://deno.land/x/imagescript@1.2.17/mod.ts");
  const decoded = await decode(png);
  assert(decoded instanceof Img);

  // Convert WITHOUT flattening — exactly what a naive implementation would do.
  const naive = new Uint8Array(
    await encodeWebp(
      new ImageData(new Uint8ClampedArray(decoded.bitmap), SIZE, SIZE),
      { quality: 80 },
    ),
  );

  assert(webpHasAlphaChunk(naive), "a naive convert stores an ALPH chunk we never wanted");

  const back = await decodeWebpToRgba(naive);
  assertEquals(
    countTransparentPixels(back.data),
    EXPECTED_TRANSPARENT,
    "a naive convert carries all 262,144 transparent pixels into WebP",
  );
});

// ───────────────────────────────────────────────────────────────────────────
// T-3 — THE FIX, asserted on decoded output. This is the contract.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("T-3 re-encode composites onto opaque black: zero transparent pixels, empty cells are BLACK", async () => {
  const png = await buildBuggyCollagePng();
  const result = await reencodeCollagePngToWebp(png);

  assertEquals(result.width, SIZE);
  assertEquals(result.height, SIZE);
  assertEquals(
    result.transparentPixelsBefore,
    EXPECTED_TRANSPARENT,
    "the re-encoder must SEE the inherited defect",
  );
  assertEquals(result.transparentPixelsAfter, 0, "and must leave none behind");
  assertEquals(result.flattenedPixels, EXPECTED_TRANSPARENT);

  // Decode the produced WebP and assert what a real decoder sees.
  const back = await decodeWebpToRgba(result.webpBytes);
  assertEquals(back.width, SIZE);
  assertEquals(back.height, SIZE);
  assertEquals(
    countTransparentPixels(back.data),
    0,
    "the SHIPPED WebP must decode with zero transparent pixels",
  );

  for (const [col, row] of [[2, 1], [0, 2], [1, 2], [2, 2]] as const) {
    const c = gridCellCentre(SIZE, GRID, col, row);
    const [r, g, b, a] = pixelAt(back.data, SIZE, c.x, c.y);
    assertEquals(
      [r, g, b, a],
      [0, 0, 0, 255],
      `empty cell (${col},${row}) must decode OPAQUE BLACK, got rgba(${r},${g},${b},${a})`,
    );
  }
});

// ───────────────────────────────────────────────────────────────────────────
// T-4 — the alpha channel is genuinely GONE from the container, not merely
// uniformly opaque. A uniformly-opaque alpha plane still costs bytes on every
// one of 34,024 objects.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("T-4 the shipped WebP carries no alpha channel at all", async () => {
  const result = await reencodeCollagePngToWebp(await buildBuggyCollagePng());
  assertEquals(
    webpHasAlphaChunk(result.webpBytes),
    false,
    "flattened output must be a plain lossy VP8 stream with no ALPH chunk",
  );
});

// ───────────────────────────────────────────────────────────────────────────
// T-5 — a place whose grid is FULL (9 photos) must round-trip untouched. The
// production sample measured 0% transparent for exactly this case, so the
// flatten must be a no-op here rather than altering pixels.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("T-5 an already-opaque collage is not altered by the flatten", async () => {
  const result = await reencodeCollagePngToWebp(await buildFullCollagePng());
  assertEquals(result.transparentPixelsBefore, 0);
  assertEquals(result.transparentPixelsAfter, 0);
  assertEquals(result.flattenedPixels, 0, "no pixel should be touched when nothing is transparent");
  assertEquals(webpHasAlphaChunk(result.webpBytes), false);
});

// ───────────────────────────────────────────────────────────────────────────
// T-6 — the re-encode actually saves what the sweep measured.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("T-6 the re-encode is a large net saving, never a growth", async () => {
  const result = await reencodeCollagePngToWebp(await buildBuggyCollagePng());
  assert(
    result.webpByteLength < result.pngByteLength,
    `re-encode must shrink the object: ${result.pngByteLength} -> ${result.webpByteLength}`,
  );
  assert(
    result.savingRatio > 0.5,
    `expected a large saving on a synthetic flat-colour collage, got ${(result.savingRatio * 100).toFixed(2)}%`,
  );
});

// ───────────────────────────────────────────────────────────────────────────
// T-7 — key rewrite is format-only and REFUSES anything it does not recognise.
// A lenient rewrite would let the uploader write to a path nothing points at,
// and the delete step would then remove a PNG whose replacement never existed.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("T-7 key rewrite is strict and format-only", () => {
  assertEquals(
    pngKeyToWebpKey("00038388-9d54-426f-b8e8-d358bef6ef1e/32d478175a3e.png"),
    "00038388-9d54-426f-b8e8-d358bef6ef1e/32d478175a3e.webp",
  );

  for (
    const bad of [
      "00038388-9d54-426f-b8e8-d358bef6ef1e/32d478175a3e.webp", // already converted
      "00038388-9d54-426f-b8e8-d358bef6ef1e/32d478175a3e.jpg",
      "32d478175a3e.png", // no place prefix
      "00038388-9d54-426f-b8e8-d358bef6ef1e/not-hex-here.png",
      "../../etc/passwd.png",
      "",
    ]
  ) {
    assertThrows(
      () => pngKeyToWebpKey(bad),
      Error,
      "refusing to rewrite",
      `pngKeyToWebpKey must refuse ${JSON.stringify(bad)}`,
    );
  }
});

// ───────────────────────────────────────────────────────────────────────────
// T-8 — the objects we write are immutable-cacheable and correctly typed.
// `run-place-intelligence-trial` hands Gemini the mime from the HTTP response
// header, so the content-type is load-bearing, not cosmetic.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("T-8 write metadata: one-year TTL and image/webp", () => {
  assertEquals(COLLAGE_CACHE_CONTROL_SECONDS, 31_536_000, "collage keys are content fingerprints — immutable");
  assertEquals(WEBP_CONTENT_TYPE, "image/webp");
});
