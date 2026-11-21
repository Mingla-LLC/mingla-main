import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  aggregateTripBalanceSchedule,
  decodeTripBalance,
  parseTripBalanceAmount,
  rebalanceTripPlan,
  tripBalanceOptions,
} from "../tripBalance.ts";

const balance = {
  orderId: "order-1",
  currency: "usd",
  depositMinor: 20_000,
  paidMinor: 40_000,
  remainingMinor: 90_000,
  totalMinor: 130_000,
  canPayAnyAmount: true,
  minPaymentMinor: 10_000,
  paymentInFlight: false,
  nextPayment: {
    installmentId: "i1",
    dueAt: "2027-03-01T00:00:00Z",
    amountMinor: 30_000,
  },
  openRows: [
    { installmentId: "i1", dueAt: "2027-03-01T00:00:00Z", amountMinor: 30_000 },
    { installmentId: "i2", dueAt: "2027-04-01T00:00:00Z", amountMinor: 30_000 },
    { installmentId: "i3", dueAt: "2027-05-01T00:00:00Z", amountMinor: 30_000 },
  ],
  history: [],
};

Deno.test("#4522 balance decode fails closed on malformed money", () => {
  assertEquals(decodeTripBalance(balance)?.currency, "USD");
  assertEquals(decodeTripBalance({ ...balance, remainingMinor: 1.5 }), null);
  assertEquals(
    decodeTripBalance({
      ...balance,
      openRows: [{ dueAt: "tomorrow", amountMinor: 1 }],
    }),
    null,
  );
  assertEquals(decodeTripBalance({ ...balance, totalMinor: 130_001 }), null);
  assertEquals(
    decodeTripBalance({
      ...balance,
      openRows: balance.openRows.map((row, index) =>
        index === 0 ? { ...row, amountMinor: 29_999 } : row
      ),
    }),
    null,
  );
  assertEquals(
    decodeTripBalance({
      ...balance,
      openRows: balance.openRows.map((row, index) =>
        index === 0 ? { ...row, addonPortionMinor: 30_001 } : row
      ),
    }),
    null,
  );
});

Deno.test("#4522 the four choices exist only while flexible payment is enabled", () => {
  const decoded = decodeTripBalance(balance)!;
  assertEquals(tripBalanceOptions(decoded).map((option) => option.key), [
    "minimum",
    "next",
    "full",
    "other",
  ]);
  assertEquals(
    tripBalanceOptions({
      ...decoded,
      canPayAnyAmount: false,
      minPaymentMinor: null,
    })
      .map((option) => option.key),
    ["next", "full"],
  );
});

Deno.test("#4522 decimal input becomes integer minor units and refuses unsafe boundaries", () => {
  assertEquals(parseTripBalanceAmount(" 250.05 ", balance), {
    ok: true,
    amountMinor: 25_005,
  });
  assertEquals(parseTripBalanceAmount("", balance), {
    ok: false,
    error: "empty",
  });
  assertEquals(parseTripBalanceAmount("99.999", balance), {
    ok: false,
    error: "invalid",
  });
  assertEquals(parseTripBalanceAmount("99.99", balance), {
    ok: false,
    error: "below_minimum",
  });
  assertEquals(parseTripBalanceAmount("900.01", balance), {
    ok: false,
    error: "over_balance",
  });
});

Deno.test("#4522 preview conserves money and keeps the final due date", () => {
  const after = rebalanceTripPlan(balance.openRows, 75_000, 10_000);
  assertEquals(after.length, 1);
  assertEquals(after[0].installmentId, "i3");
  assertEquals(after[0].amountMinor, 15_000);
  assertEquals(after.reduce((sum, row) => sum + row.amountMinor, 0), 15_000);
  assertEquals(rebalanceTripPlan(balance.openRows, 90_000, 10_000), []);
});

Deno.test("#4522 preview mirrors per-package allocation before aggregating buyer dates", () => {
  const rows = [
    {
      installmentId: "a1",
      planLineId: "a",
      dueAt: "2027-03-01",
      amountMinor: 20_000,
      addonPortionMinor: 0,
    },
    {
      installmentId: "a2",
      planLineId: "a",
      dueAt: "2027-04-01",
      amountMinor: 20_000,
      addonPortionMinor: 0,
    },
    {
      installmentId: "a3",
      planLineId: "a",
      dueAt: "2027-05-01",
      amountMinor: 20_000,
      addonPortionMinor: 0,
    },
    {
      installmentId: "b2",
      planLineId: "b",
      dueAt: "2027-04-01",
      amountMinor: 15_000,
      addonPortionMinor: 2_000,
    },
    {
      installmentId: "b3",
      planLineId: "b",
      dueAt: "2027-05-01",
      amountMinor: 15_000,
      addonPortionMinor: 2_000,
    },
  ];
  assertEquals(
    aggregateTripBalanceSchedule(rows).map((row) => row.amountMinor),
    [20_000, 35_000, 35_000],
  );
  const after = rebalanceTripPlan(rows, 45_000, 1_000);
  assertEquals(after.map((row) => row.amountMinor), [10_000, 17_500, 17_500]);
  assertEquals(after.map((row) => row.addonPortionMinor), [0, 1_000, 1_000]);
  assertEquals(after.reduce((sum, row) => sum + row.amountMinor, 0), 45_000);
});
