// @ts-nocheck — Deno-discovered suite; app-mobile's tsc sweep has no Deno globals,
// URL imports or allowImportingTsExtensions, while the deno-2-unit lane executes it directly.
/* eslint-disable import/no-unresolved -- Deno-discovered suite; Expo ESLint does not resolve URL imports. */
//
// #4265 — Discover paints from the city it already knows.
//
// Before: every mount kept the feed disabled until the saved-city preference
// settled (mirror, then an uncached `preferences` read, capped at 1.5 s), and
// every visit re-read that row over the network.
//
// Now: a city remembered for this user (persisted with the React Query cache)
// opens the gate at mount; preferences come from the React Query cache (network
// only when older than 60 s) and a different saved city is prefetched and then
// swapped in, never painted over an empty grid.
//
// FAILS-ON-REVERT: drop `seededAtMount` from discoverAnchorReady (or stop passing
// the seed from DiscoverScreen) → A-1/A-6 fail; go back to an unconditional
// PreferencesService.getUserPreferences read → A-7 fails; swap without the
// prefetch → A-8 fails.
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  asRememberedDiscoverCity,
  deviceCityStillValid,
  discoverAnchorReady,
  reconcileDiscoverCity,
} from "../../../utils/discoverEventsCache.ts";
import { discoverLoadState } from "../discoverLoadState.ts";

const root = new URL("../../../../../", import.meta.url);
const read = (rel: string): string => Deno.readTextFileSync(new URL(rel, root));
const dense = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\s+/g, "");

const USER = "c727d491-4884-4e72-b467-d6c124b9a8b9";
const RALEIGH = { name: "Raleigh", stateCode: "NC", countryCode: "US", lat: 35.779557, lng: -78.638148 };
const DURHAM = { name: "Durham", stateCode: "NC", countryCode: "US", lat: 35.994, lng: -78.8986 };
const prefsFor = (city) => ({
  discover_city_name: city?.name ?? null,
  discover_city_state_code: city?.stateCode ?? null,
  discover_city_country_code: city?.countryCode ?? null,
  discover_city_lat: city?.lat ?? null,
  discover_city_lng: city?.lng ?? null,
});

Deno.test("#4265 A-1 a city remembered for this user opens the feed at mount, before preferences settle", () => {
  assertEquals(discoverAnchorReady({ userId: USER, preferencesSettledFor: null, seededAtMount: true }), true);
});

Deno.test("#4265 A-2 with nothing remembered the #1637 gate still holds until preferences settle", () => {
  assertEquals(discoverAnchorReady({ userId: USER, preferencesSettledFor: null, seededAtMount: false }), false);
  assertEquals(discoverAnchorReady({ userId: USER, preferencesSettledFor: "someone-else", seededAtMount: false }), false);
  assertEquals(discoverAnchorReady({ userId: USER, preferencesSettledFor: USER, seededAtMount: false }), true);
  assertEquals(discoverAnchorReady({ userId: null, preferencesSettledFor: null, seededAtMount: false }), true);
});

Deno.test("#4265 A-3 reconcile: a matching saved city changes nothing; a different one is swapped in", () => {
  const remembered = { city: RALEIGH, source: "device" };
  assertEquals(reconcileDiscoverCity(remembered, prefsFor(RALEIGH)), { kind: "keep" });
  assertEquals(reconcileDiscoverCity(remembered, prefsFor(DURHAM)), { kind: "swap", city: DURHAM });
  assertEquals(reconcileDiscoverCity(null, prefsFor(DURHAM)), { kind: "swap", city: DURHAM });
});

Deno.test("#4265 A-4 reconcile: no saved city keeps a device city and re-resolves anything else", () => {
  assertEquals(reconcileDiscoverCity({ city: RALEIGH, source: "device" }, prefsFor(null)), { kind: "keep" });
  assertEquals(reconcileDiscoverCity({ city: RALEIGH, source: "preferences" }, prefsFor(null)), { kind: "resolve-device" });
  assertEquals(reconcileDiscoverCity({ city: RALEIGH, source: "transient" }, prefsFor(null)), { kind: "resolve-device" });
  // An unreadable row (the service returns null on failure) never moves the city.
  assertEquals(reconcileDiscoverCity({ city: RALEIGH, source: "preferences" }, null), { kind: "keep" });
  assertEquals(reconcileDiscoverCity({ city: RALEIGH, source: "preferences" }, undefined), { kind: "keep" });
});

Deno.test("#4265 A-5 a remembered GPS city is kept nearby and re-resolved after a real move", () => {
  assert(deviceCityStillValid(RALEIGH, 35.7801, -78.6390), "a few hundred metres is the same city");
  assert(!deviceCityStillValid(RALEIGH, DURHAM.lat, DURHAM.lng), "Raleigh → Durham (~30 km) must re-resolve");
  assertEquals(asRememberedDiscoverCity({ city: RALEIGH, source: "device" })?.city.name, "Raleigh");
  assertEquals(asRememberedDiscoverCity({ city: { name: "", lat: 1, lng: 2 }, source: "device" }), null);
  assertEquals(asRememberedDiscoverCity({ city: RALEIGH, source: "gps" }), null);
  assertEquals(asRememberedDiscoverCity(null), null);
});

