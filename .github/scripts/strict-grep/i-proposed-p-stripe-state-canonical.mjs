#!/usr/bin/env node
/**
 * I-PROPOSED-P strict-grep gate — Stripe state canonical is stripe_connect_accounts.
 *
 * Gate logic:
 *   For every .ts / .tsx file in mingla-business/src/ + mingla-business/app/ +
 *   supabase/functions/:
 *     If line writes brands.stripe_connect_id / stripe_charges_enabled / stripe_payouts_enabled
 *     via Supabase JS client `.update({ ... })` chained on `.from("brands")`
 *     OR direct insert payload sets these fields → VIOLATION (exit 1)
 *     Unless allowlist comment one line above:
 *       // orch-strict-grep-allow brands-stripe-direct-write — <reason>
 *
 * Per B2a SPEC §8.2 + INVARIANT_REGISTRY I-PROPOSED-P.
 *
 * RATIONALE:
 *   stripe_connect_accounts is the SINGLE canonical source of truth for Connect
 *   state. brands.stripe_charges_enabled, brands.stripe_payouts_enabled, and
 *   brands.stripe_connect_id are denormalized cache columns mirrored ONLY by
 *   the DB trigger tg_sync_brand_stripe_cache (per D-B2-3).
 *
 *   Direct app-code writes to these columns produce drift between cache and
 *   canonical state — a Constitutional #2 violation.
 *
 * EXEMPTIONS:
 *   - The trigger function itself in the SQL migration (file isn't in scan dirs)
 *   - Test fixtures + IMPL pre-flight setup (use allowlist comment)
 *   - mapBrandRowToUi reads (READ, not write — won't match the regex)
 *
 * Exit codes:
 *   0 — no violations (clean)
 *   1 — at least one violation
 *   2 — script error
 *
 * Established by: B2a SPEC + DEC-114 + DEC-115 [confirmed at CLOSE].
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const SCAN_DIRS = [
  join(REPO_ROOT, "mingla-business", "app"),
  join(REPO_ROOT, "mingla-business", "src"),
  join(REPO_ROOT, "supabase", "functions"),
];

const ALLOWLIST_TAG = "orch-strict-grep-allow brands-stripe-direct-write";

// Detect mention of the cache field names in app/edge code. These names are
// unique to the brands table — any reference in update/insert payload is suspect.
const STRIPE_CACHE_FIELDS = /\bstripe_(connect_id|charges_enabled|payouts_enabled)\b/;

let violations = 0;
let filesScanned = 0;
let readFailures = 0;

function* walkTsTsx(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".git" || entry === ".expo") {
        continue;
      }
      yield* walkTsTsx(full);
    } else if (
      st.isFile() &&
      (entry.endsWith(".ts") ||
        entry.endsWith(".tsx") ||
        entry.endsWith(".mjs"))
    ) {
      yield full;
    }
  }
}

function reportViolation(filePath, lineNumber, lineText) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  console.error(`ERROR: I-PROPOSED-P violation in ${rel}:${lineNumber}`);
  console.error(`  ${lineText.trim()}`);
  console.error(
    `  brands.stripe_* are denormalized cache mirrored ONLY by DB trigger.`,
  );
  console.error(
    `  Direct writes from app/edge code violate Constitutional #2 (one owner per truth).`,
  );
  console.error(
    `  Fix: write to stripe_connect_accounts; trigger tg_sync_brand_stripe_cache mirrors.`,
  );
  console.error(
    `  Allowlist: add // orch-strict-grep-allow brands-stripe-direct-write — <reason>`,
  );
  console.error(`             immediately above the line.`);
  console.error(
    `  See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-PROPOSED-P`,
  );
  console.error("");
  violations += 1;
}

function scanFile(filePath) {
  filesScanned += 1;
  let source;
  try {
    source = readFileSync(filePath, "utf8");
  } catch (err) {
    const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
    console.error(`READ-FAIL: ${rel} — ${err.message}`);
    readFailures += 1;
    return;
  }

  const lines = source.split("\n");
  // Only flag lines inside an obvious write context. Look for the field name
  // along with assignment-style markers: `key: value` (object literal), or
  // `update(`/`insert(` etc. on nearby lines.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!STRIPE_CACHE_FIELDS.test(line)) continue;

    // Skip comment lines + import lines + type-only references
    const trimmed = line.trim();
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("import ") ||
      trimmed.startsWith("export ") ||
      trimmed.startsWith("type ") ||
      trimmed.startsWith("interface ")
    ) {
      continue;
    }

    // Skip lines in BrandRow type def (read-only schema mapping)
    if (line.includes(": boolean") || line.includes(": string | null")) continue;

    // Look at +/- 5 lines for context indicating a write
    const start = Math.max(0, i - 5);
    const end = Math.min(lines.length, i + 6);
    const context = lines.slice(start, end).join("\n");

    const isWriteContext =
      /\.update\s*\(|\.upsert\s*\(|\.insert\s*\(/.test(context) &&
      // and references brands table
      /\.from\s*\(\s*["']brands["']\s*\)/.test(context);

    // Also catch SQL UPDATE/INSERT against brands
    const isSqlWriteContext =
      /UPDATE\s+(?:public\.)?brands\s+SET|INSERT\s+INTO\s+(?:public\.)?brands/i.test(
        context,
      );

    if (!isWriteContext && !isSqlWriteContext) continue;

    // Allowlist: line above contains the tag
    if (i > 0 && lines[i - 1].includes(ALLOWLIST_TAG)) continue;

    reportViolation(filePath, i + 1, line);
  }
}

try {
  for (const dir of SCAN_DIRS) {
    for (const file of walkTsTsx(dir)) {
      scanFile(file);
    }
  }
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  process.exit(2);
}

console.error("");
console.error(
  `I-PROPOSED-P gate: scanned ${filesScanned} files · ${violations} violations · ${readFailures} read failures`,
);

if (readFailures > 0 && filesScanned === readFailures) {
  process.exit(2);
}
if (violations > 0) {
  process.exit(1);
}
process.exit(0);
