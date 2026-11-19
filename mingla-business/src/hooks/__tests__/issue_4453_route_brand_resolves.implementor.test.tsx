/**
 * #4453 (contract section I: "the chip names the brand being edited from
 * first paint; never blank or wrong") — a chip outside the switcher (Ari's,
 * on `/ari?brandId=<brand>`) shows the loading placeholder while the route's
 * brand is not readable yet. That is right while a read is under way, but it
 * could stay for good: "has a brand list answered?" only counted a list that
 * loaded, so with no current brand, nothing cached and a brand list read that
 * FAILED, the chip (and the top bar's) never left its placeholder.
 *
 * WHAT RUNS: the real useRouteBrand (what the shell hands a bare chip),
 * the real useWorkspaceBrand (what the switcher's chip uses), the real
 * BrandChip for both, the real brand cache lookup, on a real QueryClient.
 *
 * FAILS-ON-REVERT: count only lists with data again in `brandListsAnswered`
 * and "a brand list read that failed" stays "Brand: loading" on both chips.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/hooks/__tests__/issue_4453_route_brand_resolves.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GAMELAND = { id: "brand-gameland", displayName: "Gameland Lagos" };
const LANTERN = { id: "brand-lantern", displayName: "Lantern Room" };
let mockStoreBrandId: string | null = null;

jest.mock("../../config/queryClient", () => {
  const { QueryClient } = jest.requireActual("@tanstack/react-query") as typeof import("@tanstack/react-query");
  return { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }) };
});
jest.mock("../useCurrentBrand", () => ({
  useCurrentBrand: () => (mockStoreBrandId === "brand-lantern" ? { id: "brand-lantern", displayName: "Lantern Room" } : null),
}));
jest.mock("../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (sel: (s: { currentBrandId: string | null; hasHydrated: boolean }) => unknown) =>
    sel({ currentBrandId: mockStoreBrandId, hasHydrated: true }),
}));
jest.mock("../../components/brand/BrandMark", () => ({ BrandMark: () => null }));
jest.mock("../../components/ui/Icon", () => ({ Icon: () => null }));

import { queryClient } from "../../config/queryClient";
import { BrandChip } from "../../components/ui/BrandChip";
import { WorkspaceRouteContext } from "../../components/ui/hostShellContext";
import { brandKeys } from "../brandKeys";
import { useRouteBrand, useWorkspaceBrand } from "../useWorkspaceBrand";

interface Node { type: unknown; props: Record<string, unknown> }
type Tree = { root: { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void | Promise<void>) => Promise<void>;
  create: (el: React.ReactElement) => Tree;
};

/** Ari's bar: a bare chip, handed the route's brand by the shell. */
const AriChip = ({ routeBrandId }: { routeBrandId: string }): React.ReactElement => {
  const routeBrand = useRouteBrand(routeBrandId);
  return <BrandChip brand={routeBrand?.brand} brandLoading={routeBrand?.pending} fullNameLabel testID="ari-brand-chip" />;
};
/** The top bar: the switcher's chip. */
const TopBarChip = (): React.ReactElement => {
  const workspace = useWorkspaceBrand();
  return <BrandChip brand={workspace.brand} brandLoading={workspace.pending} testID="top-bar-chip" />;
};

async function mount(): Promise<Tree> {
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <WorkspaceRouteContext.Provider value={{ pathname: "/ari", params: { brandId: GAMELAND.id }, routeBrandId: GAMELAND.id }}>
        <AriChip routeBrandId={GAMELAND.id} />
        <TopBarChip />
      </WorkspaceRouteContext.Provider>,
    );
  });
  return tree;
}
const labels = (tree: Tree): string[] =>
  tree.root
    .findAll((n) => typeof n.type === "string" && typeof n.props.accessibilityLabel === "string" &&
      (n.props.accessibilityLabel as string).startsWith("Brand: "))
    .map((n) => n.props.accessibilityLabel as string);
const listKey = brandKeys.list("user-1");
const failTheList = async (): Promise<void> =>
  TestRenderer.act(async () => {
    await queryClient
      .fetchQuery({ queryKey: listKey, queryFn: () => Promise.reject(new Error("offline")) })
      .catch(() => undefined);
  });

beforeEach(() => {
  queryClient.clear();
  mockStoreBrandId = null;
});

describe("#4453 a chip outside the switcher resolves, and matches the top bar", () => {
  test("no current brand, nothing cached, the list still loading: both chips wait", async () => {
    const tree = await mount();
    expect(labels(tree)).toEqual(["Brand: loading", "Brand: loading"]);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("the list answers with the brand: both chips name it", async () => {
    const tree = await mount();
    await TestRenderer.act(async () => {
      queryClient.setQueryData(listKey, [GAMELAND, LANTERN]);
    });
    expect(labels(tree)).toEqual(["Brand: Gameland Lagos. Switch brand", "Brand: Gameland Lagos. Switch brand"]);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("the list answers without the brand: both chips follow the current brand, not a spinner", async () => {
    mockStoreBrandId = LANTERN.id;
    const tree = await mount();
    expect(labels(tree)).toEqual(["Brand: loading", "Brand: loading"]);
    await TestRenderer.act(async () => {
      queryClient.setQueryData(listKey, [LANTERN]);
    });
    expect(labels(tree)).toEqual(["Brand: Lantern Room. Switch brand", "Brand: Lantern Room. Switch brand"]);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("a brand list read that failed: neither chip stays on its placeholder for ever", async () => {
    const tree = await mount();
    expect(labels(tree)).toEqual(["Brand: loading", "Brand: loading"]);
    await failTheList();
    expect(queryClient.getQueryState(listKey)?.status).toBe("error");
    // Resolved, and the same on both: with no current brand there is none to name.
    const settled = labels(tree);
    expect(settled).toHaveLength(2);
    expect(settled[0]).toBe(settled[1]);
    expect(settled[0]).not.toBe("Brand: loading");
    expect(settled[0]).toBe("Brand: Create brand");

    // A later read that works is seen: both chips name the route's brand.
    await TestRenderer.act(async () => {
      queryClient.setQueryData(listKey, [GAMELAND]);
    });
    expect(labels(tree)).toEqual(["Brand: Gameland Lagos. Switch brand", "Brand: Gameland Lagos. Switch brand"]);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("a failed list with a current brand: both chips follow it, as when the list answers without the brand", async () => {
    mockStoreBrandId = LANTERN.id;
    const tree = await mount();
    await failTheList();
    expect(labels(tree)).toEqual(["Brand: Lantern Room. Switch brand", "Brand: Lantern Room. Switch brand"]);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("the brand's own record in the cache is enough, whatever the lists did", async () => {
    const tree = await mount();
    await TestRenderer.act(async () => {
      queryClient.setQueryData(brandKeys.detail(GAMELAND.id), GAMELAND);
    });
    expect(labels(tree)).toEqual(["Brand: Gameland Lagos. Switch brand", "Brand: Gameland Lagos. Switch brand"]);
    await TestRenderer.act(async () => tree.unmount());
  });
});
