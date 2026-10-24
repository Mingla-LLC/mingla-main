import { describe, expect, test } from "@jest/globals";
import { saleAvailabilityCopy } from "@mingla/offering-rendering/saleAvailabilityCopy";

describe("#3872 buyer discount client contract", () => {
  test("scarcity copy prefers a small remaining count and otherwise shows the end", () => {
    expect(saleAvailabilityCopy(4, "2027-01-01T20:00:00.000Z", "UTC")).toBe(
      "Only 4 left at this price",
    );
    expect(saleAvailabilityCopy(11, "2027-01-01T20:00:00.000Z", "UTC")).toMatch(
      /^Sale ends /,
    );
    expect(saleAvailabilityCopy(null, null)).toBeNull();
  });
});
