#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0839-A regression check — meta counts match items returned.
 *
 * Asserts the F-2 fix from SPEC_ORCH-0839-A_DISCOVER_HARDENING.md:
 *
 *   supabase/functions/discover-merged-events/index.ts response builder
 *   MUST set `meta.ticketmasterCount` from `tmSpread.length` (post-slice)
 *   and `meta.businessCount` from `businessSpread.length` (post-slice),
 *   NEVER from the pre-slice upstream totals (`tmTotal`, `businessTotal`).
 *   Upstream-total fields are exposed as `*TotalAvailable` for informational
 *   use. Plus: when TM upstream reports totalResults>0 but events=[], the
 *   endpoint surfaces tmError="ticketmaster_upstream_dropped_events".
 *
 * Invariant codified: I-PROPOSED-DISCOVER-META-MATCHES-ITEMS.
 *
 * Exit 1 on any FAIL. 3 contracts (T-B0, T-B1, T-B2).
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

// ORCH-1135 (PR #466 G1 discover v2): the response-merge logic moved out of the
// 830-line index.ts monolith into `_build-response.ts` (mergeDiscoverResponse).
// The three post-slice-count contracts are unchanged; only the file they live in
// changed. See INVESTIGATE_ORCH-1135_DISCOVER_V2_INVARIANT_PRESERVATION.md.
const merged = readMaybe(
  path.join(
    repoRoot,
    "supabase/functions/discover-merged-events/_build-response.ts",
  ),
);

// ─── T-B0: ticketmasterCount derived from tmSpread.length ────────────────

check(
  "T-B0 meta.ticketmasterCount is tmSpread.length (post-slice), not tmTotal (pre-slice)",
  merged !== null &&
    /ticketmasterCount:\s*tmSpread\.length/.test(merged) &&
    !/ticketmasterCount:\s*tmTotal\b/.test(merged),
  "supabase/functions/discover-merged-events/index.ts response.meta.ticketmasterCount MUST equal `tmSpread.length` (the actual number of TM items in items[]), never `tmTotal` (the upstream-claimed total before slice). Constitution #3: no silent failures — counts must match what's actually in the response.",
);

// ─── T-B1: businessCount derived from businessSpread.length ──────────────

check(
  "T-B1 meta.businessCount is businessSpread.length (post-slice), not businessTotal (pre-slice)",
  merged !== null &&
    /businessCount:\s*businessSpread\.length/.test(merged) &&
    !/businessCount:\s*businessTotal\s*\?\?\s*businessItems\.length/.test(
      merged,
    ),
  "supabase/functions/discover-merged-events/index.ts response.meta.businessCount MUST equal `businessSpread.length`. The old form `businessTotal ?? businessItems.length` is the pre-slice DB count and could exceed items.length after the size-based truncation.",
);

// ─── T-B2: tmError defensive flagging when upstream drops events ─────────

check(
  "T-B2 endpoint surfaces tmError='ticketmaster_upstream_dropped_events' when tmItems.length === 0 && tmTotal > 0",
  merged !== null &&
    /tmItems\.length\s*===\s*0\s*&&\s*tmTotal\s*>\s*0/.test(merged) &&
    /ticketmaster_upstream_dropped_events/.test(merged),
  "supabase/functions/discover-merged-events/index.ts MUST contain a conditional block that, when TM upstream reports totalResults>0 but returns events=[], assigns tmError='ticketmaster_upstream_dropped_events'. Defense-in-depth: F-1 should eliminate the observed case, but future regressions in any TM path that drops events while keeping totalResults positive must be surfaced.",
);

// ─── Report ────────────────────────────────────────────────────────────────

console.log("\nORCH-0839-A meta/items consistency regression check\n");
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
