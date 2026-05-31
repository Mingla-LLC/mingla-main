// ORCH-1023 rework regression harness — backfill-place-photos PROCESS PATH.
//
// QA (CONDITIONAL PASS) required a repo-running test for the `backfill-place-photos`
// process path proving (a) structured `failed_places` are returned/persisted, and
// (b) retryable provider pressure updates `place_pool.stored_photo_urls` to `null`
// instead of the terminal sentinel `['__backfill_failed__']`. The shared
// photoStorageService tests stop at the diagnostic result; they never exercise the
// branch in processBatch that routes retryable→null vs non-retryable→sentinel and
// writes the structured failed-place object. These tests attack exactly that branch.
//
// Google Places calls are mocked via globalThis.fetch (no live API). The handler's
// serve() bootstrap is guarded by import.meta.main, so importing processBatch here
// does not bind the HTTP server.

import { assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { processBatch } from "./index.ts";

interface RecordedUpdate {
  payload: Record<string, unknown>;
  eqColumn: string;
  eqValue: string;
}

interface PlaceRow {
  id: string;
  google_place_id: string | null;
  photos: unknown;
  stored_photo_urls: string[] | null;
}

// Mock Supabase client covering the two surfaces processBatch touches:
//   1. place_pool eligibility re-check  -> select(...).eq(...).eq(...).eq(...).maybeSingle()
//   2. failure write-back               -> update({...}).eq('id', placeId)
// plus the storage surface the shared service would use on a success (unused here).
function createDbMock(place: PlaceRow) {
  const updates: RecordedUpdate[] = [];

  const selectChain = {
    eq() {
      return selectChain;
    },
    maybeSingle() {
      return Promise.resolve({ data: place, error: null });
    },
  };

  return {
    updates,
    client: {
      storage: {
        from(bucket: string) {
          assertEquals(bucket, "place-photos");
          return {
            upload() {
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
          select() {
            return selectChain;
          },
          update(payload: Record<string, unknown>) {
            return {
              eq(eqColumn: string, eqValue: string) {
                updates.push({ payload, eqColumn, eqValue });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.test("processBatch: retryable provider pressure writes stored_photo_urls=null (not the sentinel) and returns a structured failed place", async () => {
  const priorFetch = globalThis.fetch;
  // 5xx is retryable + non-refreshable -> no Place Details refresh, no rate-limit sleep.
  globalThis.fetch = () =>
    Promise.resolve(jsonResponse({
      error: { status: "UNAVAILABLE", message: "Backend temporarily unavailable" },
    }, 503));

  try {
    const place: PlaceRow = {
      id: "pp-retryable",
      google_place_id: "ChIJtest",
      photos: [{ name: "places/ChIJtest/photos/old" }],
      stored_photo_urls: null,
    };
    const db = createDbMock(place);

    const result = await processBatch(
      db.client as any,
      { place_pool_ids: ["pp-retryable"] },
      "api-key",
      "pre_photo_passed",
    );

    assertEquals(result.succeeded, 0);
    assertEquals(result.failed, 1);
    assertEquals(result.skipped, 0);

    // Structured failed place returned (the batch no longer collapses to a generic string).
    assertEquals(result.failedPlaces.length, 1);
    const fp = result.failedPlaces[0];
    assertEquals(fp.placePoolId, "pp-retryable");
    assertEquals(fp.googlePlaceId, "ChIJtest");
    assertEquals(fp.retryable, true);
    assertEquals(fp.refreshed, false);
    assertExists(fp.code);
    assertEquals(Array.isArray(fp.failures), true);

    // Exactly one write-back, scoped by id, setting stored_photo_urls to null.
    assertEquals(db.updates.length, 1);
    assertEquals(db.updates[0].eqColumn, "id");
    assertEquals(db.updates[0].eqValue, "pp-retryable");
    assertEquals(db.updates[0].payload, { stored_photo_urls: null });

    // The terminal sentinel must NEVER be written on retryable pressure.
    const wroteSentinel = db.updates.some((u) => {
      const v = u.payload.stored_photo_urls;
      return Array.isArray(v) && v.length === 1 && v[0] === "__backfill_failed__";
    });
    assertEquals(wroteSentinel, false);
  } finally {
    globalThis.fetch = priorFetch;
  }
});

Deno.test("processBatch: non-retryable exhaustion writes the terminal sentinel and returns a structured failed place", async () => {
  const priorFetch = globalThis.fetch;
  // Cached media name expired (400, refreshable) -> one Place Details refresh ->
  // 403 PERMISSION_DENIED (non-retryable) -> terminal failure.
  globalThis.fetch = (input: URL | RequestInfo) => {
    const url = String(input);
    if (url.includes("/media")) {
      return Promise.resolve(jsonResponse({
        error: { status: "INVALID_ARGUMENT", message: "Photo name has expired" },
      }, 400));
    }
    // Place Details refresh call.
    return Promise.resolve(jsonResponse({
      error: { status: "PERMISSION_DENIED", message: "API key denied" },
    }, 403));
  };

  try {
    const place: PlaceRow = {
      id: "pp-terminal",
      google_place_id: "ChIJtest",
      photos: [{ name: "places/ChIJtest/photos/old" }],
      stored_photo_urls: null,
    };
    const db = createDbMock(place);

    const result = await processBatch(
      db.client as any,
      { place_pool_ids: ["pp-terminal"] },
      "api-key",
      "pre_photo_passed",
    );

    assertEquals(result.succeeded, 0);
    assertEquals(result.failed, 1);

    assertEquals(result.failedPlaces.length, 1);
    const fp = result.failedPlaces[0];
    assertEquals(fp.placePoolId, "pp-terminal");
    assertEquals(fp.retryable, false);
    assertEquals(fp.refreshed, true);
    assertExists(fp.code);

    // Exactly one write-back, scoped by id, setting the terminal sentinel.
    assertEquals(db.updates.length, 1);
    assertEquals(db.updates[0].eqColumn, "id");
    assertEquals(db.updates[0].eqValue, "pp-terminal");
    assertEquals(db.updates[0].payload, { stored_photo_urls: ["__backfill_failed__"] });

    // On non-retryable exhaustion we must NOT clear to null (that would re-queue a
    // place that genuinely cannot be backfilled).
    const clearedToNull = db.updates.some((u) => u.payload.stored_photo_urls === null);
    assertEquals(clearedToNull, false);
  } finally {
    globalThis.fetch = priorFetch;
  }
});
