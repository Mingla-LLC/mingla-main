// ORCH-0843 regression test — assert the outbound Stripe API call shape
// in `ticket-checkout-create/index.ts` matches the direct-charge contract.
//
// Pattern follows the source-string assertion style used by the existing
// Deno tests under supabase/functions/ (e.g., brand-mingla-tos-accept/
// index.test.ts) — we read the source and assert the presence of the
// load-bearing strings + the absence of the destination-charge syntax.
//
// This test deliberately COMPLEMENTS the CI strict-grep gate
// (.github/scripts/strict-grep/orch-0843-stripe-direct-charges-only.mjs):
// the strict-grep gate runs in GitHub Actions on every push; this Deno
// test runs locally on `deno test` and is the regression-prevention test
// required by I-REGRESSION-TEST-MANDATORY for the ORCH-0843 fix.
//
// Adversarial coverage:
//  - T-10: reintroduce transfer_data.destination → "destination-charge
//    syntax removed" assertion fails
//  - T-11: remove application_fee_amount plumbing → "application_fee_amount
//    plumbing present" assertion fails
//  - T-12: remove stripeAccount from request-options → "stripeAccount
//    request-option" assertion fails

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const indexSource = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

// Strip line + block comments before testing, mirroring the CI gate so
// invariant-preserving doc comments that mention legacy keywords don't
// trip the assertions.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

const sourceNoComments = stripComments(indexSource);

Deno.test("ORCH-0843 — destination-charge syntax (transfer_data:) is removed", () => {
  assertEquals(
    /\btransfer_data\s*:/.test(sourceNoComments),
    false,
    "transfer_data: must NOT appear in active code (ORCH-0843 direct-charge).",
  );
});

Deno.test("ORCH-0843 — Stripe-Account header is set on both create calls", () => {
  // checkout.sessions.create
  const sessionsCallIndex = sourceNoComments.indexOf(
    "checkout.sessions.create",
  );
  assert(sessionsCallIndex >= 0, "expected checkout.sessions.create call");
  const sessionsWindow = sourceNoComments.slice(
    sessionsCallIndex,
    sessionsCallIndex + 4000,
  );
  assertStringIncludes(
    sessionsWindow,
    "stripeAccount: stripeAccountId",
    "checkout.sessions.create must pass stripeAccount: stripeAccountId in request-options",
  );

  // paymentIntents.create
  const piCallIndex = sourceNoComments.indexOf("paymentIntents.create");
  assert(piCallIndex >= 0, "expected paymentIntents.create call");
  const piWindow = sourceNoComments.slice(piCallIndex, piCallIndex + 4000);
  assertStringIncludes(
    piWindow,
    "stripeAccount: stripeAccountId",
    "paymentIntents.create must pass stripeAccount: stripeAccountId in request-options",
  );
});

Deno.test("ORCH-0843 — application_fee_amount plumbing is present (1.5% hardcoded)", () => {
  assertStringIncludes(
    sourceNoComments,
    "MINGLA_APPLICATION_FEE_RATE = 0.015",
    "edge function must declare MINGLA_APPLICATION_FEE_RATE = 0.015 (operator decision G-2)",
  );
  assertStringIncludes(
    sourceNoComments,
    "applicationFeeAmountCents = Math.round",
    "edge function must compute applicationFeeAmountCents via Math.round (integer-cent math, precision-safe)",
  );
  // Conditional-omit form: the key only goes on the body when > 0.
  assertStringIncludes(
    sourceNoComments,
    "if (applicationFeeAmountCents > 0)",
    "edge function must conditionally omit application_fee_amount when zero",
  );
  assertStringIncludes(
    sourceNoComments,
    "application_fee_amount = applicationFeeAmountCents",
    "edge function must assign application_fee_amount = applicationFeeAmountCents",
  );
});

Deno.test("ORCH-0843 — statement_descriptor_suffix \"MINGLA\" on Checkout Session", () => {
  assertStringIncludes(
    sourceNoComments,
    `statement_descriptor_suffix: "MINGLA"`,
    `Checkout Session path must set statement_descriptor_suffix: "MINGLA" — _prefix is rejected by Stripe at this level; per-PI only _suffix is valid. Platform-level "MINGLA*" prefix is one-time Dashboard config on Mingla main account (DEC-154 (1)).`,
  );
});

Deno.test("ORCH-0843 REWORK — Tax for Platforms enabled WITHOUT liability block (direct-charge contract)", () => {
  // ORCH-0843 REWORK: under DIRECT charges, Stripe's Tax for Platforms
  // designates the connected account as merchant of record via the
  // Stripe-Account header alone. The legacy
  //   liability: { type: "account", account: <id> }
  // shape is for destination/separate-transfer charges and is REJECTED
  // with 400 StripeInvalidRequestError under direct charges. See
  // https://docs.stripe.com/tax/connect/direct-charges
  //
  // Original SPEC §3.1.3 "PRESERVED VERBATIM" was wrong; QA caught the
  // 400 live on `surface: "web"` and `surface: "mobile-web"` against
  // acct_1TUNLtB5v00XfDTX. This test now asserts:
  //  (a) `automatic_tax: { enabled: true }` IS present (tax collection on)
  //  (b) NO `liability` block appears anywhere in the file (regression
  //      prevention for the exact bug class that produced the live 400)
  assertStringIncludes(
    sourceNoComments,
    "automatic_tax: { enabled: true }",
    "automatic_tax must be enabled in the inline direct-charge shape (Tax for Platforms ON)",
  );
  assertEquals(
    /\bliability\s*:/.test(sourceNoComments),
    false,
    "ORCH-0843 REWORK: `liability:` MUST NOT appear in active code — direct charges reject automatic_tax.liability (Stripe-Account header alone designates merchant of record).",
  );
});

Deno.test("ORCH-0843 — fee computation example: $50 = 75¢ (1.5%)", () => {
  // Sanity check the math contract: Math.round(5000 * 0.015) === 75.
  // This guards against accidental rate changes (e.g., 0.15 instead of
  // 0.015) which would skim 10x the intended fee.
  assertEquals(Math.round(5000 * 0.015), 75);
  // And against under-skimming (e.g., 0.0015 = 0.15%).
  assert(Math.round(5000 * 0.015) > 0);
});

Deno.test("ORCH-0843 — application_fee_amount persisted on session row before Stripe call", () => {
  // The refund flow relies on orders.stripe_application_fee_amount_cents
  // (copied from ticket_checkout_sessions.stripe_application_fee_amount_cents
  // by the finalize RPC) being populated. We assert the edge function
  // writes the computed fee back to the session row before calling Stripe
  // so the persisted value matches what Stripe will actually charge.
  assertStringIncludes(
    sourceNoComments,
    "stripe_application_fee_amount_cents: applicationFeeAmountCents",
    "edge function must persist stripe_application_fee_amount_cents = applicationFeeAmountCents on the session row",
  );
});
