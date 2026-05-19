/**
 * ORCH-0099 [Ve1 Physical Venue Brand Onboarding] — place persona enabled.
 *
 * Additive contract alongside ORCH-0855 personaFork.test.ts (SC-04 skipped there
 * with [TEST-MOD-APPROVED ORCH-0099] once Ve1 ships).
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const sheetSource = readFileSync(
  join(__dirname, "..", "BrandSwitcherSheet.tsx"),
  "utf-8",
);

describe("ORCH-0099 — BrandSwitcherSheet place persona (Ve1)", () => {
  test("'A place' persona enabled and routes to /venue/create", () => {
    const placeBlockMatch = sheetSource.match(
      /id: "place"[\s\S]*?disabled: (true|false)/,
    );
    expect(placeBlockMatch).not.toBeNull();
    expect(placeBlockMatch![1]).toBe("false");
    expect(sheetSource).toMatch(/openVenueCreateFromPool/);
    expect(sheetSource).toMatch(/\/venue\/create/);
  });

  test("imports expo-router useRouter for venue onboarding", () => {
    expect(sheetSource).toMatch(
      /import\s*\{[^}]*useRouter[^}]*\}\s*from\s*["']expo-router["']/,
    );
  });
});
