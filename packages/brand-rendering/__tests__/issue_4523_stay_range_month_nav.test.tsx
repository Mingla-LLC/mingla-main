/**
 * #4523 checkpoint 18 — the stay dates (StayDateRangeField, native entry) are
 * picked from the one Mingla range calendar. Mounts the REAL field with the
 * REAL calendar surface (`@mingla/calendar` CalendarEmbed, as the Host and
 * Explorer renderers do), and proves:
 *   - no OS date picker is loaded;
 *   - month navigation (×14 forward, ×14 back) never closes the calendar and
 *     never changes a date;
 *   - two day taps + Done commit through the stay rules, check-in first, with
 *     the picked YYYY-MM-DD values byte-identical to the old picker's
 *     `formatStayDate` of the same days;
 *   - a day past the booking horizon cannot START a stay but can end one;
 *   - tapping a row again closes without a change.
 */
import React from "react";
import { Platform } from "react-native";
import { CalendarEmbed } from "@mingla/calendar/CalendarFieldEager";

import { StayDateRangeField, type StayRangeCalendarArgs } from "../StayDateRangeField.native";
import { formatStayDate } from "../stayDateRules";

jest.mock("@react-native-community/datetimepicker", () => {
  throw new Error("the stay dates must never load the OS date picker (#4523)");
});

type Node = { props: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: { findAll: (predicate: (n: Node) => boolean) => Node[] };
    unmount: () => void;
  };
  act: (callback: () => void) => void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Tree = ReturnType<typeof TestRenderer.create>;

const palette = {
  page: "#0c0e12",
  accent: "#eb7825",
  accentText: "#0c0e12",
  primaryText: "#ffffff",
  secondaryText: "#aaaaaa",
  tertiaryText: "#888888",
  panel: "#14171d",
  panelStrong: "#191d24",
  panelBorder: "#333333",
  card: "#111111",
  cutoutBorder: "#333333",
  glass: "rgba(255,255,255,0.06)",
  glassTint: "dark" as const,
  accentWash: "rgba(235,120,37,0.16)",
};

const bounds = {
  minCheckIn: "2027-01-01",
  maxCheckIn: "2027-09-30",
  minCheckOut: "2027-03-13",
  maxCheckOut: "2028-03-11",
  error: null,
};

const renderCalendar = (args: StayRangeCalendarArgs): React.ReactElement => (
  <CalendarEmbed
    mode="range"
    unit="nights"
    label={args.label}
    value={args.value}
    onChange={args.onCommit}
    onDone={args.onClose}
    onCancel={args.onClose}
    min={args.min}
    max={args.max}
    maxLength={args.maxLength}
    maxStart={args.maxStart}
    timeZone={args.timeZone}
    testID={args.testID}
    config={{ tokens: args.tokens, primitives: { Sheet: () => null } }}
  />
);

const mount = (onChange: jest.Mock, value = { checkIn: "2027-03-12", checkOut: "2027-03-16" }): Tree => {
  let tree!: Tree;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      <StayDateRangeField
        value={value}
        bounds={bounds}
        palette={palette}
        onChange={onChange}
        renderCalendar={renderCalendar}
        timeZone="Africa/Lagos"
        testID="s-"
      />,
    );
  });
  return tree;
};

const pressable = (tree: Tree, testID: string): Node | undefined =>
  tree.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function")[0];
const press = (tree: Tree, testID: string): void => {
  const hit = pressable(tree, testID);
  if (hit === undefined) throw new Error(`nothing pressable with testID ${testID}`);
  TestRenderer.act(() => {
    (hit.props.onPress as () => void)();
  });
};
const isOpen = (tree: Tree): boolean => pressable(tree, "s-stay-date-calendar-next") !== undefined;

