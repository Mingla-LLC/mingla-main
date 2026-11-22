// MINGLA-INVARIANT: I-4522-FLEX-NO-UNPAYABLE-REMAINDER-CLIENT | issue #4522 | The Explorer and buyer web balance screens accept only what issue_4522_begin_flex_payment accepts: the whole balance, or minPaymentMinor up to maxPartialMinor (never leaving less than the provider's minimum); a forbidden amount is refused before any request with the two amounts the traveler can pay.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  aggregateTripBalanceSchedule,
  decodeTripBalance,
  parseTripBalanceAmount,
  rebalanceTripPlan,
  supportsBalancePayments,
  tripBalanceAmountAllowed,
  tripBalanceOptions,
  unpayableRemainderCopy,
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

// issue #4522 (rework N6 / N5) — the plan version and the money being returned.
Deno.test("#4522 N6 plan version: absent reads as 2, an older plan reads as itself, junk fails closed", () => {
  assertEquals(decodeTripBalance(balance)?.planVersion, 2);
  assertEquals(decodeTripBalance({ ...balance, planVersion: 1 })?.planVersion, 1);
  assertEquals(supportsBalancePayments(decodeTripBalance({ ...balance, planVersion: 1 })!), false);
  assertEquals(supportsBalancePayments(decodeTripBalance(balance)!), true);
  assertEquals(decodeTripBalance({ ...balance, planVersion: "2" }), null);
});

Deno.test("#4522 N5 held and returned overpayment decode as their own fields, never into paid", () => {
  const decoded = decodeTripBalance({ ...balance, heldCreditMinor: 10_000, overpaymentRefundedMinor: 2_500 });
  assertEquals(decoded?.heldCreditMinor, 10_000);
  assertEquals(decoded?.overpaymentRefundedMinor, 2_500);
  assertEquals(decoded?.paidMinor, 40_000);
  assertEquals(decodeTripBalance(balance)?.heldCreditMinor, 0);
  assertEquals(decodeTripBalance({ ...balance, heldCreditMinor: -1 }), null);
});

// ── T4-3: a payment never leaves less than the provider can charge ─────────

/** The SQL rule (issue_4522_begin_flex_payment) and its quote (issue_4522_balance). */
const sqlQuote = (remaining: number, hostMin: number, floor: number) => {
  const min = Math.min(Math.max(hostMin, floor), remaining);
  return { min, maxPartial: remaining - floor >= min ? remaining - floor : null };
};
const sqlAccepts = (a: number, remaining: number, hostMin: number, floor: number): boolean => {
  const { min } = sqlQuote(remaining, hostMin, floor);
  return a >= min && a <= remaining && (a === remaining || remaining - a >= floor);
};
const quoted = (remaining: number, hostMin: number, floor: number) => {
  const q = sqlQuote(remaining, hostMin, floor);
  return decodeTripBalance({
    ...balance,
    paidMinor: 40_000,
    totalMinor: 40_000 + remaining,
    remainingMinor: remaining,
    nextPayment: null,
    openRows: [{ installmentId: "i1", dueAt: "2027-03-01T00:00:00Z", amountMinor: remaining }],
    minPaymentMinor: q.min,
    maxPartialMinor: q.maxPartial,
    providerMinimumMinor: floor,
  })!;
};
const fmt = (minor: number) => `$${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;

Deno.test("T4-3 every amount 1..remaining: the screens accept exactly what the server accepts (USD 50¢, ₦100, JPY)", () => {
  for (
    const [remaining, hostMin, floor, accepted] of [
      [1_030, 100, 50, 882], // USD: $1.00 .. $9.80, or $10.30
      [1_030, 1_000, 50, 1], // the tester's $10.30 with a $10 minimum: only the whole balance
      [20_100, 100, 10_000, 102], // NGN: 100.00 .. 101.00, or 201.00
      [1_000, 100, 0, 901], // JPY (zero-decimal, no verified floor)
      [30, 1_000, 50, 1], // a balance below the floor: only the whole of it
    ] as const
  ) {
    const b = quoted(remaining, hostMin, floor);
    let n = 0;
    for (let a = 1; a <= remaining; a += 1) {
      const input = `${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
      const parsed = parseTripBalanceAmount(input, b);
      const ok = parsed.ok && parsed.amountMinor === a;
      const server = sqlAccepts(a, remaining, hostMin, floor);
      assertEquals(ok, server, `${remaining}/${hostMin}/${floor} at ${a}`);
      assertEquals(tripBalanceAmountAllowed(b, a) && a >= (b.minPaymentMinor ?? 0), server);
      if (!parsed.ok && a < remaining && a >= (b.minPaymentMinor ?? 0)) {
        assertEquals(parsed.error, "leaves_unpayable_remainder", `${remaining} at ${a}`);
      }
      if (ok) n += 1;
    }
    assertEquals(n, accepted, `${remaining}/${hostMin}/${floor}`);
  }
});

