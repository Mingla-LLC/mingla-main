import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

const read = (path: string) => Deno.readTextFileSync(path);
const shared = read("supabase/functions/_shared/issue2097TicketRefundTruth.ts");
const migration = read("supabase/migrations/20270412002097_issue_2097_stripe_fee_refund_truth.sql");

Deno.test("#2097 every Stripe ticket refund surface delegates to one resolver", () => {
  for (const path of [
    "supabase/functions/refund-order/index.ts",
    "supabase/functions/admin-refund-order/index.ts",
    "supabase/functions/event-cancel-refund-fanout/index.ts",
    "supabase/functions/cancel-trip-booking/index.ts",
  ]) {
    const source = read(path);
    assert(source.includes("executeTicketRefundWithFeeTruth"), `${path} lacks shared resolver`);
  }
  assert(!read("supabase/functions/cancel-trip-booking/index.ts").includes("Math.floor(entry.refund_cents * 0.015)"));
});

Deno.test("#2097 checkout persistence fails before either Stripe create surface", () => {
  const checkout = read("supabase/functions/ticket-checkout-create/index.ts");
  const stop = checkout.indexOf('application_fee_persistence_failed');
  assert(stop > checkout.indexOf("stripe_application_fee_amount_cents: applicationFeeAmountCents"));
  assert(stop < checkout.indexOf("checkout.sessions.create"));
  assert(stop < checkout.indexOf("paymentIntents.create"));
  assert(!checkout.includes("application_fee persistence failed (non-fatal)"));
});

Deno.test("#2097 webhook never reads undocumented Refund fee amount or captures source-refund traffic", () => {
  const webhook = read("supabase/functions/_shared/stripeWebhookRouter.ts");
  assert(!webhook.includes("refund.application_fee_refunded ?? 0"));
  assert(webhook.indexOf("if (sourceRefundId)") < webhook.indexOf('ticket_refund_attempts'));
  assert(webhook.includes("issue_2097_finalize_refund_attempt"));
});

Deno.test("#2097 schema has exact states, service-only mutation, quarantine and nullable amount", () => {
  for (const state of ["awaiting_application_fee", "application_fee_timeout", "application_fee_conflict", "rejected_preflight", "pending_visibility", "succeeded_positive", "fee_evidence_unavailable", "evidence_conflict", "not_applicable", "unknown_legacy"]) {
    assert(migration.includes(`'${state}'`));
  }
  assert(!migration.includes("succeeded_zero"));
  assert(migration.includes("ALTER COLUMN application_fee_refunded_cents DROP NOT NULL"));
  assert(migration.includes("status='refund_pending'"));
  assert(migration.includes("F*R") || shared.includes("F * R < C"));
  assert(migration.includes("REVOKE ALL ON public.ticket_refund_attempts FROM PUBLIC,anon,authenticated"));
});

Deno.test("#2097 Business/Admin render nullable truth and explicit recovery", () => {
  const eventOrders = read("mingla-business/src/services/eventOrdersService.ts");
  const money = read("mingla-business/src/utils/moneySummary.ts");
  const admin = read("mingla-admin/src/pages/BusinessMoneyLedgerPage.jsx");
  assert(!eventOrders.includes("application_fee_refunded_cents ?? 0"));
  assert(money.includes("hasUnknownApplicationFeeRefund"));
  assert(admin.includes("application_fee_refund_status"));
  assert(admin.includes("RefundReconcileButton"));
  assertEquals(read("mingla-admin/src/services/adminRefundReconciliationService.js").includes("admin-reconcile-ticket-refund"), true);
});
