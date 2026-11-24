/**
 * #4490 08-O5 fix 2 (O5-B2): one place that says which cached reads show a
 * menu item's count, so every action that changes stock refreshes them all
 * from the server. No second cache and no number the server did not return:
 * this only marks the reads stale.
 *
 *  - the Till's catalog (its tiles: "{n} left" / "Sold out", and what a seller
 *    may add), key venueTillKeys.catalog;
 *  - the Menu builder's stock read (useMenuStock, key
 *    ["menus", brandId, venueId, "stock"]).
 *
 * Call after: a send, a pay that sends (T8), a void (with or without put back
 * in stock), a restock or stop of tracking, a swap or refund of a sold-out
 * line, a station Sold out / Back on, and after any refusal item_sold_out (the
 * refusal means the count on screen is stale).
 */
import type { QueryClient } from "@tanstack/react-query";

import { venueTillKeys } from "./venueTillKeys";

/** True for useMenuStock's read of this venue (menuStockKey(brand, venue)). */
export function isMenuStockQuery(venueId: string): (query: { queryKey: readonly unknown[] }) => boolean {
  return (query) => {
    const key = query.queryKey;
    return key.length === 4 && key[0] === "menus" && key[2] === venueId && key[3] === "stock";
  };
}

export function refreshStockReads(queryClient: QueryClient, venueId: string | null): void {
  if (venueId === null || venueId.length === 0) return;
  void queryClient.invalidateQueries({ queryKey: venueTillKeys.catalog(venueId) });
  void queryClient.invalidateQueries({ predicate: isMenuStockQuery(venueId) });
}

/** The refusal that means the count the screen showed is stale. */
export function isSoldOutRefusal(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "item_sold_out";
}
