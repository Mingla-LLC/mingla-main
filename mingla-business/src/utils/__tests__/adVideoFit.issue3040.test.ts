/**
 * #3040 design AD-04 — Host Ads "Ad video ready" names where the video fits:
 * "Fits Meta and TikTok. Snapchat needs 1080×1920." The fit is judged on the
 * server by the shared ads matrix; this pins the sentence and the wiring.
 * Invariant I-ADS-FIT-ONE-MATRIX (declared in supabase/functions/_shared/__tests__/adCreativeFit.issue3040.test.ts): Host fit text comes from adCreativeMatrix, never a client copy of its rules
 * FAILS ON REVERT: drop the formatter, or pick the wrong video's fit.
 */
import { adVideoFitSummaryFor, formatAdFitSummary, joinWithAnd } from "../adVideoFit";

describe("#3040 AD-04 per-platform fit sentence", () => {
  it("names the platforms that fit, then what each misfit needs", () => {
    expect(
      formatAdFitSummary([
        { platform: "meta", fits: true, needs: [] },
        { platform: "tiktok", fits: true, needs: [] },
        { platform: "snapchat", fits: false, needs: ["1080×1920"] },
      ]),
    ).toBe("Fits Meta and TikTok. Snapchat needs 1080×1920.");
  });

  it("joins several platforms and several needs in plain English", () => {
    expect(joinWithAnd(["Meta", "TikTok", "Google"])).toBe("Meta, TikTok and Google");
    expect(
      formatAdFitSummary([
        { platform: "meta", fits: true, needs: [] },
        { platform: "tiktok", fits: true, needs: [] },
        { platform: "google", fits: true, needs: [] },
        { platform: "snapchat", fits: false, needs: ["9:16", "sound"] },
      ]),
    ).toBe("Fits Meta, TikTok and Google. Snapchat needs 9:16 and sound.");
  });

  it("says only what is true when nothing fits", () => {
    expect(
      formatAdFitSummary([{ platform: "meta", fits: false, needs: ["at least 5 seconds"] }]),
    ).toBe("Meta needs at least 5 seconds.");
  });

  it("returns null (generic body) for an older server or no connected platform", () => {
    expect(formatAdFitSummary(undefined)).toBeNull();
    expect(formatAdFitSummary([])).toBeNull();
    expect(formatAdFitSummary([{ platform: "myspace", fits: true, needs: [] }])).toBeNull();
  });

  it("passes the server's own words through — it holds no platform rule", () => {
    expect(
      formatAdFitSummary([{ platform: "google", fits: false, needs: ["a rule only the server knows"] }]),
    ).toBe("Google needs a rule only the server knows.");
    expect(formatAdFitSummary([{ platform: "reddit", fits: false, needs: [] }])).toBe("Reddit can't run this video.");
  });

  it("the sheet sentence is for the video the sheet holds, else the linked one", () => {
    const creatives = [
      { id: "a", fit: [{ platform: "meta" as const, fits: true, needs: [] }] },
      { id: "b", fit: [{ platform: "snapchat" as const, fits: false, needs: ["1080×1920"] }] },
    ];
    expect(adVideoFitSummaryFor({ creatives, heldId: "b", linked: creatives[0] })).toBe("Snapchat needs 1080×1920.");
    expect(adVideoFitSummaryFor({ creatives, heldId: null, linked: creatives[0] })).toBe("Fits Meta.");
    expect(adVideoFitSummaryFor({ creatives: undefined, heldId: "zz", linked: null })).toBeNull();
  });
});
