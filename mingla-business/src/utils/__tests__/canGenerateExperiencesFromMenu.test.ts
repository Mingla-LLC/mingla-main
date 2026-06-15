/**
 * ORCH-1144 — the `canGenerateExperiencesFromMenu` predicate (a one-line
 * `venueCategory === "restaurant"` category gate) is DELETED. Experience
 * parsers are venue-category-agnostic: every brand reaches the Ve5 food-menu
 * parser unconditionally via the +→Create experience chooser. The user picks
 * `parseMode="menu"` explicitly; it is never derived from the brand.
 *
 * This test FAILS-ON-REVERT: if the deleted predicate util is restored, the
 * existence assertion fails. See I-PROPOSED-1144-PARSERS-CATEGORY-AGNOSTIC.
 *
 * (Was: a category-equality unit test for the now-removed predicate.)
 */
import { describe, expect, test } from "@jest/globals";
import { existsSync } from "fs";
import { join } from "path";

const PREDICATE = join(__dirname, "..", "canGenerateExperiencesFromMenu.ts");

describe("canGenerateExperiencesFromMenu (ORCH-1144: decommissioned)", () => {
  test("the food-menu category predicate util is gone", () => {
    expect(existsSync(PREDICATE)).toBe(false);
  });
});
