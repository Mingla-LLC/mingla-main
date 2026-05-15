#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0839-A regression check — TM-events cache-hit must serve events verbatim.
 *
 * Asserts the F-1 fix from SPEC_ORCH-0839-A_DISCOVER_HARDENING.md:
 *
 *   supabase/functions/ticketmaster-events/index.ts cache-hit branch (the
 *   `if (cached)` block) MUST return `events` directly, NOT slice with
 *   `events.slice(pageNum * pageSize, …)`. The cache row stores one TM
 *   page; per-page slicing was always wrong and caused the operator's
 *   "All shows only Mingla events" symptom (page=1 sliced 20-element rows
 *   into `[]`).
 *
 *   The `discover-merged-events` `Math.max(1, body.page ?? 1)` default
 *   remains correct (informational regression check — we don't want a
 *   future change to silently regress merged-side page derivation).
 *
 * Invariant codified: I-PROPOSED-DISCOVER-TM-CACHE-NO-SLICE.
 *
 * Exit 1 on any FAIL. 2 contracts (T-A0, T-A1).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(root, "..");

const readMaybe = (absRel) => {
  try {
    return fs.readFileSync(absRel, "utf8");
  } catch {
    return null;
  }
};

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

const tm = readMaybe(
  path.join(repoRoot, "supabase/functions/ticketmaster-events/index.ts"),
);
const merged = readMaybe(
  path.join(repoRoot, "supabase/functions/discover-merged-events/index.ts"),
);

// ─── T-A0: TM-events cache-hit serves events verbatim (no pageNum slice) ──

check(
  "T-A0 ticketmaster-events cache-hit branch does NOT call events.slice(pageNum*pageSize, ...)",
  tm !== null &&
    // The bug pattern was: `const paginatedEvents = events.slice(start, start + pageSize);`
    // following `const start = pageNum * pageSize;`. Both clauses must be absent.
    !/const\s+start\s*=\s*pageNum\s*\*\s*pageSize/.test(tm) &&
    !/events\.slice\(\s*start\s*,\s*start\s*\+\s*pageSize\s*\)/.test(tm) &&
    // Defense: the new code must reference the cached events array directly
    // in the cache-hit response body. The literal `events,` (as a shorthand
    // object property inside the JSON.stringify) is the marker that we're
    // serving verbatim, not a sliced copy.
    /JSON\.stringify\(\{\s*events,/.test(tm),
  "supabase/functions/ticketmaster-events/index.ts cache-hit branch MUST serve the cached `events` array verbatim. The previous `events.slice(pageNum*pageSize, start+pageSize)` caused operator's 'All shows only Mingla events' symptom because the merged endpoint sends page=1, slice(20,40) on 20-element cache row = []. Invariant: I-PROPOSED-DISCOVER-TM-CACHE-NO-SLICE.",
);

// ─── T-A1: merged endpoint keeps Math.max(1, body.page ?? 1) ──────────────

check(
  "T-A1 discover-merged-events keeps Math.max(1, body.page ?? 1) page derivation",
  merged !== null &&
    /Math\.max\(\s*1,\s*body\.page\s*\?\?\s*1\s*\)/.test(merged),
  "supabase/functions/discover-merged-events/index.ts page derivation MUST stay `Math.max(1, body.page ?? 1)`. Pair with T-A0 to ensure merged-side and TM-events-side agree on indexing (merged is 1-indexed externally; TM-events serves the cached page regardless internally). Regression check — don't let a future change silently flip the page default to 0.",
);

// ─── Report ────────────────────────────────────────────────────────────────

console.log("\nORCH-0839-A TM pagination aligned regression check\n");
let failed = 0;
for (const c of checks) {
  const tag = c.pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${c.name}`);
  if (!c.pass) {
    console.log(`         ${c.detail}`);
    failed += 1;
  }
}
console.log(
  `\nSummary: ${checks.length - failed}/${checks.length} PASS${
    failed > 0 ? ` (${failed} FAIL)` : ""
  }\n`,
);
process.exit(failed > 0 ? 1 : 0);
