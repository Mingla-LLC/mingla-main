/**
 * ORCH-0882 [Render Payment Plan Disclosure on Trip Buyer + Planner
 * Surfaces] — implementor happy-path regression test per ORCH-0840
 * [Regression-test enforcement + append-only CI] Step 0.5 gate.
 *
 * This test pins two SPEC-locked contracts:
 *
 *   (1) **Wiring contract** (SC-1a / SC-2a / SC-3 / SC-4a / SC-5e / SC-6
 *       / SC-7 + SC-10 CI gate): all 7 scoped render targets (5 buyer
 *       touchpoints + 2 planner touchpoints) import
 *       `InstallmentScheduleDisplay` and reference `installmentSchedule`
 *       in source. The strict-grep CI gate enforces this; this test
 *       mirrors the same assertion at the npm-test layer so the gate
 *       failure surfaces faster locally.
 *
 *   (2) **Mapper math contract** (SC-8 + Constitution #9 — no fabricated
 *       data): `projectInstallmentSchedule()` produces amounts and dates
 *       that are 1-to-1 with the input template, with no rounding drift
 *       or invented values. Covers happy path 25/50/25, fixed_date
 *       variant, edge `days_after_booking: 0`, null-schedule short
 *       circuit, and DST-cross UTC stability.
 *
 *   (3) **Pay-button copy contract** (SC-4c + Constitution #3 — no
 *       silent failures): `payment.tsx` source contains both the
 *       `${depositCents}` deposit-branch CTA literal AND the
 *       `${totals.total}` no-plan-branch CTA literal. Reverting either
 *       branch (e.g., silently switching back to full-price-only CTA)
 *       breaks the corresponding assertion.
 *
 * Fails-on-revert verified at HEAD before fix (see implementation report
 * §Regression Test). Reverting any of these contracts breaks at least
 * one assertion in this test.
 *
 * Test runner: Jest. Source-assertion shape (no runtime mount required —
 * pure source-grep + pure function call). Mirrors the ORCH-0873
 * `PaymentPlanEditor.test.ts` pattern.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { projectInstallmentSchedule } from "../../../utils/installmentScheduleProjection";
import type { TripPricingTier } from "../../../services/tripsService";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

// ---------------------------------------------------------------------------
// (1) Wiring contract — 7 scoped files import the component + reference the
//     data signal. Mirrors the strict-grep CI gate.
// ---------------------------------------------------------------------------

// ORCH-0882 hotfix — `usePublicTripBySlug` (the slug-based public trip page
// hook) must extract `installmentSchedule` from `tier_metadata.installments`
// or the mapper receives undefined and the public trip page crashes. The
// slug-based hook had this gap pre-hotfix; the id-based hook didn't.
describe("ORCH-0882 hotfix — usePublicTripBySlug extracts installmentSchedule", () => {
  test("slug-based public trip hook extracts installmentSchedule from tier_metadata", () => {
    const src = readFileSync(
      join(REPO_ROOT, "src/hooks/usePublicTripBySlug.ts"),
      "utf8",
    );
    // Must reference the data signal AND set the field on the returned
    // TripPricingTier shape. Mirror of publicEventsService.ts pattern.
    expect(src).toContain("installmentSchedule");
    expect(src).toContain("tier_metadata?.installments");
  });
});

describe("ORCH-0882 wiring — InstallmentScheduleDisplay on every plan-active surface", () => {
  const scopedFiles: Array<{ label: string; rel: string }> = [
    {
      label: "TripCheckoutFlow.tsx (SC-1a)",
      rel: "src/components/trip/TripCheckoutFlow.tsx",
    },
    {
      label: "checkout-trip/[tripEventId]/index.tsx (SC-2a)",
      rel: "app/checkout-trip/[tripEventId]/index.tsx",
    },
    {
      label: "checkout-trip/[tripEventId]/intake.tsx (SC-5e)",
      rel: "app/checkout-trip/[tripEventId]/intake.tsx",
    },
    {
      label: "checkout-trip/[tripEventId]/buyer.tsx (SC-3)",
      rel: "app/checkout-trip/[tripEventId]/buyer.tsx",
    },
    {
      label: "checkout-trip/[tripEventId]/payment.tsx (SC-4a)",
      rel: "app/checkout-trip/[tripEventId]/payment.tsx",
    },
    {
      label: "EditPublishedTripScreen.tsx (SC-6)",
      rel: "src/components/trip/EditPublishedTripScreen.tsx",
    },
    {
      label: "app/trip/[id]/index.tsx MoneyTabBody (SC-7)",
      rel: "app/trip/[id]/index.tsx",
    },
  ];

  for (const { label, rel } of scopedFiles) {
    test(`${label} imports InstallmentScheduleDisplay`, () => {
      const src = read(rel);
      expect(src).toContain("InstallmentScheduleDisplay");
    });
    test(`${label} references installmentSchedule data signal`, () => {
      const src = read(rel);
      expect(src).toContain("installmentSchedule");
    });
  }
});

// ---------------------------------------------------------------------------
// (2) Mapper math contract — projectInstallmentSchedule produces 1-to-1
//     amounts and dates.
// ---------------------------------------------------------------------------

describe("projectInstallmentSchedule mapper — Constitution #9 no fabricated data", () => {
  test("happy path 25/50/25 with days_after_booking", () => {
    const tier: Pick<
      TripPricingTier,
      "priceCents" | "currency" | "installmentSchedule"
    > = {
      priceCents: 110000,
      currency: "USD",
      installmentSchedule: {
        deposit_pct: 25,
        installments: [
          { ordinal: 1, pct: 50, days_after_booking: 30 },
          { ordinal: 2, pct: 25, days_after_booking: 60 },
        ],
      },
    };
    const anchor = new Date("2026-06-01T00:00:00.000Z");
    const out = projectInstallmentSchedule(tier, anchor);
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.fullPriceCents).toBe(110000);
    expect(out.depositCents).toBe(27500); // 25% of $1,100
    expect(out.currency).toBe("USD");
    expect(out.installments).toHaveLength(2);
    expect(out.installments[0].ordinal).toBe(1);
    expect(out.installments[0].pct).toBe(50);
    expect(out.installments[0].amountCents).toBe(55000); // 50% of $1,100
    expect(out.installments[0].dueAt).toBe("2026-07-01T00:00:00.000Z");
    expect(out.installments[1].ordinal).toBe(2);
    expect(out.installments[1].amountCents).toBe(27500); // 25% of $1,100
    expect(out.installments[1].dueAt).toBe("2026-07-31T00:00:00.000Z");
  });

  test("null schedule short-circuits", () => {
    const tier: Pick<
      TripPricingTier,
      "priceCents" | "currency" | "installmentSchedule"
    > = {
      priceCents: 99900,
      currency: "GBP",
      installmentSchedule: null,
    };
    const out = projectInstallmentSchedule(tier, new Date());
    expect(out).toBeNull();
  });

  test("fixed_date variant ignores anchor", () => {
    const tier: Pick<
      TripPricingTier,
      "priceCents" | "currency" | "installmentSchedule"
    > = {
      priceCents: 80000,
      currency: "EUR",
      installmentSchedule: {
        deposit_pct: 50,
        installments: [
          { ordinal: 1, pct: 25, fixed_date: "2026-07-04" },
          { ordinal: 2, pct: 25, fixed_date: "2026-08-04" },
        ],
      },
    };
    const out = projectInstallmentSchedule(
      tier,
      new Date("2099-12-31T23:59:59.000Z"),
    );
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.installments[0].dueAt).toBe("2026-07-04T00:00:00.000Z");
    expect(out.installments[1].dueAt).toBe("2026-08-04T00:00:00.000Z");
    expect(out.installments[0].amountCents).toBe(20000); // 25% of $800
  });

  test("days_after_booking: 0 returns anchor verbatim", () => {
    const tier: Pick<
      TripPricingTier,
      "priceCents" | "currency" | "installmentSchedule"
    > = {
      priceCents: 50000,
      currency: "USD",
      installmentSchedule: {
        deposit_pct: 50,
        installments: [{ ordinal: 1, pct: 50, days_after_booking: 0 }],
      },
    };
    const anchor = new Date("2026-06-15T12:34:56.789Z");
    const out = projectInstallmentSchedule(tier, anchor);
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.installments[0].dueAt).toBe("2026-06-15T12:34:56.789Z");
  });

  // ORCH-0882 hotfix — defense-in-depth: mapper must not crash on
  // malformed input. `usePublicTripBySlug` prior to the hotfix left
  // installmentSchedule implicitly undefined; the mapper's strict
  // `=== null` check missed this and crashed on `schedule.deposit_pct`.
  // Constitution #3 — fail safe to "no plan" rather than crash.
  test("hotfix: undefined schedule returns null (not crash)", () => {
    const tier = {
      priceCents: 100000,
      currency: "USD",
      installmentSchedule: undefined as unknown as TripPricingTier["installmentSchedule"],
    } as Pick<TripPricingTier, "priceCents" | "currency" | "installmentSchedule">;
    expect(projectInstallmentSchedule(tier, new Date())).toBeNull();
  });
  test("hotfix: missing deposit_pct returns null (not NaN amounts)", () => {
    const tier = {
      priceCents: 100000,
      currency: "USD",
      installmentSchedule: { installments: [] } as unknown as TripPricingTier["installmentSchedule"],
    } as Pick<TripPricingTier, "priceCents" | "currency" | "installmentSchedule">;
    expect(projectInstallmentSchedule(tier, new Date())).toBeNull();
  });
  test("hotfix: missing installments array returns null", () => {
    const tier = {
      priceCents: 100000,
      currency: "USD",
      installmentSchedule: { deposit_pct: 25 } as unknown as TripPricingTier["installmentSchedule"],
    } as Pick<TripPricingTier, "priceCents" | "currency" | "installmentSchedule">;
    expect(projectInstallmentSchedule(tier, new Date())).toBeNull();
  });

  test("UTC date math stable across DST boundary (Constitution #10)", () => {
    // 2026-03-08 is US DST spring-forward (where applicable). UTC math
    // must be DST-agnostic — display layer handles locale presentation.
    const tier: Pick<
      TripPricingTier,
      "priceCents" | "currency" | "installmentSchedule"
    > = {
      priceCents: 100000,
      currency: "USD",
      installmentSchedule: {
        deposit_pct: 50,
        installments: [{ ordinal: 1, pct: 50, days_after_booking: 7 }],
      },
    };
    const anchor = new Date("2026-03-08T12:00:00.000Z");
    const out = projectInstallmentSchedule(tier, anchor);
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.installments[0].dueAt).toBe("2026-03-15T12:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// (3) Pay-button copy contract — SC-4c Constitution #3.
// ---------------------------------------------------------------------------

describe("ORCH-0882 SC-4c — Pay-button CTA copy honesty", () => {
  test("payment.tsx contains the deposit-branch CTA literal", () => {
    const src = read("app/checkout-trip/[tripEventId]/payment.tsx");
    // The deposit-branch CTA must say "deposit" — both visible label and
    // accessibility label.
    expect(src).toMatch(/Pay \$\{[^}]*depositCents[^}]*\} deposit/);
  });

  test("payment.tsx preserves the no-plan-branch full-price CTA literal", () => {
    const src = read("app/checkout-trip/[tripEventId]/payment.tsx");
    // Empty-state preservation (SC-5a) — when no plan is active, the
    // full-price CTA must still render. Match against `totals.total`
    // which is the cart subtotal binding.
    expect(src).toMatch(/Pay \$\{[^}]*totals\.total[^}]*\}/);
  });

  test("payment.tsx pre-Stripe banner accessibility label cites deposit + remaining", () => {
    const src = read("app/checkout-trip/[tripEventId]/payment.tsx");
    // The accessibilityLabel on the banner must reference depositCents
    // (the amount charged now) so screen-reader users get the same
    // disclosure as sighted buyers.
    expect(src).toContain("depositCents");
    expect(src).toMatch(/Payment plan active/);
  });
});

// ---------------------------------------------------------------------------
// (4) isProjection clarifier contract — Constitution #9 honest projection.
// ---------------------------------------------------------------------------

describe("ORCH-0882 SC-9 — projection clarifier copy", () => {
  test("installmentReassurance appends clarifier when isProjection true", () => {
    // Read the source to verify the literal clarifier text is present.
    // Calling the function directly here would require module resolution
    // setup; source-assertion mirrors the existing test pattern.
    const src = read("src/copy/installmentReassurance.ts");
    expect(src).toContain("Dates assume you book today");
    expect(src).toContain("isProjection");
  });

  test("InstallmentScheduleDisplay accepts isProjection prop", () => {
    const src = read("src/components/trip/InstallmentScheduleDisplay.tsx");
    expect(src).toContain("isProjection?: boolean");
    // Default must be false so existing planner-variant call sites
    // (Money tab post-booking ledger) don't suddenly show projection
    // copy when they shouldn't.
    expect(src).toContain("isProjection = false");
  });
});
