/**
 * META-ORCH-1174 Leg B1 — adversarial unit tests for the multi-line installment
 * money math (the executable spec mirrored by
 * biz_ticket_checkout_create_session in
 * 20261101000000_meta_orch_1174_b1_multiline_installments.sql).
 *
 * MANDATORY money-path coverage (per dispatch):
 *   (a) single plan line — byte-identical to ORCH-0869 single-line (no regression)
 *   (b) two non-plan lines — full charge sum, empty schedule
 *   (c) one plan line + one non-plan line — deposit + full today, plan schedule kept
 *   (d) two plan lines, DIFFERENT schedules — both deposits today, schedules unioned
 *   (e) qty>1 on a plan line — scales by line total
 *   (f) free + paid mix
 * PLUS: money-conservation assertion on every case (no money lost / double-charged)
 *   and the payInFull (ORCH-0915 opt-out) collapse.
 *
 * Run: deno test supabase/functions/_shared/installments/__tests__/computeMultiLineInstallmentPlan.test.ts
 */

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  computeMultiLineInstallmentPlan,
  type InstallmentTemplate,
  MultiLineInstallmentError,
  type MultiLineInstallmentLine,
} from "../computeMultiLineInstallmentPlan.ts";

const BOOKED = new Date("2026-01-01T00:00:00Z");

// 25% deposit + 2 installments (37.5% / 37.5%) by days_after_booking.
const PLAN_2X: InstallmentTemplate = {
  deposit_pct: 25,
  installments: [
    { ordinal: 1, pct: 37.5, days_after_booking: 30 },
    { ordinal: 2, pct: 37.5, days_after_booking: 60 },
  ],
};

// 50% deposit + 1 installment (50%) by days_after_booking.
const PLAN_1X: InstallmentTemplate = {
  deposit_pct: 50,
  installments: [{ ordinal: 1, pct: 50, days_after_booking: 45 }],
};

function sumScheduled(scheduled: { amountCents: number }[]): number {
  return scheduled.reduce((t, s) => t + s.amountCents, 0);
}

/** The load-bearing invariant: nothing lost, nothing double-charged. */
function assertMoneyConserved(
  plan: ReturnType<typeof computeMultiLineInstallmentPlan>,
  lines: MultiLineInstallmentLine[],
) {
  const lineSum = lines.reduce((t, l) => t + l.lineTotalCents, 0);
  const total = plan.dueTodayCents + sumScheduled(plan.scheduled);
  assertEquals(
    total,
    lineSum,
    `money conservation: dueToday(${plan.dueTodayCents}) + scheduled(${
      sumScheduled(plan.scheduled)
    }) must equal Σ line totals(${lineSum})`,
  );
}

Deno.test("(a) single plan line — byte-identical to ORCH-0869 single-line math", () => {
  // 10000 cents, 25% deposit. deposit=floor(10000*25/100)=2500.
  // inst1=floor(10000*37.5/100)=3750. inst2(last)=10000-2500-3750=3750.
  const lines: MultiLineInstallmentLine[] = [
    { ticketTypeId: "std", lineTotalCents: 10000, template: PLAN_2X },
  ];
  const plan = computeMultiLineInstallmentPlan({ lines, bookedAt: BOOKED });

  assertEquals(plan.dueTodayCents, 2500);
  assertEquals(plan.scheduled.length, 2);
  assertEquals(plan.scheduled[0].amountCents, 3750);
  assertEquals(plan.scheduled[1].amountCents, 3750);
  assertEquals(plan.scheduled[0].ordinal, 1);
  assertEquals(plan.scheduled[1].ordinal, 2);
  assertEquals(plan.scheduled[0].dueAt, "2026-01-31T00:00:00Z");
  assertEquals(plan.scheduled[1].dueAt, "2026-03-02T00:00:00Z");
  assert(plan.hasInstallments);
  assertMoneyConserved(plan, lines);
});

Deno.test("(a') single plan line with rounding remainder — last installment absorbs", () => {
  // 999 cents, 33% deposit + 3×~22.33%. Forces floor() remainder onto the last.
  const ODD: InstallmentTemplate = {
    deposit_pct: 33,
    installments: [
      { ordinal: 1, pct: 22, days_after_booking: 10 },
      { ordinal: 2, pct: 22, days_after_booking: 20 },
      { ordinal: 3, pct: 23, days_after_booking: 30 },
    ],
  };
  const lines: MultiLineInstallmentLine[] = [
    { ticketTypeId: "std", lineTotalCents: 999, template: ODD },
  ];
  const plan = computeMultiLineInstallmentPlan({ lines, bookedAt: BOOKED });
  // deposit=floor(999*33/100)=329. i1=floor(999*22/100)=219. i2=219.
  // i3(last)=999-329-219-219=232.
  assertEquals(plan.dueTodayCents, 329);
  assertEquals(plan.scheduled.map((s) => s.amountCents), [219, 219, 232]);
  assertMoneyConserved(plan, lines);
});

