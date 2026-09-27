import fs from "node:fs";
import path from "node:path";

import type { Menu } from "../../services/menusService";
import {
  applyOptimisticMenuItemOrder,
  classifyMenuItemReorderError,
  createAdjacentMenuItemReorderIntent,
  installCanonicalMenuItemOrder,
  menuItemRelationshipIsApplied,
  parseCanonicalMenuItemOrder,
  rebuildMenuItemReorderIntent,
} from "../menuItemReorder";

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
