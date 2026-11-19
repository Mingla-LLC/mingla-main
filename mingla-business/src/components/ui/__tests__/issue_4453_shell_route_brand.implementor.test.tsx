/**
 * #4453 (contract section I) — the root shell is what tells every brand chip
 * which brand the route names, on every platform (it is a passthrough for
 * layout on phones and native, but it still wraps the whole Stack).
 *
 * The reported screen: host.usemingla.com/brand/<Gameland Lagos>/website with
 * "Lantern Room" in the top bar.
 *
 * FAILS-ON-REVERT: remove the WorkspaceRouteContext provider from
 * HostDesktopShell and R1 reads "Brand: Lantern Room. Switch brand"; remove
 * the route sync and R2 sees no store write.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/components/ui/__tests__/issue_4453_shell_route_brand.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GAMELAND = { id: "brand-gameland", displayName: "Gameland Lagos" };
const LANTERN = { id: "brand-lantern", displayName: "Lantern Room" };

let mockPathname = `/brand/${GAMELAND.id}/website`;
let mockParams: Record<string, string> = { id: GAMELAND.id };
let mockWide = true;
let mockItemBrandId: string | null = null;
const mockItemRefs: Array<{ table: string; id: string } | null> = [];
let mockStoreBrandId: string | null = LANTERN.id;
const mockSetCurrentBrandId = jest.fn((id: string | null) => {
  mockStoreBrandId = id;
});

jest.mock("expo-router", () => ({
  usePathname: () => mockPathname,
  useSegments: () => mockPathname.split("/").filter(Boolean),
  useGlobalSearchParams: () => mockParams,
}));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: mockWide }) }));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({ useCurrentBrandRole: () => ({ rank: 60 }) }));
jest.mock("../../../hooks/useItemRouteBrand", () => ({
  useItemRouteBrand: (ref: { table: string; id: string } | null) => {
    mockItemRefs.push(ref);
    return { brandId: ref === null ? null : mockItemBrandId, pending: false };
  },
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
  getBrandFromCache: (id: string | null) => [GAMELAND, LANTERN].find((b) => b.id === id) ?? null,
}));
jest.mock("../../../config/queryClient", () => ({
  queryClient: {
    getQueryCache: () => ({ subscribe: () => () => undefined }),
    getQueriesData: () => [[["brands", "list", "u1"], [GAMELAND, LANTERN]]],
  },
}));
jest.mock("../DesktopSidebar", () => {
  const { View } = require("react-native");
  return { SIDEBAR_SOURCE_TABS: [], DesktopSidebar: () => <View testID="mock-sidebar" /> };
});
jest.mock("../TopBar", () => {
  const { View } = require("react-native");
  return { TopBar: () => <View testID="mock-topbar" /> };
});
jest.mock("../../brand/BrandMark", () => ({ BrandMark: (): null => null }));
jest.mock("../Icon", () => ({ Icon: (): null => null }));

import { HostDesktopShell } from "../HostDesktopShell";
import { BrandChip } from "../BrandChip";
import type { WorkspaceRoute } from "../../brand/workspaceBrandContext";
import { WorkspaceRouteContext } from "../hostShellContext";

interface Node { type: unknown; props: Record<string, unknown> }
type Tree = { root: { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void | Promise<void>) => Promise<void>;
  create: (el: React.ReactElement) => Tree;
};

let seenRoute: WorkspaceRoute | null = null;
const Screen: React.FC = () => {
  const route = React.useContext(WorkspaceRouteContext);
  seenRoute = route;
  // A bare chip (Ari's): its screen hands it the route's brand from the shell.
  return <BrandChip onPress={() => undefined} brand={route.brand?.brand} brandLoading={route.brand?.pending} />;
};
async function mount(): Promise<Tree> {
  let tree: Tree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <HostDesktopShell>
        <Screen />
      </HostDesktopShell>,
    );
  });
  return tree as unknown as Tree;
}
const chipLabel = (tree: Tree): string =>
  tree.root
    .findAll((n) => typeof n.type === "string" && typeof n.props.accessibilityLabel === "string")
    .map((n) => n.props.accessibilityLabel as string)
    .find((label) => label.startsWith("Brand: ")) ?? "";

beforeEach(() => {
  mockPathname = `/brand/${GAMELAND.id}/website`;
  mockParams = { id: GAMELAND.id };
  mockWide = true;
  mockStoreBrandId = LANTERN.id;
  mockSetCurrentBrandId.mockClear();
  mockItemBrandId = null;
  mockItemRefs.length = 0;
  seenRoute = null;
  (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = () => 0;
  (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback = () => undefined;
});

describe("#4453 the shell hands the route's brand to the chrome", () => {
  test("R1: /brand/<Gameland>/website with Lantern Room current reads Gameland Lagos, first render", async () => {
    // Freeze the store so only the route can explain the name on screen.
    mockSetCurrentBrandId.mockImplementation(() => undefined);
    const tree = await mount();
    expect(chipLabel(tree)).toBe("Brand: Gameland Lagos. Switch brand");
    expect(seenRoute).toMatchObject({
      pathname: `/brand/${GAMELAND.id}/website`,
      params: { id: GAMELAND.id },
      routeBrandId: GAMELAND.id,
      // The route's brand, read by the shell: what a bare chip shows.
      brand: { brand: GAMELAND, pending: false },
    });
    // The shell also hands down the switcher and the held-switch holder.
    expect(typeof seenRoute?.Switcher).toBe("function");
    expect(seenRoute?.pendingSwitch).toEqual({ current: null });
    await TestRenderer.act(async () => tree.unmount());
  });

  test("R2: and the current brand is pointed at it, once", async () => {
    mockSetCurrentBrandId.mockImplementation((id: string | null) => {
      mockStoreBrandId = id;
    });
    const tree = await mount();
    expect(mockSetCurrentBrandId).toHaveBeenCalledTimes(1);
    expect(mockSetCurrentBrandId).toHaveBeenCalledWith(GAMELAND.id);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("R3: phones and native get the same answer (the shell is a layout passthrough there)", async () => {
    mockWide = false;
    mockSetCurrentBrandId.mockImplementation(() => undefined);
    const tree = await mount();
    expect(chipLabel(tree)).toBe("Brand: Gameland Lagos. Switch brand");
    expect(tree.root.findAll((n) => n.props.testID === "host-shell-topbar")).toHaveLength(0);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("R4: a screen that follows the current brand is untouched", async () => {
    mockPathname = "/notifications";
    mockParams = {};
    const tree = await mount();
    expect(chipLabel(tree)).toBe("Brand: Lantern Room. Switch brand");
    expect(seenRoute?.routeBrandId).toBeNull();
    expect(mockSetCurrentBrandId).not.toHaveBeenCalled();
    await TestRenderer.act(async () => tree.unmount());
  });

  test("R5: a public buyer page never moves the host's brand", async () => {
    mockPathname = `/reserve/${GAMELAND.id}`;
    mockParams = { brandId: GAMELAND.id };
    const tree = await mount();
    expect(seenRoute?.routeBrandId).toBeNull();
    expect(mockSetCurrentBrandId).not.toHaveBeenCalled();
    await TestRenderer.act(async () => tree.unmount());
  });

  test("R6: one trip opened while another brand is current names the trip's brand, and makes it current", async () => {
    mockPathname = "/trip/a3e4756c-f273-47fc-bf73-2f8432217e3a";
    mockParams = { id: "a3e4756c-f273-47fc-bf73-2f8432217e3a" };
    mockItemBrandId = GAMELAND.id;
    const tree = await mount();
    expect(mockItemRefs[0]).toEqual({ table: "events", id: "a3e4756c-f273-47fc-bf73-2f8432217e3a" });
    expect(seenRoute?.routeBrandId).toBe(GAMELAND.id);
    expect(mockSetCurrentBrandId).toHaveBeenCalledWith(GAMELAND.id);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("R7: a visitor's page is never looked up (no chrome, no brand moved)", async () => {
    mockPathname = "/e/gameland/a3e4756c-f273-47fc-bf73-2f8432217e3a";
    mockParams = {};
    mockItemBrandId = GAMELAND.id;
    const tree = await mount();
    expect(mockItemRefs.every((ref) => ref === null)).toBe(true);
    expect(mockSetCurrentBrandId).not.toHaveBeenCalled();
    await TestRenderer.act(async () => tree.unmount());
  });
});
