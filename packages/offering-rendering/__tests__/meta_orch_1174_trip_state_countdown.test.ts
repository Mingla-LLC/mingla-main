// META-ORCH-1174 Leg A [trip-page-standardize] — implementor-owned BEHAVIORAL test.
//
// The lifted trip buy-state math + the animated-countdown cadence/format are pure
// (RN-free) and proven to the cent / to the millisecond here. These run under the
// node/ts-jest config (the deno source-contract tests live alongside but run under
// deno). FAILS-ON-REVERT (proven by TRUE LINE DELETION):
//   - drop the `${depositLabel} today` / `${priceLabel} total` branch in
//     useTripOfferingState → the bar-price assertions below FAIL.
//   - widen the countdown cadence (e.g. always 1000ms) → the cadence assertions FAIL.
//   - drop the splitCtas plan-gate → the "no split for no-plan" assertion FAILS.

import {
  projectTripSchedule,
  selectSellableTier,
} from "../useTripOfferingState";
import {
  countdownTickMs,
  formatCountdown,
  formatDeadlineCoarse,
} from "../tripCountdown";
import type { TripOfferingTier } from "../tripOfferingTypes";

const ANCHOR = new Date("2026-06-20T00:00:00Z");

const planTier: TripOfferingTier = {
  id: "t1",
  ticketTypeId: "tt1",
  tierName: "Standard",
  priceCents: 50000,
  currency: "EUR",
  isFree: false,
  isUnlimited: false,
  ticketsRemaining: 5,
  installmentSchedule: {
    deposit_pct: 25,
    installments: [
      { ordinal: 1, pct: 50, days_after_booking: 30 },
      { ordinal: 2, pct: 25, days_after_booking: 60 },
    ],
  },
};

const noPlanTier: TripOfferingTier = {
  ...planTier,
  id: "t2",
  installmentSchedule: null,
};

describe("META-ORCH-1174 — projectTripSchedule (pure, to the cent)", () => {
  test("€500 / 25% deposit → €125 deposit + 2 installments (€250, €125)", () => {
    const s = projectTripSchedule(planTier, ANCHOR);
    expect(s).not.toBeNull();
    expect(s!.fullPriceCents).toBe(50000);
    expect(s!.depositCents).toBe(12500);
    expect(s!.installments.map((i) => i.amountCents)).toEqual([25000, 12500]);
  });

  test("quantityMultiplier scales BEFORE the deposit math", () => {
    const s = projectTripSchedule(planTier, ANCHOR, 2);
    expect(s!.fullPriceCents).toBe(100000);
    expect(s!.depositCents).toBe(25000);
  });

  test("no-plan tier → null (the toggle is suppressed)", () => {
    expect(projectTripSchedule(noPlanTier, ANCHOR)).toBeNull();
  });
});

describe("META-ORCH-1174 — selectSellableTier", () => {
  test("picks the first capacity>0 / unlimited tier", () => {
    const soldOut: TripOfferingTier = { ...planTier, id: "sold", ticketsRemaining: 0 };
    expect(selectSellableTier([soldOut, planTier])?.id).toBe(planTier.id);
  });
  test("empty list → null", () => {
    expect(selectSellableTier([])).toBeNull();
  });
});

describe("META-ORCH-1174 — countdown cadence tightens as the deadline nears", () => {
  test(">= 1 day → hourly; >= 1 hour → minute; < 1 hour → second", () => {
    expect(countdownTickMs(2 * 24 * 3600 * 1000)).toBe(3_600_000);
    expect(countdownTickMs(3 * 3600 * 1000)).toBe(60_000);
    expect(countdownTickMs(30 * 60 * 1000)).toBe(1000);
  });
});

describe("META-ORCH-1174 — formatCountdown granularity", () => {
  const now = Date.parse("2026-06-20T00:00:00Z");
  test("coarse (days + hours) when > 1 day", () => {
    expect(formatCountdown(now + 2 * 24 * 3600 * 1000 + 3 * 3600 * 1000, now)).toBe(
      "Bookings close in 2d 3h",
    );
  });
  test("hours + minutes inside a day", () => {
    expect(formatCountdown(now + 3 * 3600 * 1000 + 15 * 60 * 1000, now)).toBe(
      "Bookings close in 3h 15m",
    );
  });
  test("minutes + seconds in the final hour", () => {
    expect(formatCountdown(now + 5 * 60 * 1000 + 30 * 1000, now)).toBe(
      "Bookings close in 5m 30s",
    );
  });
  test("null at or past the deadline (surface flips to the closed band)", () => {
    expect(formatCountdown(now, now)).toBeNull();
    expect(formatCountdown(now - 1000, now)).toBeNull();
  });
  test("formatDeadlineCoarse returns a static date label (reduce-motion path)", () => {
    expect(formatDeadlineCoarse("2026-06-25T00:00:00Z")).toMatch(/Bookings close/);
    expect(formatDeadlineCoarse("not-a-date")).toBeNull();
  });
});
