/**
 * #4453 (contract section I) — a route that names a brand makes it current.
 *
 * `/brand/<Gameland Lagos>/website` opened while the current brand was
 * "Lantern Room" left the two disagreeing: the screen edited one brand, the
 * chrome (top bar, sidebar role gate, Blast, Home) spoke for another. Mounted
 * once in the root shell, this points the current-brand store at the route's
 * brand.
 *
 * No loops, no redirects, no history entries:
 *   - it only writes the store (never navigates);
 *   - it syncs ONCE per route brand: after that the store may move freely
 *     (a brand deleted from its own screen clears the pointer and it stays
 *     cleared) until the route names a different brand;
 *   - it waits for the persisted store to rehydrate (an earlier write would be
 *     overwritten) and for the brand to be readable in the query cache (so a
 *     brand the person is not on is never selected, which `useCurrentBrand`
 *     would clear again).
 *
 * It also settles a switch the switcher is holding until its route change
 * lands (see useWorkspaceBrandSwitch).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { queryClient } from "../config/queryClient";
import { useCurrentBrandStore } from "../store/currentBrandStore";
import { getBrandFromCache } from "./brandCache";
import { settlePendingBrandSwitch } from "./pendingBrandSwitch";

// Before paint in the browser and on native; a plain effect where there is no
// layout phase (static rendering).
const useBeforePaintEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function useWorkspaceBrandRouteSync(
  pathname: string | null,
  routeBrandId: string | null,
): void {
  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
  const hasHydrated = useCurrentBrandStore((s) => s.hasHydrated);
  const setCurrentBrandId = useCurrentBrandStore((s) => s.setCurrentBrandId);
  const syncedRef = useRef<string | null>(null);
  const [cacheTick, setCacheTick] = useState(0);

  useBeforePaintEffect(() => {
    settlePendingBrandSwitch(pathname);
  }, [pathname]);

  useBeforePaintEffect(() => {
    if (routeBrandId === null) {
      syncedRef.current = null;
      return undefined;
    }
    if (syncedRef.current === routeBrandId) return undefined;
    if (hasHydrated === false) return undefined;
    if (currentBrandId === routeBrandId) {
      syncedRef.current = routeBrandId;
      return undefined;
    }
    if (getBrandFromCache(routeBrandId) === null) {
      // Not readable yet (the brand list is still loading): look again when
      // the cache changes.
      return queryClient.getQueryCache().subscribe(() => {
        if (getBrandFromCache(routeBrandId) !== null) setCacheTick((tick) => tick + 1);
      });
    }
    syncedRef.current = routeBrandId;
    setCurrentBrandId(routeBrandId);
    return undefined;
  }, [cacheTick, currentBrandId, hasHydrated, routeBrandId, setCurrentBrandId]);
}
