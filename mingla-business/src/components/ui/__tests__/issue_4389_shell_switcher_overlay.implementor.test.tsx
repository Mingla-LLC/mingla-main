// MINGLA-INVARIANT: I-DESKTOP-SWITCHER-ABOVE-CHROME | issue #4389 | on HostDesktopShell routes the brand switcher mounts in an overlay layer after the stack (never inside host-shell-topbar), with zIndex above the sidebar's 50 and its left edge right of the sidebar, so the panel always paints above the page and the sidebar stays usable.
/**
 * #4389 P6 / P9 (cause A) — on shell routes (/brand/<id>/setup, /event/<id>,
 * rail wizards...) the switcher used to mount INSIDE the top-bar strip: its
 * absoluteFill covered only that strip and the later stack sibling painted
 * over the panel, so a tap looked dead and clicks landed on the page.
 *
 * FAILS-ON-REVERT: move the sheet back into ShellTopBar and S1 fails (it is a
 * descendant of host-shell-topbar, with no overlay layer).
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/components/ui/__tests__/issue_4389_shell_switcher_overlay.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform = { OS: "web", select: (o: Record<string, unknown>) => o.web ?? o.default };
jest.mock("react-native", () => {
  const base = jest.requireActual("react-native") as Record<string, unknown>;
  return { ...base, Platform: mockPlatform };
});
jest.mock("expo-router", () => ({
  usePathname: () => "/brand/b1/setup",
  useSegments: () => ["brand", "[id]", "setup"],
  useGlobalSearchParams: () => ({}),
}));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: true }) }));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({ useCurrentBrandRole: () => ({ rank: 60 }) }));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (sel: (s: { currentBrandId: string }) => unknown) => sel({ currentBrandId: "b1" }),
}));
jest.mock("../hostDesktopShellRoutes", () => ({ hostDesktopShellModeFor: () => "sidebar" }));
jest.mock("../DesktopSidebar", () => {
  const { View } = require("react-native");
  return { SIDEBAR_SOURCE_TABS: [], DesktopSidebar: () => <View testID="mock-sidebar" /> };
});
jest.mock("../TopBar", () => {
  const { Pressable } = require("react-native");
  return {
    TopBar: ({ onBrandTap }: { onBrandTap: () => void }) => (
      <Pressable testID="mock-brand-chip" onPress={onBrandTap} accessibilityLabel="brand" />
    ),
  };
});
jest.mock("../../brand/BrandSwitcherSheet", () => {
  const { Pressable } = require("react-native");
  return {
    BrandSwitcherSheet: ({ onClose }: { onClose: () => void }) => (
      <Pressable testID="mock-switcher" onPress={onClose} accessibilityLabel="close" />
    ),
  };
});

import { StyleSheet } from "react-native";
import { HostDesktopShell, SHELL_SWITCHER_OVERLAY_Z } from "../HostDesktopShell";
import { DESKTOP_BEZEL_MARGIN, DESKTOP_SIDEBAR_WIDTH } from "../../../constants/desktopLayout";

interface Node { type: unknown; props: Record<string, unknown>; children: (Node | string)[]; parent: Node | null }
type Tree = { root: Node & { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void | Promise<void>) => Promise<void>;
  create: (el: React.ReactElement) => Tree;
};
const hosts = (tree: Tree, testID: string): Node[] =>
  tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === testID);
const pressable = (tree: Tree, testID: string): Node =>
  tree.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function")[0]!;
const isInside = (node: Node, ancestor: Node): boolean => {
  for (let p: Node | null = node.parent; p !== null; p = p.parent) if (p === ancestor) return true;
  return false;
};
/** The sidebar's own zIndex, read from the real DesktopSidebar source. */
const SIDEBAR_Z = (() => {
  const src = (require("fs") as typeof import("fs")).readFileSync(
    (require("path") as typeof import("path")).join(__dirname, "../DesktopSidebar.tsx"),
    "utf8",
  );
  const block = src.slice(src.indexOf("  sidebar: {"), src.indexOf("  expanded:"));
  return Number(/zIndex:\s*(\d+)/.exec(block)?.[1]);
})();

describe("#4389 P6 — shell brand switcher overlay", () => {
  test("S1: the switcher mounts in an overlay after the stack, outside the top bar, above the sidebar", async () => {
    let tree: Tree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <HostDesktopShell>
          <></>
        </HostDesktopShell>,
      );
    });
    const t = tree as unknown as Tree;
    expect(hosts(t, "host-shell-switcher-overlay")).toHaveLength(0);
    await TestRenderer.act(async () => {
      (pressable(t, "mock-brand-chip").props.onPress as () => void)();
    });
    // Let React.lazy resolve.
    await TestRenderer.act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const overlay = hosts(t, "host-shell-switcher-overlay");
    expect(overlay).toHaveLength(1);
    const sheet = hosts(t, "mock-switcher");
    expect(sheet).toHaveLength(1);
    expect(isInside(sheet[0]!, overlay[0]!)).toBe(true);
    expect(isInside(sheet[0]!, hosts(t, "host-shell-topbar")[0]!)).toBe(false);

    const style = StyleSheet.flatten(overlay[0]!.props.style as never) as Record<string, unknown>;
    expect(SIDEBAR_Z).toBe(50);
    expect(SHELL_SWITCHER_OVERLAY_Z).toBeGreaterThan(SIDEBAR_Z);
    expect(style.zIndex).toBe(SHELL_SWITCHER_OVERLAY_Z);
    expect(style.position).toBe("absolute");
    expect(style.top).toBe(0);
    expect(style.bottom).toBe(0);
    expect(style.right).toBe(0);
    // Starts right of the 248 sidebar (+ bezel), so the sidebar stays usable.
    expect(style.left).toBe(DESKTOP_SIDEBAR_WIDTH + DESKTOP_BEZEL_MARGIN);

    // The overlay paints after (above) the page stack: it is the host's last child.
    const host = overlay[0]!.parent!;
    const kids = host.children.filter((c): c is Node => typeof c !== "string");
    expect(kids[kids.length - 1]).toBe(overlay[0]);

    // Closing unmounts it.
    await TestRenderer.act(async () => {
      (pressable(t, "mock-switcher").props.onPress as () => void)();
    });
    expect(hosts(t, "host-shell-switcher-overlay")).toHaveLength(0);
    await TestRenderer.act(async () => t.unmount());
  });

  // #4389 P9 cause C — the first open lazy-loads the sheet behind
  // Suspense fallback={null}; the shell warms that chunk once on idle.
  test("S2: the active shell prefetches the switcher chunk once, on idle", async () => {
    const calls: (() => void)[] = [];
    const g = globalThis as { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void };
    g.requestIdleCallback = (cb) => {
      calls.push(cb);
      return calls.length;
    };
    g.cancelIdleCallback = () => undefined;
    let tree: Tree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <HostDesktopShell>
          <></>
        </HostDesktopShell>,
      );
    });
    expect(calls).toHaveLength(1);
    await TestRenderer.act(async () => {
      calls[0]!();
      await new Promise((r) => setTimeout(r, 0));
    });
    await TestRenderer.act(async () => (tree as unknown as Tree).unmount());
    // A second shell mount does not prefetch again.
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <HostDesktopShell>
          <></>
        </HostDesktopShell>,
      );
    });
    expect(calls).toHaveLength(1);
    await TestRenderer.act(async () => (tree as unknown as Tree).unmount());
    delete g.requestIdleCallback;
    delete g.cancelIdleCallback;
  });
});
