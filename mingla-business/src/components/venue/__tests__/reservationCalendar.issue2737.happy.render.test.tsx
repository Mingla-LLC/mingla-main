/* eslint-disable @typescript-eslint/no-require-imports */
import React from "react";
// @ts-expect-error react-test-renderer ships without declarations in this workspace.
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";

import type { Reservation } from "../../../types/venueReservation";
import { ReservationCalendarToolbar } from "../ReservationCalendarToolbar";
import { ReservationMonthView } from "../ReservationMonthView";
import { ReservationWeekView } from "../ReservationWeekView";
import {
  calendarMonth,
  calendarWeek,
  groupReservationsByVenueDay,
} from "../reservationCalendarModel";

jest.mock("../../ui/GlassCard", () => {
  const ReactRuntime = require("react") as typeof React;
  const { View } = require("react-native") as typeof import("react-native");
  return {
    GlassCard: ({
      children,
      testID,
      contentStyle,
    }: {
      children?: React.ReactNode;
      testID?: string;
      contentStyle?: object;
    }) =>
      ReactRuntime.createElement(
        View,
        { testID, style: contentStyle },
        children,
      ),
  };
});

jest.mock("lucide-react-native", () => {
  const ReactRuntime = require("react") as typeof React;
  const Icon = (props: Record<string, unknown>): React.ReactElement =>
    ReactRuntime.createElement("MockIcon", props);
  return {
    AlertTriangle: Icon,
    Check: Icon,
    ChevronLeft: Icon,
    ChevronRight: Icon,
  };
});

// @ts-expect-error react-test-renderer ships without declarations in this workspace.
const TestRenderer = require("react-test-renderer") as typeof import("react-test-renderer");

const reservation = (id: string, reservedFor: string): Reservation => ({
  id,
  brandId: "brand",
  venueId: "venue",
  placePoolId: null,
  tableId: "table-10",
  reservedFor,
  partySize: 4,
  status: "confirmed",
  source: "mingla",
  createdVia: "consumer",
  guestName: `Guest ${id}`,
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
});

const allText = (root: ReactTestInstance): string =>
  root
    .findAll((node: ReactTestInstance) => typeof node.props.children === "string")
    .map((node: ReactTestInstance) => String(node.props.children))
    .join(" ");

const hostByTestId = (root: ReactTestInstance, testID: string): ReactTestInstance => {
  const interactive = root
    .findAllByProps({ testID })
    .filter((node: ReactTestInstance) => typeof node.props.onPress === "function")
    .at(-1);
  if (interactive === undefined) throw new Error(`interactive_not_found:${testID}`);
  return interactive;
};

describe("issue #2737 responsive reservation calendar render", () => {
  it("renders a seven-column Week with all critical booking facts and exact selection", async () => {
    const rows = [reservation("one", "2026-08-28T13:00:00.000Z")];
    const onSelect = jest.fn();
    let tree: ReactTestRenderer | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <ReservationWeekView
          days={calendarWeek("2026-08-28").days}
          grouped={groupReservationsByVenueDay(rows, "Africa/Lagos")}
          todayKey="2026-08-27"
          timeZone="Africa/Lagos"
          tableDisplayFor={() => "Table T10"}
          onSelect={onSelect}
        />,
      );
    });
    if (tree === null) throw new Error("week_render_missing");
    const output = allText(tree.root);
    expect(output).toContain("Guest one");
    expect(output).toContain("Confirmed");
    expect(output).toContain("Party of 4 · Table T10");
    expect(
      tree.root.findAll(
        (node: ReactTestInstance) =>
          typeof node.type === "string" && node.props.children === "No bookings",
      ),
    ).toHaveLength(6);
    hostByTestId(tree.root, "reservation-week-entry-one").props.onPress();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(rows[0]);
  });

  it("renders exactly 42 Month cells and preserves dense-day overflow", async () => {
    const rows = [
      reservation("one", "2026-08-28T13:00:00.000Z"),
      reservation("two", "2026-08-28T14:00:00.000Z"),
      reservation("three", "2026-08-28T15:00:00.000Z"),
      reservation("four", "2026-08-28T16:00:00.000Z"),
    ];
    const onOverflow = jest.fn();
    const grouped = groupReservationsByVenueDay(rows, "Africa/Lagos");
    expect(grouped.get("2026-08-28")).toHaveLength(4);
    let tree: ReactTestRenderer | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <ReservationMonthView
          days={calendarMonth("2026-08-28").days}
          grouped={grouped}
          todayKey="2026-08-27"
          timeZone="Africa/Lagos"
          tableDisplayFor={() => "Table T10"}
          onSelect={jest.fn()}
          onOverflow={onOverflow}
        />,
      );
    });
    if (tree === null) throw new Error("month_render_missing");
    const monthDayIds = new Set(
      tree.root.findAll(
        (node: ReactTestInstance) =>
          typeof node.props.testID === "string" &&
          node.props.testID.startsWith("reservation-month-day-"),
      ).map((node: ReactTestInstance) => String(node.props.testID)),
    );
    expect(monthDayIds.size).toBe(42);
    const overflow = hostByTestId(
      tree.root,
      "reservation-month-more-2026-08-28",
    );
    expect(String(overflow.props.accessibilityLabel)).toContain("3 more");
    overflow.props.onPress();
    expect(onOverflow).toHaveBeenCalledWith("2026-08-28");
  });

  it("keeps mode, date, status, and period navigation as separate controls", async () => {
    const onModeChange = jest.fn();
    const onScopeChange = jest.fn();
    const onDaySelect = jest.fn();
    const onPrevious = jest.fn();
    const week = calendarWeek("2026-08-28");
    let tree: ReactTestRenderer | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <ReservationCalendarToolbar
          isWideDesktop
          mode="week"
          periodLabel="Aug 24–30, 2026"
          selectedDayKey="2026-08-28"
          days={week.days.map((day) => ({
            key: day.key,
            weekday: "Fri",
            dayNumber: "28",
            count: 1,
            fullLabel: "Friday, August 28",
            isToday: day.key === "2026-08-27",
          }))}
          scope="active"
          scopeCounts={{ active: 4, waitlist: 1, completed: 2, no_shows: 0, canceled: 1 }}
          onModeChange={onModeChange}
          onPrevious={onPrevious}
          onNext={jest.fn()}
          onToday={jest.fn()}
          onDaySelect={onDaySelect}
          onScopeChange={onScopeChange}
        />,
      );
    });
    if (tree === null) throw new Error("toolbar_render_missing");
    tree.root.findByProps({ testID: "reservation-calendar-mode-month" }).props.onPress();
    tree.root.findByProps({ testID: "reservation-calendar-scope-waitlist" }).props.onPress();
    tree.root.findByProps({ testID: "reservation-calendar-previous" }).props.onPress();
    expect(onModeChange).toHaveBeenCalledWith("month");
    expect(onScopeChange).toHaveBeenCalledWith("waitlist");
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onDaySelect).not.toHaveBeenCalled();
  });
});
