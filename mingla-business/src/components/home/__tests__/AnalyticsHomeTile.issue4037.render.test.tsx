import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { AnalyticsHomeTile } from "../AnalyticsHomeTile";
import type { BrandTrafficRollup } from "../../../services/trafficAnalyticsService";

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

const data: BrandTrafficRollup = {
  authorized: true,
  brandId: "11111111-1111-4111-8111-111111111111",
  range: "30d",
  totals: {
    pageViews: 4_820,
    visitors: 3_400,
    buttonTaps: 860,
    checkoutStarts: 210,
    bookings: 148,
    customers: 148,
    minglaCustomers: 96,
    minglaVisitors: 2_200,
    bookingValue: { GBP: 600_000 },
    valueMinglaBrought: { GBP: 418_000 },
    primaryCurrency: "GBP",
  },
  prior: {
    pageViews: 4_000,
    visitors: 3_000,
    buttonTaps: 720,
    checkoutStarts: 170,
    bookings: 120,
    customers: 120,
    minglaCustomers: 80,
    minglaVisitors: 1_900,
    bookingValue: { GBP: 500_000 },
    valueMinglaBrought: { GBP: 350_000 },
    primaryCurrency: "GBP",
  },
  daily: [
    { day: "2026-10-20", pageViews: 2_000 },
    { day: "2026-10-21", pageViews: 2_820 },
  ],
  sources: [
    "mingla_app",
    "mingla_ads",
    "search",
    "social",
    "own_links",
    "direct_unknown",
  ].map((source) => ({
    source: source as BrandTrafficRollup["sources"][number]["source"],
    visitors: 100,
    bookings: 10,
    valueByCurrency: { GBP: 1_000 },
  })),
  ctas: [
    "buy",
    "book",
    "rsvp",
    "share",
    "save",
    "directions",
    "website",
    "call",
  ].map((type) => ({
    type: type as BrandTrafficRollup["ctas"][number]["type"],
    count: 2,
  })),
  pages: [
    {
      entityType: "event",
      entityId: "22222222-2222-4222-8222-222222222222",
      title: "Rooftop supper",
      pageViews: 1_200,
      visitors: 900,
      ctaTotal: 200,
      checkoutStarts: 70,
      bookings: 48,
      valueByCurrency: { GBP: 190_000 },
    },
  ],
  captureStartedAt: "2026-10-01T00:00:00.000Z",
  windowComplete: true,
};

describe("#4037 What Mingla brought you Home tile", () => {
  it("shows the full traffic summary before expansion and the contracted detail after", () => {
    const onPress = jest.fn();
    const screen = render(
      <AnalyticsHomeTile
        contract="traffic"
        data={data}
        isLoading={false}
        isError={false}
        onPress={onPress}
      />,
    );
    expect(screen.getByText("What Mingla brought you")).toBeTruthy();
    expect(
      screen.getByText("£4,180 · 96 customers · 4,820 visits · 30 days"),
    ).toBeTruthy();

    fireEvent.press(screen.getByTestId("analytics-home-tile"));
    expect(screen.getByText("WHAT MINGLA BROUGHT YOU · 30 DAYS")).toBeTruthy();
    expect(screen.getByText("96 customers")).toBeTruthy();
    expect(screen.getByText("Top page: Rooftop supper")).toBeTruthy();
    expect(
      screen.getByLabelText(
        "Visits per day, 30 days, 4,820 total, highest 2,820 on 21 Oct",
      ),
    ).toBeTruthy();

    fireEvent.press(screen.getByTestId("analytics-home-tile"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("shows bookings honestly while visits are still collecting", () => {
    const screen = render(
      <AnalyticsHomeTile
        contract="traffic"
        data={{
          ...data,
          totals: {
            ...data.totals,
            pageViews: 0,
            buttonTaps: 0,
            checkoutStarts: 0,
          },
          daily: [],
          captureStartedAt: "2026-10-21T00:00:00.000Z",
          windowComplete: false,
        }}
        isLoading={false}
        isError={false}
        onPress={jest.fn()}
      />,
    );
    expect(
      screen.getByText("96 customers · collecting visits since 21 Oct"),
    ).toBeTruthy();
    fireEvent.press(screen.getByTestId("analytics-home-tile"));
    expect(
      screen.getByText(
        "Collecting since 21 Oct. Visits show here as people open your pages.",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/Visits per day/)).toBeNull();
  });
});
