/**
 * #4490 P1 click-test D21/D22 (hours editor) and D27/D29 (shell) — the real
 * BrandHoursEditor and SuiteDesktopShell under bare react-test-renderer.
 *
 * D29/D27 root cause: the venue rail was not bounded. With Offers, Bookings
 * and Operations on, it ran past the bottom of a 1024 x 768 window, the page
 * root became scrollable, and focusing or clicking the last rail row
 * ("Settings") scrolled the whole app shell up — the top bar went and a band
 * showed below, and the click landed on nothing (the "dead tap" with unsaved
 * changes). The rail now scrolls inside its own column.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { ScrollView, StyleSheet } from "react-native";

import type { BrandHourEntry } from "../../../types/brand";

jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Button", () => ({ Button: () => null }));
jest.mock("../../ui/BrandSwitch", () => ({ BrandSwitch: () => null }));
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return { ScrollView: View };
});
jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? children : null,
}));
jest.mock("../../programs/TimeField", () => ({
  timeLabel: (v: string) => v,
  timePickerPresentation: () => "web",
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Node = { type: unknown; props: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void) => void;
  create: (el: React.ReactElement) => {
    root: {
      findByProps: (p: Record<string, unknown>) => Node;
      findAll: (pred: (n: Node) => boolean) => Node[];
    };
  };
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BrandHoursEditor } = require("../BrandHoursEditor") as typeof import("../BrandHoursEditor");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SuiteDesktopShell } = require("../../suite/SuiteDesktopShell") as typeof import("../../suite/SuiteDesktopShell");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { deriveVenueRailModules } = require("../venueRail") as typeof import("../venueRail");

function mount(el: React.ReactElement): ReturnType<typeof TestRenderer.create> {
  let tree: ReturnType<typeof TestRenderer.create> | null = null;
  TestRenderer.act(() => {
    tree = TestRenderer.create(el);
  });
  return tree as unknown as ReturnType<typeof TestRenderer.create>;
}

describe("BrandHoursEditor (D20/D21/D22)", () => {
  const hours: BrandHourEntry[] = [0, 1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    openTime: null,
    closeTime: null,
    isClosed: true,
  }));
  hours.push({
    weekday: 6,
    openTime: "09:00:00",
    closeTime: "17:00:00",
    isClosed: false,
    extraWindows: [{ openTime: "18:00", closeTime: "21:00" }],
  });

  it("every time is the same 24-hour field, first window and extra windows alike", () => {
    const tree = mount(<BrandHoursEditor hours={hours} onChange={() => undefined} allowWindows />);
    const first = tree.root.findByProps({ testID: "hours-open-6-input" });
    const extra = tree.root.findByProps({ testID: "hours-window-6-1-close-input" });
    expect(first.props.value).toBe("09:00");
    expect(extra.props.value).toBe("21:00");
    // No native browser time input anywhere (it showed 12-hour AM/PM).
    expect(tree.root.findAll((n) => n.props.type === "time")).toHaveLength(0);
  });

  it("typing 22:00 and 02:00 into window 2 saves a past-midnight window", () => {
    const onChange = jest.fn<(next: unknown) => void>();
    const tree = mount(<BrandHoursEditor hours={hours} onChange={onChange} allowWindows />);
    const open = tree.root.findByProps({ testID: "hours-window-6-1-open-input" });
    TestRenderer.act(() => (open.props.onChangeText as (t: string) => void)("22:00"));
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as typeof hours;
    expect(last[6].extraWindows?.[0]).toEqual({ openTime: "22:00", closeTime: "21:00" });
    const close = tree.root.findByProps({ testID: "hours-window-6-1-close-input" });
    TestRenderer.act(() => (close.props.onChangeText as (t: string) => void)("0200"));
    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0] as typeof hours;
    expect(next[6].extraWindows?.[0]).toEqual({ openTime: "18:00", closeTime: "02:00" });
  });

  it("Remove is a real button", () => {
    const onChange = jest.fn<(next: unknown) => void>();
    const tree = mount(<BrandHoursEditor hours={hours} onChange={onChange} allowWindows />);
    const remove = tree.root.findByProps({ testID: "hours-window-6-1-remove" });
    expect(remove.props.accessibilityRole).toBe("button");
    TestRenderer.act(() => (remove.props.onPress as () => void)());
    const next = onChange.mock.calls[0][0] as typeof hours;
    expect(next[6].extraWindows).toEqual([]);
  });
});

describe("SuiteDesktopShell (D27/D29) — the rail can never grow the page", () => {
  const modules = deriveVenueRailModules([
    "overview",
    "spaces",
    "availability",
    "tables",
    "reservations",
    "waitlist",
    "menu",
    "insights",
    "orders",
    "settings",
  ]);

  it("the rail rows live inside a bounded vertical scroller", () => {
    const tree = mount(
      <SuiteDesktopShell
        modules={modules}
        activeModule="availability"
        onSelect={() => undefined}
        workspaceSelfScrolls
        scrollBottomPad={0}
        railTestIdPrefix="venue-rail-"
      >
        {null}
      </SuiteDesktopShell>,
    );
    const scroller = tree.root.findByProps({ testID: "venue-rail-scroll" });
    expect(scroller.type).toBe(ScrollView);
    const style = StyleSheet.flatten(scroller.props.style as never) as { flex?: number; minHeight?: number };
    expect(style.flex).toBe(1);
    expect(style.minHeight).toBe(0);
    // The last row ("Settings") is inside it, so focusing it scrolls the rail only.
    const settingsRow = tree.root.findAll((n) => n.props.testID === "venue-rail-settings");
    expect(settingsRow.length).toBeGreaterThan(0);
  });
});
