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
  createAdjacentMenuItemReorderIntent,
  rebuildMenuItemReorderIntent,
  type CanonicalMenuItemOrder,
  type MenuItemReorderIntent,
} from "../menuItemReorder";
import { menuKeys, useReorderMenuItems } from "../useMenus";
import { orderPadKeys } from "../orderPadQueryKeys";
import { publicMenuBundleKeys } from "../publicMenuBundleQueryKeys";

jest.mock("../../services/supabase", () => ({
  supabase: { rpc: jest.fn() },
}));

const mockRpc = (
  jest.requireMock("../../services/supabase") as {
    supabase: { rpc: jest.Mock };
  }
).supabase.rpc;
const renderer = jest.requireActual("react-test-renderer") as {
  create: (node: React.ReactElement) => {
    update: (node: React.ReactElement) => void;
    unmount: () => void;
  };
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};

const item = (id: string, menuId: string, sortOrder: number) => ({
  id,
  menuId,
  brandId: "brand-a",
  name: `${id} name`,
  description: `${id} description`,
  priceCents: 125 + sortOrder,
  currency: "USD",
  isAvailable: id !== "c",
  sortOrder,
  allowsNotes: id === "b",
  prepStation: id === "b" ? ("kitchen" as const) : null,
  costCents: 25 + sortOrder,
});

const menu = (
  id: string,
  ids: string[],
  brandId = "brand-a",
  venueId = "venue-a",
): Menu => ({
  id,
  brandId,
  venueId,
  name: `${id} menu`,
  description: `${id} menu description`,
  sortOrder: id === "dinner" ? 7 : 8,
  isActive: true,
  serviceWindowStart: "17:00",
  serviceWindowEnd: "23:00",
  serviceDays: [5, 6],
  items: ids.map((idValue, index) => ({
    ...item(idValue, id, index),
    brandId,
  })),
});

const snapshot = (): Menu[] => [
  menu("dinner", ["a", "b", "c", "d"]),
  menu("drinks", ["x", "y"]),
];

const makeIntent = (
  menus: readonly Menu[],
  operationId = "operation-1",
  movedIndex = 1,
  direction: "up" | "down" = "down",
): MenuItemReorderIntent => {
  const intent = createAdjacentMenuItemReorderIntent({
    operationId,
    brandId: "brand-a",
    venueId: "venue-a",
    menu: menus[0]!,
    movedIndex,
    direction,
  });
  if (intent === null) throw new Error("tester intent missing");
  return intent;
};

const canonicalFor = (intent: MenuItemReorderIntent) => ({
  brand_id: intent.brandId,
  venue_id: intent.venueId,
  menu_id: intent.menuId,
  items: intent.orderedItemIds.map((id, sortOrder) => ({ id, sort_order: sortOrder })),
});

const appliedMenus = (
  menus: readonly Menu[],
  intent: MenuItemReorderIntent,
): Menu[] =>
  menus.map((candidate) =>
    candidate.id !== intent.menuId
      ? candidate
      : {
          ...candidate,
          items: intent.orderedItemIds.map((id, sortOrder) => ({
            ...candidate.items.find((entry) => entry.id === id)!,
            sortOrder,
          })),
        },
  );

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

interface MountedHook {
  client: QueryClient;
  getReorder: () => ReturnType<typeof useReorderMenuItems>;
  updateScope: (brandId: string, venueId: string) => void;
  unmount: () => void;
}

