import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { BrandAnalyticsScreen } from "../BrandAnalyticsScreen";
import { CustomerPatternsSection } from "../CustomerPatternsSection";

const mockRefetchTotals = jest.fn();
const mockRefetchRegulars = jest.fn();
const mockRefetchPatterns = jest.fn();

jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({
    isWideDesktop: true,
    isWeb: true,
    width: 1440,
  }),
}));
jest.mock("../../../analytics/businessAnalyticsEvents", () => ({
  captureBusinessAnalyticsOpened: jest.fn(),
  captureBusinessAnalyticsRefreshed: jest.fn(),
}));
jest.mock("../../ui/TopBar", () => ({
  TopBar: ({ title }: { title: string }) => {
    const ReactModule = require("react") as typeof React;
    const Native = require("react-native") as typeof import("react-native");
    return ReactModule.createElement(
      Native.View,
      null,
      ReactModule.createElement(Native.Text, null, title),
    );
  },
}));
jest.mock("../../ui/Skeleton", () => ({
  Skeleton: (props: object) => {
    const ReactModule = require("react") as typeof React;
    const Native = require("react-native") as typeof import("react-native");
    return ReactModule.createElement(Native.View, props);
  },
}));

const mockTotalsData = {
  brandId: "brand-874",
  authorized: true,
  minglaDrove30d: 2,
  minglaDroveLifetime: 5,
  valueCents30d: {},
  valueCentsLifetime: {},
  bySource: [
    { source: "ad", customers: 0, valueCents: {} },
    { source: "search", customers: 0, valueCents: {} },
    { source: "organic", customers: 2, valueCents: {} },
    { source: "social", customers: 0, valueCents: {} },
    { source: "direct", customers: 0, valueCents: {} },
  ],
};
const mockRegularsData = {
  brandId: "brand-874",
  authorized: true,
  regularsCount: 0,
  topRegulars: [],
};
const noData = {
  state: "no_data" as const,
  sampleCommitments: 0,
  distinctDates: 0,
  positiveBuckets: 0,
  winner: null,
  buckets: [],
};
const moreDataNeeded = {
  state: "more_data_needed" as const,
  sampleCommitments: 6,
  distinctDates: 2,
  positiveBuckets: 2,
  winner: null,
  buckets: [
    { key: "morning", label: "Morning", bookingsAndRsvps: 4 },
    { key: "evening", label: "Evening", bookingsAndRsvps: 2 },
  ],
};
const noClearPattern = {
  state: "no_clear_pattern" as const,
  sampleCommitments: 12,
  distinctDates: 4,
  positiveBuckets: 2,
  winner: null,
  buckets: [
    { key: "event", label: "Event", bookingsAndRsvps: 6 },
    { key: "trip", label: "Trip", bookingsAndRsvps: 6 },
  ],
};
const winner = {
  state: "winner" as const,
  sampleCommitments: 12,
  distinctDates: 4,
  positiveBuckets: 2,
  winner: { key: "monday", label: "Monday", bookingsAndRsvps: 8 },
  buckets: [
    { key: "monday", label: "Monday", bookingsAndRsvps: 8 },
    { key: "tuesday", label: "Tuesday", bookingsAndRsvps: 4 },
  ],
};
const mockPatternsData = {
  brandId: "brand-874",
  authorized: true,
  generatedAt: "2026-07-30T00:00:00Z",
  windowDays: 180 as const,
  metric: "qualified_customer_commitments" as const,
  days: winner,
  dayparts: moreDataNeeded,
  types: noClearPattern,
};

jest.mock("../../../hooks/useBrandAnalytics", () => ({
  useBrandMinglaDroveRollup: () => ({
    data: mockTotalsData,
    isLoading: false,
    isError: false,
    refetch: mockRefetchTotals,
  }),
  useBrandRegularsRollup: () => ({
    data: mockRegularsData,
    isLoading: false,
    isError: false,
    refetch: mockRefetchRegulars,
  }),
  useBrandCustomerPatternsRollup: () => ({
    data: mockPatternsData,
    isLoading: false,
    isError: false,
    refetch: mockRefetchPatterns,
  }),
}));

