import React from "react";
import { Platform } from "react-native";

import { DateField } from "../DateField";

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

// react-test-renderer intentionally has no declarations in this workspace.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: {
      findAll: (
        predicate: (n: { props: Record<string, unknown> }) => boolean,
      ) => { props: Record<string, unknown> }[];
    };
    unmount: () => void;
  };
  act: (callback: () => void) => void;
};

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const setOS = (os: "ios" | "android"): void => {
  (Platform as { OS: string }).OS = os;
};

const mount = (onChangeValue: jest.Mock) => {
  let tree!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      <DateField
        label="Start"
        accessibilityLabel="Start date"
        value="2027-03-12"
        onChangeValue={onChangeValue}
        testID="df"
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

describe("issue #4523 DateField month navigation never closes the picker", () => {
  beforeEach(() => {
    lastPickerProps = null;
  });

  it("iOS: native events never commit or close; Done commits the last draft once", () => {
    setOS("ios");
    const onChangeValue = jest.fn();
    const tree = mount(onChangeValue);
    press(tree, "df");
    expect(lastPickerProps).not.toBeNull();

    fire("set", new Date(2027, 3, 12));
    fire("set", new Date(2027, 4, 12));
    fire("dismissed");
    fire("set", new Date(2027, 5, 12));

    expect(lastPickerProps).not.toBeNull();
    expect(onChangeValue).not.toHaveBeenCalled();

    press(tree, "df-done");
    expect(onChangeValue).toHaveBeenCalledTimes(1);
    expect(onChangeValue).toHaveBeenCalledWith("2027-06-12");
    // Picker unmounted: no Done button left.
    expect(tree.root.findAll((n) => n.props.testID === "df-done")).toHaveLength(0);
  });

  it("iOS: Cancel closes without committing", () => {
    setOS("ios");
    const onChangeValue = jest.fn();
    const tree = mount(onChangeValue);
    press(tree, "df");
    fire("set", new Date(2027, 4, 12));
    press(tree, "df-cancel");
    expect(onChangeValue).not.toHaveBeenCalled();
    expect(tree.root.findAll((n) => n.props.testID === "df-cancel")).toHaveLength(0);
  });

  it("Android: set commits and closes; dismissed closes without committing", () => {
    setOS("android");
    const onChangeValue = jest.fn();
    let tree = mount(onChangeValue);
    press(tree, "df");
    fire("set", new Date(2027, 3, 20));
    expect(onChangeValue).toHaveBeenCalledTimes(1);
    expect(onChangeValue).toHaveBeenCalledWith("2027-04-20");
    TestRenderer.act(() => tree.unmount());

    onChangeValue.mockClear();
    lastPickerProps = null;
    tree = mount(onChangeValue);
    press(tree, "df");
    expect(lastPickerProps).not.toBeNull();
    fire("dismissed");
    expect(onChangeValue).not.toHaveBeenCalled();
    expect(tree.root.findAll((n) => n.props.testID === "df-done")).toHaveLength(0);
  });
});
