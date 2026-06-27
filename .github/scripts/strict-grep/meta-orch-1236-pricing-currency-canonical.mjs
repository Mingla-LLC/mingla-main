#!/usr/bin/env node
/**
 * META-ORCH-1236 strict-grep gate —
 * I-PROPOSED-1236-PRICING-CURRENCY-TRACKS-DEFAULT (DRAFT until CLOSE).
 *
 * Gate logic:
 *   For every .ts / .tsx / .mjs file in mingla-business/src/ +
 *   mingla-business/app/ + mingla-admin/src/ + supabase/functions/ :
 *     If a line writes brands.pricing_currency / brands.pricing_region via the
 *     Supabase JS client `.update({...})` / `.upsert({...})` / `.insert({...})`
 *     chained on `.from("brands")`, OR via a raw SQL `UPDATE brands SET ...` /
 *     `INSERT INTO brands ...` against those fields → VIOLATION (exit 1)
 *     UNLESS an allowlist comment one line above:
 *       // orch-strict-grep-allow brands-pricing-currency-direct-write — <reason>
 *
 * RATIONALE:
 *   brands.pricing_currency is the AUTHORITATIVE charge currency
 *   (resolve_event_pricing_inputs -> b.pricing_currency feeds the web Checkout
 *   Session and the native PaymentIntent). brands.pricing_currency /
 *   brands.pricing_region are DERIVED from brands.default_currency ONLY by DB
 *   trigger (tg_sync_brand_stripe_cache on the Stripe path +
 *   tg_brands_derive_pricing_from_default on the brand-direct path). Any app/edge
 *   write produces drift between charge currency and settlement currency — the
 *   exact ORCH-1236 bug that charged a USD brand in GBP. Constitution #2 (one
 *   owner per truth) + #10 (currency-aware).
 *
 * SCOPE NOTE:
 *   SQL MIGRATIONS are EXEMPT (the trigger functions themselves legitimately set
 *   these columns; migration files are not in SCAN_DIRS). This gate targets only
 *   app + edge code.
 *
 * Modes:
 *   (default)    scan the real tree; exit 1 on any violation.
 *   --self-test  prove the gate FLAGS a known-bad fixture AND PASSES a known-good
 *                fixture (in-memory; no tree writes). Exit 0 only if both hold.
 *
 * Exit codes:
 *   0 — clean / self-test passed
 *   1 — at least one violation / self-test failed
 *   2 — script error
 *
 * Established by: META-ORCH-1236 SPEC §9 (DRAFT until CLOSE).
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
  join(REPO_ROOT, "mingla-admin", "src"),
  join(REPO_ROOT, "supabase", "functions"),
];

const ALLOWLIST_TAG = "orch-strict-grep-allow brands-pricing-currency-direct-write";

// The two derived charge-currency columns. These names are unique to the brands
// table — any reference inside an update/insert payload is suspect.
const PRICING_FIELDS = /\b(pricing_currency|pricing_region)\b/;

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

/**
 * Scan one source string. Returns an array of { line, text } violations.
 * Pure (no I/O) so the self-test can drive it on in-memory fixtures.
 */
