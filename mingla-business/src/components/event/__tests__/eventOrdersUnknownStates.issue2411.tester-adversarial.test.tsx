import React from "react";

jest.mock("../../ui/EventCoverMedia", () => {
  const { View } = require("react-native");
  return { EventCoverMedia: () => <View /> };
});
jest.mock("../../ui/Pill", () => {
  const { Text } = require("react-native");
  return { Pill: ({ children }: any) => <Text>{children}</Text> };
});
jest.mock("../../ui/GlassCard", () => {
  const { View } = require("react-native");
  return { GlassCard: ({ children }: any) => <View>{children}</View> };
});
jest.mock("../../ui/Button", () => {
  const { Pressable, Text } = require("react-native");
  return {
    Button: ({ label, onPress, accessibilityLabel }: any) => (
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});
jest.mock("../../../utils/eventDateDisplay", () => ({
  formatDraftDateLine: () => "29 August · 3:00 PM",
}));

import { UpcomingListItem } from "../../home/UpcomingListItem";
import { EventDetailKpiCard } from "../EventDetailKpiCard";
import type { EventSalesSummary } from "../../../utils/eventSalesSummary";

const TR = require("react-test-renderer") as {
  create: (node: React.ReactElement) => any;
  act: (callback: () => void) => void;
};

const textOf = (json: any): string =>
  typeof json === "string"
    ? json
    : Array.isArray(json)
      ? json.map(textOf).join(" ")
      : json && typeof json === "object"
        ? textOf(json.children ?? [])
        : "";

const item = {
  key: "event_2411",
  id: "event_2411",
  kind: "event",
  status: "upcoming",
  startAtUtc: new Date("2026-08-29T15:00:00.000Z"),
  endAtUtc: new Date("2026-08-30T18:00:00.000Z"),
  source: {
    id: "event_2411",
    name: "We Go Again Exhibition",
    coverHue: 20,
    coverMediaUrl: null,
    coverMediaType: null,
  },
} as any;

const summary = (patch: Partial<EventSalesSummary>): EventSalesSummary => ({
  eventId: "event_2411",
  soldCount: null,
  onlineRevenue: null,
  displayCurrency: null,
  mismatches: [],
  finiteCapacity: 300,
  hasUnlimitedTickets: false,
  soldLabel: "Loading…",
  revenueLabel: "Loading…",
  readStatus: "loading",
  isRefreshing: false,
  hasError: false,
  ...patch,
});

const renderUpcoming = (sales: EventSalesSummary): any => {
  let tree: any;
  TR.act(() => {
    tree = TR.create(
      <UpcomingListItem
        item={item}
        currentBrandCurrency={undefined}
        eventSalesSummaries={{ event_2411: sales }}
        onOpenDraft={jest.fn()}
        onOpenTrip={jest.fn()}
        onOpenLiveEvent={jest.fn()}
      />,
    );
  });
  return tree;
};

const accessibilityLabels = (tree: any): string[] =>
  tree.root
    .findAll((node: any) => typeof node.props.accessibilityLabel === "string")
    .map((node: any) => node.props.accessibilityLabel);

describe("#2411 tester rendered unknown/read states", () => {
  test("compact Home/Hub-style rows announce loading and error without announcing zero", () => {
    const loading = renderUpcoming(summary({}));
    expect(accessibilityLabels(loading).some((label) => /Sales loading/.test(label))).toBe(true);
    expect(textOf(loading.toJSON())).not.toMatch(/\b0(?: sold| \/)/);
    loading.unmount();

    const failed = renderUpcoming(summary({
      readStatus: "error",
      soldLabel: "Unable to load",
      revenueLabel: "Unable to load",
      hasError: true,
    }));
    expect(accessibilityLabels(failed).some((label) => /Sales unavailable/.test(label))).toBe(true);
    expect(textOf(failed.toJSON())).not.toMatch(/\b0(?: sold| \/)/);
  });

  test("a free-event stale refresh retains six sold and visibly announces the refresh failure", () => {
    const stale = renderUpcoming(summary({
      readStatus: "stale-error",
      soldCount: 6,
      onlineRevenue: 0,
      soldLabel: "6 / 300",
      revenueLabel: "—",
    }));

    expect(textOf(stale.toJSON())).toContain("6 / 300");
    expect(textOf(stale.toJSON())).toContain("Unable to refresh");
    expect(accessibilityLabels(stale).some((label) => /Unable to refresh/.test(label))).toBe(true);
  });

  test("full KPI error exposes an accessible retry and never renders numeric money", () => {
    const retry = jest.fn();
    let failed: any;
    TR.act(() => {
      failed = TR.create(
        <EventDetailKpiCard
          revenueGbp={125}
          payoutGbp={100}
          currency="NGN"
          readStatus="error"
          onRetry={retry}
        />,
      );
    });

    expect(textOf(failed.toJSON()).match(/—/g)).toHaveLength(2);
    const retryNode = failed.root.find(
      (node: any) => node.props.accessibilityLabel === "Retry loading orders",
    );
    TR.act(() => retryNode.props.onPress());
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("full KPI stale state keeps truthful money and exposes refresh failure", () => {
    let stale: any;
    TR.act(() => {
      stale = TR.create(
        <EventDetailKpiCard
          revenueGbp={125}
          payoutGbp={100}
          currency="NGN"
          readStatus="stale-error"
        />,
      );
    });

    expect(textOf(stale.toJSON())).toContain("Unable to refresh");
    expect(textOf(stale.toJSON())).not.toContain("—");
  });
});
