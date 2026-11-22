// MINGLA-INVARIANT: I-4420-EXPANDED-SIDEBAR-NO-SCROLL | issue #4420 | the EXPANDED Host side menu renders no scroll container and, once it knows its height, every row (pages and Account) fits inside it; folding a group gives its room to the rows left (rendered, not source text).
/**
 * #4420 tester adversarial (web + DB leg). The implementor's fit suite tests
 * the sizing maths; #4389 R4 asserts the collapsed rail has no scroll host.
 * Nothing rendered the EXPANDED menu, so a ScrollView could come back there
 * unnoticed. This renders it, feeds it the panel heights a laptop gives
 * (432 / 532 / 692 / 872 after the brand row), and checks the tree.
 *
 * FAILS-ON-REVERT: wrap the groups in a ScrollView, or replace the measured
 * row height with a fixed 48, and this suite fails.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/components/ui/__tests__/issue_4420_sidebar_expanded_no_scroll.tester.adversarial.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { StyleSheet } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/marketing/ads",
}));
jest.mock("@mingla/brand-assets", () => ({ MINGLA_BUSINESS_LOGO: 1 }));
jest.mock("../Icon", () => {
  const { View } = require("react-native");
  return { Icon: ({ name }: { name: string }) => <View testID={`icon-${name}`} /> };
});

import { DesktopSidebar, SIDEBAR_SOURCE_TABS } from "../DesktopSidebar";
import { useDesktopSidebarStore } from "../desktopSidebarState";

interface Node { type: unknown; props: Record<string, unknown>; children: (Node | string)[]; parent: Node | null }
type Tree = { root: Node & { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void) => void;
  create: (el: React.ReactElement) => Tree;
};

const PAGES = ["home", "hub", "ari", "overview", "campaigns", "ads", "creators", "referrals", "forms", "people", "templates"];
const heightOf = (n: Node): number => {
  const raw = typeof n.props.style === "function"
    ? (n.props.style as (s: { pressed: boolean; hovered: boolean; focused: boolean }) => unknown)({ pressed: false, hovered: false, focused: false })
    : n.props.style;
  const h = (StyleSheet.flatten(raw as never) as { height?: unknown } | undefined)?.height;
  return typeof h === "number" ? h : 0;
};
const hostRows = (tree: Tree): Node[] =>
  tree.root.findAll((n) => typeof n.type === "string" && typeof n.props.testID === "string"
    && /^sidebar-item-/.test(n.props.testID as string) && heightOf(n) > 0);

function renderAt(panelHeight: number): Tree {
  let tree: Tree | null = null;
  TestRenderer.act(() => {
    tree = TestRenderer.create(<DesktopSidebar tabs={SIDEBAR_SOURCE_TABS} testID="qa-sidebar" />);
  });
  const t = tree as unknown as Tree;
  const frame = t.root.findAll((n) => n.props.testID === "qa-sidebar" && typeof n.props.onLayout === "function")[0]!;
  TestRenderer.act(() => {
    (frame.props.onLayout as (e: unknown) => void)({ nativeEvent: { layout: { x: 0, y: 0, width: 240, height: panelHeight } } });
  });
  return t;
}

describe("#4420 expanded side menu never scrolls (rendered)", () => {
  beforeEach(() => {
    useDesktopSidebarStore.setState({ collapsed: false, closedGroups: [] });
  });

  test.each([432, 532, 692, 872])("panel %i: no scroll host, every page and Account rendered, rows fit", (h) => {
    const tree = renderAt(h);
    const scrollers = tree.root.findAll((n) => typeof n.type === "string" && /Scroll|FlatList|RecyclerView/.test(n.type as string));
    expect(scrollers).toHaveLength(0);
    const rows = hostRows(tree);
    const keys = [...new Set(rows.map((n) => (n.props.testID as string).replace("sidebar-item-", "")))];
    for (const page of PAGES) expect(keys).toContain(page);
    expect(keys.some((k) => /account/.test(k))).toBe(true);
    const heads = tree.root.findAll((n) => typeof n.type === "string" && typeof n.props.testID === "string"
      && /^sidebar-group-[a-z]+$/.test(n.props.testID as string) && heightOf(n) > 0);
    const used = [...new Set(rows)].reduce((s, n) => s + heightOf(n), 0) + heads.reduce((s, n) => s + heightOf(n), 0);
    // The brand row (50) sits above the rows inside the same panel.
    expect(used + 50).toBeLessThanOrEqual(h);
    TestRenderer.act(() => tree.unmount());
  });

  test("folding a group gives its room to the rows left", () => {
    const open = renderAt(432);
    const before = heightOf(hostRows(open).find((n) => n.props.testID === "sidebar-item-home")!);
    TestRenderer.act(() => open.unmount());
    useDesktopSidebarStore.setState({ collapsed: false, closedGroups: ["promote"] });
    const folded = renderAt(432);
    const after = heightOf(hostRows(folded).find((n) => n.props.testID === "sidebar-item-home")!);
    expect(hostRows(folded).some((n) => n.props.testID === "sidebar-item-ads")).toBe(false);
    expect(after).toBeGreaterThanOrEqual(before);
    TestRenderer.act(() => folded.unmount());
  });
});
