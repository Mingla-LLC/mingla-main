/**
 * issue #3372 — naira trip, experience and RSVP chip-in prices read "₦…", never
 * "NGN …". Follow-up to #3341, whose shared rule
 * (packages/offering-rendering/currencyGlyph.ts) PR #3359 applied to events.
 *
 * Intl prints the ISO code for naira in most locales (and Hermes can even for
 * en-NG), so each of these formatters now passes its output through that one
 * rule. These tests run the real formatters and mount the real components on an
 * engine with no naira symbol data, then read what they show.
 *
 * Fails on revert:
 *   - ExperienceOfferingBody → experience price label prints "NGN"
 *   - useTripOfferingState   → trip package price and reserve-bar label print "NGN"
 *   - TripPaymentChoice      → "Choose how you pay" amounts print "NGN"
 *   - RsvpChipInPanel        → chip-in presets, prefix, minimum and thank-you print "NGN"
 *   - InstallmentScheduleDisplay / RefundPreviewBody / ExperienceStopsGalleryTile
 *                            → host trip and experience amounts print "NGN"
 *
 * Formatters inside route and screen files (and the Explorer app) are guarded by
 * the strict-grep gate .github/scripts/strict-grep/issue-3372-naira-glyph-wiring.mjs.
 *
 * Dollar, pound and euro prices must format exactly as before.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import { experiencePriceLabel } from "../../../../../packages/offering-rendering/ExperienceOfferingBody";
import type { ExperienceOfferingData } from "../../../../../packages/offering-rendering/experienceOfferingTypes";
import { RsvpChipInPanel } from "../../../../../packages/offering-rendering/RsvpChipInPanel";
import { createThemePalette } from "../../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../../packages/offering-rendering/themeResolver";
import { TripPaymentChoice } from "../../../../../packages/offering-rendering/TripPaymentChoice";
import type {
  TripOfferingData,
  TripOfferingTier,
} from "../../../../../packages/offering-rendering/tripOfferingTypes";
import {
  tripTierPriceLabel,
  useTripOfferingState,
  type TripOfferingState,
} from "../../../../../packages/offering-rendering/useTripOfferingState";
import type { RefundPreview } from "../../../services/cancelTripBookingService";
import type { ExperienceStopRow } from "../../../services/experienceDetailService";

jest.mock(
  "react-native-svg",
  () => ({
    __esModule: true,
    default: () => null,
    Circle: () => null,
    Path: () => null,
  }),
  { virtual: true },
);
// The experience body's cover video is irrelevant to its price label.
jest.mock("../../../../../packages/offering-rendering/EventCoverMedia", () => ({
  EventCoverMedia: (): null => null,
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

// eslint-disable-next-line import/first
import { InstallmentScheduleDisplay } from "../InstallmentScheduleDisplay";
// eslint-disable-next-line import/first
import { RefundPreviewBody } from "../RefundPreviewBody";
// eslint-disable-next-line import/first
import { ExperienceStopsGalleryTile } from "../../offering/ExperienceStopsGalleryTile";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Tree = {
  toJSON: () => unknown;
  unmount: () => void;
};
// The repo intentionally carries no react-test-renderer declarations.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Tree;
  act: (fn: () => void | Promise<void>) => Promise<void>;
};

/** Every string a rendered tree shows: text children and a11y labels. */
const visibleStrings = (node: unknown, out: string[] = []): string[] => {
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    node.forEach((child) => visibleStrings(child, out));
  } else if (node !== null && typeof node === "object") {
    const host = node as { props?: Record<string, unknown>; children?: unknown };
    const label = host.props?.accessibilityLabel;
    if (typeof label === "string") out.push(label);
    visibleStrings(host.children ?? null, out);
  }
  return out;
};

/** A price that still carries the ISO code, e.g. "NGN 25,000" or "25,000 NGN". */
const NAIRA_CODE_PRICE = /NGN[\s\u00a0\u202f]*[-\u2212]?\d|\d[\s\u00a0\u202f]*NGN/;

