/**
 * META-ORCH-1290 Leg B [venue authoring — one submission] — implementor
 * happy-path regression test.
 *
 * PROVES (D-1/D-3/D-4/D-5):
 *  1. The create wizard is the FOLDED 10-step map (s0..s9), mirroring claim,
 *     collecting photos + cover + pitch + price in ONE pass (no deck-readiness
 *     leg) — venueWizardSteps(false).
 *  2. The folded step gates: s4 requires a cover, s6 pitch is EMPTY-allowed or
 *     ≥20 (mirror claim c5, SPEC §4.3.A / SC-4), s7 requires ≥1 price tier —
 *     venueStepError.
 *  3. The wizard NO LONGER navigates to the deck-readiness route on create
 *     submit (D-1) and lands via onDone; it persists the gallery via
 *     syncGallery.
 *  4. The shared VenuePitchField is honest: an `AI DRAFT` chip, a "Draft with
 *     AI" affordance, and NO fabricated pitch text (the drafting state shows a
 *     Skeleton shimmer, never fake copy).
 *  5. The listing scores card ALWAYS renders — a LOCKED pre-approval state with
 *     the admin-approval copy + a ghost-preview Skeleton (NO fake numbers) — and
 *     the old "Changes remaining" edit-cap card is RETIRED.
 *
 * Fails-on-revert: reverting the folded step map or the s6 pitch gate makes the
 * step-model / gate assertions fail; reverting the create→deck-readiness nav
 * removal re-adds `routeForDeckReadinessFix` (asserted absent).
 *
 * Source-AST/text style (the wizard/listing cannot mount under the default
 * node/ts-jest config — no react-native-testing-library here; the pure logic in
 * venueWizardValidation is exercised directly).
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

import {
  venueStepError,
  venueWizardSteps,
} from "../venueWizardValidation";
import type { DraftVenueState } from "../../../store/draftVenueStore";
import { defaultBrandHoursWeek } from "../../../utils/venueBrandHours";

const venueSrc = (name: string): string =>
  readFileSync(join(__dirname, "..", name), "utf8");

// A create-mode draft (claim === null) with every field satisfied; individual
// tests override one field to probe one step's gate.
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

describe("META-ORCH-1290 Leg B — folded one-submission create wizard", () => {
  test("create is the folded 10-step map (mirrors claim)", () => {
    const steps = venueWizardSteps(false);
    expect(steps.map((s) => s.id)).toEqual([
      "s0",
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
      "s6",
      "s7",
      "s8",
      "s9",
    ]);
    expect(steps.map((s) => s.label)).toEqual([
      "Address",
      "Name",
      "Hours",
      "Photos",
      "Cover",
      "Contact",
      "Pitch",
      "Price",
      "Bookings",
      "Review",
    ]);
  });

  test("s3 Photos never hard-blocks (≥5 enforced at approve, not submit)", () => {
    expect(venueStepError("s3", draft({ galleryUrls: [] }))).toBeNull();
  });

  test("s4 Cover requires a chosen cover", () => {
    expect(venueStepError("s4", draft({ coverChoice: null }))).not.toBeNull();
    expect(venueStepError("s4", draft())).toBeNull();
  });

  test("s6 Pitch is empty-allowed OR ≥20 chars (mirror claim c5)", () => {
    expect(venueStepError("s6", draft({ description: "" }))).toBeNull();
    expect(venueStepError("s6", draft({ description: "too short" }))).not.toBeNull();
    expect(
      venueStepError("s6", draft({ description: "a".repeat(25) })),
    ).toBeNull();
  });

  test("s7 Price requires at least one tier", () => {
    expect(venueStepError("s7", draft({ priceTiers: [] }))).not.toBeNull();
    expect(venueStepError("s7", draft({ priceTiers: ["comfy"] }))).toBeNull();
  });

  test("wizard retires the create→deck-readiness nav and lands via onDone", () => {
    const src = venueSrc("VenueCreatorWizard.tsx");
    // D-1 — the durable-route nav builder is GONE from the create success path.
    expect(src).not.toContain("routeForDeckReadinessFix");
    // Create success persists the gallery + hands back the venue like claim.
    expect(src).toContain("syncGallery");
    expect(src).toContain("VenuePhotosStep");
    expect(src).toContain("VenueCoverStep");
    expect(src).toContain("VenuePitchField");
  });
});

describe("META-ORCH-1290 Leg B — shared VenuePitchField (honest states)", () => {
  const src = venueSrc("VenuePitchField.tsx");

  test("carries the AI DRAFT chip + Draft with AI affordance", () => {
    expect(src).toContain("AI DRAFT");
    expect(src).toContain("Draft with AI");
    expect(src).toContain("Regenerate");
  });

  test("drafting state shows a Skeleton shimmer, never fabricated text", () => {
    expect(src).toContain("Skeleton");
    // No fabrication: an empty AI return is an honest error, not fake text.
    expect(src).toContain('setMode("error")');
  });
});

describe("META-ORCH-1290 Leg B — listing scores card + retired edit-cap", () => {
  const src = venueSrc("VenueListingContent.tsx");

  test("LOCKED pre-approval copy + honest ghost preview", () => {
    expect(src).toContain(
      "Your vibe scores appear once an admin approves your listing",
    );
    // Ghost preview = real bar layout, Skeleton label, NO fake numbers.
    expect(src).toContain("Skeleton");
    expect(src).toContain("scoreValueGhost");
  });

  test("populated card ramps by strength + top-6 disclosure", () => {
    expect(src).toContain("scoreFill");
    expect(src).toContain("Show all");
  });

  test("the 'Changes remaining' edit-cap card is retired (OQ-4)", () => {
    expect(src).not.toContain("Changes remaining");
    expect(src).not.toContain("recommend_edits_remaining");
  });
});

describe("META-ORCH-1290 Leg B — deck-readiness edit surface (§4.3.E)", () => {
  const src = venueSrc("VenueDeckReadinessSetup.tsx");

  test("the self-approval 'Approve & publish' seam is removed", () => {
    expect(src).not.toContain("Approve & publish");
    expect(src).not.toContain("confirmAiOutputs");
  });

  test("the AI button drafts the pitch (no scoring self-run)", () => {
    expect(src).toContain("Generate pitch with AI");
  });
});
