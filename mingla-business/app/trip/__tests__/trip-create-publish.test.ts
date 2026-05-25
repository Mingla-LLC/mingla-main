/**
 * ORCH-0859 [Tr2 Minimum Viable Trip] — trip wizard create+publish contract.
 *
 * Asserts the wizard's binding structural contracts via source-grep:
 *   - Wizard has all 7 step components mounted
 *   - Wizard host calls all 4 autosave mutations + publish mutation
 *   - Wizard host KeyboardAvoidingView wraps body (feedback_keyboard_never_blocks_input)
 *   - /trip/create gates on kind='trip_planner'
 *   - /trip/[id]/edit routes to operator dashboard on publish success
 *
 * Source-grep style mirrors the Tr1 ORCH-0855 pattern. Fails-on-revert: if
 * any wizard mode is removed, if KeyboardAvoidingView is dropped, or if the
 * publish handoff to /trip/{id} dashboard is broken, these assertions fail.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const wizardSource = readFileSync(
  join(__dirname, "..", "..", "..", "src", "components", "trip", "TripCreatorWizard.tsx"),
  "utf-8",
);
const createSource = readFileSync(
  join(__dirname, "..", "create.tsx"),
  "utf-8",
);
const editSource = readFileSync(
  join(__dirname, "..", "[id]", "edit.tsx"),
  "utf-8",
);
const step2Source = readFileSync(
  join(__dirname, "..", "..", "..", "src", "components", "trip", "TripCreatorStep2Itinerary.tsx"),
  "utf-8",
);
const step3Source = readFileSync(
  join(__dirname, "..", "..", "..", "src", "components", "trip", "TripCreatorStep3Inclusions.tsx"),
  "utf-8",
);
const step4Source = readFileSync(
  join(__dirname, "..", "..", "..", "src", "components", "trip", "TripCreatorStep4Pricing.tsx"),
  "utf-8",
);
const reviewSource = readFileSync(
  join(__dirname, "..", "..", "..", "src", "components", "trip", "TripCreatorStep5Review.tsx"),
  "utf-8",
);

describe("ORCH-0859 — trip create + wizard + publish contract", () => {
  test("TripCreatorWizard mounts all 7 step components", () => {
    expect(wizardSource).toMatch(/<TripCreatorStep1Basics/);
    expect(wizardSource).toMatch(/<TripCreatorStep2Itinerary/);
    expect(wizardSource).toMatch(/<TripCreatorStep3Inclusions/);
    expect(wizardSource).toMatch(/<TripCreatorStep4Pricing/);
    expect(wizardSource).toMatch(/<TripCreatorStep5Policy/);
    expect(wizardSource).toMatch(/<TripCreatorStep6Intake/);
    expect(wizardSource).toMatch(/<TripCreatorStep5Review/);
  });

  test("TripCreatorWizard calls all 4 autosave + publish mutations", () => {
    expect(wizardSource).toMatch(/useUpdateTripBasics/);
    expect(wizardSource).toMatch(/useUpsertTripDays/);
    expect(wizardSource).toMatch(/useUpsertTripInclusions/);
    expect(wizardSource).toMatch(/useUpdateTripPricing/);
    expect(wizardSource).toMatch(/usePublishTrip/);
  });

  test("TripCreatorWizard uses KeyboardAvoidingView", () => {
    expect(wizardSource).toMatch(/KeyboardAvoidingView/);
  });

  test("TripCreatorWizard step 7 publish button uses handlePublishTap handler", () => {
    // [TEST-MOD-APPROVED ORCH-0919] Refreshes stale pre-ORCH-0880 step-5
    // assertion to the current 7-step wizard shape.
    expect(wizardSource).toMatch(
      /step === 7[\s\S]{0,1200}onPress=\{handlePublishTap\}/,
    );
  });

  test("TripCreatorWizard header owns step title and body does not repeat it", () => {
    expect(wizardSource).toMatch(
      /<Text style=\{styles\.mobileStepTitle\}>\{stepTitle\}<\/Text>/,
    );
    expect(wizardSource).toMatch(
      /<Text style=\{styles\.mobileStepSub\}>\{stepSubtitle\}<\/Text>/,
    );
    expect(wizardSource).not.toMatch(/STEP \{step\} OF \{STEP_COUNT\}/);
    expect(wizardSource).not.toMatch(/styles\.eyebrow/);
  });

  test("TripCreatorWizard steps 2-7 do not add nested wizard-body side padding", () => {
    expect(step2Source).not.toMatch(/paddingHorizontal:\s*spacing\.lg/);
    expect(step2Source).not.toMatch(/contentContainerStyle=\{styles\.contentContainer\}/);
    expect(step3Source).not.toMatch(/paddingHorizontal:\s*spacing\.lg/);
    expect(step3Source).not.toMatch(/contentContainerStyle=\{styles\.contentContainer\}/);
    expect(step4Source).not.toMatch(/host:[\s\S]{0,80}paddingHorizontal:\s*spacing\.lg/);
    expect(reviewSource).toMatch(/contentPadding=\{0\}/);
    expect(reviewSource).not.toMatch(/paddingHorizontal:\s*spacing\.lg/);
  });

  test("/trip/create is universal for every brand", () => {
    expect(createSource).not.toMatch(/currentBrand\.kind/);
    expect(createSource).toMatch(/I-BRAND-UNIVERSAL-AUTHORING/);
  });

  test("/trip/create router.replaces to /trip/{id}/edit on success (clean back-stack)", () => {
    expect(createSource).toMatch(
      /router\.replace\(`\/trip\/\$\{[^}]+\}\/edit`/,
    );
  });

  test("/trip/[id]/edit routes to /trip/{id} dashboard on publish success", () => {
    expect(editSource).toMatch(
      /onPublished[\s\S]{0,200}router\.replace\(`\/trip\/\$\{[^}]+\}`/,
    );
  });

  test("/trip/[id]/edit imports useCurrentBrand from hooks (not from store)", () => {
    expect(editSource).toMatch(
      /from\s+"[\.\/]+src\/hooks\/useCurrentBrand"/,
    );
    expect(editSource).not.toMatch(
      /from\s+"[\.\/]+src\/store\/currentBrandStore"/,
    );
  });
});
