/**
 * #4037 decision 7 (comment 6325156309) — a decline above the thresholds is
 * remains available to the legacy Home tile. The repeated Analytics hero was
 * removed by the approved clarity correction and must not return.
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { TrafficAnalyticsDashboard } from "../TrafficAnalyticsDashboard";
import { AnalyticsHomeTile } from "../../home/AnalyticsHomeTile";
import { trafficAnalytics } from "../../../constants/designSystem";
import {
  TRAFFIC_CTA_TYPES,
  TRAFFIC_SOURCES,
  type BrandTrafficRollup,
  type TrafficTotals,
} from "../../../services/trafficAnalyticsService";

jest.mock("../../../hooks/useReducedMotionNative", () => ({
  useReducedMotionNative: () => true,
}));
jest.mock("../../ui/Skeleton", () => ({
  Skeleton: (props: object) => {
    const ReactModule = require("react") as typeof React;
    const Native = require("react-native") as typeof import("react-native");
    return ReactModule.createElement(Native.View, props);
  },
}));

const totals = (valueMinglaBrought: number): TrafficTotals => ({
  pageViews: 400,
  visitors: 300,
  buttonTaps: 0,
  checkoutStarts: 20,
  bookings: 12,
  customers: 12,
  minglaCustomers: 8,
  minglaVisitors: 150,
  bookingValue: { GBP: 100_000 },
  valueMinglaBrought: { GBP: valueMinglaBrought },
  primaryCurrency: "GBP",
});

const rollup = (current: number, prior: number): BrandTrafficRollup => ({
  authorized: true,
  brandId: "40370000-0000-4000-8000-0000000000b1",
  range: "30d",
  totals: totals(current),
  prior: totals(prior),
  daily: [{ day: "2027-01-15", pageViews: 400 }],
  sources: TRAFFIC_SOURCES.map((source) => ({
    source,
    visitors: 50,
    bookings: 2,
    valueByCurrency: {},
  })),
  ctas: TRAFFIC_CTA_TYPES.map((type) => ({ type, count: 0 })),
  pages: [],
  captureStartedAt: "2027-01-01T00:00:00.000Z",
  windowComplete: true,
});

const colourOf = (node: { props: { style: unknown } }): unknown =>
  (
    StyleSheet.flatten(
      node.props.style as Parameters<typeof StyleSheet.flatten>[0],
    ) as { color?: unknown } | undefined
  )?.color;

describe("#4037 decision 7 — declines are shown neutrally", () => {
  it("does not repeat attributed value or deltas in Analytics", () => {
    const screen = render(
      <TrafficAnalyticsDashboard
        data={rollup(40_000, 50_000)}
        isLoading={false}
        isError={false}
        onRetry={jest.fn()}
        range="30d"
        onRangeChange={jest.fn()}
        isWideDesktop={false}
        pages={[]}
        onSelectPage={jest.fn()}
      />,
    );
    expect(screen.queryByText("VALUE MINGLA BROUGHT")).toBeNull();
    expect(screen.queryByText("£400")).toBeNull();
    expect(screen.queryByTestId("traffic-delta-neutral")).toBeNull();
    expect(screen.queryByTestId("traffic-delta-positive")).toBeNull();
  });

  it("does not restore the removed Analytics hero for a rise", () => {
    const screen = render(
      <TrafficAnalyticsDashboard
        data={rollup(60_000, 50_000)}
        isLoading={false}
        isError={false}
        onRetry={jest.fn()}
        range="30d"
        onRangeChange={jest.fn()}
        isWideDesktop={false}
        pages={[]}
        onSelectPage={jest.fn()}
      />,
    );
    expect(screen.queryByText("VALUE MINGLA BROUGHT")).toBeNull();
    expect(screen.queryByTestId("traffic-delta-positive")).toBeNull();
  });

  it("Home tile shows the same decline, neutrally", () => {
    const screen = render(
      <AnalyticsHomeTile
        contract="traffic"
        data={rollup(40_000, 50_000)}
        isLoading={false}
        isError={false}
        onPress={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByTestId("analytics-home-tile"));
    const pill = screen.getByTestId("home-traffic-delta-neutral");
    expect(pill.props.accessibilityLabel).toBe(
      "Down 20 percent versus prior period",
    );
    expect(colourOf(screen.getByText("-20.0%"))).toBe(
      trafficAnalytics.neutralDelta,
    );
  });
});
