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
const migrationPath = join(
  root,
  "supabase/migrations/20260612000000_orch_426_discover_scale.sql",
);

const index = readFileSync(indexPath, "utf8");
const migration = readFileSync(migrationPath, "utf8");

const checks = [
  [index.includes("Promise.all"), "Promise.all parallel fan-out"],
  [index.includes("discover_merged_events_cache"), "response cache table"],
  [index.includes('count: "estimated"'), "estimated count"],
  [migration.includes("idx_events_discover_feed"), "discover feed index"],
  [migration.includes("idx_event_dates_master_end_at"), "master end_at index"],
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
