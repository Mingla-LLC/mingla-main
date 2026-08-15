import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ReactLocal = require("react") as typeof React;

jest.mock("../../../ui/GlassCard", () => ({
  __esModule: true,
  GlassCard: (props: { children?: unknown }) =>
    ReactLocal.createElement("GlassCard", props, props.children as never),
}));

import { OrderInsightsInstrument } from "../OrderInsightsInstrument";
import type { VenueOrderMetrics } from "../../../../services/venueOrderMetricsService";

interface RenderNode {
  props: Record<string, unknown> & { children?: unknown };
}

interface RenderTree {
  root: { findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[] };
  unmount: () => void;
}

const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const daily30d: VenueOrderMetrics["daily30d"] = Array.from(
  { length: 30 },
  (_, index) => ({
    localDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
    orders: 0,
    salesCents: {},
    tipsCents: {},
    moneyStateByCurrency: {},
  }),
);

const emptyMetrics: VenueOrderMetrics = {
  schemaVersion: 1,
  brandId: "brand-empty",
  venueId: "venue-empty",
  authorized: true,
  resolvedTimezone: "UTC",
  timezoneConfidence: "utc",
  window: {
    days: 30,
    localStartDate: "2026-07-01",
    localEndDate: "2026-07-30",
    captureStartedAt: null,
    windowComplete: false,
    serviceDays: 0,
    state: "none",
    thinLabel: "No orders yet",
  },
  orders30d: 0,
  channelSplit: { qr: 0, page: 0, counter_pickup: 0, staff: 0 },
  moneyStateByCurrency: {},
  unallocatedRefundsByCurrency: {},
  salesCents30d: {},
  tipsCents30d: {},
  spendPerOrder: {},
  spendPerCoverTierA: {},
  tierACurrencyConflictReservations: 0,
  attachCounts: {
    state: "not_applicable",
    orderedReservations: 0,
    seatedReservations: 0,
    windowComplete: false,
  },
  placedAtByDaypart: [
    { daypart: "morning", orders: 0 },
    { daypart: "afternoon", orders: 0 },
    { daypart: "evening", orders: 0 },
    { daypart: "late_night", orders: 0 },
  ],
  placedAtByIsoWeekday: Array.from({ length: 7 }, (_, index) => ({
    isoWeekday: index + 1,
    orders: 0,
  })),
  daily30d,
  itemsByVelocity: [],
  revenueByZone: [],
  revenueByRoom: [],
  dataCompleteness: {
    activeTablesMissingZone: 0,
    soldItemsMissingCost: 0,
    tierACurrencyConflictReservations: 0,
    showZoneTodo: false,
    showItemCostTodo: false,
  },
};

const query = (data: VenueOrderMetrics) => ({
  data,
  isLoading: false,
  isError: false,
  isFetching: false,
}) as never;

const render = async (data: VenueOrderMetrics): Promise<RenderTree> => {
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <OrderInsightsInstrument
        query={query(data)}
        offline={false}
        onRetry={jest.fn()}
      />,
    );
  });
  return tree!;
};

const allText = (tree: RenderTree): string =>
  tree.root
    .findAll((node) => typeof node.props.children === "string")
    .map((node) => String(node.props.children))
    .join(" ");

describe("#1795 honest spend-per-order empty state", () => {
  it("does not invent a partial refund before the venue has any completed orders", async () => {
    const tree = await render(emptyMetrics);
    const text = allText(tree);

    expect(text).toContain(
      "Your order numbers will appear after your first completed order.",
    );
    expect(text).not.toContain("partial refund");
  });

  it("preserves the withholding explanation when an unallocated partial refund exists", async () => {
    const tree = await render({
      ...emptyMetrics,
      orders30d: 1,
      moneyStateByCurrency: { USD: "partial_refund_unallocated" },
      unallocatedRefundsByCurrency: { USD: { orders: 1, cents: 300 } },
      window: {
        ...emptyMetrics.window,
        captureStartedAt: "2026-07-30",
        serviceDays: 1,
        state: "early",
        thinLabel: "Early numbers - 1 days of orders",
      },
    });
    const text = allText(tree);

    expect(text).toContain("Unavailable while a partial refund is unallocated.");
    expect(text).toContain("partial refund has no recorded split");
    expect(text).not.toContain(
      "Your order numbers will appear after your first completed order.",
    );
  });
});
