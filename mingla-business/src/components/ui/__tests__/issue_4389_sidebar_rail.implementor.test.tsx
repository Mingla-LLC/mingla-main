// MINGLA-INVARIANT: I-4389-RAIL-LABELS | issue #4389 | every collapsed-rail item (pages, Expand, Account) shows its page name in a label bubble (sidebar-rail-tip-<key>) on hover and on keyboard focus, hidden on leave, blur and press; the bubble is hidden from assistive tech.
/**
 * #4389 P3–P5 (Seth 2026-11-18, amendments 6974005872 / 6974217802).
 *
 *   P3  the collapsed rail shows EVERY page (Home, Hub, Ari | Overview,
 *       Campaigns, Ads, Creators, Referrals | People, Templates), a thin
 *       divider in place of each group name, Expand + Account at the bottom;
 *       every rail item shows its name on hover and keyboard focus.
 *   P4  no two identical person glyphs: People is `notebook`, Account `user`,
 *       Creators `users`.
 *
 * FAILS-ON-REVERT: restore the "first item per group" rail (only Home, Hub,
 * Ari, Overview, People) or drop the RailItem tooltip and R1/R2 fail; set
 * MARKETING_ICONS.people back to "user" and R3 fails.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/components/ui/__tests__/issue_4389_sidebar_rail.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/marketing/ads",
}));
jest.mock("@mingla/brand-assets", () => ({ MINGLA_BUSINESS_LOGO: 1 }));
jest.mock("../Icon", () => {
  const { View } = require("react-native");
  return { Icon: ({ name }: { name: string }) => <View testID={`icon-${name}`} /> };
});

import { DesktopSidebar, SIDEBAR_SOURCE_TABS, buildSidebarGroups } from "../DesktopSidebar";
import { useDesktopSidebarStore } from "../desktopSidebarState";

interface Node { type: unknown; props: Record<string, unknown>; children: (Node | string)[]; parent: Node | null }
type Tree = { root: Node & { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void) => void;
  create: (el: React.ReactElement) => Tree;
};
const textOf = (n: Node | string): string => (typeof n === "string" ? n : n.children.map(textOf).join(""));
const hosts = (tree: Tree, testID: string): Node[] =>
  tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === testID);
/** The Pressable for a rail item (the element carrying the handlers). */
const item = (tree: Tree, key: string): Node => {
  const found = tree.root.findAll(
    (n) => n.props.testID === `sidebar-rail-item-${key}` && typeof n.props.onHoverIn === "function",
  );
  expect(found.length).toBeGreaterThan(0);
  return found[0]!;
};
const fire = (node: Node, prop: string): void => {
  TestRenderer.act(() => {
    (node.props[prop] as () => void)();
  });
};

const ALL_PAGES = ["home", "hub", "ari", "overview", "campaigns", "ads", "creators", "referrals", "people", "templates"];

function renderRail(): Tree {
  let tree: Tree | null = null;
  TestRenderer.act(() => {
    tree = TestRenderer.create(<DesktopSidebar tabs={SIDEBAR_SOURCE_TABS} />);
  });
  return tree as unknown as Tree;
}

