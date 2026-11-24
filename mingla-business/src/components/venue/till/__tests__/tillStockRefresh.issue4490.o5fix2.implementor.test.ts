/**
 * #4490 spec 08 O5 fix 2 (O5-B2): a sold-out tile cannot be added, and the one
 * stock-refresh module marks exactly the reads that show a count (the Till's
 * catalog and the Menu's useMenuStock key), so the two cannot drift apart.
 */
jest.mock("../../../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() }, from: jest.fn() } }));
jest.mock("../../../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true }) }));

import { QueryClient } from "@tanstack/react-query";

import { menuStockKey } from "../../../../hooks/useMenuStock";
import { menuKeys } from "../../../../hooks/useMenus";
import { isMenuStockQuery, isSoldOutRefusal, refreshStockReads } from "../../../../hooks/stockRefresh";
import { venueTillKeys } from "../../../../hooks/venueTillKeys";
import type { TillMenuItem } from "../../../../services/venueTillService";
import { itemSellable } from "../tillModel";

const item = (over: Partial<TillMenuItem>): TillMenuItem =>
  ({ id: "i", name: "Suya", priceMinor: 400000, orderable: true, stockLeft: null, stockWarnAt: null, modifierGroups: [], ...over }) as TillMenuItem;

describe("O5-B2 a sold-out tile cannot be added", () => {
  test("a counted item at 0 is never sellable, even if the tile still says orderable", () => {
    expect(itemSellable(item({ stockLeft: 0, orderable: true }))).toBe(false);
  });
  test("a counted item with units left, an untracked item and an unpriced item", () => {
    expect(itemSellable(item({ stockLeft: 2 }))).toBe(true);
    expect(itemSellable(item({ stockLeft: null }))).toBe(true);
    expect(itemSellable(item({ priceMinor: null }))).toBe(false);
    expect(itemSellable(item({ orderable: false }))).toBe(false);
  });
});

describe("O5-B2 the stock reads are the ones that show a count", () => {
  const VENUE = "v1";
  test("isMenuStockQuery matches useMenuStock's key for that venue only", () => {
    const match = isMenuStockQuery(VENUE);
    expect(match({ queryKey: menuStockKey("b1", VENUE) })).toBe(true);
    expect(match({ queryKey: menuStockKey("b1", "other") })).toBe(false);
    expect(match({ queryKey: menuKeys.brandMenus("b1", VENUE) })).toBe(false);
  });
  test("refreshStockReads marks the catalog and the Menu counts stale, not the checks", () => {
    const client = new QueryClient();
    client.setQueryData(venueTillKeys.catalog(VENUE), {});
    client.setQueryData(venueTillKeys.checks(VENUE), {});
    client.setQueryData(menuStockKey("b1", VENUE), new Map());
    refreshStockReads(client, VENUE);
    expect(client.getQueryState(venueTillKeys.catalog(VENUE))?.isInvalidated).toBe(true);
    expect(client.getQueryState(menuStockKey("b1", VENUE))?.isInvalidated).toBe(true);
    expect(client.getQueryState(venueTillKeys.checks(VENUE))?.isInvalidated).toBe(false);
  });
  test("only item_sold_out is the stale-count refusal", () => {
    expect(isSoldOutRefusal({ code: "item_sold_out" })).toBe(true);
    expect(isSoldOutRefusal({ code: "till_check_changed" })).toBe(false);
    expect(isSoldOutRefusal(null)).toBe(false);
  });
});
