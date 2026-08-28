/* eslint-disable @typescript-eslint/no-require-imports */
import React from "react";
import { View } from "react-native";
// @ts-expect-error react-test-renderer ships without declarations in this workspace.
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";

import type { Reservation } from "../../../types/venueReservation";
import { ReservationCard } from "../ReservationCard";
import { ReservationDetailSheet } from "../ReservationDetailSheet";
import {
  formatReservationDateTime,
  formatReservationTime,
} from "../reservationCalendarModel";

jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ children, visible }: { children?: React.ReactNode; visible: boolean }) => {
    const ReactRuntime = require("react") as typeof React;
    const RN = require("react-native") as typeof import("react-native");
    return visible ? ReactRuntime.createElement(RN.View, null, children) : null;
  },
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children?: React.ReactNode }) => {
    const ReactRuntime = require("react") as typeof React;
    const RN = require("react-native") as typeof import("react-native");
    return ReactRuntime.createElement(RN.View, null, children);
  },
}));
jest.mock("../../refunds/SourceRefundStatusChip", () => ({
  SourceRefundStatusChip: () => null,
}));
jest.mock("lucide-react-native", () => {
  const ReactRuntime = require("react") as typeof React;
  const Icon = (props: Record<string, unknown>): React.ReactElement =>
    ReactRuntime.createElement("MockIcon", props);
  return { AlertTriangle: Icon, ChevronRight: Icon };
});

// @ts-expect-error react-test-renderer ships without declarations in this workspace.
const TestRenderer = require("react-test-renderer") as typeof import("react-test-renderer");

const reservation: Reservation = {
  id: "lagos-noon",
  brandId: "brand",
  venueId: "venue",
  placePoolId: null,
  tableId: null,
  reservedFor: "2026-08-30T12:00:00.000Z",
  partySize: 2,
  status: "confirmed",
  source: "mingla",
  createdVia: "consumer",
  guestName: "Zainab Bello",
  guestPhoneE164: null,
  guestEmail: null,
  consumerUserId: null,
  occasion: null,
  guestNotes: null,
  tags: [],
  feeCents: null,
  feeCurrency: null,
  paymentStatus: "none",
  createdAt: "2026-08-01T00:00:00.000Z",
  refund: null,
};

function renderedText(root: ReactTestInstance): string {
  return root
    .findAll((node: ReactTestInstance) => typeof node.props.children === "string")
    .map((node: ReactTestInstance) => String(node.props.children))
    .join(" ");
}

describe("issue #2737 reservation detail venue timezone", () => {
  it("keeps the real card and detail on the canonical Lagos instant in a New York runtime", async () => {
    const priorTimeZone = process.env.TZ;
    process.env.TZ = "America/New_York";
    let tree: ReactTestRenderer | null = null;
    try {
      await TestRenderer.act(async () => {
        tree = TestRenderer.create(
          <View>
            <ReservationCard
              reservation={reservation}
              tableDisplay={null}
              timeZone="Africa/Lagos"
              onPress={jest.fn()}
            />
            <ReservationDetailSheet
              visible
              onClose={jest.fn()}
              reservation={reservation}
              tableName={null}
              timeZone="Africa/Lagos"
              onAction={jest.fn()}
              acting={false}
            />
          </View>,
        );
      });
      if (tree === null) throw new Error("venue_time_render_missing");
      const canonical = formatReservationDateTime(
        reservation.reservedFor,
        "Africa/Lagos",
      );
      const venueTime = formatReservationTime(
        reservation.reservedFor,
        "Africa/Lagos",
      );
      const detailLabel = tree.root.findByProps({
        testID: "reservation-detail-date-time",
      }).props.children;
      const cardLabel = tree.root.findByProps({
        testID: "reservation-card-lagos-noon",
      }).props.accessibilityLabel;
      expect(detailLabel).toBe(canonical);
      expect(detailLabel).toContain("1:00 PM");
      expect(cardLabel).toContain(canonical);
      expect(renderedText(tree.root)).toContain(venueTime);
      expect(renderedText(tree.root)).not.toContain("8:00 AM");
    } finally {
      process.env.TZ = priorTimeZone;
    }
  });
});
