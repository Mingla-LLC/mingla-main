/**
 * ORCH-1304 [approve generates the pitch] — implementor happy-path regression
 * test (client leg).
 *
 * ORCH-1304 SUPERSEDES META-ORCH-1290 D-3: pitch generation moved from the
 * owner (pre-submit) to admin-approve. This test pins the CLIENT half of that
 * move:
 *
 *  1. The create + claim wizards have NO Pitch step (create s6 / claim c5 are
 *     gone) and NO s6/c5 validation branch — the owner writes no description.
 *  2. `CLAIM_FILLABLE_TOTAL` is 8 (was 9) now the Pitch step is dropped.
 *  3. VenueCreatorWizard no longer mounts VenuePitchField / ClaimStepPitch.
 *  4. VenueDeckReadinessSetup has NO owner-side pitch generation ("Generate
 *     pitch with AI" / pitch textarea / runTier2Pipeline / updateVenuePitch are
 *     gone); a single "Save changes" button persists inputs via `saveTier2`.
 *  5. VenueListingContent shows the editable pitch field ONLY when live, and a
 *     read-only "Mingla writes your pitch when your venue is approved"
 *     placeholder for a pending/rejected venue.
 *  6. VenueSettingsModule drops the "Re-run Recommend me" / edit-cap copy; the
 *     primary button reads "Edit photos & details" and the empty state reads
 *     "Your pitch and match scores are written when Mingla approves your venue."
 *
 * Fails-on-revert: reverting the Pitch-step removal re-adds the "s6"/"c5" ids
 * and the "Pitch" label (assertions #1 flip), and reverting the deck-readiness /
 * settings copy re-introduces the "Generate pitch with AI" / "Re-run Recommend
 * me" tokens (assertions #4/#6 flip).
 *
 * Source-AST/text + pure-logic style (the RN screens cannot mount under the
 * default node/ts-jest config; venueWizardValidation is exercised directly).
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

import {
  CLAIM_FILLABLE_TOTAL,
  venueStepError,
  venueWizardSteps,
} from "../venueWizardValidation";
import type { DraftVenueState } from "../../../store/draftVenueStore";
import { defaultBrandHoursWeek } from "../../../utils/venueBrandHours";

const venueSrc = (name: string): string =>
  readFileSync(join(__dirname, "..", name), "utf8");

/** Collapse whitespace runs so JSX line-wrapping never breaks a copy match. */
const norm = (s: string): string => s.replace(/\s+/g, " ");

function draft(overrides: Partial<DraftVenueState> = {}): DraftVenueState {
  const base: DraftVenueState = {
    placePoolId: null,
    workingName: "Test",
    venueCategory: "restaurant",
    displayName: "Test Venue",
    slug: "test-venue",
    formattedAddress: "1 Main St, City",
    googlePlaceId: null,
    lat: 1,
    lng: 2,
    city: "City",
    countryCode: "US",
    hours: defaultBrandHoursWeek(),
    contactEmail: "hi@test.com",
    contactPhone: "",
    contactPhoneCountryIso: "US",
    tagline: "",
    description: "",
    website: "",
    priceTiers: ["chill"],
    wantsReservations: false,
    galleryUrls: ["https://x/1.jpg", "https://x/2.jpg"],
    coverChoice: { url: "https://x/1.jpg", type: "image", isNew: false },
    claim: null,
    step: 0,
  };
  return { ...base, ...overrides };
}

