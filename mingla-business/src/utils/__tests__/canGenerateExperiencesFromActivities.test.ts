import { describe, expect, test } from "@jest/globals";

import type { Brand } from "../../types/brand";
import { canGenerateExperiencesFromActivities } from "../canGenerateExperiencesFromActivities";

function brand(partial: Pick<Brand, "kind"> & Partial<Brand>): Brand {
  return partial as Brand;
}

describe("canGenerateExperiencesFromActivities", () => {
  test("true for verified play physical brand", () => {
    expect(
      canGenerateExperiencesFromActivities(
        brand({
          kind: "physical",
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
          kind: "physical",
          venueCategory: "restaurant",
          claimStatus: "verified",
        }),
      ),
    ).toBe(false);
  });

  test("false for unverified play", () => {
    expect(
      canGenerateExperiencesFromActivities(
        brand({
          kind: "physical",
          venueCategory: "play",
          claimStatus: "pending_review",
        }),
      ),
    ).toBe(false);
  });

  test("false for null brand", () => {
    expect(canGenerateExperiencesFromActivities(null)).toBe(false);
  });
});
