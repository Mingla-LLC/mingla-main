/* eslint-disable @typescript-eslint/no-require-imports */
import React, { useState } from "react";
import { Platform, Text } from "react-native";
// @ts-expect-error react-test-renderer ships without declarations in this workspace.
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";

import {
  createThemePalette,
  offeringSurfaceStyles,
} from "../../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../../packages/offering-rendering/themeResolver";
import {
  PublicVenueTabs,
  type PublicVenueTab,
  type PublicVenueTabsHandle,
} from "../../../../../packages/brand-rendering/PublicVenueTabs";

const mockNodes: Record<
  string,
  { focus: jest.Mock; scrollIntoView: jest.Mock }
> = {};

jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native") as typeof import("react-native");
  const ReactRuntime = require("react") as typeof React;
  const RefPressable = ReactRuntime.forwardRef<
    { focus: jest.Mock; scrollIntoView: jest.Mock },
    React.ComponentProps<typeof actual.Pressable>
  >((props, ref) => {
    const label = String(props.accessibilityLabel ?? "unlabelled");
    const node =
      mockNodes[label] ?? {
        focus: jest.fn(),
        scrollIntoView: jest.fn(),
      };
    mockNodes[label] = node;
    ReactRuntime.useImperativeHandle(ref, () => node, [node]);
    return ReactRuntime.createElement(actual.Pressable, props);
  });
  const mocked = Object.create(actual) as typeof actual;
  Object.defineProperty(mocked, "Pressable", {
    enumerable: true,
    value: RefPressable,
  });
  return mocked;
});

// @ts-expect-error react-test-renderer ships without declarations in this workspace.
const TestRenderer = require("react-test-renderer") as typeof import("react-test-renderer");

const theme = resolveTheme(null, null);
const palette = createThemePalette(theme);
const surface = offeringSurfaceStyles(palette);

const setPlatform = (os: "ios" | "web"): void => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: os });
};

const keyEvent = (
  key: string,
  modifiers: Partial<{
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }> = {},
) => ({
  ...modifiers,
  nativeEvent: { key, ...modifiers },
  preventDefault: jest.fn(),
});

const renderedTabs = (root: ReactTestInstance): ReactTestInstance[] => {
  const candidates = root.findAll(
    (node: ReactTestInstance) =>
      node.props?.accessibilityRole === "tab" &&
      typeof node.props.onPress === "function" &&
      (Platform.OS !== "web" || typeof node.props.onKeyDown === "function"),
  );
  const unique = new Map<string, ReactTestInstance>();
  for (const candidate of candidates) {
    const label = String(candidate.props.accessibilityLabel);
    if (!unique.has(label)) unique.set(label, candidate);
  }
  return [...unique.values()];
};

const tabNamed = (
  root: ReactTestInstance,
  label: string,
): ReactTestInstance => {
  const found = renderedTabs(root).find(
    (tab) => tab.props.accessibilityLabel === label,
  );
  if (found === undefined) throw new Error(`tab_missing:${label}`);
  return found;
};

const panelNodes = (root: ReactTestInstance): ReactTestInstance[] =>
  root.findAll(
    (node: ReactTestInstance) =>
      typeof node.type === "string" && node.props?.role === "tabpanel",
  );

const renderWeb = async (
  element: React.ReactElement,
): Promise<ReactTestRenderer> => {
  setPlatform("web");
  for (const label of Object.keys(mockNodes)) delete mockNodes[label];
  let tree: ReactTestRenderer | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(element);
  });
  if (tree === null) throw new Error("public_venue_tabs_render_missing");
  return tree;
};

afterEach(() => {
  setPlatform("ios");
});

