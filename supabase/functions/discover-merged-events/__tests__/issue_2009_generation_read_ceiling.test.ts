// issue #2009 — BINDING SPEC AMENDMENT 3B, Defect 3.
// IMPLEMENTOR-owned happy-path regression test.
//
// THE DEFECT. Amendment 3A closed a real privacy hole by folding the discovery
// generation into the cache key, but it read that generation from the database
// on EVERY request, above the L1 memory-cache lookup. Discovery is the consumer
// application's hottest path and ORCH-426 exists specifically to keep it off the
// database, so every request — including ones L1 would have served with zero
// database contact — acquired an unconditional round-trip.
//
// THE FIX. `resolveDiscoveryGenerationSlot` memoizes a successfully-read
// generation for at most DISCOVER_GENERATION_TTL_MS (a 5-second literal
// constant, not an environment variable). Worst-case staleness after a
// visibility change becomes ~5s instead of the ~10min 3A closed, and L1 returns
// to serving without database contact under load.
//
// WHAT THIS PROVES, AND HOW. Every assertion below EXECUTES the shipped units
// the edge handler calls — `resolveDiscoveryGenerationSlot` out of _cache.ts,
// the real `buildDiscoverCacheKey`, and the real `l1Get` / `l1SetBytes` out of
// _memory-cache.ts — through `discoverRequest()`, which replays
// discover-merged-events/index.ts's post-validation sequence in order. Nothing
// here asserts on source text (#2113). The database reader is a counting
// double: counting round-trips is the entire point of the defect.
//
// TEST ISOLATION. The generation memo is module-global, exactly as the L1 map
// is, because that is what an isolate-local cache means. Each test therefore
// works on its own `now` base, spaced far beyond the ceiling, so no test can
// inherit another's memo. Bases only ever increase.
//
// Run with:
//   deno test --allow-env \
//     supabase/functions/discover-merged-events/__tests__/issue_2009_generation_read_ceiling.test.ts

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildDiscoverCacheKey,
  DISCOVER_GENERATION_TTL_MS,
  type DiscoverCacheParams,
  type DiscoveryGenerationRead,
  resolveDiscoveryGenerationSlot,
} from "../_cache.ts";
import { l1Get, l1SetBytes } from "../_memory-cache.ts";
import type { DiscoverResponseBytes } from "../_response-bytes.ts";
import type { DiscoverMergedResponse } from "../_types.ts";

// Real values observed either side of a real Public -> Unlisted transition on
// supabase/postgres:17.4.1.075, emitted by
// supabase/migrations/__tests__/issue_2009_ari_visibility_rpc.pg17.test.sql R5.
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

function deckBytes(tag: string): DiscoverResponseBytes {
  return {
    identity: new TextEncoder().encode(tag),
    gzip: null,
    etag: `"${tag}"`,
  } as unknown as DiscoverResponseBytes;
}

