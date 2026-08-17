/**
 * ORCH-426 G1 — coalesced discover cache resolve (L1 miss / SWR refresh path).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildDiscoverMergedResponse, type BuildDiscoverContext } from "./_build-response.ts";
import { discoverBuildCoalesceKey, discoverStaleExpiresAt } from "./_cache.ts";
import {
  readDbDiscoverCacheGzip,
  releaseDistributedBuildLock,
  SHORT_POLL_ATTEMPTS,
  tryDistributedBuildLock,
  waitForDbDiscoverCacheGzip,
  writeDbDiscoverCache,
} from "./_distributed-cache.ts";
import { l1SetBytes, type L1Entry } from "./_memory-cache.ts";
import { encodeDiscoverResponse, withCacheMeta } from "./_response-bytes.ts";
import type { DiscoverMergedResponse } from "./_types.ts";

export class DiscoverOverloadedError extends Error {
  constructor() {
    super("discover_overloaded");
    this.name = "DiscoverOverloadedError";
  }
}

function cachedResponseStub(): DiscoverMergedResponse {
  return {
    items: [],
    meta: {
      businessCount: 0,
      ticketmasterCount: 0,
      businessTotalAvailable: 0,
      ticketmasterTotalAvailable: 0,
      tmCalled: false,
      tmError: null,
      tmUsedFallback: false,
      page: 1,
      pageSize: 20,
      fromCache: true,
    },
  };
}

function entryFromDbGzip(
  cacheKey: string,
  bytes: Awaited<ReturnType<typeof readDbDiscoverCacheGzip>>,
  now: number,
): L1Entry {
  return l1SetBytes(cacheKey, bytes!, cachedResponseStub(), now);
}

/**
 * issue #2009 (BINDING SPEC AMENDMENT 3C, Defect 5) — TWO IDENTITIES, WHICH
 * USED TO BE ONE STRING.
 *
 * `cacheKey` is the SERVE identity: the namespace L1 and the L2 database cache
 * are keyed on. `buildKey` is the COALESCING identity: the cross-isolate build
 * lock. For every readable generation `discoverBuildCoalesceKey` is the IDENTITY
 * function, so the two strings are equal and everything below is byte-for-byte
 * what ORCH-426 shipped.
 *
 * They diverge in exactly one state — the discovery generation could not be
 * read — because the fail-closed slot carries a per-call uuid to make the
 * response uncacheable. THAT DIVERGENCE IS THE FAIL-CLOSED SIGNAL, derived here
 * from the one shared normaliser rather than re-tested against a second copy of
 * the rule, so "is this key uncacheable?" keeps exactly one definition in the
 * codebase.
 *
 * AMENDMENT 3B collapsed the ISOLATE-LOCAL single-flight map onto the
 * coalescing identity. This file still used the raw per-call key for the
 * DISTRIBUTED lock and the L2 write, so N isolates still ran N independent
 * database builds and each wrote a cache row nothing could ever read — junk
 * accumulating under precisely the conditions where the database is least able
 * to absorb it. The generation becomes unreadable when the edge function runs
 * ahead of the migration and, far more importantly, whenever the database is
 * stressed enough to fail a single-row primary-key read. An N-fold build
 * amplification on the consumer app's hottest path at that exact moment is how
 * a slow period becomes an outage. A fail-closed path must DEGRADE, NOT AMPLIFY.
 */
function coalescingIdentity(cacheKey: string): {
  buildKey: string;
  uncacheable: boolean;
} {
  const buildKey = discoverBuildCoalesceKey(cacheKey);
  return { buildKey, uncacheable: buildKey !== cacheKey };
}

export async function resolveDiscoverEntry(
  supabase: SupabaseClient,
  cacheKey: string,
  buildCtx: BuildDiscoverContext,
): Promise<L1Entry> {
  const now = Date.now();
  const { buildKey, uncacheable } = coalescingIdentity(cacheKey);

  const dbBytes = await readDbDiscoverCacheGzip(supabase, cacheKey);
  if (dbBytes) {
    return entryFromDbGzip(cacheKey, dbBytes, now);
  }

  let holdsLock = await tryDistributedBuildLock(supabase, buildKey);

  if (!holdsLock) {
    // issue #2009 (Amendment 3C) — FAIL-CLOSED LOSER. Another isolate holds the
    // one build for this collapsed namespace, and it will NOT publish an L2 row
    // (see the write below): a row keyed on a generation nobody could confirm is
    // unreadable by construction and unservable by policy. So every wait below
    // this line would poll — 200 attempts at 100ms, then 50 more — for a row
    // that cannot exist, and would spend 250 further database round-trips per
    // request doing it, against a database that has just failed a single-row
    // primary-key read. Degrade immediately instead: 503 + Retry-After, which
    // index.ts already emits for `DiscoverOverloadedError`. One build happens;
    // the herd behind it stops touching the database rather than multiplying
    // against it, and the next request re-reads the generation, so recovery is
    // one retry away.
    if (uncacheable) {
      throw new DiscoverOverloadedError();
    }

    const waitedBytes = await waitForDbDiscoverCacheGzip(supabase, cacheKey);
    if (waitedBytes) {
      return entryFromDbGzip(cacheKey, waitedBytes, now);
    }

    const staleBytes = await readDbDiscoverCacheGzip(supabase, cacheKey, {
      includeStale: true,
    });
    if (staleBytes) {
      return entryFromDbGzip(cacheKey, staleBytes, now);
    }

    holdsLock = await tryDistributedBuildLock(supabase, buildKey);
    if (!holdsLock) {
      const shortWait = await waitForDbDiscoverCacheGzip(
        supabase,
        cacheKey,
        SHORT_POLL_ATTEMPTS,
      );
      if (shortWait) {
        return entryFromDbGzip(cacheKey, shortWait, now);
      }
      throw new DiscoverOverloadedError();
    }
  }

  try {
    const built = await buildDiscoverMergedResponse(buildCtx);
    const cached = withCacheMeta(built);
    const bytes = await encodeDiscoverResponse(cached);
    // issue #2009 (Amendment 3C) — DO NOT WRITE A ROW THAT CAN NEVER BE READ.
    // The fail-closed cache key carries a per-call uuid, so the only reader that
    // could ever match it is the request that just minted it — and that request
    // is holding the built bytes in hand. Writing it upserts a permanent
    // garbage row (plus a full-table expiry sweep) on every fail-closed build.
    // The response is still SERVED, and still cached in this isolate's L1 under
    // the same unique key, so nothing about availability changes.
    if (!uncacheable) {
      await writeDbDiscoverCache(supabase, cacheKey, built, discoverStaleExpiresAt, bytes);
    }
    return l1SetBytes(cacheKey, bytes, cached, now);
  } finally {
    if (holdsLock) {
      await releaseDistributedBuildLock(supabase, buildKey);
    }
  }
}
