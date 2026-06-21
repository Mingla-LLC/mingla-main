// META-ORCH-1174 Leg B3 [trip-page multi-package selector] — implementor-owned
// BEHAVIORAL test for the RN-free §10 selection + money math (tripBoxTotals). These
// run under the offering-rendering deno harness (deno std assert + Deno.test, the
// same style as meta_orch_1174_trip_standardize.test.ts). The math is the SINGLE
// OWNER the §10 box + the floating bar + the cart-seed all read.
//
// FAILS-ON-REVERT (proven by TRUE LINE DELETION in the implementation report):
//   • drop the `priceAllInCents ?? priceCents` coalesce in tripTierUnitAllInCents →
//     the "uses server all-in, not bare base" assertion FAILS.
//   • drop the per-line installments branch in tripSummedDueTodayCents → the
//     "per-line payment plan in summed due-today" assertion FAILS.
//   • widen clampTripTierQuantity past remaining → the "qty clamp to remaining" FAILS.
//   • drop the "From {min}" empty-state (tripMinTierAllInCents) → the bar-label test FAILS.

import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  clampTripTierQuantity,
  tripTierEffectiveMax,
  tripTierUnitAllInCents,
  tripMinTierAllInCents,
  tripSelectedLines,
  tripTotalSelectedQuantity,
  tripSummedAllInCents,
  tripSummedDueTodayCents,
  tripAnyLineOnPlan,
  type TripTierLike,
} from "../tripBoxTotals.ts";

// ── fixtures ──────────────────────────────────────────────────────────────
// A SYNTHETIC pass-fee fixture (per memory ORCH-1147 gotcha): all-in > base, so the
// summed all-in is PROVABLY the server value, not the bare base. base 50000 / all-in
// 53000 (a 6% passed fee). Standard (paid), VIP (paid + plan), Free.
const standard: TripTierLike = {
  ticketTypeId: "tt_std",
  priceCents: 50000,
  priceAllInCents: 53000,
  isFree: false,
  isUnlimited: false,
  ticketsRemaining: 20,
  installmentSchedule: null,
};
const vip: TripTierLike = {
  ticketTypeId: "tt_vip",
  priceCents: 100000,
  priceAllInCents: 106000,
  isFree: false,
  isUnlimited: false,
  ticketsRemaining: 3,
  // 25% deposit plan → deposit = 25% of the line all-in.
  installmentSchedule: { deposit_pct: 25, installments: [{ ordinal: 1, pct: 75 }] },
};
const free: TripTierLike = {
  ticketTypeId: "tt_free",
  priceCents: 0,
  priceAllInCents: null,
  isFree: true,
  isUnlimited: true,
  ticketsRemaining: null,
  installmentSchedule: null,
};
const tiers = [standard, vip, free];

// ── all-in is SERVER-sourced, never the bare base ──────────────────────────
Deno.test("B3 per-unit all-in uses the server all-in (priceAllInCents), not base", () => {
  assertEquals(tripTierUnitAllInCents(standard), 53000); // NOT 50000 base
  assertEquals(tripTierUnitAllInCents(vip), 106000); // NOT 100000 base
  assertEquals(tripTierUnitAllInCents(free), 0); // free → 0
});

Deno.test("B3 missing all-in falls back to base (RPC miss / no all-in)", () => {
  const noAllIn: TripTierLike = { ...standard, priceAllInCents: null };
  assertEquals(tripTierUnitAllInCents(noAllIn), 50000); // falls back to base
});

// ── summed all-in across selected lines (DEC-B multi-line) ─────────────────
Deno.test("B3 summed all-in = Σ(server all-in × qty) across selected lines", () => {
  // Standard ×1 + VIP ×2 = 53000 + 2×106000 = 265000.
  const qty = { tt_std: 1, tt_vip: 2 };
  assertEquals(tripSummedAllInCents(tiers, qty), 265000);
  assertEquals(tripTotalSelectedQuantity(qty), 3);
});

Deno.test("B3 free package is selectable + contributes 0 to the all-in", () => {
  const qty = { tt_free: 2, tt_std: 1 };
  assertEquals(tripSummedAllInCents(tiers, qty), 53000); // free adds 0
  const lines = tripSelectedLines(tiers, qty);
  assert(lines.some((l) => l.ticketTypeId === "tt_free" && l.quantity === 2));
});

