#!/usr/bin/env node

/**
 * ORCH-1146 — I-PROPOSED-1146-PARSER-NO-GBP-DEFAULT
 *
 * The experience-parser path MUST resolve currency from `brand.default_currency`;
 * there is NO hardcoded "GBP" fallback in the two parsers, their two edge
 * entries, or the shared confirm executor. When the currency is truly unknown,
 * the field is left empty/omitted and the DB column default applies — never
 * forced to GBP. Aligns with `[[project_orch_1034_currency_de_gbp_scope]]`.
 *
 * Scope (the 5 files that build/persist the snapped-experience currency):
 *   - supabase/functions/_shared/geminiMenuParser.ts        (Ve5 normalizer/prompt)
 *   - supabase/functions/_shared/geminiActivitiesParser.ts  (Ve6 normalizer/prompt)
 *   - supabase/functions/parse-restaurant-menu/index.ts     (Ve5 edge entry)
 *   - supabase/functions/parse-play-activities/index.ts     (Ve6 edge entry)
 *   - supabase/functions/_shared/agentTools.ts              (create_experience executor)
 *
 * A violation = any quoted "GBP" / 'GBP' currency literal in these files.
 *
 * NOTE on agentTools.ts: that file holds ALL Ari tools, not just
 * create_experience. The de-GBP rule already covered create_brand (ORCH-1103
 * G-1) and there is no legitimate "GBP" literal anywhere in the file today, so
 * the gate scans the whole file. If a future tool ever needs a literal currency
 * for a non-currency-fallback reason, narrow the scan to the createExperience
 * slice — but a hardcoded GBP fallback is never correct (use brand currency).
 *
 * Run: node .github/scripts/strict-grep/orch-1146-no-gbp-currency-default.mjs
 * Self-test: append --self-test (asserts the gate would catch a planted GBP).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const TARGET_FILES = [
  "supabase/functions/_shared/geminiMenuParser.ts",
  "supabase/functions/_shared/geminiActivitiesParser.ts",
  "supabase/functions/parse-restaurant-menu/index.ts",
  "supabase/functions/parse-play-activities/index.ts",
  "supabase/functions/_shared/agentTools.ts",
];

// Matches a quoted GBP currency literal: "GBP" or 'GBP'.
const GBP_LITERAL = /["']GBP["']/;

// Strip the comment portion of a line so a "GBP" mentioned in an explanatory
// comment is NOT a violation — only an executable GBP literal is. Handles `//`
// line comments and `*` / `/*` block-comment bodies (the parser path uses no
// string literals containing `//`, so this is safe here).
function stripComments(line) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
    return "";
  }
  // Remove a trailing `// …` line comment (best-effort; the target files have
  // no string literals that embed `//`).
  const idx = line.indexOf("//");
  return idx >= 0 ? line.slice(0, idx) : line;
}

function scanSource(rel, source) {
  const found = [];
  source.split(/\r?\n/).forEach((line, i) => {
    const code = stripComments(line);
    if (GBP_LITERAL.test(code)) {
      found.push({ file: rel, line: i + 1, text: line.trim() });
    }
  });
  return found;
}

// ── self-test ────────────────────────────────────────────────────────────────
if (process.argv.includes("--self-test")) {
  const planted = scanSource(
    "fixture.ts",
    'const c = brand.default_currency ?? "GBP";',
  );
  if (planted.length !== 1) {
    console.error(
      "ORCH-1146 gate SELF-TEST FAILED: did not catch a planted \"GBP\" literal.",
    );
    process.exit(1);
  }
  const clean = scanSource("fixture.ts", "const c = brand.default_currency;");
  if (clean.length !== 0) {
    console.error(
      "ORCH-1146 gate SELF-TEST FAILED: false-positive on clean source.",
    );
    process.exit(1);
  }
  console.log("ORCH-1146 gate SELF-TEST OK.");
  process.exit(0);
}

// ── real scan ──────────────────────────────────────────────────────────────
const violations = [];
let filesScanned = 0;

for (const rel of TARGET_FILES) {
  const abs = path.join(repoRoot, rel);
  let source;
  try {
    source = fs.readFileSync(abs, "utf8");
  } catch (err) {
    console.error(
      `ORCH-1146 no-gbp gate ERROR: could not read ${rel}: ${err.message}`,
    );
    process.exit(2);
  }
  filesScanned++;
  violations.push(...scanSource(rel, source));
}

if (violations.length > 0) {
  console.error(
    "I-PROPOSED-1146-PARSER-NO-GBP-DEFAULT violation: hardcoded \"GBP\" currency fallback in the experience-parser path.",
  );
  console.error(
    "Fix: resolve currency from brand.default_currency; leave empty/omit when unknown (DB default applies).",
  );
  console.error("");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  console.error("");
  console.error(
    `Scanned ${filesScanned} file(s); found ${violations.length} violation(s).`,
  );
  process.exit(1);
}

console.log(
  `I-PROPOSED-1146-PARSER-NO-GBP-DEFAULT OK: scanned ${filesScanned} file(s); no hardcoded GBP currency fallback.`,
);
process.exit(0);
