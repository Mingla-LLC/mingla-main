import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  tripInstallmentAmounts,
  tripSummedDueTodayCents,
} from "../tripBoxTotals.ts";
import { computeMultiLineInstallmentPlan } from "../../../supabase/functions/_shared/installments/computeMultiLineInstallmentPlan.ts";

const TEMPLATE = {
  deposit_pct: 25,
  installments: [
    { ordinal: 1, pct: 75, days_after_booking: 30 },
  ],
};

Deno.test("#3859 client mixed due-today matches server floor and all-in authority", () => {
  const tiers = [
    {
      ticketTypeId: "plan",
      priceCents: 99,
      priceAllInCents: 101,
      isFree: false,
      isUnlimited: true,
      ticketsRemaining: null,
      installmentSchedule: TEMPLATE,
    },
    {
      ticketTypeId: "full",
      priceCents: 190,
      priceAllInCents: 200,
      isFree: false,
      isUnlimited: true,
      ticketsRemaining: null,
      installmentSchedule: TEMPLATE,
    },
  ];
  const clientDue = tripSummedDueTodayCents(
    tiers,
    { plan: 1, full: 1 },
    { plan: "installments", full: "full" },
  );
  const server = computeMultiLineInstallmentPlan({
    bookedAt: new Date("2030-01-01T00:00:00Z"),
    lines: [
      {
        ticketTypeId: "plan",
        lineTotalCents: 101,
        paymentPlanChoice: "installments",
        template: TEMPLATE,
      },
      {
        ticketTypeId: "full",
        lineTotalCents: 200,
        paymentPlanChoice: "full",
        template: TEMPLATE,
      },
    ],
  });

  assertEquals(clientDue, 225);
  assertEquals(clientDue, server.dueTodayCents);
  assertEquals(server.scheduled.map((entry) => entry.amountCents), [76]);
  assertNotEquals(clientDue, 226, "deposit must floor, never round");
});

Deno.test("#3859 projected installment amounts conserve the all-in cent total", () => {
  const projected = tripInstallmentAmounts(101, TEMPLATE);
  assertEquals(projected?.depositCents, 25);
  assertEquals(projected?.installments, [
    { ordinal: 1, pct: 75, amountCents: 76 },
  ]);
  assertEquals(
    (projected?.depositCents ?? 0) +
      (projected?.installments.reduce(
        (sum, installment) => sum + installment.amountCents,
        0,
      ) ?? 0),
    101,
  );
});
