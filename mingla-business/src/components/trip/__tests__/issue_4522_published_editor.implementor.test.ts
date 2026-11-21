// MINGLA-INVARIANT: I-4522-PUBLISHED-EDITOR-PARITY | issue #4522 | Published trip editing uses the four builder sections, asks for a reason only for the approved buyer-affecting changes, and validates v2 plans against each live package price.
/**
 * #4522 slice 12 — behaviour proof for the published editor's decisions.
 *
 * This suite executes the two units the editor delegates to: the buyer-reason
 * classifier and the package validator. The screen's structure (four builder
 * sections, shared builder components, lazy brand-form row, validate → review
 * → RPC order, single plan shape) is a source-shape rule and lives in the
 * strict-grep gate `.github/scripts/strict-grep/issue-4522-flex-claim-guard.mjs`
 * (`publishedSurfaceFailures`).
 */

import type { LiveTripPatch, Trip } from "../../../services/tripsService";
import {
  liveTripEditNeedsBuyerReason,
  NON_BUYER_EDIT_AUDIT_REASON,
} from "../../../utils/publishedTripEditGuards";
import type { TripPaymentPlanV2 } from "../tripPlanV2EditorModel";
import { validateTripPackages } from "../tripPackagesValidation";

const plan: TripPaymentPlanV2 = {
  v: 2,
  deposit: { mode: "amount", amount_minor: 20_000 },
  count: 3,
  final_due_days_before_start: 30,
  auto_adjust: true,
  flex: { enabled: false },
  custom_amounts_minor: null,
};

const trip = {
  days: [{ ordinal: 1 }, { ordinal: 2 }],
  inclusions: [{ kind: "included", item: "Breakfast" }],
  pricingTiers: [
    {
      ticketTypeId: "tt-1",
      priceCents: 30_000,
      paymentPlan: plan,
      installmentSchedule: null,
    },
  ],
  bookingDeadline: "2027-05-01T00:00:00.000Z",
} as unknown as Trip;

const needsReason = (patch: Record<string, unknown>): boolean =>
  liveTripEditNeedsBuyerReason(trip, patch as LiveTripPatch);

describe("#4522 — published editor: when the host is asked why", () => {
  test("buyer-safe edits never ask for a reason", () => {
    expect(needsReason({ title: "New title" })).toBe(false);
    expect(needsReason({ days: [{ ordinal: 1 }, { ordinal: 2 }, { ordinal: 3 }] })).toBe(false);
    expect(
      needsReason({ booking_deadline: "2027-06-01T00:00:00.000Z" }),
    ).toBe(false);
    // A description-only package edit re-sends the same plan: still buyer-safe.
    expect(
      needsReason({
        pricing_tiers: [
          { ticket_type_id: "tt-1", tier_metadata: { payment_plan: plan, description: "x" } },
        ],
      }),
    ).toBe(false);
  });

  test("each approved buyer-affecting change asks for a reason", () => {
    expect(needsReason({ theme: { business_trip: { startAt: "2027-07-01" } } })).toBe(true);
    expect(needsReason({ days: [{ ordinal: 1 }] })).toBe(true);
    expect(needsReason({ inclusions: [] })).toBe(true);
    expect(
      needsReason({ pricing_tiers: [{ ticket_type_id: "tt-1", price_cents: 25_000 }] }),
    ).toBe(true);
    expect(
      needsReason({ pricing_tiers: [{ ticket_type_id: "tt-1", tier_metadata: {} }] }),
    ).toBe(true);
    expect(needsReason({ refund_policy: "none" })).toBe(true);
    expect(
      needsReason({ booking_deadline: "2027-04-01T00:00:00.000Z" }),
    ).toBe(true);
  });

  test("the silent audit reason satisfies the RPC's 10–200 character rule", () => {
    expect(NON_BUYER_EDIT_AUDIT_REASON.length).toBeGreaterThanOrEqual(10);
    expect(NON_BUYER_EDIT_AUDIT_REASON.length).toBeLessThanOrEqual(200);
  });
});

describe("#4522 — published editor: v2 plans are validated per package price", () => {
  const pkg = (priceMajor: string) => ({
    name: "Shared room",
    priceMajor,
    capacity: 10,
    paymentPlan: plan,
  });

  test("a plan valid for its package price passes", () => {
    expect(validateTripPackages([pkg("300")])).toEqual({ ok: true, reason: null });
  });

  test("lowering a package price below the plan's deposit is refused for that package", () => {
    const result = validateTripPackages([pkg("300"), { ...pkg("100"), name: "Budget" }]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^"Budget"'s payment plan: /);
  });
});
