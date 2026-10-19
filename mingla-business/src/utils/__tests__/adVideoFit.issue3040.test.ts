/**
 * #3040 design AD-04 — Host Ads "Ad video ready" names where the video fits:
 * "Fits Meta and TikTok. Snapchat needs 1080×1920." The fit is judged on the
 * server by the shared ads matrix; this pins the sentence and the wiring.
 * MINGLA-INVARIANT: I-ADS-FIT-ONE-MATRIX | issue #3040 | Host fit text comes from adCreativeMatrix, never a client copy of its rules
 * FAILS ON REVERT: drop the formatter, the setup `fit` type, or the sheet prop.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { formatAdFitSummary, joinWithAnd } from "../adVideoFit";

const ROOT = join(__dirname, "..", "..", "..");

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

  it("is wired: setup creatives carry `fit` and Host Ads hands the sentence to the sheet", () => {
    const service = readFileSync(join(ROOT, "src/services/hostAdPlanService.ts"), "utf8");
    expect(service).toMatch(/fit\?: AdVideoFit\[\];/);
    const screen = readFileSync(join(ROOT, "app/(tabs)/marketing/ads/create.tsx"), "utf8");
    expect(screen).toMatch(/formatAdFitSummary\(/);
    expect(screen).toMatch(/adFitSummary=\{adVideoFitSummary\}/);
    const sheet = readFileSync(join(ROOT, "src/components/ui/CoverPickerSheet.tsx"), "utf8");
    expect(sheet).toMatch(/adFitSummary=\{adFitSummary\}/);
  });

  it("holds no platform rule of its own (the server matrix owns them)", () => {
    const source = readFileSync(join(ROOT, "src/utils/adVideoFit.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(source).not.toMatch(/1080|1920|0\.5625|durationSeconds|has_audio/);
  });
});
