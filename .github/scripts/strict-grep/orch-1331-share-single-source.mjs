#!/usr/bin/env node
/**
 * ORCH-1331 — I-PROPOSED-1331-PARTNER-SHARE-FROM-PLATFORM-FEE (DRAFT until CLOSE).
 *
 * Rule: the partner share is computed ONLY from Mingla's persisted platform fee
 * and the share rate has EXACTLY ONE source — `PARTNER_SHARE_OF_FEE` in
 * _shared/partnerSplits.ts. Two guarded surfaces:
 *
 *   A. supabase/functions/_shared/paystackPartnerSplits.ts must
 *      (1) import PARTNER_SHARE_OF_FEE from ./partnerSplits.ts,
 *      (2) compute the share via Math.round(<fee> * PARTNER_SHARE_OF_FEE),
 *      (3) contain NO bare numeric share literal (0.1 / 0.10 / .1) — a
 *          duplicated rate is exactly the drift this invariant kills.
 *
 *   B. supabase/functions/ticket-checkout-create/index.ts (the LIVE NGN
 *      checkout, DO-NOT-TOUCH) must NOT gain a Paystack `split` / `split_code`
 *      initialize param — Option-A charge-time-split creep would rewrite the
 *      live money path (SPEC §4.1 rejected it by construction).
 *
 * Reverting the import to a literal, or adding a split param to the checkout
 * initialize body, = RED.
 *
 * Mirrors the modular self-testing gate pattern (sibling:
 * orch-1331-partner-split-fail-soft.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ENGINE = "supabase/functions/_shared/paystackPartnerSplits.ts";
const CHECKOUT = "supabase/functions/ticket-checkout-create/index.ts";

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const evaluateEngine = (rawCode) => {
  const code = stripComments(rawCode);
  const failures = [];

  if (
    !/import\s*\{[^}]*\bPARTNER_SHARE_OF_FEE\b[^}]*\}\s*from\s*["']\.\/partnerSplits\.ts["']/
      .test(code)
  ) {
    failures.push(
      `${ENGINE}: PARTNER_SHARE_OF_FEE is not imported from ./partnerSplits.ts — the share rate must have ONE source. I-PROPOSED-1331-PARTNER-SHARE-FROM-PLATFORM-FEE.`,
    );
  }
  if (!/Math\.round\s*\(\s*\w+\s*\*\s*PARTNER_SHARE_OF_FEE\s*\)/.test(code)) {
    failures.push(
      `${ENGINE}: share is not computed as Math.round(<fee> * PARTNER_SHARE_OF_FEE) — rate/rounding drift from the Stripe rail. I-PROPOSED-1331-PARTNER-SHARE-FROM-PLATFORM-FEE.`,
    );
  }
  // No bare numeric share literal — 0.1 / 0.10 / .1 (not part of a wider
  // number like 0.15 or 10.1).
  if (/(?<![\d.])(?:0?\.10?)(?![\d])/.test(code)) {
    failures.push(
      `${ENGINE}: a bare 0.1/0.10 share literal appears — use the PARTNER_SHARE_OF_FEE import (single source). I-PROPOSED-1331-PARTNER-SHARE-FROM-PLATFORM-FEE.`,
    );
  }
  return failures;
};

const evaluateCheckout = (rawCode) => {
  const code = stripComments(rawCode);
  const failures = [];
  // Option-A creep detectors: a dynamic split object / split_code on the
  // Paystack initialize body. `.split(` string method calls are NOT matched.
  if (/\bsplit_code\b/.test(code)) {
    failures.push(
      `${CHECKOUT}: split_code appeared in the LIVE checkout — Option-A charge-time split creep (SPEC §4.1 rejected). I-PROPOSED-1331-PARTNER-SHARE-FROM-PLATFORM-FEE.`,
    );
  }
  if (/\bsplit\s*:/.test(code) || /\bbody\.split\s*=/.test(code)) {
    failures.push(
      `${CHECKOUT}: a \`split:\` param appeared in the LIVE checkout initialize body — Option-A charge-time split creep (SPEC §4.1 rejected). I-PROPOSED-1331-PARTNER-SHARE-FROM-PLATFORM-FEE.`,
    );
  }
  return failures;
};

const SELF_TEST = process.argv.includes("--self-test");
if (SELF_TEST) {
  const GOOD_ENGINE = `
    import { PARTNER_SHARE_OF_FEE } from "./partnerSplits.ts";
    const partnerShareKobo = Math.round(minglaFeeKobo * PARTNER_SHARE_OF_FEE);
  `;
  // BAD-1 — literal rate instead of the import.
  const BAD_LITERAL = `
    import { PARTNER_SHARE_OF_FEE } from "./partnerSplits.ts";
    const partnerShareKobo = Math.round(minglaFeeKobo * PARTNER_SHARE_OF_FEE);
    const fallback = Math.round(minglaFeeKobo * 0.10);
  `;
  // BAD-2 — import dropped, floor + literal.
  const BAD_NO_IMPORT = `
    const partnerShareKobo = Math.floor(minglaFeeKobo * 0.1);
  `;
  const GOOD_CHECKOUT = `
    const body = { email, amount, currency: "NGN" };
    if (params.subaccount) body.subaccount = params.subaccount;
    body.transaction_charge = psApplicationFeeCents;
    const parts = reference.split("-");
  `;
  // BAD-3 — Option-A split object creep.
  const BAD_SPLIT_OBJECT = `
    const body = { email, amount, split: { type: "flat", subaccounts: [] } };
  `;
  // BAD-4 — split_code creep.
  const BAD_SPLIT_CODE = `
    const body = { email, amount, split_code: "SPL_x" };
  `;
  const g1 = evaluateEngine(GOOD_ENGINE);
  const b1 = evaluateEngine(BAD_LITERAL);
  const b2 = evaluateEngine(BAD_NO_IMPORT);
  const g2 = evaluateCheckout(GOOD_CHECKOUT);
  const b3 = evaluateCheckout(BAD_SPLIT_OBJECT);
  const b4 = evaluateCheckout(BAD_SPLIT_CODE);
  const ok = g1.length === 0 && g2.length === 0 && b1.length >= 1 &&
    b2.length >= 1 && b3.length >= 1 && b4.length >= 1;
  if (!ok) {
    console.error("ORCH-1331 share-single-source SELF-TEST failed:", {
      g1,
      g2,
      b1,
      b2,
      b3,
      b4,
    });
    process.exit(1);
  }
  console.log("ORCH-1331 share-single-source gate self-test passed (4/4 BAD shapes rejected).");
  process.exit(0);
}

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();
const failures = [];
const engineAbs = join(root, ENGINE);
if (!existsSync(engineAbs)) failures.push(`${ENGINE}: not found.`);
else failures.push(...evaluateEngine(readFileSync(engineAbs, "utf8")));
const checkoutAbs = join(root, CHECKOUT);
if (!existsSync(checkoutAbs)) failures.push(`${CHECKOUT}: not found.`);
else failures.push(...evaluateCheckout(readFileSync(checkoutAbs, "utf8")));

if (failures.length > 0) {
  console.error("ORCH-1331 share-single-source gate FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("ORCH-1331 share-single-source gate passed.");
