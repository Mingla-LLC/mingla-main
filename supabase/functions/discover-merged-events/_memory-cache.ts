/**
 * ORCH-426 G1 — L1 in-memory cache + single-flight + stale-while-revalidate.
 */

import { discoverBuildCoalesceKey } from "./_cache.ts";
import type { DiscoverResponseBytes } from "./_response-bytes.ts";
import type { DiscoverMergedResponse } from "./_types.ts";

export const DISCOVER_L1_FRESH_MS = Number(
  Deno.env.get("DISCOVER_MERGED_CACHE_TTL_MS") ?? "120000",
);
export const DISCOVER_L1_STALE_MS = Number(
  Deno.env.get("DISCOVER_MERGED_STALE_MS") ?? "600000",
);

export interface L1Entry {
  response: DiscoverMergedResponse;
  bytes: DiscoverResponseBytes;
  freshUntil: number;
  staleUntil: number;
}

const l1 = new Map<string, L1Entry>();
const inflight = new Map<string, Promise<L1Entry>>();

export function l1Get(key: string, now = Date.now()): L1Entry | null {
  const hit = l1.get(key);
  if (!hit || now >= hit.staleUntil) {
    if (hit) l1.delete(key);
    return null;
  }
  return hit;
}

export function l1SetBytes(
  key: string,
  bytes: DiscoverResponseBytes,
  response: DiscoverMergedResponse,
  now = Date.now(),
): L1Entry {
  const entry: L1Entry = {
    response,
    bytes,
    freshUntil: now + DISCOVER_L1_FRESH_MS,
    staleUntil: now + DISCOVER_L1_STALE_MS,
  };
  l1.set(key, entry);
  return entry;
}

/**
 * issue #2009 (pass-1 TEST REPORT P1-2) — the single-flight map is keyed on the
 * COALESCING namespace, not on the raw cache key.
 *
 * For every readable generation the two are the same string, so this is the
 * ORCH-426 behaviour unchanged. They diverge only in the fail-closed state,
 * where the cache key deliberately carries a per-call uuid to make the response
 * uncacheable: without this the herd that arrives while the generation is
 * unreadable turns one build per KEY into one build per REQUEST, which is
 * precisely the overload protection ORCH-426 exists to provide, lost at the
 * moment it is needed most. Collapsing here restores the coalescing WITHOUT
 * making anything servable — `l1SetBytes` below still stores under the raw
 * unique key, which no later request can mint.
 */
export async function coalesceDiscoverBuild(
  key: string,
  build: () => Promise<L1Entry>,
): Promise<L1Entry> {
  const flightKey = discoverBuildCoalesceKey(key);
  const existing = inflight.get(flightKey);
  if (existing) return existing;

  const promise = build().finally(() => {
    inflight.delete(flightKey);
  });

  inflight.set(flightKey, promise);
  return promise;
}

export function refreshDiscoverInBackground(
  key: string,
  build: () => Promise<L1Entry>,
): void {
  if (inflight.has(discoverBuildCoalesceKey(key))) return;
  void coalesceDiscoverBuild(key, build).catch((err) => {
    console.warn("[discover-merged-events] background refresh failed:", err);
  });
}
