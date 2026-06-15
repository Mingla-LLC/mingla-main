// ORCH-426 G1 — structural regression for discover scale optimizations.

import { assert } from "https://deno.land/std@0.190.0/testing/asserts.ts";

const INDEX_URL = new URL("../index.ts", import.meta.url);
const BUSINESS_URL = new URL("../_business-query.ts", import.meta.url);
const MEMORY_URL = new URL("../_memory-cache.ts", import.meta.url);
const BYTES_URL = new URL("../_response-bytes.ts", import.meta.url);

Deno.test("discover-merged-events uses L1 cache, RPC, and coalesced builds", async () => {
  const index = await Deno.readTextFile(INDEX_URL);
  const business = await Deno.readTextFile(BUSINESS_URL);
  const memory = await Deno.readTextFile(MEMORY_URL);
  const bytes = await Deno.readTextFile(BYTES_URL);

  assert(index.includes("coalesceDiscoverBuild"), "expected coalesceDiscoverBuild");
  assert(index.includes("l1Get"), "expected l1Get");
  assert(index.includes("discoverJsonResponse"), "expected pre-serialized response path");
  assert(
    business.includes("pg_discover_business_events"),
    "expected pg_discover_business_events RPC",
  );
  assert(memory.includes("inflight"), "expected single-flight inflight map");
  assert(bytes.includes("encodeDiscoverResponse"), "expected encodeDiscoverResponse");
  assert(memory.includes("bytes"), "expected L1 byte cache");
});
