#!/usr/bin/env node
/**
 * ORCH-1130 Fix #2 — no buyer-facing tax/address form on checkout payment.
 *
 * Invariant I-PROPOSED-1130-NO-BUYER-TAX-FORM (DRAFT): the mingla-business
 * native checkout payment screens (event / trip / experience) MUST NOT render
 * a buyer-facing billing-address form or a "Calculate tax" control. Tax is
 * venue-sourced server-side (events.venue_tax_address) and the all-in total
 * (incl. tax) is shown upfront (MINGLA-WIDE all-in / WYSIWYP — ORCH-1025/1006).
 *
 * The form lived in the now-DELETED shared component
 * src/components/checkout/CartTaxPreview.tsx. This gate fails if:
 *   (a) any checkout payment screen re-imports / renders <CartTaxPreview>, OR
 *   (b) CartTaxPreview.tsx is re-created, OR
 *   (c) a checkout payment screen re-introduces a buyer-facing
 *       "Calculate tax" / "BILLING ADDRESS" string (the old form's labels).
 *
 * Mirrors the modular gate pattern (sibling: orch-0964-checkout-no-brand-theme.mjs).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();
const failures = [];

// The three native checkout payment screens (event / trip / experience).
const paymentScreenRoots = [
  "mingla-business/app/checkout",
  "mingla-business/app/checkout-trip",
  "mingla-business/app/checkout-experience",
];

const walk = (dir) => {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(path);
  }
  return out;
};

// Strip line + block comments so an explanatory "// ...CartTaxPreview..." note
// (e.g. the ORCH-1130 removal markers) never trips the gate — only LIVE code
// references fail.
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// (a)+(c) — scan the payment screens for live re-introductions.
for (const relRoot of paymentScreenRoots) {
  for (const file of walk(join(root, relRoot))) {
    // Only the payment.tsx screens carry the Pay flow + the old form.
    if (!/payment\.(tsx|ts|jsx|js)$/.test(file)) continue;
    const rel = relative(root, file);
    const code = stripComments(readFileSync(file, "utf8"));

    if (/\bCartTaxPreview\b/.test(code)) {
      failures.push(
        `${rel}: re-introduces CartTaxPreview (buyer-facing tax/address form). Tax is venue-sourced server-side; the buyer never types an address.`,
      );
    }
    if (/Calculate tax/i.test(code)) {
      failures.push(
        `${rel}: re-introduces a "Calculate tax" control. The all-in (incl. tax) is shown upfront — no buyer-triggered tax calc.`,
      );
    }
    if (/BILLING ADDRESS/i.test(code)) {
      failures.push(
        `${rel}: re-introduces a "BILLING ADDRESS" buyer form. Tax is venue-sourced; the buyer never types an address.`,
      );
    }
  }
}

// (b) — the dead component must stay deleted.
const deadComponent = join(
  root,
  "mingla-business/src/components/checkout/CartTaxPreview.tsx",
);
if (existsSync(deadComponent)) {
  failures.push(
    "mingla-business/src/components/checkout/CartTaxPreview.tsx: deleted by ORCH-1130 (buyer billing-address / Calculate-tax form). Do not re-create — tax is venue-sourced server-side.",
  );
}

if (failures.length > 0) {
  console.error("ORCH-1130 no-buyer-tax-form gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1130 no-buyer-tax-form gate passed.");
