#!/usr/bin/env node

/**
 * I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE strict-grep gate (ORCH-0845).
 *
 * The `discover-merged-events` edge function MUST always filter
 *   event_dates.end_at >= lowerBoundUtc
 * on the master date row, on BOTH the no-date-window code path AND the
 * dated-chip code path. The filter is hoisted into the unconditional query
 * chain (NOT scoped to `if (dateWindowUtc !== null)`).
 *
 * Pre-0845 the predicate lived only inside the dated-chip branch, so the
 * default "All" view returned events whose master end-time had already
 * passed. Ghost-inventory probe on 2026-05-15 found 2/9 (22%) of live
 * public-scheduled inventory leaking — including the canonical Big Party
 * Raleigh test event 20 hours after its end. See
 * `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0845_DISCOVER_ENDED_EVENTS_STILL_SHOWN.md`.
 *
 * Detection rule (presence-check):
 *   `supabase/functions/discover-merged-events/index.ts` MUST contain BOTH
 *   of the following substrings, each on a non-comment line:
 *     - `const lowerBoundUtc`
 *     - `.gte("event_dates.end_at", lowerBoundUtc)`
 *
 *   Lines beginning (after leading whitespace) with `//` are skipped — they
 *   are documentation, not the live predicate. Block comments are NOT
 *   stripped: the substrings would not naturally appear inside one, so this
 *   keeps the gate simple and deterministic.
 *
 * Self-test note:
 *   This script's filename and comments may freely mention the required
 *   tokens — the scan target is the edge function only, not this file.
 *
 * Exit codes:
 *   0 — both substrings present on non-comment lines (gate green)
 *   1 — at least one substring missing or only present in comments (gate red)
 *   2 — file system error reading the target file
 *
 * Modeled on `.github/scripts/strict-grep/i-ari-no-oklch.mjs`. Established
 * by SPEC_ORCH-0845 §3.7.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const TARGET_FILE = "supabase/functions/discover-merged-events/index.ts";

const REQUIRED_TOKENS = [
  {
    name: "const lowerBoundUtc",
    needle: "const lowerBoundUtc",
  },
  {
    name: '.gte("event_dates.end_at", lowerBoundUtc)',
    needle: '.gte("event_dates.end_at", lowerBoundUtc)',
  },
];

const targetPath = path.join(repoRoot, TARGET_FILE);

let source;
try {
  source = fs.readFileSync(targetPath, "utf8");
} catch (err) {
  console.error(
    `[i-discover-excludes-ended-master-date] FAIL — could not read ${TARGET_FILE}: ${err.message}`,
  );
  process.exit(2);
}

const lines = source.split("\n");

function findOnNonCommentLine(needle) {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const stripped = line.trimStart();
    // Skip single-line comments. We intentionally do NOT attempt to strip
    // block comments — the required tokens would not naturally appear
    // inside a `/* ... */` block in this codebase, and a partial block-
    // comment parser would add complexity for no real gain.
    if (stripped.startsWith("//")) continue;
    if (line.includes(needle)) {
      return { lineNumber: i + 1, text: line };
    }
  }
  return null;
}

const missing = [];
const found = [];
for (const token of REQUIRED_TOKENS) {
  const hit = findOnNonCommentLine(token.needle);
  if (hit === null) {
    missing.push(token);
  } else {
    found.push({ token, hit });
  }
}

if (missing.length > 0) {
  console.error(
    `[i-discover-excludes-ended-master-date] FAIL — required token(s) missing from ${TARGET_FILE} (or only present inside line comments):`,
  );
  for (const m of missing) {
    console.error(`  - ${m.name}`);
  }
  console.error("");
  console.error(
    "This means the ORCH-0845 fix has been removed, renamed, or moved back inside the `if (dateWindowUtc !== null)` block. Ended events will leak on the default 'All' view of Discover. See `Mingla_Artifacts/specs/SPEC_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md` for the required code shape.",
  );
  process.exit(1);
}

console.log(
  `[i-discover-excludes-ended-master-date] PASS — ${TARGET_FILE} contains both required tokens on non-comment lines:`,
);
for (const { token, hit } of found) {
  console.log(`  - line ${hit.lineNumber}: ${token.name}`);
}
process.exit(0);
