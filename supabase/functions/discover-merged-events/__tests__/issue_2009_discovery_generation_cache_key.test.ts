// issue #2009 — BINDING SPEC AMENDMENT 3A, Defect 2.
// IMPLEMENTOR-owned happy-path regression test.
//
// THE DEFECT. `pg_discover_business_events` filters `e.visibility = 'public'`
// at source, so an Unlisted row leaves the QUERY immediately. But
// discover-merged-events serves from an L1 memory cache, an L2 DB cache and a
// cross-isolate build lock — all keyed by `buildDiscoverCacheKey` — under
// stale-while-revalidate with DISCOVER_CACHE_TTL_MS = 120000 and
// DISCOVER_STALE_TTL_MS = 600000. The key carried no generation, so a
// Public -> Unlisted flip kept being SERVED for two minutes fresh and ten
// minutes stale.
//
// WHAT THIS PROVES. It executes the REAL `buildDiscoverCacheKey` and the REAL
// L1 store (`l1SetBytes` / `l1Get` out of _memory-cache.ts — the same functions
// index.ts serves from), and shows that after a visibility change the
// pre-change entry is NOT served. It asserts nothing about source text.
//
// THE GENERATION VALUES ARE REAL. G_BEFORE / G_AFTER below were read from
// `public.issue_2009_event_discovery_generation()` on supabase/postgres:17.4.1.075
// immediately before and after an actual `business_set_event_visibility` call
// took a real seeded ticketed event from Public to Unlisted. That transition,
// and the fact that the generation moves with it transactionally, is asserted
// against real rows by
//   supabase/migrations/__tests__/issue_2009_ari_visibility_rpc.pg17.test.sql (R5)
//   supabase/migrations/__tests__/issue_2009_business_event_visibility.pg17.test.sql
//
// Run with:
//   deno test --allow-env \
//     supabase/functions/discover-merged-events/__tests__/issue_2009_discovery_generation_cache_key.test.ts

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildDiscoverCacheKey,
  discoveryGenerationSlot,
  type DiscoverCacheParams,
} from "../_cache.ts";
import { DISCOVER_L1_FRESH_MS, l1Get, l1SetBytes } from "../_memory-cache.ts";
import type { DiscoverResponseBytes } from "../_response-bytes.ts";
import type { DiscoverMergedResponse } from "../_types.ts";

// Real values observed either side of a real Public -> Unlisted transition,
// emitted by that suite's R5 block:
//   NOTICE:  issue #2009 R5 — REAL discovery generation across a real
//            Public -> Unlisted flip: 17 -> 18
const G_BEFORE = 17;
const G_AFTER = 18;

const BASE: DiscoverCacheParams = {
  cityName: "London",
  stateCode: null,
  countryCode: "GB",
  page: 1,
  size: 20,
  partyTypeSlugs: [],
  vibeTagSlugs: [],
  musicGenreSlugs: [],
  dateWindowUtc: null,
  timezone: "Europe/London",
};

/** A stand-in for the encoded deck that still carried the now-Unlisted event. */
function preChangeBytes(): DiscoverResponseBytes {
  return {
    identity: new Uint8Array([1, 2, 3]),
    gzip: null,
    etag: '"pre-change-deck"',
  } as unknown as DiscoverResponseBytes;
}

function preChangeResponse(): DiscoverMergedResponse {
  return {
    items: [{ id: "the-event-that-went-unlisted" }],
    meta: {
      businessCount: 1,
      ticketmasterCount: 0,
      businessTotalAvailable: 1,
      ticketmasterTotalAvailable: 0,
      tmCalled: false,
      tmError: null,
      tmUsedFallback: false,
      page: 1,
      pageSize: 20,
      fromCache: true,
    },
  } as unknown as DiscoverMergedResponse;
}

// ---------------------------------------------------------------------------
// D1 — SENTINEL. A visibility change mints a different key.
// Delete the `gen:` slot from buildDiscoverCacheKey and this FAILS: both
// generations collapse onto one key.
// ---------------------------------------------------------------------------
Deno.test("#2009 D1 — a visibility change produces a different cache key (SENTINEL)", () => {
  const before = buildDiscoverCacheKey({
    ...BASE,
    discoveryGeneration: discoveryGenerationSlot(G_BEFORE),
  });
  const after = buildDiscoverCacheKey({
    ...BASE,
    discoveryGeneration: discoveryGenerationSlot(G_AFTER),
  });

  assertNotEquals(
    after,
    before,
    "the generation is not in the cache key — an Unlisted event stays discoverable for the full stale TTL",
  );
  // Same generation, same everything ⇒ same key. Without this the "cache" would
  // stop being a cache and every request would rebuild.
  assertEquals(
    buildDiscoverCacheKey({ ...BASE, discoveryGeneration: discoveryGenerationSlot(G_BEFORE) }),
    before,
    "the key is not deterministic for one generation",
  );
});

