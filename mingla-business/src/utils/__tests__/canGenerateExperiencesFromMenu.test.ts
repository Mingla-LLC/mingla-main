import { describe, expect, test } from "@jest/globals";

import type { Brand } from "../../types/brand";
import { canGenerateExperiencesFromMenu } from "../canGenerateExperiencesFromMenu";

function brand(partial: Partial<Brand>): Brand {
  return partial as Brand;
}

describe("canGenerateExperiencesFromMenu", () => {
  test("true for restaurant venue category", () => {
    expect(
      canGenerateExperiencesFromMenu(
        brand({
          venueCategory: "restaurant",
          claimStatus: "verified",
        }),
      ),
    ).toBe(true);
  });

  test("true for unverified restaurant", () => {
    expect(
      canGenerateExperiencesFromMenu(
        brand({
          venueCategory: "restaurant",
          claimStatus: "pending_review",
        }),
      ),
    ).toBe(true);
  });

  test("false for play venue category", () => {
    expect(
      canGenerateExperiencesFromMenu(
        brand({
          venueCategory: "play",
          claimStatus: "verified",
        }),
      ),
    ).toBe(false);
  });

  test("false for null brand", () => {
    expect(canGenerateExperiencesFromMenu(null)).toBe(false);
  });
});
