import fs from "node:fs";
import path from "node:path";
import React from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import type { Menu } from "../../services/menusService";
import {
  applyOptimisticMenuItemOrder,
  classifyMenuItemReorderError,
  createAdjacentMenuItemReorderIntent,
  installCanonicalMenuItemOrder,
  menuItemRelationshipIsApplied,
  MenuItemReorderError,
  parseCanonicalMenuItemOrder,
  rebuildMenuItemReorderIntent,
  type CanonicalMenuItemOrder,
  type MenuItemReorderIntent,
} from "../menuItemReorder";
import { menuKeys, useReorderMenuItems } from "../useMenus";

jest.mock("../../services/supabase", () => ({
  supabase: { rpc: jest.fn() },
}));

const mockRpc = (
  jest.requireMock("../../services/supabase") as {
    supabase: {
      rpc: jest.Mock<
        Promise<{
          data: unknown;
          error: { code: string; message: string } | null;
        }>,
        unknown[]
      >;
    };
  }
).supabase.rpc;
const TestRenderer = jest.requireActual("react-test-renderer") as {
  create: (node: React.ReactElement) => {
    update: (node: React.ReactElement) => void;
    unmount: () => void;
  };
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};

const repoRoot = path.resolve(__dirname, "../../..");
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const item = (id: string, menuId: string, sortOrder: number) => ({
  id,
  menuId,
  brandId: "brand-a",
  name: id.toUpperCase(),
  description: null,
  priceCents: 100,
  currency: "USD",
  isAvailable: true,
  sortOrder,
  allowsNotes: false,
  prepStation: null,
  costCents: null,
});

const menu = (id: string, ids: string[]): Menu => ({
  id,
  brandId: "brand-a",
  venueId: "venue-a",
  name: id,
  description: null,
  sortOrder: 0,
  isActive: true,
  serviceWindowStart: null,
  serviceWindowEnd: null,
  serviceDays: null,
  items: ids.map((idValue, index) => item(idValue, id, index)),
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const canonicalFor = (intent: MenuItemReorderIntent) => ({
  brand_id: intent.brandId,
  venue_id: intent.venueId,
  menu_id: intent.menuId,
  items: intent.orderedItemIds.map((id, sortOrder) => ({ id, sort_order: sortOrder })),
});

const makeIntent = (
  menus: readonly Menu[],
  operationId: string,
  movedIndex: number,
  direction: "up" | "down",
): MenuItemReorderIntent => {
  const intent = createAdjacentMenuItemReorderIntent({
    operationId,
    brandId: "brand-a",
    venueId: "venue-a",
    menu: menus[0]!,
    movedIndex,
    direction,
  });
  if (intent === null) throw new Error("intent missing");
  return intent;
};

const mountReorderHook = (): {
  client: QueryClient;
  getReorder: () => ReturnType<typeof useReorderMenuItems>;
  updateScope: (brandId: string, venueId: string) => void;
  unmount: () => void;
} => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  let reorder: ReturnType<typeof useReorderMenuItems> | undefined;
  function Probe(props: { brandId: string; venueId: string }): null {
    reorder = useReorderMenuItems(props.brandId, props.venueId);
    return null;
  }
  const node = (brandId: string, venueId: string): React.ReactElement =>
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(Probe, { brandId, venueId }),
    );
  let tree: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    tree = TestRenderer.create(node("brand-a", "venue-a"));
  });
  return {
    client,
    getReorder: () => {
      if (reorder === undefined) throw new Error("hook missing");
      return reorder;
    },
    updateScope: (brandId, venueId) => {
      TestRenderer.act(() => tree.update(node(brandId, venueId)));
    },
    unmount: () => {
      TestRenderer.act(() => tree.unmount());
    },
  };
};

const rejectQuietly = async <T,>(promise: Promise<T>): Promise<unknown> => {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
};

