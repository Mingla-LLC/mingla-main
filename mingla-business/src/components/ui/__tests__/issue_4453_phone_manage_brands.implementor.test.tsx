/**
 * #4453 — on a phone-width screen the brand strip's menu had no "Manage
 * brands", so there was no way from it to the full brands sheet (continue
 * setup, discard a draft). The root shell now hands every switcher a way to
 * open that sheet, and draws it over the whole screen.
 *
 * WHAT RUNS: the real HostDesktopShell (phone width, /brand/<id>/edit), its
 * real phone strip, the real WorkspaceBrandSwitcher and the real
 * WorkspaceBrandMenu. The full brands sheet is a stand-in.
 *
 * FAILS-ON-REVERT: drop `manageBrands` from the shell's workspace route (or
 * draw the overlay on desktop only again) and "Manage brands" is missing from
 * the phone menu, or pressing it shows nothing.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/components/ui/__tests__/issue_4453_phone_manage_brands.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BRAND = { id: "b1", displayName: "Gameland Lagos", slug: "gameland-lagos", role: "owner" };
const OTHER = { id: "b2", displayName: "Lantern Room", slug: "lantern-room", role: "owner" };
let mockPathname = "/brand/b1/edit";
let mockUser: { id: string } | null = { id: "u1" };

const mockPlatform = { OS: "web", select: (o: Record<string, unknown>) => o.web ?? o.default };
jest.mock("react-native", () => {
  const base = jest.requireActual("react-native") as Record<string, unknown>;
  return new Proxy(base, { get: (target, key) => (key === "Platform" ? mockPlatform : target[key as string]) });
});
jest.mock("expo-router", () => ({
  usePathname: () => mockPathname,
  useSegments: () => mockPathname.split("/").filter(Boolean),
  useGlobalSearchParams: () => ({ id: "b1" }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: false }) }));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({ useCurrentBrandRole: () => ({ rank: 60 }) }));
jest.mock("../../../hooks/useItemRouteBrand", () => ({ useItemRouteBrand: () => ({ brandId: null, pending: false }) }));
jest.mock("../../../hooks/useWorkspaceBrandRouteSync", () => ({ useWorkspaceBrandRouteSync: () => undefined }));
jest.mock("../../../hooks/useWorkspaceBrand", () => ({
  useRouteBrand: () => undefined,
  useWorkspaceBrand: () => ({ brand: BRAND, pending: false, scoped: true }),
}));
jest.mock("../../../hooks/useCurrentBrand", () => ({ useCurrentBrand: () => BRAND }));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (sel: (s: { currentBrandId: string; hasHydrated: boolean }) => unknown) =>
    sel({ currentBrandId: "b1", hasHydrated: true }),
}));
jest.mock("../../../hooks/useBrandListShim", () => ({
  useBrandListState: () => ({ brands: [BRAND, OTHER], status: "ready", isLoading: false, refetch: async () => undefined }),
}));
jest.mock("../../../hooks/useBrandSetupStates", () => ({
  useBrandSetupStates: () => ({ byId: {}, draftId: null, isLoading: false }),
}));
jest.mock("../../../hooks/useWorkspaceBrandSwitch", () => ({
  useWorkspaceBrandSwitch: () => async () => "same-screen",
}));
jest.mock("../DesktopSidebar", () => ({ SIDEBAR_SOURCE_TABS: [], DesktopSidebar: () => null }));
jest.mock("../TopBar", () => ({ TopBar: () => null }));
jest.mock("../Icon", () => ({ Icon: () => null }));
jest.mock("../Material", () => ({ Material: ({ children }: { children?: React.ReactNode }) => children }));
jest.mock("../TopSheet", () => {
  const { View } = require("react-native");
  return {
    TopSheet: (props: { visible: boolean; children?: React.ReactNode; testID?: string }) =>
      props.visible ? <View testID={props.testID}>{props.children}</View> : null,
  };
});
jest.mock("../../brand/BrandMark", () => ({ BrandMark: () => null }));
// The menu under test is the real one (it ships in the brand sheet's chunk);
// the full brands sheet is a stand-in that records what it was given.
jest.mock("../../brand/BrandSwitcherSheet", () => {
  const { Pressable } = require("react-native");
  return {
    WorkspaceBrandMenu: (jest.requireActual("../../brand/WorkspaceBrandMenu") as { WorkspaceBrandMenu: unknown }).WorkspaceBrandMenu,
    BrandSwitcherSheet: ({ visible, onClose }: { visible: boolean; onClose: () => void }) =>
      visible ? <Pressable testID="full-brands-sheet" onPress={onClose} accessibilityLabel="Close the brands sheet" /> : null,
  };
});

import { StyleSheet } from "react-native";
import { HostDesktopShell } from "../HostDesktopShell";

interface Node { type: unknown; props: Record<string, unknown>; children: (Node | string)[]; parent: Node | null }
type Tree = {
  root: Node & { findAll: (p: (n: Node) => boolean) => Node[] };
  update: (el: React.ReactElement) => void;
  unmount: () => void;
};
const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void | Promise<void>) => Promise<void>;
  create: (el: React.ReactElement) => Tree;
};
const hosts = (tree: Tree, testID: string): Node[] =>
  tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === testID);
const press = async (tree: Tree, testID: string): Promise<void> =>
  TestRenderer.act(async () => {
    const found = tree.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function");
    expect(found.length).toBeGreaterThan(0);
    (found[0]!.props.onPress as () => void)();
  });
const flushUntil = async (done: () => boolean): Promise<void> => {
  for (let i = 0; i < 50 && !done(); i += 1) {
    await TestRenderer.act(async () => {
      await Promise.resolve();
    });
  }
};
const shell = (): React.ReactElement => (
  <HostDesktopShell>
    <></>
  </HostDesktopShell>
);
const mount = async (): Promise<Tree> => {
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(shell());
  });
  return tree;
};

beforeEach(() => {
  mockPathname = "/brand/b1/edit";
  mockUser = { id: "u1" };
  mockPlatform.OS = "web";
});

describe("#4453 a phone can reach the full brands sheet from the brand strip", () => {
  test("the strip's menu offers Manage brands, and it opens the full sheet over the whole screen", async () => {
    const tree = await mount();
    expect(hosts(tree, "host-phone-brand-strip")).toHaveLength(1);
    expect(hosts(tree, "host-shell-switcher-overlay")).toHaveLength(0);

    await press(tree, "host-phone-brand-switcher");
    await flushUntil(() => hosts(tree, "workspace-brand-sheet").length > 0);
    expect(hosts(tree, "workspace-brand-sheet")).toHaveLength(1);

    await press(tree, "workspace-brand-manage");
    await flushUntil(() => hosts(tree, "full-brands-sheet").length > 0);
    expect(hosts(tree, "workspace-brand-sheet")).toHaveLength(0);
    const overlay = hosts(tree, "host-shell-switcher-overlay");
    expect(overlay).toHaveLength(1);
    expect(hosts(tree, "full-brands-sheet")).toHaveLength(1);
    // No sidebar on a phone: the layer covers the screen edge to edge.
    const style = StyleSheet.flatten(overlay[0]!.props.style as never) as Record<string, unknown>;
    expect(style).toMatchObject({ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 });

    // Closing the sheet takes the layer away again.
    await press(tree, "full-brands-sheet");
    expect(hosts(tree, "host-shell-switcher-overlay")).toHaveLength(0);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("another screen starts without the sheet", async () => {
    const tree = await mount();
    await press(tree, "host-phone-brand-switcher");
    await flushUntil(() => hosts(tree, "workspace-brand-sheet").length > 0);
    await press(tree, "workspace-brand-manage");
    await flushUntil(() => hosts(tree, "full-brands-sheet").length > 0);
    mockPathname = "/brand/b1/team";
    await TestRenderer.act(async () => {
      tree.update(shell());
    });
    expect(hosts(tree, "host-shell-switcher-overlay")).toHaveLength(0);
    await TestRenderer.act(async () => tree.unmount());
  });
});
