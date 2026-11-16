/**
 * #4238 W7 (native verdict P3-5): the builder's age fields use the Input
 * `integer` variant (number pad with no decimal key), and the builder keeps
 * its own whole-number rule because the primitive does not validate.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { VARIANT_BEHAVIOUR } from "../../../ui/Input.variants";
import { hostAdAgeRangeValid } from "../hostAdBuilderRules";

const SCREEN = readFileSync(
  join(__dirname, "../../../../screens/hostAds/HostAdCreateScreen.tsx"),
  "utf8",
);

function inputBlock(testID: string): string {
  const at = SCREEN.indexOf(`testID="${testID}"`);
  expect(at).toBeGreaterThan(-1);
  const start = SCREEN.lastIndexOf("<Input", at);
  return SCREEN.slice(start, at);
}

describe("#4238 W7 age fields", () => {
  it.each(["host-ad-age-min", "host-ad-age-max"])(
    "%s uses the integer variant, never the decimal pad",
    (testID) => {
      const block = inputBlock(testID);
      expect(block).toContain('variant="integer"');
      expect(block).not.toContain('variant="number"');
    },
  );

  it("the integer variant is a number pad without a decimal key", () => {
    expect(VARIANT_BEHAVIOUR.integer.keyboardType).toBe("number-pad");
  });

  it("the builder validates the ages through its own whole-number rule", () => {
    expect(SCREEN).toContain("!hostAdAgeRangeValid(ageMin, ageMax)");
  });

  it("accepts whole years from 18 to 65 with min not above max", () => {
    expect(hostAdAgeRangeValid("18", "65")).toBe(true);
    expect(hostAdAgeRangeValid("21", "21")).toBe(true);
    expect(hostAdAgeRangeValid(" 25 ", "40")).toBe(true);
  });

  it.each([
    ["21.5", "45"],
    ["2e1", "45"],
    ["", "45"],
    ["21", ""],
    ["17", "45"],
    ["21", "66"],
    ["40", "30"],
    ["-21", "45"],
    ["21", "4 5"],
  ])("refuses %p to %p", (min, max) => {
    expect(hostAdAgeRangeValid(min, max)).toBe(false);
  });
});
