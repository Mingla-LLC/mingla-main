// issue #2009 — TESTER-OWNED ADVERSARIAL SIBLING for the discovery generation.
//
// Owner: mingla-tester (independent verification of pass 1).
// Contract: AMENDMENT 3B Defect 3 (#issuecomment-5317545075) over
//           AMENDMENT 3A Defect 2 (#issuecomment-5317431821). SC-14 / SC-15.
//
// ANGLE — DIFFERENT FROM THE IMPLEMENTOR'S SUITES ON PURPOSE.
// `issue_2009_discovery_generation_cache_key.test.ts` proves the key changes
// across a flip. `issue_2009_generation_read_ceiling.test.ts` counts GENERATION
// ROUND-TRIPS inside the ceiling. Neither asks what the fail-closed branch costs
// the layer ORCH-426 actually exists for, and neither asks whether the ceiling
// can be stretched.
//
// This file attacks:
//   A1  the fail-closed slot is PER-CALL UNIQUE, and `cacheKey` is the single
//       namespace for L1, the L2 database cache AND the cross-isolate build
//       lock / single-flight (`coalesceDiscoverBuild`, `_resolve-entry.ts`).
//       A unique key per request therefore does not merely cost a cache miss —
//       it dissolves the request coalescing that keeps a discovery herd off the
//       database. Executed, by counting BUILDS rather than generation reads.
//   A2  the control that makes A1 attributable: with the generation readable,
//       the very same harness coalesces N concurrent requests into ONE build.
//   A3  the 5s ceiling is ABSOLUTE, not sliding. If a later "optimisation"
//       refreshed `readAt` on a memo HIT, a steadily-served isolate would never
//       re-read and worst-case staleness would become unbounded.
//   A4  a failed read clears a previously-good memo and each failure mints a
//       distinct namespace, so fail-closed is neither sticky nor collidable.
//   A5  RECORDED: the memo is not monotonic — a slower concurrent read carrying
//       an OLDER generation overwrites a newer one. Bounded by the ceiling.
//
// Per #2113 every assertion drives the SHIPPED units the edge handler calls
// (`resolveDiscoveryGenerationSlot`, `buildDiscoverCacheKey`, `l1Get`,
// `l1SetBytes`, `coalesceDiscoverBuild`). Nothing here asserts on source text.
//
// Run with:
//   deno test --no-check --allow-env \
//     supabase/functions/discover-merged-events/__tests__/issue_2009_generation_failclosed_herd.tester_adversarial.test.ts

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
import { coalesceDiscoverBuild, l1Get, l1SetBytes } from "../_memory-cache.ts";
import type { DiscoverResponseBytes } from "../_response-bytes.ts";
import type { DiscoverMergedResponse } from "../_types.ts";

const BASE: DiscoverCacheParams = {
  cityName: "Lagos",
  stateCode: null,
  countryCode: "NG",
  page: 1,
  size: 20,
  partyTypeSlugs: [],
  vibeTagSlugs: [],
  musicGenreSlugs: [],
  dateWindowUtc: null,
  timezone: "Africa/Lagos",
};

function bytes(tag: string): DiscoverResponseBytes {
  return {
    identity: new TextEncoder().encode(tag),
    gzip: null,
    etag: `"${tag}"`,
  } as unknown as DiscoverResponseBytes;
}

function response(tag: string): DiscoverMergedResponse {
  return { items: [{ id: tag }] } as unknown as DiscoverMergedResponse;
}

/** A reader that always succeeds with `value`, counting its calls. */
function okReader(value: number, counter: { n: number }) {
  return async (): Promise<DiscoveryGenerationRead> => {
    counter.n += 1;
    return await Promise.resolve({ data: value, error: null });
  };
}

/** A reader that always fails, counting its calls. */
function failingReader(counter: { n: number }) {
  return async (): Promise<DiscoveryGenerationRead> => {
    counter.n += 1;
    return await Promise.resolve({
      data: null,
      error: { message: "issue_2009_event_discovery_generation is unavailable" },
    });
  };
}

/**
 * Replays discover-merged-events/index.ts's post-validation sequence: resolve
 * the generation slot, build the key, try L1, otherwise coalesce a build. The
 * build itself is a counted double — counting BUILDS is the whole point.
 */