Deno.test("#4265 A-6 DiscoverScreen seeds from the per-user remembered city and passes it to the gate", () => {
  const screen = dense(read("app-mobile/src/components/DiscoverScreen.tsx"));
  assert(screen.includes("queryClient.getQueryData(discoverLastCityKeys.forUser(user.id))"), "the seed must come from the per-user cache entry");
  assert(
    screen.includes("constpreferencesSettled=discoverAnchorReady({userId:user?.id??null,preferencesSettledFor,seededAtMount:seed!==null&&seed.userId===user?.id});"),
    "the gate must open for a seed that belongs to the signed-in user",
  );
  assert(screen.includes("constactiveAnchor=preferencesSettled?anchor:null"), "the feed still only sees the gated anchor");
  assert(!screen.includes("readLastResolvedDiscoverCity("), "the process-wide (not per-user) snapshot must not seed the screen");
  const keys = dense(read("app-mobile/src/hooks/discoverQueryKeys.ts"));
  assert(keys.includes("forUser:(userId:string)=>[...discoverLastCityKeys.all,userId]asconst"), "the remembered city is keyed by user id");
});

Deno.test("#4265 A-7 preferences come through React Query, not an uncached read on every mount", () => {
  const screen = dense(read("app-mobile/src/components/DiscoverScreen.tsx"));
  assert(!screen.includes("PreferencesService.getUserPreferences("), "the raw per-mount network read is back");
  assert(screen.includes("queryClient.getQueryData<UserPreferences|null>(userPreferencesKeys.detail(userId))"), "the cached row must be read first");
  assert(screen.includes("staleTime:forceFresh?0:USER_PREFERENCES_FRESH_MS"), "the row is re-read only when stale or after a preferences save");
  const mirror = screen.indexOf("offlineService.getOfflineUserPreferences()");
  const row = screen.indexOf("queryClient.fetchQuery({queryKey:userPreferencesKeys.detail(userId)");
  assert(mirror !== -1 && row !== -1 && mirror < row, "#1637: the mirror is still read before the row");
});

Deno.test("#4265 A-8 a reconciled city is prefetched before it replaces painted cards", () => {
  const screen = dense(read("app-mobile/src/components/DiscoverScreen.tsx"));
  const swap = screen.slice(screen.indexOf("constswapToCity=useCallback("), screen.indexOf("},[queryClient,rememberCity]);", screen.indexOf("constswapToCity=useCallback(")));
  assert(swap.includes('if(paintedAnchorKeyRef.current==="none"){setCity(next);'), "nothing painted yet: switch at once");
  const prefetch = swap.indexOf("queryClient.prefetchInfiniteQuery(discoverFeedQueryOptions(nextKey,nextAnchor,appliedFiltersRef.current))");
  const facets = swap.indexOf("queryClient.prefetchQuery(discoverFacetsQueryOptions(nextKey,nextAnchor,facetFiltersRef.current))");
  const commit = swap.lastIndexOf("setCity(next);");
  assert(prefetch !== -1 && facets !== -1, "both the feed and the counts must be prefetched");
  assert(commit > prefetch && commit > facets, "the city must change only after the prefetch");
  // With the new key already cached, #4258's load state shows cards and no skeleton.
  const state = discoverLoadState({ anchorSet: true, facetsLoaded: true, facetsFailed: false, feedLoaded: true, feedFailed: false, visibleKindCount: 2, itemCount: 12 });
  assertEquals(state.showSkeleton, false);
  assertEquals(state.countPending, false);
});

Deno.test("#4265 A-9 the picked city reaches the cached row and the offline mirror", () => {
  const screen = dense(read("app-mobile/src/components/DiscoverScreen.tsx"));
  assert(screen.includes("queryClient.setQueryData<UserPreferences|null>(userPreferencesKeys.detail(user.id),(previous)=>(previous?{...previous,...patch}:previous))"));
  assert(screen.includes("offlineService.cacheUserPreferences({...base,...patch})"));
});

Deno.test("#4265 A-10 tapping the nearest city saves it like a picker pick", () => {
  const screen = dense(read("app-mobile/src/components/DiscoverScreen.tsx"));
  assert(screen.includes("onNearest={onNearestCity}"), "the empty state's Nearest city runs the saving handler");
  const start = screen.indexOf("constonNearestCity=useCallback(");
  assert(start !== -1, "onNearestCity exists");
  const body = screen.slice(start, screen.indexOf("consttoggleCityWatch=", start));
  assert(body.includes("PreferencesService.updateUserPreferences(user.id,{discover_city_name:next.name,discover_city_state_code:next.stateCode,discover_city_country_code:next.countryCode,discover_city_lat:next.lat,discover_city_lng:next.lng,})"),
    "the nearest city is written to the preferences row, the same fields the picker writes");
  assert(body.includes("if(swapTokenRef.current!==token)return;onCityPicked(next);"),
    "once saved it is mirrored into the cached row and remembered (unless another pick won meanwhile)");
  assert(body.includes(".catch((error:unknown)=>{console.warn("), "a failed save is logged, not swallowed");
  const picker = dense(read("app-mobile/src/components/discover/CityPickerSheet.tsx"));
  assert(picker.includes("awaitPreferencesService.updateUserPreferences(userId,{discover_city_name:details.city,"), "same service as the picker");
});
