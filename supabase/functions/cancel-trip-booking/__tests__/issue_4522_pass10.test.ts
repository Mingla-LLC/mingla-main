// MINGLA-INVARIANT: I-4522-CANCEL-PASS10-TRUTH | issue #4522 | Staff "partly refunded already" is recorded only for a reference Paystack lists on that charge and only at the amount Paystack lists for it (an unreadable list or an unknown reference records nothing); ops alerts never say an owed part is being sent when it was stopped or is below the provider minimum.
/**
 * issue #4522 pass 10 (P10-2 / P10-3 / P10-1 alerts), edge side.
 * FAILS ON REVERT: without opsRefundedElsewhere.ts the import fails; without
 * the amount check P10-2b records a N500k refund typed as N1M; without the
 * below-minimum text P10-3 reads "being sent automatically"; without the
 * late_held text P10-1 falls back to the "being sent" wording.
 */
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  handleOpsRefundedElsewhere,
  type ListedRefund,
  parseOpsRefundedElsewhere,
} from "../opsRefundedElsewhere.ts";
import {
  tripCancelShortfallParagraphs,
  tripCancelShortfallSubject,
} from "../../_shared/installments/unrecordedRefunds.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
const ATTEMPT = "4522a010-0000-4000-8000-00000000aaaa";

function deps(rows: ListedRefund[] | null | "throw", calls: Record<string, unknown>[] = []) {
  return {
    callerId: () => Promise.resolve("staff-1"),
    isAdmin: () => Promise.resolve(true),
    attemptCharge: () => Promise.resolve("mingla_p10_charge"),
    listRefunds: () => rows === "throw" ? Promise.reject(new Error("paystack 503")) : Promise.resolve(rows),
    resolve: (args: Record<string, unknown>) => {
      calls.push(args);
      return Promise.resolve({ data: { ok: true }, error: null });
    },
  };
}

const body = (cents: number, reference = "4522500021") =>
  parseOpsRefundedElsewhere({
    attemptId: ATTEMPT, reference, reason: "Paystack shows the dashboard refund",
    amountCents: 100_000_000, currency: "ngn", refundedElsewhereCents: cents,
  });

Deno.test("P10-2a the figure Paystack lists for that reference is recorded, with the listed amount", async () => {
  const calls: Record<string, unknown>[] = [];
  const res = await handleOpsRefundedElsewhere(body(50_000_000),
    deps([{ id: "4522500021", amount: 50_000_000, status: "processed", merchantNote: "" }], calls));
  assertEquals(res.status, 200);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].p_listed_refund_cents, 50_000_000);
  assertEquals(calls[0].p_refunded_elsewhere_cents, 50_000_000);
  assertEquals(calls[0].p_actor, "staff-1");
});

Deno.test("P10-2b a N500k refund typed as N1M is refused, nothing recorded", async () => {
  const calls: Record<string, unknown>[] = [];
  const res = await handleOpsRefundedElsewhere(body(100_000_000),
    deps([{ id: "4522500021", amount: 50_000_000, status: "processed", merchantNote: "" }], calls));
  assertEquals(res.status, 422);
  assertEquals(res.body.error, "refunded_elsewhere_amount_mismatch");
  assertEquals(calls.length, 0);
});

Deno.test("P10-2c a reference not on that charge is refused in plain words", async () => {
  const calls: Record<string, unknown>[] = [];
  const res = await handleOpsRefundedElsewhere(body(50_000_000, "9999"),
    deps([{ id: "4522500021", amount: 50_000_000, status: "processed", merchantNote: "" },
          { id: "9999", amount: 50_000_000, status: "failed", merchantNote: "" }], calls));
  assertEquals(res.status, 422);
  assertEquals(res.body.error, "provider_refund_reference_not_found");
  assertStringIncludes(String(res.body.message), "Paystack shows no refund with reference 9999");
  assertEquals(calls.length, 0);
});

Deno.test("P10-2d an unreadable list (null or error) records nothing and says retry", async () => {
  for (const rows of [null, "throw"] as const) {
    const calls: Record<string, unknown>[] = [];
    const res = await handleOpsRefundedElsewhere(body(50_000_000), deps(rows, calls));
    assertEquals(res.status, 503);
    assertEquals(res.body.error, "provider_refund_list_unreadable");
    assertStringIncludes(String(res.body.message), "Try again");
    assertEquals(calls.length, 0);
  }
});

Deno.test("P10-2e signed-out callers and missing figures are refused; index routes the mode", async () => {
  const anon = { ...deps([]), callerId: () => Promise.resolve(null) };
  assertEquals((await handleOpsRefundedElsewhere(body(1), anon)).status, 401);
  assertEquals(parseOpsRefundedElsewhere({ attemptId: ATTEMPT, refundedElsewhereCents: 0 }), null);
  assertEquals((await handleOpsRefundedElsewhere(null, deps([]))).status, 400);
  assertStringIncludes(source, 'body.mode === "ops_refunded_elsewhere"');
  assertStringIncludes(source, "listPaystackTransactionRefunds({ transaction, currency: \"NGN\" })");
  assertStringIncludes(source, "issue_4522_resolve_trip_cancel_refund_elsewhere_by_ops");
});

Deno.test("P10-3 an owed part below the provider minimum is never called 'being sent'", () => {
  const row = { kind: "shortfall", below_minimum: true, owed_cents: 3000, currency: "ngn", tier_pct: 30,
    failed_refund_cents: 10000, provider_minimum_cents: 5000, shortfall_refund_id: "sf-1" };
  const subject = tripCancelShortfallSubject(row);
  const text = tripCancelShortfallParagraphs(row).join("\n");
  assert(!/being sent/i.test(subject + text), subject + text);
  assertStringIncludes(subject, "below Paystack's refund minimum");
  assertStringIncludes(text, "Owed to the traveler: 3000 NGN");
  assertStringIncludes(text, "Paystack's minimum refund: 5000 NGN");
  assertStringIncludes(text, "paid outside Paystack");
  assertStringIncludes(text, "Escalate");
});

Deno.test("P10-1 an owed part stopped before sending is told truthfully", () => {
  const made = { kind: "late_held", late_held_reason: "seat_refund_recorded_made", owed_cents: 25_000_000, currency: "ngn" };
  const sign = { kind: "late_held", late_held_reason: "seat_refund_sign_at_send", owed_cents: 25_000_000, currency: "ngn" };
  for (const row of [made, sign]) {
    const text = tripCancelShortfallSubject(row) + tripCancelShortfallParagraphs(row).join("\n");
    assert(!/being sent automatically/i.test(tripCancelShortfallSubject(row)), text);
    assertStringIncludes(text, "Owed part NOT sent: 25000000 NGN");
  }
  assertStringIncludes(tripCancelShortfallParagraphs(made).join("\n"), "Nothing to do.");
  assertStringIncludes(tripCancelShortfallParagraphs(sign).join("\n"), "escalate to finance");
});
