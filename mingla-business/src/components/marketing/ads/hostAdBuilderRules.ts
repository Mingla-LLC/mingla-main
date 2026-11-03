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

/**
 * #4238 I-4238-AD-ENDS-BY-LAST-BOOKABLE-MOMENT: an ad on a dated page runs
 * until the last moment anyone can book it, never later. The server refuses a
 * later end (ad-plan create_version); these rules default and cap it first.
 */
export type HostAdScheduleLimit = {
  /** The viewer's local calendar day of the last bookable moment (the date field's unit). */
  lastDay: string;
  /** The exact last bookable moment. */
  lastIso: string;
  /** That day in the page's own time zone, for the sentence ("Sat 6 Dec"). */
  label: string;
};

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function hostAdScheduleLimit(
  page: { last_bookable_at?: string | null } | null | undefined,
  label: (iso: string) => string | null,
): HostAdScheduleLimit | null {
  const iso = page?.last_bookable_at;
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return {
    lastDay: localDay(date),
    lastIso: date.toISOString(),
    label: label(iso) ?? localDay(date),
  };
}

/** The plain sentence for a start or end past the last bookable day, or null. */
export function hostAdScheduleError(
  startDate: string,
  endDate: string,
  limit: HostAdScheduleLimit | null,
): string | null {
  if (!limit) return null;
  if (startDate !== "" && startDate > limit.lastDay) {
    return `Your ad has to start by ${limit.label}, the last day people can book.`;
  }
  if (endDate !== "" && endDate > limit.lastDay) {
    return `Your ad can run until ${limit.label}, the last day people can book. Pick an earlier end date.`;
  }
  return null;
}

/**
 * The end the plan sends: the chosen day's end, but never past the last
 * bookable moment; the last bookable moment when no end is chosen.
 */
export function hostAdScheduleEndIso(
  endIso: string | null,
  limit: HostAdScheduleLimit | null,
): string | null {
  if (!limit) return endIso;
  if (!endIso) return limit.lastIso;
  return Date.parse(endIso) > Date.parse(limit.lastIso) ? limit.lastIso : endIso;
}
