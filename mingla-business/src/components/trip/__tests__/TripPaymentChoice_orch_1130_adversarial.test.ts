/**
 * ORCH-1130 [public trip page payment-structure + installments UX redesign] —
 * TESTER adversarial suite (append-only; tester-owned).
 *
 * Attacks a DIFFERENT angle than the implementor's happy-path
 * `TripPaymentChoice_orch_1130_regression.test.ts` (which is mostly
 * source-characterization string-matching + the EUR projection). This suite
 * bites on the EDGE / BOUNDARY / INVARIANT cases that gate the verdict:
 *
 *   1. qty=2 scaling invariant (SPEC §4 A8 + adversarial #4) — deposit +
 *      installment cents must scale ×N, NEVER the per-unit list price, and the
 *      sum of all legs must reconcile to the qty-scaled full price.
 *   2. Currency edge (SPEC adversarial #5) — a GBP plan trip formats £ (not €)
 *      with the SAME deposit math; the toggle's amounts flow through the shared
 *      `formatCurrency` minor-unit path, never a hardcoded glyph.
 *   3. Consent-value invariant (SPEC §4 B5 + adversarial #1/#2, DISC-1130-A) —
 *      the consumer native trip checkout MUST send an explicit
 *      `payment_plan_choice` for a plan trip (never 'auto') AND MUST omit the
 *      key for a no-plan trip (byte-identical request). The Path-A Review step
 *      forwards the key ONLY when `isPlanActive`. Proven by the EXACT gating
 *      expressions at all THREE consent sites (nativeCheckoutFlow body key,
 *      ExpandedBusinessEventSheet forward, ConsumerTripDetailScreen hasPlan
 *      gate, payment.tsx isPlanActive gate). No site may unconditionally pass
 *      the key, and no site may default a plan trip to 'auto'.
 *   4. Closed / free / no-plan suppression invariant (SPEC §4 A1/A4/A5/B4 +
 *      adversarial #3) — the selector/module is NEVER mounted for an unbuyable
 *      or no-plan trip on either path (no choosing a payment for a trip you
 *      cannot buy; no leaking a toggle onto a single-payment trip).
 *
 * Every assertion FAILS if the protected guard is reverted (proven on revert
 * during the TEST phase). Real-logic where possible; source-invariant only for
 * wiring the node-env harness cannot render (mingla-business jest is
 * ts-jest/node with no RN renderer).
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

import { formatCurrency } from "../../../utils/currency";
import { projectInstallmentSchedule } from "../../../utils/installmentScheduleProjection";
import type { TripPricingTier } from "../../../services/tripsService";

const read = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

// The live test trip: €500, 25% deposit + 50%@+30d + 25%@+60d (INVESTIGATE F-3).
const eurPlanTier: Pick<
  TripPricingTier,
  "priceCents" | "currency" | "installmentSchedule"
> = {
  priceCents: 50000,
  currency: "EUR",
  installmentSchedule: {
    deposit_pct: 25,
    installments: [
      { ordinal: 1, pct: 50, days_after_booking: 30 },
      { ordinal: 2, pct: 25, days_after_booking: 60 },
    ],
  },
};

// A GBP plan trip — different minor-unit / locale path than EUR.
const gbpPlanTier: Pick<
  TripPricingTier,
  "priceCents" | "currency" | "installmentSchedule"
> = {
  priceCents: 80000, // £800
  currency: "GBP",
  installmentSchedule: {
    deposit_pct: 25,
    installments: [
      { ordinal: 1, pct: 50, days_after_booking: 30 },
      { ordinal: 2, pct: 25, days_after_booking: 60 },
    ],
  },
};

const ANCHOR = new Date("2026-06-12T00:00:00Z");

// ------------------------------------------------------------------ //
// 1. qty=2 scaling invariant — deposit/installments scale ×N, reconcile.
// ------------------------------------------------------------------ //
describe("ORCH-1130 adversarial — qty scaling is ×N, never per-unit", () => {
  test("qty=2 EUR: full €1000, deposit €250, legs €500 + €250 — NOT the €500 list price", () => {
    const s = projectInstallmentSchedule(eurPlanTier, ANCHOR, 2);
    expect(s).not.toBeNull();
    // The bug this guards: rendering the per-unit list price (€500 / €125)
    // while the cart total is ×2. Deposit MUST be 25% of €1000 = €250.
    expect(s!.fullPriceCents).toBe(100000);
    expect(s!.depositCents).toBe(25000);
    expect(s!.installments.map((i) => i.amountCents)).toEqual([50000, 25000]);
    // Reconciliation invariant: deposit + all future legs === full (no cents lost/fabricated).
    const sum =
      s!.depositCents + s!.installments.reduce((a, i) => a + i.amountCents, 0);
    expect(sum).toBe(s!.fullPriceCents);
  });

  test("qty=1 deposit (€125) is strictly LESS than qty=2 deposit (€250) — proves the multiplier bites", () => {
    const one = projectInstallmentSchedule(eurPlanTier, ANCHOR, 1)!;
    const two = projectInstallmentSchedule(eurPlanTier, ANCHOR, 2)!;
    expect(one.depositCents).toBe(12500);
    expect(two.depositCents).toBe(25000);
    expect(two.depositCents).toBe(one.depositCents * 2);
  });

  test("malformed qty (0, NaN, -3, 1.9) clamps to ≥1 integer — never zeroes or fabricates amounts", () => {
    for (const bad of [0, NaN, -3]) {
      const s = projectInstallmentSchedule(eurPlanTier, ANCHOR, bad as number)!;
      expect(s.fullPriceCents).toBe(50000); // clamped to qty 1
      expect(s.depositCents).toBe(12500);
    }
    // fractional floors to 1 (not 1.9 → fabricated 1.9× amounts).
    const frac = projectInstallmentSchedule(eurPlanTier, ANCHOR, 1.9)!;
    expect(frac.fullPriceCents).toBe(50000);
  });
});

// ------------------------------------------------------------------ //
// 2. Currency edge — GBP formats £ with the same deposit math.
// ------------------------------------------------------------------ //
describe("ORCH-1130 adversarial — GBP plan trip formats £, not €", () => {
  test("GBP projection: full £800, deposit £200, legs £400 + £200", () => {
    const s = projectInstallmentSchedule(gbpPlanTier, ANCHOR, 1)!;
    expect(s.currency).toBe("GBP");
    expect(s.fullPriceCents).toBe(80000);
    expect(s.depositCents).toBe(20000); // 25% of £800
    expect(s.installments.map((i) => i.amountCents)).toEqual([40000, 20000]);
  });

  test("the toggle's amounts format with £ (and NO €) through formatCurrency minor-unit path", () => {
    const s = projectInstallmentSchedule(gbpPlanTier, ANCHOR, 1)!;
    const fullLabel = formatCurrency(s.fullPriceCents, s.currency, true);
    const depositLabel = formatCurrency(s.depositCents, s.currency, true);
    expect(fullLabel).toMatch(/£/);
    expect(fullLabel).not.toMatch(/€/);
    expect(fullLabel).toMatch(/800/);
    expect(depositLabel).toMatch(/£/);
    expect(depositLabel).toMatch(/200/);
    // Cross-currency: the EUR path of the SAME amounts uses €, proving the
    // glyph is data-driven (Constitution #10), not hardcoded.
    expect(formatCurrency(80000, "EUR", true)).toMatch(/€/);
  });

  test("TripPaymentChoice passes the tier currency through (no literal £/$/€ glyph in source)", () => {
    const src = read("src/components/trip/TripPaymentChoice.tsx");
    // formatCurrency is the only money formatter; the currency comes from props.
    expect(src).toContain("formatCurrency(");
    expect(src).toContain("currency");
    // No hardcoded currency glyph literal anywhere in the component body
    // (the JSDoc may mention them; assert the StyleSheet/JSX region is clean).
    // No hardcoded currency GLYPH (£/€/¥) in the component body. (We exclude
    // `$` from the class — it is a JS template-literal interpolation marker
    // here, not a currency symbol; the source uses ${fullLabel} etc.)
    const body = src.slice(src.indexOf("export const TripPaymentChoice"));
    expect(body).not.toMatch(/[£€¥]/);
  });
});

// ------------------------------------------------------------------ //
// 3. Consent-value invariant — explicit on plan, omitted on no-plan,
//    NEVER unconditional, NEVER 'auto' for a plan trip.
// ------------------------------------------------------------------ //
describe("ORCH-1130 adversarial — consent value reaching ticket-checkout-create", () => {
  const nativeFlow = (): string =>
    read("../app-mobile/src/payments/nativeCheckoutFlow.ts");
  const ebes = (): string =>
    read(
      "../app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx",
    );
  const screen = (): string =>
    read("../app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx");
  const payment = (): string =>
    read("app/checkout-trip/[tripEventId]/payment.tsx");

  test("nativeCheckoutFlow forwards payment_plan_choice ONLY when paymentPlanChoice is truthy (omit on absent)", () => {
    const src = nativeFlow();
    // The conditional-spread gate: present-only. A revert to an unconditional
    // `payment_plan_choice: input.paymentPlanChoice ?? 'auto'` would FAIL this.
    expect(src).toMatch(
      /\.\.\.\(\s*input\.paymentPlanChoice\s*\n?\s*\?\s*\{\s*payment_plan_choice:\s*input\.paymentPlanChoice\s*\}\s*:\s*\{\}\s*\)/,
    );
    // Hard negative: the consumer flow must NOT hardcode 'auto' into the body.
    const bodyRegion = src.slice(
      src.indexOf("invoke<CheckoutCreateResponse>"),
      src.indexOf("if (error)"),
    );
    expect(bodyRegion).not.toMatch(/payment_plan_choice:\s*['"]auto['"]/);
  });

  test("ExpandedBusinessEventSheet forwards the prop conditionally into runNativeCheckout", () => {
    const src = ebes();
    expect(src).toMatch(
      /\.\.\.\(\s*paymentPlanChoice\s*\?\s*\{\s*paymentPlanChoice\s*\}\s*:\s*\{\}\s*\)/,
    );
  });

  test("ConsumerTripDetailScreen passes the explicit choice ONLY for a plan trip (hasPlan gate); no-plan → undefined", () => {
    const src = screen();
    // [TEST-MOD-APPROVED ORCH-1138] assertion-drift refresh: ORCH-1138 ported
    // the consumer reserve flow off the duplicate <ExpandedBusinessEventSheet>
    // JSX onto an in-place `handleBuy` → `runNativeCheckout({...})` call, so the
    // hasPlan gate moved from a JSX prop (`paymentPlanChoice={...}`) to an
    // object property (`paymentPlanChoice: ...`). The consent invariant is
    // IDENTICAL — explicit choice forwarded ONLY for a plan trip, undefined for
    // no-plan. Still fails on revert (drop the gate → unconditional/auto).
    expect(src).toMatch(
      /paymentPlanChoice:\s*detail\.hasPlan\s*\?\s*paymentPlanChoice\s*:\s*undefined/,
    );
    // Default is "full" — a plan buyer who never touches the toggle still
    // sends an EXPLICIT "full", not a server-defaulted deposit-only 'auto'.
    expect(src).toMatch(
      /useState<\s*["']full["']\s*\|\s*["']installments["']\s*>\(\s*["']full["']\s*\)/,
    );
  });

  test("Path A Review forwards payment_plan_choice ONLY when isPlanActive (no-plan trip omits the key)", () => {
    const src = payment();
    // Both the tax-calc and the create call gate the key on isPlanActive.
    const gated = (
      src.match(/\.\.\.\(\s*isPlanActive\s*\?\s*\{\s*paymentPlanChoice:/g) ?? []
    ).length;
    expect(gated).toBeGreaterThanOrEqual(1);
    // No unconditional `payment_plan_choice` on the no-plan path.
    expect(src).not.toMatch(/payment_plan_choice:\s*['"]auto['"]/);
  });
});

// ------------------------------------------------------------------ //
// 4. Suppression invariant — no selector on closed / free / no-plan.
// ------------------------------------------------------------------ //
describe("ORCH-1130 adversarial — selector suppressed for unbuyable/no-plan trips", () => {
  test("no-plan tier projects null → TripPaymentChoice returns null (no toggle leaks onto single-payment trips)", () => {
    const noPlan = projectInstallmentSchedule(
      { priceCents: 50000, currency: "EUR", installmentSchedule: null },
      ANCHOR,
    );
    expect(noPlan).toBeNull();
    // And the component honours null-on-null (the early return guard).
    const src = read("src/components/trip/TripPaymentChoice.tsx");
    expect(src).toMatch(/if\s*\(\s*schedule\s*===\s*null\s*\)\s*return null/);
  });

  test("TripCheckoutFlow renders the recap (NOT the toggle) when projectedSchedule is null", () => {
    const src = read("src/components/trip/TripCheckoutFlow.tsx");
    // The no-plan branch returns the recap and the plan branch the toggle —
    // they are mutually exclusive on `projectedSchedule === null`.
    expect(src).toMatch(/projectedSchedule\s*===\s*null/);
    const nullBranch = src.slice(src.indexOf("projectedSchedule === null"));
    // The recap helper is in the null branch BEFORE the <TripPaymentChoice tag.
    const recapIdx = nullBranch.indexOf("recapHelper");
    const toggleIdx = nullBranch.indexOf("<TripPaymentChoice");
    expect(recapIdx).toBeGreaterThanOrEqual(0);
    expect(toggleIdx).toBeGreaterThan(recapIdx);
  });

  test("the payment toggle is gated on plan + !closed + bookable (never on an unbuyable trip)", () => {
    // [TEST-MOD-APPROVED META-ORCH-1174] retarget: the consumer screen's inline
    // payment-mockup + its `planSchedule/planTier/!closed/bookable` gate were
    // DELETED and lifted into the shared useTripOfferingState (one owner) +
    // TripOfferingBody (the §10 box). The same suppression invariant now lives
    // in the shared package: the hook derives `projectedSchedule` (null → no
    // plan), `isClosed`, and honours `bookable === false`; the body renders the
    // <TripPaymentChoice> toggle ONLY when projectedSchedule !== null && not
    // closed. Behavior preserved; assertion reads the new shared home. Still
    // fails on revert (drop the gate → these matches vanish).
    const hookSrc = read("../packages/offering-rendering/useTripOfferingState.ts");
    // The hook computes the plan schedule (null for no-plan), the closed flag,
    // and respects bookable === false.
    expect(hookSrc).toMatch(/projectedSchedule\s*=\s*\n?\s*selectedTier\s*!==\s*null/);
    expect(hookSrc).toMatch(/isClosed\s*=\s*data\.bookingsClosed\s*===\s*true/);
    expect(hookSrc).toMatch(/data\.bookable\s*===\s*false/);
    // The shared body gates the toggle on a non-null schedule AND not-closed.
    const bodySrc = read("../packages/offering-rendering/TripOfferingBody.tsx");
    expect(bodySrc).toMatch(
      /state\.projectedSchedule\s*!==\s*null\s*&&\s*state\.isClosed\s*===\s*false/,
    );
  });

  test("Path A Review gates the selector on isPlanActive (free/no-plan trip never shows the toggle at Review)", () => {
    const src = read("app/checkout-trip/[tripEventId]/payment.tsx");
    // The Review-step selector render is gated on isPlanActive AND a non-null
    // projected schedule AND a defined plan tier — a free/no-plan trip never
    // satisfies isPlanActive so the toggle never mounts at Review.
    expect(src).toMatch(
      /\{isPlanActive\s*&&\s*projectedSchedule\s*!==\s*null\s*&&\s*planTier\s*!==\s*undefined\s*\?\s*\(?\s*<TripPaymentChoice/,
    );
  });
});
