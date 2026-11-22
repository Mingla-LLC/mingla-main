/**
 * issue #4522 rework (tester F7) — the deposit kept by "Deposit is
 * non-refundable" is reported under its own key and never treated as a
 * payment; readers stay tolerant of the earlier stray-element shape.
 */
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { depositKeptCents, paymentRefundEntries } from "../refundEntries.ts";

const deposit = {
  installment_id: null,
  ordinal: 0,
  source_pi: "pi_deposit",
  paid_cents: 30_000_000,
  refund_cents: 0,
  currency: "NGN",
  note: "deposit",
};
const flex = {
  installment_id: "11111111-1111-4111-8111-111111111111",
  ordinal: 4,
  source_pi: "ps_flex",
  paid_cents: 71_400_000,
  refund_cents: 71_400_000,
  currency: "NGN",
};

Deno.test("new shape: own key, two payment entries", () => {
  const compute = {
    per_payment_refund: [flex, deposit],
    deposit_non_refundable_cents: 30_000_000,
  };
  assertEquals(paymentRefundEntries(compute.per_payment_refund), [flex, deposit]);
  assertEquals(depositKeptCents(compute), 30_000_000);
});

Deno.test("old shape: the stray element is not a payment and still reads as kept", () => {
  const compute = {
    per_payment_refund: [flex, deposit, { deposit_non_refundable_cents: 30_000_000 }],
  };
  assertEquals(paymentRefundEntries(compute.per_payment_refund), [flex, deposit]);
  assertEquals(depositKeptCents(compute), 30_000_000);
});

Deno.test("nothing kept and malformed input read as zero / no payments", () => {
  assertEquals(depositKeptCents({ per_payment_refund: [flex, deposit] }), 0);
  assertEquals(paymentRefundEntries(null), []);
  assertEquals(paymentRefundEntries([{ refund_cents: "1", paid_cents: 1 }]), []);
});

Deno.test("the cancel edge reads entries only through the tolerant reader", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assertEquals(source.includes("compute.per_payment_refund ?? []"), false);
  assertEquals(source.includes("begin.per_payment_refund ?? []"), false);
  assertEquals(source.includes("depositKeptCents: depositKeptCents(compute)"), true);
});
