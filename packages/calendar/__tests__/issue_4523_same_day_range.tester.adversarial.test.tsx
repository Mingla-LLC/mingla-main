// MINGLA-INVARIANT: I-4523-SAME-DAY-RANGE | issue #4523 | A range field that allows a one-day range (trip dates, day-unit pickers) commits start = end when the start day is tapped again; a stay (check-in / check-out) never does, so it keeps requiring at least one night.
/**
 * #4523 rework (tester F5) — the shared range calendar can pick a one-day
 * range where the field allows it. Mounts the real CalendarSurface.
 *
 * Fails on revert: tapping the start day again clears the end, Done stays
 * disabled and a day trip cannot be picked.
 */
import React from "react";

import { CalendarConfigContext } from "../config";
import { CalendarSurface } from "../CalendarSurface";
import { nextRange } from "../core/rangeRules";
import type { CalendarConfig } from "../types";

type Node = { props: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => { root: { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
  act: (callback: () => void) => void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config: CalendarConfig = {
  tokens: {
    surface: "#111", text: "#fff", textMuted: "#aaa", textFaint: "#777", border: "#333", fieldFill: "#222",
    selectedFill: "#eee", onSelected: "#000", rangeFill: "#444", todayDot: "#f90", error: "#f33", radius: 12, dayRadius: 12,
  },
  primitives: { Sheet: () => null },
};

function mount(props: { allowSameDay?: boolean; unit?: "nights" | "days" }, onChange: jest.Mock) {
  let tree!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      <CalendarConfigContext.Provider value={config}>
        <CalendarSurface label="Dates" timeZone="Africa/Lagos" testID="cal" config={config} mode="range"
          value={{ start: "", end: "" }} onChange={onChange} onDone={() => undefined} onCancel={() => undefined}
          min="2027-03-01" max="2027-03-31" {...props} />
      </CalendarConfigContext.Provider>,
    );
  });
  return tree;
}
const press = (tree: ReturnType<typeof mount>, testID: string): void => {
  const hit = tree.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function")[0];
  if (hit === undefined) throw new Error(`nothing pressable ${testID}`);
  TestRenderer.act(() => (hit.props.onPress as () => void)());
};

describe("#4523 a one-day range", () => {
  it("the rule: tapping the start again ends the range there only when allowed", () => {
    const started = { start: "2027-03-12", end: "" } as const;
    expect(nextRange(started, "2027-03-12", true)).toEqual({ start: "2027-03-12", end: "2027-03-12" });
    expect(nextRange(started, "2027-03-12")).toEqual({ start: "2027-03-12", end: "" });
    expect(nextRange(started, "2027-03-14", true)).toEqual({ start: "2027-03-12", end: "2027-03-14" });
    expect(nextRange(started, "2027-03-10", true)).toEqual({ start: "2027-03-10", end: "" });
  });

  it.each(["nights", "days"] as const)("allowed (%s): tap a day twice, Done commits start = end", (unit) => {
    const onChange = jest.fn();
    const tree = mount({ allowSameDay: true, unit }, onChange);
    press(tree, "cal-day-2027-03-12");
    press(tree, "cal-day-2027-03-12");
    press(tree, "cal-done");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ start: "2027-03-12", end: "2027-03-12" });
  });

  it("a stay (not allowed): the same day twice cannot commit; a night can", () => {
    const onChange = jest.fn();
    const tree = mount({ unit: "nights" }, onChange);
    press(tree, "cal-day-2027-03-12");
    press(tree, "cal-day-2027-03-12");
    const done = tree.root.findAll((n) => n.props.testID === "cal-done")[0];
    expect(done?.props.disabled === true || done?.props.accessibilityState).toBeTruthy();
    try { press(tree, "cal-done"); } catch { /* a disabled Done may expose no handler */ }
    expect(onChange).not.toHaveBeenCalled();
    press(tree, "cal-day-2027-03-13");
    press(tree, "cal-done");
    expect(onChange).toHaveBeenCalledWith({ start: "2027-03-12", end: "2027-03-13" });
  });
});
