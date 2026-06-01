import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  downloadAndStorePhotos,
  downloadAndStorePhotosWithDiagnostics,
  fetchFreshPlacePhotos,
  formatPhotoBackfillFailedPlace,
  photoBackfillFailureSummary,
  type PhotoBackfillDiagnosticResult,
} from "./photoStorageService.ts";

function createSupabaseMock() {
  const uploads: Array<{ path: string; body: unknown; options: Record<string, unknown> }> = [];
  const updates: Array<Record<string, unknown>> = [];
  const updateFilters: Array<{ column: string; value: string }> = [];

  return {
    uploads,
    updates,
    updateFilters,
    client: {
      storage: {
        from(bucket: string) {
          assertEquals(bucket, "place-photos");
          return {
            upload(path: string, body: unknown, options: Record<string, unknown>) {
              uploads.push({ path, body, options });
              return Promise.resolve({ error: null });
            },
            getPublicUrl(path: string) {
              return {
                data: {
                  publicUrl: `https://x.supabase.co/storage/v1/object/public/place-photos/${path}`,
                },
              };
            },
          };
        },
      },
      from(table: string) {
        assertEquals(table, "place_pool");
        return {
          update(payload: Record<string, unknown>) {
            updates.push(payload);
            return {
              eq(column: string, value: string) {
                assertEquals(column, "google_place_id");
                updateFilters.push({ column, value });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    },
  };
}

async function makeJpegBytes(): Promise<Uint8Array> {
  const img = new Image(8, 8);
  img.fill(0xff_44_88_cc);
  return await img.encodeJPEG(80);
}

function bodyFrom(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.test("downloadAndStorePhotos writes ONLY the original (no thumb, no thumbs_backfilled_at)", async () => {
  const priorFetch = globalThis.fetch;
  const jpeg = await makeJpegBytes();
  globalThis.fetch = () => Promise.resolve(new Response(bodyFrom(jpeg), {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  }));

  try {
    const mock = createSupabaseMock();
    const urls = await downloadAndStorePhotos(
      mock.client as any,
      "place:abc",
      [{ name: "places/abc/photos/1" }],
      "api-key",
    );

    assertEquals(urls, ["https://x.supabase.co/storage/v1/object/public/place-photos/place_abc/0.jpg"]);
    // ORCH-1024: originals-only — exactly one upload (the original), no _thumb.jpg.
    assertEquals(mock.uploads.map((u) => u.path), ["place_abc/0.jpg"]);
    assertEquals(mock.uploads.length, 1);
    assertEquals(mock.uploads[0].options.upsert, true);
    // ORCH-1024: decoupling — update writes ONLY stored_photo_urls, never thumbs_backfilled_at.
    assertEquals(mock.updates[0].stored_photo_urls, urls);
    assertEquals("thumbs_backfilled_at" in mock.updates[0], false);
  } finally {
    globalThis.fetch = priorFetch;
  }
});

Deno.test("downloadAndStorePhotosWithDiagnostics refreshes expired cached names through Place Details and stores fresh media", async () => {
  const priorFetch = globalThis.fetch;
  const calls: Array<{ url: string; headers?: HeadersInit }> = [];
  const jpeg = await makeJpegBytes();
  globalThis.fetch = (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: init?.headers });
    if (url.includes("/photos/old/media")) {
      return Promise.resolve(jsonResponse({
        error: { status: "INVALID_ARGUMENT", message: "Photo name has expired" },
      }, 400));
    }
    if (url === "https://places.googleapis.com/v1/places/ChIJfresh") {
      const headers = new Headers(init?.headers);
      assertEquals(headers.get("X-Goog-Api-Key"), "api-key");
      assertEquals(headers.get("X-Goog-FieldMask"), "id,photos");
      return Promise.resolve(jsonResponse({
        id: "ChIJfresh",
        photos: [{ name: "places/ChIJfresh/photos/fresh", widthPx: 800, heightPx: 600 }],
      }));
    }
    if (url.includes("/photos/fresh/media")) {
      return Promise.resolve(new Response(bodyFrom(jpeg), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }));
    }
    return Promise.resolve(jsonResponse({ error: "unexpected URL" }, 500));
  };

  try {
    const mock = createSupabaseMock();
    const result = await downloadAndStorePhotosWithDiagnostics(
      mock.client as any,
      "ChIJfresh",
      [{ name: "places/ChIJfresh/photos/old" }],
      "api-key",
      { delayBetweenPhotosMs: 0, rateLimitDelayMs: 0 },
    );

    assertEquals(result.storedUrls, ["https://x.supabase.co/storage/v1/object/public/place-photos/ChIJfresh/0.jpg"]);
    assertEquals(result.refreshed, true);
    assertEquals(result.freshPhotoCount, 1);
    assertEquals(calls.map((c) => c.url), [
      "https://places.googleapis.com/v1/places/ChIJfresh/photos/old/media?maxWidthPx=800&key=api-key",
      "https://places.googleapis.com/v1/places/ChIJfresh",
      "https://places.googleapis.com/v1/places/ChIJfresh/photos/fresh/media?maxWidthPx=800&key=api-key",
    ]);
    // ORCH-1024: originals-only — refreshed media uploads the original only, no _thumb.jpg.
    assertEquals(mock.uploads.map((u) => u.path), ["ChIJfresh/0.jpg"]);
    assertEquals(mock.updates[0].photos, [{ name: "places/ChIJfresh/photos/fresh", widthPx: 800, heightPx: 600 }]);
    assertEquals(mock.updates[1].stored_photo_urls, result.storedUrls);
    // ORCH-1024: decoupling — even on the refresh path, no thumbs_backfilled_at is written.
    assertEquals("thumbs_backfilled_at" in mock.updates[1], false);
    assertEquals(result.failures[0].code, "PHOTO_MEDIA_NAME_INVALID");
  } finally {
    globalThis.fetch = priorFetch;
  }
});

Deno.test("downloadAndStorePhotosWithDiagnostics does not refresh on retryable provider pressure", async () => {
  const priorFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (input: URL | RequestInfo) => {
    const url = String(input);
    calls.push(url);
    return Promise.resolve(jsonResponse({
      error: { status: "RESOURCE_EXHAUSTED", message: "Rate limited" },
    }, 429));
  };

  try {
    const mock = createSupabaseMock();
    const result = await downloadAndStorePhotosWithDiagnostics(
      mock.client as any,
      "place:abc",
      [{ name: "places/abc/photos/1" }],
      "api-key",
      { delayBetweenPhotosMs: 0, rateLimitDelayMs: 0 },
    );

    assertEquals(result.storedUrls, []);
    assertEquals(result.refreshed, false);
    assertEquals(result.failures.length, 1);
    assertEquals(result.failures[0].code, "PHOTO_MEDIA_RATE_LIMIT");
    assertEquals(result.failures[0].retryable, true);
    assertEquals(mock.updates.length, 0);
    assertEquals(calls, ["https://places.googleapis.com/v1/places/abc/photos/1/media?maxWidthPx=800&key=api-key"]);
  } finally {
    globalThis.fetch = priorFetch;
  }
});

Deno.test("downloadAndStorePhotosWithDiagnostics returns structured details refresh failure", async () => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (input: URL | RequestInfo) => {
    const url = String(input);
    if (url.includes("/media")) {
      return Promise.resolve(jsonResponse({
        error: { status: "INVALID_ARGUMENT", message: "Photo name has expired" },
      }, 400));
    }
    return Promise.resolve(jsonResponse({
      error: { status: "PERMISSION_DENIED", message: "API key denied" },
    }, 403));
  };

  try {
    const mock = createSupabaseMock();
    const result = await downloadAndStorePhotosWithDiagnostics(
      mock.client as any,
      "places/ChIJfresh",
      [{ name: "places/ChIJfresh/photos/old" }],
      "api-key",
      { delayBetweenPhotosMs: 0, rateLimitDelayMs: 0 },
    );

    assertEquals(result.storedUrls, []);
    assertEquals(result.refreshed, true);
    assertEquals(result.freshPhotoCount, 0);
    const detailsFailure = result.failures.find((failure) => failure.stage === "details_refresh");
    assertExists(detailsFailure);
    assertEquals(detailsFailure.status, 403);
    assertEquals(detailsFailure.code, "PHOTO_DETAILS_REFRESH_FAILED");
    assertEquals(detailsFailure.retryable, false);
    assertEquals(mock.uploads.length, 0);
  } finally {
    globalThis.fetch = priorFetch;
  }
});

Deno.test("fetchFreshPlacePhotos normalizes places/ IDs for Place Details URL", async () => {
  const calls: string[] = [];
  const fetchImpl = (input: URL | RequestInfo) => {
    calls.push(String(input));
    return Promise.resolve(jsonResponse({
      id: "ChIJfresh",
      photos: [{ name: "places/ChIJfresh/photos/fresh" }],
    }));
  };

  const result = await fetchFreshPlacePhotos("places/ChIJfresh", "api-key", fetchImpl as typeof fetch);

  assertEquals(result.failure, undefined);
  assertEquals(result.photos, [{ name: "places/ChIJfresh/photos/fresh" }]);
  assertEquals(calls, ["https://places.googleapis.com/v1/places/ChIJfresh"]);
});

Deno.test("photoBackfillFailureSummary treats post-refresh provider pressure as retryable", () => {
  const result: PhotoBackfillDiagnosticResult = {
    storedUrls: [],
    refreshed: true,
    freshPhotoCount: 1,
    failures: [
      {
        stage: "media_cached",
        status: 400,
        code: "PHOTO_MEDIA_NAME_INVALID",
        message: "Cached name expired",
        retryable: false,
        refreshable: true,
      },
      {
        stage: "media_refreshed",
        status: 429,
        code: "PHOTO_MEDIA_RATE_LIMIT",
        message: "Google Places media request was rate limited",
        retryable: true,
      },
    ],
  };
  const summary = photoBackfillFailureSummary(result);

  assertEquals(summary, {
    error: "Google Places media request was rate limited",
    code: "PHOTO_MEDIA_RATE_LIMIT",
    retryable: true,
  });
  assertEquals(formatPhotoBackfillFailedPlace("pp-1", "ChIJfresh", result), {
    placePoolId: "pp-1",
    googlePlaceId: "ChIJfresh",
    error: "Google Places media request was rate limited",
    code: "PHOTO_MEDIA_RATE_LIMIT",
    retryable: true,
    refreshed: true,
    failures: result.failures,
  });
});

Deno.test("downloadAndStorePhotos stores the original even for non-decodable bytes (no thumbnail decode path)", async () => {
  // ORCH-1024: thumbnail generation (imagescript decode/resize/encode) was removed from this
  // function entirely. Previously, non-decodable bytes broke the thumb decode and left
  // thumbs_backfilled_at unset. Now there is no decode path at all: arbitrary bytes still
  // upload the original successfully and never write thumbs_backfilled_at.
  const priorFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]), {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  }));

  try {
    const mock = createSupabaseMock();
    const urls = await downloadAndStorePhotos(
      mock.client as any,
      "place:abc",
      [{ name: "places/abc/photos/1" }],
      "api-key",
    );

    assertEquals(urls, ["https://x.supabase.co/storage/v1/object/public/place-photos/place_abc/0.jpg"]);
    assertEquals(mock.uploads.map((u) => u.path), ["place_abc/0.jpg"]);
    assertEquals(mock.uploads.length, 1);
    assertEquals(mock.updates[0].stored_photo_urls, urls);
    assertEquals("thumbs_backfilled_at" in mock.updates[0], false);
  } finally {
    globalThis.fetch = priorFetch;
  }
});
