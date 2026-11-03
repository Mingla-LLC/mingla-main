// @ts-nocheck — Deno-discovered suite; app-mobile's tsc sweep has no Deno globals,
// URL imports or allowImportingTsExtensions, while the deno-2-unit lane executes it directly.
/* eslint-disable import/no-unresolved -- Deno-discovered suite; Expo ESLint does not resolve URL imports. */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { discoverLoadState, type DiscoverLoadInput } from "../discoverLoadState.ts";

const root = new URL("../../../../../", import.meta.url);
const screen = Deno.readTextFileSync(new URL("app-mobile/src/components/DiscoverScreen.tsx", root));

const base: DiscoverLoadInput = {
  anchorSet: true,
  facetsLoaded: false,
  facetsFailed: false,
  feedLoaded: false,
  feedFailed: false,
  visibleKindCount: 0,
  itemCount: 0,
};

Deno.test("#4258 cards that arrive before facets render at the top with no skeleton above them", () => {
  const state = discoverLoadState({ ...base, feedLoaded: true, itemCount: 6 });
  assertEquals(state.showSkeleton, false);
  assertEquals(state.filteredEmpty, false);
  assertEquals(state.cityEmpty, false);
});

Deno.test("#4258 the header count is pending, not 'Nothing yet', while facets load", () => {
  assertEquals(discoverLoadState({ ...base, feedLoaded: true, itemCount: 6 }).countPending, true);
  assertEquals(discoverLoadState(base).countPending, true);
  assertEquals(discoverLoadState({ ...base, facetsLoaded: true, visibleKindCount: 2 }).countPending, false);
  assertEquals(discoverLoadState({ ...base, facetsFailed: true }).countPending, false);
});

Deno.test("#4258 with nothing loaded yet the skeleton fills the body and no empty state flashes", () => {
  const state = discoverLoadState(base);
  assertEquals(state, { countPending: true, showSkeleton: true, cityEmpty: false, filteredEmpty: false });
  const facetsOnly = discoverLoadState({ ...base, facetsLoaded: true, visibleKindCount: 1 });
  assertEquals(facetsOnly.showSkeleton, true);
  assertEquals(facetsOnly.filteredEmpty, false);
});

Deno.test("#4258 an empty feed only reads 'Nothing matches' once facets prove the city has plans", () => {
  const feedEmptyFacetsPending = discoverLoadState({ ...base, feedLoaded: true });
  assertEquals(feedEmptyFacetsPending.filteredEmpty, false);
  assertEquals(feedEmptyFacetsPending.showSkeleton, true);
  const filtered = discoverLoadState({ ...base, feedLoaded: true, facetsLoaded: true, visibleKindCount: 2 });
  assertEquals(filtered.filteredEmpty, true);
  assertEquals(filtered.showSkeleton, false);
  const city = discoverLoadState({ ...base, feedLoaded: true, facetsLoaded: true });
  assertEquals(city.cityEmpty, true);
  assertEquals(city.filteredEmpty, false);
});

Deno.test("#4258 DiscoverScreen renders from the shared load state", () => {
  assert(screen.includes("{loadState.showSkeleton ? <DiscoverGridSkeleton /> : null}"));
  assert(!screen.includes("facets.isLoading || feed.isLoading ? <DiscoverGridSkeleton"));
  assert(/const countLabel = loadState\.countPending\s*\?\s*""/.test(screen));
  assert(screen.includes("const { cityEmpty, filteredEmpty } = loadState;"));
});
