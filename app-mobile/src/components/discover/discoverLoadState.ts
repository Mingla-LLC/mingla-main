// #4258: one owner for which Discover body state shows while the feed (cards)
// and facets (counts, pills, filters) queries resolve independently.
// Cards render the moment the feed has them; the skeleton only fills an empty
// body; the empty states and the header count wait until their data is known.

export interface DiscoverLoadInput {
  /** A city is chosen, so both queries will run (possibly after the preferences gate). */
  anchorSet: boolean;
  facetsLoaded: boolean;
  facetsFailed: boolean;
  feedLoaded: boolean;
  feedFailed: boolean;
  visibleKindCount: number;
  itemCount: number;
  /**
   * #4490 W6 fix 2 (W6-D3): the facets on screen are the previous filters'
   * (keepPreviousData) while the new ones load, so the count is not claimed.
   */
  facetsStale?: boolean;
}

export interface DiscoverLoadState {
  /** Facets are still on their way: the header count must not claim "Nothing yet". */
  countPending: boolean;
  showSkeleton: boolean;
  cityEmpty: boolean;
  filteredEmpty: boolean;
}

export function discoverLoadState(input: DiscoverLoadInput): DiscoverLoadState {
  // #4490 W6 fix 2 (W6-D2): one body state at a time. A failed read shows the
  // error alone: no skeleton, no "nothing matches", no empty city under it.
  const failed = input.facetsFailed || input.feedFailed;
  const facetsStale = input.facetsStale === true;
  const facetsWaiting =
    input.anchorSet && ((!input.facetsLoaded && !input.facetsFailed) || facetsStale);
  const feedWaiting = input.anchorSet && !input.feedLoaded && !input.feedFailed;
  const cityEmpty = !failed && input.facetsLoaded && !facetsStale && input.visibleKindCount === 0;
  return {
    countPending: facetsWaiting,
    showSkeleton: !failed && (facetsWaiting || feedWaiting) && input.itemCount === 0,
    cityEmpty,
    filteredEmpty: !failed && !facetsWaiting && !feedWaiting && !cityEmpty && input.itemCount === 0,
  };
}

/**
 * #4490 W6 fix 2 (W6-D2): the kind pills come from the facets; a failed facets
 * read has no data, which hid every pill (the guest could not even switch
 * kind). The pills keep the last kinds this city showed until a read answers.
 */
export function discoverPillKinds<T>(
  current: T | undefined,
  last: { anchorKey: string; kinds: T } | null,
  anchorKey: string,
): T | undefined {
  if (current !== undefined) return current;
  return last !== null && last.anchorKey === anchorKey ? last.kinds : undefined;
}
