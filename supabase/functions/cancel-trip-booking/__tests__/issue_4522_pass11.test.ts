// MINGLA-INVARIANT: I-4522-CANCEL-PASS11-STAFF-FIRST | issue #4522 | Staff "partly refunded already" checks the caller is active Mingla staff before any lookup or Paystack read and never returns a provider figure to anyone else; the trip refund email never says a part paid to the traveler directly, or refunded earlier from the provider's dashboard, was issued to the card.
/**
 * issue #4522 pass 11 (P11-2 / P11-3), edge side.
 * FAILS ON REVERT: without the isAdmin check P11-2a reaches attemptCharge and
 * listRefunds and returns 422 with listed_cents; without the settled-outside
 * body P11-3a says "refund of N30.00 to your original payment method" and
 * "Reference: RFD-pending".
 */
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  handleOpsRefundedElsewhere,
  parseOpsRefundedElsewhere,
  settledOutsideParts,
} from "../opsRefundedElsewhere.ts";
import { refundIssuedToGenericBody } from "../../_shared/email/buyerLifecycleAdapters.ts";

const ATTEMPT = "4522a011-0000-4000-8000-00000000aaaa";
const input = parseOpsRefundedElsewhere({
  attemptId: ATTEMPT, reference: "4522500021", reason: "Paystack shows the dashboard refund",
  amountCents: 100_000_000, currency: "ngn", refundedElsewhereCents: 1,
});

function deps(admin: boolean | null | "throw", touched: string[]) {
  return {
    callerId: () => Promise.resolve("someone-1"),
    isAdmin: () => admin === "throw" ? Promise.reject(new Error("down")) : Promise.resolve(admin),
    attemptCharge: () => { touched.push("attemptCharge"); return Promise.resolve("mingla_p11_charge"); },
    listRefunds: () => {
      touched.push("listRefunds");
      return Promise.resolve([{ id: "4522500021", amount: 50_000_000, status: "processed", merchantNote: "" }]);
    },
    resolve: () => { touched.push("resolve"); return Promise.resolve({ data: { ok: true }, error: null }); },
  };
}

Deno.test("P11-2a a signed-in non-admin is refused before any lookup or provider read", async () => {
  const touched: string[] = [];
  const out = await handleOpsRefundedElsewhere(input, deps(false, touched));
  assertEquals(out.status, 403);
  assertEquals(touched, []);
  assert(!("listed_cents" in out.body), "no provider figure is returned");
});

Deno.test("P11-2b an unanswerable staff check records nothing and reads nothing", async () => {
  for (const admin of [null, "throw"] as const) {
    const touched: string[] = [];
    const out = await handleOpsRefundedElsewhere(input, deps(admin, touched));
    assertEquals(out.status, 503);
    assertEquals(touched, []);
  }
});

Deno.test("P11-2c staff still reach the Paystack check", async () => {
  const touched: string[] = [];
  const out = await handleOpsRefundedElsewhere(input, deps(true, touched));
  assertEquals(out.status, 422);
  assertEquals(out.body.listed_cents, 50_000_000);
  assertEquals(touched, ["attemptCharge", "listRefunds"]);
});

const ctx = { buyerName: "Ada", eventTitle: "Lagos to Accra", brandName: "Trips Co", orderShortId: "A1B2C3" };

Deno.test("P11-3a a part paid directly is never told as a card refund", () => {
  const parts = settledOutsideParts({ trip_cancel: { ops_resolutions: {
    deposit: { outcome: "paid_outside_provider", amount_cents: 3000, reference: "BANKTRF-P11-0030" },
  } } });
  assertEquals(parts, [{ kind: "paid_directly", amount_cents: 3000, reference: "BANKTRF-P11-0030" }]);
  const body = refundIssuedToGenericBody({
    template_key: "buyer_refund_issued", amount_cents: 3000, currency: "NGN", cancelledBy: "operator",
    refundAmountCents: 3000, settledOutside: parts,
  }, ctx);
  const text = body.paragraphs.join("\n");
  assert(!text.includes("original payment method"), text);
  assert(!text.includes("RFD-pending"), text);
  assert(!text.includes("business days"), text);
  assertStringIncludes(text, "paid");
  assertStringIncludes(text, "directly");
  assertStringIncludes(text, "BANKTRF-P11-0030");
});

Deno.test("P11-3b a whole charge refunded earlier from the dashboard is not told as issued by Mingla", () => {
  const parts = settledOutsideParts({ trip_cancel: { ops_resolutions: {
    deposit: { outcome: "refunded_elsewhere", amount_cents: 50_000_000, reference: "4522500099", recorded_whole_charge: true },
    "4522a011-0000-4000-8000-0000000000bb": { outcome: "refunded_elsewhere", amount_cents: 10, recorded_whole_charge: false },
    x: { outcome: "escalate", amount_cents: 99 },
  } } });
  assertEquals(parts.length, 1);
  const body = refundIssuedToGenericBody({
    template_key: "buyer_refund_issued", amount_cents: 80_000_000, currency: "NGN", cancelledBy: "buyer",
    refundAmountCents: 80_000_000, settledOutside: parts,
  }, ctx);
  const text = body.paragraphs.join("\n");
  assert(!text.includes("we've issued"), text);
  assertStringIncludes(text, "already refunded");
  // only the part Mingla sent (N300,000) is told as on its way to the card
  assertStringIncludes(text, "300,000");
  assertStringIncludes(text, "5–10 business days");
});

Deno.test("P11-3c with nothing settled outside the email is unchanged", () => {
  assertEquals(settledOutsideParts(null), []);
  const body = refundIssuedToGenericBody({
    template_key: "buyer_refund_issued", amount_cents: 3000, currency: "NGN", cancelledBy: "operator",
    refundAmountCents: 3000,
  }, ctx);
  assertStringIncludes(body.paragraphs.join("\n"), "Reference: RFD-pending");
});

Deno.test("P11-3d the cancellation email does not call a settled-outside refund a card refund", async () => {
  const { orderCancelledToGenericBody } = await import("../../_shared/email/buyerLifecycleAdapters.ts");
  const body = orderCancelledToGenericBody({
    template_key: "buyer_order_cancelled", cancelledBy: "operator", refundAmountCents: 3000, currency: "NGN",
    refundIssued: true, settledOutside: [{ kind: "paid_directly", amount_cents: 3000, reference: "BANK-1" }],
  }, ctx);
  const text = body.paragraphs.join("\n");
  assert(!text.includes("on its way"), text);
  assert(!text.includes("business days"), text);
});