const render = async (element: React.ReactElement): Promise<string[]> => {
  let tree!: Tree;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(element);
  });
  const shown = visibleStrings(tree.toJSON());
  await TestRenderer.act(() => tree.unmount());
  return shown;
};

/**
 * Stand-in for an engine with no naira symbol data (Hermes on iOS, Node's en-US
 * default, most browsers): every locale formats like en-US, which prints the ISO
 * code for naira.
 */
const RealNumberFormat = Intl.NumberFormat;
beforeEach(() => {
  const Fallback = function (
    _locale?: string | string[],
    options?: Intl.NumberFormatOptions,
  ) {
    return new RealNumberFormat("en-US", options);
  } as unknown as typeof Intl.NumberFormat;
  Object.defineProperty(Intl, "NumberFormat", {
    configurable: true,
    writable: true,
    value: Fallback,
  });
});
afterEach(() => {
  Object.defineProperty(Intl, "NumberFormat", {
    configurable: true,
    writable: true,
    value: RealNumberFormat,
  });
});

const theme = resolveTheme(null, null);
const palette = createThemePalette(theme);

describe("#3372 the stand-in engine", () => {
  test("really prints the ISO code for naira (the bug's precondition)", () => {
    expect(
      new Intl.NumberFormat(undefined, { style: "currency", currency: "NGN" }).format(25000),
    ).toMatch(NAIRA_CODE_PRICE);
  });
});

describe("#3372 experience price (public experience page, Business and Explorer)", () => {
  const experience = (currency: string, cents: number, allIn: number | null = null) =>
    ({
      ticket: { isFree: false, priceCents: cents, priceAllInCents: allIn, currency },
    }) as unknown as ExperienceOfferingData;

  test("a naira experience reads ₦, with no NGN", () => {
    expect(experiencePriceLabel(experience("NGN", 2500000, 2650000))).toEqual({
      label: "₦26,500.00",
      isFree: false,
    });
    expect(experiencePriceLabel(experience("NGN", 2500000)).label).toBe("₦25,000.00");
  });

  test("dollar, pound and euro experiences are unchanged", () => {
    expect(experiencePriceLabel(experience("USD", 3500)).label).toBe("$35.00");
    expect(experiencePriceLabel(experience("GBP", 3500)).label).toBe("£35.00");
    expect(experiencePriceLabel(experience("EUR", 3500)).label).toBe("€35.00");
  });
});

