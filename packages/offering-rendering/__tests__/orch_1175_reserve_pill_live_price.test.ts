// ORCH-1175 [reserve-pill-live-price] — implementor-owned. The floating reserve
// pill + the SPLIT control prices must reflect the LIVE qty-scaled selected total
// (the same value the §10 box + the docked bar show), never a per-unit figure.
//
// Two halves, both fails-on-revert via TRUE line deletion:
//   (A) BEHAVIORAL (pure math, deno) — the summed all-in / due-today the hook's
//       split labels now read scale with quantity and use the SERVER all-in (not
//       bare base). A synthetic pass-fee fixture (all-in > base) proves the summed
//       value is provably > qty×base, per the ORCH-1147 "0/8 brands pass a fee"
//       gotcha (equal-fee fixtures prove nothing).
//   (B) SOURCE-CONTRACT (deno readfile) — TripReserveBar's floating pill renders
//       the live `cta.price`, and useTripOfferingState wires the split full/over-time
//       prices to the SUMMED labels when ≥1 selected (falling back to unit at 0).

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  tripSummedAllInCents,
  tripSummedDueTodayCents,
  tripTierUnitAllInCents,
  type TripTierLike,
} from "../tripBoxTotals.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// ── synthetic PASS-FEE fixture: all-in > base, so the summed all-in is PROVABLY
//    the server value (not the bare base). base 50000 / all-in 53000 (6% passed). ──
const standard: TripTierLike = {
  ticketTypeId: "tt_std",
  priceCents: 50000,
  priceAllInCents: 53000,
  isFree: false,
  isUnlimited: false,
  ticketsRemaining: 20,
  installmentSchedule: null,
};
// A PLAN tier (25% deposit) for the over-time split-label adversarial.
const plan: TripTierLike = {
  ticketTypeId: "tt_plan",
  priceCents: 100000,
  priceAllInCents: 106000,
  isFree: false,
  isUnlimited: false,
  ticketsRemaining: 10,
  installmentSchedule: { deposit_pct: 25, installments: [{ ordinal: 1, pct: 75 }] },
};

// ── (A) HAPPY — qty 2 on a 2-tier fixture: the summed all-in the split "Pay in
//    full" label reads is qty-scaled AND provably > 1× unit (and > qty×base). ──
Deno.test("ORCH-1175 happy — split full price uses the qty-scaled SUMMED all-in (> 1× unit, > qty×base)", () => {
  const tiers = [standard, plan];
  const unit = tripTierUnitAllInCents(standard); // 53000 (server all-in, not 50000 base)
  assertEquals(unit, 53000);
  // Select qty 2 of standard → the summed all-in the split label reads.
  const summed = tripSummedAllInCents(tiers, { tt_std: 2 });
  assertEquals(summed, 106000); // 2 × 53000
  // It scales with qty (NOT the flat unit) ...
  assert(summed > unit, "summed all-in must exceed the per-unit value (qty-scaled)");
  // ... and is provably the SERVER all-in, not qty × bare base (2×50000 = 100000).
  assert(
    summed > standard.priceCents * 2,
    "summed all-in must exceed qty × bare base (proves the server fee-grossed all-in)",
  );
});

// ── (A) ADVERSARIAL — single PLAN tier, qty 2, paying over time: the split
//    "Pay over time" deposit the label reads is the qty-scaled summed due-today
//    (NOT the unit deposit). "Pay in full" reads the qty-scaled summed all-in. ──
Deno.test("ORCH-1175 adversarial — over-time split deposit is the qty-scaled summed due-today (not unit)", () => {
  const tiers = [plan];
  const qty = { tt_plan: 2 };
  const installments = { tt_plan: "installments" as const };
  // Full all-in for qty 2 = 2 × 106000 = 212000 (what "Pay in full" reads).
  assertEquals(tripSummedAllInCents(tiers, qty), 212000);
  // Due-today (deposit) for qty 2 = 25% of 212000 = 53000 (what "Pay over time"
  // reads) — NOT the UNIT deposit (25% of 106000 = 26500).
  const summedDueToday = tripSummedDueTodayCents(tiers, qty, installments);
  assertEquals(summedDueToday, 53000);
  const unitDeposit = Math.round((tripTierUnitAllInCents(plan) * 25) / 100); // 26500
  assert(
    summedDueToday > unitDeposit,
    "the over-time deposit must be the qty-scaled summed deposit, not the unit deposit",
  );
  assertEquals(summedDueToday, unitDeposit * 2);
});

// ── (B) SOURCE — the FLOATING pill renders the live price (Fix 1a) ──
Deno.test("ORCH-1175 §1a — the floating reserve pill renders the live cta.price", async () => {
  const bar = strip(await read("../TripReserveBar.tsx"));
  // A `floatPrice` style exists next to floatCta.
  assertStringIncludes(bar, "floatPrice:");
  // The floating button (floatBody) gates a price Text on `price.length > 0` and
  // renders {price} — the SAME live value the docked bar reads.
  assert(
    /floatBody[\s\S]*?price\.length > 0 \?[\s\S]*?styles\.floatPrice[\s\S]*?\{price\}/.test(
      bar,
    ),
    "the floating pill must render a floatPrice Text with {price} when price.length > 0",
  );
  // The label still renders after it (the pill reads "$X · Reserve my spot →").
  assert(
    /styles\.floatPrice[\s\S]*?\{cta\.label\} →/.test(bar),
    "the floating pill must still render the {cta.label} → after the price",
  );
});

// ── (B) SOURCE — the split labels read the SUMMED qty-scaled values (Fix 1b) ──
Deno.test("ORCH-1175 §1b — split full/over-time prices use the summed labels when ≥1 selected", async () => {
  const sm = strip(await read("../useTripOfferingState.ts"));
  // priceLabel (full) → summedAllInLabel when totalSelected > 0, else unit.
  assert(
    /priceLabel\s*=\s*\n?\s*totalSelected > 0 \? \(summedAllInLabel \?\? unitPriceLabel\) : unitPriceLabel/.test(
      sm,
    ),
    "priceLabel must be summedAllInLabel when totalSelected>0, unitPriceLabel otherwise",
  );
  // depositLabel (over-time) → summedDueTodayLabel when totalSelected > 0, else unit.
  assert(
    /depositLabel\s*=\s*\n?\s*totalSelected > 0 \? \(summedDueTodayLabel \?\? unitDepositLabel\) : unitDepositLabel/.test(
      sm,
    ),
    "depositLabel must be summedDueTodayLabel when totalSelected>0, unitDepositLabel otherwise",
  );
  // The non-split bar + §10 box keep reading barPriceLabel/summedAllInLabel directly
  // (unaffected by the split change).
  assertStringIncludes(sm, "barPriceLabel");
  assertStringIncludes(sm, "summedAllInLabel");
});
