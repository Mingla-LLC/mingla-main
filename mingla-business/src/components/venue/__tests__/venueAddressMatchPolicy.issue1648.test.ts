/**
 * Issue #1648 — when may a picked s0 address be resolved against our directory?
 *
 * Every call here costs a Google `searchText` request and reads our pool, so the
 * gate is the whole safety story. The test that matters most is the
 * `coordinatePrecision` one: a CITY centroid must never reach a 200 m
 * location-biased text search, because the answer would be confident and wrong
 * (a same-named venue near the city centre), and a wrong identity is worse than
 * no identity — it would hand a brand somebody else's listing to claim.
 *
 * Step 0.5 fails-on-revert: relax any single arm of `addressMatchQueryKey` and
 * the matching test below goes red.
 */

import { describe, expect, test } from "@jest/globals";

import {
  ADDRESS_MATCH_MIN_LENGTH,
  addressMatchQueryKey,
  shouldQueryAddressMatch,
  shouldShowAddressMatch,
  type AddressMatchDraft,
} from "../venueAddressMatchPolicy";

/** A brand who has picked a real building from the Mapbox suggestions. */
const pickedDraft = (over: Partial<AddressMatchDraft> = {}): AddressMatchDraft => ({
  formattedAddress: "440 W Hargett St, Raleigh, North Carolina 27603, United States",
  lat: 35.7787,
  lng: -78.6438,
  coordinatePrecision: "exact",
  placePoolId: null,
  claim: null,
  ...over,
});

describe("#1648 — the lookup gate", () => {
  test("a picked building is looked up", () => {
    expect(shouldQueryAddressMatch(pickedDraft())).toBe(true);
    expect(addressMatchQueryKey(pickedDraft())).toBe(
      "35.7787|-78.6438|440 W Hargett St, Raleigh, North Carolina 27603, United States",
    );
  });

  test("free text resolved to a CITY centroid is NOT looked up", () => {
    // resolveFreeTextLocation's output: a real, valid coordinate — of the city.
    // Biasing a 200 m search on it would answer the wrong question confidently.
    expect(
      shouldQueryAddressMatch(
        pickedDraft({ coordinatePrecision: "approximate" }),
      ),
    ).toBe(false);
  });

  test("an unset precision is NOT looked up (never assume a pick)", () => {
    expect(
      shouldQueryAddressMatch(pickedDraft({ coordinatePrecision: null })),
    ).toBe(false);
    expect(
      shouldQueryAddressMatch(pickedDraft({ coordinatePrecision: undefined })),
    ).toBe(false);
  });

  test("a draft already in claim mode is never re-asked", () => {
    expect(
      shouldQueryAddressMatch(pickedDraft({ claim: { adopted: {} } })),
    ).toBe(false);
  });

  test("a draft already linked to a pool row is never re-asked", () => {
    expect(
      shouldQueryAddressMatch(pickedDraft({ placePoolId: "pool-row-1" })),
    ).toBe(false);
  });

  test("mirrors the edge function's own body validation", () => {
    expect(ADDRESS_MATCH_MIN_LENGTH).toBe(4);
    expect(shouldQueryAddressMatch(pickedDraft({ formattedAddress: "abc" }))).toBe(false);
    expect(shouldQueryAddressMatch(pickedDraft({ formattedAddress: "   " }))).toBe(false);
    expect(shouldQueryAddressMatch(pickedDraft({ lat: null }))).toBe(false);
    expect(shouldQueryAddressMatch(pickedDraft({ lng: null }))).toBe(false);
    expect(shouldQueryAddressMatch(pickedDraft({ lat: NaN }))).toBe(false);
    expect(shouldQueryAddressMatch(pickedDraft({ lat: 91 }))).toBe(false);
    expect(shouldQueryAddressMatch(pickedDraft({ lng: 181 }))).toBe(false);
    // Null island — the sentinel a failed geocode leaves behind, never a pick.
    expect(shouldQueryAddressMatch(pickedDraft({ lat: 0, lng: 0 }))).toBe(false);
  });

  test("the key changes on a re-pick and only on a re-pick", () => {
    const first = addressMatchQueryKey(pickedDraft());
    // Same place, component re-rendered — no second Google call.
    expect(addressMatchQueryKey(pickedDraft())).toBe(first);
    // A different building — new question, new call.
    expect(
      addressMatchQueryKey(pickedDraft({ formattedAddress: "2 Fanshawe St" })),
    ).not.toBe(first);
    expect(addressMatchQueryKey(pickedDraft({ lat: 35.9 }))).not.toBe(first);
  });
});

describe("#1648 — showing the match", () => {
  const match = { id: "pool-row-1" };

  test("a found match shows", () => {
    expect(shouldShowAddressMatch(match, [])).toBe(true);
    expect(shouldShowAddressMatch(match, null)).toBe(true);
    expect(shouldShowAddressMatch(match, undefined)).toBe(true);
  });

  test("no match, no card", () => {
    expect(shouldShowAddressMatch(null, [])).toBe(false);
  });

  test("a place already waved away is not asked about again", () => {
    expect(shouldShowAddressMatch(match, ["pool-row-1"])).toBe(false);
    // Dismissal is per PLACE, not per address — re-picking the same building
    // must not resurrect a card the brand already answered.
    expect(shouldShowAddressMatch(match, ["some-other-row"])).toBe(true);
  });
});
