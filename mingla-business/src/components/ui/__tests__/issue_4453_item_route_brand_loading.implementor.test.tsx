// MINGLA-INVARIANT: I-4453-ITEM-ROUTE-NEVER-NAMES-ANOTHER-BRAND | issue #4453 | On a screen that shows one item (a trip, an event, an RSVP, an experience, a listing), every brand chip and switcher shows the loading placeholder until the item's brand is known, then that brand; only an item that cannot be resolved falls back to the current brand. Screens that are not about one item never gain a loading state from this.
/**
 * #4453 (contract section I, rule 2) — a link straight to one trip of brand B,
 * opened while brand A was the last one used, showed "A" in the chip until the
 * trip's brand had been read (0.3 to 3.7 s on every load).
 *
 * WHAT RUNS: the real HostDesktopShell, useRouteBrand / useWorkspaceBrand, the
 * real WorkspaceBrandSwitcher and BrandChip. The item read itself
 * (useItemRouteBrand) is played by the test, pending or answered.
 *
 * FAILS-ON-REVERT: stop the shell telling useRouteBrand that the item's brand
 * is pending (or drop the pending branch in useWorkspaceBrand) and L1 to L3
 * read "Brand: Lantern Room. Switch brand" while the trip is still loading.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/components/ui/__tests__/issue_4453_item_route_brand_loading.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { afterAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { Platform } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GAMELAND = { id: "brand-gameland", displayName: "Gameland Lagos" };
const LANTERN = { id: "brand-lantern", displayName: "Lantern Room" };
const TRIP = "/trip/a3e4756c-f273-47fc-bf73-2f8432217e3a";

let mockPathname = TRIP;
let mockWide = true;
let mockItem: { brandId: string | null; pending: boolean } = { brandId: null, pending: true };
let mockStoreBrandId: string | null = LANTERN.id;
/** Brands the query cache can answer for. */
let mockCached = [GAMELAND, LANTERN];
/** A brand list has loaded (then a brand it lacks is not "loading": the person is not on it). */
let mockListsAnswered = true;
const mockSetCurrentBrandId = jest.fn();

jest.mock("expo-router", () => ({
  usePathname: () => mockPathname,
  useSegments: () => mockPathname.split("/").filter(Boolean),
  useGlobalSearchParams: () => ({}),
}));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: mockWide }) }));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({ useCurrentBrandRole: () => ({ rank: 60 }) }));
// As the real hook answers: nothing to wait for off an item screen.
jest.mock("../../../hooks/useItemRouteBrand", () => ({
  useItemRouteBrand: (ref: unknown) => (ref === null ? { brandId: null, pending: false } : mockItem),
}));
jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => (mockStoreBrandId === LANTERN.id ? LANTERN : mockStoreBrandId === GAMELAND.id ? GAMELAND : null),
}));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (
    sel: (s: { currentBrandId: string | null; hasHydrated: boolean; setCurrentBrandId: (id: string | null) => void }) => unknown,
  ) => sel({ currentBrandId: mockStoreBrandId, hasHydrated: true, setCurrentBrandId: mockSetCurrentBrandId }),
}));
jest.mock("../../../hooks/brandCache", () => ({
  getBrandFromCache: (id: string | null) => mockCached.find((b) => b.id === id) ?? null,
}));
jest.mock("../../../config/queryClient", () => ({
  queryClient: {
    // Read through the query cache, as useWorkspaceBrand does.
    getQueryCache: () => ({
      subscribe: () => () => undefined,
      findAll: () => (mockListsAnswered ? [{ state: { data: mockCached, status: "success", fetchStatus: "idle" } }] : []),
    }),
  },
}));
jest.mock("../DesktopSidebar", () => {
  const { View } = require("react-native");
  return { SIDEBAR_SOURCE_TABS: [], DesktopSidebar: () => <View testID="mock-sidebar" /> };
});
// The top bar's brand slot, as TopBar renders it: the shell's switcher, told what the shell knows.
jest.mock("../TopBar", () => {
  const ReactLocal = require("react");
  const { WorkspaceRouteContext: Ctx } = require("../hostShellContext");
  return {
    TopBar: ({ leftKind, onBrandTap, brandLoading }: { leftKind: string; onBrandTap: () => void; brandLoading: boolean }) => {
      const { Switcher } = ReactLocal.useContext(Ctx);
      return leftKind === "brand" && Switcher !== undefined ? (
        <Switcher onOpenSheet={onBrandTap} brandLoading={brandLoading} testID="topbar-switcher" />
      ) : null;
    },
  };
});
jest.mock("../../brand/BrandMark", () => ({ BrandMark: (): null => null }));
jest.mock("../Icon", () => ({ Icon: (): null => null }));

import { HostDesktopShell } from "../HostDesktopShell";
import { BrandChip } from "../BrandChip";
import { WorkspaceRouteContext } from "../hostShellContext";

interface Node { type: unknown; props: Record<string, unknown> }
type Tree = {
  root: { findAll: (p: (n: Node) => boolean) => Node[] };
  update: (el: React.ReactElement) => void;
  unmount: () => void;
};
const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void | Promise<void>) => Promise<void>;
  create: (el: React.ReactElement) => Tree;
};

