/**
 * ORCH-0855 [Tr1 Trip Planner Brand Onboarding] — BrandSwitcherSheet
 * persona-fork structural regression test.
 *
 * Asserts the persona-fork contract is in place:
 *   - Mode union contains all 4 modes ("switch" | "persona" | "popup-create" | "trip-create")
 *   - 3-persona array config has ids 'place' + 'event' + 'trip' in that order
 *   - The "Create a new brand" footer routes to "persona" (not "create" / "popup-create")
 *   - popup-create mode preserves byte-equivalent kind='popup' submit (SC-06 backward-compat)
 *
 * Source-grep style — parallels the tester's adversarial check at
 * scripts/ci/orch-0855-adversarial-check.mjs but attacks the contract from
 * the implementor side. The two together provide Step 0.5 coverage (happy
 * path + adversarial different-angle).
 *
 * Fails-on-revert: if BrandSwitcherSheet.tsx is reverted to pre-Tr1
 * `type Mode = "switch" | "create"` + the old single-create path, every
 * assertion below fails.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const sheetSource = readFileSync(
  join(__dirname, "..", "BrandSwitcherSheet.tsx"),
  "utf-8",
);

describe("ORCH-0855 — BrandSwitcherSheet persona-fork structural contract", () => {
  test("Mode type union contains all 4 modes", () => {
    // Single source line declaring the union — exact match required.
    expect(sheetSource).toMatch(
      /type Mode = "switch" \| "persona" \| "popup-create" \| "trip-create"/,
    );
  });

  test("personas array config declares all 3 ids in [place, event, trip] order", () => {
    // Find the personas: PersonaDef[] block and verify ids appear in order.
    const personasBlockMatch = sheetSource.match(
      /const personas: PersonaDef\[\] = \[([\s\S]*?)\];/,
    );
    expect(personasBlockMatch).not.toBeNull();
    const block = personasBlockMatch![1];

    const placeIdx = block.indexOf('id: "place"');
    const eventIdx = block.indexOf('id: "event"');
    const tripIdx = block.indexOf('id: "trip"');

    expect(placeIdx).toBeGreaterThan(-1);
    expect(eventIdx).toBeGreaterThan(placeIdx);
    expect(tripIdx).toBeGreaterThan(eventIdx);
  });

  test("'A trip' persona uses compass icon (SPEC §4.5.1 SPEC-LOCKED)", () => {
    // Locate the trip persona block and verify icon literal.
    const tripBlockMatch = sheetSource.match(
      /id: "trip"[\s\S]*?icon: "(\w+)"/,
    );
    expect(tripBlockMatch).not.toBeNull();
    expect(tripBlockMatch![1]).toBe("compass");
  });

  test("'A place' persona is disabled (Ve1 hasn't shipped — SC-04)", () => {
    const placeBlockMatch = sheetSource.match(
      /id: "place"[\s\S]*?disabled: (true|false)/,
    );
    expect(placeBlockMatch).not.toBeNull();
    expect(placeBlockMatch![1]).toBe("true");
  });

  test("'A trip' onSelect routes to mode='trip-create'", () => {
    expect(sheetSource).toMatch(
      /id: "trip"[\s\S]*?onSelect:[\s\S]*?setMode\("trip-create"\)/,
    );
  });

  test("'An event' onSelect preserves today's flow via mode='popup-create'", () => {
    expect(sheetSource).toMatch(
      /id: "event"[\s\S]*?onSelect:[\s\S]*?setMode\("popup-create"\)/,
    );
  });

  test("footer 'Create a new brand' button routes to handleSwitchToPersona (NOT handleSwitchToCreate)", () => {
    expect(sheetSource).toMatch(
      /label="Create a new brand"[\s\S]*?onPress=\{handleSwitchToPersona\}/,
    );
    // Defensive: the old handler name must NOT exist anywhere.
    expect(sheetSource).not.toMatch(/handleSwitchToCreate/);
  });

  test("popup-create submit still passes kind: 'popup' verbatim (SC-06 backward-compat)", () => {
    // handleSubmit body must carry the literal kind: "popup" (the old hardcoded value).
    expect(sheetSource).toMatch(/kind: "popup"/);
    // Defensive: BrandSwitcherSheet itself must NOT carry kind: "trip_planner"
    // (trip-planner creation belongs entirely to TripBrandWizard, not the sheet).
    expect(sheetSource).not.toMatch(/kind: "trip_planner"/);
  });

  test("TripBrandWizard and PersonaPickerCards are imported", () => {
    expect(sheetSource).toMatch(/import.*PersonaPickerCards.*PersonaDef/);
    expect(sheetSource).toMatch(/import.*TripBrandWizard/);
  });
});
