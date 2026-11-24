// MINGLA-INVARIANT: I-4522-CANCEL-PASS12-READBACK-BOOKS | issue #4522 | The cancel's automatic Paystack read-back hands the database the provider's refund list of the charge (provider id, amount, status, merchant note) so a refund made outside Mingla is booked on the charge by its reference; staff entering Mingla's own reference get a 409 that names it.
/**
 * issue #4522 pass 12 (P12-1 / P12-2), edge side.
 * FAILS ON REVERT: without providerRefundsForBooking (and the
 * p_provider_refunds argument on the read-back's resize call) P12-1a/b fail;
 * P12-2 asserts the database refusal reaches staff as a 409 naming it.
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { providerRefundsForBooking } from "../refundEntries.ts";
import { handleOpsRefundedElsewhere, parseOpsRefundedElsewhere } from "../opsRefundedElsewhere.ts";

Deno.test("P12-1a the read-back hands every provider refund to the booking, by reference", () => {
  const out = providerRefundsForBooking([
    { id: " 4522500024 ", amount: 30_000_000, status: "processed", merchantNote: "" },
    { id: "4522500023", amount: 50_000_000, status: "processed", merchantNote: "mingla_trip_refund:r:deposit" },
    { id: "", amount: 10, status: "processed", merchantNote: "" },
    { id: "x", amount: Number.NaN, status: "processed", merchantNote: "" },
  ]);
  assertEquals(out, [
    { id: "4522500024", amount: 30_000_000, status: "processed", merchant_note: "" },
    { id: "4522500023", amount: 50_000_000, status: "processed", merchant_note: "mingla_trip_refund:r:deposit" },
  ]);
});

Deno.test("P12-1b the cancel's read-back passes the list to the resize", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const at = src.indexOf("const settleRefusedPaystackPart");
  assert(at > 0);
  const body = src.slice(at, at + 2500);
  assert(body.includes('"issue_4522_trip_cancel_resize_charge"'));
  assert(body.includes("p_provider_refunds: providerRefundsForBooking(rows)"));
  // as main before the migration: an error from the resize returns quietly.
  assert(body.includes("if (resizeError) return;"));
});

Deno.test("P12-2 Mingla's own reference is refused with a 409 that names it", async () => {
  const input = parseOpsRefundedElsewhere({
    attemptId: "4522a012-0000-4000-8000-00000000aaaa", reference: "4522500023", reason: "Paystack lists it",
    amountCents: 100_000_000, currency: "ngn", refundedElsewhereCents: 50_000_000,
  });
  const out = await handleOpsRefundedElsewhere(input, {
    callerId: () => Promise.resolve("staff-1"),
    isAdmin: () => Promise.resolve(true),
    attemptCharge: () => Promise.resolve("mingla_p12_charge"),
    listRefunds: () =>
      Promise.resolve([{ id: "4522500023", amount: 50_000_000, status: "processed", merchantNote: "mingla_seat" }]),
    resolve: () =>
      Promise.resolve({ data: null, error: { message: "provider_refund_reference_is_minglas", code: "PT409" } }),
  });
  assertEquals(out.status, 409);
  assertEquals(out.body.error, "provider_refund_reference_is_minglas");
});
