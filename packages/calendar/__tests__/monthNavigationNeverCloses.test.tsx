import React from "react";

import { CalendarConfigContext } from "../config";
import { CalendarSurface, type CalendarSurfaceProps } from "../CalendarSurface";
import type { CalendarConfig } from "../types";

type Node = { props: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: { findAll: (predicate: (n: Node) => boolean) => Node[] };
    unmount: () => void;
  };
  act: (callback: () => void) => void;
};

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const config: CalendarConfig = {
  tokens: {
    surface: "#111",
    text: "#fff",
    textMuted: "#aaa",
    textFaint: "#777",
    border: "#333",
    fieldFill: "#222",
    selectedFill: "#eee",
    onSelected: "#000",
    rangeFill: "#444",
    todayDot: "#f90",
    error: "#f33",
    radius: 12,
    dayRadius: 12,
  },
  primitives: { Sheet: () => null },
};

type Mode = CalendarSurfaceProps["mode"];

interface Spies {
  onChange: jest.Mock;
  onDone: jest.Mock;
  onCancel: jest.Mock;
}

function build(mode: Mode, spies: Spies): React.ReactElement {
  const common = {
    label: "Date",
    timeZone: "Africa/Lagos",
    testID: "cal",
    onDone: spies.onDone,
    onCancel: spies.onCancel,
    config,
  };
  switch (mode) {
    case "single":
      return <CalendarSurface {...common} mode="single" value="2027-03-12" onChange={spies.onChange} />;
    case "dob":
      return <CalendarSurface {...common} mode="dob" value="" onChange={spies.onChange} />;
    case "range":
      return (
        <CalendarSurface {...common} mode="range" value={{ start: "2027-03-12", end: "2027-03-16" }} onChange={spies.onChange} />
      );
    case "datetime":
      return (
        <CalendarSurface {...common} mode="datetime" value={{ date: "2027-03-12", time: "19:00" }} onChange={spies.onChange} />
      );
    default: {
      const unreachable: never = mode;
      throw new Error(String(unreachable));
    }
  }
}

const mount = (element: React.ReactElement) => {
  let tree!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    tree = TestRenderer.create(<CalendarConfigContext.Provider value={config}>{element}</CalendarConfigContext.Provider>);
  });
  return tree;
};

const find = (tree: ReturnType<typeof mount>, testID: string, key: string): Node => {
  const hit = tree.root.findAll((n) => n.props.testID === testID && typeof n.props[key] === "function")[0];
  if (hit === undefined) throw new Error(`no ${key} on ${testID}`);
  return hit;
};
const pressId = (tree: ReturnType<typeof mount>, testID: string): void => {
  TestRenderer.act(() => {
    (find(tree, testID, "onPress").props.onPress as () => void)();
  });
};
const key = (tree: ReturnType<typeof mount>, k: string, shiftKey = false): void => {
  TestRenderer.act(() => {
    (find(tree, "cal", "onKeyDown").props.onKeyDown as (e: object) => void)({ key: k, shiftKey, preventDefault: () => undefined });
  });
};
const a11yAction = (tree: ReturnType<typeof mount>, actionName: string): void => {
  TestRenderer.act(() => {
    (find(tree, "cal-title", "onAccessibilityAction").props.onAccessibilityAction as (e: object) => void)({ nativeEvent: { actionName } });
  });
};
const titleText = (tree: ReturnType<typeof mount>): string => {
  const title = find(tree, "cal-title", "onAccessibilityAction");
  return title.props.accessibilityLabel as string;
};