async function discoverRequest(
  read: () => Promise<DiscoveryGenerationRead>,
  now: number,
  builds: { n: number },
  buildDelayMs = 25,
): Promise<{ key: string; served: string }> {
  const discoveryGeneration = await resolveDiscoveryGenerationSlot(read, now);
  const key = buildDiscoverCacheKey({ ...BASE, discoveryGeneration });

  const hit = l1Get(key, now);
  if (hit) return { key, served: new TextDecoder().decode(hit.bytes.identity) };

  const entry = await coalesceDiscoverBuild(key, async () => {
    builds.n += 1;
    await new Promise((r) => setTimeout(r, buildDelayMs));
    return l1SetBytes(key, bytes(`deck-${builds.n}`), response(`deck-${builds.n}`), now);
  });
  return { key, served: new TextDecoder().decode(entry.bytes.identity) };
}

const HERD = 12;

// ---------------------------------------------------------------------------
// A2 first, because it is A1's control: it must be TRUE that this harness
// coalesces, or A1's count proves nothing about the fail-closed branch.
// ---------------------------------------------------------------------------
Deno.test("#2009 A2 — CONTROL: with the generation readable, a herd of concurrent requests is ONE build", async () => {
  const now = 10_000_000;
  const reads = { n: 0 };
  const builds = { n: 0 };

  const results = await Promise.all(
    Array.from({ length: HERD }, () => discoverRequest(okReader(41, reads), now, builds)),
  );

  const keys = new Set(results.map((r) => r.key));
  assertEquals(keys.size, 1, "a readable generation must give the whole herd ONE cache key");
  assertEquals(
    builds.n,
    1,
    `ORCH-426 coalescing: expected 1 build for ${HERD} concurrent requests, got ${builds.n}`,
  );
});

// ---------------------------------------------------------------------------
// A1 — THE ATTACK (SENTINEL).
// ---------------------------------------------------------------------------
Deno.test("#2009 A1 — SENTINEL: an unreadable generation must not dissolve build coalescing", async () => {
  const now = 20_000_000;
  const reads = { n: 0 };
  const builds = { n: 0 };

  const results = await Promise.all(
    Array.from({ length: HERD }, () => discoverRequest(failingReader(reads), now, builds)),
  );

  const keys = new Set(results.map((r) => r.key));

  // Recorded either way, so the report can quote the real numbers.
  console.log(
    `#2009 A1: ${HERD} concurrent requests with an unreadable generation -> ` +
      `${keys.size} distinct cache keys, ${builds.n} independent builds, ${reads.n} generation reads`,
  );

  assert(
    builds.n < HERD,
    `fail-closed must still coalesce: ${HERD} concurrent requests produced ${builds.n} ` +
      `independent database builds because the per-call-unique 'unavailable:<uuid>' slot ` +
      `mints a distinct cacheKey per request, and cacheKey is the ONLY namespace for L1, ` +
      `the L2 cache, the single-flight map and the cross-isolate build lock. ` +
      `The DiscoverOverloadedError backstop in _resolve-entry.ts is likewise per-key, so it ` +
      `cannot fire either. A2 proves the same harness coalesces to 1 when the generation reads.`,
  );
});

// ---------------------------------------------------------------------------
// A3 — the ceiling is absolute, not sliding.
// ---------------------------------------------------------------------------
Deno.test("#2009 A3 — the 5s ceiling cannot be extended by repeated in-window hits", async () => {
  const t0 = 30_000_000;
  const reads = { n: 0 };
  const builds = { n: 0 };
  const read = okReader(51, reads);

  await discoverRequest(read, t0, builds);
  assertEquals(reads.n, 1, "the first request reads the generation");

  // Hammer the memo just inside the ceiling, repeatedly. A sliding window would
  // push the expiry out on every one of these.
  for (let t = t0 + 1000; t < t0 + DISCOVER_GENERATION_TTL_MS; t += 1000) {
    await discoverRequest(read, t, builds);
  }
  assertEquals(reads.n, 1, "no in-window hit may cause a re-read");

  // Exactly at the ceiling, measured from the FIRST read — not from the last hit.
  await discoverRequest(read, t0 + DISCOVER_GENERATION_TTL_MS, builds);
  assertEquals(
    reads.n,
    2,
    `the ceiling is absolute: after ${DISCOVER_GENERATION_TTL_MS}ms from the FIRST read the ` +
      `generation must be re-read, however many hits landed in between`,
  );
});

