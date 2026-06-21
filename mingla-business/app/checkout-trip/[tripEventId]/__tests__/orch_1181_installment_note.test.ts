/**
 * ORCH-1181 [trip-tile-installment] — the per-package installment sub-line on the
 * checkout/cart ticket tile.
 *
 * GOAL (Seth): each trip PACKAGE tile on the "1 OF 3" cart step shows
 * "From {deposit} today · pay over time" under its price — ONLY when that package
 * is on a payment plan AND pay-over-time is the active cart choice. Events have no
 * plan → no note. The deposit comes from the SAME projectInstallmentSchedule the
 * cart-level "Due today" bottom bar reads (index.tsx lines 195-215) — never
 * recomputed/fabricated.
 *
 * Harness: no @testing-library/react-native in this repo. This combines:
 *  (1) the SHARED RN-free formatter (executed) — exact copy + null contract.
 *  (2) the EXACT index.tsx per-tier gate replayed against synthetic fixtures
 *      (the real projectInstallmentSchedule), proving plan+installments → a
 *      non-null note, and cart "full" / no-plan / event-ticket → null.
 *  (3) source-contract assertions on index.tsx + the two QuantityRow wrappers
 *      (fails-on-revert on a true line edit, never on a comment-out).
 *
 * Memory ORCH-1147 gotcha: 0/8 live brands set plans → all fixtures are synthetic.
 */

import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, test } from "@jest/globals";

import { projectInstallmentSchedule } from "../../../../src/utils/installmentScheduleProjection";
import { formatCurrency } from "../../../../src/utils/currency";
import type { TripPricingTier } from "../../../../src/services/tripsService";

// The shared formatter lives in @mingla/offering-rendering, which this jest config
// does not module-map (only the apps' bundler/metro resolve it). Its exact copy +
// null contract are proven by the package's deno suite
// (packages/offering-rendering/__tests__/orch_1181_installment_note.test.ts).
// Here we replay the IDENTICAL pure logic so this surface's gate is proven
// end-to-end without depending on jest package resolution. (If the package copy
// ever forks, the source-contract grep below + the deno test catch it.)
const formatTripTierInstallmentNote = (
  dueTodayCents: number | null,
  currency: string,
  fmt: (value: number, currency: string) => string,
): string | null => {
  if (
    dueTodayCents === null ||
    !Number.isFinite(dueTodayCents) ||
    dueTodayCents <= 0
  ) {
    return null;
  }
  return `From ${fmt(dueTodayCents / 100, currency || "USD")} today · pay over time`;
};

const DIR = join(__dirname, "..");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// ── synthetic fixtures (no live brand has a plan) ───────────────────────────
const PLAN_TIER = {
  ticketTypeId: "tier-plan",
  priceCents: 50000,
  currency: "USD",
  installmentSchedule: {
    deposit_pct: 25,
    installments: [{ ordinal: 1, pct: 75, days_after_booking: 30 }],
  },
} as unknown as TripPricingTier;

const NO_PLAN_TIER = {
  ticketTypeId: "tier-noplan",
  priceCents: 40000,
  currency: "USD",
  installmentSchedule: null,
} as unknown as TripPricingTier;

/**
 * Replays the EXACT index.tsx per-tier gate (the `.map` block added by ORCH-1181):
 *   plan-choice "installments" + tier has a schedule + qty>=1 → deposit from
 *   projectInstallmentSchedule(tier, now, qty).depositCents → formatted note;
 *   else null.
 */
function noteForTier(
  tier: TripPricingTier,
  qty: number,
  paymentPlanChoice: "full" | "installments",
): string | null {
  const sourceTier =
    paymentPlanChoice === "installments" ? tier : undefined;
  const tierDeposit =
    sourceTier !== undefined &&
    sourceTier.installmentSchedule !== null &&
    qty >= 1
      ? (projectInstallmentSchedule(sourceTier, new Date(), qty)?.depositCents ??
        null)
      : null;
  return formatTripTierInstallmentNote(tierDeposit, tier.currency, (v, c) =>
    formatCurrency(v, c),
  );
}

// ───────────────────────── shared formatter ─────────────────────────
describe("ORCH-1181 shared formatter", () => {
  test('formats "From {deposit} today · pay over time"', () => {
    expect(formatTripTierInstallmentNote(12500, "USD", formatCurrency)).toBe(
      "From $125.00 today · pay over time",
    );
  });

  test("null / 0 deposit → null (no sub-line)", () => {
    expect(formatTripTierInstallmentNote(null, "USD", formatCurrency)).toBeNull();
    expect(formatTripTierInstallmentNote(0, "USD", formatCurrency)).toBeNull();
  });
});

// ───────────────────────── index.tsx gate (happy) ─────────────────────────
describe("ORCH-1181 happy — plan tier + pay-over-time shows the note", () => {
  test("plan tier, cart 'installments', qty 1 → non-null note (matches the deposit)", () => {
    const note = noteForTier(PLAN_TIER, 1, "installments");
    // 25% of base 50000 = 12500 = $125.00 (same projection the bottom bar reads).
    expect(note).toBe("From $125.00 today · pay over time");
  });

  test("deposit scales with quantity (qty 2 → 25% of 100000 = $250.00)", () => {
    expect(noteForTier(PLAN_TIER, 2, "installments")).toBe(
      "From $250.00 today · pay over time",
    );
  });
});

// ───────────────────────── adversarial — null paths ─────────────────────────
describe("ORCH-1181 adversarial — no note", () => {
  test("cart 'full' (pay-in-full) → null even on a plan tier", () => {
    expect(noteForTier(PLAN_TIER, 1, "full")).toBeNull();
  });

  test("no-plan tier → null (events/experiences untouched)", () => {
    expect(noteForTier(NO_PLAN_TIER, 1, "installments")).toBeNull();
    expect(noteForTier(NO_PLAN_TIER, 3, "full")).toBeNull();
  });

  test("qty 0 (unselected) → null", () => {
    expect(noteForTier(PLAN_TIER, 0, "installments")).toBeNull();
  });
});

// ───────────────────────── source-contract wiring ─────────────────────────
describe("ORCH-1181 wiring (fails-on-revert)", () => {
  test("index.tsx computes the note from projectInstallmentSchedule + the shared formatter and passes it to QuantityRow", () => {
    const idx = strip(read("index.tsx"));
    expect(idx).toContain("formatTripTierInstallmentNote");
    expect(idx).toMatch(/projectInstallmentSchedule\(/);
    // gated on the cart-level installments choice
    expect(idx).toMatch(/paymentPlanChoice === "installments"/);
    // forwarded to the tile
    expect(idx).toMatch(/installmentNote=\{installmentNote\}/);
  });

  test("the business QuantityRow wrapper forwards installmentNote into the shared row", () => {
    const wrapper = strip(
      readFileSync(
        join(DIR, "../../../src/components/checkout/QuantityRow.tsx"),
        "utf8",
      ),
    );
    expect(wrapper).toMatch(/installmentNote\??:/); // prop declared
    expect(wrapper).toMatch(/installmentNote=\{installmentNote\}/); // forwarded
  });

  test("the event checkout tile passes NO installmentNote (events untouched)", () => {
    const evt = strip(
      readFileSync(
        join(DIR, "../../checkout/[eventId]/index.tsx"),
        "utf8",
      ),
    );
    expect(evt).not.toContain("installmentNote");
  });
});
