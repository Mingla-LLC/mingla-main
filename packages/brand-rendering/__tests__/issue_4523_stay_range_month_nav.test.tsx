import React from "react";
import { Platform } from "react-native";

import { StayDateRangeField } from "../StayDateRangeField.native";

type PickerProps = {
  value: Date;
  onChange: (event: { type: string }, date?: Date) => void;
};

let lastPickerProps: PickerProps | null = null;

jest.mock("@react-native-community/datetimepicker", () => ({
  __esModule: true,
  default: (props: PickerProps) => {
    lastPickerProps = props;
    return null;
  },
}));

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

const palette = {
  primaryText: "#fff",
  secondaryText: "#aaa",
  tertiaryText: "#888",
  card: "#111",
  panelBorder: "#333",
  glassTint: "dark",
};

const bounds = {
  minCheckIn: "2027-01-01",
  maxCheckIn: "2028-12-31",
  minCheckOut: "2027-01-02",
  maxCheckOut: "2029-01-01",
};

const setOS = (os: "ios" | "android"): void => {
  (Platform as { OS: string }).OS = os;
};

const mount = (onChange: jest.Mock) => {
  let tree!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      <StayDateRangeField
        value={{ checkIn: "2027-03-12", checkOut: "2027-03-16" }}
        bounds={bounds}
        palette={palette as never}
        onChange={onChange}
        testID="s-"
      />,
    );
  });
  return tree;
};

const press = (
  tree: ReturnType<typeof TestRenderer.create>,
  testID: string,
): void => {
  TestRenderer.act(() => {
    const hit = tree.root.findAll(
      (n) => n.props.testID === testID && typeof n.props.onPress === "function",
    )[0];
    (hit.props.onPress as () => void)();
  });
};

const fire = (type: string, date?: Date): void => {
  TestRenderer.act(() => {
    lastPickerProps?.onChange({ type }, date);
  });
};

const has = (
  tree: ReturnType<typeof TestRenderer.create>,
  testID: string,
): boolean => tree.root.findAll((n) => n.props.testID === testID).length > 0;

describe("issue #4523 StayDateRangeField.native month navigation never closes", () => {
  beforeEach(() => {
    lastPickerProps = null;
  });

  it.each([
    ["s-stay-date-check-in", "check_in", "2027-06-20"],
    ["s-stay-date-check-out", "check_out", "2027-06-20"],
  ])("iOS %s: events never commit or close; Done commits once", (rowId, field) => {
    setOS("ios");
    const onChange = jest.fn();
    const tree = mount(onChange);
    press(tree, rowId);
    expect(lastPickerProps).not.toBeNull();

    fire("set", new Date(2027, 3, 20));
    fire("dismissed");
    fire("set", new Date(2027, 5, 20));

    expect(onChange).not.toHaveBeenCalled();
    expect(has(tree, "s-stay-date-done")).toBe(true);

    press(tree, "s-stay-date-done");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][1]).toBe(field);
    expect(has(tree, "s-stay-date-done")).toBe(false);
  });

  it("iOS: Cancel closes without committing", () => {
    setOS("ios");
    const onChange = jest.fn();
    const tree = mount(onChange);
    press(tree, "s-stay-date-check-in");
    fire("set", new Date(2027, 4, 20));
    press(tree, "s-stay-date-cancel");
    expect(onChange).not.toHaveBeenCalled();
    expect(has(tree, "s-stay-date-cancel")).toBe(false);
  });

  it("Android: set commits and closes; dismissed closes without committing", () => {
    setOS("android");
    const onChange = jest.fn();
    const tree = mount(onChange);
    press(tree, "s-stay-date-check-in");
    fire("set", new Date(2027, 3, 20));
    expect(onChange).toHaveBeenCalledTimes(1);

    onChange.mockClear();
    press(tree, "s-stay-date-check-in");
    fire("dismissed");
    expect(onChange).not.toHaveBeenCalled();
  });
});
