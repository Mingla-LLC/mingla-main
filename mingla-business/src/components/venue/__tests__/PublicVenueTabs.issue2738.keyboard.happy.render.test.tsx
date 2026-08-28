/* eslint-disable @typescript-eslint/no-require-imports */
import React, { useEffect, useState } from "react";
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
  type PublicVenueTabsHandle,
  type PublicVenueTab,
} from "../../../../../packages/brand-rendering/PublicVenueTabs";

type InlineRect = { left: number; right: number };
type ScrollOwnerMock = {
  getBoundingClientRect: jest.Mock<InlineRect, []>;
  scrollLeft: number;
};
type FocusMock = {
  closest: jest.Mock<ScrollOwnerMock | null, [string]>;
  focus: jest.Mock;
  getBoundingClientRect: jest.Mock<InlineRect, []>;
  scrollIntoView: jest.Mock;
  scrollOwner: ScrollOwnerMock;
};

const mockFocusNodes: Record<string, FocusMock> = {};

jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native") as typeof import("react-native");
  const ReactRuntime = require("react") as typeof React;
  const RefInjectingPressable = ReactRuntime.forwardRef<
    FocusMock,
    React.ComponentProps<typeof actual.Pressable>
  >((props, ref) => {
    const label = props.accessibilityLabel ?? "unlabelled";
    const scrollOwner: ScrollOwnerMock = {
      getBoundingClientRect: jest.fn(() => ({ left: 0, right: 299 })),
      scrollLeft: 11,
    };
    const node =
      mockFocusNodes[label] ?? {
        closest: jest.fn((selector: string) =>
          selector === '[role="tablist"][aria-label="Venue sections"]'
            ? scrollOwner
            : null,
        ),
        focus: jest.fn(),
        getBoundingClientRect: jest.fn(() => ({ left: 40, right: 140 })),
        scrollIntoView: jest.fn(),
        scrollOwner,
      };
    mockFocusNodes[label] = node;
    ReactRuntime.useImperativeHandle(ref, () => node, [node]);
    return ReactRuntime.createElement(actual.Pressable, props);
  });
  const mocked = Object.create(actual) as typeof actual;
  Object.defineProperty(mocked, "Pressable", {
    enumerable: true,
    value: RefInjectingPressable,
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

const keyboardEvent = (
  key: string,
  modifiers: Partial<{
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }> = {},
): {
  nativeEvent: { key: string } & typeof modifiers;
  preventDefault: jest.Mock;
} & typeof modifiers => ({
  ...modifiers,
  nativeEvent: { key, ...modifiers },
  preventDefault: jest.fn(),
});

const tabs = (root: ReactTestInstance): ReactTestInstance[] => {
  const candidates = root.findAll(
    (node: ReactTestInstance) =>
      node.props.accessibilityRole === "tab" &&
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

const panels = (root: ReactTestInstance): ReactTestInstance[] =>
  root.findAll(
    (node: ReactTestInstance) =>
      typeof node.type === "string" && node.props.role === "tabpanel",
  );

const tabNamed = (
  root: ReactTestInstance,
  label: string,
): ReactTestInstance => {
  const node = tabs(root).find(
    (candidate) => candidate.props.accessibilityLabel === label,
  );
  if (node === undefined) throw new Error(`tab_missing:${label}`);
  return node;
};

const mountTabs = async ({
  activeTab,
  hasMenu = true,
  onTabChange = jest.fn(),
  onTabViewed = jest.fn(),
  overview = <Text>Overview child</Text>,
  menu = <Text>Menu child</Text>,
  reservations = <Text>Reservations child</Text>,
  tabsRef,
}: {
  activeTab?: PublicVenueTab;
  hasMenu?: boolean;
  onTabChange?: (tab: PublicVenueTab) => void;
  onTabViewed?: (tab: PublicVenueTab) => void;
  overview?: React.ReactNode;
  menu?: React.ReactNode;
  reservations?: React.ReactNode;
  tabsRef?: React.Ref<PublicVenueTabsHandle>;
} = {}): Promise<{
  focusMocks: Record<string, FocusMock>;
  tree: ReactTestRenderer;
}> => {
  for (const label of Object.keys(mockFocusNodes)) delete mockFocusNodes[label];
  let tree: ReactTestRenderer | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <PublicVenueTabs
        ref={tabsRef}
        activeTab={activeTab}
        hasMenu={hasMenu}
        overview={overview}
        menu={menu}
        reservations={reservations}
        palette={palette}
        surface={surface}
        theme={theme}
        onTabChange={onTabChange}
        onTabViewed={onTabViewed}
      />,
    );
  });
  if (tree === null) throw new Error("public_venue_tabs_render_missing");
  return { focusMocks: mockFocusNodes, tree };
};

afterEach(() => {
  setPlatform("ios");
});

describe("issue #2738 public venue tabs complete web contract", () => {
  // Roles alone do not supply keyboard navigation or tab/panel ownership. This
  // real-component guard must turn red if the key, ID, or panel contract that
  // fixes the production defect is removed.
  it("H-1 exposes one named three-tab stop and three owned panel shells", async () => {
    setPlatform("web");
    const { tree } = await mountTabs({ activeTab: "overview" });
    const renderedTabs = tabs(tree.root);
    expect(renderedTabs.map((tab) => tab.props.tabIndex)).toEqual([0, -1, -1]);
    expect(
      tree.root.findAll(
        (node: ReactTestInstance) =>
          node.props.accessibilityRole === "tablist" &&
          node.props["aria-label"] === "Venue sections",
      ),
    ).not.toHaveLength(0);

    const renderedPanels = panels(tree.root);
    expect(renderedPanels).toHaveLength(3);
    expect(new Set(renderedTabs.map((tab) => tab.props.id)).size).toBe(3);
    for (const tab of renderedTabs) {
      const panel = renderedPanels.find(
        (candidate) => candidate.props.id === tab.props["aria-controls"],
      );
      expect(panel).toBeDefined();
      expect(panel?.props["aria-labelledby"]).toBe(tab.props.id);
    }
    expect(renderedPanels.map((panel) => panel.props["aria-hidden"])).toEqual([
      false,
      true,
      true,
    ]);
    expect(renderedPanels.map((panel) => panel.props.tabIndex)).toEqual([0, -1, -1]);
    expect(tree.root.findAllByType(Text).map((node: ReactTestInstance) => node.props.children)).toContain(
      "Overview child",
    );
    expect(tree.root.findAllByType(Text).map((node: ReactTestInstance) => node.props.children)).not.toContain(
      "Menu child",
    );
  });

  it("H-2 moves real focus silently, then activates through the one press path", async () => {
    setPlatform("web");
    const onTabChange = jest.fn();
    const onTabViewed = jest.fn();

    const Harness = (): React.ReactElement => {
      const [active, setActive] = useState<PublicVenueTab>("overview");
      return (
        <PublicVenueTabs
          activeTab={active}
          hasMenu
          overview={<Text>Overview child</Text>}
          menu={<Text>Menu child</Text>}
          reservations={<Text>Reservations child</Text>}
          palette={palette}
          surface={surface}
          theme={theme}
          onTabChange={(tab: PublicVenueTab) => {
            onTabChange(tab);
            setActive(tab);
          }}
          onTabViewed={onTabViewed}
        />
      );
    };

    for (const label of Object.keys(mockFocusNodes)) delete mockFocusNodes[label];
    let tree: ReactTestRenderer | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(<Harness />);
    });
    if (tree === null) throw new Error("controlled_tabs_render_missing");
    onTabViewed.mockClear();
    const idsBeforeActivation = tabs(tree.root).map((tab) => tab.props.id);

    const right = keyboardEvent("ArrowRight");
    await TestRenderer.act(async () => {
      tabNamed(tree.root, "Overview").props.onKeyDown(right);
    });
    expect(right.preventDefault).toHaveBeenCalledTimes(1);
    expect(mockFocusNodes.Menu.focus).toHaveBeenCalledTimes(1);
    expect(mockFocusNodes.Menu.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
    });
    expect(onTabChange).not.toHaveBeenCalled();
    expect(onTabViewed).not.toHaveBeenCalled();
    expect(tabNamed(tree.root, "Overview").props["aria-selected"]).toBe(true);

    await TestRenderer.act(async () => {
      tabNamed(tree.root, "Menu").props.onPress();
    });
    expect(onTabChange).toHaveBeenCalledTimes(1);
    expect(onTabChange).toHaveBeenCalledWith("menu");
    expect(onTabViewed).toHaveBeenCalledTimes(1);
    expect(tabNamed(tree.root, "Menu").props["aria-selected"]).toBe(true);
    expect(tabs(tree.root).map((tab) => tab.props.id)).toEqual(
      idsBeforeActivation,
    );
    expect(
      panels(tree.root).filter(
        (panel) => panel.props["aria-hidden"] === false,
      ),
    ).toHaveLength(1);

    onTabChange.mockClear();
    onTabViewed.mockClear();
    const space = keyboardEvent(" ");
    await TestRenderer.act(async () => {
      tabNamed(tree.root, "Reservations").props.onKeyDown(space);
    });
    expect(space.preventDefault).toHaveBeenCalledTimes(1);
    expect(onTabChange).toHaveBeenCalledTimes(1);
    expect(onTabChange).toHaveBeenCalledWith("reservations");
    expect(onTabViewed).toHaveBeenCalledTimes(1);
  });

  it("H-3 wraps, supports Home/End, ignores unowned keys, and renders the exact focus ring", async () => {
    setPlatform("web");
    const { focusMocks, tree } = await mountTabs({ activeTab: "overview" });

    const left = keyboardEvent("ArrowLeft");
    tabNamed(tree.root, "Overview").props.onKeyDown(left);
    expect(left.preventDefault).toHaveBeenCalledTimes(1);
    expect(focusMocks.Reservations.focus).toHaveBeenCalledTimes(1);

    const home = keyboardEvent("Home");
    tabNamed(tree.root, "Reservations").props.onKeyDown(home);
    expect(home.preventDefault).toHaveBeenCalledTimes(1);
    expect(focusMocks.Overview.focus).toHaveBeenCalledTimes(1);

    const end = keyboardEvent("End");
    tabNamed(tree.root, "Overview").props.onKeyDown(end);
    expect(end.preventDefault).toHaveBeenCalledTimes(1);
    expect(focusMocks.Reservations.focus).toHaveBeenCalledTimes(2);

    for (const key of ["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"]) {
      const event = keyboardEvent(key);
      await TestRenderer.act(async () => {
        tabNamed(tree.root, "Overview").props.onKeyDown(event);
      });
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    const modified = keyboardEvent("ArrowRight", { metaKey: true });
    tabNamed(tree.root, "Overview").props.onKeyDown(modified);
    expect(modified.preventDefault).not.toHaveBeenCalled();

    await TestRenderer.act(async () => {
      tabNamed(tree.root, "Overview").props.onFocus({
        currentTarget: { matches: () => true },
      });
    });
    expect(tabNamed(tree.root, "Overview").props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outlineColor: palette.accentText,
          outlineOffset: -4,
          outlineStyle: "solid",
          outlineWidth: 3,
        }),
      ]),
    );
    await TestRenderer.act(async () => {
      tabNamed(tree.root, "Overview").props.onPointerDown();
      tabNamed(tree.root, "Overview").props.onFocus({
        currentTarget: { matches: () => true },
      });
    });
    expect(tabNamed(tree.root, "Overview").props.style).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ outlineWidth: 3 })]),
    );
    const keyboardRestore = keyboardEvent("Home");
    await TestRenderer.act(async () => {
      tabNamed(tree.root, "Overview").props.onKeyDown(keyboardRestore);
    });
    expect(tabNamed(tree.root, "Overview").props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ outlineWidth: 3 })]),
    );
    await TestRenderer.act(async () => {
      tabNamed(tree.root, "Overview").props.onFocus({
        currentTarget: { matches: () => false },
      });
    });
    expect(tabNamed(tree.root, "Overview").props.style).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ outlineWidth: 3 })]),
    );

    await TestRenderer.act(async () => {
      tabNamed(tree.root, "Reservations").props.onFocus({
        currentTarget: { matches: () => true },
      });
    });
    expect(tabNamed(tree.root, "Reservations").props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outlineColor: palette.primaryText,
          outlineOffset: -4,
          outlineStyle: "solid",
          outlineWidth: 3,
        }),
      ]),
    );
  });

  it("H-3a corrects fractional clipping toward only the nearest inline edge", async () => {
    setPlatform("web");
    const { focusMocks, tree } = await mountTabs({ activeTab: "overview" });
    focusMocks.Reservations.getBoundingClientRect.mockReturnValue({
      left: 180,
      right: 299.046875,
    });

    tabNamed(tree.root, "Overview").props.onKeyDown(keyboardEvent("End"));

    expect(focusMocks.Reservations.closest).toHaveBeenCalledWith(
      '[role="tablist"][aria-label="Venue sections"]',
    );
    expect(focusMocks.Reservations.scrollOwner.scrollLeft).toBe(13);
    expect(299.046875 - (13 - 11)).toBeLessThanOrEqual(299 - 1);

    focusMocks.Overview.getBoundingClientRect.mockReturnValue({
      left: -0.25,
      right: 100,
    });
    focusMocks.Overview.scrollOwner.scrollLeft = 11;
    tabNamed(tree.root, "Reservations").props.onKeyDown(keyboardEvent("Home"));
    expect(focusMocks.Overview.scrollOwner.scrollLeft).toBe(9);
    expect(-0.25 + (11 - 9)).toBeGreaterThanOrEqual(0 + 1);

    focusMocks.Menu.scrollOwner.scrollLeft = 7;
    tabNamed(tree.root, "Overview").props.onKeyDown(keyboardEvent("ArrowRight"));
    expect(focusMocks.Menu.scrollOwner.scrollLeft).toBe(7);
  });

  it("H-4 keeps the two-tab order free of a phantom Menu target", async () => {
    setPlatform("web");
    const { focusMocks, tree } = await mountTabs({
      activeTab: "overview",
      hasMenu: false,
    });
    expect(tabs(tree.root).map((tab) => tab.props.accessibilityLabel)).toEqual([
      "Overview",
      "Reservations",
    ]);
    expect(panels(tree.root)).toHaveLength(2);
    const right = keyboardEvent("ArrowRight");
    tabNamed(tree.root, "Overview").props.onKeyDown(right);
    expect(focusMocks.Reservations.focus).toHaveBeenCalledTimes(1);
    expect(focusMocks.Menu).toBeUndefined();
  });

  it("H-5 mounts only the selected child subtree through controlled switches", async () => {
    setPlatform("web");
    const mounted: PublicVenueTab[] = [];
    const unmounted: PublicVenueTab[] = [];
    const CountingChild = ({ tab }: { tab: PublicVenueTab }): React.ReactElement => {
      useEffect(() => {
        mounted.push(tab);
        return () => {
          unmounted.push(tab);
        };
      }, [tab]);
      return <Text>{tab}</Text>;
    };
    const onTabChange = jest.fn();
    const first = await mountTabs({
      activeTab: "overview",
      overview: <CountingChild tab="overview" />,
      menu: <CountingChild tab="menu" />,
      reservations: <CountingChild tab="reservations" />,
      onTabChange,
    });
    expect(mounted).toEqual(["overview"]);
    await TestRenderer.act(async () => {
      first.tree.update(
        <PublicVenueTabs
          activeTab="menu"
          hasMenu
          overview={<CountingChild tab="overview" />}
          menu={<CountingChild tab="menu" />}
          reservations={<CountingChild tab="reservations" />}
          palette={palette}
          surface={surface}
          theme={theme}
          onTabChange={onTabChange}
        />,
      );
    });
    expect(mounted).toEqual(["overview", "menu"]);
    expect(unmounted).toEqual(["overview"]);
  });

  it("H-6 preserves the native single pane without DOM key, ID, or panel props", async () => {
    setPlatform("ios");
    const tabsRef = React.createRef<PublicVenueTabsHandle>();
    const { tree } = await mountTabs({
      activeTab: "reservations",
      tabsRef,
    });
    const renderedTabs = tabs(tree.root);
    expect(renderedTabs).toHaveLength(3);
    for (const tab of renderedTabs) {
      expect(tab.props.onKeyDown).toBeUndefined();
      expect(tab.props.tabIndex).toBeUndefined();
      expect(tab.props.id).toBeUndefined();
      expect(tab.props["aria-controls"]).toBeUndefined();
      expect(tab.props.accessibilityState.selected).toBe(
        tab.props.accessibilityLabel === "Reservations",
      );
    }
    expect(panels(tree.root)).toHaveLength(0);
    const childText = tree.root
      .findAllByType(Text)
      .map((node: ReactTestInstance) => node.props.children);
    expect(childText).toContain("Reservations child");
    expect(childText).not.toContain("Overview child");
    expect(childText).not.toContain("Menu child");
    tabsRef.current?.focusTab("reservations");
    expect(mockFocusNodes.Reservations.focus).toHaveBeenCalledTimes(1);
    expect(mockFocusNodes.Reservations.closest).not.toHaveBeenCalled();
  });
});
