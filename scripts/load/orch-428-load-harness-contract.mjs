#!/usr/bin/env node
/**
 * #426 PR3 — Regression contract for expanded load harness.
 * Fails if PR3 scripts, JWT helper, or fixture doc are removed.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const REQUIRED = [
  "scripts/load/ticket-checkout-create.js",
  "scripts/load/agent-chat.js",
  "scripts/load/fetch-test-jwt.mjs",
  "scripts/load/fixtures/example.env",
  "docs/load-test-fixtures.md",
];

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

for (const rel of REQUIRED) {
  if (!existsSync(join(ROOT, rel))) {
    fail(`missing ${rel}`);
  }
}

const smoke = readFileSync(join(ROOT, "scripts/load/smoke.js"), "utf8");
if (!smoke.includes("ticket-checkout-create") || !smoke.includes("agent-chat")) {
  fail("smoke.js must exercise checkout-create and agent-chat");
}

const jwtHelper = readFileSync(join(ROOT, "scripts/load/fetch-test-jwt.mjs"), "utf8");
if (!jwtHelper.includes("grant_type=password") || !jwtHelper.includes("access_token")) {
  fail("fetch-test-jwt.mjs must use password grant and emit access_token");
}

console.log("PASS: orch-428 load harness contract");
process.exit(0);
