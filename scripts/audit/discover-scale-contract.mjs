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
  "supabase/migrations/20260613000000_orch_426_discover_rpc.sql",
);
const scaleMigration = join(
  root,
  "supabase/migrations/20260612000000_orch_426_discover_scale.sql",
);
const distributed = join(root, "scripts/load/run-distributed.sh");

const index = readFileSync(indexPath, "utf8");
const rpcSql = readFileSync(rpcMigration, "utf8");
const scaleSql = readFileSync(scaleMigration, "utf8");
const distributedSh = readFileSync(distributed, "utf8");

const checks = [
  [index.includes("coalesceDiscoverBuild"), "L1 single-flight coalesce"],
  [index.includes("l1Get"), "L1 memory cache"],
  [index.includes("pg_discover_business_events") || readFileSync(join(root, "supabase/functions/discover-merged-events/_business-query.ts"), "utf8").includes("pg_discover_business_events"), "discover RPC"],
  [rpcSql.includes("pg_discover_business_events"), "RPC migration"],
  [scaleSql.includes("discover_merged_events_cache"), "response cache table"],
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
