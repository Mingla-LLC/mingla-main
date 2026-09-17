import { assert } from "jsr:@std/assert@1";

const source = Deno.readTextFileSync(
  "supabase/functions/_shared/stripeWebhookRouter.ts",
);
const start = source.indexOf(
  "async function handleTicketCheckoutPaymentIntent(",
);
const end = source.indexOf(
  "async function handleCheckoutSessionCompleted(",
  start,
);
const handler = source.slice(start, end);

Deno.test("#2079 signed webhook proves hosted CS to PI before finalize", () => {
  const retrieve = handler.indexOf("checkout.sessions.retrieve");
  const relation = handler.indexOf("hostedPi !== paymentIntentId", retrieve);
  const persist = handler.indexOf(
    "stripe_payment_intent_id: hostedPi",
    relation,
  );
  const verify = handler.indexOf(
    '"issue_2079_verify_ticket_paid_identity"',
    persist,
  );
  const finalize = handler.indexOf('"biz_ticket_checkout_finalize"', verify);
  assert(retrieve >= 0 && relation > retrieve && persist > relation);
  assert(verify > persist && finalize > verify);
});

Deno.test("#2079 webhook captures relation mismatch before acknowledging", () => {
  const mismatch = handler.indexOf("hostedPi !== paymentIntentId");
  const capture = handler.indexOf(
    '"issue_2079_capture_ticket_paid_identity_attention"',
    mismatch,
  );
  const captureFailure = handler.indexOf("if (captureError)", capture);
  const returnAfterCapture = handler.indexOf(
    "return session.brand_id",
    captureFailure,
  );
  assert(mismatch >= 0 && capture > mismatch && captureFailure > capture);
  assert(returnAfterCapture > captureFailure);
});

// The pinned Stripe API sends `latest_charge`, not a `charges` list. Every
// charge-id read in the router must go through paymentIntentChargeId, or a
// paid ticket is held for a "missing" charge and reversed. DELETE the helper
// call from the ticket handler and this fails.
Deno.test("#2079 webhook reads the paid charge through paymentIntentChargeId only", () => {
  const helperStart = source.indexOf("export function paymentIntentChargeId(");
  const helperEnd = source.indexOf("\n}\n", helperStart);
  assert(helperStart >= 0 && helperEnd > helperStart);
  const outsideHelper = source.slice(0, helperStart) +
    source.slice(helperEnd);
  assert(!/\.charges\b/.test(outsideHelper));
  assert(!/\["charges"\]/.test(outsideHelper));
  const observed = handler.indexOf(
    "const observedChargeId = paymentIntentChargeId(paymentIntent);",
  );
  const verify = handler.indexOf(
    '"issue_2079_verify_ticket_paid_identity"',
    observed,
  );
  assert(observed >= 0 && verify > observed);
});
