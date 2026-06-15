// ORCH-426 G1 — stampede-fix structural regression (P0+P1).

import { assert } from "https://deno.land/std@0.190.0/testing/asserts.ts";

const INDEX_URL = new URL("../index.ts", import.meta.url);
const BUSINESS_URL = new URL("../_business-query.ts", import.meta.url);
const MEMORY_URL = new URL("../_memory-cache.ts", import.meta.url);
const BYTES_URL = new URL("../_response-bytes.ts", import.meta.url);
const DISTRIBUTED_URL = new URL("../_distributed-cache.ts", import.meta.url);
const RESOLVE_URL = new URL("../_resolve-entry.ts", import.meta.url);

Deno.test("discover-merged-events uses L1 cache, RPC, and coalesced builds", async () => {
  const index = await Deno.readTextFile(INDEX_URL);
  const business = await Deno.readTextFile(BUSINESS_URL);
  const memory = await Deno.readTextFile(MEMORY_URL);
  const bytes = await Deno.readTextFile(BYTES_URL);
  const distributed = await Deno.readTextFile(DISTRIBUTED_URL);
  const resolve = await Deno.readTextFile(RESOLVE_URL);

  assert(index.includes("coalesceDiscoverBuild"), "expected coalesceDiscoverBuild");
  assert(index.includes("l1Get"), "expected l1Get");
  assert(index.includes("resolveDiscoverEntry"), "expected resolveDiscoverEntry");
  assert(index.includes("serveDiscoverBytes"), "expected serveDiscoverBytes");
  assert(
    business.includes("pg_discover_business_events"),
    "expected pg_discover_business_events RPC",
  );
  assert(memory.includes("inflight"), "expected single-flight inflight map");
  assert(bytes.includes("encodeDiscoverResponse"), "expected encodeDiscoverResponse");
  assert(bytes.includes("bytesFromStoredGzip"), "expected bytesFromStoredGzip");
  assert(memory.includes("bytes"), "expected L1 byte cache");
  assert(distributed.includes("export async function writeDbDiscoverCache"), "expected awaited cache write");
  assert(distributed.includes("return false"), "expected fail-closed lock");
  assert(distributed.includes("waitForDbDiscoverCacheGzip"), "expected gzip poll waiter");
  assert(distributed.includes("POLL_ATTEMPTS = 200"), "expected 20s poll cap");
  assert(resolve.includes("DiscoverOverloadedError"), "expected overload fast-fail");
  assert(resolve.includes("includeStale: true"), "expected stale fallback");
  assert(!resolve.includes("buildDiscoverMergedResponse") || resolve.includes("holdsLock"), "expected lock-gated origin");
});
