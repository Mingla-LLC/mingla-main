import React from "react";
import { Pressable, View } from "react-native";

import { MenuCategorySheet } from "../MenuCategorySheet";
import { MenuItemSheet } from "../MenuItemSheet";
import { MenuModifierGroupEditor } from "../MenuModifierGroupEditor";

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: "AnimatedView" },
  useAnimatedStyle: () => ({}),
  useReducedMotion: () => true,
  useSharedValue: (value: number) => ({ value }),
  withTiming: (value: number) => value,
}));
jest.mock("../../../utils/hapticFeedback", () => ({
  HapticFeedback: { buttonPress: jest.fn() },
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLocal = require("react") as typeof React;
  return {
    ScrollView: ({ children, ...props }: { children: React.ReactNode }) =>
      ReactLocal.createElement("ScrollView", props, children),
  };
});
jest.mock("../../ui/Sheet", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLocal = require("react") as typeof React;
  return {
    Sheet: ({
      visible,
      children,
      testID,
    }: {
      visible: boolean;
      children: React.ReactNode;
      testID?: string;
    }) =>
      visible
        ? ReactLocal.createElement("Sheet", { testID }, children)
        : null,
  };
});
jest.mock("../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("../../ui/BrandSwitch", () => ({ BrandSwitch: "BrandSwitch" }));
jest.mock("../../ui/Icon", () => ({ Icon: "Icon" }));
jest.mock("../../ui/Spinner", () => ({ Spinner: "Spinner" }));

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}

interface RenderTree {
  root: TestInstance;
  unmount: () => void;
}

// react-test-renderer intentionally has no declarations in this workspace.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

async function mount(element: React.ReactElement): Promise<RenderTree> {
  let tree!: RenderTree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(element);
  });
  return tree;
}

function pressable(tree: RenderTree, testID: string): TestInstance {
  const matches = tree.root.findAll(
    (node) => node.type === Pressable && node.props.testID === testID,
  );
  if (matches[0] === undefined) throw new Error(`Missing Pressable ${testID}`);
  return matches[0];
}

function view(tree: RenderTree, testID: string): TestInstance {
  const matches = tree.root.findAll(
    (node) => node.type === View && node.props.testID === testID,
  );
  if (matches[0] === undefined) throw new Error(`Missing View ${testID}`);
  return matches[0];
}

async function press(node: TestInstance): Promise<void> {
  const onPress = node.props.onPress;
  if (typeof onPress !== "function") throw new Error("Control has no onPress");
  await TestRenderer.act(async () => {
    await onPress({});
  });
}

describe("issue #3569 menu choice selected-state semantics", () => {
  it("announces each service day as an independently checked checkbox", async () => {
    const tree = await mount(
      <MenuCategorySheet
        visible
        onClose={jest.fn()}
        category={null}
        onSave={jest.fn()}
        saving={false}
      />,
    );
    const monday = pressable(tree, "menu-category-day-1");

    expect(monday.props.accessibilityRole).toBe("checkbox");
    expect(monday.props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    );
    expect(monday.props["aria-checked"]).toBe(true);

    await press(monday);
    expect(pressable(tree, "menu-category-day-1").props.accessibilityState).toEqual(
      expect.objectContaining({ checked: false }),
    );
    await TestRenderer.act(async () => tree.unmount());
  });

  it("announces the nullable prep station as a reversible togglebutton", async () => {
    const tree = await mount(
      <MenuItemSheet
        visible
        onClose={jest.fn()}
        item={null}
        currency="USD"
        brandHasCurrency
        onSave={jest.fn()}
        saving={false}
      />,
    );
    const kitchen = pressable(tree, "menu-item-station-kitchen");

    expect(kitchen.props.accessibilityRole).toBe("togglebutton");
    expect(kitchen.props.accessibilityState).toEqual(
      expect.objectContaining({ checked: false }),
    );
    await press(kitchen);
    expect(pressable(tree, "menu-item-station-kitchen").props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    );
    await press(pressable(tree, "menu-item-station-kitchen"));
    expect(pressable(tree, "menu-item-station-kitchen").props.accessibilityState).toEqual(
      expect.objectContaining({ checked: false }),
    );
    await TestRenderer.act(async () => tree.unmount());
  });

  it("keeps pick mode inside one radiogroup and moves checked state", async () => {
    const tree = await mount(
      <MenuModifierGroupEditor
        menuItemId="item-1"
        group={null}
        currency="USD"
        nextSortOrder={0}
        onSave={jest.fn()}
        saving={false}
        onCancel={jest.fn()}
      />,
    );

    const group = view(tree, "modifier-group-mode");
    const single = pressable(tree, "modifier-group-mode-single");
    const multi = pressable(tree, "modifier-group-mode-multi");
    expect(group.props.accessibilityRole).toBe("radiogroup");
    expect(group.props.accessibilityLabel).toBe("How many options can guests pick?");
    expect(single.props.accessibilityRole).toBe("radio");
    expect(single.props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    );
    expect(multi.props.accessibilityState).toEqual(
      expect.objectContaining({ checked: false }),
    );

    await press(multi);
    expect(pressable(tree, "modifier-group-mode-single").props.accessibilityState).toEqual(
      expect.objectContaining({ checked: false }),
    );
    expect(pressable(tree, "modifier-group-mode-multi").props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    );
    await TestRenderer.act(async () => tree.unmount());
  });

  it("gives Required/Optional one stable toggle name and changing checked state", async () => {
    const tree = await mount(
      <MenuModifierGroupEditor
        menuItemId="item-1"
        group={null}
        currency="USD"
        nextSortOrder={0}
        onSave={jest.fn()}
        saving={false}
        onCancel={jest.fn()}
      />,
    );
    const required = pressable(tree, "modifier-group-required");
    expect(required.props.accessibilityRole).toBe("togglebutton");
    expect(required.props.accessibilityLabel).toBe("Options required");
    expect(required.props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    );

    await press(required);
    const optional = pressable(tree, "modifier-group-required");
    expect(optional.props.accessibilityLabel).toBe("Options required");
    expect(optional.props.accessibilityState).toEqual(
      expect.objectContaining({ checked: false }),
    );
    await TestRenderer.act(async () => tree.unmount());
  });
});