describe("issue #2738 tester adversarial public venue tab contract", () => {
  // Roles alone do not supply keyboard behavior or tab/panel ownership. These
  // real-component attacks must turn red if the key, ID, or panel fix is removed.
  it("A-1/A-2 survives hostile navigation and repairs a removed focused Menu exactly once", async () => {
    const onTabChange = jest.fn();
    const onTabViewed = jest.fn();
    let setHasMenu: React.Dispatch<React.SetStateAction<boolean>> | null = null;

    const Harness = (): React.ReactElement => {
      const [hasMenu, updateHasMenu] = useState(true);
      setHasMenu = updateHasMenu;
      return (
        <PublicVenueTabs
          activeTab="overview"
          hasMenu={hasMenu}
          overview={<Text>Overview child</Text>}
          menu={<Text>Menu child</Text>}
          reservations={<Text>Reservations child</Text>}
          palette={palette}
          surface={surface}
          theme={theme}
          onTabChange={onTabChange}
          onTabViewed={onTabViewed}
        />
      );
    };

    const tree = await renderWeb(<Harness />);
    onTabViewed.mockClear();
    for (let index = 0; index < 20; index += 1) {
      const source = index % 2 === 0 ? "Overview" : "Menu";
      const event = keyEvent(index % 2 === 0 ? "ArrowRight" : "ArrowLeft");
      tabNamed(tree.root, source).props.onKeyDown(event);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    }
    expect(mockNodes.Menu.focus).toHaveBeenCalledTimes(10);
    expect(mockNodes.Overview.focus).toHaveBeenCalledTimes(10);
    expect(onTabChange).not.toHaveBeenCalled();
    expect(onTabViewed).not.toHaveBeenCalled();

    await TestRenderer.act(async () => {
      tabNamed(tree.root, "Menu").props.onFocus({
        currentTarget: { matches: () => true },
      });
      setHasMenu?.(false);
    });
    expect(renderedTabs(tree.root).map((tab) => tab.props.accessibilityLabel)).toEqual([
      "Overview",
      "Reservations",
    ]);
    expect(mockNodes.Overview.focus).toHaveBeenCalledTimes(11);
    expect(onTabChange).not.toHaveBeenCalled();
    expect(onTabViewed).not.toHaveBeenCalled();
  });

  it("A-3 gives two widgets disjoint IDs and keeps every relationship local", async () => {
    const tree = await renderWeb(
      <>
        <PublicVenueTabs
          activeTab="overview"
          hasMenu
          overview={<Text>First overview</Text>}
          menu={<Text>First menu</Text>}
          reservations={<Text>First reservations</Text>}
          palette={palette}
          surface={surface}
          theme={theme}
        />
        <PublicVenueTabs
          activeTab="reservations"
          hasMenu={false}
          overview={<Text>Second overview</Text>}
          menu={<Text>Second menu</Text>}
          reservations={<Text>Second reservations</Text>}
          palette={palette}
          surface={surface}
          theme={theme}
        />
      </>,
    );
    const tabCandidates = tree.root.findAll(
      (node: ReactTestInstance) =>
        node.props?.accessibilityRole === "tab" &&
        typeof node.props.onPress === "function" &&
        typeof node.props.onKeyDown === "function",
    );
    const uniqueTabs = new Map<string, ReactTestInstance>();
    for (const tab of tabCandidates) {
      uniqueTabs.set(String(tab.props.id), tab);
    }
    const tabs = [...uniqueTabs.values()];
    const panels = panelNodes(tree.root);
    const ids = [...tabs, ...panels].map((node) => String(node.props.id));
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tab of tabs) {
      const panel = panels.find(
        (candidate) => candidate.props.id === tab.props["aria-controls"],
      );
      expect(panel?.props["aria-labelledby"]).toBe(tab.props.id);
    }
  });

  it("A-4 preserves non-owned keys and modified shortcuts", async () => {
    const tree = await renderWeb(
      <PublicVenueTabs
        activeTab="overview"
        hasMenu
        overview={<Text>Overview child</Text>}
        menu={<Text>Menu child</Text>}
        reservations={<Text>Reservations child</Text>}
        palette={palette}
        surface={surface}
        theme={theme}
      />,
    );
    for (const key of ["Tab", "ArrowUp", "ArrowDown", "Escape", "PageUp", "PageDown"]) {
      const event = keyEvent(key);
      tabNamed(tree.root, "Overview").props.onKeyDown(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey"] as const) {
      const event = keyEvent("ArrowRight", { [modifier]: true });
      tabNamed(tree.root, "Overview").props.onKeyDown(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  });

  it("A-5 activates a focused tab exactly once with Space", async () => {
    const onTabChange = jest.fn();
    const onTabViewed = jest.fn();
    const tree = await renderWeb(
      <PublicVenueTabs
        activeTab="overview"
        hasMenu
        overview={<Text>Overview child</Text>}
        menu={<Text>Menu child</Text>}
        reservations={<Text>Reservations child</Text>}
        palette={palette}
        surface={surface}
        theme={theme}
        onTabChange={onTabChange}
        onTabViewed={onTabViewed}
      />,
    );
    onTabViewed.mockClear();
    const space = keyEvent(" ");
    await TestRenderer.act(async () => {
      tabNamed(tree.root, "Menu").props.onKeyDown(space);
    });
    expect(space.preventDefault).toHaveBeenCalledTimes(1);
    expect(onTabChange).toHaveBeenCalledTimes(1);
    expect(onTabChange).toHaveBeenCalledWith("menu");
    expect(onTabViewed).toHaveBeenCalledTimes(1);
  });

  it("A-6 preserves native press activation and imperative focus without web props", async () => {
    setPlatform("ios");
    for (const label of Object.keys(mockNodes)) delete mockNodes[label];
    const onTabChange = jest.fn();
    const ref = React.createRef<PublicVenueTabsHandle>();
    let tree: ReactTestRenderer | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <PublicVenueTabs
          ref={ref}
          activeTab="reservations"
          hasMenu
          overview={<Text>Overview child</Text>}
          menu={<Text>Menu child</Text>}
          reservations={<Text>Reservations child</Text>}
          palette={palette}
          surface={surface}
          theme={theme}
          onTabChange={onTabChange}
        />,
      );
    });
    if (tree === null) throw new Error("native_tabs_render_missing");
    const tabs = renderedTabs(tree.root);
    expect(panelNodes(tree.root)).toHaveLength(0);
    for (const tab of tabs) {
      expect(tab.props.onKeyDown).toBeUndefined();
      expect(tab.props.tabIndex).toBeUndefined();
      expect(tab.props.id).toBeUndefined();
      expect(tab.props["aria-controls"]).toBeUndefined();
    }
    await TestRenderer.act(async () => {
      tabNamed(tree.root, "Overview").props.onPress();
      ref.current?.focusTab("reservations");
    });
    expect(onTabChange).toHaveBeenCalledTimes(1);
    expect(onTabChange).toHaveBeenCalledWith("overview");
    expect(mockNodes.Reservations.focus).toHaveBeenCalledTimes(1);
  });
});
