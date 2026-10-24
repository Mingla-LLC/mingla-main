// MINGLA-INVARIANT: I-3827-HOME-SCANNED-SERVER-TRUTH | issue #3827 | The ticketed Home card shows the unique server-admitted ticket count instead of a permanent blank value.
// @ts-nocheck -- react-test-renderer types are intentionally absent from this package.

import React from "react";
import * as TR from "react-test-renderer";

jest.mock("../../ui/GlassCard", () => {
  const { View } = require("react-native");
  return { GlassCard: ({ children }: any) => <View>{children}</View> };
});
jest.mock("../../ui/Pill", () => {
  const { Text } = require("react-native");
  return { Pill: ({ children }: any) => <Text>{children}</Text> };
});
jest.mock("../../ui/Icon", () => {
  const { View } = require("react-native");
  return { Icon: () => <View /> };
});
jest.mock("../../../utils/eventDateDisplay", () => ({
  formatDraftDateLine: () => "Today · 7:00 PM",
}));

import { LiveOfferingCard } from "../LiveOfferingCard";
import {
  buildEventSalesSummary,
  getEventTicketsScanned,
} from "../../../utils/eventSalesSummary";

const textOf = (json: any): string =>
  typeof json === "string"
    ? json
    : Array.isArray(json)
      ? json.map(textOf).join(" ")
      : json && typeof json === "object"
        ? textOf(json.children ?? [])
        : "";

const order = (ticketId: string, usedAt: string | null) => ({
  id: `order-${ticketId}`,
  eventId: "event-1",
  brandId: "brand-1",
  buyer: { name: "Guest", email: "guest@example.test", phone: "", marketingOptIn: false },
  lines: [],
  ticketDays: [{ ticketId, eventDateIds: [], status: usedAt === null ? "valid" : "used", usedAt }],
  totalGbpAtPurchase: 0,
  currency: "GBP",
  paymentMethod: "free",
  paidAt: "2026-10-24T20:00:00Z",
  status: "paid",
  refundedAmountGbp: 0,
  refunds: [],
  cancelledAt: null,
  lastSeenEventUpdatedAt: "2026-10-24T20:00:00Z",
}) as any;

describe("issue #3827 — live Home scanned metric", () => {
  test("the sales summary counts unique tickets whose server used_at is set", () => {
    const duplicate = order("ticket-1", "2026-10-24T21:00:00Z");
    const orders = [
      duplicate,
      { ...duplicate, id: "duplicate-join-row" },
      order("ticket-2", "2026-10-24T21:01:00Z"),
      order("ticket-3", null),
    ];

    expect(getEventTicketsScanned(orders)).toBe(2);
    expect(buildEventSalesSummary({
      eventId: "event-1",
      tickets: [],
      eventCurrency: "GBP",
      orders,
    }).scannedCount).toBe(2);
  });

  test("the ticketed live card renders the server-backed scanned value", () => {
    const onScan = jest.fn();
    let tree!: TR.ReactTestRenderer;
    TR.act(() => {
      tree = TR.create(
        <LiveOfferingCard
          item={{
            key: "event-1",
            id: "event-1",
            kind: "event",
            status: "live",
            startAtUtc: new Date(),
            endAtUtc: new Date(),
            source: { id: "event-1", name: "Door event", event_type: "event" },
          } as any}
          metrics={{
            revenueLabel: "£0",
            soldValue: "3",
            capacityLabel: "10",
            capacity: 10,
            progress: 0.3,
            scannedValue: "2",
          }}
          onScanPress={onScan}
        />,
      );
    });

    const text = textOf(tree.toJSON());
    expect(text).toContain("Scanned");
    expect(text).toContain("2");
    TR.act(() => {
      tree.root.findByProps({ testID: "home-live-card-scan-button" }).props.onPress();
    });
    expect(onScan).toHaveBeenCalledWith("event-1");
  });
});
