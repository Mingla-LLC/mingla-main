import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
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

  it("uses independent card skeletons and retryable card errors", () => {
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
      loading.getAllByTestId(/traffic-analytics-loading-/).length,
    ).toBeGreaterThanOrEqual(8);
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
      8,
    );
    fireEvent.press(failed.getAllByText("Retry")[0]!);
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
      screen.getAllByText(
        "Collecting since 21 Oct. Visits show here as people open your pages.",
      ).length,
    ).toBeGreaterThan(2);
    expect(screen.getAllByText("6").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/Visits per day/)).toBeNull();
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
    expect(screen.getByText("VALUE MINGLA BROUGHT")).toBeTruthy();
    expect(screen.getByText("Visits per day")).toBeTruthy();
    expect(screen.getAllByText("From visit to sale")).toHaveLength(2);
    expect(screen.getAllByText("Where visitors came from")).toHaveLength(2);
    expect(screen.getByText("Your pages")).toBeTruthy();
    expect(screen.getAllByText("Button taps").length).toBeGreaterThan(0);
    expect(
      screen.getByLabelText(
        "Visits per day, 30 days, 48 total, highest 30 on 21 Oct",
      ),
    ).toBeTruthy();

    fireEvent.press(screen.getByText("7 days"));
    expect(onRangeChange).toHaveBeenCalledWith("7d");
    fireEvent.press(
      screen.getByLabelText("Saturday rooftop supper, 48 visits, 6 sold"),
    );
    expect(onSelectPage).toHaveBeenCalledWith(page);
    fireEvent.press(screen.getByText("Open listing insights ›"));
    expect(onOpenSelectedListing).toHaveBeenCalledTimes(1);
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
    expect(screen.getByText("Your pages")).toBeTruthy();
    expect(screen.getAllByText("Button taps").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Where visitors came from")).toHaveLength(2);
  });
});
