// Issue #1644 — the collage canvas background must be OPAQUE BLACK, not transparent red.
//
// `imageCollage.ts` filled the canvas with `0xff_00_00_00` and annotated it
// "ARGB black opaque (high byte = alpha)". ImageScript's `fill()` takes RGBA —
// high byte = RED, low byte = ALPHA — so that constant produced
// red=255, green=0, blue=0, alpha=0: fully TRANSPARENT RED.
//
// Measured on real production objects before the fix: a 5-photo place composed
// into a 3x3 grid had 262,144 / 589,824 = 44.444% of pixels at alpha=0 (exactly
// the 4/9 cells with no photo), while a 9-photo place measured 0.000%.
//
// These tests assert the OBSERVABLE OUTPUT of composeCollage — the actual pixel
// values of the empty cells — rather than the value of the constant. A test that
// only asserted `fill` was called with `0x000000ff` would pass against any
// refactor that changed how the background is produced while still emitting
// transparent pixels, which is the failure mode that shipped here.

import { Image, decode } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { composeCollage, computeGridDims, TARGET_SIZE } from "../imageCollage.ts";

/** A solid, unmistakably non-black JPEG so a placed tile is never confused with the background. */
async function makeSolidJpeg(rgba: number): Promise<ArrayBuffer> {
  const img = new Image(64, 64);
  img.fill(rgba);
  const bytes = await img.encodeJPEG(90);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function installFetchStub(jpeg: ArrayBuffer): () => void {
  const prior = globalThis.fetch;
  globalThis.fetch = (_input: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(
      new Response(jpeg.slice(0), { status: 200, headers: { "content-type": "image/jpeg" } }),
    );
  return () => {
    globalThis.fetch = prior;
  };
}

/** Count pixels at each alpha extreme across the decoded PNG. */
function alphaHistogram(img: Image): { transparent: number; opaque: number; total: number } {
  let transparent = 0;
  let opaque = 0;
  const bitmap = img.bitmap;
  const total = bitmap.length / 4;
  for (let i = 3; i < bitmap.length; i += 4) {
    if (bitmap[i] === 0) transparent++;
    else if (bitmap[i] === 255) opaque++;
  }
  return { transparent, opaque, total };
}

Deno.test("#1644 5-photo 3x3 collage: the 4 empty cells are OPAQUE BLACK, and no pixel is transparent", async () => {
  // Blue tiles — so an 'empty cell is black' assertion cannot be satisfied by a tile.
  const restore = installFetchStub(await makeSolidJpeg(0x00_66_ff_ff));
  try {
    const urls = Array.from(
      { length: 5 },
      (_, i) => `https://x.supabase.co/storage/v1/object/public/place-photos/place-1644/${i}.jpg`,
    );

    const result = await composeCollage(urls);
    assertEquals(result.placedCount, 5);
    assertEquals(result.failedCount, 0);
    assertEquals(result.grid, 3); // 5 photos => 3x3

    const decoded = await decode(result.pngBytes);
    assert(decoded instanceof Image, "collage must decode as an Image");
    const img = decoded as Image;

    const { grid, tile } = computeGridDims(5);
    assertEquals(grid, 3);
    assertEquals(img.width, grid * tile);
    assertEquals(img.height, grid * tile);

    // ── The core assertion: EVERY pixel is opaque. ──────────────────────────
    // Pre-fix this collage measured 44.444% (4/9) of pixels at alpha=0.
    const hist = alphaHistogram(img);
    assertEquals(
      hist.transparent,
      0,
      `expected zero transparent pixels, found ${hist.transparent}/${hist.total} ` +
        `(${((hist.transparent / hist.total) * 100).toFixed(3)}%)`,
    );
    assertEquals(hist.opaque, hist.total, "every pixel must be fully opaque (alpha=255)");

    // ── Sample the centre of each of the 4 EMPTY cells (indices 5..8). ──────
    // These are the cells the fill is responsible for. They must be (0,0,0,255).
    for (let i = 5; i < 9; i++) {
      const cx = (i % grid) * tile + Math.floor(tile / 2);
      const cy = Math.floor(i / grid) * tile + Math.floor(tile / 2);
      const [r, g, b, a] = Image.colorToRGBA(img.getPixelAt(cx + 1, cy + 1));
      assertEquals(
        [r, g, b, a],
        [0, 0, 0, 255],
        `empty cell ${i} at (${cx},${cy}) must be opaque black, got rgba(${r},${g},${b},${a})`,
      );
    }

    // ── Negative control: a PLACED cell is NOT black, so the assertion above ──
    // is proving the background fill and not a uniformly-black image.
    const [pr, pg, pb, pa] = Image.colorToRGBA(img.getPixelAt(Math.floor(tile / 2), Math.floor(tile / 2)));
    assertEquals(pa, 255, "placed tile must also be opaque");
    assert(
      pr !== 0 || pg !== 0 || pb !== 0,
      `placed cell must not be black (got rgba(${pr},${pg},${pb},${pa})) — otherwise the ` +
        "empty-cell assertion is vacuous",
    );
  } finally {
    restore();
  }
});

Deno.test("#1644 single-photo 1x1 collage is fully covered and fully opaque (no regression on the full-grid case)", async () => {
  const restore = installFetchStub(await makeSolidJpeg(0xff_99_00_ff));
  try {
    const result = await composeCollage([
      "https://x.supabase.co/storage/v1/object/public/place-photos/place-1644b/0.jpg",
    ]);
    assertEquals(result.placedCount, 1);
    assertEquals(result.grid, 1);

    const decoded = await decode(result.pngBytes);
    assert(decoded instanceof Image);
    const hist = alphaHistogram(decoded as Image);
    assertEquals(hist.transparent, 0);
    assertEquals(hist.opaque, hist.total);
    assertEquals((decoded as Image).width, TARGET_SIZE);
  } finally {
    restore();
  }
});

Deno.test("#1644 a FAILED photo leaves an opaque-black cell, matching the module's documented contract", async () => {
  // The module header states "Failed photo fetches leave that cell black".
  // Pre-fix they were left transparent red. Two photos => 2x2 grid, 1 fails.
  const prior = globalThis.fetch;
  const jpeg = await makeSolidJpeg(0x00_66_ff_ff);
  const good = "https://x.supabase.co/storage/v1/object/public/place-photos/place-1644c/0.jpg";
  const bad = "https://x.supabase.co/storage/v1/object/public/place-photos/place-1644c/1.jpg";

  globalThis.fetch = (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    // Fail BOTH the thumb rewrite and the original-object fallback for photo 1.
    if (url.includes("/1")) return Promise.resolve(new Response("gone", { status: 404 }));
    return Promise.resolve(
      new Response(jpeg.slice(0), { status: 200, headers: { "content-type": "image/jpeg" } }),
    );
  };

  try {
    const result = await composeCollage([good, bad]);
    assertEquals(result.placedCount, 1);
    assertEquals(result.failedCount, 1);
    assertEquals(result.grid, 2);

    const decoded = await decode(result.pngBytes);
    assert(decoded instanceof Image);
    const img = decoded as Image;
    const hist = alphaHistogram(img);
    assertEquals(hist.transparent, 0, "a failed photo must leave an OPAQUE black cell, not a transparent one");

    // Cell index 1 (top-right) is the failed one.
    const { grid, tile } = computeGridDims(2);
    const cx = (1 % grid) * tile + Math.floor(tile / 2);
    const cy = Math.floor(1 / grid) * tile + Math.floor(tile / 2);
    assertEquals(Image.colorToRGBA(img.getPixelAt(cx + 1, cy + 1)), [0, 0, 0, 255]);
  } finally {
    globalThis.fetch = prior;
  }
});
