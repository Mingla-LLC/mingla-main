import React from "react";

import { DateField } from "../DateField";

jest.mock("../Sheet", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable } = require("react-native") as typeof import("react-native");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return {
    Sheet: ({ visible, onClose, testID, children }: { visible: boolean; onClose: () => void; testID?: string; children: React.ReactNode }) =>
      visible
        ? R.createElement(
            R.Fragment,
            null,
            R.createElement(Pressable, { testID: testID?.replace(/-sheet$/, "-close"), onPress: onClose }),
            children,
          )
        : null,
  };
});
jest.mock("../Icon", () => ({ Icon: () => null }));

type Node = { props: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: { findAll: (predicate: (n: Node) => boolean) => Node[] };
    unmount: () => void;
  };
  act: (callback: () => void | Promise<void>) => Promise<void> & void;
};

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Tree = ReturnType<typeof TestRenderer.create>;

const mount = async (onChangeValue: jest.Mock, value = "2027-03-12"): Promise<Tree> => {
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <DateField
        label="Start"
        accessibilityLabel="Start date"
        value={value}
        onChangeValue={onChangeValue}
        timeZone="Africa/Lagos"
        testID="df"
      />,
    );
  });
  return tree;
};

const press = async (tree: Tree, testID: string): Promise<void> => {
  await TestRenderer.act(async () => {
    const hit = tree.root.findAll(
      (n) => n.props.testID === testID && typeof n.props.onPress === "function",
    )[0];
    if (hit === undefined) throw new Error(`nothing pressable with testID ${testID}`);
    (hit.props.onPress as () => void)();
  });
};

const open = (tree: Tree): boolean =>
  tree.root.findAll((n) => n.props.testID === "df-calendar-next").length > 0;

describe("issue #4523 Host DateField uses the Mingla calendar", () => {
  it("opens the calendar; changing month many times never closes it or commits", async () => {
    const onChangeValue = jest.fn();
    const tree = await mount(onChangeValue);
    expect(open(tree)).toBe(false);
    await press(tree, "df");
    expect(open(tree)).toBe(true);

    for (let i = 0; i < 14; i += 1) await press(tree, "df-calendar-next");
    for (let i = 0; i < 14; i += 1) await press(tree, "df-calendar-prev");

    expect(open(tree)).toBe(true);
    expect(onChangeValue).not.toHaveBeenCalled();
  });

  it("a day tap commits YYYY-MM-DD once and closes", async () => {
    const onChangeValue = jest.fn();
    const tree = await mount(onChangeValue);
    await press(tree, "df");
    await press(tree, "df-calendar-next");
    await press(tree, "df-calendar-day-2027-04-20");
    expect(onChangeValue).toHaveBeenCalledTimes(1);
    expect(onChangeValue).toHaveBeenCalledWith("2027-04-20");
    expect(open(tree)).toBe(false);
  });

  it("closing without a pick leaves the value alone", async () => {
    const onChangeValue = jest.fn();
    const tree = await mount(onChangeValue);
    await press(tree, "df");
    await press(tree, "df-close");
    expect(onChangeValue).not.toHaveBeenCalled();
    expect(open(tree)).toBe(false);
  });

  it("an unset value shows the placeholder, never today's date", async () => {
    const tree = await mount(jest.fn(), "");
    const texts = tree.root
      .findAll((n) => typeof n.props.children === "string")
      .map((n) => n.props.children as string);
    expect(texts).toContain("Choose a date");
  });
});
