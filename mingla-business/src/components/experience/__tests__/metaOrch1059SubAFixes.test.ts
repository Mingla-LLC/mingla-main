/**
 * META-ORCH-1059 [experiences-business-parity] · SUB-A regression guard.
 *
 * FIX 1 — Stop photos use the EXISTING Library/GIFs/Photos picker (the
 *         CoverPicker-reusing ExperienceStopPhotoSheet), NOT raw
 *         expo-image-picker, and NO video path for stops.
 * FIX 2 — All three create wizards' bottom footer/dock clear the phone nav bar
 *         via `insets.bottom` (no static-margin bleed on Android gesture-nav /
 *         iOS home-indicator).
 *
 * Source-assertion test (the runtime layout cannot be measured headless): it
 * asserts the exact wiring each fix requires, and FAILS on revert.
 */

import { readFileSync } from "fs";
import { join } from "path";

const SRC = join(__dirname, "..", "..");

const read = (rel: string): string => readFileSync(join(SRC, rel), "utf8");

describe("META-ORCH-1059 Sub-A · FIX 1 — stop photo picker reuses CoverPicker services (no raw image picker, no video)", () => {
  const stopsStep = read("experience/ExperienceStopsStep.tsx");
  const sheet = read("experience/ExperienceStopPhotoSheet.tsx");

  test("ExperienceStopsStep no longer imports or calls expo-image-picker directly", () => {
    expect(stopsStep).not.toContain('from "expo-image-picker"');
    expect(stopsStep).not.toContain("launchImageLibraryAsync");
  });

  test("ExperienceStopsStep opens the shared ExperienceStopPhotoSheet", () => {
    expect(stopsStep).toContain(
      'import { ExperienceStopPhotoSheet } from "./ExperienceStopPhotoSheet"',
    );
    expect(stopsStep).toMatch(/<ExperienceStopPhotoSheet\b/);
  });

  // [TEST-MOD-APPROVED META-ORCH-1059] the per-stop thumbnail render moved into
  // the new memoized ExperienceStopCard (perf bug #2 fix). Same <Image source>.
  test("the stop card renders real photo thumbnails (not empty placeholder Views)", () => {
    const stopCard = read("experience/ExperienceStopCard.tsx");
    expect(stopCard).toMatch(/<Image\b[\s\S]*?source=\{\{ uri \}\}/);
  });

  test("the sheet reuses the unified CoverPicker GIPHY + Pexels services", () => {
    expect(sheet).toContain(
      'from "../../services/giphyEventCoverService"',
    );
    expect(sheet).toContain(
      'from "../../services/pexelsEventCoverService"',
    );
    expect(sheet).toContain(
      'from "../../services/coverProviderBrowseService"',
    );
    expect(sheet).toContain("searchGiphyEventCovers");
    expect(sheet).toContain("searchPexelsEventCovers");
    expect(sheet).toContain("trendingGiphyCovers");
    expect(sheet).toContain("curatedPexelsCovers");
  });

  test("the sheet uses the brand-keyed device-upload path for Library photos", () => {
    expect(sheet).toContain("uploadExperienceStopImage");
  });

  test("the sheet has Library/GIFs/Photos tabs and NO video tab/path", () => {
    expect(sheet).toContain('id: "library"');
    expect(sheet).toContain('id: "gif"');
    expect(sheet).toContain('id: "stock"');
    expect(sheet).not.toMatch(/id:\s*"video"/);
    expect(sheet).not.toContain("pickVideoCover");
    expect(sheet).not.toContain("useEventCoverVideoUpload");
    expect(sheet).not.toMatch(/mediaTypes:\s*\["videos"\]/);
  });

  test("the sheet caps a stop at 5 photos and gates on remaining slots", () => {
    expect(sheet).toContain("MAX_STOP_PHOTOS = 5");
    expect(sheet).toMatch(/remaining\s*=\s*Math\.max\(0,\s*MAX_STOP_PHOTOS\s*-\s*currentCount\)/);
  });
});

describe("META-ORCH-1059 Sub-A · FIX 2 — create wizard footers clear the phone nav bar", () => {
  test("experience wizard footer adds insets.bottom", () => {
    const src = read("experience/ExperienceCreatorWizard.tsx");
    expect(src).toContain("useSafeAreaInsets");
    expect(src).toMatch(/paddingBottom:\s*insets\.bottom\s*\+\s*spacing\.lg/);
  });

  test("event wizard dock adds insets.bottom (no static-only marginBottom bleed)", () => {
    const src = read("event/EventCreatorWizard.tsx");
    expect(src).toContain("useSafeAreaInsets");
    expect(src).toMatch(/marginBottom:\s*insets\.bottom\s*\+\s*spacing\.lg/);
    // The static dock style must NOT still hardcode marginBottom (it would
    // override / fight the inline inset value or re-introduce the bleed).
    expect(src).not.toMatch(/dock:\s*\{[\s\S]*?marginBottom:\s*spacing\.lg/);
  });

  test("trip wizard dock adds insets.bottom (no static-only marginBottom bleed)", () => {
    const src = read("trip/TripCreatorWizard.tsx");
    expect(src).toContain("useSafeAreaInsets");
    expect(src).toMatch(/marginBottom:\s*insets\.bottom\s*\+\s*spacing\.lg/);
    expect(src).not.toMatch(/dock:\s*\{[\s\S]*?marginBottom:\s*spacing\.lg/);
  });
});
