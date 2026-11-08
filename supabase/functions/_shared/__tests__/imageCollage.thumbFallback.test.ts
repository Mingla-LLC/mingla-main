// ORCH-0957 T-05 — adversarial regression for missing thumbs.
//
// [TEST-MOD-APPROVED ORCH-1033] The original ORCH-0957 contract routed the
// missing-thumb fallback to the metered Supabase render endpoint and assumed a
// 404. ORCH-1033 F-fix proved a missing Storage object returns HTTP **400**
// (not 404) and changes the fallback target to the ORIGINAL full-size object
// (non-metered, decodable). Assertions updated to the new contract:
// - THUMB_404_FALLBACK_TO_TRANSFORM=true falls back to the ORIGINAL object on a
//   missing thumb (no render-endpoint call).
// - THUMB_404_FALLBACK_TO_TRANSFORM=false leaves the cell blank and keeps composing.

import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { composeCollage, MAX_ORIGINAL_FALLBACKS } from "../imageCollage.ts";

const RENDER_ENDPOINT_NEEDLE = "/storage/v1/" + "render/image/";

async function makeJpegBody(): Promise<ArrayBuffer> {
  const img = new Image(12, 12);
  img.fill(0xff_33_77_bb);
  const bytes = await img.encodeJPEG(80);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function withEnv(
  values: Record<string, string | undefined>,
  fn: () => Promise<void>,
) {
  const prior = new Map<string, string | undefined>();
  for (const name of Object.keys(values)) {
    prior.set(name, Deno.env.get(name));
  }

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

Deno.test("T-05 thumb-missing fallback=true falls back to the ORIGINAL object (no render endpoint)", async () => {
  const priorFetch = globalThis.fetch;
  const jpegBody = await makeJpegBody();
  const fetchUrls: string[] = [];
  const originalMissing = "https://x.supabase.co/storage/v1/object/public/place-photos/place-a/0.jpg";
  const originalPresent = "https://x.supabase.co/storage/v1/object/public/place-photos/place-a/1.jpg";

  globalThis.fetch = (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    fetchUrls.push(url);

    if (url.endsWith("/0_thumb.jpg")) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }

    return Promise.resolve(new Response(jpegBody.slice(0), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    }));
  };

  try {
    await withEnv({
      USE_PLACE_PHOTO_THUMBS: undefined,
      THUMB_404_FALLBACK_TO_TRANSFORM: "true",
      DISABLE_PHOTO_URL_TRANSFORM: undefined,
    }, async () => {
      const result = await composeCollage([originalMissing, originalPresent]);

      assertEquals(result.placedCount, 2);
      assertEquals(result.failedCount, 0);
      // ORCH-1033: fallback target is the ORIGINAL object, NEVER the metered render endpoint.
      assertEquals(fetchUrls.filter((url) => url.includes(RENDER_ENDPOINT_NEEDLE)).length, 0);
      assertEquals(fetchUrls.some((url) => url.endsWith("/0_thumb.jpg")), true);
      // The original-object fallback fetches the un-rewritten object URL verbatim.
      assertEquals(fetchUrls.some((url) => url === originalMissing), true);
      assertEquals(fetchUrls.some((url) => url.endsWith("/1_thumb.jpg")), true);
    });
  } finally {
    globalThis.fetch = priorFetch;
  }
});

