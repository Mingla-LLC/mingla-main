// ORCH-1033 T-01 (implementor happy-path) — the REAL missing-thumb fallback.
//
// Root cause (Investigation F-3, live HTTP probe): a missing Supabase Storage
// object returns HTTP **400** with body
//   {"statusCode":"404","error":"not_found","message":"Object not found"}
// NOT HTTP 404. The pre-ORCH-1033 fallback guard checked `res.status === 404`
// only, so it never fired on the real 400 → the photo was dropped → an
// all-thumb-missing place threw and failed the intelligence run.
//
// This test mocks the EXACT production failure (400 + the not_found JSON body)
// and asserts:
//   1. composeCollage places the photo from the ORIGINAL full-size object.
//   2. it does NOT throw.
//   3. it NEVER fetches the metered Supabase render-image endpoint.
//
// Fails-on-revert: with the old `res.status === 404` guard, the 400 response
// short-circuits to `return null` (no fallback) → placedCount 0 → throw. So
// reverting the F-fix turns this test red.

import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { composeCollage } from "./imageCollage.ts";

const RENDER_ENDPOINT_NEEDLE = "/storage/v1/" + "render/image/";

// Real Supabase Storage "object not found" body for a missing object.
const OBJECT_NOT_FOUND_BODY = JSON.stringify({
  statusCode: "404",
  error: "not_found",
  message: "Object not found",
});

async function makeJpegBody(): Promise<ArrayBuffer> {
  const img = new Image(16, 16);
  img.fill(0xff_22_88_cc);
  const bytes = await img.encodeJPEG(80);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function withEnv(
  values: Record<string, string | undefined>,
  fn: () => Promise<void>,
) {
  const prior = new Map<string, string | undefined>();
  for (const name of Object.keys(values)) prior.set(name, Deno.env.get(name));
  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
    await fn();
  } finally {
    for (const [name, value] of prior.entries()) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

Deno.test("T-01 missing thumb returns HTTP 400 (not 404) → falls back to ORIGINAL object, no throw, no render endpoint", async () => {
  const priorFetch = globalThis.fetch;
  const jpegBody = await makeJpegBody();
  const fetchUrls: string[] = [];
  const original = "https://x.supabase.co/storage/v1/object/public/place-photos/ChIJkaKLu8yn2EcRT_tYRJ3bWC0/0.jpg";

  globalThis.fetch = (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    fetchUrls.push(url);

    // The rewritten thumb object: production returns HTTP 400 + not_found JSON.
    if (url.endsWith("/0_thumb.jpg")) {
      return Promise.resolve(
        new Response(OBJECT_NOT_FOUND_BODY, {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      );
    }

    // The original object: baseline JPEG, decodes fine.
    return Promise.resolve(
      new Response(jpegBody.slice(0), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );
  };

  try {
    await withEnv({
      USE_PLACE_PHOTO_THUMBS: undefined,
      THUMB_404_FALLBACK_TO_TRANSFORM: undefined, // default ON
      DISABLE_PHOTO_URL_TRANSFORM: undefined,
    }, async () => {
      const result = await composeCollage([original]);

      // 1. placed from the ORIGINAL object.
      assertEquals(result.placedCount, 1);
      assertEquals(result.failedCount, 0);
      // 2. the thumb was attempted first, then the original verbatim.
      assertEquals(fetchUrls.some((url) => url.endsWith("/0_thumb.jpg")), true);
      assertEquals(fetchUrls.some((url) => url === original), true);
      // 3. NEVER the metered render endpoint.
      assertEquals(fetchUrls.filter((url) => url.includes(RENDER_ENDPOINT_NEEDLE)).length, 0);
    });
  } finally {
    globalThis.fetch = priorFetch;
  }
});

Deno.test("T-01b all thumbs missing AND originals undecodable → throws with fetchFailed/decodeFailed counts (SC-9)", async () => {
  const priorFetch = globalThis.fetch;
  const fetchUrls: string[] = [];
  const a = "https://x.supabase.co/storage/v1/object/public/place-photos/place-a/0.jpg";
  const b = "https://x.supabase.co/storage/v1/object/public/place-photos/place-a/1.jpg";

  globalThis.fetch = (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    fetchUrls.push(url);

    // Both thumbs missing (400).
    if (url.endsWith("_thumb.jpg")) {
      return Promise.resolve(
        new Response(OBJECT_NOT_FOUND_BODY, {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    // Original of A: 200 but undecodable garbage → decodeFailed.
    if (url === a) {
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3, 4, 5]).buffer, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      );
    }
    // Original of B: 500 → fetchFailed.
    return Promise.resolve(new Response("boom", { status: 500 }));
  };

  try {
    await withEnv({
      USE_PLACE_PHOTO_THUMBS: undefined,
      THUMB_404_FALLBACK_TO_TRANSFORM: undefined,
      DISABLE_PHOTO_URL_TRANSFORM: undefined,
    }, async () => {
      let threw: Error | null = null;
      try {
        await composeCollage([a, b]);
      } catch (err) {
        threw = err instanceof Error ? err : new Error(String(err));
      }
      assertEquals(threw !== null, true);
      const msg = threw!.message;
      // distinct counts: A decoded-but-garbage = decodeFailed, B 500 = fetchFailed
      assertEquals(msg.includes("fetchFailed=1"), true);
      assertEquals(msg.includes("decodeFailed=1"), true);
      assertEquals(fetchUrls.filter((url) => url.includes(RENDER_ENDPOINT_NEEDLE)).length, 0);
    });
  } finally {
    globalThis.fetch = priorFetch;
  }
});
