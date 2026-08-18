// issue #2009 — IMPLEMENTOR REWORK COVERAGE for pass-1 TEST REPORT P1-2.
//
// Contract: AMENDMENT 3B (#issuecomment-5317545075) over 3A Defect 2
//           (#issuecomment-5317431821). SC-14 / SC-15, and ORCH-426's
//           overload protection.
//
// THE DEFECT. `discoveryGenerationSlot()` returns a per-call unique
// `unavailable:<uuid>` when the generation cannot be read. That string is the
// L1 key, the L2 database-cache key, the `coalesceDiscoverBuild` single-flight
// key AND the cross-isolate build-lock namespace, all at once. A unique key per
// request therefore did not cost a cache miss — it cost every layer of overload
// protection simultaneously, on the consumer app's hottest path, at the exact
// moment the system is already degraded. Measured before the fix: 12 concurrent
// requests -> 12 independent builds.
//
// THE FIX, AND WHAT THIS FILE PROVES. The two jobs are separated. The CACHE key
// stays per-call unique, so the response stays uncacheable. The COALESCING key
// (`discoverBuildCoalesceKey`) erases the uuid, so concurrent fail-closed
// requests collapse onto one build.
//
// ANGLE, relative to the tester's `issue_2009_generation_failclosed_herd`
// sibling. That file asks ONE question — does a herd collapse — through the
// full request replay. This file asks the questions that decide whether the
// collapse is the RIGHT fix rather than a passing number:
//   C1  the readable path is byte-for-byte untouched (the normaliser is the
//       IDENTITY for every real generation slot, so ORCH-426's shipped
//       behaviour cannot have moved).
//   C2  the herd collapses to ONE build while the CACHE keys stay distinct —
//       i.e. coalescing was restored without making anything servable.
//   C3  nothing is served out of the collapsed namespace: a later fail-closed
//       request, arriving after the herd settled, builds fresh rather than
//       reading the herd's entry. Uncacheable still means uncacheable.
//   C4  the in-flight slot is RELEASED when the build settles, so the shared
//       namespace cannot pin every later request to one dead promise.
//   C5  a rejected build releases the slot too — a failure must not wedge the
//       shared fail-closed namespace for the life of the isolate.
//   C6  `refreshDiscoverInBackground` honours the same namespace, so the SWR
//       path cannot reintroduce the stampede the foreground path just lost.
//
// Per #2113 every assertion EXECUTES the shipped units (`discoveryGenerationSlot`,
// `buildDiscoverCacheKey`, `discoverBuildCoalesceKey`, `coalesceDiscoverBuild`,
// `refreshDiscoverInBackground`, `l1Get`, `l1SetBytes`). Nothing asserts on
// source text.
//
// Run with:
//   deno test --no-check --allow-env \
//     supabase/functions/discover-merged-events/__tests__/issue_2009_failclosed_coalescing.rework.test.ts

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildDiscoverCacheKey,
  type DiscoverCacheParams,
  discoverBuildCoalesceKey,
  discoveryGenerationSlot,
  UNAVAILABLE_GENERATION_COALESCE_SLOT,
} from "../_cache.ts";
import {
  coalesceDiscoverBuild,
  l1Get,
  l1SetBytes,
  refreshDiscoverInBackground,
} from "../_memory-cache.ts";
import type { DiscoverResponseBytes } from "../_response-bytes.ts";
import type { DiscoverMergedResponse } from "../_types.ts";