const mountHook = (options?: {
  queryFn?: () => Promise<Menu[]>;
  initialMenus?: Menu[];
}): MountedHook => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  let reorder: ReturnType<typeof useReorderMenuItems> | undefined;
  if (options?.initialMenus !== undefined) {
    client.setQueryData(
      menuKeys.brandMenus("brand-a", "venue-a"),
      options.initialMenus,
    );
  }

  function Probe(props: { brandId: string; venueId: string }): null {
    if (options?.queryFn !== undefined) {
      // The fixture is pre-seeded and never fetches on mount. It becomes a real
      // active observer so refetchQueries exercises TanStack's actual semantics.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useQuery({
        queryKey: menuKeys.brandMenus(props.brandId, props.venueId),
        queryFn: options.queryFn,
        staleTime: Infinity,
        retry: false,
      });
    }
    reorder = useReorderMenuItems(props.brandId, props.venueId);
    return null;
  }

  const node = (brandId: string, venueId: string): React.ReactElement =>
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(Probe, { brandId, venueId }),
    );
  let tree: ReturnType<typeof renderer.create>;
  renderer.act(() => {
    tree = renderer.create(node("brand-a", "venue-a"));
  });

  return {
    client,
    getReorder: () => {
      if (reorder === undefined) throw new Error("reorder hook missing");
      return reorder;
    },
    updateScope: (brandId, venueId) => {
      renderer.act(() => tree.update(node(brandId, venueId)));
    },
    unmount: () => {
      renderer.act(() => tree.unmount());
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

beforeEach(() => {
  mockRpc.mockReset();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

describe("#3564 independent hook adversarial proof", () => {
  test("sends exact complete RPC parameters and optimistically preserves the complete query graph", async () => {
    const original = snapshot();
    const intent = makeIntent(original);
    const response = deferred<{ data: unknown; error: null }>();
    mockRpc.mockReturnValueOnce(response.promise);
    const mounted = mountHook();
    mounted.client.setQueryData(menuKeys.brandMenus("brand-a", "venue-a"), original);
    const invalidate = jest.spyOn(mounted.client, "invalidateQueries");
    let request!: Promise<CanonicalMenuItemOrder>;

    await renderer.act(async () => {
      request = mounted.getReorder().mutateAsync(intent);
      await Promise.resolve();
    });

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("biz_reorder_menu_items_v1", {
      p_brand_id: "brand-a",
      p_venue_id: "venue-a",
      p_menu_id: "dinner",
      p_expected_items: [
        { id: "a", sort_order: 0 },
        { id: "b", sort_order: 1 },
        { id: "c", sort_order: 2 },
        { id: "d", sort_order: 3 },
      ],
      p_ordered_item_ids: ["a", "c", "b", "d"],
    });
    const optimistic = mounted.client.getQueryData<Menu[]>(
      menuKeys.brandMenus("brand-a", "venue-a"),
    );
    expect(optimistic?.[0]?.items.map(({ id, sortOrder }) => [id, sortOrder]))
      .toEqual([
        ["a", 0],
        ["c", 1],
        ["b", 2],
        ["d", 3],
      ]);
    expect(optimistic?.[0]?.items.find(({ id }) => id === "b")).toMatchObject({
      description: "b description",
      priceCents: 126,
      isAvailable: true,
      allowsNotes: true,
      prepStation: "kitchen",
      costCents: 26,
    });
    expect(optimistic?.[1]).toBe(original[1]);

    await renderer.act(async () => {
      response.resolve({ data: canonicalFor(intent), error: null });
      await request;
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: menuKeys.brandMenus("brand-a", "venue-a"),
      exact: true,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: orderPadKeys.forBrand("brand-a"),
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: menuKeys.publicMenusRoot });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: publicMenuBundleKeys.all });
    mounted.unmount();
  });

  test("permission failure restores the exact complete snapshot and never retries the RPC", async () => {
    const original = snapshot();
    const intent = makeIntent(original);
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "private database detail" },
    });
    const mounted = mountHook();
    const key = menuKeys.brandMenus("brand-a", "venue-a");
    mounted.client.setQueryData(key, original);
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const error = await rejectQuietly(mounted.getReorder().mutateAsync(intent));

    expect(error).toMatchObject({
      category: "permission",
      code: "42501",
      retryable: false,
    });
    expect(mounted.client.getQueryData(key)).toEqual(original);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "[reorder_menu_items] failed",
      expect.not.objectContaining({ message: "private database detail" }),
    );
    log.mockRestore();
    mounted.unmount();
  });

  test.each([
    ["malformed response", { data: { menu_id: "wrong" }, error: null }],
    ["transport timeout", { data: null, error: { message: "Failed to fetch" } }],
  ])("%s reconciles authoritative truth and resolves the relationship only once", async (_label, rpcResult) => {
    const original = snapshot();
    const intent = makeIntent(original);
    const latest = appliedMenus(original, intent);
    const queryFn = jest.fn(async () => latest);
    mockRpc.mockResolvedValueOnce(rpcResult);
    const mounted = mountHook({ queryFn, initialMenus: original });
    const key = menuKeys.brandMenus("brand-a", "venue-a");
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const error = await rejectQuietly(mounted.getReorder().mutateAsync(intent));

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({
      category: "uncertain",
      resolvedAsSuccess: true,
      retryable: false,
      authoritativeMenus: latest,
    });
    expect(mounted.client.getQueryData(key)).toEqual(latest);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    log.mockRestore();
    mounted.unmount();
  });

  test("failed timeout confirmation restores healthy rollback state and stays honestly uncertain", async () => {
    const original = snapshot();
    const intent = makeIntent(original);
    const queryFn = jest.fn(async (): Promise<Menu[]> => {
      throw new Error("confirmation timeout");
    });
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Failed to fetch" },
    });
    const mounted = mountHook({ queryFn, initialMenus: original });
    const key = menuKeys.brandMenus("brand-a", "venue-a");
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const error = await rejectQuietly(mounted.getReorder().mutateAsync(intent));

    expect(error).toMatchObject({
      category: "uncertain",
      code: "confirmation_failed",
      retryable: true,
      resolvedAsSuccess: false,
      authoritativeMenus: undefined,
    });
    expect(mounted.client.getQueryData(key)).toEqual(original);
    expect(mounted.client.getQueryState(key)).toMatchObject({
      status: "success",
      error: null,
    });
    expect(log).toHaveBeenCalledWith(
      "[reorder_menu_items] confirmation failed",
      expect.objectContaining({
        code: "confirmation_failed",
        category: "uncertain",
      }),
    );
    log.mockRestore();
    mounted.unmount();
  });

  test("a stale earlier failure cannot roll back the newer operation", async () => {
    const original = snapshot();
    const first = makeIntent(original, "operation-old", 1, "down");
    const second = makeIntent(original, "operation-new", 2, "down");
    const firstRpc = deferred<{ data: null; error: { code: string; message: string } }>();
    const secondRpc = deferred<{ data: unknown; error: null }>();
    mockRpc.mockReturnValueOnce(firstRpc.promise).mockReturnValueOnce(secondRpc.promise);
    const mounted = mountHook();
    const key = menuKeys.brandMenus("brand-a", "venue-a");
    mounted.client.setQueryData(key, original);
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    let oldRequest!: Promise<CanonicalMenuItemOrder>;
    let newRequest!: Promise<CanonicalMenuItemOrder>;

    await renderer.act(async () => {
      oldRequest = mounted.getReorder().mutateAsync(first);
      await Promise.resolve();
      newRequest = mounted.getReorder().mutateAsync(second);
      await Promise.resolve();
    });
    await renderer.act(async () => {
      secondRpc.resolve({ data: canonicalFor(second), error: null });
      await newRequest;
    });
    await renderer.act(async () => {
      firstRpc.resolve({ data: null, error: { code: "42501", message: "old" } });
      await rejectQuietly(oldRequest);
    });

    expect(
      mounted.client
        .getQueryData<Menu[]>(key)?.[0]?.items.map(({ id }) => id),
    ).toEqual(second.orderedItemIds);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    log.mockRestore();
    mounted.unmount();
  });

  test.each(["scope", "unmount"])(
    "late failure after %s change restores the pre-mutation cache snapshot",
    async (ending) => {
      const original = snapshot();
      const intent = makeIntent(original);
      const rpc = deferred<{
        data: null;
        error: { code: string; message: string };
      }>();
      mockRpc.mockReturnValueOnce(rpc.promise);
      const mounted = mountHook();
      const key = menuKeys.brandMenus("brand-a", "venue-a");
      mounted.client.setQueryData(key, original);
      const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
      let request!: Promise<CanonicalMenuItemOrder>;
      await renderer.act(async () => {
        request = mounted.getReorder().mutateAsync(intent);
        await Promise.resolve();
      });

      if (ending === "scope") mounted.updateScope("brand-b", "venue-b");
      else mounted.unmount();
      await renderer.act(async () => {
        rpc.resolve({ data: null, error: { code: "42501", message: "denied" } });
        await rejectQuietly(request);
      });

      expect(mounted.client.getQueryData(key)).toEqual(original);
      log.mockRestore();
      if (ending === "scope") mounted.unmount();
      mounted.client.clear();
    },
  );

  test("retry intent uses latest four-item truth and refuses a missing anchor", () => {
    const original = snapshot();
    const intent = makeIntent(original, "operation-first", 1, "down");
    const inserted = menu("dinner", ["new", "a", "d", "b", "c"]);
    const retry = rebuildMenuItemReorderIntent(
      [inserted, original[1]!],
      intent,
      "operation-retry",
    );
    expect(retry).toMatchObject({
      operationId: "operation-retry",
      movedItemId: "b",
      anchorItemId: "c",
      expectedItems: [
        { id: "new", sortOrder: 0 },
        { id: "a", sortOrder: 1 },
        { id: "d", sortOrder: 2 },
        { id: "b", sortOrder: 3 },
        { id: "c", sortOrder: 4 },
      ],
      orderedItemIds: ["new", "a", "d", "c", "b"],
    });
    expect(
      rebuildMenuItemReorderIntent(
        [menu("dinner", ["new", "a", "b", "d"]), original[1]!],
        intent,
        "operation-missing-anchor",
      ),
    ).toBeNull();
  });

  test("workflow and source retain both proof lanes, atomic writer, and category isolation", () => {
    const repoRoot = path.resolve(__dirname, "../../..");
    const read = (relativePath: string): string =>
      fs.readFileSync(path.resolve(repoRoot, relativePath), "utf8");
    const hook = read("src/hooks/useMenus.ts");
    const itemWriter = hook.slice(
      hook.indexOf("export function useReorderMenuItems"),
      hook.indexOf("export function useReorderMenus"),
    );
    const categoryWriter = hook.slice(hook.indexOf("export function useReorderMenus"));
    const workflow = read("../.github/workflows/supabase-migrations-and-stripe-deno.yml");

    expect(itemWriter).toContain('.rpc(\n          "biz_reorder_menu_items_v1"');
    expect(itemWriter).toContain("{ throwOnError: true }");
    expect(itemWriter).not.toContain('.from("menu_items")');
    expect(itemWriter).toContain("retry: false");
    expect(categoryWriter).toContain('.from("menus")');
    expect(categoryWriter).not.toContain("biz_reorder_menu_items_v1");
    expect(
      workflow.match(/issue_3564_atomic_menu_item_reorder\.implementor\.pg17\.test\.sql/g),
    ).toHaveLength(1);
    expect(
      workflow.match(/issue_3564_atomic_menu_item_reorder\.tester\.adversarial\.pg17\.test\.sql/g),
    ).toHaveLength(1);
  });
});