describe("#3372 trip prices (public trip page box and reserve bar)", () => {
  const tier = (overrides: Partial<TripOfferingTier> = {}): TripOfferingTier => ({
    id: "tier-3372",
    ticketTypeId: "tt-3372",
    tierName: "Lagos weekend",
    priceCents: 25000000,
    priceAllInCents: 26500000,
    currency: "NGN",
    isFree: false,
    isUnlimited: true,
    ticketsRemaining: null,
    installmentSchedule: null,
    ...overrides,
  });

  test("a naira package price reads ₦", () => {
    expect(tripTierPriceLabel(tier())).toBe("₦265,000");
  });

  test("dollar, pound and euro package prices are unchanged", () => {
    expect(tripTierPriceLabel(tier({ currency: "USD", priceAllInCents: 120000 }))).toBe("$1,200");
    expect(tripTierPriceLabel(tier({ currency: "GBP", priceAllInCents: 120000 }))).toBe("£1,200");
    expect(tripTierPriceLabel(tier({ currency: "EUR", priceAllInCents: 120000 }))).toBe("€1,200");
  });

  const stateFor = async (
    data: TripOfferingData,
    quantities?: Record<string, number>,
  ): Promise<TripOfferingState> => {
    let captured: TripOfferingState | undefined;
    const Probe = (): null => {
      captured = useTripOfferingState({
        data,
        paymentPlanChoice: "full",
        quantities,
        onReserve: () => undefined,
        now: new Date("2026-09-14T12:00:00Z"),
      });
      return null;
    };
    await render(<Probe />);
    if (captured === undefined) throw new Error("hook did not run");
    return captured;
  };

  const tripData = (tiers: TripOfferingTier[], currency: string): TripOfferingData =>
    ({ tiers, currency, bookable: true, bookingsClosed: false }) as unknown as TripOfferingData;

  test("the reserve bar reads ₦ before and after a package is picked", async () => {
    const tiers = [
      tier({ ticketTypeId: "a", priceAllInCents: 26500000 }),
      tier({ ticketTypeId: "b", priceCents: 40000000, priceAllInCents: 42000000 }),
    ];
    const empty = await stateFor(tripData(tiers, "NGN"));
    expect(empty.cta).toEqual(expect.objectContaining({ kind: "buy", price: "From ₦265,000" }));

    const picked = await stateFor(tripData(tiers, "NGN"), { a: 2 });
    expect(picked.cta).toEqual(expect.objectContaining({ kind: "buy", price: "₦530,000" }));
    expect(JSON.stringify([empty, picked])).not.toMatch(NAIRA_CODE_PRICE);
  });

  test("a dollar trip's reserve bar is unchanged", async () => {
    const usd = await stateFor(
      tripData([tier({ currency: "USD", priceCents: 110000, priceAllInCents: 120000 })], "USD"),
    );
    expect(usd.cta).toEqual(expect.objectContaining({ kind: "buy", price: "$1,200" }));
  });
});

describe("#3372 Choose how you pay (public trip page)", () => {
  const schedule = (currency: string) => ({
    fullPriceCents: 30000000,
    depositCents: 9000000,
    currency,
    installments: [
      { ordinal: 1, amountCents: 10500000, dueAtIso: "2026-10-14T00:00:00Z" },
      { ordinal: 2, amountCents: 10500000, dueAtIso: "2026-11-14T00:00:00Z" },
    ],
  });

  test("naira amounts read ₦ in full and over time", async () => {
    const full = await render(
      <TripPaymentChoice
        schedule={schedule("NGN")}
        currency="NGN"
        depositPct={30}
        value="full"
        onChange={() => undefined}
        palette={palette}
      />,
    );
    expect(full).toContain("₦300,000.00");
    expect(full).toContain("Pay full ₦300,000.00 now");

    const overTime = await render(
      <TripPaymentChoice
        schedule={schedule("NGN")}
        currency="NGN"
        depositPct={30}
        value="installments"
        onChange={() => undefined}
        palette={palette}
      />,
    );
    expect(overTime).toContain("₦90,000.00");
    expect(overTime).toContain("₦105,000.00");
    expect([...full, ...overTime].filter((s) => NAIRA_CODE_PRICE.test(s))).toEqual([]);
  });

  test("a dollar plan is unchanged", async () => {
    const usd = await render(
      <TripPaymentChoice
        schedule={schedule("USD")}
        currency="USD"
        depositPct={30}
        value="full"
        onChange={() => undefined}
        palette={palette}
      />,
    );
    expect(usd).toContain("$300,000.00");
  });
});

