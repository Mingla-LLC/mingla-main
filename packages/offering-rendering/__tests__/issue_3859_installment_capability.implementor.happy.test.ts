import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  checkoutSelectionUsesTripInstallments,
  hasTripInstallmentTemplate,
  TRIP_INSTALLMENT_CAPABILITY_UNAVAILABLE,
  tripInstallmentsSupported,
} from "../tripInstallmentCapability.ts";

const schedule = {
  deposit_pct: 25,
  installments: [{ ordinal: 1, pct: 75, days_after_booking: 30 }],
};

Deno.test("#3859 capability is supported only for the effective supported provider", () => {
  assert(tripInstallmentsSupported("stripe"));
  assert(tripInstallmentsSupported(" STRIPE "));
  assertEquals(tripInstallmentsSupported("paystack"), false);
  assertEquals(tripInstallmentsSupported("future-provider"), false);
  assertEquals(tripInstallmentsSupported(null), false);
  assertEquals(tripInstallmentsSupported(undefined), false);
  assertEquals(
    TRIP_INSTALLMENT_CAPABILITY_UNAVAILABLE,
    "installment_capability_unavailable",
  );
});

Deno.test("#3859 stale auto/installments selections are capability-gated, full pay is not", () => {
  const rows = [{ tier_metadata: { installments: schedule } }];
  assert(hasTripInstallmentTemplate(rows[0].tier_metadata));
  assert(checkoutSelectionUsesTripInstallments("auto", rows));
  assert(checkoutSelectionUsesTripInstallments("installments", rows));
  assertEquals(checkoutSelectionUsesTripInstallments("full", rows), false);
  assertEquals(
    checkoutSelectionUsesTripInstallments("auto", [
      { tier_metadata: { description: "No schedule" } },
    ]),
    false,
  );
});

Deno.test("#3859 malformed or absent schedule metadata never fabricates capability use", () => {
  for (
    const metadata of [
      null,
      undefined,
      {},
      { installments: null },
      { installments: [] },
      { installments: "invalid" },
    ]
  ) {
    assertEquals(hasTripInstallmentTemplate(metadata), false);
  }
});
