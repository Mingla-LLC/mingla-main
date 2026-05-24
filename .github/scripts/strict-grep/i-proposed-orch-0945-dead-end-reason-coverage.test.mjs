#!/usr/bin/env node
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const gate = readFileSync(resolve(__dirname, "i-proposed-orch-0945-dead-end-reason-coverage.mjs"), "utf8");

for (const reason of [
  "intersection_empty",
  "no_matching_candidates",
  "no_unswiped_candidates",
  "quorum_not_met",
  "all_pools_exhausted",
]) {
  assert.ok(gate.includes(reason), `self-test: gate must enforce ${reason}`);
}
assert.ok(gate.includes("acceptedCount"), "self-test: gate must enforce acceptedCount propagation");
assert.ok(gate.includes("pendingGpsUserIds"), "self-test: gate must enforce pendingGpsUserIds propagation");

console.log("i-proposed-orch-0945-dead-end-reason-coverage self-test PASS");
