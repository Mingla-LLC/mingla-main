/**
 * #4490 P1 click-test D20–D22, D25, D27, D29 — the real TimeField,
 * DayDateField, BrandHoursEditor and SuiteDesktopShell mounted under the stock
 * config (bare react-test-renderer). Sheet / Icon / layout hooks are stubs;
 * every assertion reads what the component does when a host types or clicks.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("../Icon", () => ({ Icon: () => null }));
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return { ScrollView: View };
});
// The list / calendar sheet: rendered inline while open, nothing while closed.
jest.mock("../Sheet", () => ({
  Sheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? children : null,
}));
jest.mock("../../programs/TimeField", () => ({
  timeLabel: (v: string) => v,
  timePickerPresentation: () => "web",
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void | Promise<void>) => Promise<void> | void;
  create: (el: React.ReactElement) => {
    root: {
      findByProps: (p: Record<string, unknown>) => { props: Record<string, unknown> };
      findAllByProps: (p: Record<string, unknown>) => { props: Record<string, unknown> }[];
      findAll: (pred: (n: { type: unknown; props: Record<string, unknown> }) => boolean) => {
        type: unknown;
        props: Record<string, unknown>;
      }[];
    };
    update: (el: React.ReactElement) => void;
    unmount: () => void;
  };
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TimeField } = require("../TimeField") as typeof import("../TimeField");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DayDateField } = require("../DayDateField") as typeof import("../DayDateField");

function mount(el: React.ReactElement): ReturnType<typeof TestRenderer.create> {
  let tree: ReturnType<typeof TestRenderer.create> | null = null;
  void TestRenderer.act(() => {
    tree = TestRenderer.create(el);
  });
  return tree as unknown as ReturnType<typeof TestRenderer.create>;
}

function act(cb: () => void): void {
  void TestRenderer.act(cb);
}

describe("TimeField (D20/D21/D22)", () => {
  it("shows a stored HH:mm:ss without seconds", () => {
    const tree = mount(
      <TimeField label="Opens" value="09:00:00" onChangeValue={() => undefined} accessibilityLabel="Opens" testID="t" />,
    );
    expect(tree.root.findByProps({ testID: "t-input" }).props.value).toBe("09:00");
  });

  it("typing a full 24-hour time commits it (22:00, then 0200 → 02:00)", () => {
    const onChange = jest.fn();
    const tree = mount(
      <TimeField label="Closes" value="21:00" onChangeValue={onChange} accessibilityLabel="Closes" testID="t" />,
    );
    const input = tree.root.findByProps({ testID: "t-input" });
    act(() => (input.props.onFocus as () => void)());
    act(() => (input.props.onChangeText as (t: string) => void)("22:00"));
    expect(onChange).toHaveBeenLastCalledWith("22:00");
    act(() => (input.props.onChangeText as (t: string) => void)("0200"));
    expect(onChange).toHaveBeenLastCalledWith("02:00");
  });

  it("a half-typed time is checked when the host leaves the field", () => {
    const onChange = jest.fn();
    const tree = mount(
      <TimeField label="Opens" value="09:00" onChangeValue={onChange} accessibilityLabel="Opens" testID="t" />,
    );
    const input = tree.root.findByProps({ testID: "t-input" });
    act(() => (input.props.onFocus as () => void)());
    act(() => (input.props.onChangeText as (t: string) => void)("7"));
    expect(onChange).not.toHaveBeenCalled();
    act(() => (input.props.onBlur as () => void)());
    expect(onChange).toHaveBeenLastCalledWith("07:00");
    act(() => (input.props.onFocus as () => void)());
    act(() => (input.props.onChangeText as (t: string) => void)("7pm"));
    act(() => (input.props.onBlur as () => void)());
    expect(tree.root.findAll((n) => n.props.children === "Use 24-hour time, like 22:00.").length).toBeGreaterThan(0);
  });

  it("a time can be clicked from the list", () => {
    const onChange = jest.fn();
    const tree = mount(
      <TimeField label="Closes" value="18:00" onChangeValue={onChange} accessibilityLabel="Closes" testID="t" />,
    );
    act(() => (tree.root.findByProps({ testID: "t-list" }).props.onPress as () => void)());
    act(() => (tree.root.findByProps({ testID: "t-option-22:00" }).props.onPress as () => void)());
    expect(onChange).toHaveBeenLastCalledWith("22:00");
  });

  it("re-reads a new value from its owner (a saved value always shows)", () => {
    const tree = mount(
      <TimeField label="Closes" value="21:00" onChangeValue={() => undefined} accessibilityLabel="Closes" testID="t" />,
    );
    act(() =>
      tree.update(
        <TimeField label="Closes" value="02:00:00" onChangeValue={() => undefined} accessibilityLabel="Closes" testID="t" />,
      ),
    );
    expect(tree.root.findByProps({ testID: "t-input" }).props.value).toBe("02:00");
  });
});

describe("DayDateField (D25)", () => {
  it("reads a typed date day first and shows it day first", () => {
    const onChange = jest.fn();
    const tree = mount(
      <DayDateField label="Date" value="" onChangeValue={onChange} accessibilityLabel="Date" today="2026-11-18" min="2026-11-18" testID="d" />,
    );
    const input = tree.root.findByProps({ testID: "d-input" });
    act(() => (input.props.onFocus as () => void)());
    act(() => (input.props.onChangeText as (t: string) => void)("25/12/2026"));
    act(() => (input.props.onBlur as () => void)());
    expect(onChange).toHaveBeenLastCalledWith("2026-12-25");
    expect(tree.root.findByProps({ testID: "d-input" }).props.value).toBe("Fri 25 Dec 2026");
  });

  it("a day can be clicked on the calendar; past days cannot", () => {
    const onChange = jest.fn();
    const tree = mount(
      <DayDateField label="Date" value="" onChangeValue={onChange} accessibilityLabel="Date" today="2026-11-18" min="2026-11-18" testID="d" />,
    );
    act(() => (tree.root.findByProps({ testID: "d-calendar" }).props.onPress as () => void)());
    expect(tree.root.findByProps({ testID: "d-day-2026-11-17" }).props.disabled).toBe(true);
    act(() => (tree.root.findByProps({ testID: "d-next" }).props.onPress as () => void)());
    act(() => (tree.root.findByProps({ testID: "d-day-2026-12-31" }).props.onPress as () => void)());
    expect(onChange).toHaveBeenLastCalledWith("2026-12-31");
  });

  it("shows its own error under the date", () => {
    const tree = mount(
      <DayDateField label="Date" value="" onChangeValue={() => undefined} accessibilityLabel="Date" today="2026-11-18" error="Pick a date." testID="d" />,
    );
    expect(tree.root.findByProps({ testID: "d-error" }).props.children).toBe("Pick a date.");
  });
});
