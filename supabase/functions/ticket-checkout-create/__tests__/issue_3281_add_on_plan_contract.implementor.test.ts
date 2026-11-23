/**
 * issue #3281 S5 — add-ons on a v2 trip plan through the #3859 contract path,
 * and the provider line descriptions for add-ons.
 *
 * Inert while add_on_rollout.plan_enabled is off: the database never marks a
 * plan `addOnsOnPlan`, so add-ons with plan rows keep the legacy refusal, and a
 * cart without add-ons sends no new provider field.
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { canonicalCheckoutV2FingerprintInput } from "../../../../packages/offering-rendering/ticketCheckoutServerContract.ts";
import { replayedSessionExtras } from "../replayedSessionExtras.ts";

import {
  addOnsRideContractPlan,
  parseTripPlanV2ContractPlan,
  TripPlanV2ContractError,
} from "../tripPlanV2Contract.ts";
import {
  ADD_ON_DESCRIPTION_MAX,
  addOnLineDescriptions,
  hostedLineDescription,
  paystackAddOnCustomFields,
} from "../addOnLineDescriptions.ts";

const PACKAGE = "32815000-0000-4000-8500-000000000011";

const row = (ordinal: number, amountCents: number, addonPortionCents: number) => ({
  ordinal,
  pct: 25,
  amountCents,
  dueAt: `2027-0${ordinal}-10T09:00:00Z`,
  addonPortionCents,
  sourceTicketTypeId: PACKAGE,
});

const plan = (extra: Record<string, unknown>, rows = [row(1, 50000, 20000), row(2, 50000, 20000), row(3, 50000, 20000)]) => ({
  dueTodayNetCents: 30000,
  dueTodayListCents: 30000,
  installmentSchedule: { installments: rows },
  planVersion: 2,
  availability: "plan",
  countOffered: 3,
  countGiven: 3,
  finalDueAt: "2027-03-10T09:00:00Z",
  ...extra,
});

Deno.test("#3281 S5 a plan the database did not put add-ons on keeps the legacy refusal", () => {
  const legacy = parseTripPlanV2ContractPlan(plan({ addonScheduledCents: 0 }, [row(1, 30000, 0)]));
  assertEquals(legacy?.addOnsOnPlan, false);
  assertEquals(legacy?.addOnScheduledCents, 0);
  assertEquals(addOnsRideContractPlan(legacy, 60000, true), "refuse");
  assertEquals(addOnsRideContractPlan(null, 60000, true), "refuse");
  // No add-ons, or no plan rows: nothing to decide.
  assertEquals(addOnsRideContractPlan(legacy, 0, true), "none");
  assertEquals(addOnsRideContractPlan(legacy, 60000, false), "none");
});

Deno.test("#3281 S5 spread add-ons on the rows are read and must match the rows' shares", () => {
  const spread = parseTripPlanV2ContractPlan(
    plan({ addOnsOnPlan: true, extrasTotalCents: 60000, addonScheduledCents: 60000 }),
  );
  assertEquals(spread?.addOnsOnPlan, true);
  assertEquals(spread?.addOnScheduledCents, 60000);
  assertEquals(addOnsRideContractPlan(spread, 60000, true), "on_plan");
  // Today: nothing scheduled, the add-ons join today's charge.
  const today = parseTripPlanV2ContractPlan(
    plan({ addOnsOnPlan: true, extrasTotalCents: 60000, addonScheduledCents: 0 }, [
      row(1, 30000, 0),
      row(2, 30000, 0),
      row(3, 30000, 0),
    ]),
  );
  assertEquals(today?.addOnScheduledCents, 0);
  assertEquals(addOnsRideContractPlan(today, 60000, true), "on_plan");
  // A scheduled total that disagrees with the rows fails closed.
  assertThrows(
    () =>
      parseTripPlanV2ContractPlan(
        plan({ addOnsOnPlan: true, addonScheduledCents: 59900 }),
      ),
    TripPlanV2ContractError,
  );
  assertThrows(
    () => parseTripPlanV2ContractPlan(plan({ addOnsOnPlan: true, addonScheduledCents: "60000" })),
    TripPlanV2ContractError,
  );
});

Deno.test("#3281 S5 I-ADDON-PLAN-SUM: today's charge plus the rows is tickets plus add-ons", () => {
  for (const addonScheduledCents of [0, 60000]) {
    const per = addonScheduledCents / 3;
    const parsed = parseTripPlanV2ContractPlan(
      plan({ addOnsOnPlan: true, extrasTotalCents: 60000, addonScheduledCents }, [
        row(1, 30000 + per, per),
        row(2, 30000 + per, per),
        row(3, 30000 + per, per),
      ]),
    )!;
    // The edge's arithmetic: deposit + every add-on not already on the rows.
    const dueToday = parsed.dueTodayCents + 60000 - parsed.addOnScheduledCents;
    const rows = parsed.scheduled.reduce((sum, r) => sum + r.amountCents, 0);
    assertEquals(dueToday + rows, 120000 + 60000);
  }
});

Deno.test("#3281 the payment page lists each add-on as 'Add-on: {name} × {qty}'", () => {
  const lines = addOnLineDescriptions([
    { addOnName: "Airport transfer", quantity: 2, totalCents: 60000 },
    { addOnName: "  Tote bag ", quantity: 1 },
    { addOnName: "", quantity: 1 },
    { addOnName: "Broken", quantity: 0 },
    null,
  ]);
  assertEquals(lines, ["Add-on: Airport transfer × 2", "Add-on: Tote bag × 1"]);
  assertEquals(addOnLineDescriptions(undefined), []);
  assertEquals(
    hostedLineDescription("Includes Early bird (−$10.00)", lines),
    "Includes Early bird (−$10.00) · Add-on: Airport transfer × 2 · Add-on: Tote bag × 1",
  );
  assertEquals(hostedLineDescription(null, lines), lines.join(" · "));
  assertEquals(
    paystackAddOnCustomFields(lines),
    [
      { display_name: "Add-on", variable_name: "mingla_add_on_1", value: "Add-on: Airport transfer × 2" },
      { display_name: "Add-on", variable_name: "mingla_add_on_2", value: "Add-on: Tote bag × 1" },
    ],
  );
  const long = hostedLineDescription(null, Array.from({ length: 40 }, (_, i) => `Add-on: Item ${i} × 1`));
  assertEquals(long?.length, ADD_ON_DESCRIPTION_MAX);
});

Deno.test("#3281 a cart without add-ons sends no new provider field", () => {
  assertEquals(hostedLineDescription(null, []), undefined);
  assertEquals(
    hostedLineDescription("Includes Early bird (−$10.00)", []),
    "Includes Early bird (−$10.00)",
  );
  assertEquals(paystackAddOnCustomFields([]), []);
});

// ── issue #4522 E-4: a replayed add-on cart keeps its add-ons ─────────────────

const SESSION = "45220000-0000-4000-8000-0000000e4a01";
const ADD_ON = "45220000-0000-4000-8000-0000000e4a02";
const addOnRows = [{
  ticket_add_on_id: ADD_ON, ticket_type_id: PACKAGE, add_on_name_at_purchase: "Airport transfer",
  ticket_type_name_at_purchase: "Shared room", day_scope: null, quantity: 1, unit_price_cents: 4500, total_cents: 4500,
}];
const rows = (data: unknown, error: { message: string } | null = null) => () =>
  Promise.resolve({ data, error });

/** The fingerprint the create binds, from what a session says it priced. */
const boundFingerprint = (session: Record<string, unknown>): string => {
  const extrasTotalCents = Number(session.extrasTotalCents ?? 0);
  const fullPriceCents = 120000 + extrasTotalCents;
  return canonicalCheckoutV2FingerprintInput({
    eventId: "45220000-0000-4000-8000-0000000e4a03",
    checkoutAttemptId: "45220000-0000-4000-8000-0000000e4a04",
    purchaseTermsAccepted: true,
    buyer: { userId: null, name: "Sam", email: "sam@example.test", phoneE164: "+15555550143", marketingOptIn: true },
    providerInput: { surface: "web" },
    lines: [{ ticketTypeId: PACKAGE, quantity: 1, unitPriceCents: 120000, totalCents: 120000, paymentPlanChoice: "installments",
      addOns: [{ addOnId: ADD_ON, quantity: 1 }], addonPaymentMode: "spread" }],
    eventDateId: null,
    eventDateIds: [],
    intakeFormData: [],
    quote: { currency: "USD", fullPriceCents, dueTodayCents: 30000, installmentSchedule: { fullPriceCents } },
  });
};

