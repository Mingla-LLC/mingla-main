// ORCH-0737 v6 — unit tests for transformPhotoUrlForTile.
//
// Run: `deno test supabase/functions/_shared/imageCollage.test.ts`
// (no --allow-net flag needed — pure URL string manipulation, no I/O)
//
// These tests pin the URL-transform behavior so future regressions that break
// the per-source rewrite logic FAIL CI. The transform is the load-bearing
// memory-safety primitive of the v6 redesign — without it, parallel-12 prep
// would re-trigger WORKER_RESOURCE_LIMIT 546.

import { transformPhotoUrlForTile } from "./imageCollage.ts";
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

Deno.test("transform — Supabase Storage object URL → render URL with size params", () => {
  const input = "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJo2hMRADtrIkR9QHFEHPWzvk/0.jpg";
  const expected = "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/render/image/public/place-photos/ChIJo2hMRADtrIkR9QHFEHPWzvk/0.jpg?width=192&height=192&resize=cover";
  assertEquals(transformPhotoUrlForTile(input, 192), expected);
});

Deno.test("transform — Storage URL with existing query params has them stripped", () => {
  const input = "https://x.supabase.co/storage/v1/object/public/bucket/path.jpg?cachebuster=123";
  const result = transformPhotoUrlForTile(input, 192);
  assertEquals(result, "https://x.supabase.co/storage/v1/render/image/public/bucket/path.jpg?width=192&height=192&resize=cover");
});

Deno.test("transform — Google lh3 CDN with =k-no suffix → =wN-hN", () => {
  const input = "https://lh3.googleusercontent.com/grass-cs/ANxoTn1h-dPcupvKjt1ePNEahZWnhs2A=k-no";
  const expected = "https://lh3.googleusercontent.com/grass-cs/ANxoTn1h-dPcupvKjt1ePNEahZWnhs2A=w192-h192";
  assertEquals(transformPhotoUrlForTile(input, 192), expected);
});

Deno.test("transform — Google lh3 CDN with no suffix → appends =wN-hN", () => {
  const input = "https://lh3.googleusercontent.com/grass-cs/ANxoTn1h-dPcupvKjt1ePNEahZWnhs2A";
  const expected = "https://lh3.googleusercontent.com/grass-cs/ANxoTn1h-dPcupvKjt1ePNEahZWnhs2A=w192-h192";
  assertEquals(transformPhotoUrlForTile(input, 192), expected);
});

Deno.test("transform — Google lh4 / lh5 / lh6 CDN host variants all match", () => {
  for (const host of ["lh4", "lh5", "lh6"]) {
    const input = `https://${host}.googleusercontent.com/path=k-no`;
    const expected = `https://${host}.googleusercontent.com/path=w192-h192`;
    assertEquals(transformPhotoUrlForTile(input, 192), expected);
  }
});

Deno.test("transform — unknown CDN URL passes through unchanged (graceful fallback)", () => {
  const input = "https://example.com/photo.jpg";
  assertEquals(transformPhotoUrlForTile(input, 192), input);
});

Deno.test("transform — empty / null / non-string input passes through unchanged", () => {
  assertEquals(transformPhotoUrlForTile("", 192), "");
  // @ts-expect-error — testing runtime guard for non-string input
  assertEquals(transformPhotoUrlForTile(null, 192), null);
});

Deno.test("transform — different tile sizes produce different URLs", () => {
  const input = "https://x.supabase.co/storage/v1/object/public/bucket/path.jpg";
  const t192 = transformPhotoUrlForTile(input, 192);
  const t256 = transformPhotoUrlForTile(input, 256);
  const t384 = transformPhotoUrlForTile(input, 384);
  const t768 = transformPhotoUrlForTile(input, 768);
  assertEquals(t192.includes("width=192"), true);
  assertEquals(t256.includes("width=256"), true);
  assertEquals(t384.includes("width=384"), true);
  assertEquals(t768.includes("width=768"), true);
});
