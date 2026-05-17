/**
 * ORCH-0855 [Tr1 Trip Planner Brand Onboarding] — TripBrandWizard
 * structural + contract regression test.
 *
 * Asserts the wizard's binding contracts hold:
 *   - createBrand mutation called with kind: 'trip_planner' literal (SC-09)
 *   - Final navigation step is router.push(`/brand/${id}/payments`) (SC-11)
 *   - SlugCollisionError handled inline → error-slug-collision state (SC-12)
 *   - Cover upload failure post-insert routes anyway with banner (SC-13)
 *   - BIO_MAX_LENGTH cap enforced at the maxLength prop (200)
 *   - Wizard component is mounted inside the parent BrandSwitcherSheet TopSheet
 *     (sub-sheet-inside-parent rule — TripBrandWizard does NOT mount its own Sheet/Modal)
 *
 * Source-grep style. The tester's adversarial check at
 * scripts/ci/orch-0855-adversarial-check.mjs attacks different angles.
 *
 * Fails-on-revert: if TripBrandWizard.tsx is deleted or its submit flow
 * changed to drop kind:'trip_planner' or the /brand/{id}/payments route,
 * the assertions below fail.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const wizardSource = readFileSync(
  join(__dirname, "..", "TripBrandWizard.tsx"),
  "utf-8",
);

describe("ORCH-0855 — TripBrandWizard submit-flow contract", () => {
  test("calls createBrandMutation.mutateAsync with kind: 'trip_planner' literal (SC-09)", () => {
    expect(wizardSource).toMatch(
      /createBrandMutation\.mutateAsync\([\s\S]*?kind: "trip_planner"/,
    );
  });

  test("final navigation step pushes to /brand/{id}/payments (SC-11 — delegates Stripe Connect to BrandOnboardView per P1-2)", () => {
    expect(wizardSource).toMatch(/router\.push\(\s*`\/brand\/\$\{[^}]+\}\/payments`/);
  });

  test("SlugCollisionError handled inline → error-slug-collision state (SC-12)", () => {
    expect(wizardSource).toMatch(/instanceof SlugCollisionError/);
    expect(wizardSource).toMatch(/"error-slug-collision"/);
  });

  test("cover upload failure post-insert routes anyway with banner (SC-13)", () => {
    // handleCoverPicked catch block must invoke routeToPayments — brand
    // persists even if cover patch fails.
    expect(wizardSource).toMatch(
      /handleCoverPicked[\s\S]*?catch[\s\S]*?routeToPayments\(createdBrand\)/,
    );
  });

  test("BIO_MAX_LENGTH cap enforced at 200 chars", () => {
    expect(wizardSource).toMatch(/BIO_MAX_LENGTH\s*=\s*200/);
    expect(wizardSource).toMatch(/maxLength=\{BIO_MAX_LENGTH\}/);
  });

  test("wizard mounts inside parent TopSheet (sub-sheet-inside-parent rule)", () => {
    // BrandCoverPickerSheet is mounted INSIDE the wizard's render tree
    // (sibling of form), NOT at the root layer. The wizard itself does
    // NOT mount its own Sheet or Modal at the OS root layer.
    expect(wizardSource).toMatch(/<BrandCoverPickerSheet/);
    // Defensive: wizard MUST NOT introduce a new Sheet/Modal wrapper.
    expect(wizardSource).not.toMatch(/<Sheet\b/);
    expect(wizardSource).not.toMatch(/<Modal\b/);
    expect(wizardSource).not.toMatch(/<TopSheet\b/);
  });

  test("name input has explicit accessibilityLabel (I-39)", () => {
    expect(wizardSource).toMatch(/accessibilityLabel="Brand name"/);
  });

  test("bio input has explicit accessibilityLabel (I-39)", () => {
    expect(wizardSource).toMatch(/accessibilityLabel="Short bio"/);
  });

  test("keyboard avoidance present (feedback_keyboard_never_blocks_input)", () => {
    expect(wizardSource).toMatch(/KeyboardAvoidingView/);
  });

  test("default coverHue = 25 (matches popup-brand default — Cycle 7 FX2)", () => {
    expect(wizardSource).toMatch(/DEFAULT_COVER_HUE\s*=\s*25/);
  });
});
