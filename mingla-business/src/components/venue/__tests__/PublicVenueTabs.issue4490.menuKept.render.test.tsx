/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4490 W3 fix 6 (W3-N41) — the order basket survives a tab switch.
 *
 * The device pass: add two items on the Explorer venue page's Menu tab, open
 * Private hire (or What's on), come back: the basket, the note and the name
 * were gone and the docked order bar with them. The basket lives in the
 * ordering surface inside the Menu pane, and the shared tab component mounted
 * only the active pane (native and web alike, so buyer web lost it too).
 *
 * Now the Menu pane, once opened, stays mounted (hidden) while another tab
 * shows; it goes when the page goes or the venue loses its menu. Other panes
 * keep today's rule (only the active one is mounted).
 *
 *   K-1 native: a Menu child's state survives Menu → feature tab → Menu
 *   K-2 web: the same, and the hidden Menu panel is display:none + aria-hidden
 *   K-3 Menu is not mounted before the guest opens it (lazy as before)
 *   K-4 other panes still unmount when left (unchanged rule)
 *   K-5 the menu goes when the venue no longer has one, and with the page
 *   K-6 hidden Menu is hidden from screen readers on native
 *
 * FAILS-ON-REVERT: take the kept slot out of PublicVenueTabs and K-1, K-2, K-6 fail.
 */
import React, { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
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
} from "../../../../../packages/brand-rendering/PublicVenueTabs";

// @ts-expect-error react-test-renderer ships without declarations in this workspace.
const TestRenderer = require("react-test-renderer") as typeof import("react-test-renderer");

const theme = resolveTheme(null, null);
const palette = createThemePalette(theme);
const surface = offeringSurfaceStyles(palette);

const setPlatform = (os: "ios" | "web"): void => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: os });
};

const mounts: Record<string, number> = {};
const unmounts: Record<string, number> = {};

/** Stands in for the ordering surface: a basket the guest builds by tapping. */
const Basket: React.FC<{ name: string }> = ({ name }) => {
  const [items, setItems] = useState(0);
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    return () => {
      unmounts[name] = (unmounts[name] ?? 0) + 1;
    };
  }, [name]);
  return (
    <View>
      <Text testID={`${name}-count`}>{`${name}:${items}`}</Text>
      <Pressable testID={`${name}-add`} onPress={() => setItems((n: number) => n + 1)}>
        <Text>Add</Text>
      </Pressable>
    </View>
  );
};

const TABS: PublicVenueTab[] = ["overview", "menu", "hire", "whats_on"];

const element = (activeTab: PublicVenueTab, hasMenu = true): React.ReactElement => (
  <PublicVenueTabs
    activeTab={activeTab}
    hasMenu={hasMenu}
    tabs={hasMenu ? TABS : TABS.filter((tab) => tab !== "menu")}
    panes={{ hire: <Basket name="hire" />, whats_on: <Text>What is on</Text> }}
    overview={<Basket name="overview" />}
    menu={hasMenu ? <Basket name="menu" /> : null}
    reservations={null}
    palette={palette}
    surface={surface}
    theme={theme}
  />
);

const mount = async (activeTab: PublicVenueTab): Promise<ReactTestRenderer> => {
  let tree: ReactTestRenderer | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(element(activeTab));
  });
  if (tree === null) throw new Error("tabs_missing");
  return tree;
};

const go = async (tree: ReactTestRenderer, tab: PublicVenueTab, hasMenu = true): Promise<void> => {
  await TestRenderer.act(async () => {
    tree.update(element(tab, hasMenu));
  });
};

const add = async (tree: ReactTestRenderer, name: string, times: number): Promise<void> => {
  for (let i = 0; i < times; i += 1) {
    await TestRenderer.act(async () => {
      tree.root.findByProps({ testID: `${name}-add` }).props.onPress();
    });
  }
};

