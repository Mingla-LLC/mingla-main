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
      body: { query: "joe", limit: 1 },
    });
  });
});
