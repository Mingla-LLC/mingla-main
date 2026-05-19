import { describe, expect, test } from "@jest/globals";

import type { Brand } from "../../types/brand";
import { canGenerateExperiencesFromMenu } from "../canGenerateExperiencesFromMenu";

function brand(partial: Pick<Brand, "kind"> & Partial<Brand>): Brand {
  return partial as Brand;
}

describe("canGenerateExperiencesFromMenu", () => {
  test("true for verified restaurant physical brand", () => {
    expect(
      canGenerateExperiencesFromMenu(
        brand({
          kind: "physical",
          venueCategory: "restaurant",
          claimStatus: "verified",
        }),
      ),
    ).toBe(true);
  });

  test("false for unverified restaurant", () => {
    expect(
      canGenerateExperiencesFromMenu(
        brand({
          kind: "physical",
          venueCategory: "restaurant",
          claimStatus: "pending_review",
        }),
      ),
    ).toBe(false);
  });

  test("false for verified play venue", () => {
    expect(
      canGenerateExperiencesFromMenu(
        brand({
          kind: "physical",
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
