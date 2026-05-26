import { describe, expect, test } from "@jest/globals";

import type { Brand } from "../../types/brand";
import { canGenerateExperiencesFromActivities } from "../canGenerateExperiencesFromActivities";

function brand(partial: Partial<Brand>): Brand {
  return partial as Brand;
}

describe("canGenerateExperiencesFromActivities", () => {
  test("true for play venue category", () => {
    expect(
      canGenerateExperiencesFromActivities(
        brand({
          venueCategory: "play",
          claimStatus: "verified",
        }),
      ),
    ).toBe(true);
  });

  test("false for verified restaurant", () => {
    expect(
      canGenerateExperiencesFromActivities(
        brand({
          venueCategory: "restaurant",
          claimStatus: "verified",
        }),
      ),
    ).toBe(false);
  });

  test("true for unverified play", () => {
    expect(
      canGenerateExperiencesFromActivities(
        brand({
          venueCategory: "play",
          claimStatus: "pending_review",
        }),
      ),
    ).toBe(true);
  });

  test("false for null brand", () => {
    expect(canGenerateExperiencesFromActivities(null)).toBe(false);
  });
});
