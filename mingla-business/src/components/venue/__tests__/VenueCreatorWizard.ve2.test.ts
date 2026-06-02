import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const WIZARD = join(__dirname, "..", "VenueCreatorWizard.tsx");

describe("VenueCreatorWizard Ve2 submit", () => {
  test("passes place_pool_id and routes hero media through CoverPickerSheet after Tier 1", () => {
    const src = readFileSync(WIZARD, "utf8");
    expect(src).toContain("placePoolId: st.placePoolId");
    expect(src).toContain("upsertTier1Place");
    expect(src).toContain("CoverPickerSheet");
    expect(src).toContain("syncHeroMedia");
    expect(src).toContain("runTier2Pipeline");
    expect(src).toContain("confirmAiOutputs");
    expect(src).toContain("refreshDeckReadiness");
    expect(src).toContain("initialPendingBio");
    expect(src).toContain("initialTier2");
    expect(src).toContain("focus === \"cover\"");
    expect(src).not.toContain("uploadBrandCover");
    expect(src).not.toContain("ImagePicker.launchImageLibraryAsync");
  });
});
