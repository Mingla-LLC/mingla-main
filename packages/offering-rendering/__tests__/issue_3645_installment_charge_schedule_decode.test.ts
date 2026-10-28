import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  decodeInstallmentChargeSchedule,
  installmentPlanBuyerTotal,
} from "../discountQuote.ts";

const payment = {
  ordinal: 1,
  dueAt: "2027-03-01T12:00:00.000Z",
  buyerTotalCents: 811_875,
  feesCents: 45_000,
  taxCents: 16_875,
};

Deno.test("#3645 client accepts and normalizes a server-locked charge schedule", () => {
  assertEquals(
    decodeInstallmentChargeSchedule({ currency: "ngn", payments: [payment] }),
    { currency: "NGN", payments: [payment] },
  );
});

Deno.test("#3645 client fails closed on incomplete, duplicate, or malformed charges", () => {
  for (
    const value of [
      { currency: "NGN", payments: [] },
      { currency: "NGN", payments: [payment, { ...payment }] },
      { currency: "NGN", payments: [{ ...payment, ordinal: 0 }] },
      { currency: "NGN", payments: [{ ...payment, dueAt: "not-a-date" }] },
      { currency: "NG", payments: [payment] },
      { currency: "NGN", payments: [{ ...payment, buyerTotalCents: -1 }] },
    ]
  ) {
    assertEquals(decodeInstallmentChargeSchedule(value), undefined);
  }
});

Deno.test("#3645 adversarial: plan total is derived from every locked charge, never a stale response total", () => {
  const schedule = decodeInstallmentChargeSchedule({
    currency: "NGN",
    payments: [payment, { ...payment, ordinal: 2, buyerTotalCents: 406_000 }],
  });
  assertEquals(installmentPlanBuyerTotal(270_625, schedule), 1_488_500);
  assertEquals(installmentPlanBuyerTotal(-1, schedule), undefined);
  assertEquals(installmentPlanBuyerTotal(270_625, undefined), undefined);
});