const brand = { id: "brand-874", displayName: "Smoke & Rhythm" } as never;

const renderScreen = () =>
  render(
    <BrandAnalyticsScreen
      brand={brand}
      rank={60}
      roleLoading={false}
      entryPoint="direct"
      onBack={jest.fn()}
      onBackToHome={jest.fn()}
    />,
  );

const fulfilled = (data: object) => ({ data, isError: false });
const failed = () => ({ data: undefined, isError: true });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

describe("issue #874 tester adversarial accessibility announcements", () => {
  beforeEach(() => {
    mockRefetchTotals.mockReset();
    mockRefetchRegulars.mockReset();
    mockRefetchPatterns.mockReset();
  });

  it("makes every resolved customer-pattern state a polite live region", async () => {
    const screen = await render(
      <CustomerPatternsSection
        data={{
          ...mockPatternsData,
          days: noData,
          dayparts: moreDataNeeded,
          types: noClearPattern,
        }}
        isWideDesktop={false}
      />,
    );

    expect(screen.getByText("No booking pattern yet").parent?.props)
      .toHaveProperty("accessibilityLiveRegion", "polite");
    expect(screen.getByText("More data needed").parent?.props)
      .toHaveProperty("accessibilityLiveRegion", "polite");
    expect(screen.getByText("No clear pattern yet").parent?.props)
      .toHaveProperty("accessibilityLiveRegion", "polite");

    await screen.rerender(
      <CustomerPatternsSection
        data={{
          ...mockPatternsData,
          days: noData,
          dayparts: moreDataNeeded,
          types: winner,
        }}
        isWideDesktop={false}
      />,
    );
    expect(
      screen.getByText(
        "Based on 12 Mingla bookings and RSVPs across 4 dates in the last 180 days.",
      ).parent?.props,
    ).toHaveProperty("accessibilityLiveRegion", "polite");
  });

  it.each([
    {
      expected: "Analytics updated",
      totals: fulfilled(mockTotalsData),
      regulars: fulfilled(mockRegularsData),
      patterns: fulfilled(mockPatternsData),
    },
    {
      expected: "Analytics partly updated",
      totals: fulfilled(mockTotalsData),
      regulars: failed(),
      patterns: fulfilled(mockPatternsData),
    },
    {
      expected: "Analytics couldn't be updated",
      totals: failed(),
      regulars: failed(),
      patterns: failed(),
    },
  ])("announces Updating then $expected after refresh settles", async ({
    expected,
    totals,
    regulars,
    patterns,
  }) => {
    const totalsDeferred = deferred<typeof totals>();
    const regularsDeferred = deferred<typeof regulars>();
    const patternsDeferred = deferred<typeof patterns>();
    mockRefetchTotals.mockReturnValue(totalsDeferred.promise);
    mockRefetchRegulars.mockReturnValue(regularsDeferred.promise);
    mockRefetchPatterns.mockReturnValue(patternsDeferred.promise);
    const screen = await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByText("Refresh"));
    });
    expect(
      screen.getByTestId("analytics-refresh-announcement").props
        .accessibilityLiveRegion,
    ).toBe("polite");
    expect(screen.getByText("Updating analytics")).toBeTruthy();

    await act(async () => {
      totalsDeferred.resolve(totals);
      regularsDeferred.resolve(regulars);
      patternsDeferred.resolve(patterns);
      await Promise.all([
        totalsDeferred.promise,
        regularsDeferred.promise,
        patternsDeferred.promise,
      ]);
    });
    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
    expect(
      screen.getByTestId("analytics-refresh-announcement").props
        .accessibilityLiveRegion,
    ).toBe("polite");
  });
});
