import fs from "node:fs";
import path from "node:path";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ReactLocal = require("react") as typeof React;

jest.mock("../../../ui/GlassCard", () => ({
  __esModule: true,
  GlassCard: (props: { children?: unknown; testID?: string }) =>
    ReactLocal.createElement("GlassCard", props, props.children as never),
}));

import { OrderInsightsInstrument } from "../OrderInsightsInstrument";
import type { VenueOrderMetrics } from "../../../../services/venueOrderMetricsService";

interface RenderNode {
  type?: unknown;
  props: Record<string, unknown> & { children?: unknown; testID?: string };
}
interface RenderTree {
  root: { findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[] };
  toJSON: () => unknown;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const metrics: VenueOrderMetrics = {
  schemaVersion: 1,
  brandId: "brand-1",
  venueId: "venue-1",
  authorized: true,
  resolvedTimezone: "Europe/London",
  timezoneConfidence: "iana",
  window: {
    days: 30,
    localStartDate: "2026-07-01",
    localEndDate: "2026-07-30",
    captureStartedAt: "2026-07-01",
    windowComplete: true,
    serviceDays: 14,
    state: "ready",
    thinLabel: null,
  },
  orders30d: 2,
  channelSplit: { qr: 1, page: 0, counter_pickup: 0, staff: 1 },
  moneyStateByCurrency: { GBP: "complete", USD: "partial_refund_unallocated" },
  unallocatedRefundsByCurrency: { USD: { orders: 1, cents: 500 } },
  salesCents30d: { GBP: 2400 },
  tipsCents30d: { GBP: 200 },
  spendPerOrder: { GBP: { salesCents: 2400, orders: 2, averageCents: 1200 } },
  spendPerCoverTierA: {
    GBP: {
      salesCents: 2400,
      reservations: 1,
      sessions: 2,
      covers: 4,
      averageCents: 600,
      sampleState: "measured",
      label: "Measured on 4 covers",
    },
  },
  tierACurrencyConflictReservations: 0,
  attachCounts: {
    state: "counted",
    orderedReservations: 1,
    seatedReservations: 2,
    windowComplete: true,
  },
  placedAtByDaypart: [
    { daypart: "morning", orders: 0 },
    { daypart: "afternoon", orders: 1 },
    { daypart: "evening", orders: 1 },
    { daypart: "late_night", orders: 0 },
  ],
  placedAtByIsoWeekday: Array.from({ length: 7 }, (_, index) => ({ isoWeekday: index + 1, orders: 0 })),
  daily30d: Array.from({ length: 30 }, (_, index): VenueOrderMetrics["daily30d"][number] => ({
    localDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
    orders: index === 0 ? 2 : 0,
    salesCents: index === 0 ? { GBP: 2400 } : {},
    tipsCents: index === 0 ? { GBP: 200 } : {},
    moneyStateByCurrency: { GBP: "complete", USD: "partial_refund_unallocated" },
  })),
  itemsByVelocity: [
    {
      menuItemId: "item-1",
      itemNameSnapshot: "Burger snapshot",
      quantity: 2,
      orders: 2,
      serviceDays: 2,
      unitsPerServiceDay: 1,
      byDaypart: [
        { daypart: "morning", quantity: 0 },
        { daypart: "afternoon", quantity: 1 },
        { daypart: "evening", quantity: 1 },
        { daypart: "late_night", quantity: 0 },
      ],
      salesCents: { GBP: 2400 },
      moneyStateByCurrency: { GBP: "complete" },
    },
  ],
  revenueByZone: [
    {
      zone: "Dining room",
      orders: 2,
      sessions: 1,
      currentSeatCapacity: 2,
      salesCents: { GBP: 2400 },
      salesPerCurrentSeatCents: { GBP: 1200 },
      moneyStateByCurrency: { GBP: "complete", USD: "partial_refund_unallocated" },
    },
  ],
  revenueByRoom: [
    {
      stayUnitId: "room-1",
      spotLabelSnapshot: "Room 204 at order",
      orders: 2,
      sessions: 1,
      salesCents: { GBP: 2400 },
      moneyStateByCurrency: { GBP: "complete", USD: "partial_refund_unallocated" },
    },
  ],
  dataCompleteness: {
    activeTablesMissingZone: 1,
    soldItemsMissingCost: 1,
    tierACurrencyConflictReservations: 0,
    showZoneTodo: true,
    showItemCostTodo: true,
  },
};

const query = (over: Record<string, unknown> = {}) => ({
  data: metrics,
  isLoading: false,
  isError: false,
  isFetching: false,
  ...over,
}) as never;

const allText = (tree: RenderTree): string =>
  tree.root.findAll((node) => typeof node.props.children === "string")
    .map((node) => String(node.props.children)).join(" ");

const render = async (props: React.ComponentProps<typeof OrderInsightsInstrument>): Promise<RenderTree> => {
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<OrderInsightsInstrument {...props} />);
  });
  return tree!;
};

