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
  hold: "supabase/functions/_shared/ticketEvidenceHold.ts",
  evidence: "supabase/migrations/20270711130000_ticket_evidence_hold_completes_sale.sql",
  paystackWebhook: "supabase/functions/_shared/paystackWebhookRouter.ts",
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
  for (const token of ["issue_2079_paystack_late_refund_identity.happy.test.ts", "issue_2079_paystack_late_refund_identity.tester.adversarial.test.ts", "issue_2079_ticket_identity_obligation.test.ts", "issue_2079_stripe_hosted_identity.test.ts", "issue_2079_stripe_webhook_identity.test.ts", "issue_2079_evidence_hold_completes_sale.happy.test.ts", "issue_2079_evidence_hold_completes_sale.tester.adversarial.test.ts", "issue_2079_paystack_late_refund_identity.test.sql", "issue-2079-paystack-late-refund-identity.mjs --self-test"]) {
    if (!s.workflow.includes(token)) fail(`workflow missing ${token}`);
  }
  // A paid ticket held only because OUR evidence was incomplete completes the
  // sale; a genuine late payment after sale closure still refunds. These
  // assertions pin the fence between those two.
  if (!s.hold.includes('session.reversal_state === "paid_reversal_pending"') || !s.hold.includes("session.order_id == null")) {
    fail("evidence-hold candidate no longer requires a held, unsold session");
  }
  if (!s.evidence.includes("bool_and(o.reason=ANY(v_evidence_reasons))")) {
    fail("a hold may be lifted without proving every revocation reason is missing-evidence");
  }
  if (!s.evidence.includes("IF current_user NOT IN ('postgres','service_role') THEN")) {
    fail("release owner is no longer service-role only");
  }
  if (!s.evidence.includes("RETURN 'already_owned';")) {
    fail("#2168 handoff can open a second refund for money that already has an owner");
  }
  // #1221's money ledger is append-only (issue_1221_enforce_allocation_monotonic
  // rejects every DELETE, and source_refund_ledger_allocations.refund_id is
  // ON DELETE RESTRICT). The release retires the obligation in place.
  if (/\bDELETE\s+FROM\s+public\.source_refund/i.test(s.evidence)) {
    fail("the release deletes a refund or a ledger allocation; #1221's ledger is append-only");
  }
  for (const token of ["financial_state='reconciled'", "ops_status='resolved'", "last_error_code='sale_completed_no_refund_due'", "'ops_resolved'", "INSERT INTO public.source_refund_events("]) {
    if (!s.evidence.includes(token)) fail(`retirement missing ${token}`);
  }
  if (/buyer_state='processed'/.test(s.evidence)) fail("the release claims a refund was processed");
  // A released session must re-hold its inventory, and a retirement must be
  // undone when the sale it was retired for does not complete.
  if (!s.evidence.includes("expires_at=now()+GREATEST(v_session.expires_at-v_session.created_at,interval '0')")) {
    fail("a released session no longer re-holds its inventory for the finalize window");
  }
  if (!s.evidence.includes("'sale_not_completed_after_release'") || !s.evidence.includes("'outcome','reopened'")) {
    fail("a retired obligation can be swallowed when the finalize after a release fails");
  }
  // A reopened obligation must hard-fail its session, or a recovered sale can
  // still mint a ticket for a buyer who is also being refunded.
  const reopenAt = s.evidence.indexOf("'sale_not_completed_after_release'");
  const reopenEnd = s.evidence.indexOf("'outcome','reopened'", reopenAt);
  const reopenBody = s.evidence.slice(reopenAt, reopenEnd);
  if (!reopenBody.includes("UPDATE public.ticket_checkout_sessions SET reversal_state='paid_reversal_pending',")
      || !reopenBody.includes("status='failed'")
      || !reopenBody.includes("WHERE id=v_session.id AND order_id IS NULL")) {
    fail("a reopened obligation leaves its session finalizable — the buyer can keep the ticket and the refund");
  }
  if (/evidence-hold-reopened:[\s\S]{0,160}extract\(epoch/.test(s.evidence)) {
    fail("the reopen audit key is second-granularity; a second reopen in the same second is silently dropped");
  }
  const guardLoop = s.evidence.indexOf("FOR v_refund IN");
  const refundRetire = s.evidence.indexOf("UPDATE public.source_refunds SET\n    financial_state='reconciled'", guardLoop);
  if (guardLoop < 0 || refundRetire < guardLoop) fail("refunds are retired before they are proven untouched");
  const guards = s.evidence.slice(guardLoop, refundRetire);
  for (const token of ["v_refund.provider_refund_id IS NOT NULL", "v_refund.buyer_refund_processed_cents<>0", "v_refund.lease_owner IS NOT NULL", "public.source_refund_attempts", "public.source_refund_events", "public.payment_webhook_events", "'refund_in_progress'"]) {
    if (!guards.includes(token)) fail(`refund guard missing ${token}`);
  }
  // Every caller asks the release owner BEFORE the ordinary verify/finalize,
  // so a released session finalizes through the one existing finalize owner.
  for (const key of ["confirm", "webhook", "paystackWebhook", "reconcile"]) {
    if (!s[key].includes("releaseTicketEvidenceHold(")) fail(`${key} no longer releases an evidence hold`);
  }
  for (const key of ["confirm", "webhook"]) {
    const release = s[key].indexOf("releaseTicketEvidenceHold(");
    const verify = s[key].indexOf('"issue_2079_verify_ticket_paid_identity"', release);
    if (release < 0 || verify < release) fail(`${key} releases the hold after it verifies`);
  }
  const paystackRelease = s.paystackWebhook.indexOf("releaseTicketEvidenceHold(");
  const paystackFinalize = s.paystackWebhook.indexOf('"biz_ticket_checkout_finalize"', paystackRelease);
  if (paystackRelease < 0 || paystackFinalize < paystackRelease) fail("paystackWebhook releases the hold after it finalizes");
  if (!s.reconcile.includes('pi.status !== "succeeded"')) fail("the sweep can release a hold on a payment Stripe never captured");
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
    ["workflow", "issue_2079_evidence_hold_completes_sale.tester.adversarial.test.ts", "removed.adversarial.test.ts"],
    ["hold", 'session.reversal_state === "paid_reversal_pending"', 'session.reversal_state !== "sold"'],
    ["evidence", "bool_and(o.reason=ANY(v_evidence_reasons))", "bool_or(o.reason=ANY(v_evidence_reasons))"],
    ["evidence", "IF current_user NOT IN ('postgres','service_role') THEN", "IF false THEN"],
    ["evidence", "RETURN 'already_owned';", "RETURN 'attention_created';"],
    ["evidence", "v_refund.provider_refund_id IS NOT NULL", "false"],
    ["evidence", "v_refund.lease_owner IS NOT NULL", "false"],
    ["evidence", "UPDATE public.source_refunds SET\n    financial_state='reconciled'", "DELETE FROM public.source_refunds WHERE true; UPDATE public.source_refunds SET\n    financial_state='pending'"],
    ["evidence", "INSERT INTO public.source_refund_events(", "INSERT INTO public.source_refund_events_removed("],
    ["evidence", "expires_at=now()+GREATEST(v_session.expires_at-v_session.created_at,interval '0'),\n", ""],
    ["evidence", "'sale_not_completed_after_release'", "'sale_completed_no_refund_due'"],
    ["evidence", "      UPDATE public.ticket_checkout_sessions SET reversal_state='paid_reversal_pending',\n        status='failed',failed_at=COALESCE(failed_at,now()),updated_at=now()\n      WHERE id=v_session.id AND order_id IS NULL;\n", ""],
    ["evidence", "gen_random_uuid(),'requested','reconciled','queued',", "extract(epoch FROM clock_timestamp())::bigint,'requested','reconciled','queued',"],
    ["confirm", "releaseTicketEvidenceHold(", "skipTicketEvidenceHold("],
    ["webhook", "releaseTicketEvidenceHold(", "skipTicketEvidenceHold("],
    ["paystackWebhook", "releaseTicketEvidenceHold(", "skipTicketEvidenceHold("],
    ["reconcile", "releaseTicketEvidenceHold(", "skipTicketEvidenceHold("],
    ["reconcile", 'pi.status !== "succeeded"', 'pi.status !== "processing"'],
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
