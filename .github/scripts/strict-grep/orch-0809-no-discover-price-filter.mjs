#!/usr/bin/env node
/**
 * ORCH-0809 strict-grep gate #1 — Discover price filter is fully removed.
 *
 * The price filter was deleted from Discover in ORCH-0809 M2 because
 * Ticketmaster's Discovery API has no price query parameter — the prior
 * client-side post-filter silently hid results with zero UX signal,
 * violating Constitution #3 (no silent failures). Reintroduction is
 * gated on a separate ORCH when Mingla Business native events (with
 * structured ticket_types.unit_price_cents pricing) are integrated
 * into Discover.
 *
 * This gate is a structural safeguard that prevents the price filter
 * from sneaking back into the Discover surface via any of five removal
 * vectors. Each check independently exits the gate non-zero.
 *
 * Five pattern checks (all must pass):
 *
 *   1. DiscoverScreen.tsx does not contain the active reference
 *      `selectedFilters.price` (comments that mention the historical
 *      removal are allowed).
 *   2. DiscoverScreen.tsx does not import or reference TIER_BY_SLUG.
 *   3. DiscoverScreen.tsx does not declare priceFilterOptions.
 *   4. DiscoverScreen.tsx does not declare a PriceFilter type alias.
 *   5. DiscoverScreen.tsx does not call the i18n key `common:tier_${...}`
 *      (the price-tier i18n cluster).
 *
 * Codified by ORCH-0809 SPEC §9 Gate 1.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const DISCOVER_PATH = join(
  REPO_ROOT,
  "app-mobile",
  "src",
  "components",
  "DiscoverScreen.tsx",
);

const failures = [];

if (!existsSync(DISCOVER_PATH)) {
  failures.push(
    "Check 0 FAIL: app-mobile/src/components/DiscoverScreen.tsx is missing",
  );
}

const src = existsSync(DISCOVER_PATH) ? readFileSync(DISCOVER_PATH, "utf8") : "";

// Strip line comments + block comments so historical-removal commentary
// referencing the deleted symbols doesn't trip the gate. The gate is
// hunting for ACTIVE code references, not documentation.
function stripComments(s) {
  // Block comments
  let out = s.replace(/\/\*[\s\S]*?\*\//g, "");
  // Line comments
  out = out.replace(/\/\/[^\n]*/g, "");
  return out;
}

const codeOnly = stripComments(src);

// Check 1 — no active selectedFilters.price reference.
if (/\bselectedFilters\.price\b/.test(codeOnly)) {
  failures.push(
    "Check 1 FAIL: DiscoverScreen.tsx references `selectedFilters.price` — price filter must be removed (ORCH-0809 SPEC §2 S-4).",
  );
}

// Check 2 — no TIER_BY_SLUG import or reference.
if (/\bTIER_BY_SLUG\b/.test(codeOnly)) {
  failures.push(
    "Check 2 FAIL: DiscoverScreen.tsx references `TIER_BY_SLUG` — price-tier mapping must be removed from Discover (ORCH-0809 SPEC §2 S-4).",
  );
}

// Check 3 — no priceFilterOptions declaration.
if (/\bpriceFilterOptions\b/.test(codeOnly)) {
  failures.push(
    "Check 3 FAIL: DiscoverScreen.tsx declares `priceFilterOptions` — price chip options must be removed (ORCH-0809 SPEC §2 S-4).",
  );
}

// Check 4 — no PriceFilter type alias.
if (/\btype\s+PriceFilter\b/.test(codeOnly)) {
  failures.push(
    "Check 4 FAIL: DiscoverScreen.tsx declares `type PriceFilter` — price filter type must be removed (ORCH-0809 SPEC §2 S-4).",
  );
}

// Check 5 — no common:tier_* i18n key call (the price-tier label cluster).
if (/common:tier_(\$\{|\w)/.test(codeOnly)) {
  failures.push(
    "Check 5 FAIL: DiscoverScreen.tsx still calls a `common:tier_*` i18n key — price-tier translation cluster must be removed (ORCH-0809 SPEC §2 S-4).",
  );
}

if (failures.length > 0) {
  console.error("ORCH-0809 Gate 1 (no-discover-price-filter) FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("ORCH-0809 Gate 1 (no-discover-price-filter) PASS — 5/5 checks.");
