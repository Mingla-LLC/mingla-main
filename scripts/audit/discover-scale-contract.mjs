#!/usr/bin/env node
/**
 * #426 G1 — CI contract: discover-merged-events scale optimizations present.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const indexPath = join(
  root,
  "supabase/functions/discover-merged-events/index.ts",
);
const rpcMigration = join(
  root,
  "supabase/migrations/20261001000000_orch_426_discover_rpc.sql",
);
const scaleMigration = join(
  root,
  "supabase/migrations/20260612000000_orch_426_discover_scale.sql",
);
const gzipMigration = join(
  root,
  "supabase/migrations/20260615000000_orch_426_discover_cache_gzip.sql",
);
const distributed = join(root, "scripts/load/run-distributed.sh");

const index = readFileSync(indexPath, "utf8");
const rpcSql = readFileSync(rpcMigration, "utf8");
const scaleSql = readFileSync(scaleMigration, "utf8");
const gzipSql = readFileSync(gzipMigration, "utf8");
const distributedSh = readFileSync(distributed, "utf8");

const memoryPath = join(root, "supabase/functions/discover-merged-events/_memory-cache.ts");
const bytesPath = join(root, "supabase/functions/discover-merged-events/_response-bytes.ts");
const distributedPath = join(root, "supabase/functions/discover-merged-events/_distributed-cache.ts");
const resolvePath = join(root, "supabase/functions/discover-merged-events/_resolve-entry.ts");
const supabaseEdge = join(root, "scripts/load/lib/supabase-edge.js");
const memory = readFileSync(memoryPath, "utf8");
const bytes = readFileSync(bytesPath, "utf8");
const distributedTs = readFileSync(distributedPath, "utf8");
const resolveTs = readFileSync(resolvePath, "utf8");
const supabaseEdgeJs = readFileSync(supabaseEdge, "utf8");

const checks = [
  [index.includes("coalesceDiscoverBuild"), "L1 single-flight coalesce"],
  [index.includes("l1Get"), "L1 memory cache"],
  [index.includes("resolveDiscoverEntry"), "coalesced resolve entry"],
  [index.includes("serveDiscoverBytes"), "byte serve path"],
  [memory.includes("bytes"), "L1 byte cache"],
  [bytes.includes("encodeDiscoverResponse"), "gzip response bytes"],
  [bytes.includes("bytesFromStoredGzip"), "gzip-only DB bytes"],
  [supabaseEdgeJs.includes('"Accept-Encoding": "gzip"'), "k6 gzip request header"],
  [distributedTs.includes("export async function writeDbDiscoverCache"), "awaited cache write"],
  [distributedTs.includes("return false"), "fail-closed build lock"],
  [distributedTs.includes("waitForDbDiscoverCacheGzip"), "gzip poll waiter"],
  [distributedTs.includes("POLL_ATTEMPTS = 200"), "20s poll cap"],
  [resolveTs.includes("DiscoverOverloadedError"), "overload fast-fail"],
  [resolveTs.includes("includeStale: true"), "stale DB fallback"],
  [index.includes("pg_discover_business_events") || readFileSync(join(root, "supabase/functions/discover-merged-events/_business-query.ts"), "utf8").includes("pg_discover_business_events"), "discover RPC"],
  [rpcSql.includes("pg_discover_business_events"), "RPC migration"],
  [scaleSql.includes("discover_merged_events_cache"), "response cache table"],
  [gzipSql.includes("response_gzip_base64"), "gzip cache column"],
  [distributedSh.includes('execution-segment "${SEG_START}:${SEG_END}"'), "k6 v2 segment format"],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error(`FAIL discover-scale-contract: missing ${label}`);
    failed += 1;
  }
}

if (failed > 0) process.exit(1);
console.log("OK discover-scale-contract");
