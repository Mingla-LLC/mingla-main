import { assert, assertEquals } from "jsr:@std/assert@1";

const read = (path: string) => Deno.readTextFileSync(path);
const migration = read(
  "supabase/migrations/20270411002079_issue_2079_paystack_late_refund_identity.sql",
);
const refunds = read("supabase/functions/_shared/sourceRefundControlPlane.ts");
const paystack = read("supabase/functions/_shared/paystackRefunds.ts");
const worker = read("supabase/functions/checkout-sale-revocation/index.ts");
const confirm = read("supabase/functions/ticket-checkout-confirm/index.ts");
const webhook = read("supabase/functions/_shared/stripeWebhookRouter.ts");
const reconcile = read("supabase/functions/reconcile-stuck-checkouts/index.ts");

Deno.test("#2079 stores provider-exclusive ticket refund identities and excludes attention rows", () => {
  for (
    const token of [
      "paystack_transaction_id numeric(16,0)",
      "stripe_charge_id text",
      "buyer_state='needs_attention'",
      "financial_state='needs_attention'",
      "ops_status='needs_review'",
      "claim_source_refund_operations",
      "source_type='ticket_checkout_session'",
    ]
  ) assert(migration.includes(token), `missing ${token}`);
});

Deno.test("#2079 uses immutable attempt authority and capture-before-return", () => {
  assert(!migration.includes("FROM public.brands WHERE id=v_session.brand_id"));
  assert(
    migration.includes("issue_2079_capture_ticket_paid_identity_attention"),
  );
  assert(migration.includes("issue_2079_verify_ticket_paid_identity"));
  for (const source of [confirm, webhook, reconcile]) {
    const verify = source.indexOf('"issue_2079_verify_ticket_paid_identity"');
    const finalize = source.indexOf('"biz_ticket_checkout_finalize"', verify);
    assert(
      verify >= 0 && finalize > verify,
      "paid identity must be captured before finalize/return",
    );
  }
});

Deno.test("#2079 verifies Stripe PI to Charge before using payment_intent refund parameter", () => {
  const retrieve = refunds.indexOf("paymentIntents.retrieve(");
  const compare = refunds.indexOf(
    "latestCharge !== operation.stripe_charge_id",
    retrieve,
  );
  const post = refunds.indexOf("stripe.refunds.create", compare);
  assert(retrieve >= 0 && compare > retrieve && post > compare);
  assert(
    refunds.includes("payment_intent: operation.provider_payment_reference"),
  );
  assert(!refunds.includes("payment_intent: operation.stripe_charge_id"));
});

Deno.test("#2079 verifies Paystack transaction ID before list or POST", () => {
  const compare = paystack.indexOf(
    "identity.id !== params.expectedTransactionId",
  );
  const list = paystack.indexOf("findExistingRefund({", compare);
  const post = paystack.indexOf("fetch(`${PAYSTACK_BASE_URL}/refund`", list);
  assert(compare >= 0 && list > compare && post > list);
  assert(refunds.includes("expectedTransactionId:"));
});

Deno.test("#2079 never neutralizes paid Paystack identity uncertainty", () => {
  const guard = worker.indexOf('row.reason.startsWith("paid_provider_")');
  // #2168 — the window used to END on the throw this branch no longer contains.
  // A missing marker returns -1, and slice(guard, -1) would have widened the
  // window to nearly the whole file, so the negative assertion below would pass
  // for the wrong reason. It now ends on a structural boundary and is
  // length-banded (#2113 runaway-window).
  const end = worker.indexOf("else if (!attempt)", guard);
  assert(guard >= 0 && end > guard);
  const branch = worker.slice(guard, end);
  assert(
    branch.length > 200 && branch.length < 4000,
    `paid branch window is ${branch.length} chars — the boundary moved`,
  );
  assertEquals(branch.includes('state = "neutralized"'), false);
  // The obligation itself: uncertainty goes to a human, never to silence.
  assert(branch.includes("issue_2168_handoff_revocation_attention"));
});