Deno.test("T4-3 the quote decodes additively; only-the-whole-balance hides Minimum and Other; copy names both amounts", () => {
  const older = decodeTripBalance(balance)!;
  assertEquals([older.maxPartialMinor, older.providerMinimumMinor], [90_000, 0]);
  assertEquals(decodeTripBalance({ ...balance, maxPartialMinor: 90_001 }), null);
  assertEquals(decodeTripBalance({ ...balance, maxPartialMinor: "x" }), null);
  const onlyWhole = quoted(1_030, 1_000, 50);
  assertEquals(tripBalanceOptions(onlyWhole).map((o) => o.key), ["full"]);
  assertEquals(unpayableRemainderCopy(onlyWhole, fmt), "That would leave too little to pay later. Pay the full $10.30.");
  const both = quoted(1_030, 100, 50);
  assertEquals(tripBalanceOptions(both).map((o) => o.key), ["minimum", "full", "other"]);
  assertEquals(
    unpayableRemainderCopy(both, fmt),
    "That would leave too little to pay later. Pay up to $9.80, or the full $10.30.",
  );
  // a "next payment" that would leave cents is not offered on a flexible plan
  const nextLeavesCents = decodeTripBalance({
    ...balance,
    remainingMinor: 30_030,
    totalMinor: 70_030,
    nextPayment: { installmentId: "i1", dueAt: "2027-03-01T00:00:00Z", amountMinor: 30_000 },
    openRows: [
      { installmentId: "i1", dueAt: "2027-03-01T00:00:00Z", amountMinor: 30_000 },
      { installmentId: "i2", dueAt: "2027-04-01T00:00:00Z", amountMinor: 30 },
    ],
    maxPartialMinor: 29_980,
    providerMinimumMinor: 50,
  })!;
  assertEquals(tripBalanceOptions(nextLeavesCents).map((o) => o.key), ["minimum", "full", "other"]);
});

Deno.test("T4-3 the preview, like the re-spread, never shows a row below the provider's minimum", () => {
  const rows = [
    { installmentId: "a1", dueAt: "2027-01-10T08:00:00Z", amountMinor: 5_000, planLineId: "a" },
    { installmentId: "a2", dueAt: "2027-02-10T08:00:00Z", amountMinor: 5_000, planLineId: "a" },
    { installmentId: "b1", dueAt: "2027-03-10T08:00:00Z", amountMinor: 30, planLineId: "b" },
    { installmentId: "b2", dueAt: "2027-04-10T08:00:00Z", amountMinor: 30, planLineId: "b" },
  ];
  const after = rebalanceTripPlan(rows, 5_000, 100, 50);
  assertEquals(after.reduce((n, r) => n + r.amountMinor, 0), 5_060);
  assertEquals(after.filter((r) => r.amountMinor < 50), []);
  // without a floor the preview is unchanged from before (package B keeps its 31¢ in two rows)
  const before = rebalanceTripPlan(rows, 5_000, 100);
  assertEquals(before.reduce((n, r) => n + r.amountMinor, 0), 5_060);
  assertEquals(before.filter((r) => r.amountMinor < 50).length, 2);
});
