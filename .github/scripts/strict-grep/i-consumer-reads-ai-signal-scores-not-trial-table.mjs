#!/usr/bin/env node

/**
 * I-CONSUMER-READS-AI-SIGNAL-SCORES-NOT-TRIAL-TABLE (META-ORCH-1009 Sub-B, ACTIVE)
 *
 * Production consumer-ranker code paths MUST read AI signal evaluations
 * EXCLUSIVELY from `place_pool.ai_signal_scores` (the column Sub-A wired,
 * authored by DEC-099 + DEC-181). They MUST NOT read from the trial table
 * `place_intelligence_trial_runs`, which is research-grade — no production
 * contract on schema or freshness.
 *
 * Admin tooling (admin dashboard, trial-run inspector, re-eval button) is
 * EXPLICITLY EXEMPT — the trial table is its source of truth. This gate only
 * blocks the consumer ranker layer.
 *
 * Scanned files:
 *   - supabase/functions/_shared/signalScorer.ts
 *   - supabase/functions/_shared/signalRankFetch.ts
 *   - supabase/functions/discover-cards/**
 *   - supabase/functions/generate-curated-experiences/**
 *   - supabase/functions/run-signal-scorer/**
 *
 * Allowed surfaces (NOT scanned):
 *   - mingla-admin/**
 *   - supabase/functions/run-place-intelligence-trial/** (writes trial rows)
 *   - supabase/functions/* admin-only tooling
 *   - test files (__tests__/)
 *
 * Sibling invariants:
 *   - I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER (gate file: i-ai-signal-scores-column-sole-owner.mjs)
 *   - I-AI-SIGNAL-SCORES-SHAPE-CONTRACT
 *   - I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED (ACTIVE post Sub-B)
 *   - I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING (RETRACTED post Sub-A)
 *
 * Self-test recipe (for the implementor): temporarily insert
 * `await supabaseAdmin.from('place_intelligence_trial_runs').select('id').limit(1)`
 * into `supabase/functions/_shared/signalScorer.ts` → gate FAILs with a
 * non-zero exit code; remove → gate PASSes again.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

// Production consumer ranker scope. Any of these files mentioning the trial
// table = production read of a research surface = invariant violation.
const SCAN_FILES_EXPLICIT = [
  "supabase/functions/_shared/signalScorer.ts",
  "supabase/functions/_shared/signalRankFetch.ts",
];

const SCAN_DIRS = [
  "supabase/functions/discover-cards",
  "supabase/functions/generate-curated-experiences",
  "supabase/functions/run-signal-scorer",
];

const EXCLUDED_DIRS = new Set(["__tests__", "test", "tests", "node_modules"]);
const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js"];

const FORBIDDEN_PATTERN = /place_intelligence_trial_runs/;

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (
      entry.isFile() && EXTENSIONS.some((ext) => entry.name.endsWith(ext))
    ) {
      yield full;
    }
  }
}

const violations = [];
let scannedFiles = 0;

// Explicit single-file targets
for (const rel of SCAN_FILES_EXPLICIT) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) continue;
  const contents = fs.readFileSync(abs, "utf8");
  if (FORBIDDEN_PATTERN.test(contents)) {
    violations.push(rel);
  }
  scannedFiles++;
}

// Directory walks
for (const dir of SCAN_DIRS) {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) continue;
  for (const filePath of walk(abs)) {
    const rel = path.relative(repoRoot, filePath);
    const contents = fs.readFileSync(filePath, "utf8");
    if (FORBIDDEN_PATTERN.test(contents)) {
      violations.push(rel);
    }
    scannedFiles++;
  }
}

if (violations.length > 0) {
  console.error(
    "FAIL: I-CONSUMER-READS-AI-SIGNAL-SCORES-NOT-TRIAL-TABLE violated",
  );
  console.error(
    `\n${violations.length} consumer-ranker file(s) read from place_intelligence_trial_runs:`,
  );
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  console.error("");
  console.error("The consumer ranker MUST read AI signal evaluations from");
  console.error("place_pool.ai_signal_scores (the column Sub-A wired). The");
  console.error("trial table is research-grade and has NO production contract.");
  console.error("");
  console.error("If you legitimately need admin-only telemetry, move the code");
  console.error("under mingla-admin/ or supabase/functions/run-place-intelligence-trial/");
  console.error("(both are exempt — admin owns the trial-table read surface).");
  process.exit(1);
}

console.log(
  `OK: I-CONSUMER-READS-AI-SIGNAL-SCORES-NOT-TRIAL-TABLE — ${scannedFiles} files scanned, 0 trial-table reads in consumer ranker`,
);
