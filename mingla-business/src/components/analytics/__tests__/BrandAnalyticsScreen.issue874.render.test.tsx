import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { BrandAnalyticsScreen } from "../BrandAnalyticsScreen";

const mockResponsive = { isWideDesktop: false, isWeb: false, width: 390 };
const mockRefetchTotals = jest.fn();
const mockRefetchRegulars = jest.fn();
const mockRefetchPatterns = jest.fn();
const mockOpened = jest.fn();
const mockRefreshed = jest.fn();

jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => mockResponsive,
}));
jest.mock("../../../analytics/businessAnalyticsEvents", () => ({
  captureBusinessAnalyticsOpened: (...args: unknown[]) => mockOpened(...args),
  captureBusinessAnalyticsRefreshed: (...args: unknown[]) => mockRefreshed(...args),
}));
jest.mock("../../ui/TopBar", () => ({
  TopBar: ({ title, rightSlot }: { title: string; rightSlot: React.ReactNode }) => {
    const ReactModule = require("react") as typeof React;
    const Native = require("react-native") as typeof import("react-native");
    return ReactModule.createElement(
      Native.View,
      null,
      ReactModule.createElement(Native.Text, null, title),
      rightSlot,
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
  valueCents30d: { GBP: 1200, USD: 2500 },
  valueCentsLifetime: {},
  bySource: [
    { source: "ad", customers: 1, valueCents: { GBP: 1200 } },
    { source: "search", customers: 0, valueCents: {} },
    { source: "organic", customers: 1, valueCents: { USD: 2500 } },
    { source: "social", customers: 0, valueCents: {} },
    { source: "direct", customers: 0, valueCents: {} },
  ],
};
const mockRegularsData = {
  brandId: "brand-874",
  authorized: true,
  regularsCount: 1,
  topRegulars: [
    { maskedContact: "s***@m***.com", bookingsAndRsvps: 3, listings: 2 },
  ],
};
const mockPatternView = {
  state: "more_data_needed",
  sampleCommitments: 6,
  distinctDates: 2,
  positiveBuckets: 2,
  winner: null,
  buckets: [
    { key: "monday", label: "Monday", bookingsAndRsvps: 4 },
    { key: "tuesday", label: "Tuesday", bookingsAndRsvps: 2 },
  ],
};
const mockPatternsData = {
  brandId: "brand-874",
  authorized: true,
  generatedAt: "2026-07-30T00:00:00Z",
  windowDays: 180,
  metric: "qualified_customer_commitments",
  days: mockPatternView,
  dayparts: {
    ...mockPatternView,
    buckets: [{ key: "morning", label: "Morning", bookingsAndRsvps: 6 }],
  },
  types: {
    ...mockPatternView,
    state: "no_clear_pattern",
    buckets: [{ key: "event", label: "Event", bookingsAndRsvps: 6 }],
  },
};

let mockQueryState:
  | "loading"
  | "success"
  | "partial"
  | "cached_error"
  | "unauthorized" = "success";
jest.mock("../../../hooks/useBrandAnalytics", () => ({
  useBrandMinglaDroveRollup: () =>
    mockQueryState === "loading"
      ? { data: undefined, isLoading: true, isError: false, refetch: mockRefetchTotals }
      : mockQueryState === "unauthorized"
        ? {
            data: { ...mockTotalsData, authorized: false },
            isLoading: false,
            isError: false,
            refetch: mockRefetchTotals,
          }
        : {
            data: mockTotalsData,
            isLoading: false,
            isError: false,
            refetch: mockRefetchTotals,
          },
  useBrandRegularsRollup: () =>
    mockQueryState === "loading"
      ? { data: undefined, isLoading: true, isError: false, refetch: mockRefetchRegulars }
      : mockQueryState === "partial"
        ? { data: undefined, isLoading: false, isError: true, refetch: mockRefetchRegulars }
        : {
            data: mockRegularsData,
            isLoading: false,
            isError: mockQueryState === "cached_error",
            refetch: mockRefetchRegulars,
          },
  useBrandCustomerPatternsRollup: () =>
    mockQueryState === "loading"
      ? { data: undefined, isLoading: true, isError: false, refetch: mockRefetchPatterns }
      : {
          data: mockPatternsData,
          isLoading: false,
          isError: false,
          refetch: mockRefetchPatterns,
        },
}));

const brand = { id: "brand-874", displayName: "Smoke & Rhythm" } as never;

describe("issue #874 Analytics screen real RN render", () => {
  beforeEach(() => {
    mockQueryState = "success";
    mockResponsive.isWideDesktop = false;
    mockRefetchTotals.mockReset().mockResolvedValue({ data: mockTotalsData, isError: false });
    mockRefetchRegulars.mockReset().mockResolvedValue({ data: mockRegularsData, isError: false });
    mockRefetchPatterns.mockReset().mockResolvedValue({ data: mockPatternsData, isError: false });
    mockOpened.mockClear();
    mockRefreshed.mockClear();
  });

  it("renders shell and independent module skeletons before data", async () => {
    mockQueryState = "loading";
    const screen = await render(
      <BrandAnalyticsScreen
        brand={brand}
        rank={60}
        roleLoading={false}
        entryPoint="direct"
        onBack={jest.fn()}
        onBackToHome={jest.fn()}
      />,
    );
    expect(screen.getByText("Analytics")).toBeTruthy();
    expect(screen.getByText("See how customers find and choose Smoke & Rhythm.")).toBeTruthy();
    expect(screen.getByTestId("analytics-totals-loading")).toBeTruthy();
    expect(screen.getByTestId("analytics-regulars-loading")).toBeTruthy();
    expect(screen.getByTestId("analytics-patterns-loading")).toBeTruthy();
  });

  it("renders successful modules while a failed module has its own retry", async () => {
    mockQueryState = "partial";
    const screen = await render(
      <BrandAnalyticsScreen
        brand={brand}
        rank={60}
        roleLoading={false}
        entryPoint="home_tile"
        onBack={jest.fn()}
        onBackToHome={jest.fn()}
      />,
    );
    expect(screen.getByText("Customers Mingla drove")).toBeTruthy();
    expect(screen.getByText("Couldn't load regulars")).toBeTruthy();
    expect(screen.getByText("Customer patterns")).toBeTruthy();
    fireEvent.press(screen.getByText("Retry"));
    expect(mockRefetchRegulars).toHaveBeenCalledTimes(1);
  });

  it("preserves cached data and shows a banner after a background refetch error", async () => {
    mockQueryState = "cached_error";
    const screen = await render(
      <BrandAnalyticsScreen
        brand={brand}
        rank={60}
        roleLoading={false}
        entryPoint="direct"
        onBack={jest.fn()}
        onBackToHome={jest.fn()}
      />,
    );
    expect(screen.getByText("Regulars")).toBeTruthy();
    expect(screen.getByText("s***@m***.com")).toBeTruthy();
    expect(screen.getByText("Couldn't refresh analytics")).toBeTruthy();
    expect(screen.queryByText("Couldn't load regulars")).toBeNull();
  });

  it("suppresses all result modules for authorization failure", async () => {
    mockQueryState = "unauthorized";
    const onBackToHome = jest.fn();
    const screen = await render(
      <BrandAnalyticsScreen
        brand={brand}
        rank={60}
        roleLoading={false}
        entryPoint="direct"
        onBack={jest.fn()}
        onBackToHome={onBackToHome}
      />,
    );
    expect(screen.getByText("Analytics unavailable")).toBeTruthy();
    expect(screen.queryByText("Customers Mingla drove")).toBeNull();
    fireEvent.press(screen.getByText("Back to Home"));
    expect(onBackToHome).toHaveBeenCalledTimes(1);
  });

  it("keeps the masked regular contact masked in the rendered prop boundary", async () => {
    const screen = await render(
      <BrandAnalyticsScreen
        brand={brand}
        rank={60}
        roleLoading={false}
        entryPoint="direct"
        onBack={jest.fn()}
        onBackToHome={jest.fn()}
      />,
    );
    const contact = screen.getByText("s***@m***.com");
    expect(contact.props.dataSet ?? {}).not.toHaveProperty("rawContact");
    if (contact.props.dataSet !== undefined) {
      expect(contact.props.dataSet).toEqual({ phMask: "true" });
    }
    expect(contact.props.accessibilityLabel ?? "").not.toContain("seth@");
  });

  it("renders the responsive wide refresh action and records manual completion", async () => {
    mockResponsive.isWideDesktop = true;
    const screen = await render(
      <BrandAnalyticsScreen
        brand={brand}
        rank={60}
        roleLoading={false}
        entryPoint="direct"
        onBack={jest.fn()}
        onBackToHome={jest.fn()}
      />,
    );
    await act(async () => {
      fireEvent.press(screen.getByText("Refresh"));
      await Promise.all([
        mockRefetchTotals.mock.results[0]?.value,
        mockRefetchRegulars.mock.results[0]?.value,
        mockRefetchPatterns.mock.results[0]?.value,
      ]);
    });
    await waitFor(() => expect(mockRefreshed).toHaveBeenCalledWith("success"));
    expect(mockRefetchTotals).toHaveBeenCalledTimes(1);
    expect(mockRefetchRegulars).toHaveBeenCalledTimes(1);
    expect(mockRefetchPatterns).toHaveBeenCalledTimes(1);
  });
});
