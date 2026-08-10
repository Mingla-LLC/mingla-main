/**
 * Issue #1735 rework P3-5 — deep-link landing reveals the active pill.
 *
 * `?module=insights` used to land with the workspace active but the pill row
 * scrolled to x=0 (Insights off-frame — tester `23-deeplink.png`). The row
 * now scrolls the ACTIVE pill into view on its first layout (instant) and on
 * later activeModule changes (animated).
 *
 * Fails-on-revert: deleting the `revealActive` call from `handlePillLayout`
 * (or the scrollTo itself) turns the reveal assertions RED.
 */

import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

import {
  VenueModulePillRow,
  pillRevealOffset,
} from "../VenueModulePillRow";
import { spacing } from "../../../constants/designSystem";

interface RenderNode {
  type?: unknown;
  props: Record<string, unknown> & { testID?: string };
}
interface RenderTree {
  root: { findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[] };
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (
    element: React.ReactElement,
    options?: { createNodeMock: (element: { type: unknown }) => unknown },
  ) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const byTestId = (tree: RenderTree, testID: string): RenderNode[] =>
  tree.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === testID,
  );

const layoutEvent = (x: number) => ({ nativeEvent: { layout: { x } } });

describe("issue #1735 rework — pill row reveals the active pill (P3-5)", () => {
  it("pillRevealOffset leads with one gutter and clamps at zero", () => {
    expect(pillRevealOffset(500)).toBe(500 - spacing.lg);
    expect(pillRevealOffset(10)).toBe(0);
    expect(pillRevealOffset(0)).toBe(0);
  });

  it("scrolls to the active pill on its first layout (deep-link landing), instantly", async () => {
    const scrollTo = jest.fn();
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <VenueModulePillRow
          modules={[
            "overview",
            "tables",
            "availability",
            "reservations",
            "waitlist",
            "menu",
            "insights",
            "settings",
          ]}
          activeModule="insights"
          onSelect={jest.fn()}
        />,
        {
          createNodeMock: (element) =>
            element.type === "ScrollView" ? { scrollTo } : null,
        },
      );
    });
    const insightsPill = byTestId(tree!, "venue-module-pill-insights")[0]!;
    await TestRenderer.act(async () => {
      (insightsPill.props.onLayout as (e: unknown) => void)(layoutEvent(500));
    });
    expect(scrollTo).toHaveBeenCalledWith({
      x: pillRevealOffset(500),
      animated: false,
    });
    tree!.unmount();
  });

  it("an INACTIVE pill's layout does not scroll the row", async () => {
    const scrollTo = jest.fn();
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <VenueModulePillRow
          modules={["overview", "menu", "insights", "settings"]}
          activeModule="overview"
          onSelect={jest.fn()}
        />,
        {
          createNodeMock: (element) =>
            element.type === "ScrollView" ? { scrollTo } : null,
        },
      );
    });
    const menuPill = byTestId(tree!, "venue-module-pill-menu")[0]!;
    await TestRenderer.act(async () => {
      (menuPill.props.onLayout as (e: unknown) => void)(layoutEvent(300));
    });
    // overview (the active pill) has no recorded layout yet and menu is not
    // active — nothing scrolls.
    expect(scrollTo).not.toHaveBeenCalled();
    tree!.unmount();
  });
});
