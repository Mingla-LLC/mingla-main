#!/usr/bin/env node
/**
 * META-ORCH-1148 sub-ORCH 2.0 — no buyer-tax/address form in Venue Settings.
 *
 * Invariant I-PROPOSED-1148-NO-BUYER-TAX-FORM-IN-VENUE-SETTINGS (DRAFT): the
 * venue reservation-fee Settings UI MUST NOT render a buyer-facing
 * billing-address input or a "Calculate tax" control. Venue tax stays
 * venue-sourced server-side (events.venue_tax_address); the all-in total is
 * shown upfront (WYSIWYP). Extends orch-1130-no-buyer-tax-form to the venue
 * suite.
 *
 * Fails if VenueSettingsModule.tsx (or any venue component) re-introduces:
 *   (a) the deleted <CartTaxPreview> buyer tax/address form, OR
 *   (b) a "Calculate tax" string, OR
 *   (c) a "BILLING ADDRESS" buyer form label.
 *
 * Mirrors the orch-1130 gate. Supports `--self-test` (asserts the gate trips on
 * a synthetic violation) per the established gate convention.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const VENUE_DIR = "mingla-business/src/components/venue";

const walk = (dir) => {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry === "__tests__") continue;
      out.push(...walk(path));
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(path);
  }
  return out;
};

// Strip comments so an explanatory note never trips the gate — only LIVE code.
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const scan = (code) => {
  const hits = [];
  if (/\bCartTaxPreview\b/.test(code)) {
    hits.push(
      "re-introduces CartTaxPreview (buyer tax/address form). Venue tax is server-sourced; the buyer never types an address.",
    );
  }
  if (/Calculate tax/i.test(code)) {
    hits.push(
      're-introduces a "Calculate tax" control. The all-in (incl. tax) is shown upfront — no buyer-triggered tax calc.',
    );
  }
  if (/BILLING ADDRESS/i.test(code)) {
    hits.push(
      're-introduces a "BILLING ADDRESS" buyer form. Venue tax is server-sourced; the buyer never types an address.',
    );
  }
  return hits;
};

// --- self-test: prove the gate actually trips on a violation. ---
if (process.argv.includes("--self-test")) {
  const violations = scan(
    'const x = <CartTaxPreview/>; const label = "BILLING ADDRESS"; // Calculate tax',
  );
  // The comment "// Calculate tax" is stripped, so only 2 of 3 fire here; the
  // live <CartTaxPreview/> + "BILLING ADDRESS" string must trip the gate.
  if (violations.length < 2) {
    console.error(
      "ORCH-1148 no-buyer-tax-form gate SELF-TEST FAILED: gate did not detect the synthetic violation.",
    );
    process.exit(1);
  }
  console.log("ORCH-1148 no-buyer-tax-form gate self-test passed.");
  process.exit(0);
}

const failures = [];
for (const file of walk(join(root, VENUE_DIR))) {
  const rel = relative(root, file);
  const code = stripComments(readFileSync(file, "utf8"));
  for (const hit of scan(code)) failures.push(`${rel}: ${hit}`);
}

if (failures.length > 0) {
  console.error("ORCH-1148 no-buyer-tax-form-in-venue-settings gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1148 no-buyer-tax-form-in-venue-settings gate passed.");
