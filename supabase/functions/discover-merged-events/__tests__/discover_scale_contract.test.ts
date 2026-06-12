// ORCH-426 G1 — structural regression for discover scale optimizations.

import { assert } from "https://deno.land/std@0.190.0/testing/asserts.ts";

const INDEX_URL = new URL("../index.ts", import.meta.url);

Deno.test("discover-merged-events uses parallel fan-out and response cache", async () => {
  const src = await Deno.readTextFile(INDEX_URL);
  assert(
    src.includes("Promise.all"),
    "expected Promise.all parallel fan-out in discover-merged-events/index.ts",
  );
  assert(
    src.includes("discover_merged_events_cache"),
    "expected discover_merged_events_cache table usage",
  );
  assert(
    src.includes('count: "estimated"'),
    'expected count: "estimated" instead of exact count on business query',
  );
  assert(
    src.includes("buildDiscoverCacheKey"),
    "expected buildDiscoverCacheKey import",
  );
});
