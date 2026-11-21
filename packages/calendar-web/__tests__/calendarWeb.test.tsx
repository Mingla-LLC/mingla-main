import React from "react";

import { Calendar } from "../src/Calendar";
import { CalendarInput } from "../src/CalendarInput";
import { choosePlacement } from "../src/placement";

type Node = { type: unknown; props: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => { root: { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
  act: (callback: () => void | Promise<void>) => void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Tree = ReturnType<typeof TestRenderer.create>;

const mount = (element: React.ReactElement): Tree => {
  let tree!: Tree;
  TestRenderer.act(() => {
    tree = TestRenderer.create(element);
  });
  return tree;
};
const byId = (tree: Tree, id: string): Node[] => tree.root.findAll((n) => n.props["data-testid"] === id);
const click = (tree: Tree, id: string): void => {
  const hit = byId(tree, id).find((n) => typeof n.props.onClick === "function");
  if (hit === undefined) throw new Error(`nothing clickable: ${id}`);
  TestRenderer.act(() => {
    (hit.props.onClick as () => void)();
  });
};
const key = (tree: Tree, id: string, k: string, shiftKey = false): void => {
  const root = byId(tree, id).find((n) => typeof n.props.onKeyDown === "function");
  if (root === undefined) throw new Error("no key handler");
  TestRenderer.act(() => {
    (root.props.onKeyDown as (e: object) => void)({ key: k, shiftKey, preventDefault: () => undefined });
  });
};
const text = (tree: Tree, id: string): string => String(byId(tree, id)[0].props.children ?? "");

describe("issue #4523 calendar-web", () => {
  it.each(["date", "datetime", "range"] as const)(
    "%s: month navigation by button and keyboard never commits or cancels",
    (mode) => {
      const onCommit = jest.fn();
      const onCancel = jest.fn();
      const value = mode === "range" ? { start: "2027-03-12", end: "2027-03-16" } : mode === "datetime" ? "2027-03-12T19:00" : "2027-03-12";
      const tree = mount(<Calendar mode={mode} value={value} onCommit={onCommit} onCancel={onCancel} timeZone="Africa/Lagos" idPrefix="c" />);
      const title = text(tree, "c-title");
      for (let i = 0; i < 14; i += 1) click(tree, "c-next");
      for (let i = 0; i < 14; i += 1) click(tree, "c-prev");
      for (let i = 0; i < 3; i += 1) key(tree, "c", "PageDown");
      for (let i = 0; i < 2; i += 1) key(tree, "c", "PageUp", true);
      key(tree, "c", "ArrowRight");
      key(tree, "c", "End");
      expect(onCommit).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      expect(byId(tree, "c").length).toBeGreaterThan(0);
      expect(typeof title).toBe("string");
    },
  );

  it("navigation really moves the month", () => {
    const tree = mount(<Calendar mode="date" value="2027-03-12" onCommit={jest.fn()} onCancel={jest.fn()} timeZone="Africa/Lagos" idPrefix="c" />);
    const start = text(tree, "c-title");
    click(tree, "c-next");
    expect(text(tree, "c-title")).not.toBe(start);
    click(tree, "c-prev");
    expect(text(tree, "c-title")).toBe(start);
  });

  it("date: a day click commits once; Escape cancels; a disabled day cannot be picked", () => {
    const onCommit = jest.fn();
    const onCancel = jest.fn();
    const tree = mount(<Calendar mode="date" value="" min="2027-03-10" onCommit={onCommit} onCancel={onCancel} timeZone="Africa/Lagos" idPrefix="c" />);
    // The component opens on today; jump to March 2027 by navigating until the 10th is on screen.
    for (let i = 0; i < 400 && byId(tree, "c-day-2027-03-15").length === 0; i += 1) click(tree, "c-next");
    const before = byId(tree, "c-day-2027-03-05");
    if (before.length > 0) {
      TestRenderer.act(() => (before[0].props.onClick as () => void)());
      expect(onCommit).not.toHaveBeenCalled();
    }
    click(tree, "c-day-2027-03-15");
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("2027-03-15");
    key(tree, "c", "Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("datetime: Done needs a day and a time and commits YYYY-MM-DDTHH:mm; range commits on Done", () => {
    const onCommit = jest.fn();
    const tree = mount(<Calendar mode="datetime" value="2027-03-12T19:00" onCommit={onCommit} onCancel={jest.fn()} timeZone="Africa/Lagos" idPrefix="c" />);
    click(tree, "c-time-20:30");
    expect(onCommit).not.toHaveBeenCalled();
    click(tree, "c-done");
    expect(onCommit).toHaveBeenCalledWith("2027-03-12T20:30");

    const onRange = jest.fn();
    const r = mount(<Calendar mode="range" value={{ start: "", end: "" }} onCommit={onRange} onCancel={jest.fn()} timeZone="Africa/Lagos" idPrefix="r" />);
    for (let i = 0; i < 400 && byId(r, "r-day-2027-03-12").length === 0; i += 1) click(r, "r-next");
    click(r, "r-day-2027-03-12");
    click(r, "r-day-2027-03-16");
    expect(onRange).not.toHaveBeenCalled();
    click(r, "r-done");
    expect(onRange).toHaveBeenCalledWith({ start: "2027-03-12", end: "2027-03-16" });
  });

  it("CalendarInput: writes a hidden input with the value, onChange is input-like, Escape closes it", () => {
    const onChange = jest.fn();
    const tree = mount(<CalendarInput mode="date" name="from" value="2027-03-12" onChange={onChange} timeZone="Africa/Lagos" id="f" />);
    const hidden = tree.root.findAll((n) => n.type === "input" && n.props.type === "hidden");
    expect(hidden).toHaveLength(1);
    expect(hidden[0].props.name).toBe("from");
    expect(hidden[0].props.value).toBe("2027-03-12");
    expect(byId(tree, "f").length).toBe(0); // closed: no calendar yet

    click(tree, "f-button");
    expect(byId(tree, "f").length).toBeGreaterThan(0);
    key(tree, "f", "Escape");
    expect(byId(tree, "f").length).toBe(0);
    expect(onChange).not.toHaveBeenCalled();

    click(tree, "f-button");
    click(tree, "f-day-2027-03-20");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].target.value).toBe("2027-03-20");
    expect(onChange.mock.calls[0][0].target.name).toBe("from");
    expect(byId(tree, "f").length).toBe(0);
  });

  it("CalendarInput: uncontrolled defaultValue updates itself; clearable commits an empty value", () => {
    const onChange = jest.fn();
    const tree = mount(<CalendarInput mode="date" name="d" defaultValue="2027-03-12" clearable onChange={onChange} timeZone="Africa/Lagos" id="u" />);
    click(tree, "u-button");
    click(tree, "u-clear");
    expect(onChange.mock.calls[0][0].target.value).toBe("");
    const hidden = tree.root.findAll((n) => n.type === "input" && n.props.type === "hidden");
    expect(hidden[0].props.value).toBe("");
  });

  it("an unset field shows a placeholder, never today's date", () => {
    const tree = mount(<CalendarInput mode="datetime" value="" timeZone="Africa/Lagos" id="p" />);
    const label = byId(tree, "p-button")[0].props["aria-label"] as string;
    expect(label).toContain("not set");
  });

  it("popover placement: below when it fits, above when only that fits, never off the right edge", () => {
    const base = { popoverHeight: 380, popoverWidth: 320, viewportHeight: 800, viewportWidth: 1200, triggerLeft: 100 };
    expect(choosePlacement({ ...base, triggerTop: 100, triggerBottom: 140 })).toEqual({ vertical: "below", horizontal: "start" });
    // A trigger near the bottom of a drawer: 800 - 700 = 100px below, 660px above.
    expect(choosePlacement({ ...base, triggerTop: 660, triggerBottom: 700 })).toEqual({ vertical: "above", horizontal: "start" });
    // Fits neither way: the side with more room.
    expect(choosePlacement({ ...base, viewportHeight: 500, triggerTop: 200, triggerBottom: 240 }).vertical).toBe("below");
    expect(choosePlacement({ ...base, viewportHeight: 500, triggerTop: 300, triggerBottom: 340 }).vertical).toBe("above");
    // A trigger near the right edge aligns to its end.
    expect(choosePlacement({ ...base, triggerTop: 100, triggerBottom: 140, triggerLeft: 1000 }).horizontal).toBe("end");
  });
});
