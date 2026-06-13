#!/usr/bin/env node

/**
 * I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE strict-grep gate (ORCH-0845).
 *
 * The `discover-merged-events` read MUST always filter the master date row by
 *   end_at >= lowerBound
 * on BOTH the no-date-window "All" view AND the dated-chip path — the floor is
 * unconditional, NOT scoped to a date-window branch.
 *
 * Pre-0845 the predicate lived only inside the dated-chip branch, so the
 * default "All" view returned events whose master end-time had already
 * passed. Ghost-inventory probe on 2026-05-15 found 2/9 (22%) of live
 * public-scheduled inventory leaking — including the canonical Big Party
 * Raleigh test event 20 hours after its end. See
 * `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0845_DISCOVER_ENDED_EVENTS_STILL_SHOWN.md`.
 *
 * ORCH-1135 (PR #466 G1 discover v2): the heavy query moved out of index.ts
 * into the SQL RPC `pg_discover_business_events`. The floor predicate is now an
 * unconditional INNER JOIN condition in the RPC migration, and the "All" view
 * passes `now()` as the floor from `_build-response.ts`. The gate therefore
 * checks TWO authoritative layers (proof: INVESTIGATE_ORCH-1135_DISCOVER_V2_
 * INVARIANT_PRESERVATION.md):
 *
 *   Target A — the RPC migration that DEFINES pg_discover_business_events MUST
 *   contain, each on a non-comment line:
 *     - `ed.end_at >= p_lower_bound`   (the unconditional floor predicate)
 *     - `AND ed.is_master IS TRUE`     (anchors it to the master-date join)
 *
 *   Target B — `_build-response.ts` MUST contain the All-view floor source:
 *     - `dateWindowUtc !== null ? dateWindowUtc.startUtc : new Date().toISOString()`
 *     (so the SQL floor can't be neutered by feeding a far-past lower bound).
 *
 *   Lines beginning (after leading whitespace) with `//` (TS) or `--` (SQL) are
 *   skipped — a commented-out predicate cannot satisfy the gate.
 *
 * MAINTENANCE HAZARD (DISC-1135-B): Target A pins a specific migration FILENAME.
 * If a future ORCH redefines pg_discover_business_events in a NEW migration, bump
 * RPC_MIGRATION below to that new filename — same as every migration-pinned gate.
 *
 * Self-test note:
 *   This script's filename and comments may freely mention the required
 *   tokens — the scan targets are the product files only, not this file.
 *
 * Exit codes:
 *   0 — all required substrings present on non-comment lines (gate green)
 *   1 — at least one substring missing or only present in comments (gate red)
 *   2 — file system error reading a target file
 *
 * Modeled on `.github/scripts/strict-grep/i-ari-no-oklch.mjs`. Established
 * by SPEC_ORCH-0845 §3.7; re-pointed by ORCH-1135.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const RPC_MIGRATION =
  "supabase/migrations/20261001000000_orch_426_discover_rpc.sql";
const BUILD_RESPONSE =
  "supabase/functions/discover-merged-events/_build-response.ts";

// Each target file + the substrings it must carry on a non-comment line.
const TARGETS = [
  {
    file: RPC_MIGRATION,
    tokens: [
      { name: "ed.end_at >= p_lower_bound", needle: "ed.end_at >= p_lower_bound" },
      { name: "AND ed.is_master IS TRUE", needle: "AND ed.is_master IS TRUE" },
    ],
  },
  {
    file: BUILD_RESPONSE,
    tokens: [
      {
        name: "All-view floor source (dateWindowUtc !== null ? … : new Date().toISOString())",
        needle:
          "dateWindowUtc !== null ? dateWindowUtc.startUtc : new Date().toISOString()",
      },
    ],
  },
];

function findOnNonCommentLine(lines, needle) {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const stripped = line.trimStart();
    // Skip single-line comments (TS `//`, SQL `--`). We intentionally do NOT
    // attempt to strip block comments — the required tokens would not naturally
    // appear inside a `/* ... */` block in these files.
    if (stripped.startsWith("//") || stripped.startsWith("--")) continue;
    if (line.includes(needle)) {
      return { lineNumber: i + 1, text: line };
    }
  }
  return null;
}

const missing = [];
const found = [];

for (const target of TARGETS) {
  let source;
  try {
    source = fs.readFileSync(path.join(repoRoot, target.file), "utf8");
  } catch (err) {
    console.error(
      `[i-discover-excludes-ended-master-date] FAIL — could not read ${target.file}: ${err.message}`,
    );
    process.exit(2);
  }
  const lines = source.split("\n");
  for (const token of target.tokens) {
    const hit = findOnNonCommentLine(lines, token.needle);
    if (hit === null) {
      missing.push({ file: target.file, token });
    } else {
      found.push({ file: target.file, token, hit });
    }
  }
}

if (missing.length > 0) {
  console.error(
    "[i-discover-excludes-ended-master-date] FAIL — required token(s) missing (or only present inside comments):",
  );
  for (const m of missing) {
    console.error(`  - ${m.file}: ${m.token.name}`);
  }
  console.error("");
  console.error(
    "This means the ORCH-0845 ended-events floor has been removed, renamed, or moved back behind a date-window branch. Ended events will leak on the default 'All' view of Discover. See `Mingla_Artifacts/specs/SPEC_ORCH-0845_DISCOVER_EXCLUDES_ENDED_EVENTS.md` and INVESTIGATE_ORCH-1135_DISCOVER_V2_INVARIANT_PRESERVATION.md for the required code shape (now enforced in the pg_discover_business_events RPC + _build-response.ts).",
  );
  process.exit(1);
}

console.log(
  "[i-discover-excludes-ended-master-date] PASS — all required tokens present on non-comment lines:",
);
for (const { file, token, hit } of found) {
  console.log(`  - ${file}:${hit.lineNumber}: ${token.name}`);
}
process.exit(0);