// ── per-tier qty clamp to remaining (DEC-C qty>1; DEC-D per-package capacity) ─
Deno.test("B3 qty clamps to the tier's own remaining capacity", () => {
  assertEquals(tripTierEffectiveMax(vip), 3); // VIP has 3 remaining
  assertEquals(clampTripTierQuantity(vip, 5), 3); // request 5 → clamped to 3
  assertEquals(clampTripTierQuantity(standard, 4), 4); // 4 ≤ 20 remaining → 4 (qty>1 ok)
  assertEquals(clampTripTierQuantity(standard, -2), 0); // negative → 0
  assertEquals(clampTripTierQuantity(free, 7), 7); // unlimited → up to 99 ceiling
});

Deno.test("B3 a sold-out tier clamps every request to 0", () => {
  const soldOut: TripTierLike = { ...standard, ticketsRemaining: 0 };
  assertEquals(tripTierEffectiveMax(soldOut), 0);
  assertEquals(clampTripTierQuantity(soldOut, 3), 0);
});

// ── per-line payment-plan choice in the summed due-today (DEC-F) ────────────
Deno.test("B3 summed due-today: plan line → deposit; full/no-plan lines → full", () => {
  // Standard ×1 (no plan → full 53000) + VIP ×2 (plan, paying over time → deposit).
  // VIP line all-in = 2×106000 = 212000; 25% deposit = 53000.
  const qty = { tt_std: 1, tt_vip: 2 };
  const planChoice = { tt_vip: "installments" as const };
  assertEquals(
    tripSummedDueTodayCents(tiers, qty, planChoice),
    53000 + 53000, // Standard full + VIP deposit
  );
  assert(tripAnyLineOnPlan(tiers, qty, planChoice));
});

Deno.test("B3 plan line paying IN FULL contributes its full all-in to due-today", () => {
  // VIP ×2 paying in full → full 212000 (NOT the deposit).
  const qty = { tt_vip: 2 };
  const planChoice = { tt_vip: "full" as const };
  assertEquals(tripSummedDueTodayCents(tiers, qty, planChoice), 212000);
  assert(!tripAnyLineOnPlan(tiers, qty, planChoice));
});

Deno.test("B3 selected lines carry per-line paymentPlanChoice only for plan tiers", () => {
  const qty = { tt_std: 1, tt_vip: 1 };
  const planChoice = { tt_vip: "installments" as const };
  const lines = tripSelectedLines(tiers, qty, planChoice);
  const std = lines.find((l) => l.ticketTypeId === "tt_std");
  const v = lines.find((l) => l.ticketTypeId === "tt_vip");
  // Standard has no plan → no paymentPlanChoice key emitted.
  assertEquals(std?.paymentPlanChoice, undefined);
  // VIP has a plan → the explicit choice rides the line.
  assertEquals(v?.paymentPlanChoice, "installments");
});

// ── bar label "From {min all-in}" empty-state (DEC-J) ──────────────────────
Deno.test("B3 'From {min}' uses the minimum SELLABLE per-unit all-in", () => {
  // Min sellable all-in across {Standard 53000, VIP 106000, Free 0} = 0 (free).
  assertEquals(tripMinTierAllInCents(tiers), 0);
  // Without the free tier, the min is Standard's all-in 53000 (NOT base 50000).
  assertEquals(tripMinTierAllInCents([standard, vip]), 53000);
});

Deno.test("B3 'From {min}' skips sold-out tiers", () => {
  const cheapSoldOut: TripTierLike = {
    ...standard,
    ticketTypeId: "tt_cheap",
    priceAllInCents: 10000,
    ticketsRemaining: 0,
  };
  // The cheap tier is sold out → excluded; the min is VIP's 106000.
  assertEquals(tripMinTierAllInCents([cheapSoldOut, vip]), 106000);
});

// ── N=1 single-package parity (no regression) ──────────────────────────────
Deno.test("B3 N=1 single package: summed all-in == the one line's all-in", () => {
  const one = [standard];
  const qty = { tt_std: 2 };
  assertEquals(tripSummedAllInCents(one, qty), 106000); // 2 × 53000
  assertEquals(tripMinTierAllInCents(one), 53000); // bare all-in (the From base)
  const lines = tripSelectedLines(one, qty);
  assertEquals(lines.length, 1);
  assertEquals(lines[0]?.quantity, 2);
});
