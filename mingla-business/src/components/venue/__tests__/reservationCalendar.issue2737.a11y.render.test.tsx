/* eslint-disable @typescript-eslint/no-require-imports */
import React from "react";
// @ts-expect-error react-test-renderer ships without declarations in this workspace.
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";

import {
  moveRovingFocus,
  ReservationCalendarToolbar,
} from "../ReservationCalendarToolbar";
import { calendarWeek } from "../reservationCalendarModel";

jest.mock("lucide-react-native", () => {
  const ReactRuntime = require("react") as typeof React;
  const Icon = (props: Record<string, unknown>): React.ReactElement =>
    ReactRuntime.createElement("MockIcon", props);
  return { Check: Icon, ChevronLeft: Icon, ChevronRight: Icon };
});

// @ts-expect-error react-test-renderer ships without declarations in this workspace.
const TestRenderer = require("react-test-renderer") as typeof import("react-test-renderer");

const keyEvent = (key: string): { nativeEvent: { key: string }; preventDefault: jest.Mock } => ({
  nativeEvent: { key },
  preventDefault: jest.fn(),
});

const keyboardNode = (root: ReactTestInstance, testID: string): ReactTestInstance => {
  const node = root.findAllByProps({ testID }).find(
    (candidate: ReactTestInstance) => typeof candidate.props.onKeyDown === "function",
  );
  if (node === undefined) throw new Error(`keyboard_node_missing:${testID}`);
  return node;
};

describe("issue #2737 reservation calendar web roving focus", () => {
  it("moves selection and actual focus together for mode, date, and status composites", async () => {
    const onModeChange = jest.fn();
    const onDaySelect = jest.fn();
    const onScopeChange = jest.fn();
    const week = calendarWeek("2026-08-27");
    const toolbarProps = {
      mode: "week" as const,
      periodLabel: "Aug 24–30, 2026",
      selectedDayKey: "2026-08-27",
      days: week.days.map((day) => ({
        key: day.key,
        weekday: "Day",
        dayNumber: "1",
        count: 0,
        fullLabel: day.key,
        isToday: day.key === "2026-08-27",
      })),
      scope: "active" as const,
      scopeCounts: { active: 1, waitlist: 0, completed: 0, no_shows: 0, canceled: 0 },
      onModeChange,
      onPrevious: jest.fn(),
      onNext: jest.fn(),
      onToday: jest.fn(),
      onDaySelect,
      onScopeChange,
    };
    let tree: ReactTestRenderer | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <ReservationCalendarToolbar {...toolbarProps} isWideDesktop />,
      );
    });
    if (tree === null) throw new Error("toolbar_render_missing");

    keyboardNode(tree.root, "reservation-calendar-mode-week").props.onKeyDown(keyEvent("End"));
    expect(onModeChange).toHaveBeenLastCalledWith("month");

    await TestRenderer.act(async () => {
      tree?.update(<ReservationCalendarToolbar {...toolbarProps} isWideDesktop={false} />);
    });
    keyboardNode(tree.root, "reservation-calendar-date-2026-08-27").props.onKeyDown(keyEvent("Home"));
    expect(onDaySelect).toHaveBeenLastCalledWith("2026-08-24");

    keyboardNode(tree.root, "reservation-calendar-scope-active").props.onKeyDown(keyEvent("ArrowRight"));
    expect(onScopeChange).toHaveBeenLastCalledWith("waitlist");
  });

  it("updates roving selection before focusing the exact target ref", () => {
    const focus = jest.fn();
    const select = jest.fn();
    const refs = { current: { waitlist: { focus } } };
    moveRovingFocus(1, [{ id: "active" }, { id: "waitlist" }], refs, select);
    expect(select).toHaveBeenCalledWith("waitlist");
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
