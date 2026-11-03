/**
 * #4238 — small pure rules the Host ads builder shares across its load paths.
 */

/**
 * The platforms a draft starts with. One rule for a fresh ad, a restored
 * draft and a draft that was not found: when nothing was saved, tick every
 * available platform; otherwise keep exactly the saved ones that are still
 * available.
 */
export function initialHostAdConnections<C extends { id: string }>(
  available: readonly C[],
  savedIds: unknown,
): C[] {
  const ids = Array.isArray(savedIds)
    ? savedIds.filter((id): id is string => typeof id === "string")
    : [];
  if (ids.length === 0) return [...available];
  const wanted = new Set(ids);
  const kept = available.filter((item) => wanted.has(item.id));
  return kept.length > 0 ? kept : [...available];
}

/** "Matched on all platforms" only when at least one platform is ticked. */
export function hostAdMatchSubtitle(
  missingNames: string,
  missingCount: number,
  selectedCount: number,
): string {
  if (selectedCount === 0) return "Turn on at least one app to check this";
  return missingCount === 0
    ? "Matched on all platforms"
    : `Not found on ${missingNames}: remove it or turn those platforms off`;
}

/** Height of the floating marketing action button plus a gap above it. */
export const HOST_AD_FLOATING_ACTION_CLEARANCE = 72;

/**
 * #4238: bottom padding for an ad screen's scroll content, so its last
 * buttons clear the floating bottom nav (the sticky-footer offset) and the
 * floating action button on phones.
 */
export function hostAdScrollBottomPadding(stickyFooterOffset: number): number {
  return stickyFooterOffset + HOST_AD_FLOATING_ACTION_CLEARANCE;
}

/** The router calls the back link needs (expo-router's router fits). */
export type HostAdBackRouter = {
  canGoBack: () => boolean;
  back: () => void;
  replace: (href: never) => void;
};

export const HOST_ADS_LIST_HREF = "/(tabs)/marketing/ads";

/**
 * #4238: "← Ads" / "Back to Ads". After a refresh or a direct link there is
 * no history, and a bare router.back() does nothing, so go to the Ads list.
 */
export function goBackToAds(router: HostAdBackRouter): void {
  if (router.canGoBack()) router.back();
  else router.replace(HOST_ADS_LIST_HREF as never);
}