Deno.test("#4522 E-4 a replayed session's add-ons are read from its rows, in the create's shape", async () => {
  const replayed = await replayedSessionExtras(rows(addOnRows));
  assertEquals(replayed, {
    extras: [{ addOnId: ADD_ON, ticketTypeId: PACKAGE, addOnName: "Airport transfer", ticketName: "Shared room",
      dayScope: null, quantity: 1, unitPriceCents: 4500, totalCents: 4500 }],
    extrasTotalCents: 4500,
  });
  // a cart without add-ons replays with none; an unreadable answer is never a guessed 0
  assertEquals(await replayedSessionExtras(rows([])), { extras: [], extrasTotalCents: 0 });
  assertEquals(await replayedSessionExtras(rows(null, { message: "boom" })), null);
});

Deno.test("#4522 E-4 an unchanged add-on cart replays to the fingerprint its first call bound", async () => {
  const firstCall = { checkoutSessionId: SESSION, totalCents: 120000, extras: [], extrasTotalCents: 4500 };
  // issue_3859_resolve_checkout_attempt's shape: no extras at all
  const resolved: Record<string, unknown> = { checkoutSessionId: SESSION, totalCents: 120000 };
  assertNotEquals(boundFingerprint(resolved), boundFingerprint(firstCall)); // the E-4 cause
  const replayed = await replayedSessionExtras(rows(addOnRows));
  assert(replayed !== null);
  assertEquals(boundFingerprint({ ...resolved, ...replayed }), boundFingerprint(firstCall));
});

Deno.test("#4522 E-4 the create reads a replayed session's add-ons before it prices the contract", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const recover = source.indexOf("await replayedSessionExtras(() =>");
  assert(source.includes('supabase.from("ticket_checkout_session_add_on_items")\n          .select(REPLAY_EXTRAS_COLUMNS)\n          .eq("checkout_session_id", checkoutSessionId)'));
  const resolveArm = source.lastIndexOf("resolvedAttempt.data !== null", recover);
  const priced = source.indexOf("const extrasTotalCents = Number(session.extrasTotalCents ?? 0);");
  const bind = source.indexOf('"issue_3859_bind_checkout_contract"', priced);
  assert(resolveArm > 0 && recover > resolveArm, "only the replay arm recovers extras");
  assert(priced > recover && bind > priced, "extras are recovered before the contract is priced and bound");
});