// A bare chip on the screen (not inside the switcher): handed the route's brand by the shell.
const Screen: React.FC = () => {
  const route = React.useContext(WorkspaceRouteContext);
  return <BrandChip onPress={() => undefined} brand={route.brand?.brand} brandLoading={route.brand?.pending} />;
};
const app = (): React.ReactElement => (
  <HostDesktopShell>
    <Screen />
  </HostDesktopShell>
);
async function mount(): Promise<Tree> {
  let tree: Tree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(app());
  });
  return tree as unknown as Tree;
}
const rerender = async (tree: Tree): Promise<void> => TestRenderer.act(async () => tree.update(app()));
/** Every brand name on screen, as a screen reader hears it (one per chip). */
const chipLabels = (tree: Tree): string[] =>
  tree.root
    .findAll((n) => typeof n.type === "string" && typeof n.props.accessibilityLabel === "string")
    .map((n) => n.props.accessibilityLabel as string)
    .filter((label) => label.startsWith("Brand: "));

const realOS = Platform.OS;
beforeEach(() => {
  mockPathname = TRIP;
  mockWide = true;
  mockItem = { brandId: null, pending: true };
  mockStoreBrandId = LANTERN.id;
  mockCached = [GAMELAND, LANTERN];
  mockListsAnswered = true;
  mockSetCurrentBrandId.mockReset();
  (Platform as { OS: string }).OS = "web";
  (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = () => 0;
  (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback = () => undefined;
});
afterAll(() => {
  (Platform as { OS: string }).OS = realOS;
});

describe("#4453 one item's screen never names another brand while its own is being read", () => {
  test("L1: desktop, a trip of another brand: the top bar's switcher and a bare chip both show the placeholder", async () => {
    const tree = await mount();
    // Two chips: the top bar's switcher and the screen's own.
    expect(chipLabels(tree)).toEqual(["Brand: loading", "Brand: loading"]);
    expect(mockSetCurrentBrandId).not.toHaveBeenCalled();
    await TestRenderer.act(async () => tree.unmount());
  });

  test("L2: phone web: the strip's switcher shows the placeholder too", async () => {
    mockWide = false;
    const tree = await mount();
    expect(tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === "host-phone-brand-strip")).toHaveLength(1);
    expect(chipLabels(tree)).toEqual(["Brand: loading", "Brand: loading"]);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("L3: the whole load: placeholder, then the trip's brand, and the last-used brand is never named", async () => {
    const seen: string[] = [];
    const tree = await mount();
    seen.push(...chipLabels(tree));
    // The trip's brand is known, but the brand list has not loaded yet.
    mockItem = { brandId: GAMELAND.id, pending: false };
    mockCached = [];
    mockListsAnswered = false;
    await rerender(tree);
    seen.push(...chipLabels(tree));
    // The brand list arrives. (The store still says Lantern Room: the chrome follows the trip.)
    mockCached = [GAMELAND, LANTERN];
    mockListsAnswered = true;
    await rerender(tree);
    seen.push(...chipLabels(tree));
    expect(seen.filter((label) => label.includes("Lantern Room"))).toEqual([]);
    expect(seen.slice(-2)).toEqual(["Brand: Gameland Lagos. Switch brand", "Brand: Gameland Lagos. Switch brand"]);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("L4: an item that cannot be resolved (not found, no access, a failed read) falls back to the current brand", async () => {
    mockItem = { brandId: null, pending: false };
    const tree = await mount();
    expect(chipLabels(tree)).toEqual(["Brand: Lantern Room. Switch brand", "Brand: Lantern Room. Switch brand"]);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("L5: a trip of the current brand goes from the placeholder to its name", async () => {
    const tree = await mount();
    expect(chipLabels(tree)).toEqual(["Brand: loading", "Brand: loading"]);
    mockItem = { brandId: LANTERN.id, pending: false };
    await rerender(tree);
    expect(chipLabels(tree)).toEqual(["Brand: Lantern Room. Switch brand", "Brand: Lantern Room. Switch brand"]);
    await TestRenderer.act(async () => tree.unmount());
  });

  test.each([
    [`/brand/${LANTERN.id}/edit`, "Brand: Lantern Room. Switch brand"],
    [`/brand/${GAMELAND.id}/payments`, "Brand: Gameland Lagos. Switch brand"],
    ["/event/create", "Brand: Lantern Room. Switch brand"],
    ["/ari", "Brand: Lantern Room. Switch brand"],
    ["/home", "Brand: Lantern Room. Switch brand"],
  ])("L6: %s is not one item's screen: no placeholder, first render", async (pathname, label) => {
    mockPathname = pathname;
    // Even if an item read were somehow still pending, a screen that is not about one item never waits on it.
    mockItem = { brandId: null, pending: true };
    for (const wide of [true, false]) {
      mockWide = wide;
      const tree = await mount();
      const labels = chipLabels(tree);
      expect(labels.length).toBeGreaterThan(0);
      expect(labels.every((seenLabel) => seenLabel === label)).toBe(true);
      await TestRenderer.act(async () => tree.unmount());
    }
  });
});
