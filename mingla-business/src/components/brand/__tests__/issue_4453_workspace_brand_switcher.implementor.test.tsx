// MINGLA-INVARIANT: I-4453-CHIP-NAMES-THE-SCREENS-BRAND | issue #4453 | The brand chip (WorkspaceBrandSwitcher, mounted by the app top bar and by brand-scoped screens) names the brand of the screen you are on: a screen's own brandId, else the brand the route names, else the current brand. It never shows another brand's name while the screen's brand is still loading, its label carries the full name and "Switch brand", and it is at least 44pt tall.
/**
 * #4453 (contract section I) — on host.usemingla.com the top bar read
 * "Lantern Room" while the screen was /brand/<Gameland Lagos>/website.
 *
 * FAILS-ON-REVERT: stop the switcher handing the screen's brand to its chip
 * (so the chip follows `useCurrentBrand()` again, ignoring the route) and
 * "the bug" fails with "Brand: Lantern Room…".
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/components/brand/__tests__/issue_4453_workspace_brand_switcher.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MockBrand { id: string; displayName: string; slug: string; role: string }
const GAMELAND: MockBrand = { id: "brand-gameland", displayName: "Gameland Lagos", slug: "gameland-lagos", role: "owner" };
const LANTERN: MockBrand = { id: "brand-lantern", displayName: "Lantern Room", slug: "lantern-room", role: "owner" };
const LONG: MockBrand = {
  id: "brand-long",
  displayName: "The Extraordinarily Long Named Supper Club of Victoria Island",
  slug: "long-supper-club",
  role: "admin",
};
const many = (count: number): MockBrand[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `brand-${i}`,
    displayName: i === 3 ? "Café Élan" : `Brand ${i}`,
    slug: `brand-${i}`,
    role: "owner",
  }));

let mockWide = true;
let mockCurrentBrand: MockBrand | null = LANTERN;
let mockStoreBrandId: string | null = LANTERN.id;
let mockBrands: MockBrand[] = [GAMELAND, LANTERN];
/** Brands the query cache can answer for; `mockListsAnswered` = a brand list has loaded. */
let mockCached: MockBrand[] = [GAMELAND, LANTERN];
let mockListsAnswered = true;
let mockListStatus = "ready";
let mockListLoading = false;
let mockSetup: Record<string, unknown> = {};
const mockSwitch = jest.fn(async (_brand: unknown) => "same-screen");
const mockPush = jest.fn();
const mockRefetch = jest.fn(async () => undefined);
const mockCacheListeners = new Set<() => void>();

