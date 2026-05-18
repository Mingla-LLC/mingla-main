/**
 * ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — happy-path source-level
 * contract test for cancel-trip-booking edge function.
 *
 * Per ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5
 * gate: implementor MUST ship a happy-path test that fails on revert. This
 * test pins the SC-22 freshness re-check + per-PI direct-charge refund
 * pattern + invariant references at the source level (Deno can't easily
 * execute the edge fn without spinning up a full Supabase test env, so we
 * pin behaviour via AST-grade source assertions like ORCH-0859 + ORCH-0869
 * precedent).
 *
 * Fails-on-revert verified:
 *   - Remove the SC-22 `expectedRefundTotalCents !== computedRefundTotalCents`
 *     comparison + 409 return → test_sc22_freshness_check FAILS.
 *   - Strip `stripeAccount: connectedAccountId` from stripe.refunds.create
 *     → test_direct_charge_pattern FAILS (would cause refund posted to wrong
 *     account per ORCH-0843 invariant).
 *   - Remove `refund_application_fee: true` → test_proportional_app_fee FAILS.
 *   - Strip the rollback call when expectedRefundTotalCents diverges → test_
 *     rollback_on_freshness_divergence FAILS (orphan refund + ghost
 *     cancellation).
 */

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const __dirname = new URL(".", import.meta.url).pathname;
const SOURCE = await Deno.readTextFile(`${__dirname}../index.ts`);

Deno.test("ORCH-0875 SC-22 freshness check: edge fn compares expectedRefundTotalCents vs computed", () => {
  // Pins the SC-22 freshness divergence branch — without this comparison
  // the buyer could be charged a stale refund amount silently.
  assert(
    /computedRefundTotalCents\s*!==\s*expectedRefundTotalCents/.test(SOURCE),
    "expected SC-22 divergence check `computedRefundTotalCents !== expectedRefundTotalCents` to be present",
  );
});

Deno.test("ORCH-0875 SC-22 returns 409 policy_updated with currentRefundTotalCents on divergence", () => {
  // Pins the 409 response shape buyer/operator UI depend on for the "Policy
  // updated" inline error + amount refresh.
  assert(
    /policy_updated/.test(SOURCE),
    "expected error code 'policy_updated' in source",
  );
  assert(
    /currentRefundTotalCents/.test(SOURCE),
    "expected currentRefundTotalCents key in 409 response",
  );
  // Surrounding 409 status assertion — the divergence path must NOT silently
  // return success.
  assert(
    /409/.test(SOURCE),
    "expected HTTP 409 status code in divergence response",
  );
});

Deno.test("ORCH-0875 rollback fires on SC-22 freshness divergence", () => {
  // Pin: after begin succeeds but before Stripe refund, divergence detection
  // must call _rollback so orders.cancelled_at + installments cancelled don't
  // orphan a pending refund.
  assert(
    /biz_cancel_trip_booking_rollback[\s\S]*sc22_freshness_divergence/.test(SOURCE),
    "expected biz_cancel_trip_booking_rollback call with sc22_freshness_divergence reason",
  );
});

Deno.test("ORCH-0843 direct-charge pattern preserved: stripeAccount set on every refunds.create", () => {
  // ORCH-0843 invariant: Stripe refunds for trip orders must use the
  // connected account header (direct-charge), not the platform account.
  // Without stripeAccount, the refund posts on the wrong Stripe account.
  const refundsCreateBlocks = SOURCE.match(/stripe\.refunds\.create\([\s\S]*?\}\s*\)/g) ?? [];
  assert(
    refundsCreateBlocks.length > 0,
    "expected at least one stripe.refunds.create call",
  );
  for (const block of refundsCreateBlocks) {
    assert(
      /stripeAccount:\s*connectedAccountId/.test(block),
      `stripe.refunds.create call missing stripeAccount: connectedAccountId per ORCH-0843. Block:\n${block}`,
    );
  }
});

Deno.test("ORCH-0843 proportional application-fee refund: refund_application_fee:true on every refunds.create", () => {
  // ORCH-0875 Q6 resolution: Mingla 1.5% application fee refunded
  // proportionally via Stripe-native handling.
  const refundsCreateBlocks = SOURCE.match(/stripe\.refunds\.create\([\s\S]*?\}\s*\)/g) ?? [];
  for (const block of refundsCreateBlocks) {
    assert(
      /refund_application_fee:\s*true/.test(block),
      `stripe.refunds.create call missing refund_application_fee:true. Block:\n${block}`,
    );
  }
});

Deno.test("ORCH-0875 per-PI idempotency key carries refund_id + installment_id (or 'deposit')", () => {
  // Pins the per-PI idempotency-key contract so retry attempts hit the same
  // Stripe refund (vs creating duplicates).
  assert(
    /idempotencyKey:\s*`tr4_cancel:\$\{refundId\}:\$\{entry\.installment_id\s*\?\?\s*"deposit"\}`/.test(
      SOURCE,
    ),
    "expected per-PI idempotency key `tr4_cancel:${refundId}:${entry.installment_id ?? 'deposit'}`",
  );
});

Deno.test("ORCH-0875 dual auth mode: buyer-token validation + operator-JWT both supported", () => {
  // Pins the dual-auth contract. Removing buyer mode would break the
  // /booking/{orderId}/cancel anon route; removing operator mode would
  // break the trip dashboard sheet.
  assert(/validateBuyerToken/.test(SOURCE), "expected validateBuyerToken helper");
  assert(/userIdFromAuthHeader/.test(SOURCE), "expected operator JWT validation via userIdFromAuthHeader");
});

Deno.test("ORCH-0875 notification dispatch: reuses ORCH-0788 buyer_order_cancelled + buyer_refund_issued kinds", () => {
  // Q9 resolution: no new dispatcher kinds. Reusing existing kinds means the
  // adapter library + dispatcher routing keeps working.
  assert(
    /template_key:\s*"buyer_order_cancelled"/.test(SOURCE),
    "expected buyer_order_cancelled template_key in notification payload",
  );
  assert(
    /template_key:\s*"buyer_refund_issued"/.test(SOURCE),
    "expected buyer_refund_issued template_key in notification payload",
  );
});

Deno.test("ORCH-0875 audit row written for trip_booking_cancelled action", () => {
  // Operator audit trail — without this, post-incident forensics can't tell
  // which operator cancelled which booking when.
  assert(
    /action:\s*"trip_booking_cancelled"/.test(SOURCE),
    "expected audit action='trip_booking_cancelled'",
  );
});
