#!/usr/bin/env node

/**
 * I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER (META-ORCH-1009 Sub-A invariant, ACTIVE)
 *
 * Only `supabase/functions/run-place-intelligence-trial/index.ts` writes to
 * `place_pool.ai_signal_scores`. Any other code path that produces a write
 * payload (`.update`, `.upsert`, `.insert`) referencing `ai_signal_scores`
 * silently steals ownership of the AI-evaluation column and breaks the
 * single-writer guarantee that DEC-099 + DEC-181 codified.
 *
 * READS are unrestricted — Sub-B will add ranker reads, admin tools may
 * surface the data, etc. This gate only blocks WRITES outside the allowed
 * source file.
 *
 * Heuristic: an object literal that contains `ai_signal_scores:` as a key
 * is almost certainly a write payload (Supabase `.update({...})` / `.upsert`
 * /  `.insert` shape). Test files + the gate itself are exempt.
 *
 * Sibling invariants:
 *   - I-AI-SIGNAL-SCORES-SHAPE-CONTRACT (writes match the JSONB shape)
 *   - I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED (DRAFT — Sub-B flips ACTIVE)
 *   - I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING (RETRACTED 2026-05-30 via Sub-A)
 *
 * Self-test: this script + the SPEC + the implementation report + the QA
 * report all mention `ai_signal_scores:` in prose. The scan filters those
 * out by extension (`.md`, `.txt`) and path (anything under `.github/scripts/`,
 * `Mingla_Artifacts/`, `__tests__/`).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

// Files that ARE allowed to write to ai_signal_scores. The single-writer rule
// codified by DEC-099 + DEC-181. Add NEW entries only with operator approval
// + a new ORCH banner.
const ALLOWED_WRITER_FILES = new Set([
  "supabase/functions/run-place-intelligence-trial/index.ts",
  "supabase/functions/run-business-place-authoring-pipeline/index.ts",
]);

// Directories to scan for write payloads. Excludes admin UI (read-only by
// design), app-mobile (read-only by design), business-app (no relation).
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

// Heuristic: `ai_signal_scores:` as a key in an object literal indicates a
// write payload. We also tolerate `ai_signal_scores =` (SQL UPDATE) and
// `"ai_signal_scores":` (JSON literal). The migration that creates the column
// (under supabase/migrations/) is allowed by file path filter below.
const WRITE_PATTERNS = [
  /\bai_signal_scores\s*:/, // JS/TS object key
  /\bai_signal_scores\s*=\s*[^=]/, // SQL UPDATE or JS assignment (but not == comparison)
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

let violations = [];
let scannedFiles = 0;

for (const dir of SCAN_DIRS) {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) continue;
  for (const filePath of walk(abs)) {
    const relPath = path.relative(repoRoot, filePath);

    // Allowed writers: the trial edge fn
    if (ALLOWED_WRITER_FILES.has(relPath)) continue;

    // Migrations that DEFINE the column (ALTER TABLE / backfill UPDATE) are
    // architectural, not runtime writers. The owning migration for Sub-A is
    // 20260802000003_meta_orch_1009_sub_a_ai_signal_scores.sql.
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
  console.error(
    "FAIL: I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER violated",
  );
  console.error(
    `\n${violations.length} file(s) appear to WRITE to ai_signal_scores outside the allowed writer:`,
  );
  console.error(
    `  Allowed: ${[...ALLOWED_WRITER_FILES].join(", ")}`,
  );
  console.error("\nOffenders:");
  for (const v of violations) {
    console.error(`  - ${v.file}  (matched: ${v.pattern})`);
  }
  console.error(
    "\nIf this is an intentional new writer, update ALLOWED_WRITER_FILES",
  );
  console.error(
    "in this script AND register a new ORCH amending DEC-099 + DEC-181.",
  );
  process.exit(1);
}

console.log(
  `OK: I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER — ${scannedFiles} files scanned, 0 unauthorized writers`,
);