describe("#3564 atomic menu-item reorder hook", () => {
  test("adjacent intent optimistically replaces only the complete target menu", () => {
    const menus = [menu("dinner", ["a", "b", "c"]), menu("drinks", ["x"])];
    const intent = createAdjacentMenuItemReorderIntent({
      operationId: "op-1",
      brandId: "brand-a",
      venueId: "venue-a",
      menu: menus[0],
      movedIndex: 1,
      direction: "up",
    });
    expect(intent).not.toBeNull();
    if (intent === null) return;
    expect(intent.expectedItems).toEqual([
      { id: "a", sortOrder: 0 },
      { id: "b", sortOrder: 1 },
      { id: "c", sortOrder: 2 },
    ]);
    expect(intent.orderedItemIds).toEqual(["b", "a", "c"]);

    const optimistic = applyOptimisticMenuItemOrder(menus, intent);
    expect(optimistic?.[0]?.items.map(({ id, sortOrder }) => [id, sortOrder]))
      .toEqual([
        ["b", 0],
        ["a", 1],
        ["c", 2],
      ]);
    expect(optimistic?.[1]).toBe(menus[1]);

    const canonical = parseCanonicalMenuItemOrder(
      {
        brand_id: "brand-a",
        venue_id: "venue-a",
        menu_id: "dinner",
        items: [
          { id: "b", sort_order: 0 },
          { id: "a", sort_order: 1 },
          { id: "c", sort_order: 2 },
        ],
      },
      intent,
    );
    expect(canonical).not.toBeNull();
    expect(installCanonicalMenuItemOrder(menus, canonical!)).toEqual(
      optimistic,
    );
  });

  test("retry preserves moved-plus-anchor intent against the latest list", () => {
    const original = menu("dinner", ["a", "b", "c"]);
    const intent = createAdjacentMenuItemReorderIntent({
      operationId: "op-1",
      brandId: "brand-a",
      venueId: "venue-a",
      menu: original,
      movedIndex: 1,
      direction: "up",
    });
    if (intent === null) throw new Error("intent missing");
    const concurrent = menu("dinner", ["c", "a", "new", "b"]);
    const retry = rebuildMenuItemReorderIntent([concurrent], intent, "op-2");
    expect(retry?.orderedItemIds).toEqual(["c", "b", "a", "new"]);
    expect(retry?.operationId).toBe("op-2");
    expect(menuItemRelationshipIsApplied([concurrent], intent)).toBe(false);
    expect(
      menuItemRelationshipIsApplied(
        applyOptimisticMenuItemOrder([concurrent], retry!),
        retry!,
      ),
    ).toBe(true);
  });

  test("transport failures expose only typed safe categories", () => {
    expect(classifyMenuItemReorderError({ code: "42501", message: "secret" }))
      .toMatchObject({ category: "permission", code: "42501" });
    expect(classifyMenuItemReorderError({ code: "40001", message: "secret" }))
      .toMatchObject({ category: "conflict", code: "40001" });
    expect(classifyMenuItemReorderError({ message: "Failed to fetch" }))
      .toMatchObject({ category: "uncertain" });
  });

  test("failed active-query confirmation rejects, restores a healthy snapshot, and stays uncertain", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const authoringKey = menuKeys.brandMenus("brand-a", "venue-a");
    const snapshot = [menu("dinner", ["a", "b", "c"])];
    const confirmationFetch = jest.fn(async (): Promise<Menu[]> => {
      throw new Error("confirmation failed");
    });
    queryClient.setQueryData(authoringKey, snapshot);

    let reorder: ReturnType<typeof useReorderMenuItems> | undefined;
    function Probe(): null {
      useQuery({
        queryKey: authoringKey,
        queryFn: confirmationFetch,
        staleTime: Infinity,
        retry: false,
      });
      reorder = useReorderMenuItems("brand-a", "venue-a");
      return null;
    }

    let tree: { unmount: () => void } | undefined;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(Probe),
        ),
      );
      await Promise.resolve();
    });
    const intent = createAdjacentMenuItemReorderIntent({
      operationId: "op-confirmation-failed",
      brandId: "brand-a",
      venueId: "venue-a",
      menu: snapshot[0],
      movedIndex: 1,
      direction: "up",
    });
    if (intent === null || reorder === undefined) {
      throw new Error("hook setup failed");
    }
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "40001", message: "conflict" },
    });
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let rejected: unknown;

    await TestRenderer.act(async () => {
      try {
        await reorder?.mutateAsync(intent);
      } catch (error) {
        rejected = error;
      }
    });

    expect(confirmationFetch).toHaveBeenCalledTimes(1);
    expect(rejected).toBeInstanceOf(MenuItemReorderError);
    expect(rejected).toMatchObject({
      category: "uncertain",
      code: "confirmation_failed",
      retryable: true,
      resolvedAsSuccess: false,
      authoritativeMenus: undefined,
    });
    expect(queryClient.getQueryData(authoringKey)).toEqual(snapshot);
    expect(queryClient.getQueryState(authoringKey)).toMatchObject({
      status: "success",
      error: null,
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[reorder_menu_items] confirmation failed",
      expect.objectContaining({
        code: "confirmation_failed",
        category: "uncertain",
      }),
    );

    consoleError.mockRestore();
    await TestRenderer.act(async () => tree?.unmount());
    queryClient.clear();
  });

  test.each(["scope", "unmount"])(
    "late failure after %s change restores the exact old-scope snapshot",
    async (ending) => {
      const original = [menu("dinner", ["a", "b", "c", "d"])];
      const intent = makeIntent(original, "op-abandoned", 1, "down");
      const response = deferred<{
        data: null;
        error: { code: string; message: string };
      }>();
      mockRpc.mockReturnValueOnce(response.promise);
      const mounted = mountReorderHook();
      const key = menuKeys.brandMenus("brand-a", "venue-a");
      mounted.client.setQueryData(key, original);
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      let request!: Promise<CanonicalMenuItemOrder>;

      await TestRenderer.act(async () => {
        request = mounted.getReorder().mutateAsync(intent);
        await Promise.resolve();
      });
      expect(
        mounted.client
          .getQueryData<Menu[]>(key)?.[0]?.items.map(({ id }) => id),
      ).toEqual(intent.orderedItemIds);

      if (ending === "scope") mounted.updateScope("brand-b", "venue-b");
      else mounted.unmount();
      await TestRenderer.act(async () => {
        response.resolve({
          data: null,
          error: { code: "42501", message: "denied" },
        });
        await rejectQuietly(request);
      });

      expect(mounted.client.getQueryData(key)).toEqual(original);
      consoleError.mockRestore();
      if (ending === "scope") mounted.unmount();
      mounted.client.clear();
    },
  );

  test("a superseded failure cannot overwrite the newer same-key optimistic owner", async () => {
    const original = [menu("dinner", ["a", "b", "c", "d"])];
    const oldIntent = makeIntent(original, "op-old", 1, "down");
    const newIntent = makeIntent(original, "op-new", 2, "down");
    const oldResponse = deferred<{
      data: null;
      error: { code: string; message: string };
    }>();
    const newResponse = deferred<{ data: unknown; error: null }>();
    mockRpc
      .mockReturnValueOnce(oldResponse.promise)
      .mockReturnValueOnce(newResponse.promise);
    const mounted = mountReorderHook();
    const key = menuKeys.brandMenus("brand-a", "venue-a");
    mounted.client.setQueryData(key, original);
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let oldRequest!: Promise<CanonicalMenuItemOrder>;
    let newRequest!: Promise<CanonicalMenuItemOrder>;

    await TestRenderer.act(async () => {
      oldRequest = mounted.getReorder().mutateAsync(oldIntent);
      await Promise.resolve();
      newRequest = mounted.getReorder().mutateAsync(newIntent);
      await Promise.resolve();
    });
    await TestRenderer.act(async () => {
      oldResponse.resolve({
        data: null,
        error: { code: "42501", message: "stale failure" },
      });
      await rejectQuietly(oldRequest);
    });
    expect(
      mounted.client
        .getQueryData<Menu[]>(key)?.[0]?.items.map(({ id }) => id),
    ).toEqual(newIntent.orderedItemIds);

    await TestRenderer.act(async () => {
      newResponse.resolve({ data: canonicalFor(newIntent), error: null });
      await newRequest;
    });
    expect(
      mounted.client
        .getQueryData<Menu[]>(key)?.[0]?.items.map(({ id }) => id),
    ).toEqual(newIntent.orderedItemIds);
    consoleError.mockRestore();
    mounted.unmount();
    mounted.client.clear();
  });

  test("late old success preserves the newer optimistic view and becomes its rollback base", async () => {
    const original = [menu("dinner", ["a", "b", "c", "d"])];
    const oldIntent = makeIntent(original, "op-old-success", 1, "down");
    const newIntent = makeIntent(original, "op-new-failure", 2, "down");
    const oldResponse = deferred<{ data: unknown; error: null }>();
    const newResponse = deferred<{
      data: null;
      error: { code: string; message: string };
    }>();
    mockRpc
      .mockReturnValueOnce(oldResponse.promise)
      .mockReturnValueOnce(newResponse.promise);
    const mounted = mountReorderHook();
    const key = menuKeys.brandMenus("brand-a", "venue-a");
    mounted.client.setQueryData(key, original);
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let oldRequest!: Promise<CanonicalMenuItemOrder>;
    let newRequest!: Promise<CanonicalMenuItemOrder>;

    await TestRenderer.act(async () => {
      oldRequest = mounted.getReorder().mutateAsync(oldIntent);
      await Promise.resolve();
      newRequest = mounted.getReorder().mutateAsync(newIntent);
      await Promise.resolve();
    });
    await TestRenderer.act(async () => {
      oldResponse.resolve({ data: canonicalFor(oldIntent), error: null });
      await oldRequest;
    });
    expect(
      mounted.client
        .getQueryData<Menu[]>(key)?.[0]?.items.map(({ id }) => id),
    ).toEqual(newIntent.orderedItemIds);

    await TestRenderer.act(async () => {
      newResponse.resolve({
        data: null,
        error: { code: "42501", message: "new failure" },
      });
      await rejectQuietly(newRequest);
    });
    expect(
      mounted.client
        .getQueryData<Menu[]>(key)?.[0]?.items.map(({ id }) => id),
    ).toEqual(oldIntent.orderedItemIds);
    consoleError.mockRestore();
    mounted.unmount();
    mounted.client.clear();
  });

  test("writer pins RPC, rollback/stale containment, no auto retry, and lean readers", () => {
    const source = read("src/hooks/useMenus.ts");
    const start = source.indexOf("export function useReorderMenuItems");
    const end = source.indexOf("export function useReorderMenus");
    const writer = source.slice(start, end);

    expect(writer).toMatch(/\.rpc\(\s*"biz_reorder_menu_items_v1"/);
    expect(writer).not.toContain('.from("menu_items")');
    expect(writer).not.toContain(".upsert(");
    expect(writer).toContain("retry: false");
    expect(writer).toContain("snapshot");
    expect(writer).toContain("context.snapshot");
    expect(writer).toContain("activeOperationRef.current === intent.operationId");
    expect(writer).toContain("installCanonicalMenuItemOrder");
    const success = writer.slice(
      writer.indexOf("onSuccess:"),
      writer.indexOf("onError:"),
    );
    expect(success.indexOf("installCanonicalMenuItemOrder")).toBeLessThan(
      success.indexOf("invalidateQueries"),
    );
    expect(writer).toContain("menuItemRelationshipIsApplied");
    expect(writer).toContain("{ throwOnError: true }");
    expect(writer).toContain("markConfirmationFailed");
    expect(writer).toContain("orderPadKeys.forBrand");
    expect(writer).toContain("menuKeys.publicMenusRoot");
    expect(writer).toContain("publicMenuBundleKeys.all");
    expect(writer).not.toContain("venueOrderingQueryKeys");
    expect(read("src/hooks/publicMenuBundleQueryKeys.ts")).toContain(
      '["publicMenuBundle"] as const',
    );
    const workflow = read(
      "../.github/workflows/supabase-migrations-and-stripe-deno.yml",
    );
    expect(
      workflow.match(
        /issue_3564_atomic_menu_item_reorder\.implementor\.pg17\.test\.sql/g,
      ),
    ).toHaveLength(1);
  });
});
