/**
 * #3645 PR10 — organiser payout visibility pure helpers.
 *
 * Fails-on-revert: delete resolveBrandPayoutStatus → import error; drop the
 * paused precedence → "selling_add_bank" wrongly wins under an admin hold;
 * select error_message into BrandPayoutVisibilityDTO → this file has no such
 * field and the parse test refuses unknown keys that would carry it.
 */
import { describe, expect, test } from "@jest/globals";

import {
  NEXT_PAYOUT_SUB,
  PAYOUTS_PAUSED_TITLE,
  SELLING_ADD_BANK_TITLE,
  overlayPayoutStatusOnStripeBanner,
  parseBrandPayoutVisibility,
  resolveBrandPayoutStatus,
  summariseOfferingPayoutMoney,
} from "../brandPayoutVisibility";
import type { BrandPayoutReleaseDTO } from "../payoutBreakdown";
import type { BrandStripeBannerConfig } from "../brandStripeUiState";

describe("parseBrandPayoutVisibility", () => {
  test("maps the RPC contract and never invents a pause", () => {
    const dto = parseBrandPayoutVisibility({
      payouts_paused: false,
      next_payout_at: "2027-09-02T12:00:00Z",
      earned_cents: 15000,
      on_its_way_cents: 5000,
      paid_cents: 10000,
      currency: "ngn",
    });
    expect(dto).toEqual({
      payoutsPaused: false,
      nextPayoutAt: "2027-09-02T12:00:00Z",
      earnedCents: 15000,
      onItsWayCents: 5000,
      paidCents: 10000,
      currency: "ngn",
    });
  });

  test("rejects non-objects so a malformed RPC cannot fabricate state", () => {
    expect(parseBrandPayoutVisibility(null)).toBeNull();
    expect(parseBrandPayoutVisibility("nope")).toBeNull();
  });
});

describe("resolveBrandPayoutStatus", () => {
  const nextAt = "2099-01-15T12:00:00Z";

  test("paused outranks add-bank and next-payout", () => {
    const status = resolveBrandPayoutStatus({
      chargeReady: true,
      payoutReady: false,
      visibility: {
        payoutsPaused: true,
        nextPayoutAt: nextAt,
        earnedCents: 1,
        onItsWayCents: 1,
        paidCents: 0,
        currency: "gbp",
      },
    });
    expect(status?.kind).toBe("payouts_paused");
    expect(status?.title).toBe(PAYOUTS_PAUSED_TITLE);
  });

  test("charge-ready without bank → Selling, add a bank to get paid", () => {
    const status = resolveBrandPayoutStatus({
      chargeReady: true,
      payoutReady: false,
      visibility: {
        payoutsPaused: false,
        nextPayoutAt: nextAt,
        earnedCents: 0,
        onItsWayCents: 0,
        paidCents: 0,
        currency: "gbp",
      },
    });
    expect(status?.kind).toBe("selling_add_bank");
    expect(status?.title).toBe(SELLING_ADD_BANK_TITLE);
    expect(status?.ctaLabel).toBe("Add bank");
  });

  test("payout-ready with a maturity → Next payout on <date>", () => {
    const status = resolveBrandPayoutStatus({
      chargeReady: true,
      payoutReady: true,
      visibility: {
        payoutsPaused: false,
        nextPayoutAt: nextAt,
        earnedCents: 100,
        onItsWayCents: 100,
        paidCents: 0,
        currency: "gbp",
      },
      now: new Date("2027-01-01T00:00:00Z"),
    });
    expect(status?.kind).toBe("next_payout");
    expect(status?.title).toMatch(/^Next payout on /);
    expect(status?.sub).toBe(NEXT_PAYOUT_SUB);
  });

  test("Stripe action-required banner is never papered over", () => {
    const base: BrandStripeBannerConfig = {
      icon: "shield",
      iconColor: "#000",
      title: "Action required",
      sub: "Finish verification",
      ctaLabel: "Resolve",
      ctaVariant: "primary",
      destructive: true,
    };
    const status = resolveBrandPayoutStatus({
      chargeReady: true,
      payoutReady: false,
      visibility: {
        payoutsPaused: false,
        nextPayoutAt: null,
        earnedCents: 0,
        onItsWayCents: 0,
        paidCents: 0,
        currency: null,
      },
    });
    expect(overlayPayoutStatusOnStripeBanner(base, status)).toBe(base);
  });
});

describe("summariseOfferingPayoutMoney", () => {
  const baseRelease = (
    overrides: Partial<BrandPayoutReleaseDTO>,
  ): BrandPayoutReleaseDTO =>
    ({
      id: "r1",
      brandId: "b1",
      eventId: "e1",
      provider: "paystack",
      currency: "ngn",
      status: "pending",
      anchorEndAt: "2027-01-01T00:00:00Z",
      releasableAt: "2027-01-02T00:00:00Z",
      releasedAt: null,
      grossCents: 10000,
      refundedCents: 0,
      disputedCents: 0,
      minglaFeeCents: 1000,
      partnerShareCents: 0,
      providerFeeCents: 0,
      permanentDebtWithheldCents: 0,
      temporaryDebtWithheldCents: 0,
      maturityRecreditCents: 0,
      netReleaseCents: 9000,
      organiserCashDeliveredCents: 0,
      createdAt: "2027-01-01T00:00:00Z",
      ...overrides,
    });

  test("splits paid vs on-its-way for one offering", () => {
    const money = summariseOfferingPayoutMoney(
      [
        baseRelease({ id: "r1", status: "released", organiserCashDeliveredCents: 8000 }),
        baseRelease({ id: "r2", status: "pending", netReleaseCents: 5000 }),
        baseRelease({ id: "r3", eventId: "other", status: "pending" }),
      ],
      "e1",
    );
    expect(money).toEqual({
      paidCents: 8000,
      onItsWayCents: 5000,
      currency: "ngn",
    });
  });

  test("excludes cancelled / failed and returns null when nothing live", () => {
    expect(
      summariseOfferingPayoutMoney(
        [
          baseRelease({ status: "cancelled_event" }),
          baseRelease({ id: "r2", status: "failed" }),
        ],
        "e1",
      ),
    ).toBeNull();
  });
});