Deno.test("T-05 thumb-missing fallback=false leaves a blank cell without render fallback", async () => {
  const priorFetch = globalThis.fetch;
  const jpegBody = await makeJpegBody();
  const fetchUrls: string[] = [];
  const originalMissing = "https://x.supabase.co/storage/v1/object/public/place-photos/place-a/0.jpg";
  const originalPresent = "https://x.supabase.co/storage/v1/object/public/place-photos/place-a/1.jpg";

  globalThis.fetch = (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    fetchUrls.push(url);

    if (url.endsWith("/0_thumb.jpg")) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }

    return Promise.resolve(new Response(jpegBody.slice(0), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    }));
  };

  try {
    await withEnv({
      USE_PLACE_PHOTO_THUMBS: undefined,
      THUMB_404_FALLBACK_TO_TRANSFORM: "false",
      DISABLE_PHOTO_URL_TRANSFORM: undefined,
    }, async () => {
      const result = await composeCollage([originalMissing, originalPresent]);

      assertEquals(result.placedCount, 1);
      assertEquals(result.failedCount, 1);
      assertEquals(fetchUrls.filter((url) => url.includes(RENDER_ENDPOINT_NEEDLE)).length, 0);
      assertEquals(fetchUrls.some((url) => url.endsWith("/0_thumb.jpg")), true);
      assertEquals(fetchUrls.some((url) => url.endsWith("/1_thumb.jpg")), true);
    });
  } finally {
    globalThis.fetch = priorFetch;
  }
});

// ─── ORCH-1033 T-04 (TESTER adversarial — different angle than the implementor) ──
//
// The implementor's T-01/T-01b (imageCollage.fallback400.test.ts) prove the
// SINGLE-photo 400→original happy path and the all-undecodable throw counts.
// T-04 attacks three angles the implementor's happy-path does NOT exercise:
//
//   1. FULL MIXED FAILURE MATRIX in ONE collage: photo A's thumb returns the
//      real production 400+not_found-JSON, photo B's thumb returns a transient
//      **5xx** (502) — a status the implementor's tests never feed. BOTH
//      originals return 200 baseline JPEG. Assert BOTH placed via the original
//      fallback (placedCount===2), proving the `!res.ok` broadening covers the
//      whole non-OK range, not just {400,404}.
//   2. DISTINCT fetch-vs-decode breakdown on a 2-photo all-undecodable place
//      where A=decodeFailed (200 garbage) and B=fetchFailed (original 5xx) —
//      confirms SC-9 counts are per-photo, not collapsed.
//   3. USE_PLACE_PHOTO_THUMBS=false STILL routes to the gated metered render
//      endpoint (ORCH-0957 legacy lever intact). NEITHER existing test asserts
//      this env lever — they only toggle THUMB_404_FALLBACK_TO_TRANSFORM. This
//      proves the F-fix did not sever the documented ORCH-0957 escape hatch.

Deno.test("T-04 mixed failure matrix: thumb 400 (A) + thumb 5xx (B), both originals 200 → BOTH placed via original fallback", async () => {
  const priorFetch = globalThis.fetch;
  const jpegBody = await makeJpegBody();
  const fetchUrls: string[] = [];
  const a = "https://x.supabase.co/storage/v1/object/public/place-photos/place-mix/0.jpg";
  const b = "https://x.supabase.co/storage/v1/object/public/place-photos/place-mix/1.jpg";

  globalThis.fetch = (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    fetchUrls.push(url);

    // Photo A thumb: the REAL production failure — HTTP 400 + not_found JSON.
    if (url.endsWith("/0_thumb.jpg")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ statusCode: "404", error: "not_found", message: "Object not found" }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      );
    }
    // Photo B thumb: a transient 5xx (502) — the broadened `!res.ok` must cover this too.
    if (url.endsWith("/1_thumb.jpg")) {
      return Promise.resolve(new Response("bad gateway", { status: 502 }));
    }
    // Either ORIGINAL object: 200 baseline JPEG.
    return Promise.resolve(new Response(jpegBody.slice(0), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    }));
  };

  try {
    await withEnv({
      USE_PLACE_PHOTO_THUMBS: undefined,
      THUMB_404_FALLBACK_TO_TRANSFORM: undefined, // default ON
      DISABLE_PHOTO_URL_TRANSFORM: undefined,
    }, async () => {
      const result = await composeCollage([a, b]);

      // BOTH photos placed from their ORIGINAL objects despite different thumb errors.
      assertEquals(result.placedCount, 2);
      assertEquals(result.failedCount, 0);
      // The 5xx thumb (B) triggered the fallback — proves coverage beyond 400/404.
      assertEquals(fetchUrls.some((url) => url.endsWith("/1_thumb.jpg")), true);
      assertEquals(fetchUrls.some((url) => url === b), true);
      // The 400 thumb (A) also fell back.
      assertEquals(fetchUrls.some((url) => url.endsWith("/0_thumb.jpg")), true);
      assertEquals(fetchUrls.some((url) => url === a), true);
      // NEVER the metered render endpoint.
      assertEquals(fetchUrls.filter((url) => url.includes(RENDER_ENDPOINT_NEEDLE)).length, 0);
    });
  } finally {
    globalThis.fetch = priorFetch;
  }
});