describe.each(["ios", "android"] as const)("#4523 stay dates on the Mingla range calendar (%s)", (os) => {
  beforeAll(() => {
    (Platform as { OS: string }).OS = os;
  });

  it.each([["s-stay-date-check-in"], ["s-stay-date-check-out"]])(
    "%s opens it; month changes never close or commit; Done commits through the stay rules",
    (rowId) => {
      const onChange = jest.fn();
      const tree = mount(onChange);
      // Same accessibility labels as before.
      const label = (id: string): unknown =>
        tree.root.findAll((n) => n.props.testID === id && typeof n.props.accessibilityLabel === "string")[0]?.props
          .accessibilityLabel;
      expect(label("s-stay-date-check-in")).toBe("Check-in date, currently March 12, 2027");
      expect(label("s-stay-date-check-out")).toBe("Check-out date, currently March 16, 2027");

      press(tree, rowId);
      expect(isOpen(tree)).toBe(true);
      for (let i = 0; i < 14; i += 1) press(tree, "s-stay-date-calendar-next");
      for (let i = 0; i < 14; i += 1) press(tree, "s-stay-date-calendar-prev");
      expect(isOpen(tree)).toBe(true);
      expect(onChange).not.toHaveBeenCalled();

      // A day before the current check-in starts a new range; the next day after it ends it.
      press(tree, "s-stay-date-calendar-day-2027-03-05");
      press(tree, "s-stay-date-calendar-day-2027-03-09");
      expect(onChange).not.toHaveBeenCalled();
      press(tree, "s-stay-date-calendar-done");

      // Check-in first, then check-out — the same two edits, in the same order,
      // through the same stay rules as two separate picks before.
      expect(onChange.mock.calls).toEqual([
        [{ checkIn: "2027-03-05", checkOut: "2027-03-16" }, "check_in"],
        [{ checkIn: "2027-03-05", checkOut: "2027-03-09" }, "check_out"],
      ]);
      // Byte-identical to the old native picker's conversion of the same days.
      expect(onChange.mock.calls[1][0]).toEqual({
        checkIn: formatStayDate(new Date(2027, 2, 5, 12)),
        checkOut: formatStayDate(new Date(2027, 2, 9, 12)),
      });
      expect(isOpen(tree)).toBe(false);
    },
  );

  it("a day past the booking horizon cannot start a stay, but can end one", () => {
    const onChange = jest.fn();
    const tree = mount(onChange, { checkIn: "", checkOut: "" });
    press(tree, "s-stay-date-check-in");
    // Jump to the horizon month (bounds.maxCheckIn = 2027-09-30).
    for (let i = 0; i < 8; i += 1) press(tree, "s-stay-date-calendar-next");
    press(tree, "s-stay-date-calendar-next");
    const dayDisabled = (date: string): boolean | undefined =>
      (pressable(tree, `s-stay-date-calendar-day-${date}`)?.props.accessibilityState as { disabled?: boolean } | undefined)
        ?.disabled;
    // 2027-10-02 is after the horizon: it is unavailable as a start, and tapping it starts nothing.
    expect(dayDisabled("2027-10-02")).toBe(true);
    press(tree, "s-stay-date-calendar-day-2027-10-02");
    expect(
      (pressable(tree, "s-stay-date-calendar-done")?.props.accessibilityState as { disabled?: boolean } | undefined)?.disabled,
    ).toBe(true);
    // Start on the last bookable night, end after the horizon: allowed.
    press(tree, "s-stay-date-calendar-prev");
    expect(dayDisabled("2027-09-30")).toBe(false);
    press(tree, "s-stay-date-calendar-day-2027-09-30");
    press(tree, "s-stay-date-calendar-next");
    // With a start chosen, the same day can end the stay.
    expect(dayDisabled("2027-10-02")).toBe(false);
    press(tree, "s-stay-date-calendar-day-2027-10-02");
    press(tree, "s-stay-date-calendar-done");
    expect(onChange.mock.calls.at(-1)).toEqual([{ checkIn: "2027-09-30", checkOut: "2027-10-02" }, "check_out"]);
  });

  it("tapping a row again closes the calendar and keeps the dates", () => {
    const onChange = jest.fn();
    const tree = mount(onChange);
    press(tree, "s-stay-date-check-in");
    press(tree, "s-stay-date-calendar-day-2027-03-20");
    press(tree, "s-stay-date-check-in");
    expect(isOpen(tree)).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});