describe("#3372 RSVP chip-in panel (public RSVP page)", () => {
  const panel = (
    currency: string,
    state: "idle" | "success",
    amountCents: number,
    minCents: number,
  ) => (
    <RsvpChipInPanel
      palette={palette}
      theme={theme}
      currency={currency}
      hostShortName="Harmattan Club"
      suggestedCents={null}
      minCents={minCents}
      state={state}
      amountCents={amountCents}
      onAmountChange={() => undefined}
      onPreset={() => undefined}
      onSubmit={() => undefined}
      errorText={null}
    />
  );

  test("presets, prefix, minimum and the button read ₦", async () => {
    const shown = await render(panel("NGN", "idle", 250000, 100000));
    expect(shown).toContain("₦1,000");
    expect(shown).toContain("₦5,000");
    expect(shown).toContain("₦"); // the amount field's prefix
    expect(shown).toContain("Minimum ₦1,000");
    expect(shown).toContain("Chip in ₦2,500");
    expect(shown).toContain("₦2,500.00"); // "You'll give ₦2,500.00."
    expect(shown.filter((s) => NAIRA_CODE_PRICE.test(s))).toEqual([]);
  });

  test("the thank-you reads ₦", async () => {
    const shown = await render(panel("NGN", "success", 250000, 100000));
    expect(shown).toContain("₦2,500.00");
    expect(shown.filter((s) => NAIRA_CODE_PRICE.test(s))).toEqual([]);
  });

  test("a dollar chip-in is unchanged", async () => {
    const shown = await render(panel("USD", "idle", 2500, 500));
    expect(shown).toContain("$"); // prefix
    expect(shown).toContain("Chip in $25");
    expect(shown).toContain("$25.00");
  });
});

describe("#3372 Business host trip and experience amounts", () => {
  test("the instalment schedule reads ₦", async () => {
    const schedule = (currency: string) => ({
      fullPriceCents: 30000000,
      depositCents: 9000000,
      currency,
      installments: [
        { ordinal: 1, pct: 35, amountCents: 10500000, dueAt: "2026-10-14T00:00:00Z" },
      ],
    });
    const naira = await render(<InstallmentScheduleDisplay schedule={schedule("NGN")} variant="planner" />);
    expect(naira).toContain("₦90,000.00");
    expect(naira).toContain("₦105,000.00");
    expect(naira.filter((s) => NAIRA_CODE_PRICE.test(s))).toEqual([]);

    const usd = await render(<InstallmentScheduleDisplay schedule={schedule("USD")} variant="planner" />);
    expect(usd).toContain("$90,000.00");
  });

  test("the cancellation refund preview reads ₦", async () => {
    const preview = (currency: string): RefundPreview => ({
      mode: "preview",
      orderId: "order-3372",
      eventId: "trip-3372",
      quotedAt: "2026-09-14T12:00:00Z",
      tripStart: "2026-12-01T00:00:00Z",
      daysRemaining: 78,
      tierPct: 50,
      tierKind: "standard",
      paidTotalCents: 9000000,
      refundTotalCents: 4500000,
      currency,
      perPaymentRefund: [
        {
          installmentId: null,
          ordinal: 0,
          paidCents: 9000000,
          refundCents: 4500000,
          currency,
        },
      ] as unknown as RefundPreview["perPaymentRefund"],
      installmentsToCancel: 0,
    });
    const naira = await render(<RefundPreviewBody preview={preview("NGN")} mode="operator" />);
    expect(naira).toContain("₦45,000.00");
    expect(naira.join(" ")).toContain("₦90,000.00");
    expect(naira.filter((s) => NAIRA_CODE_PRICE.test(s))).toEqual([]);

    const gbp = await render(<RefundPreviewBody preview={preview("GBP")} mode="operator" />);
    expect(gbp).toContain("£45,000.00");
  });

  test("per-stop experience prices read ₦", async () => {
    const stops: ExperienceStopRow[] = [
      {
        id: "stop-3372",
        stopOrder: 0,
        placeId: null,
        placeName: "Nike Art Gallery",
        address: "",
        city: "Lagos",
        region: null,
        countryCode: "NG",
        lat: null,
        lng: null,
        imageUrls: [],
        startTime: "10:00:00",
        priceCents: 1500000,
        description: "",
      },
    ];
    const naira = await render(<ExperienceStopsGalleryTile stops={stops} currency="NGN" showStopPrices />);
    expect(naira).toContain("₦15,000.00");
    expect(naira.filter((s) => NAIRA_CODE_PRICE.test(s))).toEqual([]);

    const eur = await render(<ExperienceStopsGalleryTile stops={stops} currency="EUR" showStopPrices />);
    expect(eur).toContain("€15,000.00");
  });
});
