/* eslint-disable import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invokeMock = jest.fn() as any;

jest.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args),
    },
  },
}));

import { searchPoolMatches } from "../poolSearchService";

describe("searchPoolMatches", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("returns empty array without calling edge fn when query too short", async () => {
    const r = await searchPoolMatches("ab");
    expect(r).toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test("maps edge function matches", async () => {
    invokeMock.mockResolvedValue({
      data: {
        matches: [
          {
            id: "pid",
            name: "Joe's Pizza",
            address: "123 Main",
            city: "NYC",
            country: "US",
            lat: 40.1,
            lng: -73.9,
            googlePlaceId: "gid",
            primaryPhotoUrl: "https://x/a.jpg",
            primaryType: "pizza_restaurant",
            types: [],
            venueCategory: "restaurant",
            openingHours: null,
            photoUrls: ["https://x/a.jpg"],
          },
        ],
      },
      error: null,
    });

    const r = await searchPoolMatches("joe");
    expect(r).toHaveLength(1);
    expect(r[0]?.googlePlaceId).toBe("gid");
    expect(invokeMock).toHaveBeenCalledWith("claim-search-pool", {
      body: { query: "joe", limit: null, fetch_all: true },
    });
  });

  test("requests the complete active match set instead of a capped top-N", async () => {
    invokeMock.mockResolvedValue({
      data: { matches: [], exhausted: true },
      error: null,
    });

    await searchPoolMatches("wine");

    const call = invokeMock.mock.calls[0]?.[1] as { body: Record<string, unknown> };
    expect(call.body.fetch_all).toBe(true);
    expect(call.body.limit).toBeNull();
  });

  test("keeps all returned matches and supports business-authored rows without google ids", async () => {
    invokeMock.mockResolvedValue({
      data: {
        matches: [
          {
            id: "pid-1",
            name: "Joe's Pizza",
            address: "123 Main",
            city: "NYC",
            country: "US",
            lat: 40.1,
            lng: -73.9,
            googlePlaceId: "gid",
            primaryPhotoUrl: null,
            primaryType: "restaurant",
            types: [],
            venueCategory: "restaurant",
            openingHours: null,
            photoUrls: [],
          },
          {
            id: "pid-2",
            name: "Joe's Wine Room",
            address: "456 Main",
            city: "NYC",
            country: "US",
            lat: 40.2,
            lng: -73.8,
            googlePlaceId: null,
            primaryPhotoUrl: null,
            primaryType: "restaurant",
            types: [],
            venueCategory: "restaurant",
            openingHours: null,
            photoUrls: [],
          },
        ],
      },
      error: null,
    });

    const r = await searchPoolMatches("joe");
    expect(r).toHaveLength(2);
    expect(r[1]?.googlePlaceId).toBeNull();
  });
});