// ---------------------------------------------------------------------------
// A4 — fail-closed is not sticky, and not collidable.
// ---------------------------------------------------------------------------
Deno.test("#2009 A4 — a failed read clears a good memo, and each failure mints a distinct namespace", async () => {
  const t0 = 40_000_000;
  const reads = { n: 0 };
  const builds = { n: 0 };

  const good = await discoverRequest(okReader(61, reads), t0, builds);
  assertEquals(reads.n, 1);

  // Outside the ceiling, the read fails.
  const failReads = { n: 0 };
  const bad1 = await discoverRequest(
    failingReader(failReads),
    t0 + DISCOVER_GENERATION_TTL_MS,
    builds,
  );
  const bad2 = await discoverRequest(
    failingReader(failReads),
    t0 + DISCOVER_GENERATION_TTL_MS + 1,
    builds,
  );

  assertEquals(failReads.n, 2, "a failure must NOT be memoized — every request re-reads");
  assertNotEquals(bad1.key, good.key, "a failed read may never reuse the last good namespace");
  assertNotEquals(bad2.key, bad1.key, "two failed reads may never share a namespace");

  // And the moment the read recovers, the shared namespace comes back.
  const recoverReads = { n: 0 };
  const back = await discoverRequest(
    okReader(61, recoverReads),
    t0 + DISCOVER_GENERATION_TTL_MS + 2,
    builds,
  );
  assertEquals(back.key, good.key, "recovery must return to the shared generation namespace");
});

// ---------------------------------------------------------------------------
// A5 — RECORDED: the memo is not monotonic.
// ---------------------------------------------------------------------------
Deno.test("#2009 A5 — RECORDED: a slower concurrent read can move the memo BACKWARDS, bounded by the ceiling", async () => {
  const t0 = 50_000_000;
  const builds = { n: 0 };

  // Two concurrent first-reads. The one that RESOLVES LAST wins the memo, even
  // though it carries the older generation.
  const slowOld = async (): Promise<DiscoveryGenerationRead> => {
    await new Promise((r) => setTimeout(r, 40));
    return { data: 70, error: null };
  };
  const fastNew = async (): Promise<DiscoveryGenerationRead> => {
    return await Promise.resolve({ data: 71, error: null });
  };

  const [, newer] = await Promise.all([
    resolveDiscoveryGenerationSlot(slowOld, t0),
    resolveDiscoveryGenerationSlot(fastNew, t0),
  ]);
  assertEquals(newer, "g71");

  const noRead = async (): Promise<DiscoveryGenerationRead> => {
    throw new Error("must not be read inside the ceiling");
  };
  const afterwards = await resolveDiscoveryGenerationSlot(noRead, t0 + 1);
  console.log(`#2009 A5: memo after the race resolved to ${afterwards} (fast read saw g71)`);

  // The invariant that MUST hold is the bound, not monotonicity: whatever the
  // race left behind is discarded at the ceiling measured from the read start.
  const reads = { n: 0 };
  const key = await discoverRequest(okReader(72, reads), t0 + DISCOVER_GENERATION_TTL_MS, builds);
  assertEquals(reads.n, 1, "the raced memo must not survive past the ceiling");
  assert(key.key.includes("g72"), "after the ceiling the current generation is used");
});

// ---------------------------------------------------------------------------
// A6 — the ONE scenario in which `generationMemo = null` on a failed read is
// load-bearing rather than decorative: a clock that steps BACKWARDS.
//
// Every other path into the failure branch has an already-expired memo, so
// clearing it changes nothing observable. Only a backwards clock leaves a memo
// that is skipped now but would be servable again once the clock catches up.
// If that clear is removed, a generation this isolate has just FAILED to
// confirm gets served again the moment `now` re-enters the old window — which
// is precisely what "fail closed" forbids. #2113: a guard nobody executes is a
// guard nobody can trust, so execute exactly the case that reaches it.
// ---------------------------------------------------------------------------
Deno.test("#2009 A6 — a failed read after the clock steps backwards must poison the memo, not preserve it", async () => {
  const t0 = 60_000_000;
  const builds = { n: 0 };

  const firstReads = { n: 0 };
  const good = await discoverRequest(okReader(80, firstReads), t0, builds);
  assertEquals(firstReads.n, 1);
  assert(good.key.includes("g80"));

  // The clock steps backwards (an NTP correction, or a fresh isolate handed a
  // skewed Date.now()). The memo is skipped, and the read fails.
  const skewedReads = { n: 0 };
  const skewed = await discoverRequest(failingReader(skewedReads), t0 - 1_000, builds);
  assertEquals(skewedReads.n, 1, "a backwards clock must force a re-read, not serve the memo");
  assertNotEquals(skewed.key, good.key, "the failed read must not reuse the g80 namespace");

  // Clock recovers to a point still INSIDE the original ceiling window. The
  // memo must be gone: the isolate cannot currently confirm g80.
  const recoveredReads = { n: 0 };
  const after = await discoverRequest(okReader(81, recoveredReads), t0 + 1_000, builds);
  assertEquals(
    recoveredReads.n,
    1,
    "the failed read must have cleared the memo — a generation this isolate could not " +
      "confirm may never be served again just because the clock caught up",
  );
  assert(after.key.includes("g81"), "the re-read's own generation is the one used");
});