jest.mock("expo-router", () => ({ useRouter: () => ({ push: (...a: unknown[]) => mockPush(...a) }) }));
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: mockWide }),
}));
jest.mock("../../../hooks/useCurrentBrand", () => ({ useCurrentBrand: () => mockCurrentBrand }));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (sel: (s: { currentBrandId: string | null; hasHydrated: boolean }) => unknown) =>
    sel({ currentBrandId: mockStoreBrandId, hasHydrated: true }),
}));
jest.mock("../../../hooks/brandCache", () => ({
  getBrandFromCache: (id: string | null) => mockCached.find((b) => b.id === id) ?? null,
}));
jest.mock("../../../config/queryClient", () => ({
  queryClient: {
    getQueryCache: () => ({
      subscribe: (listener: () => void) => {
        mockCacheListeners.add(listener);
        return () => mockCacheListeners.delete(listener);
      },
    }),
    getQueriesData: () => (mockListsAnswered ? [[["brands", "list", "u"], mockCached]] : []),
  },
}));
jest.mock("../../../hooks/useBrandListShim", () => ({
  useBrandListState: () => ({
    brands: mockBrands,
    status: mockListStatus,
    isLoading: mockListLoading,
    refetch: mockRefetch,
  }),
}));
jest.mock("../../../hooks/useBrandSetupStates", () => ({
  useBrandSetupStates: () => ({ byId: mockSetup, draftId: null, isLoading: false }),
}));
jest.mock("../../../hooks/useWorkspaceBrandSwitch", () => ({
  useWorkspaceBrandSwitch: () => (brand: unknown) => mockSwitch(brand),
}));
// #4453 integration: the menu loads through the brand sheet's module (one
// on-demand chunk for both, so nothing they share lands on the boot path).
// The menu under test is the real one; the sheet itself is not part of this test.
jest.mock("../BrandSwitcherSheet", () => ({
  WorkspaceBrandMenu: (jest.requireActual("../WorkspaceBrandMenu") as { WorkspaceBrandMenu: unknown }).WorkspaceBrandMenu,
}));
jest.mock("../BrandMark", () => {
  const { View } = require("react-native");
  return { BrandMark: ({ testID }: { testID?: string }) => <View testID={testID} /> };
});
jest.mock("../../ui/Icon", () => {
  const { View } = require("react-native");
  return { Icon: ({ name }: { name: string }) => <View testID={`icon-${name}`} /> };
});
jest.mock("../../ui/Material", () => {
  const { View } = require("react-native");
  return { Material: ({ children }: { children?: React.ReactNode }) => <View>{children}</View> };
});
// The phone sheet is the TopSheet (it drops from the top, as the full brand sheet does). The
// bottom Sheet stays stubbed under another name, so a menu that went back to it shows up.
const mockTopSheetProps: Record<string, unknown>[] = [];
jest.mock("../../ui/TopSheet", () => {
  const { View } = require("react-native");
  return {
    TopSheet: (props: { visible: boolean; children?: React.ReactNode; testID?: string }) => {
      mockTopSheetProps.push(props as unknown as Record<string, unknown>);
      return props.visible ? <View testID={props.testID}>{props.children}</View> : null;
    },
  };
});
jest.mock("../../ui/Sheet", () => {
  const { View } = require("react-native");
  return {
    Sheet: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
      visible ? <View testID="bottom-sheet-used">{children}</View> : null,
  };
});

import { StyleSheet } from "react-native";
import { WorkspaceBrandSwitcher } from "../WorkspaceBrandSwitcher";
import { BRAND_MENU_WIDTH, brandMenuPosition } from "../WorkspaceBrandMenu";
import type { WorkspaceRoute } from "../workspaceBrandContext";
import { WorkspaceRouteContext } from "../../ui/hostShellContext";
import { brandIdFromRoute } from "../../../config/workspaceBrandRoute";
import { filterBrandsByQuery, showsBrandSearch } from "../../../utils/brandSearch";

interface Node { type: unknown; props: Record<string, unknown>; children: (Node | string)[]; parent: Node | null }
type Tree = { root: Node & { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void | Promise<void>) => Promise<void>;
  create: (el: React.ReactElement) => Tree;
};
const textOf = (n: Node | string): string => (typeof n === "string" ? n : n.children.map(textOf).join(""));
const hosts = (tree: Tree, testID: string): Node[] =>
  tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === testID);
const labelled = (tree: Tree): string[] =>
  tree.root
    .findAll((n) => typeof n.type === "string" && typeof n.props.accessibilityLabel === "string")
    .map((n) => n.props.accessibilityLabel as string);
const pressable = (tree: Tree, testID: string): Node => {
  const found = tree.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function");
  expect(found.length).toBeGreaterThan(0);
  return found[0]!;
};
const press = async (tree: Tree, testID: string): Promise<void> =>
  TestRenderer.act(async () => {
    (pressable(tree, testID).props.onPress as () => void)();
  });
const flushUntil = async (done: () => boolean): Promise<void> => {
  for (let i = 0; i < 50 && !done(); i += 1) {
    await TestRenderer.act(async () => {
      await Promise.resolve();
    });
  }
};

