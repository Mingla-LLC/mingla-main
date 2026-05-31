#!/usr/bin/env node

/**
 * I-AI-SCORE-STALENESS-AUTO-RECOVERED (META-ORCH-1009 Sub-D invariant, ACTIVE)
 *
 * Two-part enforcement gate:
 *
 *  Part A — the 15-min rescore-sweep cron MUST be registered in the Sub-D
 *           migration. If the cron schedule line ever disappears (e.g. a
 *           future migration unschedules it without replacement), the
 *           consumer deck silently regresses to "stale until operator clicks."
 *
 *  Part B — `place_scores.ai_signal_scores_at` is written by EXACTLY ONE
 *           code path: supabase/functions/run-signal-scorer/index.ts.
 *           Any other code path that writes this column silently steals the
 *           freshness-tracking contract and the cron's drift detection no
 *           longer reflects what last wrote the score.
 *
 * Heuristic for Part B: an object literal that contains
 * `ai_signal_scores_at:` as a key is almost certainly a write payload
 * (Supabase .update / .upsert / .insert shape) or an SQL UPDATE
 * assignment. Test files, migrations (the column is DEFINED in one), the
 * gate itself, and prose-only docs are exempt by path / extension.
 *
 * Self-test:
 *   - This script + the SPEC + the implementation report mention
 *     `ai_signal_scores_at:` in prose; excluded by .md filter +
 *     Mingla_Artifacts/ + .github/scripts/ path filters.
 *   - Temporary insertion of `.update({ ai_signal_scores_at: ... })` into
 *     any other supabase/functions/ file MUST trip Part B (verified at
 *     Sub-D implement time per the implementation report's "fails-on-revert"
 *     evidence).
 *
 * Sibling invariants:
 *   - I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER (write side of the AI column)
 *   - I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED (read side of the blend)
 *   - I-CONSUMER-READS-AI-SIGNAL-SCORES-NOT-TRIAL-TABLE (consumer surface gate)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

// ─── Part A: cron registration ───────────────────────────────────────────

const SUB_D_MIGRATION =
  "supabase/migrations/20260808000000_meta_orch_1009_sub_d_refresh_cron.sql";
const REQUIRED_CRON_NAME = "meta_orch_1009_sub_d_ai_score_rescore_sweep";
const REQUIRED_CRON_SCHEDULE = "*/15 * * * *";

function partA() {
  const abs = path.join(repoRoot, SUB_D_MIGRATION);
  if (!fs.existsSync(abs)) {
    console.error(
      `FAIL [Part A]: Sub-D migration not found at ${SUB_D_MIGRATION}`,
    );
    return false;
  }
  const src = fs.readFileSync(abs, "utf8");
  if (!src.includes(REQUIRED_CRON_NAME)) {
    console.error(
      `FAIL [Part A]: cron name '${REQUIRED_CRON_NAME}' not registered in ${SUB_D_MIGRATION}`,
    );
    return false;
  }
  if (!src.includes(REQUIRED_CRON_SCHEDULE)) {
    console.error(
      `FAIL [Part A]: cron schedule '${REQUIRED_CRON_SCHEDULE}' not present in ${SUB_D_MIGRATION}`,
    );
    return false;
  }
  return true;
}

// ─── Part B: sole-writer for place_scores.ai_signal_scores_at ────────────

const ALLOWED_WRITER_FILES = new Set([
  "supabase/functions/run-signal-scorer/index.ts",
]);

const SCAN_DIRS = [
  "supabase/functions",
  "supabase/migrations",
  "mingla-admin/src",
  "app-mobile/src",
  "mingla-business/src",
  "packages",
];

const EXCLUDED_DIRS = new Set([
  "node_modules",
  "__tests__",
  "test",
  "tests",
  "dist",
  "build",
  ".next",
]);

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".sql"];

const WRITE_PATTERNS = [
  /\bai_signal_scores_at\s*:/, // JS/TS object key
  /\bai_signal_scores_at\s*=\s*[^=]/, // SQL UPDATE or JS assignment (not ==)
];

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

function partB() {
  let violations = [];
  let scannedFiles = 0;

  for (const dir of SCAN_DIRS) {
    const abs = path.join(repoRoot, dir);
    if (!fs.existsSync(abs)) continue;
    for (const filePath of walk(abs)) {
      const relPath = path.relative(repoRoot, filePath);

      // Allowed writer
      if (ALLOWED_WRITER_FILES.has(relPath)) continue;

      // Migrations DEFINE the column + run the one-shot D-6 seed-UPDATE.
      // Architectural, not runtime — never a recurring writer.
      if (relPath.startsWith("supabase/migrations/")) continue;

      const contents = fs.readFileSync(filePath, "utf8");
      for (const pat of WRITE_PATTERNS) {
        if (pat.test(contents)) {
          violations.push({ file: relPath, pattern: pat.source });
          break;
        }
      }
      scannedFiles++;
    }
  }

  if (violations.length > 0) {
    console.error("FAIL [Part B]: I-AI-SCORE-STALENESS-AUTO-RECOVERED violated");
    console.error(
      `\n${violations.length} file(s) appear to WRITE place_scores.ai_signal_scores_at outside the allowed writer:`,
    );
    console.error(`  Allowed: ${[...ALLOWED_WRITER_FILES].join(", ")}`);
    console.error("\nOffenders:");
    for (const v of violations) {
      console.error(`  - ${v.file}  (matched: ${v.pattern})`);
    }
    console.error(
      "\nIf this is an intentional new writer, update ALLOWED_WRITER_FILES",
    );
    console.error(
      "in this script AND register a new ORCH amending I-AI-SCORE-STALENESS-AUTO-RECOVERED.",
    );
    return { ok: false, scanned: scannedFiles };
  }
  return { ok: true, scanned: scannedFiles };
}

// ─── Run both parts; fail on either ──────────────────────────────────────

const aOk = partA();
const b = partB();

if (!aOk || !b.ok) {
  process.exit(1);
}

console.log(
  `OK: I-AI-SCORE-STALENESS-AUTO-RECOVERED — cron registered (Part A) + ${b.scanned} files scanned, 0 unauthorized ai_signal_scores_at writers (Part B)`,
);
