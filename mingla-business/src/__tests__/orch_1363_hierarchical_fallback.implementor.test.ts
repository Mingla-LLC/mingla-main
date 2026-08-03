import { describe, expect, jest, test } from "@jest/globals";
import {
  advanceLocationRequestGeneration,
  isFreeTextResolveStale,
  isLocationRequestGenerationCurrent,
  resolveFreeTextLocation,
} from "../utils/resolveApproxLocation";
import {
  departureLocationValidated,
  destinationLocationValidated,
} from "../components/trip/tripLocationValidated";

jest.mock("../services/mapboxGeocodeService", () => ({
  forwardHierarchyMapbox: jest.fn(),
}));

const hit = (
  matchLevel: "place" | "city" | "country",
  city: string | null,
  countryCode = "NG",
) => ({
  details: {
    lat: 4.8156,
    lng: 7.0498,
    city,
    region: "Rivers",
    countryCode,
  },
  matchLevel,
  matchedQuery: city ?? countryCode,
} as const);

describe("Issue #1363 hierarchy client contract", () => {
  const hierarchyCases: ["place" | "city" | "country", string | null][] = [
    ["place", "Port Harcourt"],
    ["city", "Port Harcourt"],
    ["country", null],
  ];

  test.each(hierarchyCases)("%s result remains approximate and structured", async (level, city) => {
    const forwardHierarchy = jest.fn(async () => hit(level, city));
    const result = await resolveFreeTextLocation(
      "Raw, Label!",
      { countryCode: "NG" },
      { forwardHierarchy },
    );
    expect(result).toEqual({
      status: "selected",
      location: {
        lat: 4.8156,
        lng: 7.0498,
        city,
        region: "Rivers",
        countryCode: "NG",
        precision: "approximate",
        matchLevel: level,
      },
    });
    expect(forwardHierarchy).toHaveBeenCalledWith("Raw, Label!", {
      countryCode: "NG",
    });
  });

  test("needs_context stays distinct from transport failure", async () => {
    await expect(
      resolveFreeTextLocation("nonsense", {}, {
        forwardHierarchy: async () => ({
          details: null,
          reason: "needs_context",
        }),
      }),
    ).resolves.toEqual({ status: "needs_context" });
    await expect(
      resolveFreeTextLocation("Lagos, Nigeria", {}, {
        forwardHierarchy: async () => {
          throw new Error("provider unavailable");
        },
      }),
    ).rejects.toThrow("provider unavailable");
  });

  test.each([
    [Number.NaN, 3],
    [91, 3],
    [4, 181],
    [0, 0],
  ])("rejects unsafe coordinate %s,%s", async (lat, lng) => {
    const result = await resolveFreeTextLocation("Lagos, Nigeria", {}, {
      forwardHierarchy: async () => ({
        ...hit("city", "Lagos"),
        details: { ...hit("city", "Lagos").details, lat, lng },
      }),
    });
    expect(result).toEqual({ status: "needs_context" });
  });

  test("latest-wins is raw-label exact, including whitespace and punctuation", () => {
    expect(isFreeTextResolveStale("Lagos", "Lagos")).toBe(false);
    expect(isFreeTextResolveStale("Lagos", " Lagos")).toBe(true);
    expect(isFreeTextResolveStale("Lagos", "Lagos!")).toBe(true);
  });

  test("trip authoring accepts hierarchy coordinates without a provider placeId", () => {
    expect(destinationLocationValidated("Lagos", null, 6.455, 3.384)).toBe(true);
    expect(departureLocationValidated("Abuja", null, 9.076, 7.399)).toBe(true);
  });

  test("X and a later same-label commit invalidate a delayed free-text completion", async () => {
    let finishOld: ((value: string) => void) | undefined;
    const oldResult = new Promise<string>((resolve) => {
      finishOld = resolve;
    });
    const generation = { current: 0 };
    const oldGeneration = advanceLocationRequestGeneration(generation);
    const committed: string[] = [];
    const oldCompletion = oldResult.then((label) => {
      if (isLocationRequestGenerationCurrent(generation, oldGeneration)) {
        committed.push(label);
      }
    });

    // X invalidates request 1; request 2 deliberately reuses the same label.
    advanceLocationRequestGeneration(generation);
    const newGeneration = advanceLocationRequestGeneration(generation);
    const sameLabel = "Lagos, Nigeria";
    if (isLocationRequestGenerationCurrent(generation, newGeneration)) {
      committed.push(sameLabel);
    }
    finishOld?.(sameLabel);
    await oldCompletion;

    expect(committed).toEqual([sameLabel]);
  });
});