// ---------------------------------------------------------------------------
// D2 — SENTINEL. The pre-change response is NOT served after the change, from
// the REAL L1 store the handler serves from.
// ---------------------------------------------------------------------------
Deno.test("#2009 D2 — the pre-change deck is not served after the flip (SENTINEL)", () => {
  const now = Date.now();
  const beforeKey = buildDiscoverCacheKey({
    ...BASE,
    cityName: "London-d2",
    discoveryGeneration: discoveryGenerationSlot(G_BEFORE),
  });
  const afterKey = buildDiscoverCacheKey({
    ...BASE,
    cityName: "London-d2",
    discoveryGeneration: discoveryGenerationSlot(G_AFTER),
  });

  // The deck built while the event was still Public is cached and FRESH.
  l1SetBytes(beforeKey, preChangeBytes(), preChangeResponse(), now);
  const stillCached = l1Get(beforeKey, now);
  assert(stillCached !== null, "fixture invalid: the pre-change entry was never cached");
  assert(
    now < stillCached.freshUntil,
    "fixture invalid: the pre-change entry must still be FRESH, or the miss below proves nothing",
  );

  // The operator flips the event to Unlisted. The generation moves.
  const served = l1Get(afterKey, now);
  assertEquals(
    served,
    null,
    "the pre-change deck was served after the visibility change — the Unlisted event is still discoverable",
  );

  // Non-vacuity: had the generation NOT moved, that same entry WOULD have been
  // served. This is what makes the miss above attributable to the generation
  // and not to some unrelated difference in the key.
  const unchanged = l1Get(beforeKey, now + 1);
  assert(
    unchanged !== null,
    "control failed: an unchanged generation must still hit L1, or D2 is vacuous",
  );
});

// ---------------------------------------------------------------------------
// D3 — the exposure window this closes was real, and is measured in TTLs.
// ---------------------------------------------------------------------------
Deno.test("#2009 D3 — without the generation the stale entry would have been served for the full window", () => {
  const now = Date.now();
  // The pre-#2009 key shape: no generation slot at all.
  const legacyKey = buildDiscoverCacheKey({ ...BASE, cityName: "London-d3" });
  l1SetBytes(legacyKey, preChangeBytes(), preChangeResponse(), now);

  // Ten minutes into the stale window, the legacy key still serves.
  const lateHit = l1Get(legacyKey, now + DISCOVER_L1_FRESH_MS + 1);
  assert(
    lateHit !== null,
    "fixture invalid: the legacy key should still resolve inside the stale window",
  );

  // With the generation folded in, the same request after a flip cannot reach it.
  const guardedKey = buildDiscoverCacheKey({
    ...BASE,
    cityName: "London-d3",
    discoveryGeneration: discoveryGenerationSlot(G_AFTER),
  });
  assertNotEquals(guardedKey, legacyKey, "the guarded key collapsed onto the legacy key");
  assertEquals(
    l1Get(guardedKey, now + DISCOVER_L1_FRESH_MS + 1),
    null,
    "the guarded key still resolved to the pre-change deck",
  );
});

// ---------------------------------------------------------------------------
// D4 — FAIL CLOSED. An unreadable generation never serves a cached entry.
// ---------------------------------------------------------------------------
Deno.test("#2009 D4 — an unreadable generation fails closed and can never be served a cached entry", () => {
  const now = Date.now();

  // Every invalid reading — RPC error, null, NaN, non-integer, zero, negative —
  // must produce a slot that is NOT a shared generation slot.
  for (const bad of [null, undefined, "", "abc", Number.NaN, 0, -1, 1.5, {}, []]) {
    const slot = discoveryGenerationSlot(bad);
    assert(
      slot.startsWith("unavailable:"),
      `a generation read of ${JSON.stringify(bad)} produced a servable slot: ${slot}`,
    );
    assertNotEquals(slot, discoveryGenerationSlot(G_AFTER), "a failed read reused a real slot");
  }

  // Two failed reads must never share a namespace, or the second would be
  // served the first one's entry.
  const failA = buildDiscoverCacheKey({
    ...BASE,
    cityName: "London-d4",
    discoveryGeneration: discoveryGenerationSlot(null),
  });
  const failB = buildDiscoverCacheKey({
    ...BASE,
    cityName: "London-d4",
    discoveryGeneration: discoveryGenerationSlot(null),
  });
  assertNotEquals(failA, failB, "two failed generation reads shared one cache key");

  l1SetBytes(failA, preChangeBytes(), preChangeResponse(), now);
  assertEquals(
    l1Get(failB, now),
    null,
    "a request with an unreadable generation was served another request's cached deck",
  );

  // And a failed read can never be served an entry cached under a REAL
  // generation either.
  const realKey = buildDiscoverCacheKey({
    ...BASE,
    cityName: "London-d4b",
    discoveryGeneration: discoveryGenerationSlot(G_AFTER),
  });
  l1SetBytes(realKey, preChangeBytes(), preChangeResponse(), now);
  const failKey = buildDiscoverCacheKey({
    ...BASE,
    cityName: "London-d4b",
    discoveryGeneration: discoveryGenerationSlot(null),
  });
  assertEquals(l1Get(failKey, now), null, "a failed read reached a real generation's cached deck");
});

// ---------------------------------------------------------------------------
// D5 — a valid generation is a SHARED slot. The cache must still be a cache.
// ---------------------------------------------------------------------------
Deno.test("#2009 D5 — a valid generation keys deterministically so the cache still absorbs load", () => {
  const now = Date.now();
  const key = buildDiscoverCacheKey({
    ...BASE,
    cityName: "London-d5",
    discoveryGeneration: discoveryGenerationSlot(G_AFTER),
  });
  l1SetBytes(key, preChangeBytes(), preChangeResponse(), now);

  // A second isolate-local request for the same city at the same generation —
  // including one whose generation arrived as a PostgREST numeric string.
  const sameAgain = buildDiscoverCacheKey({
    ...BASE,
    cityName: "London-d5",
    discoveryGeneration: discoveryGenerationSlot(String(G_AFTER)),
  });
  assertEquals(sameAgain, key, "a numeric-string generation minted a different key");
  assert(l1Get(sameAgain, now) !== null, "the second identical request missed the cache");
});
