import { assert } from "jsr:@std/assert@1";

const read = (path: string) => Deno.readTextFileSync(path);
const migration = read(
  "supabase/migrations/20270411002079_issue_2079_paystack_late_refund_identity.sql",
);
const worker = read("supabase/functions/checkout-sale-revocation/index.ts");
const webhook = read("supabase/functions/_shared/stripeWebhookRouter.ts");
const workflow = read(
  ".github/workflows/issue-2079-paystack-late-refund-identity-tests.yml",
);

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `missing bounded source region: ${start}`);
  return source.slice(from, to);
}

Deno.test("#2079 tester: a missing attempt cannot relabel observed Paystack money as Stripe", () => {
  const finalize = between(
    migration,
    "CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_finalize(",
    "REVOKE ALL ON FUNCTION public.biz_ticket_checkout_finalize",
  );
  assert(
    !finalize.includes("COALESCE(v_attempt.provider,'stripe')"),
    "missing provider-attempt evidence must not silently default an authentic paid signal to Stripe",
  );
});

Deno.test("#2079 tester: changed secondary evidence cannot replay a complete refund as queued", () => {
  const mint = between(
    migration,
    "CREATE OR REPLACE FUNCTION public.issue_1930_mint_ticket_late_reversal(",
    "REVOKE ALL ON FUNCTION public.issue_1930_mint_ticket_late_reversal",
  );
  assert(
    !/ON CONFLICT\s*\(source_type,source_id,refund_kind\)\s*DO UPDATE\s+SET provider_payment_reference\s*=\s*public\.source_refunds\.provider_payment_reference/s
      .test(mint),
    "a no-op upsert hides changed Paystack transaction IDs or Stripe Charges instead of moving the obligation to needs_attention",
  );
});

Deno.test("#2079 tester: paid-identity protection runs before the missing-attempt neutralization branch", () => {
  const paidGuard = worker.indexOf('row.reason.startsWith("paid_provider_")');
  const missingAttempt = worker.indexOf("if (!attempt)");
  assert(paidGuard >= 0, "paid-identity worker guard is missing");
  assert(
    paidGuard < missingAttempt,
    "the worker can mark a paid-identity row neutralized before checking its durable paid reason",
  );
});

Deno.test("#2079 tester: signed hosted Stripe payment proves Checkout Session to PaymentIntent before capture", () => {
  const handler = between(
    webhook,
    "async function handleTicketCheckoutPaymentIntent(",
    "async function handleCheckoutSessionCompleted(",
  );
  const retrieveCheckout = handler.indexOf("checkout.sessions.retrieve");
  const capture = handler.indexOf('"issue_2079_verify_ticket_paid_identity"');
  assert(
    retrieveCheckout >= 0 && capture > retrieveCheckout,
    "the hosted webhook must retrieve the stored cs_* and prove cs.payment_intent equals the signed pi_* before capture/finalize",
  );
});

Deno.test("#2079 tester: every changed money-path consumer triggers the issue workflow on main", () => {
  const push = between(workflow, "  push:", "  workflow_dispatch:");
  for (
    const path of [
      "supabase/functions/_shared/paystackRefunds.ts",
      "supabase/functions/checkout-sale-revocation/**",
      "supabase/functions/ticket-checkout-confirm/**",
      "supabase/functions/_shared/stripeWebhookRouter.ts",
      "supabase/functions/reconcile-stuck-checkouts/**",
      "supabase/functions/_shared/__tests__/issue_2079_paystack_late_refund_identity.tester.adversarial.test.ts",
    ]
  ) {
    assert(push.includes(path), `push path is missing ${path}`);
  }
});
