#!/usr/bin/env node
/**
 * I-PROPOSED-T strict-grep gate — Stripe country from canonical 34-country allowlist only.
 *
 * Status: DRAFT — flips ACTIVE on B2a Path C V3 CLOSE.
 *
 * Gate logic:
 *   For every .ts / .tsx file in mingla-business/{app,src}/ + supabase/functions/:
 *     For each hardcoded 2-letter country-code string literal that smells like a
 *     Stripe country (matches typical key names: country, countryCode, country_code,
 *     supportedCountries, stripeCountry, etc.) — flag if the code is NOT in the
 *     canonical 34-country allowlist.
 *     Allowlist tag exemption: `// orch-strict-grep-allow stripe-country-out-of-scope — <reason>`
 *     within 5 lines above the literal.
 *
 * Per B2a Path C V3 SPEC §3 + INVARIANT_REGISTRY I-PROPOSED-T (post-DEC-122).
 *
 * RATIONALE:
 *   Stripe Connect's documented self-serve cross-border payouts are limited to US,
 *   UK, EEA, Canada, and Switzerland — see
 *   https://docs.stripe.com/connect/cross-border-payouts. Verbatim:
 *   "Stripe doesn't support self-serve cross-border payouts to countries outside
 *   the listed regions."
 *
 *   Accepting an out-of-list country would create a Stripe account that completes
 *   onboarding then fails permanently at first payout attempt. Australia +
 *   Latin America + Asia require separate Stripe platform entities (B2c/B2d/B2e
 *   future cycles); they are out of V3 scope.
 *
 * DETECTION:
 *   Lines containing `country` / `countryCode` / `country_code` / `stripeCountry`
 *   / `supportedCountries` adjacent to a 2-letter UPPERCASE string literal.
 *   The 34-country allowlist is mirrored from
 *   `supabase/functions/_shared/stripeSupportedCountries.ts` (single owner).
 *
 * EXEMPTIONS:
 *   - `_shared/stripeSupportedCountries.ts` (the canonical list itself)
 *   - Test files (`*.test.ts`, `*.test.tsx`, `__tests__/`)
 *   - Files using the allowlist tag
 *   - Country codes that are not Stripe-related (e.g., `language: "EN"`,
 *     `locale: "GB"`) — heuristic: only flag when within 3 chars of a country-key
 *     identifier
 *
 * Exit codes:
 *   0 — no violations
 *   1 — at least one violation
 *   2 — script error
 *
 * Established by: B2a Path C V3 SPEC + DEC-122 [confirmed at CLOSE].
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

const ALLOWLIST_TAG = "orch-strict-grep-allow stripe-country-out-of-scope";

// Mirror of _shared/stripeSupportedCountries.ts — must stay in sync.
// 34 countries: US/UK/CA/CH + 30 EEA per V3 SPEC DEC-122.
const ALLOWED_COUNTRIES = new Set([
  "US", "GB", "CA", "CH",
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR",
  "GR", "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MT",
  "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK",
]);

// Lines that contain a country-key identifier within 30 characters of a
// 2-letter UPPERCASE quoted literal. Captures the literal in group 1.
const COUNTRY_KEY_REGEX =
  /\b(?:country|countryCode|country_code|stripeCountry|supportedCountries|allowedCountries|supportedCountry)\b[^"'\n]{0,30}["']([A-Z]{2})["']/;

const EXEMPT_FILE_PATTERNS = [
  /\/_shared\/stripeSupportedCountries\.ts$/,
  /\/constants\/stripeSupportedCountries\.ts$/,
  /\.test\.ts$/,
  /\.test\.tsx$/,
  /\/__tests__\//,
];

let violations = 0;
let filesScanned = 0;
let readFailures = 0;

function isExemptFile(filePath) {
  return EXEMPT_FILE_PATTERNS.some((p) => p.test(filePath));
}

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
      (entry.endsWith(".ts") || entry.endsWith(".tsx"))
    ) {
      yield full;
    }
  }
}

function reportViolation(filePath, lineNumber, lineText, countryCode) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  console.error(`ERROR: I-PROPOSED-T violation in ${rel}:${lineNumber}`);
  console.error(`  ${lineText.trim()}`);
  console.error(
    `  Country code "${countryCode}" is NOT in the canonical 34-country Stripe allowlist.`,
  );
  console.error(
    `  Stripe self-serve cross-border payouts are restricted to US/UK/CA/CH + 30 EEA states.`,
  );
  console.error(
    `  Allowed: ${[...ALLOWED_COUNTRIES].sort().join(", ")}`,
  );
  console.error(
    `  Allowlist (rare): // orch-strict-grep-allow stripe-country-out-of-scope — <reason>`,
  );
  console.error(
    `  Canonical list: supabase/functions/_shared/stripeSupportedCountries.ts`,
  );
  console.error(
    `  See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-PROPOSED-T`,
  );
  console.error("");
  violations += 1;
}

function scanFile(filePath) {
  filesScanned += 1;
  if (isExemptFile(filePath)) return;

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
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(COUNTRY_KEY_REGEX);
    if (!m) continue;

    const countryCode = m[1];
    if (ALLOWED_COUNTRIES.has(countryCode)) continue;

    // Skip type-only / comment / import lines
    const trimmed = line.trim();
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("import ") ||
      trimmed.startsWith("export type ")
    ) {
      continue;
    }

    // Allowlist within 5 lines above
    const allowStart = Math.max(0, i - 5);
    const allowContext = lines.slice(allowStart, i).join("\n");
    if (allowContext.includes(ALLOWLIST_TAG)) continue;

    reportViolation(filePath, i + 1, line, countryCode);
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
  `I-PROPOSED-T gate: scanned ${filesScanned} files · ${violations} violations · ${readFailures} read failures`,
);

if (readFailures > 0 && filesScanned === readFailures) {
  process.exit(2);
}
if (violations > 0) {
  process.exit(1);
}
process.exit(0);