Deno.test("T-04b all-undecodable place: A decode-fail (200 garbage) + B fetch-fail (original 5xx) → throw reports fetchFailed=1, decodeFailed=1", async () => {
  const priorFetch = globalThis.fetch;
  const fetchUrls: string[] = [];
  const a = "https://x.supabase.co/storage/v1/object/public/place-photos/place-dead/0.jpg";
  const b = "https://x.supabase.co/storage/v1/object/public/place-photos/place-dead/1.jpg";

  globalThis.fetch = (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    fetchUrls.push(url);
    // Both thumbs missing (400) → both fall back to their originals.
    if (url.endsWith("_thumb.jpg")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ statusCode: "404", error: "not_found", message: "Object not found" }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      );
    }
    // Original A: 200 but undecodable garbage → decodeFailed.
    if (url === a) {
      return Promise.resolve(new Response(new Uint8Array([9, 9, 9, 9]).buffer, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }));
    }
    // Original B: 503 → fetchFailed.
    return Promise.resolve(new Response("unavailable", { status: 503 }));
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
      // Per-photo breakdown, NOT collapsed: A=decodeFailed, B=fetchFailed.
      assertEquals(msg.includes("fetchFailed=1"), true);
      assertEquals(msg.includes("decodeFailed=1"), true);
      assertEquals(msg.includes("0 of 2 photos placed"), true);
      assertEquals(fetchUrls.filter((url) => url.includes(RENDER_ENDPOINT_NEEDLE)).length, 0);
    });
  } finally {
    globalThis.fetch = priorFetch;
  }
});

Deno.test("T-04c USE_PLACE_PHOTO_THUMBS=false STILL routes to the gated metered render endpoint (ORCH-0957 lever intact)", async () => {
  const priorFetch = globalThis.fetch;
  const jpegBody = await makeJpegBody();
  const fetchUrls: string[] = [];
  const original = "https://x.supabase.co/storage/v1/object/public/place-photos/place-legacy/0.jpg";

  globalThis.fetch = (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    fetchUrls.push(url);
    // Whatever URL is requested, return a decodable JPEG so composeCollage succeeds.
    return Promise.resolve(new Response(jpegBody.slice(0), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    }));
  };

  try {
    await withEnv({
      // The legacy escape: thumbs OFF → the URL transform routes to the metered
      // render-image endpoint (RENDER_ENDPOINT_NEEDLE), NOT the _thumb.jpg object.
      USE_PLACE_PHOTO_THUMBS: "false",
      THUMB_404_FALLBACK_TO_TRANSFORM: undefined,
      DISABLE_PHOTO_URL_TRANSFORM: undefined,
    }, async () => {
      const result = await composeCollage([original]);
      assertEquals(result.placedCount, 1);
      // With thumbs OFF, the request goes to the metered render endpoint — the
      // documented ORCH-0957 rollback lever the F-fix must NOT have severed.
      assertEquals(fetchUrls.some((url) => url.includes(RENDER_ENDPOINT_NEEDLE)), true);
      // And it must NOT have rewritten to a _thumb.jpg object.
      assertEquals(fetchUrls.some((url) => url.endsWith("_thumb.jpg")), false);
    });
  } finally {
    globalThis.fetch = priorFetch;
  }
});