describe("ORCH-1304 — wizard step maps have NO Pitch step", () => {
  test("create map drops s6/Pitch (ids intentionally gapped)", () => {
    const steps = venueWizardSteps(false);
    expect(steps.map((s) => s.id)).toEqual([
      "s0",
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
      "s7",
      "s8",
      "s9",
    ]);
    expect(steps.map((s) => s.label)).not.toContain("Pitch");
    expect(steps.map((s) => s.id)).not.toContain("s6");
  });

  test("claim map drops c5/Pitch (ids intentionally gapped)", () => {
    const steps = venueWizardSteps(true);
    expect(steps.map((s) => s.id)).toEqual([
      "c0",
      "c1",
      "c2",
      "c3",
      "c4",
      "c6",
      "c7",
      "c8",
      "c9",
    ]);
    expect(steps.map((s) => s.label)).not.toContain("Pitch");
    expect(steps.map((s) => s.id)).not.toContain("c5");
  });

  test("step count derives from the array length (never a hardcoded total)", () => {
    // Both arms are now 9 steps (was 10) after dropping the Pitch step.
    expect(venueWizardSteps(false)).toHaveLength(9);
    expect(venueWizardSteps(true)).toHaveLength(9);
  });

  test("no s6/c5 Pitch validation branch remains (falls through to null)", () => {
    // Short text that the OLD Pitch gate rejected now passes (no gate).
    expect(venueStepError("s6", draft({ description: "no" }))).toBeNull();
    expect(venueStepError("c5", draft({ description: "no" }))).toBeNull();
    // The steps that remain still gate correctly (regression guard).
    expect(venueStepError("s7", draft({ priceTiers: [] }))).not.toBeNull();
    expect(venueStepError("s4", draft({ coverChoice: null }))).not.toBeNull();
  });

  test("CLAIM_FILLABLE_TOTAL dropped from 9 to 8", () => {
    expect(CLAIM_FILLABLE_TOTAL).toBe(8);
  });
});

describe("ORCH-1304 — VenueCreatorWizard no longer mounts a Pitch step", () => {
  const src = venueSrc("VenueCreatorWizard.tsx");

  test("VenuePitchField + ClaimStepPitch are unmounted", () => {
    expect(src).not.toContain("VenuePitchField");
    expect(src).not.toContain("ClaimStepPitch");
  });

  test("the folded cover/photos steps are kept", () => {
    expect(src).toContain("VenuePhotosStep");
    expect(src).toContain("VenueCoverStep");
  });
});

describe("ORCH-1304 — VenueDeckReadinessSetup has no pitch generation", () => {
  const src = venueSrc("VenueDeckReadinessSetup.tsx");

  test("all owner-side pitch generation is removed", () => {
    expect(src).not.toContain("Generate pitch with AI");
    expect(src).not.toContain("Save pitch");
    expect(src).not.toContain("runTier2Pipeline");
    expect(src).not.toContain("updateVenuePitch");
    expect(src).not.toContain("handleRunAi");
  });

  test("a single Save changes button persists inputs via save_tier2", () => {
    expect(src).toContain("Save changes");
    expect(src).toContain("saveTier2");
  });

  test("input collection (cover/gallery/website/price/vibes/facets) is kept", () => {
    expect(src).toContain("syncHeroMedia");
    expect(src).toContain("syncGallery");
    expect(src).toContain("buildTier2");
    expect(src).toContain("VIBE_SIGNALS");
    expect(src).toContain("facetQuestions");
  });

  test("the header copy drops the 'our AI writes your listing' framing", () => {
    expect(src).not.toContain("our AI writes your listing");
    expect(norm(src)).toContain(
      "Mingla writes your pitch and match scores when it approves your venue",
    );
  });
});

describe("ORCH-1304 — VenueListingContent pitch is verified-only", () => {
  const src = venueSrc("VenueListingContent.tsx");

  test("the editable VenuePitchField is gated behind isLive", () => {
    // The live branch keeps the editable field; pending shows a placeholder.
    expect(src).toContain("isLive ? (");
    expect(src).toContain("VenuePitchField");
    expect(src).toContain("listing-pitch-pending");
  });

  test("the pending placeholder copy is present", () => {
    expect(norm(src)).toContain(
      "Mingla writes your pitch when your venue is approved",
    );
  });
});

describe("ORCH-1304 — VenueSettingsModule drops the edit-cap copy", () => {
  const src = venueSrc("VenueSettingsModule.tsx");

  test("the 'Re-run Recommend me' label + edit-cap copy are gone", () => {
    expect(src).not.toContain("Re-run Recommend me");
    expect(src).not.toContain('re-run "Recommend me"');
    expect(src).not.toContain("recommend_edits_remaining");
  });

  test("the primary button is relabeled 'Edit photos & details'", () => {
    expect(src).toContain("Edit photos & details");
    // The stable testIDs are preserved (ORCH-1186 T9c pins both).
    expect(src).toContain("venue-settings-rerun-recommend");
    expect(src).toContain("venue-settings-edit-photos");
  });

  test("the empty state names the approve-time write", () => {
    expect(norm(src)).toContain(
      "Your pitch and match scores are written when Mingla approves your venue",
    );
  });
});
