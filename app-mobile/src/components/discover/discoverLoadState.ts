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
}

export interface DiscoverLoadState {
  /** Facets are still on their way: the header count must not claim "Nothing yet". */
  countPending: boolean;
  showSkeleton: boolean;
  cityEmpty: boolean;
  filteredEmpty: boolean;
}

export function discoverLoadState(input: DiscoverLoadInput): DiscoverLoadState {
  const facetsWaiting = input.anchorSet && !input.facetsLoaded && !input.facetsFailed;
  const feedWaiting = input.anchorSet && !input.feedLoaded && !input.feedFailed;
  const cityEmpty = input.facetsLoaded && input.visibleKindCount === 0;
  return {
    countPending: facetsWaiting,
    showSkeleton: (facetsWaiting || feedWaiting) && input.itemCount === 0,
    cityEmpty,
    filteredEmpty: !facetsWaiting && !feedWaiting && !cityEmpty && input.itemCount === 0,
  };
}
