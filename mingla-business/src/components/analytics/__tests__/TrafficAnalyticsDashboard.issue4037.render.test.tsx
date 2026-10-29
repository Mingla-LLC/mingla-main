// MINGLA-INVARIANT: I-4037-PARTIAL-NO-CONVERSION | issue #4037 | A partial traffic window shows visits, sources, pages and actions but no conversion path or rate; known completed outcomes remain a separate fact.
import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { TrafficAnalyticsDashboard } from "../TrafficAnalyticsDashboard";
import type {
  BrandTrafficRollup,
  EntityTrafficRollup,
  TrafficCtaType,
  TrafficSource,
} from "../../../services/trafficAnalyticsService";

jest.mock("../../ui/Skeleton", () => ({
  Skeleton: (props: object) => {
    const ReactModule = require("react") as typeof React;
    const Native = require("react-native") as typeof import("react-native");
    return ReactModule.createElement(Native.View, props);
  },
}));

const sources: TrafficSource[] = [
  "mingla_app",
  "mingla_ads",
  "search",
  "social",
  "own_links",
  "direct_unknown",
];
const ctas: TrafficCtaType[] = [
  "buy",
  "book",
  "rsvp",
  "share",
  "save",
  "directions",
  "website",
  "call",
];

const totals = {
  pageViews: 48,
  visitors: 36,
  buttonTaps: 18,
  checkoutStarts: 8,
  bookings: 6,
  customers: 5,
  minglaCustomers: 3,
  minglaVisitors: 22,
  bookingValue: { GBP: 24_000 },
  valueMinglaBrought: { GBP: 16_000 },
  primaryCurrency: "GBP",
};

const page = {
  entityType: "event" as const,
  listingType: "event" as const,
  entityId: "11111111-1111-4111-8111-111111111111",
  title: "Saturday rooftop supper",
  pageViews: 48,
  visitors: 36,
  ctaTotal: 18,
  checkoutStarts: 8,
  bookings: 6,
  valueByCurrency: { GBP: 24_000 },
};

const brandData: BrandTrafficRollup = {
  authorized: true,
  brandId: "22222222-2222-4222-8222-222222222222",
  range: "30d",
  totals,
  prior: {
    ...totals,
    pageViews: 40,
    bookings: 5,
    valueMinglaBrought: { GBP: 12_000 },
  },
  daily: [
    { day: "2026-10-20", pageViews: 18 },
    { day: "2026-10-21", pageViews: 30 },
  ],
  sources: sources.map((source, index) => {
    const valueByCurrency: Record<string, number> =
      index < 3 ? { GBP: 4_000 } : {};
    return {
      source,
      visitors: 6,
      bookings: index < 3 ? 1 : 0,
      valueByCurrency,
    };
  }),
  ctas: ctas.map((type, index) => ({ type, count: index + 1 })),
  pages: [page],
  captureStartedAt: "2026-10-01T00:00:00.000Z",
  windowComplete: true,
};

const entityData: EntityTrafficRollup = {
  ...brandData,
  entityType: "event",
  entityId: page.entityId,
};
delete (entityData as Partial<BrandTrafficRollup>).pages;

const baseProps = {
  onRetry: jest.fn(),
  range: "30d" as const,
  onRangeChange: jest.fn(),
  isWideDesktop: false,
};

