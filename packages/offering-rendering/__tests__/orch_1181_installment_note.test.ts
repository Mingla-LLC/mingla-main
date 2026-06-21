// ORCH-1181 [trip-tile-installment] — implementor-owned BEHAVIORAL test for the
// RN-free per-package deposit-due-today helper + the shared installment sub-line
// copy formatter. Runs under the offering-rendering deno harness (deno std
// assert + Deno.test), same style as meta_orch_1174_legB3_multitier.test.ts.
//
// These two pure functions are the SINGLE OWNER of the cart-tile installment note
// that the business app, buyer web, AND the consumer app all render — the copy
// can never fork because all three import THIS formatter.
//
// FAILS-ON-REVERT:
//   • drop the deposit_pct-of-all-in math in tripTierDepositTodayCents → the
//     "deposit is deposit_pct of the all-in subtotal" assertion FAILS.
//   • return a non-null note for null/0 deposit → the "no note when nothing due"
//     assertion FAILS.
//   • change the "From {x} today · pay over time" copy → the exact-string FAILS.

import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  tripTierDepositTodayCents,
  formatTripTierInstallmentNote,
  type TripTierLike,
} from "../tripBoxTotals.ts";

// A test currency formatter (major units → string), shaped like each surface's
// host formatCurrency. Fixed locale so the assertion is deterministic.
const fmt = (value: number, currency: string): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);

// SYNTHETIC pass-fee plan fixture (memory ORCH-1147: 0/8 live brands set plans).
// base 50000 / all-in 53000 (6% passed fee); 25% deposit plan.
const planTier: TripTierLike = {
  ticketTypeId: "tt_plan",
  priceCents: 50000,
  priceAllInCents: 53000,
  isFree: false,
  isUnlimited: false,
  ticketsRemaining: 20,
  installmentSchedule: {
    deposit_pct: 25,
    installments: [{ ordinal: 1, pct: 75, days_after_booking: 30 }],
  },
};

const noPlanTier: TripTierLike = {
  ticketTypeId: "tt_std",
  priceCents: 40000,
  priceAllInCents: 42000,
  isFree: false,
  isUnlimited: false,
  ticketsRemaining: 20,
  installmentSchedule: null,
};

const freePlanTier: TripTierLike = {
  ticketTypeId: "tt_free",
  priceCents: 0,
  priceAllInCents: null,
  isFree: true,
  isUnlimited: true,
  ticketsRemaining: null,
  installmentSchedule: {
    deposit_pct: 25,
    installments: [{ ordinal: 1, pct: 75, days_after_booking: 30 }],
  },
};

// ── formatter copy ──────────────────────────────────────────────────────────

Deno.test("formatTripTierInstallmentNote — exact copy on a real deposit", () => {
  // 12500 cents = $125.00.
  assertEquals(
    formatTripTierInstallmentNote(12500, "USD", fmt),
    "From $125.00 today · pay over time",
  );
});

Deno.test("formatTripTierInstallmentNote — null/0 deposit → null (no note)", () => {
  assertEquals(formatTripTierInstallmentNote(null, "USD", fmt), null);
  assertEquals(formatTripTierInstallmentNote(0, "USD", fmt), null);
  assertEquals(formatTripTierInstallmentNote(-100, "USD", fmt), null);
  assertEquals(formatTripTierInstallmentNote(Number.NaN, "USD", fmt), null);
});

// ── per-package deposit-due-today ────────────────────────────────────────────

Deno.test("tripTierDepositTodayCents — deposit is deposit_pct of the all-in subtotal (qty 1)", () => {
  // 25% of 53000 (the all-in, NOT the 50000 base) = 13250.
  assertEquals(tripTierDepositTodayCents(planTier, 1), 13250);
});

Deno.test("tripTierDepositTodayCents — scales by quantity", () => {
  // 25% of (53000 × 2 = 106000) = 26500.
  assertEquals(tripTierDepositTodayCents(planTier, 2), 26500);
});

Deno.test("tripTierDepositTodayCents — no plan / qty 0 / free → null", () => {
  assertEquals(tripTierDepositTodayCents(noPlanTier, 1), null);
  assertEquals(tripTierDepositTodayCents(planTier, 0), null);
  assertEquals(tripTierDepositTodayCents(freePlanTier, 1), null);
});

// ── end-to-end: helper → formatter (what each surface does) ──────────────────

Deno.test("plan tier → note; no-plan tier → null (events untouched)", () => {
  const planNote = formatTripTierInstallmentNote(
    tripTierDepositTodayCents(planTier, 1),
    "USD",
    fmt,
  );
  assert(planNote !== null);
  assertEquals(planNote, "From $132.50 today · pay over time");

  const noPlanNote = formatTripTierInstallmentNote(
    tripTierDepositTodayCents(noPlanTier, 3),
    "USD",
    fmt,
  );
  assertEquals(noPlanNote, null);
});
