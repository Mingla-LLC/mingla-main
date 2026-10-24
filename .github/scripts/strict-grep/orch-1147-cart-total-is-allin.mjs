#!/usr/bin/env node
/**
 * ORCH-1147 — the business checkout headline "Total" is the server fee-grossed
 * all-in, NOT the bare base subtotal.
 *
 * Invariant I-PROPOSED-1147-CART-TOTAL-IS-SERVER-ALLIN (DRAFT): the three
 * mingla-business checkout payment screens (event / trip / experience) MUST
 * source the headline Total (`displayAllIn`) from the accepted server quote
 * (`quote.buyerTotalCents` + `quote.currency`), and MUST NOT bind the headline
 * directly to the bare
 * base subtotal (`totals.total` / `totals.subtotal`). The base subtotal stays
 * the per-line "Tickets" recap basis only.
 *
 * This catches the F-1/F-2 regression where the headline Total re-derived the
 * bare ticket subtotal and omitted the passed Mingla/service fee (and tax).
 *
 * The gate fails if any payment.tsx:
 *   (a) does NOT format `quote.buyerTotalCents` with `quote.currency`, OR
 *   (b) defines `displayAllIn` directly from the bare base
 *       (`displayAllIn = formatCurrency(... totals.total ...)` /
 *        `... totals.subtotal ...`) without the all-in floor path.
 *
 * Comments are stripped so the explanatory ORCH-1147 notes never trip the gate.
 * Mirrors the modular gate pattern (sibling: orch-1130-no-buyer-tax-form.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();
const failures = [];

const paymentScreens = [
  "mingla-business/app/checkout/[eventId]/payment.tsx",
  "mingla-business/app/checkout-trip/[tripEventId]/payment.tsx",
  "mingla-business/app/checkout-experience/[experienceEventId]/payment.tsx",
];

// Strip line + block comments so prose like "// ...totals.total..." never trips.
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// --- self-test fixtures (run with --self-test) ----------------------------
const SELF_TEST = process.argv.includes("--self-test");

const evaluate = (rel, rawCode) => {
  const code = stripComments(rawCode);
  const fileFailures = [];

  // [TEST-MOD-APPROVED #3872] The quote endpoint now owns the accepted all-in
  // amount and its currency. Pin that paired server result instead of the old
  // local CartContext preview floor.
  if (
    !/formatQuoteMoney\(\s*quote\.buyerTotalCents\s*,\s*quote\.currency\s*\)/.test(
      code,
    )
  ) {
    fileFailures.push(
      `${rel}: headline Total must format the accepted server quote (quote.buyerTotalCents + quote.currency). The bare base subtotal omits discounts and passed fees. I-PROPOSED-1147-CART-TOTAL-IS-SERVER-ALLIN.`,
    );
  }

  // (b) displayAllIn must NOT be defined directly off the bare base subtotal.
  // Catch e.g. `const displayAllIn = formatCurrency(totals.total, ...)` or
  // `... totals.subtotal ...` on the SAME statement.
  const badHeadline =
    /const\s+displayAllIn\s*=\s*formatCurrency\([^;]*\btotals\.(total|subtotal)\b[^;]*\)\s*;/;
  if (badHeadline.test(code)) {
    fileFailures.push(
      `${rel}: displayAllIn binds the headline directly to the bare base (totals.total/totals.subtotal). Source it from the all-in floor (allInFloorCents) instead. I-PROPOSED-1147-CART-TOTAL-IS-SERVER-ALLIN.`,
    );
  }

  return fileFailures;
};

if (SELF_TEST) {
  const GOOD = `
    const displayAllIn = quote === null
      ? "Updating…"
      : formatQuoteMoney(quote.buyerTotalCents, quote.currency);
  `;
  const BAD_BASE = `
    const displayTotalCents = totals.total;
    const displayAllIn = formatCurrency(displayTotalCents, totals.currency);
  `;
  const BAD_INLINE = `
    const displayAllIn = formatCurrency(totals.total, totals.currency);
  `;
  const goodFails = evaluate("good.tsx", GOOD);
  const badBaseFails = evaluate("bad-base.tsx", BAD_BASE);
  const badInlineFails = evaluate("bad-inline.tsx", BAD_INLINE);
  const ok =
    goodFails.length === 0 &&
    badBaseFails.length >= 1 &&
    badInlineFails.length >= 1;
  if (!ok) {
    console.error("ORCH-1147 cart-total-is-allin SELF-TEST failed:", {
      goodFails,
      badBaseFails,
      badInlineFails,
    });
    process.exit(1);
  }
  console.log("ORCH-1147 cart-total-is-allin gate self-test passed.");
  process.exit(0);
}

for (const rel of paymentScreens) {
  const abs = join(root, rel);
  if (!existsSync(abs)) {
    failures.push(`${rel}: expected checkout payment screen not found.`);
    continue;
  }
  failures.push(...evaluate(relative(root, abs), readFileSync(abs, "utf8")));
}

if (failures.length > 0) {
  console.error("ORCH-1147 cart-total-is-allin gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1147 cart-total-is-allin gate passed.");
