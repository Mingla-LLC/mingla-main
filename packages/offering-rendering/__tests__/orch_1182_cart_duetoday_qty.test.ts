// ORCH-1182 [cart-duetoday-qty] — implementor-owned BEHAVIORAL test proving the
// SINGLE-OWNER trip deposit math scales the "Due today" + the full "Total" with
// QUANTITY. Runs under the offering-rendering deno harness (deno std assert +
// Deno.test), same style as orch_1181_installment_note.test.ts.
//
// THE BUG (display-only WYSIWYP violation): the consumer cart's sticky bar showed
// "Due today €125,00" for a €500 / 25%-deposit tier at QTY 2 — it must be €250,00.
// The qty-scaled value already exists in the shared math (tripTierDepositTodayCents
// / tripSummedDueTodayCents); the screen was passing the qty-1 unit deposit. These
// assertions lock the math: the SAME single-owner helpers the cart sums over its
// live lines DO scale with qty.
//
// SYNTHETIC fixtures only — memory ORCH-1147: 0/8 live brands set plans, so prod
// data proves nothing about deposit math; we build the pass-fee + plan fixtures.
//
// FAILS-ON-REVERT:
//   • un-scale tripTierDepositTodayCents by qty → the "qty 2 → €250" assertion FAILS.
//   • un-scale tripSummedDueTodayCents / tripSummedAllInCents by qty → those FAIL.
//   • make the full Total the unit (not qty × all-in) → the Total assertion FAILS.

import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  tripTierDepositTodayCents,
  tripSummedDueTodayCents,
  tripSummedAllInCents,
  type TripTierLike,
} from "../tripBoxTotals.ts";

// The exact Seth fixture: a €500 "Standard" tier, 25% deposit. No passed fee here
// (all-in == base) so the deposit math is unambiguous against the screenshot
// numbers (€500 / €125 / €250). priceAllInCents == priceCents == 50000.
const standardTier: TripTierLike = {
  ticketTypeId: "tt_standard",
  priceCents: 50000,
  priceAllInCents: 50000,
  isFree: false,
  isUnlimited: false,
  ticketsRemaining: 20,
  installmentSchedule: {
    deposit_pct: 25,
    installments: [{ ordinal: 1, pct: 75, days_after_booking: 30 }],
  },
};

// A SECOND tier carrying a real passed fee (all-in 53000 > base 50000) so a mixed
// cart proves the deposit is deposit_pct of the ALL-IN, qty-scaled.
const premiumTier: TripTierLike = {
  ticketTypeId: "tt_premium",
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

// A no-plan full-price tier (events/experiences/pay-in-full lines).
const fullTier: TripTierLike = {
  ticketTypeId: "tt_full",
  priceCents: 8000,
  priceAllInCents: 8000,
  isFree: false,
  isUnlimited: false,
  ticketsRemaining: 20,
  installmentSchedule: null,
};

// ── §1 — the per-tier deposit (what the cart sums per line) scales with qty ──
Deno.test("§1 tripTierDepositTodayCents scales the deposit with quantity", () => {
  // qty 1 → 25% of €500 = €125 = 12500 cents (the value the screen WRONGLY froze).
  assertEquals(tripTierDepositTodayCents(standardTier, 1), 12500);
  // qty 2 → 25% of €1000 = €250 = 25000 cents (THE FIX — the Seth screenshot case).
  assertEquals(tripTierDepositTodayCents(standardTier, 2), 25000);
  // qty 3 → €375 = 37500 cents.
  assertEquals(tripTierDepositTodayCents(standardTier, 3), 37500);
});

// ── §2 — adversarial: qty 0 / negative / non-finite → null (no note, no due) ──
Deno.test("§2 qty 0 / negative / non-finite → null (no fabricated deposit)", () => {
  assertEquals(tripTierDepositTodayCents(standardTier, 0), null);
  assertEquals(tripTierDepositTodayCents(standardTier, -1), null);
  assertEquals(tripTierDepositTodayCents(standardTier, Number.NaN), null);
});

// ── §3 — the summed due-today (the cart-level "Due today") scales with qty ──
Deno.test("§3 tripSummedDueTodayCents scales each plan line's deposit by qty", () => {
  const tiers = [standardTier];
  // qty 1 → 12500; qty 2 → 25000 (matches the per-tier helper, the same owner).
  assertEquals(
    tripSummedDueTodayCents(tiers, { tt_standard: 1 }, { tt_standard: "installments" }),
    12500,
  );
  assertEquals(
    tripSummedDueTodayCents(tiers, { tt_standard: 2 }, { tt_standard: "installments" }),
    25000,
  );
});

// ── §4 — mixed cart: a plan line (deposit) + a full line (full all-in), qty>1 ──
Deno.test("§4 mixed plan + full lines: deposit for the plan line, full for the rest", () => {
  const tiers = [premiumTier, fullTier];
  // premium qty 2 on installments → deposit = 25% of (53000×2)=106000 → 26500.
  // full qty 3 (no plan) → full all-in 8000×3 = 24000.
  // due today = 26500 + 24000 = 50500.
  const due = tripSummedDueTodayCents(
    tiers,
    { tt_premium: 2, tt_full: 3 },
    { tt_premium: "installments" },
  );
  assertEquals(due, 50500);
  // The deposit is deposit_pct of the ALL-IN (53000), not the base (50000):
  // a base-derived deposit would be 25% of 100000 = 25000 ≠ 26500.
  assert(due !== 25000 + 24000, "deposit must be off the all-in, not the base");
});

// ── §5 — the full "Total" line is the QTY-SCALED all-in (Σ all-in × qty) ──
Deno.test("§5 tripSummedAllInCents is the qty-scaled total, not the unit", () => {
  const tiers = [standardTier];
  // qty 1 → 50000 (the unit all-in). qty 2 → 100000 (NOT the unit).
  assertEquals(tripSummedAllInCents(tiers, { tt_standard: 1 }), 50000);
  assertEquals(tripSummedAllInCents(tiers, { tt_standard: 2 }), 100000);
  // Mixed cart Total = Σ all-in × qty across lines.
  assertEquals(
    tripSummedAllInCents([premiumTier, fullTier], { tt_premium: 2, tt_full: 3 }),
    53000 * 2 + 8000 * 3, // 106000 + 24000 = 130000
  );
});

// ── §6 — a full line on a plan tier whose choice is "full" pays the FULL all-in ──
Deno.test("§6 a plan tier the buyer pays in FULL contributes its full all-in, not a deposit", () => {
  const tiers = [standardTier];
  // choice "full" (or no plan choice) → the line's full qty-scaled all-in, qty 2.
  assertEquals(
    tripSummedDueTodayCents(tiers, { tt_standard: 2 }, { tt_standard: "full" }),
    100000,
  );
});