function deckResponse(eventId: string): DiscoverMergedResponse {
  return {
    items: [{ id: eventId }],
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

/**
 * The database, as discover-merged-events sees it: one service-only singleton
 * row, plus a counter for how many times the handler actually went and read it.
 */
interface GenerationDb {
  generation: unknown;
  error: { message?: string } | null;
  throws: boolean;
  reads: number;
}

function generationDb(generation: unknown): GenerationDb {
  return { generation, error: null, throws: false, reads: 0 };
}

/** The exact thunk index.ts hands to `resolveDiscoveryGenerationSlot`. */
function reader(db: GenerationDb): () => Promise<DiscoveryGenerationRead> {
  return () => {
    db.reads += 1;
    if (db.throws) return Promise.reject(new Error("connection reset"));
    return Promise.resolve({ data: db.generation, error: db.error });
  };
}

/**
 * discover-merged-events/index.ts's post-validation sequence, replayed against
 * the SHIPPED units in the SHIPPED order: resolve the generation slot, build the
 * key from it, consult L1, and on a miss build and store. `servedFromL1` and the
 * db read counter are the two things the defect is about.
 */
async function discoverRequest(
  db: GenerationDb,
  city: string,
  now: number,
): Promise<{ key: string; servedFromL1: boolean }> {
  const discoveryGeneration = await resolveDiscoveryGenerationSlot(reader(db), now);
  const key = buildDiscoverCacheKey({ ...BASE, cityName: city, discoveryGeneration });
  const hit = l1Get(key, now);
  if (hit) return { key, servedFromL1: true };
  l1SetBytes(key, deckBytes(city), deckResponse(`deck-for-${city}`), now);
  return { key, servedFromL1: false };
}

// ---------------------------------------------------------------------------
// C1 — SENTINEL. Repeated requests inside the ceiling window read the database
// exactly ONCE.
//
// Delete the memo short-circuit at the top of resolveDiscoveryGenerationSlot
// and this FAILS immediately: the read count becomes one per request, which is
// precisely the regression Amendment 3B names.
// ---------------------------------------------------------------------------
Deno.test("#2009 C1 — the generation is read at most once per ceiling window (SENTINEL)", async () => {
  const t0 = 10_000_000;
  const db = generationDb(G_BEFORE);

  // Twenty-five requests spread across the window, none of them at the same
  // instant, all inside the ceiling.
  const offsets = [0, 1, 7, 49, 250, 900, 1_500, 2_000, 2_500, 3_000, 3_400, 3_999];
  const slots: string[] = [];
  for (const offset of offsets) {
    await discoverRequest(db, "London-c1", t0 + offset);
    slots.push(
      await resolveDiscoveryGenerationSlot(reader(db), t0 + offset),
    );
  }

  assertEquals(
    db.reads,
    1,
    `the generation was read ${db.reads} times inside one ${DISCOVER_GENERATION_TTL_MS}ms window — the bound is not in place and every discover request pays a database round-trip`,
  );
  // Non-vacuity: the bound must not have been achieved by returning junk.
  for (const slot of slots) {
    assertEquals(slot, `g${G_BEFORE}`, "the memoized slot is not the real generation");
  }
});

// ---------------------------------------------------------------------------
// C2 — SENTINEL. An L1 hit inside the window touches the database ZERO times.
//
// This is the defect stated exactly: "requests L1 would previously have served
// with zero database contact" must serve with zero database contact again.
// ---------------------------------------------------------------------------
Deno.test("#2009 C2 — an L1 hit inside the ceiling costs zero database round-trips (SENTINEL)", async () => {
  const t0 = 20_000_000;
  const db = generationDb(G_BEFORE);

  // The cold request builds the deck and warms L1. One read.
  const cold = await discoverRequest(db, "London-c2", t0);
  assertEquals(cold.servedFromL1, false, "fixture invalid: the first request must be a cache miss");
  assertEquals(db.reads, 1, "the cold request did not read the generation at all");

  const readsAfterCold = db.reads;

  // Every subsequent request inside the window is an L1 hit.
  for (const offset of [1, 100, 1_000, 2_500, 4_999]) {
    const warm = await discoverRequest(db, "London-c2", t0 + offset);
    assertEquals(
      warm.servedFromL1,
      true,
      `the request at +${offset}ms missed L1 — the generation slot is not stable inside the ceiling`,
    );
    assertEquals(warm.key, cold.key, "the key moved without a visibility change");
  }

  assertEquals(
    db.reads - readsAfterCold,
    0,
    `L1-served requests made ${db.reads - readsAfterCold} database round-trips — ORCH-426's hot path is back on the database (Defect 3)`,
  );
});

// ---------------------------------------------------------------------------
// C3 — a visibility change IS reflected within the ceiling. The bound buys
// throughput; it must not reopen the hole Amendment 3A closed.
// ---------------------------------------------------------------------------
Deno.test("#2009 C3 — a visibility change is reflected within the ceiling and the pre-change deck is not served", async () => {
  const t0 = 30_000_000;
  const db = generationDb(G_BEFORE);

  // A deck built and cached while the event was still Public.
  const before = await discoverRequest(db, "London-c3", t0);
  assertEquals(before.servedFromL1, false, "fixture invalid: the first request must build");

  // The organiser flips the event to Unlisted. The generation moves in the same
  // transaction as the row write (proven against real rows by the SQL suites).
  db.generation = G_AFTER;

  // One tick past the ceiling, the very next request re-reads and re-keys.
  const after = await discoverRequest(db, "London-c3", t0 + DISCOVER_GENERATION_TTL_MS);
  assertNotEquals(
    after.key,
    before.key,
    "the key did not move after the visibility change — the memo outlived the ceiling",
  );
  assertEquals(
    after.servedFromL1,
    false,
    "the pre-change deck was served after the flip — the Unlisted event is still discoverable",
  );
  assertEquals(db.reads, 2, `expected exactly one re-read after the ceiling, saw ${db.reads} reads total`);

  // The pre-change entry is still FRESH in L1, so the miss above is attributable
  // to the generation and not to expiry. Without this control C3 is vacuous.
  const stillCached = l1Get(before.key, t0 + DISCOVER_GENERATION_TTL_MS);
  assert(
    stillCached !== null && t0 + DISCOVER_GENERATION_TTL_MS < stillCached.freshUntil,
    "control failed: the pre-change entry must still be fresh, or C3 proves nothing",
  );
});

// ---------------------------------------------------------------------------
// C4 — the ceiling is a HARD 5 SECONDS, and it is a constant.
//
// Boundary proven behaviourally on both sides, plus the value itself, because
// Amendment 3B forbids the ceiling being tunable into a large staleness window.
// ---------------------------------------------------------------------------
Deno.test("#2009 C4 — the ceiling is exactly 5s, enforced on both sides of the boundary", async () => {
  assertEquals(
    DISCOVER_GENERATION_TTL_MS,
    5000,
    "the generation ceiling is no longer 5 seconds — worst-case staleness after a visibility change changed with it",
  );

  const t0 = 40_000_000;
  const db = generationDb(G_BEFORE);

  await resolveDiscoveryGenerationSlot(reader(db), t0);
  assertEquals(db.reads, 1, "the first resolve did not read");

  // One millisecond inside the ceiling: still memoized.
  await resolveDiscoveryGenerationSlot(reader(db), t0 + 4_999);
  assertEquals(db.reads, 1, "the generation was re-read 1ms BEFORE the ceiling elapsed");

  // Exactly at the ceiling: re-read.
  await resolveDiscoveryGenerationSlot(reader(db), t0 + 5_000);
  assertEquals(db.reads, 2, "the generation was NOT re-read once the ceiling elapsed — staleness is unbounded");

  // A clock that jumps backwards must not extend the window either.
  await resolveDiscoveryGenerationSlot(reader(db), t0 + 5_000 - 1);
  assertEquals(db.reads, 3, "a backwards clock reused a memo it should have discarded");
});

// ---------------------------------------------------------------------------
// C5 — FAIL CLOSED, unchanged from Amendment 3A. An unreadable generation is
// never memoized, never shared, and never coasts on the previous value.
// ---------------------------------------------------------------------------
Deno.test("#2009 C5 — an unreadable generation is never memoized and never served a cached entry", async () => {
  const t0 = 50_000_000;
  const db = generationDb(G_BEFORE);

  // Warm a real generation and cache a deck under it.
  const good = await discoverRequest(db, "London-c5", t0);
  assertEquals(db.reads, 1, "fixture invalid: the warm-up did not read");

  // The ceiling elapses and the read now fails.
  db.error = { message: "connection pool exhausted" };
  const failA = await discoverRequest(db, "London-c5", t0 + DISCOVER_GENERATION_TTL_MS);
  assertEquals(
    failA.servedFromL1,
    false,
    "a request whose generation could not be read was served a cached deck",
  );
  assertNotEquals(failA.key, good.key, "a failed read reached the last known generation's namespace");

  // A failed read must NOT be memoized: the next request re-reads rather than
  // coasting on an unconfirmable value, and lands in its own namespace.
  const failB = await discoverRequest(db, "London-c5", t0 + DISCOVER_GENERATION_TTL_MS + 1);
  assertEquals(db.reads, 3, `expected a fresh read after each failure, saw ${db.reads} reads total`);
  assertNotEquals(failB.key, failA.key, "two failed generation reads shared one cache key");
  assertEquals(failB.servedFromL1, false, "a failed read was served another failed read's deck");

  // A reader that THROWS is treated identically to one that returns an error.
  db.error = null;
  db.throws = true;
  const failC = await discoverRequest(db, "London-c5", t0 + DISCOVER_GENERATION_TTL_MS + 2);
  assertEquals(db.reads, 4, "a throwing reader did not even attempt the read");
  assertEquals(failC.servedFromL1, false, "a throwing generation read was served a cached deck");
  assertNotEquals(failC.key, failA.key, "a throwing read shared a namespace with an errored read");

  // Recovery: once the read succeeds again the shared slot returns, so the
  // cache goes back to being a cache rather than degrading permanently.
  db.throws = false;
  db.generation = G_AFTER;
  const recovered = await resolveDiscoveryGenerationSlot(
    reader(db),
    t0 + DISCOVER_GENERATION_TTL_MS + 3,
  );
  assertEquals(recovered, `g${G_AFTER}`, "the resolver did not recover once the generation was readable again");
});
