/**
 * ORCH-1144 — the `canGenerateExperiencesFromActivities` predicate (a one-line
 * `venueCategory === "play"` category gate) is DELETED. Experience parsers are
 * venue-category-agnostic: every brand reaches the Ve6 activities parser
 * unconditionally via the +→Create experience chooser. The user picks
 * `parseMode="activities"` explicitly; it is never derived from the brand.
 *
 * This test FAILS-ON-REVERT: if the deleted predicate util is restored, the
 * existence assertion fails. See I-PROPOSED-1144-PARSERS-CATEGORY-AGNOSTIC.
 *
 * (Was: a category-equality unit test for the now-removed predicate.)
 */
import { describe, expect, test } from "@jest/globals";
import { existsSync } from "fs";
import { join } from "path";

const PREDICATE = join(
  __dirname,
  "..",
  "canGenerateExperiencesFromActivities.ts",
);

describe("canGenerateExperiencesFromActivities (ORCH-1144: decommissioned)", () => {
  test("the activities category predicate util is gone", () => {
    expect(existsSync(PREDICATE)).toBe(false);
  });
});
