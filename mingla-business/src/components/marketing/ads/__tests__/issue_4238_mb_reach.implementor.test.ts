/**
 * #4238 media-buyer, wave B — reach lines and the audience a plan sends:
 * a distance per place, regions, pins, left-out places, languages, and the
 * past-buyer exclusion.
 */
jest.mock("../../../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

// eslint-disable-next-line import/first
import { hostAdMeterPosition, hostAdReachRowLine, hostAdShortNumber } from "../HostAdReachMeter";
// eslint-disable-next-line import/first
import { buildHostAudience, hostAdPastBuyersKey } from "../../../../services/hostAdPlanService";
// eslint-disable-next-line import/first
import { hostAdCopyIsPlain } from "../hostAdCopy";

const conn = (platform: "meta" | "tiktok" | "snapchat") => ({
  id: `c-${platform}`,
  platform,
  currency: "USD",
  status: "connected",
  connected: true,
  sales: { ready: false, reason: "x" },
});

describe("#4238 wave B — reach per app", () => {
  it("shows a range only when the app's switch is on", () => {
    const row = { platform: "meta", state: "available", lower: 1_200_000, upper: 1_600_000, meter: "good" as const };
    expect(hostAdReachRowLine(row, true)).toBe("About 1.2M to 1.6M people on Facebook & Instagram.");
    expect(hostAdReachRowLine(row, false)).toBe("Facebook & Instagram didn't give us a reach number yet.");
    expect(hostAdShortNumber(640_000)).toBe("640K");
    expect(hostAdMeterPosition(10, 20)).toBe(3);
    expect(hostAdMeterPosition(1e9, 1e9)).toBe(97);
    expect(hostAdCopyIsPlain(hostAdReachRowLine({ ...row, state: "targeting_unavailable" }, true))).toBe(true);
  });
});

describe("#4238 wave B — the audience a plan sends", () => {
  it("carries each place's own distance, kinds, left-out places and languages", () => {
    const { audienceIntent, refsByPlatform } = buildHostAudience({
      countries: ["NG"],
      cities: [
        { name: "Lagos", countryCode: "NG", radiusKm: 20, refs: { meta: "1" } },
        { name: "Lagos State", countryCode: "NG", kind: "region", refs: { meta: "r", tiktok: "p" } },
        { name: "Beach club, Lekki", countryCode: "NG", kind: "pin", radiusKm: 2, refs: { tiktok: "p" } },
      ],
      radiusKm: 17,
      interests: [{ name: "Live music", refs: { meta: "i1" } }],
      ageMin: 21,
      ageMax: 45,
      gender: "all",
      excludedPlaces: [{ name: "Ikorodu", countryCode: "NG", refs: { meta: "9" } }],
      languages: ["en"],
      languageIds: { en: "1001" },
      connections: [conn("meta"), conn("tiktok")],
    });
    expect(audienceIntent.cities).toEqual([
      { name: "Lagos", countryCode: "NG", radiusKm: 20 },
      { name: "Lagos State", countryCode: "NG", kind: "region" },
      { name: "Beach club, Lekki", countryCode: "NG", kind: "pin", radiusKm: 2 },
    ]);
    // Every place has its own distance, so no shared one is sent.
    expect(audienceIntent.radiusKm).toBeUndefined();
    expect(audienceIntent.excludedPlaces).toEqual([{ name: "Ikorodu", countryCode: "NG" }]);
    expect(audienceIntent.languages).toEqual(["en"]);
    expect(refsByPlatform.meta).toEqual({
      locationIds: { "NG:lagos": "1", "region:NG:lagos state": "r", "NG:ikorodu": "9" },
      interestIds: { "live music": "i1" },
      languageIds: { en: "1001" },
    });
    expect(refsByPlatform.tiktok.locationIds).toEqual({
      "region:NG:lagos state": "p",
      "pin:NG:beach club, lekki": "p",
    });
    expect(refsByPlatform.tiktok.languageIds).toBeUndefined();
  });

  it("past buyers are the brand's own guests list", () => {
    expect(hostAdPastBuyersKey("4238AAAA-0000-4000-8000-000000000001")).toBe(
      "brand:4238aaaa-0000-4000-8000-000000000001:guests",
    );
  });
});
