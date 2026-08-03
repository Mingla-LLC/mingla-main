import { acquireVenueForSubmission } from "../venueSubmissionResume";

describe("Issue #1467 single-row venue submission resume", () => {
  it("remembers the first create and reuses it after a downstream failure", async () => {
    let rememberedVenueId: string | null = null;
    let creates = 0;
    const createVenue = async (): Promise<string> => {
      creates += 1;
      return "venue-a";
    };

    const first = await acquireVenueForSubmission(
      { brandId: "brand-a", rememberedVenueId },
      {
        fetchVenue: async () => null,
        createVenue,
        rememberVenue: (id) => {
          rememberedVenueId = id;
        },
      },
    );
    expect(first).toEqual({
      venueId: "venue-a",
      placePoolId: null,
      resumed: false,
    });

    // Simulate Tier 1 failing after create. The draft keeps rememberedVenueId.
    const retry = await acquireVenueForSubmission(
      { brandId: "brand-a", rememberedVenueId },
      {
        fetchVenue: async () => ({
          id: "venue-a",
          brandId: "brand-a",
          placePoolId: null,
          claimStatus: "pending_review",
        }),
        createVenue,
        rememberVenue: () => undefined,
      },
    );
    expect(retry).toEqual({
      venueId: "venue-a",
      placePoolId: null,
      resumed: true,
    });
    expect(creates).toBe(1);
  });

  it("skips Tier 1 when the remembered row already has its place identity", async () => {
    const result = await acquireVenueForSubmission(
      { brandId: "brand-a", rememberedVenueId: "venue-a" },
      {
        fetchVenue: async () => ({
          id: "venue-a",
          brandId: "brand-a",
          placePoolId: "place-a",
          claimStatus: "pending_review",
        }),
        createVenue: async () => {
          throw new Error("must not create");
        },
        rememberVenue: () => undefined,
      },
    );
    expect(result.placePoolId).toBe("place-a");
    expect(result.resumed).toBe(true);
  });

  it.each([
    ["missing", null],
    [
      "cross-brand",
      {
        id: "venue-a",
        brandId: "brand-b",
        placePoolId: null,
        claimStatus: "pending_review",
      },
    ],
    [
      "not pending",
      {
        id: "venue-a",
        brandId: "brand-a",
        placePoolId: null,
        claimStatus: "verified",
      },
    ],
  ])("fails closed for a %s remembered row", async (_label, venue) => {
    await expect(
      acquireVenueForSubmission(
        { brandId: "brand-a", rememberedVenueId: "venue-a" },
        {
          fetchVenue: async () => venue,
          createVenue: async () => "duplicate",
          rememberVenue: () => undefined,
        },
      ),
    ).rejects.toThrow("safely resume");
  });
});
