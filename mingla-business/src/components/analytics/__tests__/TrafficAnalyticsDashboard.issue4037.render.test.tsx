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

  it("uses four grid skeletons and one retryable error banner", () => {
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
    ).toBe(4);
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
    expect(failed.getAllByText("Couldn't load traffic analytics")).toHaveLength(1);
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
    expect(screen.getByText("Still collecting: visits (since 21 Oct)")).toBeTruthy();
    expect(screen.getAllByText("6").length).toBeGreaterThan(0);
    expect(screen.queryByText("Visits per day")).toBeNull();
    expect(screen.queryByText("Where visitors came from")).toBeNull();
    expect(screen.queryByText("Your pages")).toBeNull();
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
    expect(screen.getAllByText("From visit to sale")).toHaveLength(1);
    expect(screen.getAllByText("Where visitors came from")).toHaveLength(1);
    expect(screen.getByText("Your pages")).toBeTruthy();
    expect(screen.getAllByText("Button taps").length).toBeGreaterThan(0);
    expect(
      screen.getByLabelText(
        "Visits per day, 30 days, 48 total, highest 30 on 21 Oct",
      ),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        "From visit to sale, Page visits 48, Button taps 18, Checkouts started 8, Bookings 6",
      ),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("50 percent of visitors came from Mingla"),
    ).toBeTruthy();
    expect(
      screen.getAllByLabelText(
        "Button taps, Buy or book 6, Share 4, Save 5, Directions 6, Website or call 15, Opened another page 0",
      ).length,
    ).toBeGreaterThan(0);

    fireEvent.press(screen.getByText("7 days"));
    expect(onRangeChange).toHaveBeenCalledWith("7d");
    fireEvent.press(
      screen.getByLabelText("Saturday rooftop supper, 48 visits, 6 sold"),
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
    expect(screen.getAllByText("Where visitors came from")).toHaveLength(1);
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
