#!/usr/bin/env node
/**
 * ORCH-1186-C — venue menu is DISPLAY-ONLY (no ordering/cart/checkout/payment).
 *
 * Invariant I-PROPOSED-1186-MENU-DISPLAY-ONLY (DRAFT, from META-ORCH-1186
 * charter DEC-C): the venue menu builder + the public Menu tab carry NO
 * checkout / cart / quantity / order / payment surface. Pay-for-food ordering is
 * a deferred fast-follow, explicitly OUT OF SCOPE for this leg.
 *
 * This gate FAILS the build if any of the menu surfaces re-introduces an ordering
 * token (case-insensitive, comments stripped so explanatory notes never trip it):
 *   - VenueMenuModule.tsx / MenuItemSheet.tsx / MenuCategorySheet.tsx (builder)
 *   - the MenuTab block of packages/brand-rendering/PublicBrandPage.tsx (public)
 *
 * Forbidden tokens: cart, checkout, addToOrder, "add to order", quantity,
 * PaymentSheet, ticket-checkout, Stripe, Paystack.
 *
 * Mirrors the modular gate pattern (sibling: orch-1130-no-buyer-tax-form.mjs).
 *
 * Supports `--self-test` (no repo scan; asserts the matcher catches a sample).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

// Builder files scanned IN FULL.
const builderFiles = [
  "mingla-business/src/components/venue/VenueMenuModule.tsx",
  "mingla-business/src/components/venue/MenuItemSheet.tsx",
  "mingla-business/src/components/venue/MenuCategorySheet.tsx",
];

// The shared public page: only the MenuTab block is in scope (the rest of the
// page legitimately renders buy pills for ticketed offerings).
const sharedPage = "packages/brand-rendering/PublicBrandPage.tsx";

// Forbidden ordering/payment tokens (case-insensitive).
const FORBIDDEN = [
  /\bcart\b/i,
  /\bcheckout\b/i,
  /addtoorder/i,
  /add to order/i,
  /\bquantity\b/i,
  /paymentsheet/i,
  /ticket-checkout/i,
  /\bstripe\b/i,
  /\bpaystack\b/i,
];

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// Extract the MenuTab component block (from `const MenuTab` to the next
// top-level `const ` / `function ` declaration at column 0).
const extractMenuTab = (src) => {
  const start = src.indexOf("const MenuTab");
  if (start === -1) return "";
  const rest = src.slice(start + "const MenuTab".length);
  // Find the next top-level declaration after MenuTab.
  const nextDecl = rest.search(/\n(?:const|function) [A-Za-z]/);
  return nextDecl === -1 ? rest : rest.slice(0, nextDecl);
};

const scan = (label, code, failures) => {
  const clean = stripComments(code);
  for (const re of FORBIDDEN) {
    if (re.test(clean)) {
      failures.push(
        `${label}: re-introduces a DISPLAY-ONLY-forbidden token /${re.source}/ — the venue menu has NO ordering/cart/checkout/payment surface (DEC-C; I-PROPOSED-1186-MENU-DISPLAY-ONLY).`,
      );
    }
  }
};

if (process.argv.includes("--self-test")) {
  const fails = [];
  scan("self-test", "const x = <AddToCart quantity={1} />;", fails);
  if (fails.length === 0) {
    console.error("ORCH-1186-C display-only gate self-test FAILED: matcher did not catch ordering tokens.");
    process.exit(1);
  }
  const clean = [];
  scan("self-test-clean", "const MenuTab = () => <View><Text>Margherita</Text></View>;", clean);
  if (clean.length !== 0) {
    console.error("ORCH-1186-C display-only gate self-test FAILED: matcher false-positived on clean menu code.");
    process.exit(1);
  }
  console.log("ORCH-1186-C display-only gate self-test passed.");
  process.exit(0);
}

const failures = [];

for (const rel of builderFiles) {
  const abs = join(root, rel);
  if (!existsSync(abs)) {
    failures.push(`${rel}: missing — the menu builder surface must exist (ORCH-1186-C).`);
    continue;
  }
  scan(rel, readFileSync(abs, "utf8"), failures);
}

const pageAbs = join(root, sharedPage);
if (!existsSync(pageAbs)) {
  failures.push(`${sharedPage}: missing — shared public page must exist.`);
} else {
  const menuTabBlock = extractMenuTab(readFileSync(pageAbs, "utf8"));
  if (menuTabBlock.length === 0) {
    failures.push(`${sharedPage}: MenuTab block not found — the public Menu tab must exist (ORCH-1186-C).`);
  } else {
    scan(`${sharedPage} (MenuTab block)`, menuTabBlock, failures);
  }
}

if (failures.length > 0) {
  console.error("ORCH-1186-C menu-display-only gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1186-C menu-display-only gate passed.");