describe("issue #4523 month navigation never closes the calendar", () => {
  it.each(["single", "range", "datetime", "dob"] as const)(
    "%s: next x14, prev x14, PageDown x3, Shift+PageUp x2 and a11y increment/decrement never close, commit or change the draft",
    (mode) => {
      const spies: Spies = { onChange: jest.fn(), onDone: jest.fn(), onCancel: jest.fn() };
      const tree = mount(build(mode, spies));
      const before = tree.root.findAll((n) => n.props.testID === "cal-readout").map((n) => JSON.stringify(n.props.children));

      for (let i = 0; i < 14; i += 1) pressId(tree, "cal-next");
      for (let i = 0; i < 14; i += 1) pressId(tree, "cal-prev");
      for (let i = 0; i < 3; i += 1) key(tree, "PageDown");
      for (let i = 0; i < 2; i += 1) key(tree, "PageUp", true);
      for (let i = 0; i < 4; i += 1) a11yAction(tree, "increment");
      for (let i = 0; i < 4; i += 1) a11yAction(tree, "decrement");
      key(tree, "ArrowRight");
      key(tree, "End");

      expect(spies.onDone).not.toHaveBeenCalled();
      expect(spies.onCancel).not.toHaveBeenCalled();
      expect(spies.onChange).not.toHaveBeenCalled();
      expect(tree.root.findAll((n) => n.props.testID === "cal").length).toBeGreaterThan(0);
      const after = tree.root.findAll((n) => n.props.testID === "cal-readout").map((n) => JSON.stringify(n.props.children));
      expect(after).toEqual(before);
      expect(titleText(tree)).toBeTruthy();
    },
  );

  it("navigation actually moves the month (the test is not vacuous)", () => {
    const spies: Spies = { onChange: jest.fn(), onDone: jest.fn(), onCancel: jest.fn() };
    const tree = mount(build("single", spies));
    const start = titleText(tree);
    pressId(tree, "cal-next");
    expect(titleText(tree)).not.toBe(start);
    pressId(tree, "cal-prev");
    expect(titleText(tree)).toBe(start);
  });

  it("single: one day tap commits once and closes once", () => {
    const spies: Spies = { onChange: jest.fn(), onDone: jest.fn(), onCancel: jest.fn() };
    const tree = mount(build("single", spies));
    pressId(tree, "cal-day-2027-03-20");
    expect(spies.onChange).toHaveBeenCalledTimes(1);
    expect(spies.onChange).toHaveBeenCalledWith("2027-03-20");
    expect(spies.onDone).toHaveBeenCalledTimes(1);
  });

  it("range: two taps stay open; Done commits and closes", () => {
    const spies: Spies = { onChange: jest.fn(), onDone: jest.fn(), onCancel: jest.fn() };
    const tree = mount(build("range", spies));
    pressId(tree, "cal-clear");
    pressId(tree, "cal-day-2027-03-18");
    pressId(tree, "cal-day-2027-03-25");
    expect(spies.onChange).not.toHaveBeenCalled();
    expect(spies.onDone).not.toHaveBeenCalled();
    pressId(tree, "cal-done");
    expect(spies.onChange).toHaveBeenCalledWith({ start: "2027-03-18", end: "2027-03-25" });
    expect(spies.onDone).toHaveBeenCalledTimes(1);
  });

  it("range: a disabled day cannot be picked", () => {
    const spies: Spies = { onChange: jest.fn(), onDone: jest.fn(), onCancel: jest.fn() };
    const tree = mount(
      <CalendarSurface
        label="Dates"
        timeZone="Africa/Lagos"
        testID="cal"
        mode="range"
        value={{ start: "", end: "" }}
        min="2027-03-10"
        onChange={spies.onChange}
        onDone={spies.onDone}
        onCancel={spies.onCancel}
        config={config}
      />,
    );
    // The 2027-03-05 cell is rendered (March is visible) but below min: pressing is a no-op.
    const cell = tree.root.findAll((n) => n.props.testID === "cal-day-2027-03-05" && typeof n.props.onPress === "function")[0];
    if (cell !== undefined) {
      TestRenderer.act(() => (cell.props.onPress as () => void)());
    }
    pressId(tree, "cal-day-2027-03-12");
    pressId(tree, "cal-day-2027-03-14");
    pressId(tree, "cal-done");
    expect(spies.onChange).toHaveBeenCalledWith({ start: "2027-03-12", end: "2027-03-14" });
  });

  it("datetime: Done needs a date and a time; Escape cancels without committing", () => {
    const spies: Spies = { onChange: jest.fn(), onDone: jest.fn(), onCancel: jest.fn() };
    const tree = mount(build("datetime", spies));
    pressId(tree, "cal-time-20:30");
    pressId(tree, "cal-done");
    expect(spies.onChange).toHaveBeenCalledWith({ date: "2027-03-12", time: "20:30" });
    key(tree, "Escape");
    expect(spies.onCancel).toHaveBeenCalledTimes(1);
  });

  it("dob: year -> month -> day takes three taps, then closes", () => {
    const spies: Spies = { onChange: jest.fn(), onDone: jest.fn(), onCancel: jest.fn() };
    const tree = mount(build("dob", spies));
    const year = tree.root.findAll((n) => typeof n.props.testID === "string" && (n.props.testID as string).startsWith("cal-year-") && typeof n.props.onPress === "function")
      .find((n) => n.props.accessibilityState !== undefined && !(n.props.accessibilityState as { disabled: boolean }).disabled);
    if (year === undefined) throw new Error("no enabled year");
    const yearId = year.props.testID as string;
    pressId(tree, yearId);
    pressId(tree, "cal-month-6");
    const y = yearId.replace("cal-year-", "");
    pressId(tree, `cal-day-${y}-06-15`);
    expect(spies.onChange).toHaveBeenCalledWith(`${y}-06-15`);
    expect(spies.onDone).toHaveBeenCalledTimes(1);
  });
});
