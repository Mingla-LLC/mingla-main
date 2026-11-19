// MINGLA-INVARIANT: I-4453-ROUTE-BRAND-IS-CURRENT | issue #4453 | A Host route that names a brand (/brand/<id>/..., ?brandId=) makes that brand the current brand, once per route brand: it only writes the store (never navigates), waits for the persisted store to rehydrate and for the brand to be readable, never selects a brand the person is not on, and never writes again for the same route brand, so a cleared or changed pointer is not fought.
/**
 * #4453 (contract section I) — the header said "Lantern Room" while the
 * screen was Gameland Lagos' website, because nothing made the route's brand
 * current.
 *
 * FAILS-ON-REVERT: drop the once-per-route-brand latch and "does not fight a
 * cleared pointer" loops (the write count climbs); drop the hydration wait and
 * "waits for the persisted store" writes too early.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/hooks/__tests__/issue_4453_route_brand_sync.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GAMELAND = "brand-gameland";
const LANTERN = "brand-lantern";

interface MockStore {
  currentBrandId: string | null;
  hasHydrated: boolean;
  setCurrentBrandId: (id: string | null) => void;
}
const mockWrites: (string | null)[] = [];
const mockReadable = new Set<string>();
const mockCacheListeners = new Set<() => void>();

jest.mock("../../store/currentBrandStore", () => {
  const { create } = require("zustand") as typeof import("zustand");
  const store = create<MockStore>((set) => ({
    currentBrandId: null,
    hasHydrated: true,
    setCurrentBrandId: (id) => {
      mockWrites.push(id);
      set({ currentBrandId: id });
    },
  }));
  return { useCurrentBrandStore: store };
});
jest.mock("../brandCache", () => ({
  getBrandFromCache: (id: string | null) => (id !== null && mockReadable.has(id) ? { id } : null),
}));
jest.mock("../../config/queryClient", () => ({
  queryClient: {
    getQueryCache: () => ({
      subscribe: (listener: () => void) => {
        mockCacheListeners.add(listener);
        return () => mockCacheListeners.delete(listener);
      },
    }),
  },
}));
const mockSettle = jest.fn();
// #4453 integration: the held switch moved to its own small file (the only
// part the shell loads at boot); the behaviour asserted below is unchanged.
jest.mock("../pendingBrandSwitch", () => ({
  settlePendingBrandSwitch: (pathname: string | null) => mockSettle(pathname),
}));

import { brandIdFromRoute } from "../../config/workspaceBrandRoutes";
import { useCurrentBrandStore } from "../../store/currentBrandStore";
import { useWorkspaceBrandRouteSync } from "../useWorkspaceBrandRouteSync";

const store = useCurrentBrandStore as unknown as {
  getState: () => MockStore;
  setState: (next: Partial<MockStore>) => void;
};

const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void | Promise<void>) => Promise<void>;
  create: (el: React.ReactElement) => { update: (el: React.ReactElement) => void; unmount: () => void };
};

let renders = 0;
const Shell: React.FC<{ pathname: string; params?: Record<string, string> }> = ({ pathname, params = {} }) => {
  renders += 1;
  useWorkspaceBrandRouteSync(pathname, brandIdFromRoute(pathname, params));
  return null;
};

type Tree = ReturnType<typeof TestRenderer.create>;
async function mount(pathname: string, params?: Record<string, string>): Promise<Tree> {
  let tree: Tree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<Shell pathname={pathname} params={params} />);
  });
  return tree as unknown as Tree;
}
const go = async (tree: Tree, pathname: string, params?: Record<string, string>): Promise<void> =>
  TestRenderer.act(async () => {
    tree.update(<Shell pathname={pathname} params={params} />);
  });
const cacheChanged = async (): Promise<void> =>
  TestRenderer.act(async () => {
    for (const listener of [...mockCacheListeners]) listener();
  });

beforeEach(() => {
  mockWrites.length = 0;
  mockReadable.clear();
  mockCacheListeners.clear();
  mockSettle.mockClear();
  renders = 0;
  store.setState({ currentBrandId: null, hasHydrated: true });
});

describe("#4453 the route's brand becomes the current brand", () => {
  test("the bug: Lantern Room is current, the screen is Gameland's website", async () => {
    mockReadable.add(GAMELAND);
    store.setState({ currentBrandId: LANTERN });
    const tree = await mount(`/brand/${GAMELAND}/website`);
    expect(store.getState().currentBrandId).toBe(GAMELAND);
    expect(mockWrites).toEqual([GAMELAND]);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("one write, however often the shell renders or the sub-route changes", async () => {
    mockReadable.add(GAMELAND);
    store.setState({ currentBrandId: LANTERN });
    const tree = await mount(`/brand/${GAMELAND}/website`);
    await go(tree, `/brand/${GAMELAND}/website/pages`);
    await go(tree, `/brand/${GAMELAND}/website/design`);
    await go(tree, `/brand/${GAMELAND}/team`);
    await cacheChanged();
    expect(mockWrites).toEqual([GAMELAND]);
    // Bounded renders: the sync never re-renders the shell in a loop.
    expect(renders).toBeLessThan(12);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("already current: nothing is written", async () => {
    mockReadable.add(GAMELAND);
    store.setState({ currentBrandId: GAMELAND });
    const tree = await mount(`/brand/${GAMELAND}/website`);
    expect(mockWrites).toEqual([]);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("a brand carried in the query counts too", async () => {
    mockReadable.add(GAMELAND);
    store.setState({ currentBrandId: LANTERN });
    const tree = await mount("/ari", { brandId: GAMELAND, sitesIntent: "edit" });
    expect(store.getState().currentBrandId).toBe(GAMELAND);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("moving from one brand's screen to another's follows the route each time", async () => {
    mockReadable.add(GAMELAND);
    mockReadable.add(LANTERN);
    const tree = await mount(`/brand/${GAMELAND}/website`);
    await go(tree, `/brand/${LANTERN}/website`);
    await go(tree, "/home");
    await go(tree, `/brand/${GAMELAND}/website`);
    expect(mockWrites).toEqual([GAMELAND, LANTERN, GAMELAND]);
    await TestRenderer.act(async () => tree.unmount());
  });
});

describe("#4453 no loops, no fights", () => {
  test("does not fight a cleared pointer (the brand was deleted from its own screen)", async () => {
    mockReadable.add(GAMELAND);
    store.setState({ currentBrandId: LANTERN });
    const tree = await mount(`/brand/${GAMELAND}/edit`);
    expect(mockWrites).toEqual([GAMELAND]);
    // BrandEdit deletes the brand: the pointer is cleared while the route is
    // still /brand/<id>/edit. The sync must leave it cleared.
    await TestRenderer.act(async () => store.getState().setCurrentBrandId(null));
    await go(tree, `/brand/${GAMELAND}/edit`);
    await cacheChanged();
    expect(store.getState().currentBrandId).toBeNull();
    expect(mockWrites).toEqual([GAMELAND, null]);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("does not pull the brand back while a switch is leaving this screen", async () => {
    mockReadable.add(GAMELAND);
    mockReadable.add(LANTERN);
    const tree = await mount(`/brand/${GAMELAND}/website`);
    // The switcher applied Lantern Room a beat before the route moved.
    await TestRenderer.act(async () => store.getState().setCurrentBrandId(LANTERN));
    expect(store.getState().currentBrandId).toBe(LANTERN);
    await go(tree, `/brand/${LANTERN}/website`);
    expect(store.getState().currentBrandId).toBe(LANTERN);
    expect(mockWrites).toEqual([GAMELAND, LANTERN]);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("waits for the persisted store to rehydrate (an earlier write would be overwritten)", async () => {
    mockReadable.add(GAMELAND);
    store.setState({ currentBrandId: null, hasHydrated: false });
    const tree = await mount(`/brand/${GAMELAND}/website`);
    expect(mockWrites).toEqual([]);
    // Rehydration lands with the old pointer.
    await TestRenderer.act(async () => store.setState({ currentBrandId: LANTERN, hasHydrated: true }));
    expect(mockWrites).toEqual([GAMELAND]);
    expect(store.getState().currentBrandId).toBe(GAMELAND);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("waits until the brand can be read, then syncs once", async () => {
    store.setState({ currentBrandId: LANTERN });
    const tree = await mount(`/brand/${GAMELAND}/website`);
    expect(mockWrites).toEqual([]);
    expect(mockCacheListeners.size).toBe(1);
    await cacheChanged(); // unrelated cache traffic: still not readable
    expect(mockWrites).toEqual([]);
    mockReadable.add(GAMELAND); // the brand list arrives
    await cacheChanged();
    expect(mockWrites).toEqual([GAMELAND]);
    // Nothing left listening once it has synced.
    expect(mockCacheListeners.size).toBe(0);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("never selects a brand the person cannot read", async () => {
    store.setState({ currentBrandId: LANTERN });
    const tree = await mount("/brand/someone-elses-brand/website");
    await cacheChanged();
    await cacheChanged();
    expect(mockWrites).toEqual([]);
    expect(store.getState().currentBrandId).toBe(LANTERN);
    await TestRenderer.act(async () => tree.unmount());
    expect(mockCacheListeners.size).toBe(0);
  });

  test.each(["/home", "/marketing/campaigns", "/brand/new", "/reserve/brand-gameland", "/b/gameland-lagos"])(
    "%s names no brand: the current brand is left alone",
    async (pathname) => {
      mockReadable.add(GAMELAND);
      store.setState({ currentBrandId: LANTERN });
      const tree = await mount(pathname, { brandId: GAMELAND });
      expect(mockWrites).toEqual([]);
      await TestRenderer.act(async () => tree.unmount());
    },
  );

  test("each pathname change settles a switch that was waiting for it", async () => {
    const tree = await mount("/marketing/campaigns/cmp_1");
    await go(tree, "/marketing/campaigns");
    expect(mockSettle.mock.calls.map((call) => call[0])).toEqual([
      "/marketing/campaigns/cmp_1",
      "/marketing/campaigns",
    ]);
    await TestRenderer.act(async () => tree.unmount());
  });
});