const countText = (tree: ReactTestRenderer, name: string): string | null => {
  const nodes = tree.root.findAll(
    (node: ReactTestInstance) => node.props.testID === `${name}-count` && typeof node.type !== "string",
  );
  if (nodes.length === 0) return null;
  return String(nodes[0].props.children);
};

const flatStyle = (style: unknown): Record<string, unknown> => {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatStyle));
  return (style as Record<string, unknown> | null) ?? {};
};

beforeEach(() => {
  for (const key of Object.keys(mounts)) delete mounts[key];
  for (const key of Object.keys(unmounts)) delete unmounts[key];
});
afterEach(() => {
  setPlatform("ios");
});

describe("#4490 W3-N41 the Menu pane (and its basket) survives a tab switch", () => {
  it("K-1 native: Menu → Private hire → What's on → Menu keeps the basket", async () => {
    setPlatform("ios");
    const tree = await mount("menu");
    await add(tree, "menu", 2);
    expect(countText(tree, "menu")).toBe("menu:2");
    await go(tree, "hire");
    await go(tree, "whats_on");
    await go(tree, "menu");
    expect(countText(tree, "menu")).toBe("menu:2");
    expect(mounts.menu).toBe(1);
    expect(unmounts.menu ?? 0).toBe(0);
  });

  it("K-2 web: the same, and the hidden Menu panel is display:none and aria-hidden", async () => {
    setPlatform("web");
    const tree = await mount("menu");
    await add(tree, "menu", 3);
    await go(tree, "hire");
    const menuPanel = tree.root.findAll(
      (node: ReactTestInstance) =>
        typeof node.type !== "string" && node.props.role === "tabpanel" && String(node.props.id).endsWith("-public-venue-menu-panel"),
    )[0];
    expect(menuPanel.props["aria-hidden"]).toBe(true);
    expect(flatStyle(menuPanel.props.style).display).toBe("none");
    await go(tree, "menu");
    expect(countText(tree, "menu")).toBe("menu:3");
    expect(mounts.menu).toBe(1);
  });

  it("K-3 Menu is not mounted before the guest opens it", async () => {
    for (const os of ["ios", "web"] as const) {
      setPlatform(os);
      const tree = await mount("overview");
      await go(tree, "hire");
      expect(mounts.menu ?? 0).toBe(0);
      await TestRenderer.act(async () => tree.unmount());
    }
  });

  it("K-4 other panes keep today's rule: they unmount when left", async () => {
    setPlatform("ios");
    const tree = await mount("hire");
    await add(tree, "hire", 1);
    await go(tree, "menu");
    await go(tree, "hire");
    expect(countText(tree, "hire")).toBe("hire:0");
    expect(mounts.hire).toBe(2);
  });

  it("K-5 the basket goes when the venue loses its menu, and with the page", async () => {
    setPlatform("ios");
    const tree = await mount("menu");
    await add(tree, "menu", 1);
    await go(tree, "hire");
    await go(tree, "hire", false);
    expect(unmounts.menu).toBe(1);
    const again = await mount("menu");
    await TestRenderer.act(async () => again.unmount());
    expect(unmounts.menu).toBe(2);
  });

  it("K-6 native: the hidden Menu is hidden from screen readers and not laid out", async () => {
    setPlatform("ios");
    const tree = await mount("menu");
    await go(tree, "whats_on");
    const slot = tree.root.findAll(
      (node: ReactTestInstance) => typeof node.type !== "string" && node.props.testID === "issue-4490-menu-pane",
    )[0];
    expect(slot.props.accessibilityElementsHidden).toBe(true);
    expect(slot.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(flatStyle(slot.props.style).display).toBe("none");
    await go(tree, "menu");
    const shown = tree.root.findAll(
      (node: ReactTestInstance) => typeof node.type !== "string" && node.props.testID === "issue-4490-menu-pane",
    )[0];
    expect(shown.props.accessibilityElementsHidden).toBe(false);
    expect(flatStyle(shown.props.style).display).toBeUndefined();
  });
});
