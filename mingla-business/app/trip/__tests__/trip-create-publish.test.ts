/**
 * ORCH-0859 [Tr2 Minimum Viable Trip] — trip wizard create+publish contract.
 *
 * Asserts the wizard's binding structural contracts via source-grep:
 *   - Wizard has all 5 step components mounted
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

describe("ORCH-0859 — trip create + wizard + publish contract", () => {
  test("TripCreatorWizard mounts all 5 step components", () => {
    expect(wizardSource).toMatch(/<TripCreatorStep1Basics/);
    expect(wizardSource).toMatch(/<TripCreatorStep2Itinerary/);
    expect(wizardSource).toMatch(/<TripCreatorStep3Inclusions/);
    expect(wizardSource).toMatch(/<TripCreatorStep4Pricing/);
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

  test("TripCreatorWizard step 5 publish button uses handlePublish handler", () => {
    expect(wizardSource).toMatch(/step === 5 \? handlePublish : handleNext/);
  });

  test("/trip/create gates on currentBrand.kind === 'trip_planner'", () => {
    expect(createSource).toMatch(
      /currentBrand\.kind\s*!==\s*"trip_planner"/,
    );
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
