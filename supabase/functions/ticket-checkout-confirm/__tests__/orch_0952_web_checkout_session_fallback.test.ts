// META-ORCH-0952 — live buyer-web confirm fallback for hosted Stripe Checkout.
//
// Regression guarded:
// A paid hosted Checkout Session can return the buyer to
// /checkout-trip/{id}/confirm before the webhook back-fills
// ticket_checkout_sessions.stripe_payment_intent_id. In that state the old
// ticket-checkout-confirm code returned status:"pending" forever, leaving
// physical Safari stuck on "Confirming your reservation...".
//
// These source-level checks lock the narrow fallback: retrieve the stored
// Stripe Checkout Session id, expand payment_intent, persist the PI id, then
// continue through the existing finalize RPC. This test fails on the old code
// because none of those fallback anchors existed.

import { assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

function stripComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

const activeSource = stripComments(source);

Deno.test("META-ORCH-0952 T-01 — confirm selects stored Stripe Checkout Session id", () => {
  assert(
    activeSource.includes("stripe_checkout_session_id"),
    "ticket-checkout-confirm must select stripe_checkout_session_id so hosted Checkout can self-heal without webhook PI back-fill.",
  );
});

Deno.test("META-ORCH-0952 T-02 — confirm retrieves Checkout Session with expanded payment_intent", () => {
  assert(
    /checkout\.sessions\.retrieve\([\s\S]*expand:\s*\[\s*["']payment_intent["']\s*\]/
      .test(
        activeSource,
      ),
    "ticket-checkout-confirm must retrieve the stored Checkout Session with payment_intent expanded before returning pending.",
  );
});

Deno.test("META-ORCH-0952 T-03 — confirm persists recovered PaymentIntent id back to the session", () => {
  assert(
    /\.from\(["']ticket_checkout_sessions["']\)[\s\S]*\.update\(\{[\s\S]*stripe_payment_intent_id:\s*paymentIntentId/
      .test(
        activeSource,
      ),
    "ticket-checkout-confirm must persist the recovered PI id so later webhook/status paths converge.",
  );
});

Deno.test("META-ORCH-0952 T-04 — expanded PI continues through existing finalize RPC", () => {
  assert(
    /paymentIntentFromCheckoutSession[\s\S]*biz_ticket_checkout_finalize/.test(
      activeSource,
    ),
    "expanded Checkout Session payment_intent must feed the existing finalize RPC path, not create a separate order writer.",
  );
});
