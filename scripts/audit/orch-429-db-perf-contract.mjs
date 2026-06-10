#!/usr/bin/env node
/**
 * #426 PR4 — Regression contract for DB perf tooling + hot-path migration.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const REQUIRED = [
  "supabase/migrations/20260923000000_orch_426_scale_hot_path_indexes.sql",
  "docs/db-hot-queries.md",
  "scripts/db/explain-hot-queries.sql",
  "scripts/audit/rls-perf-heuristic.mjs",
];

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

for (const rel of REQUIRED) {
  if (!existsSync(join(ROOT, rel))) fail(`missing ${rel}`);
}

const mig = readFileSync(
  join(ROOT, "supabase/migrations/20260923000000_orch_426_scale_hot_path_indexes.sql"),
  "utf8",
);
for (const idx of [
  "idx_event_dates_event_id_end_at",
  "idx_tickets_order_id_created_at",
  "idx_agent_messages_user_role_created",
]) {
  if (!mig.includes(idx)) fail(`migration missing ${idx}`);
}

console.log("PASS: orch-429 db perf contract");
process.exit(0);