Deno.test("(b) two non-plan lines — full sum today, empty schedule", () => {
  const lines: MultiLineInstallmentLine[] = [
    { ticketTypeId: "a", lineTotalCents: 4000, template: null },
    { ticketTypeId: "b", lineTotalCents: 6000, template: undefined },
  ];
  const plan = computeMultiLineInstallmentPlan({ lines, bookedAt: BOOKED });
  assertEquals(plan.dueTodayCents, 10000);
  assertEquals(plan.scheduled.length, 0);
  assert(!plan.hasInstallments);
  assertMoneyConserved(plan, lines);
});

Deno.test("(c) one plan line + one non-plan line — deposit + full today, plan schedule preserved", () => {
  const lines: MultiLineInstallmentLine[] = [
    { ticketTypeId: "vip", lineTotalCents: 10000, template: PLAN_2X }, // dep 2500
    { ticketTypeId: "std", lineTotalCents: 5000, template: null }, // full 5000
  ];
  const plan = computeMultiLineInstallmentPlan({ lines, bookedAt: BOOKED });
  // dueToday = 2500 (vip deposit) + 5000 (std full) = 7500.
  assertEquals(plan.dueTodayCents, 7500);
  assertEquals(plan.scheduled.length, 2);
  // The vip plan's two 3750 installments are preserved.
  assertEquals(plan.scheduled.map((s) => s.amountCents), [3750, 3750]);
  assertEquals(plan.scheduled.every((s) => s.sourceTicketTypeId === "vip"), true);
  assertMoneyConserved(plan, lines);
});

Deno.test("(d) two plan lines, DIFFERENT schedules — both deposits today, schedules unioned + re-ordinalled", () => {
  const lines: MultiLineInstallmentLine[] = [
    { ticketTypeId: "vip", lineTotalCents: 10000, template: PLAN_2X }, // dep 2500, 2 insts @ d30,d60
    { ticketTypeId: "std", lineTotalCents: 8000, template: PLAN_1X }, // dep 4000, 1 inst @ d45
  ];
  const plan = computeMultiLineInstallmentPlan({ lines, bookedAt: BOOKED });
  // dueToday = 2500 + 4000 = 6500.
  assertEquals(plan.dueTodayCents, 6500);
  // 3 scheduled total: vip d30(3750), std d45(4000), vip d60(3750), sorted by dueAt.
  assertEquals(plan.scheduled.length, 3);
  assertEquals(plan.scheduled.map((s) => s.ordinal), [1, 2, 3]); // sequential, no collision
  assertEquals(plan.scheduled.map((s) => s.dueAt), [
    "2026-01-31T00:00:00Z", // vip +30d
    "2026-02-15T00:00:00Z", // std +45d
    "2026-03-02T00:00:00Z", // vip +60d
  ]);
  assertEquals(plan.scheduled.map((s) => s.amountCents), [3750, 4000, 3750]);
  assertEquals(plan.scheduled.map((s) => s.sourceTicketTypeId), [
    "vip",
    "std",
    "vip",
  ]);
  assertMoneyConserved(plan, lines);
});

Deno.test("(e) qty>1 on a plan line — scales by line total (caller folds qty into lineTotalCents)", () => {
  // VIP unit price 5000 × qty 3 = 15000 line total.
  const lines: MultiLineInstallmentLine[] = [
    { ticketTypeId: "vip", lineTotalCents: 15000, template: PLAN_2X },
  ];
  const plan = computeMultiLineInstallmentPlan({ lines, bookedAt: BOOKED });
  // deposit=floor(15000*25/100)=3750. i1=floor(15000*37.5/100)=5625. i2=15000-3750-5625=5625.
  assertEquals(plan.dueTodayCents, 3750);
  assertEquals(plan.scheduled.map((s) => s.amountCents), [5625, 5625]);
  assertMoneyConserved(plan, lines);
});

Deno.test("(f) free + paid mix — free line contributes 0, paid plan line schedules normally", () => {
  const lines: MultiLineInstallmentLine[] = [
    { ticketTypeId: "free", lineTotalCents: 0, template: null },
    { ticketTypeId: "vip", lineTotalCents: 10000, template: PLAN_2X },
  ];
  const plan = computeMultiLineInstallmentPlan({ lines, bookedAt: BOOKED });
  // free adds 0 today + nothing scheduled; vip deposit 2500.
  assertEquals(plan.dueTodayCents, 2500);
  assertEquals(plan.scheduled.length, 2);
  assertMoneyConserved(plan, lines);
});