// A city of its own, so this file's L1 namespace cannot collide with any other
// #2009 suite running in the same Deno process.
const BASE: DiscoverCacheParams = {
  cityName: "Reworkville",
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

/** A fresh fail-closed cache key, exactly as the edge handler would mint one. */
function failClosedKey(): string {
  return buildDiscoverCacheKey({
    ...BASE,
    discoveryGeneration: discoveryGenerationSlot(null),
  });
}

/**
 * The L1-miss half of `index.ts`: try L1 under the RAW key, otherwise coalesce a
 * build. Counting BUILDS is the only way the coalescing loss is visible.
 */
async function serve(
  key: string,
  now: number,
  builds: { n: number },
  buildDelayMs = 25,
): Promise<string> {
  const hit = l1Get(key, now);
  if (hit) return new TextDecoder().decode(hit.bytes.identity);
  const entry = await coalesceDiscoverBuild(key, async () => {
    builds.n += 1;
    await new Promise((r) => setTimeout(r, buildDelayMs));
    return l1SetBytes(key, bytes(`build-${builds.n}`), response(`build-${builds.n}`), now);
  });
  return new TextDecoder().decode(entry.bytes.identity);
}

const HERD = 12;

// ---------------------------------------------------------------------------
// C1 — the readable path is the IDENTITY. If this ever stops holding, the fix
// has changed ORCH-426's shipped behaviour instead of adding to it.
// ---------------------------------------------------------------------------
Deno.test("#2009 C1 — for a readable generation the coalescing key IS the cache key", () => {
  for (const generation of [1, 2, 41, 999_999]) {
    const slot = discoveryGenerationSlot(generation);
    assertEquals(slot, `g${generation}`, "a readable generation must give a shared slot");
    const key = buildDiscoverCacheKey({ ...BASE, discoveryGeneration: slot });
    assertEquals(
      discoverBuildCoalesceKey(key),
      key,
      "the normaliser must be the identity for every real generation — ORCH-426's " +
        "single-flight namespace on the healthy path may not move at all",
    );
  }

  // ...and it must not collapse two DIFFERENT real generations onto one another,
  // which would let a pre-change deck coalesce with a post-change one.
  const g41 = buildDiscoverCacheKey({ ...BASE, discoveryGeneration: "g41" });
  const g42 = buildDiscoverCacheKey({ ...BASE, discoveryGeneration: "g42" });
  assertNotEquals(
    discoverBuildCoalesceKey(g41),
    discoverBuildCoalesceKey(g42),
    "two real generations must never share a coalescing namespace",
  );
});

// ---------------------------------------------------------------------------
// C2 — the herd collapses, and the cache keys stay distinct.
// ---------------------------------------------------------------------------
Deno.test("#2009 C2 — a fail-closed herd is ONE build while its cache keys stay unique", async () => {
  const now = 71_000_000;
  const builds = { n: 0 };
  const keys = Array.from({ length: HERD }, () => failClosedKey());

  assertEquals(
    new Set(keys).size,
    HERD,
    "the fail-closed CACHE key must stay per-call unique — that is what makes the " +
      "response uncacheable, and it may not be traded away for coalescing",
  );
  assertEquals(
    new Set(keys.map(discoverBuildCoalesceKey)).size,
    1,
    "...while every one of them must resolve to the SAME coalescing namespace",
  );
  assert(
    discoverBuildCoalesceKey(keys[0]).includes(UNAVAILABLE_GENERATION_COALESCE_SLOT),
    "the collapsed namespace is the shared unavailable slot",
  );

  await Promise.all(keys.map((k) => serve(k, now, builds)));
  assertEquals(
    builds.n,
    1,
    `ORCH-426 coalescing under fail-closed: expected 1 build for ${HERD} concurrent ` +
      `requests, got ${builds.n}`,
  );
});

// ---------------------------------------------------------------------------
// C3 — and NOTHING is servable out of that namespace afterwards.
// ---------------------------------------------------------------------------
Deno.test("#2009 C3 — a later fail-closed request is not served the herd's entry", async () => {
  const now = 72_000_000;
  const builds = { n: 0 };

  const first = failClosedKey();
  await serve(first, now, builds, 1);
  assertEquals(builds.n, 1);

  // The build settled and its entry is in L1 under `first`. A NEW request in
  // the same fail-closed state must not reach it.
  const second = failClosedKey();
  assertNotEquals(second, first, "each fail-closed request mints its own cache key");
  assertEquals(
    l1Get(second, now),
    null,
    "a fail-closed request may never read an entry keyed on a generation this " +
      "isolate could not confirm — collapsing the BUILD namespace must not have " +
      "collapsed the SERVE namespace",
  );

  await serve(second, now, builds, 1);
  assertEquals(builds.n, 2, "so it builds fresh rather than serving the earlier deck");
});

// ---------------------------------------------------------------------------
// C4 — the shared namespace is released when the build settles.
// ---------------------------------------------------------------------------
Deno.test("#2009 C4 — the collapsed in-flight slot is released, not held for the isolate's life", async () => {
  const now = 73_000_000;
  const builds = { n: 0 };

  await Promise.all(
    Array.from({ length: 4 }, () => serve(failClosedKey(), now, builds, 1)),
  );
  assertEquals(builds.n, 1, "the first herd coalesces");

  // A LATER herd, after the first settled, must be able to build again. If the
  // in-flight entry were keyed on the collapsed namespace and never deleted,
  // every request for the rest of the isolate's life would resolve to the first
  // herd's stale promise.
  await Promise.all(
    Array.from({ length: 4 }, () => serve(failClosedKey(), now, builds, 1)),
  );
  assertEquals(
    builds.n,
    2,
    "a second herd must produce its own single build — the shared slot has to be " +
      "released on settle, or fail-closed responses freeze at the first one",
  );
});

// ---------------------------------------------------------------------------
// C5 — a REJECTED build releases the slot too.
// ---------------------------------------------------------------------------
Deno.test("#2009 C5 — a failed build does not wedge the shared fail-closed namespace", async () => {
  const now = 74_000_000;
  const attempts = { n: 0 };

  const failing = failClosedKey();
  let threw = false;
  try {
    await coalesceDiscoverBuild(failing, async () => {
      attempts.n += 1;
      await Promise.resolve();
      throw new Error("build blew up");
    });
  } catch {
    threw = true;
  }
  assert(threw, "the rejection must propagate — nothing is swallowed");

  const builds = { n: 0 };
  await serve(failClosedKey(), now, builds, 1);
  assertEquals(
    builds.n,
    1,
    "the next fail-closed request must build — a rejected build may not leave the " +
      "shared namespace permanently occupied",
  );
});

// ---------------------------------------------------------------------------
// C6 — the stale-while-revalidate refresh path honours the same namespace.
// ---------------------------------------------------------------------------
Deno.test("#2009 C6 — background refresh coalesces on the collapsed namespace too", async () => {
  const now = 75_000_000;
  const builds = { n: 0 };
  let release: (() => void) | null = null;
  const gate = new Promise<void>((r) => {
    release = r;
  });

  const held = failClosedKey();
  const inFlight = coalesceDiscoverBuild(held, async () => {
    builds.n += 1;
    await gate;
    return l1SetBytes(held, bytes("swr"), response("swr"), now);
  });

  // A background refresh for a DIFFERENT fail-closed key, while that build is
  // still running, must see the namespace as busy and not start a second one.
  refreshDiscoverInBackground(failClosedKey(), async () => {
    builds.n += 1;
    return await Promise.resolve(
      l1SetBytes(failClosedKey(), bytes("swr2"), response("swr2"), now),
    );
  });

  assertEquals(
    builds.n,
    1,
    "the SWR refresh must coalesce onto the in-flight fail-closed build, or the " +
      "stampede simply moves from the foreground path to the background one",
  );

  release!();
  await inFlight;
});
