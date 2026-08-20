#!/usr/bin/env node
import fs from "node:fs";

const files = {
  migration: "supabase/migrations/20270412002097_issue_2097_stripe_fee_refund_truth.sql",
  shared: "supabase/functions/_shared/issue2097TicketRefundTruth.ts",
  checkout: "supabase/functions/ticket-checkout-create/index.ts",
  organizer: "supabase/functions/refund-order/index.ts",
  admin: "supabase/functions/admin-refund-order/index.ts",
  fanout: "supabase/functions/event-cancel-refund-fanout/index.ts",
  trip: "supabase/functions/cancel-trip-booking/index.ts",
  webhook: "supabase/functions/_shared/stripeWebhookRouter.ts",
  business: "mingla-business/src/services/eventOrdersService.ts",
  adminUi: "mingla-admin/src/pages/BusinessMoneyLedgerPage.jsx",
};
const source = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, fs.readFileSync(path, "utf8")]));
const fail = (message) => { throw new Error(`#2097 ${message}`); };
const check = (s) => {
  if (!s.checkout.includes('return jsonResponse({ error: "application_fee_persistence_failed" }, 503)')) fail("checkout persistence is not fatal");
  for (const key of ["organizer", "admin", "fanout", "trip"]) if (!s[key].includes("executeTicketRefundWithFeeTruth")) fail(`${key} bypasses shared resolver`);
  if (s.trip.includes("Math.floor(entry.refund_cents * 0.015)")) fail("trip still fabricates 1.5 percent");
  if (s.webhook.includes("refund.application_fee_refunded ?? 0")) fail("webhook reads undocumented amount");
  if (!s.webhook.includes("issue_2097_finalize_refund_attempt")) fail("webhook does not converge through finalizer");
  for (const token of ["F * R < C", "listAllFeeRefunds", "pending_visibility", "succeeded_positive", "evidence_conflict"]) if (!s.shared.includes(token)) fail(`shared resolver missing ${token}`);
  for (const token of ["ticket_refund_attempts", "ticket_refund_fee_evidence", "ticket_refund_quarantine", "issue_2097_finalize_refund_attempt", "refund_pending", "DROP NOT NULL"]) if (!s.migration.includes(token)) fail(`migration missing ${token}`);
  if (s.migration.includes("succeeded_zero")) fail("removed succeeded_zero returned");
  if (s.business.includes("application_fee_refunded_cents ?? 0")) fail("Business fabricates null as zero");
  if (!s.adminUi.includes("RefundReconcileButton")) fail("Admin recovery missing");
};

if (process.argv.includes("--self-test")) {
  check(source);
  for (const [key, from, to] of [
    ["checkout", 'return jsonResponse({ error: "application_fee_persistence_failed" }, 503)', "continue_after_failed_persistence"],
    ["trip", "executeTicketRefundWithFeeTruth", "legacyDirectRefund"],
    ["shared", "F * R < C", "F * R > C"],
    ["webhook", "issue_2097_finalize_refund_attempt", "removed_finalizer"],
    ["migration", "ticket_refund_quarantine", "removed_quarantine"],
  ]) {
    let red = false;
    try { check({ ...source, [key]: source[key].replaceAll(from, to) }); } catch { red = true; }
    if (!red) fail(`self-test mutation survived ${key}:${from}`);
  }
  console.log("#2097 strict-grep self-test: PASS");
} else {
  check(source);
  console.log("#2097 strict-grep: PASS");
}