Deno.test("(f') free plan line is impossible to schedule below zero — free + free", () => {
  const lines: MultiLineInstallmentLine[] = [
    { ticketTypeId: "free1", lineTotalCents: 0, template: null },
    { ticketTypeId: "free2", lineTotalCents: 0, template: null },
  ];
  const plan = computeMultiLineInstallmentPlan({ lines, bookedAt: BOOKED });
  assertEquals(plan.dueTodayCents, 0);
  assertEquals(plan.scheduled.length, 0);
  assertMoneyConserved(plan, lines);
});

Deno.test("payInFull opt-out (ORCH-0915) — every line charges full today, no schedule, even with templates", () => {
  const lines: MultiLineInstallmentLine[] = [
    { ticketTypeId: "vip", lineTotalCents: 10000, template: PLAN_2X },
    { ticketTypeId: "std", lineTotalCents: 8000, template: PLAN_1X },
  ];
  const plan = computeMultiLineInstallmentPlan({
    lines,
    bookedAt: BOOKED,
    payInFull: true,
  });
  assertEquals(plan.dueTodayCents, 18000); // full sum
  assertEquals(plan.scheduled.length, 0);
  assert(!plan.hasInstallments);
  assertMoneyConserved(plan, lines);
});

Deno.test("no money is created — three plan lines all conserve independently and in union", () => {
  const lines: MultiLineInstallmentLine[] = [
    { ticketTypeId: "a", lineTotalCents: 12345, template: PLAN_2X },
    { ticketTypeId: "b", lineTotalCents: 7777, template: PLAN_1X },
    { ticketTypeId: "c", lineTotalCents: 9999, template: PLAN_2X },
  ];
  const plan = computeMultiLineInstallmentPlan({ lines, bookedAt: BOOKED });
  assertMoneyConserved(plan, lines);
  // Ordinals are a contiguous 1..M with no duplicates (DB UNIQUE(order_id,ordinal)).
  const ords = plan.scheduled.map((s) => s.ordinal);
  assertEquals(ords, ords.map((_, i) => i + 1));
});

// ---- adversarial: malformed templates raise the SAME codes the SQL raises ----

Deno.test("malformed: pct sum != 100 → installment_pct_sum_mismatch", () => {
  const bad: InstallmentTemplate = {
    deposit_pct: 25,
    installments: [{ ordinal: 1, pct: 50, days_after_booking: 30 }], // 25+50=75
  };
  assertThrows(
    () =>
      computeMultiLineInstallmentPlan({
        lines: [{ ticketTypeId: "x", lineTotalCents: 10000, template: bad }],
        bookedAt: BOOKED,
      }),
    MultiLineInstallmentError,
    "installment_pct_sum_mismatch",
  );
});

Deno.test("malformed: first installment in the past → installment_schedule_past_due_at_booking", () => {
  const past: InstallmentTemplate = {
    deposit_pct: 50,
    installments: [{ ordinal: 1, pct: 50, fixed_date: "2025-01-01T00:00:00Z" }],
  };
  assertThrows(
    () =>
      computeMultiLineInstallmentPlan({
        lines: [{ ticketTypeId: "x", lineTotalCents: 10000, template: past }],
        bookedAt: BOOKED,
      }),
    MultiLineInstallmentError,
    "installment_schedule_past_due_at_booking",
  );
});

Deno.test("malformed: deposit_pct out of range → installment_deposit_pct_out_of_range", () => {
  const bad: InstallmentTemplate = {
    deposit_pct: 0,
    installments: [{ ordinal: 1, pct: 100, days_after_booking: 30 }],
  };
  assertThrows(
    () =>
      computeMultiLineInstallmentPlan({
        lines: [{ ticketTypeId: "x", lineTotalCents: 10000, template: bad }],
        bookedAt: BOOKED,
      }),
    MultiLineInstallmentError,
    "installment_deposit_pct_out_of_range",
  );
});

Deno.test("malformed: ordinal gap → installment_ordinal_invalid", () => {
  const bad: InstallmentTemplate = {
    deposit_pct: 25,
    installments: [
      { ordinal: 1, pct: 37.5, days_after_booking: 30 },
      { ordinal: 3, pct: 37.5, days_after_booking: 60 }, // should be 2
    ],
  };
  assertThrows(
    () =>
      computeMultiLineInstallmentPlan({
        lines: [{ ticketTypeId: "x", lineTotalCents: 10000, template: bad }],
        bookedAt: BOOKED,
      }),
    MultiLineInstallmentError,
    "installment_ordinal_invalid",
  );
});