// ─── #4276: the original-object fallback is capped per collage ────────────────
//
// Abuja (2026-11-08): 840 held places reached Intelligence with no thumbnails, so
// every collage fell back to up to 16 full-size originals and the worker hit
// "CPU Time exceeded" on every place. A collage now decodes at most
// MAX_ORIGINAL_FALLBACKS originals; every further missing thumbnail leaves its cell
// blank and counts as a fetch failure, with no original fetched.

Deno.test("#4276 16 photos with every thumb missing fetch at most MAX_ORIGINAL_FALLBACKS originals", async () => {
  assertEquals(MAX_ORIGINAL_FALLBACKS, 2);
  const priorFetch = globalThis.fetch;
  const jpegBody = await makeJpegBody();
  const fetchUrls: string[] = [];
  const originals = Array.from(
    { length: 16 },
    (_, i) => `https://x.supabase.co/storage/v1/object/public/place-photos/place-abuja/${i}.jpg`,
  );

  globalThis.fetch = (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    fetchUrls.push(url);
    if (url.endsWith("_thumb.jpg")) {
      return Promise.resolve(new Response(
        JSON.stringify({ statusCode: "404", error: "not_found", message: "Object not found" }),
        { status: 400, headers: { "content-type": "application/json" } },
      ));
    }
    return Promise.resolve(new Response(jpegBody.slice(0), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    }));
  };

  try {
    await withEnv({
      USE_PLACE_PHOTO_THUMBS: undefined,
      THUMB_404_FALLBACK_TO_TRANSFORM: undefined, // default ON
      DISABLE_PHOTO_URL_TRANSFORM: undefined,
    }, async () => {
      const result = await composeCollage(originals);
      const originalFetches = fetchUrls.filter((url) => !url.endsWith("_thumb.jpg"));
      assert(originalFetches.length <= MAX_ORIGINAL_FALLBACKS, `fetched ${originalFetches.length} originals`);
      assertEquals(originalFetches, originals.slice(0, MAX_ORIGINAL_FALLBACKS));
      assertEquals(fetchUrls.filter((url) => url.endsWith("_thumb.jpg")).length, 16, "every thumb is still tried");
      assertEquals(result.placedCount, MAX_ORIGINAL_FALLBACKS);
      assertEquals(result.failedCount, 16 - MAX_ORIGINAL_FALLBACKS);
      assertEquals(fetchUrls.filter((url) => url.includes(RENDER_ENDPOINT_NEEDLE)).length, 0);
    });
  } finally {
    globalThis.fetch = priorFetch;
  }
});

Deno.test("#4276 the fallback cap is per collage, and thumbs that exist are unaffected by it", async () => {
  const priorFetch = globalThis.fetch;
  const jpegBody = await makeJpegBody();
  const fetchUrls: string[] = [];
  const photos = Array.from(
    { length: 6 },
    (_, i) => `https://x.supabase.co/storage/v1/object/public/place-photos/place-b/${i}.jpg`,
  );

  // Thumbs 0..2 are missing; 3..5 exist.
  globalThis.fetch = (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    fetchUrls.push(url);
    if (/\/[012]_thumb\.jpg$/.test(url)) return Promise.resolve(new Response("{}", { status: 400 }));
    return Promise.resolve(new Response(jpegBody.slice(0), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    }));
  };

  try {
    await withEnv({
      USE_PLACE_PHOTO_THUMBS: undefined,
      THUMB_404_FALLBACK_TO_TRANSFORM: undefined,
      DISABLE_PHOTO_URL_TRANSFORM: undefined,
    }, async () => {
      for (let round = 0; round < 2; round++) {
        fetchUrls.length = 0;
        const result = await composeCollage(photos);
        // Two originals (photos 0 and 1), photo 2 blank, photos 3..5 from their thumbs.
        assertEquals(fetchUrls.filter((url) => !url.endsWith("_thumb.jpg")), photos.slice(0, 2));
        assertEquals(result.placedCount, 5, `round ${round}: a new collage gets a fresh budget`);
        assertEquals(result.failedCount, 1);
      }
    });
  } finally {
    globalThis.fetch = priorFetch;
  }
});
