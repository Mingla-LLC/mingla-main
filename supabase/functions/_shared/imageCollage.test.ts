// ORCH-0737 v6 + ORCH-0957 — unit tests for transformPhotoUrlForTile.
//
// Run: `deno test supabase/functions/_shared/imageCollage.test.ts`
// (no --allow-net flag needed — pure URL string manipulation, no I/O)
//
// These tests pin the URL-rewrite behavior so future regressions that break
// the cost-control or memory-safety contract FAIL CI.

import { transformPhotoUrlForTile } from "./imageCollage.ts";
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

function withEnv(name: string, value: string | undefined, fn: () => void) {
  const prior = Deno.env.get(name);
  try {
    if (value === undefined) Deno.env.delete(name);
    else Deno.env.set(name, value);
    fn();
  } finally {
    if (prior === undefined) Deno.env.delete(name);
    else Deno.env.set(name, prior);
  }
}

Deno.test("transform — Supabase Storage object URL defaults to thumb object URL", () => {
  const input = "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJo2hMRADtrIkR9QHFEHPWzvk/0.jpg";
  const expected = "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJo2hMRADtrIkR9QHFEHPWzvk/0_thumb.jpg";
  withEnv("USE_PLACE_PHOTO_THUMBS", undefined, () => {
    assertEquals(transformPhotoUrlForTile(input, 192), expected);
  });
});

Deno.test("transform — Storage URL with existing query params has them stripped before thumb rewrite", () => {
  const input = "https://x.supabase.co/storage/v1/object/public/bucket/path.jpg?cachebuster=123";
  withEnv("USE_PLACE_PHOTO_THUMBS", undefined, () => {
    const result = transformPhotoUrlForTile(input, 192);
    assertEquals(result, "https://x.supabase.co/storage/v1/object/public/bucket/path_thumb.jpg");
  });
});

Deno.test("transform — Supabase thumb mode handles mixed extensions", () => {
  withEnv("USE_PLACE_PHOTO_THUMBS", "true", () => {
    for (const ext of ["jpg", "png", "webp"]) {
      const input = `https://x.supabase.co/storage/v1/object/public/place-photos/abc/2.${ext}`;
      assertEquals(transformPhotoUrlForTile(input, 256), "https://x.supabase.co/storage/v1/object/public/place-photos/abc/2_thumb.jpg");
    }
  });
});

Deno.test("transform — Supabase legacy mode uses render endpoint with size params", () => {
  const input = "https://x.supabase.co/storage/v1/object/public/place-photos/abc/0.jpg";
  const legacyBase = input.replace("/object/public/", "/render/image/public/");
  withEnv("USE_PLACE_PHOTO_THUMBS", "false", () => {
    assertEquals(transformPhotoUrlForTile(input, 192), `${legacyBase}?width=192&height=192&resize=cover`);
  });
});

Deno.test("transform — ORCH-0957 cost-control contract avoids metered URL by default", () => {
  const input = "https://x.supabase.co/storage/v1/object/public/place-photos/abc/0.jpg";
  withEnv("USE_PLACE_PHOTO_THUMBS", undefined, () => {
    const result = transformPhotoUrlForTile(input, 192);
    assertEquals(result.includes("/storage/v1/object/public/"), true);
    assertEquals(result.includes("_thumb.jpg"), true);
    assertEquals(result.includes("/render/image/"), false);
    assertEquals(result.includes("width="), false);
    assertEquals(result.includes("height="), false);
    assertEquals(result.includes("resize="), false);
  });
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
  withEnv("USE_PLACE_PHOTO_THUMBS", "false", () => {
    const t192 = transformPhotoUrlForTile(input, 192);
    const t256 = transformPhotoUrlForTile(input, 256);
    const t384 = transformPhotoUrlForTile(input, 384);
    const t768 = transformPhotoUrlForTile(input, 768);
    assertEquals(t192.includes("width=192"), true);
    assertEquals(t256.includes("width=256"), true);
    assertEquals(t384.includes("width=384"), true);
    assertEquals(t768.includes("width=768"), true);
  });
});

Deno.test("transform — DISABLE_PHOTO_URL_TRANSFORM bypasses thumb rewrite", () => {
  const input = "https://x.supabase.co/storage/v1/object/public/bucket/path.jpg";
  withEnv("DISABLE_PHOTO_URL_TRANSFORM", "true", () => {
    assertEquals(transformPhotoUrlForTile(input, 192), input);
  });
});
