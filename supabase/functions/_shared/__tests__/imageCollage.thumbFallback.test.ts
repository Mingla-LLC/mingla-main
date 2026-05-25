// ORCH-0957 T-05 — tester-authored adversarial regression for missing thumbs.
//
// Locks the 404 fallback contract from SPEC_ORCH-0957:
// - THUMB_404_FALLBACK_TO_TRANSFORM=true retries exactly once through legacy render.
// - THUMB_404_FALLBACK_TO_TRANSFORM=false leaves the cell blank and keeps composing.

import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { composeCollage } from "../imageCollage.ts";

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

Deno.test("T-05 thumb-missing fallback=true retries exactly once through legacy transform", async () => {
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
      assertEquals(fetchUrls.filter((url) => url.includes(RENDER_ENDPOINT_NEEDLE)).length, 1);
      assertEquals(fetchUrls.some((url) => url.endsWith("/0_thumb.jpg")), true);
      assertEquals(fetchUrls.some((url) => url.includes("/0.jpg?width=384&height=384&resize=cover")), true);
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
