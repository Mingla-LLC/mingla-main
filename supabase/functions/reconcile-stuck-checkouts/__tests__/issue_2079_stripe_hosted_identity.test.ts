import { assert } from "jsr:@std/assert@1";

const source = Deno.readTextFileSync(
  "supabase/functions/reconcile-stuck-checkouts/index.ts",
);

Deno.test("#2079 reconcile proves hosted CS even when PI is already stored", () => {
  const stripePi = source.indexOf('if (refClass === "STRIPE_PI")');
  const csGuard = source.indexOf("if (csId)", stripePi);
  const csRetrieve = source.indexOf("retrieveCheckoutSessionReadOnly", csGuard);
  const relation = source.indexOf("hostedRelationConflict", csRetrieve);
  const piRetrieve = source.indexOf("retrievePaymentIntentReadOnly", relation);
  assert(stripePi >= 0 && csGuard > stripePi && csRetrieve > csGuard);
  assert(relation > csRetrieve && piRetrieve > relation);
});

Deno.test("#2079 reconcile persists hosted PI and captures mismatch before finalize", () => {
  const stripeCs = source.indexOf('else if (refClass === "STRIPE_CS")');
  const persist = source.indexOf("stripe_payment_intent_id: piId", stripeCs);
  const conflict = source.indexOf("if (hostedRelationConflict)", persist);
  const capture = source.indexOf(
    '"issue_2079_capture_ticket_paid_identity_attention"',
    conflict,
  );
  const verify = source.indexOf(
    '"issue_2079_verify_ticket_paid_identity"',
    capture,
  );
  const finalize = source.indexOf('"biz_ticket_checkout_finalize"', verify);
  assert(stripeCs >= 0 && persist > stripeCs && conflict > persist);
  assert(capture > conflict && verify > capture && finalize > verify);
});
