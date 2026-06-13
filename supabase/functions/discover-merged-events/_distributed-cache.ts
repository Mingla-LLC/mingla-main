/**
 * ORCH-426 G1 — distributed build lock + poll (cross-isolate single-flight).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { DiscoverMergedResponse } from "./_types.ts";

const POLL_MS = 150;
const POLL_ATTEMPTS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readDbDiscoverCache(
  supabase: SupabaseClient,
  cacheKey: string,
): Promise<DiscoverMergedResponse | null> {
  const { data, error } = await supabase
    .from("discover_merged_events_cache")
    .select("response")
    .eq("cache_key", cacheKey)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data?.response) return null;
  const cached = data.response as DiscoverMergedResponse;
  return {
    ...cached,
    meta: { ...cached.meta, fromCache: true },
  };
}

export async function waitForDbDiscoverCache(
  supabase: SupabaseClient,
  cacheKey: string,
): Promise<DiscoverMergedResponse | null> {
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    const hit = await readDbDiscoverCache(supabase, cacheKey);
    if (hit) return hit;
    await sleep(POLL_MS);
  }
  return null;
}

export async function tryDistributedBuildLock(
  supabase: SupabaseClient,
  cacheKey: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("pg_try_discover_cache_build_lock", {
    p_cache_key: cacheKey,
    p_ttl_seconds: 45,
  });
  if (error) {
    console.warn("[discover-merged-events] build lock skipped:", error.message);
    return true;
  }
  return data === true;
}

export async function releaseDistributedBuildLock(
  supabase: SupabaseClient,
  cacheKey: string,
): Promise<void> {
  await supabase.rpc("pg_release_discover_cache_build_lock", {
    p_cache_key: cacheKey,
  });
}

export function writeDbDiscoverCache(
  supabase: SupabaseClient,
  cacheKey: string,
  response: DiscoverMergedResponse,
  discoverStaleExpiresAt: () => string,
): void {
  (async () => {
    try {
      await supabase.from("discover_merged_events_cache").upsert(
        {
          cache_key: cacheKey,
          response,
          fetched_at: new Date().toISOString(),
          expires_at: discoverStaleExpiresAt(),
        },
        { onConflict: "cache_key" },
      );
      await supabase
        .from("discover_merged_events_cache")
        .delete()
        .lt("expires_at", new Date().toISOString());
    } catch (err) {
      console.warn("[discover-merged-events] cache upsert error:", err);
    }
  })();
}
