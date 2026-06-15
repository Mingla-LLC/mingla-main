/**
 * ORCH-426 G1 — coalesced discover cache resolve (L1 miss / SWR refresh path).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildDiscoverMergedResponse, type BuildDiscoverContext } from "./_build-response.ts";
import { discoverStaleExpiresAt } from "./_cache.ts";
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

export async function resolveDiscoverEntry(
  supabase: SupabaseClient,
  cacheKey: string,
  buildCtx: BuildDiscoverContext,
): Promise<L1Entry> {
  const now = Date.now();

  const dbBytes = await readDbDiscoverCacheGzip(supabase, cacheKey);
  if (dbBytes) {
    return entryFromDbGzip(cacheKey, dbBytes, now);
  }

  let holdsLock = await tryDistributedBuildLock(supabase, cacheKey);

  if (!holdsLock) {
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

    holdsLock = await tryDistributedBuildLock(supabase, cacheKey);
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
    await writeDbDiscoverCache(supabase, cacheKey, built, discoverStaleExpiresAt, bytes);
    return l1SetBytes(cacheKey, bytes, cached, now);
  } finally {
    if (holdsLock) {
      await releaseDistributedBuildLock(supabase, cacheKey);
    }
  }
}
