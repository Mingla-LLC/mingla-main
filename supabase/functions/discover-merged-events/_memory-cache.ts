/**
 * ORCH-426 G1 — L1 in-memory cache + single-flight + stale-while-revalidate.
 */

import type { DiscoverMergedResponse } from "./_types.ts";

export const DISCOVER_L1_FRESH_MS = Number(
  Deno.env.get("DISCOVER_MERGED_CACHE_TTL_MS") ?? "120000",
);
export const DISCOVER_L1_STALE_MS = Number(
  Deno.env.get("DISCOVER_MERGED_STALE_MS") ?? "600000",
);

interface L1Entry {
  response: DiscoverMergedResponse;
  freshUntil: number;
  staleUntil: number;
}

const l1 = new Map<string, L1Entry>();
const inflight = new Map<string, Promise<DiscoverMergedResponse>>();

export function l1Get(key: string, now = Date.now()): L1Entry | null {
  const hit = l1.get(key);
  if (!hit || now >= hit.staleUntil) {
    if (hit) l1.delete(key);
    return null;
  }
  return hit;
}

export function l1Set(key: string, response: DiscoverMergedResponse, now = Date.now()): void {
  l1.set(key, {
    response,
    freshUntil: now + DISCOVER_L1_FRESH_MS,
    staleUntil: now + DISCOVER_L1_STALE_MS,
  });
}

export async function coalesceDiscoverBuild(
  key: string,
  build: () => Promise<DiscoverMergedResponse>,
): Promise<DiscoverMergedResponse> {
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = build()
    .then((response) => {
      l1Set(key, response);
      return response;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

export function refreshDiscoverInBackground(
  key: string,
  build: () => Promise<DiscoverMergedResponse>,
): void {
  if (inflight.has(key)) return;
  void coalesceDiscoverBuild(key, build).catch((err) => {
    console.warn("[discover-merged-events] background refresh failed:", err);
  });
}
