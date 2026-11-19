/**
 * #4453 (contract section I) — the brand of the screen you are on.
 *
 * The bug this replaces: the top bar showed the current-brand store
 * ("Lantern Room") while the screen was `/brand/<Gameland Lagos>/website`.
 * A screen that names its brand (a `brandId` prop, or the route) wins; the
 * store is only the answer on screens that follow it.
 *
 * The scoped brand is read from the React Query cache (the brand list the
 * switcher already loaded, or the detail read), never from a second fetch. It
 * is `pending` until the cache can answer, so the chip shows its calm
 * placeholder rather than another brand's name.
 */
import { useCallback, useSyncExternalStore } from "react";

import { useWorkspaceRoute } from "../components/brand/workspaceBrandContext";
import { useCurrentBrandStore } from "../store/currentBrandStore";
import type { Brand } from "../types/brand";
import { brandKeys } from "./brandKeys";
import { useCurrentBrand } from "./useCurrentBrand";

export interface WorkspaceBrand {
  /** The brand to show, or null (none yet, or still loading: see `pending`). */
  brand: Brand | null;
  /** True while a brand named by the screen has not been read yet. */
  pending: boolean;
  /** The screen names its brand (prop or route) rather than following the store. */
  scoped: boolean;
}

// The brand chip is on every screen, and most screens follow the current brand and never look
// in the cache. The app's query client (and the cache lookup built on it) is therefore reached
// only when a screen names another brand, not when this file loads: a screen that mounts the chip
// does not construct the client by importing it.
const brandCacheClient = (): typeof import("../config/queryClient").queryClient =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require("../config/queryClient") as typeof import("../config/queryClient")).queryClient;
const brandFromCache = (brandId: string | null): Brand | null =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require("./brandCache") as typeof import("./brandCache")).getBrandFromCache(brandId);

const noSubscription = (): (() => void) => () => undefined;
const subscribeToBrandCache = (onChange: () => void): (() => void) =>
  brandCacheClient().getQueryCache().subscribe(onChange);

/** Has any brand list answered yet? Then a missing brand is not "loading". */
const brandListsAnswered = (): boolean =>
  brandCacheClient()
    .getQueriesData<Brand[]>({ queryKey: brandKeys.lists() })
    .some(([, brands]) => brands !== undefined);

export function useWorkspaceBrand(brandId?: string | null): WorkspaceBrand {
  const route = useWorkspaceRoute();
  const currentBrand = useCurrentBrand();
  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
  const scopedId =
    typeof brandId === "string" && brandId.length > 0 ? brandId : route.routeBrandId;
  // Only a screen whose brand differs from the store needs the cache lookup.
  const differs =
    scopedId !== null && scopedId !== currentBrandId && scopedId !== currentBrand?.id;
  const subscribe = differs ? subscribeToBrandCache : noSubscription;
  const readBrand = useCallback(
    (): Brand | null => (differs ? brandFromCache(scopedId) : null),
    [differs, scopedId],
  );
  const readAnswered = useCallback(
    (): boolean => (differs ? brandListsAnswered() : true),
    [differs],
  );
  const cached = useSyncExternalStore(subscribe, readBrand, readBrand);
  const answered = useSyncExternalStore(subscribe, readAnswered, readAnswered);

  if (!differs) return { brand: currentBrand, pending: false, scoped: scopedId !== null };
  if (cached !== null) return { brand: cached, pending: false, scoped: true };
  // The lists answered without this brand: the person is not on its team, so
  // the screen cannot be theirs to edit. Show their own brand, not a spinner.
  if (answered) return { brand: currentBrand, pending: false, scoped: false };
  return { brand: null, pending: true, scoped: true };
}
