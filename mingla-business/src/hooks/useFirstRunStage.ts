/**
 * useFirstRunStage — #4304 part 3 (First Home with Ari).
 *
 * Feeds `deriveFirstRunStage` (the one owner of the stage) from loading-safe
 * signals only:
 *   - auth + the brand list's `isFetched` and the brand pointer's hydration /
 *     recovery (the same guards `useBusinessTodos` uses for `hasNoBrands`), so
 *     a mid-hydration empty read never reads as "no brand";
 *   - the persisted first-run store, gated on its own `hasHydrated`;
 *   - "has anything been made?": a two-row existence probe over every brand
 *     the account can see (server truth, includes past and deleted items), OR
 *     a dirty/server event draft already in the local draft store (instant for
 *     the manual wizards). Venue pages and server-made offerings reach the
 *     probe: Ari's confirm invalidates it, and in State B it re-checks every
 *     15s. (No venue-listings hook here: it would pull venue services into
 *     the tabs layout's boot path, #3493.)
 *
 * Once content is seen the unlock is persisted for this account, so Home
 * never disappears again (Seth, 6 Nov 2026).
 *
 * Why client-derived and not a server flag: no migration is needed, the probe
 * is two `limit(1)` reads that only run while the account is not yet
 * unlocked, and because the probe ignores `deleted_at` it re-derives the
 * unlock after a sign-out cleared the local flag.
 */

import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { brandsHaveAnyContent } from "../services/brandFirstContentService";
import {
  useCurrentBrandHasHydrated,
  useCurrentBrandStore,
} from "../store/currentBrandStore";
import { useDraftEventStore } from "../store/draftEventStore";
import { useFirstRunStore } from "../store/firstRunStore";
import { isDraftDirty } from "../utils/draftDirtyCheck";
import {
  deriveFirstRunStage,
  stickyFirstRunStage,
  type FirstRunStage,
  type StickyLock,
} from "../utils/firstRunState";
import { firstRunKeys } from "./firstRunKeys";
import { useBrands } from "./useBrands";
import { useCurrentBrand } from "./useCurrentBrand";
import { useCurrentBrandRecovery } from "./useCurrentBrandRecovery";
import { useCurrentBrandRole } from "./useCurrentBrandRole";

export { firstRunKeys };

const DISABLED_KEY = ["firstRun", "disabled"] as const;
/** While a host sits in State B, re-check now and then for a draft made elsewhere. */
const EMPTY_BRAND_RECHECK_MS = 15_000;

export interface FirstRunStageState {
  stage: FirstRunStage;
  userId: string | null;
  /**
   * Brands are known (at least one) and only the "anything made?" answer is
   * outstanding. Home holds a neutral loader in this window so a host who is
   * about to land on Ari never sees Home flash first.
   */
  awaitingContent: boolean;
}

export function useFirstRunStage(): FirstRunStageState {
  const { user, isAuthReady } = useAuth();
  const userId = user?.id ?? null;
  const brandsQuery = useBrands(userId);
  const brands = brandsQuery.data;
  const currentBrand = useCurrentBrand();
  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
  const brandHydrated = useCurrentBrandHasHydrated();
  const recovery = useCurrentBrandRecovery();
  const role = useCurrentBrandRole(currentBrand?.id ?? null);

  const storeHydrated = useFirstRunStore((s) => s.hasHydrated);
  const homeUnlocked = useFirstRunStore((s) =>
    userId !== null ? s.unlockedUserIds[userId] === true : false,
  );
  const markUnlocked = useFirstRunStore((s) => s.markUnlocked);

  const brandIds = useMemo(
    () => (brands ?? []).map((brand) => brand.id).sort(),
    [brands],
  );
  const brandIdsKey = brandIds.join(",");
  const brandIdSet = useMemo(() => new Set(brandIds), [brandIds]);

  const probeEnabled =
    isAuthReady &&
    userId !== null &&
    storeHydrated &&
    !homeUnlocked &&
    brandsQuery.isFetched &&
    brandIds.length > 0;
  const probe = useQuery<boolean>({
    queryKey: probeEnabled
      ? firstRunKeys.content(userId as string, brandIdsKey)
      : DISABLED_KEY,
    enabled: probeEnabled,
    staleTime: 10_000,
    refetchInterval: (query) =>
      probeEnabled && query.state.data === false ? EMPTY_BRAND_RECHECK_MS : false,
    queryFn: () => brandsHaveAnyContent(brandIds),
  });

  // Local event drafts: a server draft, or a local one the host typed into.
  const localDrafts = useDraftEventStore((s) => s.drafts);
  const localDraftFound = useMemo(
    () =>
      localDrafts.some(
        (draft) =>
          brandIdSet.has(draft.brandId) &&
          (!draft.id.startsWith("d_") || isDraftDirty(draft)),
      ),
    [brandIdSet, localDrafts],
  );

  const brandResolving =
    !brandHydrated ||
    recovery.isResolving ||
    ((brands ?? []).length > 0 &&
      currentBrandId !== null &&
      currentBrand === null);

  const derivedStage = deriveFirstRunStage({
    signedIn: isAuthReady && userId !== null,
    storeHydrated,
    homeUnlocked,
    brandsFetched: brandsQuery.isFetched && brands !== undefined,
    brandCount: (brands ?? []).length,
    brandResolving,
    hasCurrentBrand: currentBrand !== null,
    roleLoading: role.isLoading,
    rank: role.rank,
    contentFound: probe.data === true || localDraftFound,
    contentKnown: probe.isFetched && probe.data !== undefined,
    contentError: probe.isError,
  });

  // A locked host stays locked through a re-resolve (State A → B: the new
  // brand's role and "anything made?" answer load). Without this the full tab
  // set would flash between the two reduced ones. Only a resolved answer, a
  // sign-out or another account moves it.
  const lastLockedRef = useRef<StickyLock | null>(null);
  const sticky = stickyFirstRunStage(lastLockedRef.current, derivedStage, userId);
  lastLockedRef.current = sticky.lock;
  const stage = sticky.stage;

  // Home appeared: remember it for this account so it never disappears.
  const contentSeen = stage === "unlocked" && !homeUnlocked;
  useEffect(() => {
    if (contentSeen && userId !== null) markUnlocked(userId);
  }, [contentSeen, markUnlocked, userId]);

  const awaitingContent =
    stage === "pending" &&
    !homeUnlocked &&
    brandsQuery.isFetched &&
    (brands ?? []).length > 0;

  return { stage, userId, awaitingContent };
}