async function mount(
  props: React.ComponentProps<typeof WorkspaceBrandSwitcher> = {},
  pathname: string | null = null,
  params: Record<string, string> = {},
): Promise<Tree> {
  const route: WorkspaceRoute = { pathname, params, routeBrandId: brandIdFromRoute(pathname, params) };
  let tree: Tree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <WorkspaceRouteContext.Provider value={route}>
        <WorkspaceBrandSwitcher {...props} />
      </WorkspaceRouteContext.Provider>,
    );
  });
  return tree as unknown as Tree;
}
const chip = (tree: Tree): Node =>
  tree.root.findAll(
    (n) => typeof n.type === "string" && typeof n.props.accessibilityLabel === "string" &&
      (n.props.accessibilityLabel as string).startsWith("Brand: "),
  )[0]!;
const openMenu = async (tree: Tree): Promise<void> => {
  await TestRenderer.act(async () => {
    (tree.root.findAll(
      (n) => typeof n.props.onPress === "function" && typeof n.props.accessibilityLabel === "string" &&
        (n.props.accessibilityLabel as string).startsWith("Brand: "),
    )[0]!.props.onPress as () => void)();
  });
  await flushUntil(() => hosts(tree, "workspace-brand-menu").length > 0);
  // Let the opening focus timer run.
  await TestRenderer.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const key = async (tree: Tree, name: string, inSearch = false): Promise<void> =>
  TestRenderer.act(async () => {
    const menu = hosts(tree, "workspace-brand-menu")[0]!;
    (menu.props.onKeyDown as (e: unknown) => void)({
      key: name,
      target: inSearch ? { tagName: "INPUT" } : { tagName: "DIV" },
      preventDefault: () => undefined,
    });
  });
const rowIds = (tree: Tree): string[] =>
  tree.root
    .findAll((n) => typeof n.type === "string" && typeof n.props.testID === "string" &&
      (n.props.testID as string).startsWith("workspace-brand-mark-"))
    .map((n) => (n.props.testID as string).replace("workspace-brand-mark-", ""));

beforeEach(() => {
  mockWide = true;
  mockCurrentBrand = LANTERN;
  mockStoreBrandId = LANTERN.id;
  mockBrands = [GAMELAND, LANTERN];
  mockCached = [GAMELAND, LANTERN];
  mockListsAnswered = true;
  mockListStatus = "ready";
  mockListLoading = false;
  mockSetup = {};
  mockSwitch.mockClear();
  mockPush.mockClear();
  mockRefetch.mockClear();
  mockCacheListeners.clear();
  mockTopSheetProps.length = 0;
});

describe("#4453 the chip names the brand of the screen you are on", () => {
  test("the bug: Lantern Room is current, the screen is Gameland Lagos' website", async () => {
    const tree = await mount({}, `/brand/${GAMELAND.id}/website`, { id: GAMELAND.id });
    expect(chip(tree).props.accessibilityLabel).toBe("Brand: Gameland Lagos. Switch brand");
    expect(textOf(chip(tree))).toBe("Gameland Lagos");
    expect(JSON.stringify(labelled(tree))).not.toContain("Lantern Room");
    await TestRenderer.act(async () => tree.unmount());
  });

  test.each([
    [`/brand/${GAMELAND.id}`, {}],
    [`/brand/${GAMELAND.id}/website/pages`, {}],
    [`/brand/${GAMELAND.id}/payments/rel_1`, {}],
    ["/ari", { brandId: GAMELAND.id, sitesIntent: "edit" }],
    ["/account/tap-to-pay", { brandId: GAMELAND.id }],
  ])("%s shows the route's brand", async (pathname, params) => {
    const tree = await mount({}, pathname, params as Record<string, string>);
    expect(textOf(chip(tree))).toBe("Gameland Lagos");
    await TestRenderer.act(async () => tree.unmount());
  });

  test.each(["/home", "/marketing/ads", "/hub/events", "/brand/new", `/reserve/${GAMELAND.id}`])(
    "%s follows the current brand",
    async (pathname) => {
      const tree = await mount({}, pathname, { brandId: GAMELAND.id });
      expect(chip(tree).props.accessibilityLabel).toBe("Brand: Lantern Room. Switch brand");
      await TestRenderer.act(async () => tree.unmount());
    },
  );

  test("a screen's own brandId wins over the route and the store", async () => {
    const tree = await mount({ brandId: GAMELAND.id, compact: true }, `/brand/${LANTERN.id}/website`);
    expect(textOf(chip(tree))).toBe("Gameland Lagos");
    await TestRenderer.act(async () => tree.unmount());
  });

  test("never the previous brand while the screen's brand is loading", async () => {
    mockCached = [LANTERN];
    mockListsAnswered = false;
    const tree = await mount({}, `/brand/${GAMELAND.id}/website`);
    expect(chip(tree).props.accessibilityLabel).toBe("Brand: loading");
    expect(JSON.stringify(labelled(tree))).not.toContain("Lantern Room");
    // The brand list arrives: the chip names Gameland without a route change.
    mockCached = [GAMELAND, LANTERN];
    mockListsAnswered = true;
    await TestRenderer.act(async () => {
      for (const listener of [...mockCacheListeners]) listener();
    });
    expect(chip(tree).props.accessibilityLabel).toBe("Brand: Gameland Lagos. Switch brand");
    await TestRenderer.act(async () => tree.unmount());
    expect(mockCacheListeners.size).toBe(0);
  });

  test("a brand the person is not on: their own brand, not an endless placeholder", async () => {
    const tree = await mount({}, "/brand/someone-elses/website");
    expect(chip(tree).props.accessibilityLabel).toBe("Brand: Lantern Room. Switch brand");
    await TestRenderer.act(async () => tree.unmount());
  });

  test("no cache listener when the screen's brand is already the current one", async () => {
    const tree = await mount({}, `/brand/${LANTERN.id}/website`);
    expect(mockCacheListeners.size).toBe(0);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("a long name: full in the label, one line on screen, a 44pt target", async () => {
    mockBrands = [LONG, LANTERN];
    mockCached = [LONG, LANTERN];
    const tree = await mount({ brandId: LONG.id, compact: true });
    expect(chip(tree).props.accessibilityLabel).toBe(`Brand: ${LONG.displayName}. Switch brand`);
    const label = tree.root.findAll((n) => typeof n.type === "string" && n.props.numberOfLines === 1)[0]!;
    expect(textOf(label)).toBe(LONG.displayName);
    const labelStyle = StyleSheet.flatten(label.props.style as never) as Record<string, unknown>;
    expect(labelStyle.flexShrink).toBe(1);
    const chipStyle = StyleSheet.flatten(chip(tree).props.style as never) as Record<string, unknown>;
    expect(chipStyle.minHeight).toBeGreaterThanOrEqual(44);
    expect(chipStyle.minWidth).toBe(0);
    expect(chipStyle.flexShrink).toBe(1);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("the top bar keeps its 18-character name; the label still says it in full", async () => {
    mockCurrentBrand = LONG;
    mockStoreBrandId = LONG.id;
    const tree = await mount({}, "/home");
    expect(textOf(chip(tree))).toBe("The Extraordinari…");
    expect(chip(tree).props.accessibilityLabel).toBe(`Brand: ${LONG.displayName}. Switch brand`);
    await TestRenderer.act(async () => tree.unmount());
  });
});

describe("#4453 opening the switcher", () => {
  test("desktop: a popover under the chip, every brand with its mark, the screen's brand ticked", async () => {
    const tree = await mount({}, `/brand/${GAMELAND.id}/website`);
    expect(hosts(tree, "workspace-brand-popover")).toHaveLength(0);
    expect((chip(tree).props.accessibilityState as { expanded?: boolean }).expanded).toBe(false);
    await openMenu(tree);
    expect(hosts(tree, "workspace-brand-popover")).toHaveLength(1);
    expect(hosts(tree, "workspace-brand-sheet")).toHaveLength(0);
    expect((chip(tree).props.accessibilityState as { expanded?: boolean }).expanded).toBe(true);
    expect(rowIds(tree)).toEqual([GAMELAND.id, LANTERN.id]);
    // The tick is on the brand of the SCREEN (Gameland), not the store's.
    expect(hosts(tree, `workspace-brand-tick-${GAMELAND.id}`)).toHaveLength(1);
    expect(hosts(tree, `workspace-brand-tick-${LANTERN.id}`)).toHaveLength(0);
    const labels = labelled(tree);
    expect(labels).toContain("Gameland Lagos, the brand you are in");
    expect(labels).toContain("Switch to Lantern Room");
    expect(labels).toContain("Create a new brand");
    await TestRenderer.act(async () => tree.unmount());
  });

  test("picking a brand closes the menu and switches through the one switch hook", async () => {
    const tree = await mount({}, `/brand/${GAMELAND.id}/website`);
    await openMenu(tree);
    await press(tree, `workspace-brand-row-${LANTERN.id}`);
    expect(mockSwitch).toHaveBeenCalledTimes(1);
    expect(mockSwitch).toHaveBeenCalledWith(LANTERN);
    expect(hosts(tree, "workspace-brand-popover")).toHaveLength(0);
    expect((chip(tree).props.accessibilityState as { expanded?: boolean }).expanded).toBe(false);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("the backdrop closes it without switching", async () => {
    const tree = await mount({}, "/home");
    await openMenu(tree);
    await press(tree, "workspace-brand-backdrop");
    expect(hosts(tree, "workspace-brand-popover")).toHaveLength(0);
    expect(mockSwitch).not.toHaveBeenCalled();
    await TestRenderer.act(async () => tree.unmount());
  });

  test("every row and action is a 44pt target", async () => {
    const tree = await mount({}, "/home");
    await openMenu(tree);
    // Brand rows, the footer actions and the chip itself.
    const heights = tree.root
      .findAll((n) => typeof n.type === "string" && n.props.style !== undefined)
      .map((n) => StyleSheet.flatten(n.props.style as never) as Record<string, unknown>)
      .filter((style) => style.flexDirection === "row" && typeof style.minHeight === "number")
      .map((style) => style.minHeight as number);
    expect(heights.length).toBeGreaterThanOrEqual(4);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("phone, on a screen without a top-bar sheet: the sheet drops from the top", async () => {
    mockWide = false;
    const tree = await mount({ brandId: GAMELAND.id, compact: true });
    await openMenu(tree);
    expect(hosts(tree, "workspace-brand-sheet")).toHaveLength(1);
    // The top sheet, never the bottom one, at the full brand sheet's own height.
    expect(hosts(tree, "bottom-sheet-used")).toHaveLength(0);
    const sheetProps = mockTopSheetProps[mockTopSheetProps.length - 1]!;
    expect(sheetProps.visible).toBe(true);
    expect(sheetProps.heightMode).toBeUndefined();
    expect(hosts(tree, "workspace-brand-popover")).toHaveLength(0);
    expect(rowIds(tree)).toEqual([GAMELAND.id, LANTERN.id]);
    expect(labelled(tree)).not.toContain("Manage brands");
    await press(tree, `workspace-brand-row-${LANTERN.id}`);
    expect(mockSwitch).toHaveBeenCalledWith(LANTERN);
    // A row tap closes the sheet.
    expect(hosts(tree, "workspace-brand-sheet")).toHaveLength(0);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("phone sheet: a full-screen layer of its own, with room inside and nothing under the drag band", async () => {
    mockWide = false;
    mockBrands = many(9);
    const tree = await mount({ brandId: "brand-0", compact: true });
    await openMenu(tree);
    // The chip sits in a 48pt strip; the TopSheet fills its parent, so it needs its own layer.
    const layers = tree.root.findAll(
      (n) => n.props.transparent === true && typeof n.props.onRequestClose === "function" && typeof n.props.onDismiss === "function",
    );
    expect(layers.length).toBeGreaterThan(0);
    expect(layers[0]!.props.visible).toBe(true);
    // Search and the list are inside the sheet.
    const sheet = hosts(tree, "workspace-brand-sheet")[0]!;
    const inSheet = (testID: string): number =>
      (sheet as unknown as Tree["root"]).findAll((n) => typeof n.type === "string" && n.props.testID === testID).length;
    expect(inSheet("workspace-brand-search")).toBe(1);
    expect(inSheet("workspace-brand-menu")).toBe(1);
    const flat = (n: Node): Record<string, unknown> => StyleSheet.flatten(n.props.style as never) as Record<string, unknown>;
    // Breathing room: the sheet's content is inset from the panel's edge and top.
    const padded = (sheet as unknown as Tree["root"]).findAll(
      (n) => typeof n.type === "string" && typeof flat(n)?.paddingTop === "number" && typeof flat(n)?.paddingHorizontal === "number",
    )[0]!;
    expect(flat(padded).paddingTop as number).toBeGreaterThanOrEqual(16);
    expect(flat(padded).paddingHorizontal as number).toBeGreaterThanOrEqual(12);
    // The list takes the room there is (it scrolls); the actions stay below it, clear of the
    // 28pt band the web TopSheet lays over the bottom of the panel.
    const menu = hosts(tree, "workspace-brand-menu")[0]!;
    expect(flat(menu).flex).toBe(1);
    const footer = (sheet as unknown as Tree["root"]).findAll(
      (n) => typeof n.type === "string" && typeof flat(n)?.borderTopWidth === "number",
    )[0]!;
    expect(flat(footer).paddingBottom as number).toBeGreaterThanOrEqual(28);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("phone sheet: Escape or a tap outside closes it, and focus goes back to the chip once the layer is gone", async () => {
    mockWide = false;
    const focus = jest.fn();
    let tree: Tree | null = null;
    await TestRenderer.act(async () => {
      tree = (TestRenderer.create as unknown as (el: React.ReactElement, o: unknown) => Tree)(
        <WorkspaceRouteContext.Provider value={{ pathname: null, params: {}, routeBrandId: null }}>
          <WorkspaceBrandSwitcher brandId={GAMELAND.id} compact />
        </WorkspaceRouteContext.Provider>,
        { createNodeMock: () => ({ focus }) },
      );
    });
    const mounted = tree as unknown as Tree;
    await openMenu(mounted);
    expect(hosts(mounted, "workspace-brand-sheet")).toHaveLength(1);
    focus.mockClear();
    // The TopSheet's own Escape and scrim tap both call its onClose.
    await TestRenderer.act(async () => {
      (mockTopSheetProps[mockTopSheetProps.length - 1]!.onClose as () => void)();
    });
    expect(hosts(mounted, "workspace-brand-sheet")).toHaveLength(0);
    expect((chip(mounted).props.accessibilityState as { expanded?: boolean }).expanded).toBe(false);
    expect(focus).toHaveBeenCalledTimes(1);
    // The layer holds focus until it has left the page; when it has, the chip is focused again.
    const layer = mounted.root.findAll(
      (n) => n.props.transparent === true && typeof n.props.onDismiss === "function",
    )[0]!;
    await TestRenderer.act(async () => {
      (layer.props.onDismiss as () => void)();
    });
    expect(focus).toHaveBeenCalledTimes(2);
    await TestRenderer.act(async () => mounted.unmount());
  });

  test("phone, in the app top bar: the host's own full switcher sheet opens", async () => {
    mockWide = false;
    const onOpenSheet = jest.fn();
    const tree = await mount({ onOpenSheet });
    await press(tree, "workspace-brand-switcher");
    expect(onOpenSheet).toHaveBeenCalledTimes(1);
    expect(hosts(tree, "workspace-brand-menu")).toHaveLength(0);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("desktop top bar: the popover offers the full sheet as Manage brands", async () => {
    const onOpenSheet = jest.fn();
    const tree = await mount({ onOpenSheet }, "/home");
    await openMenu(tree);
    expect(onOpenSheet).not.toHaveBeenCalled();
    await press(tree, "workspace-brand-manage");
    expect(onOpenSheet).toHaveBeenCalledTimes(1);
    expect(hosts(tree, "workspace-brand-popover")).toHaveLength(0);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("no brand yet: the chip opens the top bar's sheet, where a first brand is made", async () => {
    mockCurrentBrand = null;
    mockStoreBrandId = null;
    mockBrands = [];
    mockCached = [];
    const onOpenSheet = jest.fn();
    const tree = await mount({ onOpenSheet }, "/home");
    expect(chip(tree).props.accessibilityLabel).toBe("Brand: Create brand");
    await press(tree, "workspace-brand-switcher");
    expect(onOpenSheet).toHaveBeenCalledTimes(1);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("Create a new brand opens the create route", async () => {
    const tree = await mount({}, "/home");
    await openMenu(tree);
    await press(tree, "workspace-brand-create");
    expect(mockPush).toHaveBeenCalledWith("/brand/new");
    expect(hosts(tree, "workspace-brand-popover")).toHaveLength(0);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("an unfinished brand says so on its row", async () => {
    mockSetup = { [GAMELAND.id]: { kind: "draft", doneCount: 1 }, [LANTERN.id]: { kind: "free_only", doneCount: 2 } };
    const tree = await mount({}, "/home");
    await openMenu(tree);
    expect(textOf(pressable(tree, `workspace-brand-row-${GAMELAND.id}`))).toContain("Draft · 1 of 4 done");
    expect(textOf(pressable(tree, `workspace-brand-row-${LANTERN.id}`))).toContain("Free events only");
    await TestRenderer.act(async () => tree.unmount());
  });

  test("the list failing to load says so and can be retried", async () => {
    mockBrands = [];
    mockListStatus = "error";
    const tree = await mount({}, "/home");
    await openMenu(tree);
    expect(textOf(hosts(tree, "workspace-brand-menu")[0]!)).toContain("Couldn't load your brands.");
    await press(tree, "workspace-brand-retry");
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    await TestRenderer.act(async () => tree.unmount());
  });
});

describe("#4453 search and keyboard", () => {
  test("8 brands: no search field; 9 brands: a search field", async () => {
    expect(showsBrandSearch(8)).toBe(false);
    expect(showsBrandSearch(9)).toBe(true);
    mockBrands = many(8);
    let tree = await mount({}, "/home");
    await openMenu(tree);
    expect(hosts(tree, "workspace-brand-search")).toHaveLength(0);
    await TestRenderer.act(async () => tree.unmount());
    mockBrands = many(9);
    tree = await mount({}, "/home");
    await openMenu(tree);
    expect(hosts(tree, "workspace-brand-search")).toHaveLength(1);
    expect(labelled(tree)).toContain("Find a brand");
    await TestRenderer.act(async () => tree.unmount());
  });

  test("typing narrows the list, ignoring case and accents; Enter picks the first match", async () => {
    mockBrands = many(12);
    const tree = await mount({}, "/home");
    await openMenu(tree);
    const search = tree.root.findAll(
      (n) => n.props.testID === "workspace-brand-search" && typeof n.props.onChangeText === "function",
    )[0]!;
    await TestRenderer.act(async () => {
      (search.props.onChangeText as (v: string) => void)("cafe el");
    });
    expect(rowIds(tree)).toEqual(["brand-3"]);
    await key(tree, "Enter", true);
    expect(mockSwitch).toHaveBeenCalledWith(mockBrands[3]);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("nothing matches: it says so, and Enter does nothing", async () => {
    mockBrands = many(9);
    const tree = await mount({}, "/home");
    await openMenu(tree);
    const search = tree.root.findAll(
      (n) => n.props.testID === "workspace-brand-search" && typeof n.props.onChangeText === "function",
    )[0]!;
    await TestRenderer.act(async () => {
      (search.props.onChangeText as (v: string) => void)("zzz");
    });
    expect(textOf(hosts(tree, "workspace-brand-no-match")[0]!)).toBe('No brand matches "zzz".');
    await key(tree, "Enter", true);
    expect(mockSwitch).not.toHaveBeenCalled();
    await TestRenderer.act(async () => tree.unmount());
  });

  test("Down from the search field walks the results; Enter picks the highlighted one", async () => {
    mockBrands = many(9);
    const tree = await mount({}, "/home");
    await openMenu(tree);
    await key(tree, "ArrowDown", true);
    await key(tree, "ArrowDown", true);
    await key(tree, "Enter", true);
    expect(mockSwitch).toHaveBeenCalledWith(mockBrands[1]);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("arrows wrap around rows and actions; Home and End jump; a focused row presses itself", async () => {
    const onOpenSheet = jest.fn();
    const tree = await mount({ onOpenSheet }, `/brand/${GAMELAND.id}/website`);
    await openMenu(tree);
    const activeRows = (): string[] =>
      tree.root
        .findAll((n) => typeof n.type === "string" && n.props.style !== undefined)
        .filter((n) => {
          const flat = StyleSheet.flatten(n.props.style as never) as Record<string, unknown>;
          return flat.minHeight !== undefined && flat.backgroundColor !== undefined && flat.flexDirection === "row";
        })
        .map((n) => textOf(n));
    // Opens on the brand you are in (Gameland): it is both current and active.
    expect(activeRows()).toEqual(["Gameland Lagos"]);
    await key(tree, "ArrowDown");
    expect(activeRows()).toEqual(["Gameland Lagos", "Lantern Room"]);
    await key(tree, "End");
    expect(activeRows()).toEqual(["Gameland Lagos", "Manage brands"]);
    await key(tree, "ArrowDown"); // wraps to the first row
    expect(activeRows()).toEqual(["Gameland Lagos"]);
    await key(tree, "ArrowUp"); // wraps to the last action
    expect(activeRows()).toEqual(["Gameland Lagos", "Manage brands"]);
    await key(tree, "Home");
    expect(activeRows()).toEqual(["Gameland Lagos"]);
    // Enter on a focused row is the row's own press (the browser fires it):
    // the menu must not pick a second time.
    await key(tree, "Enter");
    expect(mockSwitch).not.toHaveBeenCalled();
    await TestRenderer.act(async () => tree.unmount());
  });

  test("filterBrandsByQuery matches the name or the address slug", () => {
    const brands = [GAMELAND, LANTERN];
    expect(filterBrandsByQuery(brands, "  LAGOS ")).toEqual([GAMELAND]);
    expect(filterBrandsByQuery(brands, "lantern-r")).toEqual([LANTERN]);
    expect(filterBrandsByQuery(brands, "")).toEqual(brands);
    expect(filterBrandsByQuery(brands, "nope")).toEqual([]);
  });
});

describe("#4453 popover placement", () => {
  test("under the chip, left-aligned, inside the viewport", () => {
    const pos = brandMenuPosition({ x: 300, y: 20, width: 180, height: 44 }, { width: 1440, height: 900 });
    expect(pos.left).toBe(300);
    expect(pos.top).toBeGreaterThanOrEqual(64);
    expect(pos.top).toBeLessThan(80);
    expect(pos.top + pos.maxHeight).toBeLessThanOrEqual(900);
  });

  test("a chip near the right edge keeps the menu on screen", () => {
    const pos = brandMenuPosition({ x: 900, y: 20, width: 100, height: 44 }, { width: 1024, height: 700 });
    expect(pos.left + BRAND_MENU_WIDTH).toBeLessThanOrEqual(1024);
    expect(pos.left).toBeGreaterThanOrEqual(0);
  });

  test("a short window still leaves room for three rows", () => {
    const pos = brandMenuPosition({ x: 16, y: 16, width: 100, height: 44 }, { width: 1024, height: 120 });
    expect(pos.maxHeight).toBeGreaterThanOrEqual(3 * 56);
  });
});