describe("#4037 host traffic dashboard render contract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses a two-half, one-full skeleton grid and one retryable error banner", () => {
    const loading = render(
      <TrafficAnalyticsDashboard
        {...baseProps}
        data={undefined}
        isLoading
        isError={false}
        pages={[]}
      />,
    );
    expect(
      loading.getAllByTestId(/^traffic-analytics-loading-\d$/).length,
    ).toBe(3);
    expect(loading.getByText("30 days")).toBeTruthy();
    loading.unmount();

    const failed = render(
      <TrafficAnalyticsDashboard
        {...baseProps}
        data={undefined}
        isLoading={false}
        isError
        pages={[]}
      />,
    );
    expect(failed.getAllByText("Couldn't load traffic analytics")).toHaveLength(
      1,
    );
    fireEvent.press(failed.getByText("Retry"));
    expect(baseProps.onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps booking truth while traffic is still collecting", () => {
    const collecting: BrandTrafficRollup = {
      ...brandData,
      totals: { ...totals, pageViews: 12, bookings: 6 },
      daily: [{ day: "2026-10-21", pageViews: 12 }],
      captureStartedAt: "2026-10-21T00:00:00.000Z",
      windowComplete: false,
      pages: [],
    };
    const screen = render(
      <TrafficAnalyticsDashboard
        {...baseProps}
        data={collecting}
        isLoading={false}
        isError={false}
        pages={[]}
        onSelectPage={jest.fn()}
      />,
    );
    expect(
      screen.getByText("Tracking began 21 Oct; this range is partial."),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Still collecting: visit trend, source mix, conversion path",
      ),
    ).toBeTruthy();
    expect(screen.getByText("6 bookings and RSVPs")).toBeTruthy();
    expect(screen.getByText("COMPLETED SO FAR")).toBeTruthy();
    expect(screen.queryByText("Visits per day")).toBeNull();
    expect(screen.queryByText("Where visitors came from")).toBeNull();
    expect(screen.queryByText("Your pages")).toBeNull();
    expect(screen.queryByText("Activity in this period")).toBeNull();
  });

  it("renders the complete phone hierarchy, chart labels and page drill-down", () => {
    const onRangeChange = jest.fn();
    const onSelectPage = jest.fn();
    const onOpenSelectedListing = jest.fn();
    const screen = render(
      <TrafficAnalyticsDashboard
        {...baseProps}
        data={brandData}
        isLoading={false}
        isError={false}
        onRangeChange={onRangeChange}
        pages={brandData.pages}
        selectedPage={page}
        onSelectPage={onSelectPage}
        selectedPageData={entityData}
        onOpenSelectedListing={onOpenSelectedListing}
      />,
    );
    expect(screen.queryByText("VALUE MINGLA BROUGHT")).toBeNull();
    expect(screen.getByText("Visits per day")).toBeTruthy();
    expect(screen.getAllByText("Activity in this period")).toHaveLength(1);
    expect(screen.getAllByText("Where visitors came from")).toHaveLength(1);
    expect(screen.getByText("Your pages")).toBeTruthy();
    expect(
      screen.getByText("Each page uses its real completed outcome."),
    ).toBeTruthy();
    expect(screen.getAllByText("Button taps").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Actions are grouped by intent; they are not treated as funnel steps.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        "Visits per day, 30 days, 48 total, highest 30 on 21 Oct",
      ),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        "Activity in this period, Page visits 48, Booking or RSVP taps 6, Checkouts started · paid only 8, Completed bookings and RSVPs 6",
      ),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("Mingla sources, 50 percent of visitors"),
    ).toBeTruthy();
    expect(
      screen.getAllByLabelText(
        "Button taps, Primary actions 6, Share 4, Save 5, Directions 6, Website or call 15, Opened another page 0",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Visitors")).toBeTruthy();
    expect(screen.getByText("Booking taps")).toBeTruthy();
    expect(screen.queryByText("£240")).toBeNull();
    expect(screen.queryByText("Checkouts started")).toBeNull();

    fireEvent.press(screen.getByText("7 days"));
    expect(onRangeChange).toHaveBeenCalledWith("7d");
    fireEvent.press(
      screen.getByLabelText("Saturday rooftop supper, 48 visits, 6 bookings"),
    );
    expect(onSelectPage).toHaveBeenCalledWith(page);
    fireEvent.press(screen.getByText("Open listing insights ›"));
    expect(onOpenSelectedListing).toHaveBeenCalledTimes(1);
  });

  it("sizes the Mingla source bracket to the three Mingla segments", () => {
    const sourceMix = brandData.sources.map((row, index) => ({
      ...row,
      visitors: index < 3 ? 9 : 3,
    }));
    const screen = render(
      <TrafficAnalyticsDashboard
        {...baseProps}
        data={{ ...brandData, sources: sourceMix }}
        isLoading={false}
        isError={false}
      />,
    );
    expect(
      StyleSheet.flatten(
        screen.getByTestId("traffic-mingla-source-bracket").props.style,
      ).width,
    ).toBe("75%");
  });

  it("labels RSVP, venue and brand page rows by their real outcomes", () => {
    const rsvpPage = {
      ...page,
      listingType: "rsvp" as const,
      title: "Community night",
      bookings: 9,
    };
    const venuePage = {
      ...page,
      entityType: "venue" as const,
      listingType: "venue" as const,
      entityId: "33333333-3333-4333-8333-333333333333",
      title: "Garden venue",
      bookings: 4,
    };
    const brandPage = {
      ...page,
      entityType: "brand" as const,
      listingType: "brand" as const,
      entityId: null,
      title: "Brand page",
      bookings: 0,
    };
    const screen = render(
      <TrafficAnalyticsDashboard
        {...baseProps}
        data={brandData}
        isLoading={false}
        isError={false}
        pages={[rsvpPage, venuePage, brandPage]}
        onSelectPage={jest.fn()}
      />,
    );
    expect(
      screen.getByLabelText("Community night, 48 visits, 9 RSVPs"),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("Garden venue, 48 visits, 4 reservations"),
    ).toBeTruthy();
    expect(screen.getByLabelText("Brand page, 48 visits")).toBeTruthy();
    expect(screen.getByText("RSVP · 18.8% visit → RSVP")).toBeTruthy();
    expect(screen.getByText("Venue · 8.3% visit → reservation")).toBeTruthy();
    expect(screen.getAllByText("Brand page").length).toBeGreaterThan(0);
  });

  it("shows the tracking start for all-time and preserves the desktop three-row content", () => {
    const screen = render(
      <TrafficAnalyticsDashboard
        {...baseProps}
        data={{ ...brandData, range: "all", windowComplete: false }}
        range="all"
        isLoading={false}
        isError={false}
        isWideDesktop
        pages={brandData.pages}
        selectedPage={page}
        onSelectPage={jest.fn()}
        selectedPageData={{
          ...entityData,
          range: "all",
          windowComplete: false,
        }}
      />,
    );
    expect(screen.getByText("Since tracking started 1 Oct")).toBeTruthy();
    expect(screen.getByText("Still collecting: conversion path")).toBeTruthy();
    expect(screen.getByText("Your pages")).toBeTruthy();
    expect(screen.getAllByText("Button taps").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Where visitors came from")).toHaveLength(1);
    expect(screen.queryByText("Activity in this period")).toBeNull();
    expect(screen.getByText("Event · Tracking window is partial")).toBeTruthy();
  });

  it.each([
    ["event", "From visit to booking", "Booking taps", "Bookings"],
    ["experience", "From visit to booking", "Booking taps", "Bookings"],
    ["trip", "From visit to booking", "Booking taps", "Bookings"],
    ["rsvp", "From visit to RSVP", "RSVP taps", "RSVPs"],
    ["venue", "From visit to reservation", "Reservation taps", "Reservations"],
  ] as const)(
    "uses truthful %s listing outcomes",
    (listingType, pathTitle, actionLabel, outcomeLabel) => {
      const screen = render(
        <TrafficAnalyticsDashboard
          {...baseProps}
          data={entityData}
          isLoading={false}
          isError={false}
          listingType={listingType}
        />,
      );
      expect(screen.getByText(pathTitle)).toBeTruthy();
      expect(screen.getAllByText(actionLabel).length).toBeGreaterThan(0);
      expect(screen.getAllByText(outcomeLabel).length).toBeGreaterThan(0);
      expect(screen.queryByText("From visit to sale")).toBeNull();
      screen.unmount();
    },
  );

  it("stretches both cards in each desktop row without fixed heights", () => {
    const screen = render(
      <TrafficAnalyticsDashboard
        {...baseProps}
        data={brandData}
        isLoading={false}
        isError={false}
        isWideDesktop
      />,
    );
    for (const id of ["traffic-visits-card", "traffic-activity-card"]) {
      const chrome = screen.getByTestId(id);
      const cardContent = screen.getByTestId(`${id}-content`);
      const chromeContent = cardContent.parent;
      const clip = chromeContent?.parent;
      expect(StyleSheet.flatten(chrome.props.style).flex).toBe(1);
      expect(StyleSheet.flatten(chrome.props.style).height).toBeUndefined();
      expect(StyleSheet.flatten(chromeContent?.props.style).flex).toBe(1);
      expect(StyleSheet.flatten(clip?.props.style).flex).toBe(1);
    }
    expect(
      StyleSheet.flatten(screen.getByTestId("traffic-grid-row-0").props.style)
        .alignItems,
    ).toBe("stretch");
  });

  it("hides button taps until two tap types have data and uses one collecting line", () => {
    const oneTapType: BrandTrafficRollup = {
      ...brandData,
      ctas: ctas.map((type) => ({ type, count: type === "buy" ? 3 : 0 })),
    };
    const screen = render(
      <TrafficAnalyticsDashboard
        {...baseProps}
        data={oneTapType}
        isLoading={false}
        isError={false}
        pages={oneTapType.pages}
        onSelectPage={jest.fn()}
        regularsCollecting
        customerPatternsCollecting
      />,
    );
    expect(screen.queryByTestId("traffic-button-taps-card")).toBeNull();
    expect(
      screen.getByText("Still collecting: regulars, booking patterns"),
    ).toBeTruthy();
    expect(
      screen.queryByText("Select a page when visit data is available"),
    ).toBeNull();
  });
});