function findViolations(source) {
  const out = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!PRICING_FIELDS.test(line)) continue;

    const trimmed = line.trim();
    // Skip comments / imports / type-only references / pure reads.
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
    // Skip type-shape declarations like `pricing_currency: string | null;`
    // (read-only schema mapping, not a write payload).
    if (/:\s*(string|boolean|number)\s*(\|\s*null\s*)?;/.test(line)) continue;
    // Skip `.select("...pricing_currency...")` reads.
    if (/\.select\s*\(/.test(line)) continue;

    // Window for write-context detection.
    const start = Math.max(0, i - 5);
    const end = Math.min(lines.length, i + 6);
    const context = lines.slice(start, end).join("\n");

    const isJsWriteContext =
      /\.update\s*\(|\.upsert\s*\(|\.insert\s*\(/.test(context) &&
      /\.from\s*\(\s*["']brands["']\s*\)/.test(context);

    const isSqlWriteContext =
      /UPDATE\s+(?:public\.)?brands\s+SET|INSERT\s+INTO\s+(?:public\.)?brands/i.test(
        context,
      );

    if (!isJsWriteContext && !isSqlWriteContext) continue;

    // Allowlist comment immediately above.
    if (i > 0 && lines[i - 1].includes(ALLOWLIST_TAG)) continue;

    out.push({ line: i + 1, text: line });
  }
  return out;
}

function reportViolation(filePath, lineNumber, lineText) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  console.error(
    `ERROR: I-PROPOSED-1236-PRICING-CURRENCY-TRACKS-DEFAULT violation in ${rel}:${lineNumber}`,
  );
  console.error(`  ${lineText.trim()}`);
  console.error(
    `  brands.pricing_currency / pricing_region are DERIVED from default_currency`,
  );
  console.error(
    `  by DB trigger ONLY (tg_sync_brand_stripe_cache + tg_brands_derive_pricing_from_default).`,
  );
  console.error(
    `  Direct app/edge writes drift the CHARGE currency from the settlement currency`,
  );
  console.error(
    `  (the META-ORCH-1236 bug: a USD brand charged in GBP). Constitutional #2 / #10.`,
  );
  console.error(
    `  Fix: write brands.default_currency (or stripe_connect_accounts) — the trigger derives the rest.`,
  );
  console.error(
    `  Allowlist: add // ${ALLOWLIST_TAG} — <reason> immediately above the line.`,
  );
  console.error(
    `  See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-PROPOSED-1236-PRICING-CURRENCY-TRACKS-DEFAULT`,
  );
  console.error("");
}

// ── --self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  const BAD = [
    'const x = await supabase',
    '  .from("brands")',
    '  .update({ pricing_currency: "GBP", updated_at: now })',
    '  .eq("id", brandId);',
  ].join("\n");

  const BAD_SQL = [
    "await supabase.rpc(`",
    "  UPDATE public.brands SET pricing_region = 'GB' WHERE id = $1`);",
  ].join("\n");

  const GOOD_READ = [
    'const { data } = await supabase',
    '  .from("brands")',
    '  .select("default_currency, pricing_currency")',
    '  .eq("id", brandId);',
  ].join("\n");

  const GOOD_TYPE = [
    "interface BrandPricingRow {",
    "  pricing_currency: string | null;",
    "  pricing_region: string | null;",
    "}",
  ].join("\n");

  const GOOD_ALLOWLISTED = [
    "// orch-strict-grep-allow brands-pricing-currency-direct-write — test fixture seed only",
    '  .from("brands").update({ pricing_currency: "USD" })',
  ].join("\n");

  const GOOD_OTHER_TABLE = [
    'await supabase.from("venue_reservation_settings")',
    '  .update({ pricing_currency: "USD" });', // not brands -> not flagged
  ].join("\n");

  let ok = true;

  const badHits = findViolations(BAD);
  if (badHits.length !== 1) {
    console.error(
      `SELF-TEST FAIL: BAD .from("brands").update pricing_currency should flag 1 line, got ${badHits.length}`,
    );
    ok = false;
  }

  const badSqlHits = findViolations(BAD_SQL);
  if (badSqlHits.length !== 1) {
    console.error(
      `SELF-TEST FAIL: BAD raw UPDATE brands SET pricing_region should flag 1 line, got ${badSqlHits.length}`,
    );
    ok = false;
  }

  for (const [name, src] of [
    ["GOOD_READ (select)", GOOD_READ],
    ["GOOD_TYPE (interface)", GOOD_TYPE],
    ["GOOD_ALLOWLISTED", GOOD_ALLOWLISTED],
    ["GOOD_OTHER_TABLE", GOOD_OTHER_TABLE],
  ]) {
    const hits = findViolations(src);
    if (hits.length !== 0) {
      console.error(
        `SELF-TEST FAIL: ${name} should flag 0 lines, got ${hits.length}`,
      );
      ok = false;
    }
  }

  if (ok) {
    console.error(
      "META-ORCH-1236 gate self-test: PASS (flags direct brands.pricing_currency/region writes; ignores reads, types, allowlisted, and other tables)",
    );
    process.exit(0);
  }
  process.exit(1);
}

// ── main ─────────────────────────────────────────────────────────────────────
if (process.argv.includes("--self-test")) {
  selfTest();
}

let violations = 0;
let filesScanned = 0;
let readFailures = 0;

try {
  for (const dir of SCAN_DIRS) {
    for (const file of walkTsTsx(dir)) {
      filesScanned += 1;
      let source;
      try {
        source = readFileSync(file, "utf8");
      } catch (err) {
        const rel = relative(REPO_ROOT, file).split(sep).join("/");
        console.error(`READ-FAIL: ${rel} — ${err.message}`);
        readFailures += 1;
        continue;
      }
      for (const v of findViolations(source)) {
        reportViolation(file, v.line, v.text);
        violations += 1;
      }
    }
  }
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  process.exit(2);
}

console.error("");
console.error(
  `META-ORCH-1236 pricing-currency-canonical gate: scanned ${filesScanned} files · ${violations} violations · ${readFailures} read failures`,
);

if (readFailures > 0 && filesScanned === readFailures) {
  process.exit(2);
}
if (violations > 0) {
  process.exit(1);
}
process.exit(0);
