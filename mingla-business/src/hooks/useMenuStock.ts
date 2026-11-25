/**
 * #4490 spec 08 O5 part C — the counts of a brand's tracked menu items, for
 * the Menu builder (pills and the item's Stock section). Keyed under the
 * menu read's own key, so every menu invalidation refreshes counts too.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { fetchMenuStock, type MenuStockRow } from "../services/venueStockService";
import { menuKeys } from "./useMenus";

export const menuStockKey = (brandId: string, venueId?: string | null) =>
  [...menuKeys.brandMenus(brandId, venueId), "stock"] as const;

export function useMenuStock(
  brandId: string | null,
  venueId: string | null,
  wanted: boolean,
): UseQueryResult<Map<string, MenuStockRow>> {
  const { isAuthReady } = useAuth();
  const enabled = wanted && isAuthReady && brandId !== null && brandId.length > 0;
  return useQuery<Map<string, MenuStockRow>>({
    queryKey: enabled ? menuStockKey(brandId, venueId) : (["menus", "stock", "disabled"] as const),
    enabled,
    staleTime: 15_000,
    queryFn: () => (enabled ? fetchMenuStock(brandId) : Promise.resolve(new Map())),
  });
}
