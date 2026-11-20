/**
 * issue #4522 slice 2 — ticket-checkout-create and v2 trip plans.
 *
 * Everything here is inert while `issue_4522_plan_v2_enabled()` is false: no
 * v2 plan can be saved, `issue_4522_checkout_v2_plan` answers NULL, and the
 * add-on payment choice is sent to the database only when a buyer made one.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  checkoutSelectionUsesTripInstallments,
  hasTripInstallmentTemplate,
} from "../../../../packages/offering-rendering/tripInstallmentCapability.ts";
import {
  parseTripPlanV2ContractPlan,
  tierRowsCarryPlanV2,
  TripPlanV2ContractError,
} from "../tripPlanV2Contract.ts";

const source = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

const V2_PLAN = {
  v: 2,
  deposit: { mode: "percent", pct: 25 },
  count: 3,
  final_due_days_before_start: 30,
};

Deno.test("a v2 plan needs the same trip-plan capability as a legacy plan", () => {
  assert(hasTripInstallmentTemplate({ payment_plan: V2_PLAN }));
  assert(hasTripInstallmentTemplate({ installments: { deposit_pct: 25 } }));
  assert(!hasTripInstallmentTemplate({ payment_plan: null }));
  assert(!hasTripInstallmentTemplate({ payment_plan: [] }));
  assert(!hasTripInstallmentTemplate({}));
  assert(
    checkoutSelectionUsesTripInstallments("auto", [
      { tier_metadata: { payment_plan: V2_PLAN } },
    ]),
  );
  assert(
    !checkoutSelectionUsesTripInstallments("full", [
      { tier_metadata: { payment_plan: V2_PLAN } },
    ]),
  );
});

Deno.test("only a selected package with a v2 plan routes to the database planner", () => {
  assert(tierRowsCarryPlanV2([{ tier_metadata: { payment_plan: V2_PLAN } }]));
  assert(
    !tierRowsCarryPlanV2([
      { tier_metadata: { installments: { deposit_pct: 25 } } },
      { tier_metadata: null },
    ]),
  );
});

Deno.test("the contract-path plan is read strictly; NULL keeps the legacy planner", () => {
  assertEquals(parseTripPlanV2ContractPlan(null), null);
  const plan = parseTripPlanV2ContractPlan({
    dueTodayNetCents: 30000,
    dueTodayListCents: 30000,
    availability: "plan",
    countOffered: 3,
    countGiven: 2,
    finalDueAt: "2027-02-10T08:00:00Z",
    installmentSchedule: {
      fullPriceCents: 120000,
      depositCents: 30000,
      currency: "USD",
      installments: [
        {
          ordinal: 1,
          pct: 37.5,
          amountCents: 45000,
          dueAt: "2027-02-02T08:00:00Z",
          addonPortionCents: 0,
          sourceTicketTypeId: "45220000-0000-4000-8000-000000000013",
        },
        {
          ordinal: 2,
          pct: 37.5,
          amountCents: 45000,
          dueAt: "2027-02-10T08:00:00Z",
          addonPortionCents: 0,
          sourceTicketTypeId: "45220000-0000-4000-8000-000000000013",
        },
      ],
    },
  });
  assert(plan !== null);
  assertEquals(plan.dueTodayCents, 30000);
  assertEquals(plan.hasInstallments, true);
  assertEquals(plan.scheduled.map((row) => row.amountCents), [45000, 45000]);
  assertEquals(plan.scheduled[1].sourceOrdinal, 2);
  assertEquals(plan.summary, {
    planVersion: 2,
    availability: "plan",
    countOffered: 3,
    countGiven: 2,
    finalDueAt: "2027-02-10T08:00:00Z",
  });
  assertEquals(
    parseTripPlanV2ContractPlan({
      dueTodayNetCents: 120000,
      dueTodayListCents: 120000,
      installmentSchedule: null,
      availability: "full_window",
    })?.hasInstallments,
    false,
  );
  for (
    const bad of [
      [],
      { dueTodayNetCents: -1, dueTodayListCents: 0 },
      { dueTodayNetCents: 1, dueTodayListCents: 1, installmentSchedule: {} },
      {
        dueTodayNetCents: 1,
        dueTodayListCents: 1,
        installmentSchedule: {
          installments: [{ ordinal: 1, pct: 1, amountCents: 0, dueAt: "x" }],
        },
      },
    ]
  ) {
    assertThrows(
      () => parseTripPlanV2ContractPlan(bad),
      TripPlanV2ContractError,
    );
  }
});

Deno.test("the add-on payment choice reaches the database only when chosen", () => {
  // It rides the cart lines, so no RPC signature changes and a request without
  // a choice sends exactly the lines it sent before.
  assertStringIncludes(
    source,
    "const rpcLines = addonPaymentMode === null\n      ? lines\n      : lines.map((line) => ({ ...line, addonPaymentMode }));",
  );
  // Quote, the private-link session and the main session read it; the door
  // wrappers (never a trip plan) keep `lines`.
  assertEquals(source.split("p_lines: rpcLines,").length - 1, 3);
  assertStringIncludes(
    source,
    'return jsonResponse({ error: "addon_payment_mode_invalid" }, 400);',
  );
});

Deno.test("v2 refusals keep their names and the contract path plans before binding", () => {
  assertStringIncludes(source, '"installment_plan_unavailable",');
  assertStringIncludes(source, '"payment_plan_v2_unavailable",');
  const v2Rpc = source.indexOf('"issue_4522_checkout_v2_plan"');
  const legacyPlanner = source.indexOf(
    "computedPlan = planV2 ?? computeMultiLineInstallmentPlan(",
  );
  const bind = source.indexOf('"issue_3859_bind_checkout_contract"');
  assert(v2Rpc > 0 && legacyPlanner > v2Rpc && bind > legacyPlanner);
  assertStringIncludes(source, "...(planV2 !== null ? planV2.summary : {}),");
});
