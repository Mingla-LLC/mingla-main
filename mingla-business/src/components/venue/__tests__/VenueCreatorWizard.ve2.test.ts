import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const WIZARD = join(__dirname, "..", "VenueCreatorWizard.tsx");

// ORCH-1345 [folded venue cover flow]: the Tier-1 -> CoverPickerSheet -> Tier-2
// pipeline this test originally asserted was FULLY REMOVED. The venue flow is
// now the folded single-submission wizard (META-ORCH-1290 + ORCH-1304): the
// cover is collected in step s4 as a top-level `coverChoice`, and submit rides
// `useCreateVenueListing().mutateAsync({ ..., coverMediaUrl: coverChoice?.url,
// coverMediaType: coverChoice?.type })`. The end-to-end folded flow is covered
// by venueAuthoringOneSubmission.metaOrch1290.test.ts and
// venueApproveGeneratesPitch.orch1304.test.ts; this test now pins the wizard's
// CURRENT cover-submit contract (source-text style — the wizard cannot mount
// under the node/ts-jest config).
describe("VenueCreatorWizard cover submit (folded one-submission flow)", () => {
  test("submit rides useCreateVenueListing with coverChoice, not the old CoverPickerSheet/Tier-2 pipeline", () => {
    const src = readFileSync(WIZARD, "utf8");
    // Current contract: the single-submission create hook carries the cover.
    expect(src).toContain("useCreateVenueListing");
    expect(src).toContain("createVenue.mutateAsync");
    expect(src).toContain("coverChoice");
    expect(src).toContain("coverMediaUrl: coverChoice?.url");
    // Removed architecture must NOT reappear (do NOT restore CoverPickerSheet/Tier-2).
    expect(src).not.toContain("CoverPickerSheet");
    expect(src).not.toContain("runTier2Pipeline");
    // Still-valid negatives carried over from the original test.
    expect(src).not.toContain("uploadBrandCover");
    expect(src).not.toContain("ImagePicker.launchImageLibraryAsync");
  });
});
