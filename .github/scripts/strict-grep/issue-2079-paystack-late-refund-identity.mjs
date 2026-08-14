#!/usr/bin/env node
import fs from "node:fs";

const paths = {
  migration: "supabase/migrations/20270411002079_issue_2079_paystack_late_refund_identity.sql",
  refund: "supabase/functions/_shared/sourceRefundControlPlane.ts",
  paystack: "supabase/functions/_shared/paystackRefunds.ts",
  worker: "supabase/functions/checkout-sale-revocation/index.ts",
  confirm: "supabase/functions/ticket-checkout-confirm/index.ts",
  webhook: "supabase/functions/_shared/stripeWebhookRouter.ts",
  reconcile: "supabase/functions/reconcile-stuck-checkouts/index.ts",
  workflow: ".github/workflows/issue-2079-paystack-late-refund-identity-tests.yml",
};
const sources = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, fs.readFileSync(path, "utf8")]));
const fail = (message) => { throw new Error(`issue-2079: ${message}`); };
const check = (s) => {
  for (const token of ["paystack_transaction_id", "stripe_charge_id", "issue_2079_capture_ticket_paid_identity_attention", "issue_2079_verify_ticket_paid_identity", "issue_2079_record_paid_identity_retry", "claim_source_refund_operations", "buyer_state='needs_attention'", "financial_state='needs_attention'"]) {
    if (!s.migration.includes(token)) fail(`migration missing ${token}`);
  }
  if (s.migration.includes("FROM public.brands WHERE id=v_session.brand_id")) fail("mutable brand provider authority returned");
  if (!s.paystack.includes("identity.id !== params.expectedTransactionId")) fail("Paystack secondary identity comparison missing");
  if (!s.refund.includes("latestCharge !== operation.stripe_charge_id")) fail("Stripe Charge corroboration missing");
  if (!s.refund.includes("payment_intent: operation.provider_payment_reference") || s.refund.includes("payment_intent: operation.stripe_charge_id")) fail("Stripe refund parameter mapping invalid");
  if (!s.worker.includes('row.reason.startsWith("paid_provider_")') || !s.worker.includes("paid_provider_identity_pending") || !s.worker.includes('"issue_2079_record_paid_identity_retry"')) fail("paid identity can false-terminalize or strand its retry lease");
  for (const key of ["confirm", "webhook", "reconcile"]) {
    const verify = s[key].indexOf('"issue_2079_verify_ticket_paid_identity"');
    const finalize = s[key].indexOf('"biz_ticket_checkout_finalize"', verify);
    if (verify < 0 || finalize < verify) fail(`${key} lacks capture-before-finalize`);
  }
  for (const token of ["issue_2079_paystack_late_refund_identity.happy.test.ts", "issue_2079_paystack_late_refund_identity.tester.adversarial.test.ts", "issue_2079_ticket_identity_obligation.test.ts", "issue_2079_stripe_hosted_identity.test.ts", "issue_2079_stripe_webhook_identity.test.ts", "issue_2079_paystack_late_refund_identity.test.sql", "issue-2079-paystack-late-refund-identity.mjs --self-test"]) {
    if (!s.workflow.includes(token)) fail(`workflow missing ${token}`);
  }
};

if (process.argv.includes("--self-test")) {
  check(sources);
  const mutations = [
    ["migration", "buyer_state='needs_attention'", "buyer_state='queued'"],
    ["paystack", "identity.id !== params.expectedTransactionId", "identity.id === params.expectedTransactionId"],
    ["refund", "latestCharge !== operation.stripe_charge_id", "latestCharge === operation.stripe_charge_id"],
    ["worker", "paid_provider_identity_pending", "provider_identity_missing"],
    ["migration", "issue_2079_record_paid_identity_retry", "issue_2079_record_paid_identity_removed"],
    ["confirm", '"issue_2079_verify_ticket_paid_identity"', '"issue_2079_verify_ticket_identity_removed"'],
    ["workflow", "issue_2079_paystack_late_refund_identity.happy.test.ts", "removed.test.ts"],
  ];
  for (const [key, from, to] of mutations) {
    let rejected = false;
    try { check({ ...sources, [key]: sources[key].replaceAll(from, to) }); } catch { rejected = true; }
    if (!rejected) fail(`self-test mutation survived: ${key}:${from}`);
  }
  console.log("issue-2079 provider-correct late refund self-test: PASS");
} else {
  check(sources);
  console.log("issue-2079 provider-correct late refund: PASS");
}
