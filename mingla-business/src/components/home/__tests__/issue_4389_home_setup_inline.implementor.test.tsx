/**
 * #4389 P2 (Seth 2026-11-18) — on wide desktop the "Finish setting up" card
 * lines up with the other Home panels and Continue is a pill at the right of
 * the title row, not a full-width bar. Phone is unchanged.
 *
 * FAILS-ON-REVERT: drop the `layout` prop from HomeSetupCard (Continue goes
 * back under the bar, full width) and I1 fails; drop the desktop setupWrap in
 * home.tsx and I3 fails.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/components/home/__tests__/issue_4389_home_setup_inline.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import React from "react";
import { StyleSheet } from "react-native";

import { HomeSetupCard } from "../HomeSetupCard";
import type { BrandSetupChecklist } from "../../../services/brandSetupService";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Node { type: unknown; props: Record<string, unknown>; children: (Node | string)[]; parent: Node | null }
type Tree = { root: Node & { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void) => void;
  create: (el: React.ReactElement) => Tree;
};

const checklist = {
  doneCount: 2,
  readiness: { items: [] },
  facts: { complete: false, waitingFor: null, stripeState: "none" },
} as unknown as BrandSetupChecklist;

const hosts = (tree: Tree, testID: string): Node[] =>
  tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === testID);
const isInside = (node: Node, ancestor: Node): boolean => {
  for (let p: Node | null = node.parent; p !== null; p = p.parent) if (p === ancestor) return true;
  return false;
};
const styleOf = (node: Node): Record<string, unknown> => {
  const s = node.props.style;
  const resolved = typeof s === "function" ? (s as (st: { pressed: boolean }) => unknown)({ pressed: false }) : s;
  return StyleSheet.flatten(resolved as never) as Record<string, unknown>;
};

function render(layout?: "stacked" | "inline"): Tree {
  let tree: Tree | null = null;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      <HomeSetupCard brandName="Tinoe's Yard" checklist={checklist} onContinue={() => undefined} layout={layout} />,
    );
  });
  return tree as unknown as Tree;
}
const pressableContinue = (tree: Tree): Node =>
  tree.root.findAll((n) => n.props.testID === "home-setup-continue" && typeof n.props.onPress === "function")[0]!;

describe("#4389 P2 Home setup card", () => {
  test("I1: inline puts an intrinsic-width Continue pill in the title row", () => {
    const tree = render("inline");
    const head = hosts(tree, "home-setup-head")[0]!;
    const cont = hosts(tree, "home-setup-continue")[0]!;
    expect(isInside(cont, head)).toBe(true);
    const style = styleOf(pressableContinue(tree));
    expect(style.minHeight).toBe(36);
    expect(style.alignSelf).toBe("center");
    expect(typeof style.paddingHorizontal).toBe("number");
    // 36 + 4 + 4 keeps a 44pt hit area.
    const slop = pressableContinue(tree).props.hitSlop as { top: number; bottom: number };
    expect(36 + slop.top + slop.bottom).toBeGreaterThanOrEqual(44);
    TestRenderer.act(() => tree.unmount());
  });

  test("I2: stacked (phone, the default) keeps the full-width Continue under the bar", () => {
    const tree = render();
    const head = hosts(tree, "home-setup-head")[0]!;
    const cont = hosts(tree, "home-setup-continue")[0]!;
    expect(isInside(cont, head)).toBe(false);
    const style = styleOf(pressableContinue(tree));
    expect(style.minHeight).toBe(44);
    expect(style.alignSelf).toBeUndefined();
    TestRenderer.act(() => tree.unmount());
  });

  test("I3: Home desktop wraps the setup section in the panel gutter and passes inline on wide desktop", () => {
    const home = fs.readFileSync(path.join(__dirname, "../../../../app/(tabs)/home.tsx"), "utf8");
    expect(home).toContain('layout={isWideDesktop ? "inline" : "stacked"}');
    expect(home).toMatch(
      /<View style=\{styles\.setupWrap\} testID="home-desktop-setup-wrap">\s*\{setupSection\}\s*<\/View>\s*<BusinessPulsePanel/,
    );
    // The gutter equals the pulse panel's own root padding.
    const pulse = fs.readFileSync(path.join(__dirname, "../BusinessPulsePanel.tsx"), "utf8");
    expect(pulse).toMatch(/root: \{ paddingHorizontal: space\[4\]/);
    expect(home).toMatch(/setupWrap: \{\s*paddingHorizontal: space\[4\],/);
  });
});