describe("#1795 Orders instrument states and honesty", () => {
  it("renders exact counts, measured-cover label, partial-refund warning and text equivalents", async () => {
    const tree = await render({ query: query(), offline: false, onRetry: jest.fn() });
    const text = allText(tree);
    expect(text).toContain("2 orders in 30 days");
    expect(text).toContain("Measured on 4 covers");
    expect(text).toContain("partial refund has no recorded split");
    expect(text).toContain("Burger snapshot");
    expect(text).toContain("GBP item sales: £24");
    expect(text).toContain("GBP sales per current seat: £12");
    expect(text).toContain("GBP room sales: £24");
    expect(text).toContain("2026-07-01: 2 orders");
    expect(text).toContain("GBP sales: £24");
    expect(text).toContain("GBP tips: £2");
    expect(text).toContain("ISO weekday 7: 0");
    expect(text).not.toContain("USD $0");
    expect(text).not.toContain("USD item sales:");
    expect(text).not.toContain("USD sales per current seat:");
    expect(text).not.toContain("USD room sales:");
    expect(text).not.toContain("USD sales:");
    expect(text).not.toContain("USD tips:");
  });

  it("renders actionable cold loading/error/offline states and hides permission state", async () => {
    const loading = await render({ query: query({ data: undefined, isLoading: true }), offline: false, onRetry: jest.fn() });
    expect(allText(loading)).toContain("Loading venue orders");
    const retry = jest.fn();
    const error = await render({ query: query({ data: undefined, isError: true }), offline: false, onRetry: retry });
    const retryNode = error.root.findAll((node) => node.props.accessibilityLabel === "Retry venue order insights")[0]!;
    (retryNode.props.onPress as () => void)();
    expect(retry).toHaveBeenCalledTimes(1);
    const offline = await render({ query: query({ data: undefined }), offline: true, onRetry: jest.fn() });
    expect(allText(offline)).toContain("Reconnect, then try again");
    const denied = await render({ query: query({ data: { ...metrics, authorized: false } }), offline: false, onRetry: jest.fn() });
    expect(denied.toJSON()).toBeNull();
  });

  it("has no growth-tool, run, report, quota, Ari or PostHog money dependency", () => {
    const component = fs.readFileSync(path.resolve(__dirname, "../OrderInsightsInstrument.tsx"), "utf8");
    const module = fs.readFileSync(path.resolve(__dirname, "../VenueInsightsModule.tsx"), "utf8");
    expect(component).not.toMatch(/useIntelRun|useIntelSubjectLatest|PostHog|quota|Ari/);
    expect(module).toContain("useVenueOrderMetrics(brandId, venueId, isAuthReady)");
    expect(module).toContain('instrumentId === "orders"');
  });

  it("announces cached refresh/offline states without discarding the last good data", async () => {
    const refreshing = await render({
      query: query({ isFetching: true }),
      offline: false,
      onRetry: jest.fn(),
    });
    expect(allText(refreshing)).toContain("Updating order numbers");
    expect(allText(refreshing)).toContain("2 orders in 30 days");

    const offline = await render({
      query: query(),
      offline: true,
      onRetry: jest.fn(),
    });
    expect(allText(offline)).toContain("Offline — showing saved order numbers");
    expect(allText(offline)).toContain("GBP");
  });

  it("renders honest empty and thin-window labels", async () => {
    const emptyMetrics: VenueOrderMetrics = {
      ...metrics,
      orders30d: 0,
      window: {
        ...metrics.window,
        captureStartedAt: null,
        windowComplete: false,
        serviceDays: 0,
        state: "none",
        thinLabel: "No orders yet",
      },
      salesCents30d: {},
      tipsCents30d: {},
      spendPerOrder: {},
      spendPerCoverTierA: {},
      itemsByVelocity: [],
    };
    const empty = await render({
      query: query({ data: emptyMetrics }),
      offline: false,
      onRetry: jest.fn(),
    });
    expect(allText(empty)).toContain("No orders yet");
    expect(allText(empty)).toContain("0 orders in 30 days");

    const early = await render({
      query: query({
        data: {
          ...metrics,
          window: {
            ...metrics.window,
            serviceDays: 13,
            state: "early",
            thinLabel: "Early numbers - 13 days of orders",
          },
        },
      }),
      offline: false,
      onRetry: jest.fn(),
    });
    expect(allText(early)).toContain("Early numbers - 13 days of orders");
  });

  it("keeps text equivalents, polite status, and 44pt interactive/row targets", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../OrderInsightsInstrument.tsx"),
      "utf8",
    );
    expect(source).toContain('accessibilityLiveRegion="polite"');
    expect(source).toContain('accessibilityRole="alert"');
    expect(source).toContain("minHeight: 44");
    expect(source).toContain('flexWrap: "wrap"');
    expect(source).toContain("The daily table includes every venue-local date");
  });
});
