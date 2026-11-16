/**
 * #4238 W7 (native verdict P3-5): the builder's age fields use the Input
 * `integer` variant (number pad with no decimal key; the wiring is pinned in
 * the #4238 plain-language strict-grep gate, section 8), and the builder
 * keeps its own whole-number rule because the primitive does not validate.
 */
import { VARIANT_BEHAVIOUR } from "../../../ui/Input.variants";
import { HOST_AD_AGE_CEILING, HOST_AD_AGE_FLOOR, hostAdAgeRangeValid } from "../hostAdBuilderRules";

describe("#4238 W7 age fields", () => {
  it("the integer variant is a number pad without a decimal key", () => {
    expect(VARIANT_BEHAVIOUR.integer.keyboardType).toBe("number-pad");
    expect(VARIANT_BEHAVIOUR.number.keyboardType).not.toBe("number-pad");
  });

  it("accepts whole years from 18 to 65 with min not above max", () => {
    expect([HOST_AD_AGE_FLOOR, HOST_AD_AGE_CEILING]).toEqual([18, 65]);
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