describe("#4389 P3–P5 collapsed rail", () => {
  beforeEach(() => {
    mockPush.mockClear();
    useDesktopSidebarStore.setState({ collapsed: true, closedGroups: [] });
  });

  test("R1: the rail shows every page in order, a divider per titled group, Expand and Account at the bottom", () => {
    const tree = renderRail();
    const keys = tree.root
      .findAll((n) => typeof n.type === "string" && typeof n.props.testID === "string" && (n.props.testID as string).startsWith("sidebar-rail-item-"))
      .map((n) => (n.props.testID as string).replace("sidebar-rail-item-", ""));
    expect([...new Set(keys)]).toEqual([...ALL_PAGES, "expand", "account"]);
    expect(hosts(tree, "sidebar-rail-divider-promote")).toHaveLength(1);
    expect(hosts(tree, "sidebar-rail-divider-audience")).toHaveLength(1);
    // Group names never show on the rail.
    const texts = tree.root.findAll((n) => typeof n.type === "string").map(textOf);
    expect(texts.some((t) => t === "Promote" || t === "Audience")).toBe(false);
    // The active page is the only selected tab.
    expect(item(tree, "ads").props.accessibilityState).toEqual({ selected: true });
    expect(item(tree, "overview").props.accessibilityState).toEqual({ selected: false });
    TestRenderer.act(() => tree.unmount());
  });

  test("R2: hover and keyboard focus show the page name; leave, blur and press hide it; it is hidden from assistive tech", () => {
    const tree = renderRail();
    for (const key of [...ALL_PAGES, "expand", "account"]) {
      expect(hosts(tree, `sidebar-rail-tip-${key}`)).toHaveLength(0);
      fire(item(tree, key), "onHoverIn");
      const tip = hosts(tree, `sidebar-rail-tip-${key}`);
      expect(tip).toHaveLength(1);
      expect(textOf(tip[0]!)).toBe(item(tree, key).props.accessibilityLabel);
      expect(tip[0]!.props.pointerEvents).toBe("none");
      expect(tip[0]!.props.accessibilityElementsHidden).toBe(true);
      expect(tip[0]!.props.importantForAccessibility).toBe("no-hide-descendants");
      fire(item(tree, key), "onHoverOut");
      expect(hosts(tree, `sidebar-rail-tip-${key}`)).toHaveLength(0);
      fire(item(tree, key), "onFocus");
      expect(hosts(tree, `sidebar-rail-tip-${key}`)).toHaveLength(1);
      fire(item(tree, key), "onBlur");
      expect(hosts(tree, `sidebar-rail-tip-${key}`)).toHaveLength(0);
    }
    const labels = [...ALL_PAGES, "expand", "account"].map((k) => item(tree, k).props.accessibilityLabel);
    expect(labels).toEqual([
      "Home", "Hub", "Ari", "Overview", "Campaigns", "Ads", "Creators", "Referrals", "People", "Templates",
      "Expand sidebar", "Account",
    ]);
    // Press hides the bubble and navigates.
    fire(item(tree, "people"), "onHoverIn");
    fire(item(tree, "people"), "onPress");
    expect(hosts(tree, "sidebar-rail-tip-people")).toHaveLength(0);
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/marketing/people");
    TestRenderer.act(() => tree.unmount());
  });

  test("R3 (P4/P5): People is `notebook`, Account `user`, Creators `users`; no two rail glyphs repeat", () => {
    const { groups, account } = buildSidebarGroups(SIDEBAR_SOURCE_TABS);
    const all = groups.flatMap((g) => g.items);
    const icon = (key: string): string | undefined => all.find((i) => i.key === key)?.icon;
    expect(icon("people")).toBe("notebook");
    expect(icon("creators")).toBe("users");
    expect(account?.icon).toBe("user");
    expect(icon("people")).not.toBe(account?.icon);
    const railIcons = [...all.map((i) => i.icon), account?.icon];
    expect(new Set(railIcons).size).toBe(railIcons.length);

    const tree = renderRail();
    expect(hosts(tree, "icon-notebook")).toHaveLength(1);
    expect(hosts(tree, "icon-user")).toHaveLength(1);
    TestRenderer.act(() => tree.unmount());
  });

  test("the expanded sidebar keeps its group titles and the People notebook", () => {
    useDesktopSidebarStore.setState({ collapsed: false, closedGroups: [] });
    const tree = renderRail();
    expect(hosts(tree, "sidebar-group-promote")).toHaveLength(1);
    expect(hosts(tree, "sidebar-group-audience")).toHaveLength(1);
    expect(hosts(tree, "sidebar-rail-item-home")).toHaveLength(0);
    expect(hosts(tree, "sidebar-item-people")).toHaveLength(1);
    expect(hosts(tree, "icon-notebook")).toHaveLength(1);
    expect(hosts(tree, "icon-user")).toHaveLength(1);
    TestRenderer.act(() => tree.unmount());
  });
});
