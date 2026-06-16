#!/usr/bin/env node
/**
 * ORCH-1147 — the buyer-web hosted Stripe Checkout Session bills the fee-grossed
 * pre-tax subtotal, not the bare base.
 *
 * Invariant I-PROPOSED-1147-WEB-CHARGE-BILLS-FEE-GROSSED-SUBTOTAL (DRAFT): in
 * `supabase/functions/ticket-checkout-create/index.ts`, the web/mobile-web
 * `checkout.sessions.create` line item `price_data.unit_amount` MUST be
 * `buyerSubtotal.buyerSubtotalCents` (base + passed Mingla fee + passed service
 * fee, PRE-TAX), so the web charge equals the native fee gross-up. The session
 * has `automatic_tax: { enabled: true }` — Stripe adds tax ON TOP, so billing
 * the bare base `totalCents` (D-1) under-charges the passed fee, and billing the
 * tax-inclusive `buyer_total_cents` would DOUBLE-tax.
 *
 * The gate fails if the web Checkout line item reverts to `unit_amount: totalCents`
 * or `unit_amount: ...buyer_total_cents`, or if the fee-grossed binding is gone.
 *
 * Comment-anchored fails-on-revert: comments are stripped so the explanatory
 * ORCH-1147 note never satisfies (or trips) the gate — only LIVE code counts.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();
const failures = [];

const target = "supabase/functions/ticket-checkout-create/index.ts";

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const SELF_TEST = process.argv.includes("--self-test");

// Evaluate the `line_items: [ { price_data: { ... unit_amount: X ... } } ]`
// block of the web Checkout Session. We isolate the price_data object that sits
// inside a `checkout.sessions.create`/`line_items` region.
const evaluate = (rel, rawCode) => {
  const code = stripComments(rawCode);
  const fileFailures = [];

  // Find the web Checkout Session line-item unit_amount. The web branch is the
  // ONLY place that builds `line_items: [{ price_data: { ... unit_amount: ... }}]`.
  const lineItemMatch = code.match(
    /line_items\s*:\s*\[\s*\{\s*price_data\s*:\s*\{[\s\S]*?unit_amount\s*:\s*([A-Za-z0-9_.]+)/,
  );

  if (lineItemMatch === null) {
    fileFailures.push(
      `${rel}: could not locate the web Checkout Session line_items[].price_data.unit_amount. The web charge binding must stay greppable. I-PROPOSED-1147-WEB-CHARGE-BILLS-FEE-GROSSED-SUBTOTAL.`,
    );
    return fileFailures;
  }

  const unitAmount = lineItemMatch[1];
  if (unitAmount !== "buyerSubtotal.buyerSubtotalCents") {
    fileFailures.push(
      `${rel}: web Checkout Session bills \`unit_amount: ${unitAmount}\` — it MUST bill \`buyerSubtotal.buyerSubtotalCents\` (fee-grossed PRE-TAX subtotal). Billing the bare base (totalCents) under-charges the passed fee (D-1); billing buyer_total_cents double-taxes (automatic_tax is on). I-PROPOSED-1147-WEB-CHARGE-BILLS-FEE-GROSSED-SUBTOTAL.`,
    );
  }

  return fileFailures;
};

if (SELF_TEST) {
  const GOOD = `
    checkoutSession = await stripeWeb.checkout.sessions.create({
      mode: "payment",
      line_items: [ { price_data: { currency, unit_amount: buyerSubtotal.buyerSubtotalCents, product_data: { name } }, quantity: 1 } ],
      automatic_tax: { enabled: true },
    });
  `;
  const BAD_BASE = `
    line_items: [ { price_data: { currency, unit_amount: totalCents, product_data: { name } }, quantity: 1 } ],
  `;
  const BAD_TOTAL = `
    line_items: [ { price_data: { currency, unit_amount: pricingBreakdown.buyer_total_cents }, quantity: 1 } ],
  `;
  const goodFails = evaluate("good.ts", GOOD);
  const badBaseFails = evaluate("bad-base.ts", BAD_BASE);
  const badTotalFails = evaluate("bad-total.ts", BAD_TOTAL);
  const ok =
    goodFails.length === 0 &&
    badBaseFails.length >= 1 &&
    badTotalFails.length >= 1;
  if (!ok) {
    console.error("ORCH-1147 web-charge-allin SELF-TEST failed:", {
      goodFails,
      badBaseFails,
      badTotalFails,
    });
    process.exit(1);
  }
  console.log("ORCH-1147 web-charge-allin gate self-test passed.");
  process.exit(0);
}

const abs = join(root, target);
if (!existsSync(abs)) {
  failures.push(`${target}: ticket-checkout-create edge function not found.`);
} else {
  failures.push(...evaluate(relative(root, abs), readFileSync(abs, "utf8")));
}

if (failures.length > 0) {
  console.error("ORCH-1147 web-charge-allin gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1147 web-charge-allin gate passed.");
