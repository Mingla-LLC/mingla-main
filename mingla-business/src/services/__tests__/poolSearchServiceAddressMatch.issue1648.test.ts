/**
 * Issue #1648 — `matchPoolByAddress` client contract.
 *
 * The one thing this MUST NOT do is turn an upstream failure into `null`. The
 * caller reads `null` as "we don't hold this place" and lets the brand build a
 * new listing; if a Google outage produced that same `null`, we would create the
 * exact duplicate the endpoint exists to prevent, and we would do it silently.
 * That is #1620's bug class (a check that cannot report failure reports
 * success), so it is pinned here.
 */

import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

import { matchPoolByAddress } from "../poolSearchService";
import { supabase } from "../supabase";

const invoke = supabase.functions.invoke as jest.MockedFunction<
  typeof supabase.functions.invoke
>;

/** supabase-js types the response as a discriminated union whose error arm is a
 *  FunctionsError CLASS; hand-built literals need the cast. */
const nextResponse = (value: { data: unknown; error: unknown }): void => {
  invoke.mockResolvedValueOnce(value as never);
};

const PICK = {
  formattedAddress: "440 W Hargett St, Raleigh, North Carolina 27603",
  lat: 35.7787,
  lng: -78.6438,
};

/** The edge fn's `rowToPoolMatch` output, camelCase, as it arrives. */
const EDGE_MATCH = {
  id: "pool-row-1",
  name: "440 Nightclub",
  address: "440 W Hargett St",
  city: "Raleigh",
  country: "United States",
  lat: 35.7787,
  lng: -78.6438,
  googlePlaceId: "ChIJexample",
  primaryPhotoUrl: "https://cdn/1.jpg",
  primaryType: "night_club",
  types: ["night_club", "bar"],
  venueCategory: "play",
  openingHours: null,
  photoUrls: ["https://cdn/1.jpg", "https://cdn/2.jpg"],
  hasHours: true,
  hasPhone: true,
  hasWebsite: false,
  hasRating: true,
  photoCount: 9,
  claimState: "available",
  venueCategoryConfident: true,
};

describe("#1648 — matchPoolByAddress", () => {
  test("sends the snake_case edge contract", async () => {
    nextResponse({ data: { match: null }, error: null });
    await matchPoolByAddress(PICK);
    expect(invoke).toHaveBeenCalledWith("venue-address-pool-match", {
      body: {
        formatted_address: PICK.formattedAddress,
        lat: PICK.lat,
        lng: PICK.lng,
      },
    });
  });

  test("maps a hit onto the SAME shape the gate's card already renders", async () => {
    nextResponse({ data: { match: EDGE_MATCH }, error: null });
    const match = await matchPoolByAddress(PICK);
    expect(match).not.toBeNull();
    expect(match?.id).toBe("pool-row-1");
    expect(match?.googlePlaceId).toBe("ChIJexample");
    // Presence facts survive — they are what makes the card believable.
    expect(match?.photoCount).toBe(9);
    expect(match?.hasHours).toBe(true);
    expect(match?.hasWebsite).toBe(false);
    expect(match?.claimState).toBe("available");
    expect(match?.venueCategoryConfident).toBe(true);
  });

  test("a genuine miss is null, not an error", async () => {
    nextResponse({ data: { match: null }, error: null });
    await expect(matchPoolByAddress(PICK)).resolves.toBeNull();
  });

  test("a claimed place still arrives — blocking is front-loaded, not hidden", async () => {
    nextResponse({
      data: { match: { ...EDGE_MATCH, claimState: "claimed" } },
      error: null,
    });
    const match = await matchPoolByAddress(PICK);
    expect(match?.claimState).toBe("claimed");
  });

  // ── the load-bearing one ──────────────────────────────────────────────────
  test("an upstream outage THROWS — it is never reported as 'no match'", async () => {
    nextResponse({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: {
          json: async (): Promise<unknown> => ({ error: "resolve_unavailable" }),
        },
      },
    });
    await expect(matchPoolByAddress(PICK)).rejects.toThrow("resolve_unavailable");
  });

  test("a rate limit throws its own code so the copy can differ", async () => {
    nextResponse({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: {
          json: async (): Promise<unknown> => ({ error: "rate_limited" }),
        },
      },
    });
    await expect(matchPoolByAddress(PICK)).rejects.toThrow("rate_limited");
  });

  test("an opaque transport failure still throws rather than resolving null", async () => {
    nextResponse({
      data: null,
      error: { message: "Failed to fetch" },
    });
    await expect(matchPoolByAddress(PICK)).rejects.toThrow("Failed to fetch");
  });

  test("a 200-with-error body throws too", async () => {
    nextResponse({
      data: { error: "lookup_failed" },
      error: null,
    });
    await expect(matchPoolByAddress(PICK)).rejects.toThrow("lookup_failed");
  });
});
