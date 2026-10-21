/**
 * #4037 — bundle budget (#943): the traffic dashboard and its service load on
 * demand, never on the web boot path, and the lazy wrapper still renders the
 * real dashboard.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react-native";
import { TrafficAnalyticsDashboard } from "../LazyTrafficAnalyticsDashboard";
import {
  TRAFFIC_CTA_TYPES,
  TRAFFIC_SOURCES,
} from "../../../constants/trafficAnalyticsContract";
import type { BrandTrafficRollup } from "../../../services/trafficAnalyticsService";

// The real dashboard has its own render proofs; here a stand-in proves the
// wrapper loads it on demand and passes every prop through.
jest.mock("../TrafficAnalyticsDashboard", () => {
  const ReactModule = require("react") as typeof React;
  const Native = require("react-native") as typeof import("react-native");
  return {
    TrafficAnalyticsDashboard: (props: {
      range: string;
      data?: { brandId: string };
    }) =>
      ReactModule.createElement(
        Native.Text,
        null,
        `dashboard ${props.range} ${props.data?.brandId ?? "none"}`,
      ),
  };
});
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

const totals = {
  pageViews: 40,
  visitors: 30,
  buttonTaps: 0,
  checkoutStarts: 0,
  bookings: 0,
  customers: 0,
  minglaCustomers: 0,
  minglaVisitors: 0,
  bookingValue: {},
  valueMinglaBrought: {},
  primaryCurrency: "GBP",
};

const data: BrandTrafficRollup = {
  authorized: true,
  brandId: "40370000-0000-4000-8000-0000000000b1",
  range: "30d",
  totals,
  prior: totals,
  daily: [{ day: "2027-01-15", pageViews: 40 }],
  sources: TRAFFIC_SOURCES.map((source) => ({
    source,
    visitors: 5,
    bookings: 0,
    valueByCurrency: {},
  })),
  ctas: TRAFFIC_CTA_TYPES.map((type) => ({ type, count: 0 })),
  pages: [],
  captureStartedAt: "2027-01-01T00:00:00.000Z",
  windowComplete: true,
};

const read = (path: string): string =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("#4037 traffic dashboard stays off the web boot chunk", () => {
  it("the lazy wrapper shows a loading state, then the loaded dashboard with every prop", async () => {
    const Native = require("react-native") as typeof import("react-native");
    const screen = render(
      <TrafficAnalyticsDashboard
        loadingFallback={<Native.View testID="traffic-dashboard-loading" />}
        renderLoadError={() => <Native.Text>load failed</Native.Text>}
        data={data}
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
    expect(screen.getByTestId("traffic-dashboard-loading")).toBeTruthy();
    expect(
      await screen.findByText(
        "dashboard 30d 40370000-0000-4000-8000-0000000000b1",
      ),
    ).toBeTruthy();
  });

  it("no eager importer pulls in the dashboard or the traffic service", () => {
    const valueImport = (name: string) =>
      new RegExp(`^import\\s+(?!type\\b)[^;]*?from\\s+"[^"]*/${name}";`, "m");
    for (const path of [
      "src/components/analytics/BrandAnalyticsScreen.tsx",
      "src/components/analytics/ListingInsightsScreen.tsx",
      "src/components/analytics/LazyTrafficAnalyticsDashboard.tsx",
      "src/hooks/useTrafficAnalytics.ts",
      "src/components/home/AnalyticsHomeTile.tsx",
      "app/(tabs)/home.tsx",
      "app/(tabs)/analytics.tsx",
      "app/insights/[id].tsx",
    ]) {
      const source = read(path);
      expect([
        path,
        valueImport("TrafficAnalyticsDashboard").test(source),
      ]).toEqual([path, false]);
      expect([
        path,
        valueImport("trafficAnalyticsService").test(source),
      ]).toEqual([path, false]);
      expect([
        path,
        /require\("[^"]*TrafficAnalyticsDashboard"\)/.test(source),
      ]).toEqual([path, false]);
    }
    const dashboard = read(
      "src/components/analytics/TrafficAnalyticsDashboard.tsx",
    );
    expect(valueImport("trafficAnalyticsService").test(dashboard)).toBe(false);
  });

  it("public pages load the traffic sender only on first use", () => {
    const emitter = read("src/services/offeringEngagementCapture.web.ts");
    expect(emitter).not.toMatch(/^import\s+(?!type\b)/m);
    expect(emitter).toContain('import("./offeringEngagementSend")');
  });
});
