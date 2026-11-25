// MINGLA-INVARIANT: I-4490-EXPERIENCE-NO-FORCED-STANDARD | issue #4490 | no Host code path names a price option "Standard" on the host's behalf; the host names every price, and the server refuses a blank name.
/**
 * #4490 P1-4 — experience creator fixes (Host side).
 *
 * 1. Group size: no 50-person clamp in the payload, the validator or the input.
 * 2. Block length: 15 minutes up to 8 hours; a stored long block survives an edit.
 * 3. No forced "Standard": options start unnamed and a blank name is sent as typed;
 *    the server refuses it (experience_price_name_required) with its own copy.
 * 4. New experiences share spots across price options by the server's column
 *    default (events.spots_shared DEFAULT true for new rows); no payload key.
 * (Wizard wiring — name field on every price, cover adoption, error copy — is
 *  exercised by the existing experience wizard render suites.)
 *
 * Invariant I-4490-EXPERIENCE-NO-FORCED-STANDARD is declared at the top of this file.
 */

import {
  EXPERIENCE_BLOCK_MINUTES,
  emptyPriceOption,
  experienceBlockPillLabel,
  PRICE_NAME_REQUIRED_COPY,
  priceOptionEntryIsValid,
  priceOptionNameIssue,
  priceOptionToPayload,
  toExperienceBlockMinutes,
} from "../experienceWizardTypes";

describe("#4490 experience price options", () => {
  it("starts every new option unnamed", () => {
    expect(emptyPriceOption().name).toBe("");
  });

  it("sends a group of 150 as 150 (no 50 cap)", () => {
    const payload = priceOptionToPayload(
      emptyPriceOption({ name: "Squad", priceBasis: "group", groupMax: 150, priceMajor: "5000" }),
    );
    expect(payload.group_max).toBe(150);
    expect(payload.name).toBe("Squad");
  });

  it("still floors a group at 2 in the payload", () => {
    const payload = priceOptionToPayload(
      emptyPriceOption({ name: "Pair", priceBasis: "group", groupMax: 1 }),
    );
    expect(payload.group_max).toBe(2);
  });

  it("sends a blank name as typed instead of inventing Standard", () => {
    const payload = priceOptionToPayload(emptyPriceOption({ name: "   " }));
    expect(payload.name).toBe("");
  });

  it("accepts big groups and refuses groups under 2", () => {
    expect(
      priceOptionEntryIsValid(
        emptyPriceOption({ name: "Squad", priceMajor: "10", priceBasis: "group", groupMax: 150 }),
        false,
      ),
    ).toBe(true);
    expect(
      priceOptionEntryIsValid(
        emptyPriceOption({ name: "Squad", priceMajor: "10", priceBasis: "group", groupMax: 1 }),
        false,
      ),
    ).toBe(false);
    expect(
      priceOptionEntryIsValid(
        emptyPriceOption({ name: "Squad", priceMajor: "10", priceBasis: "group", groupMax: Number.NaN }),
        false,
      ),
    ).toBe(false);
  });

});

describe("#4490 block lengths", () => {
  it("offers 15 minutes to 8 hours", () => {
    expect(EXPERIENCE_BLOCK_MINUTES).toEqual([15, 30, 45, 60, 90, 120, 180, 240, 360, 480]);
  });

  it("a 120-minute block is a valid, sendable choice", () => {
    const option = emptyPriceOption({
      name: "Lane hire",
      priceMajor: "20",
      priceBasis: "block",
      blockMinutes: 120,
      minBlocks: 1,
      maxBlocks: 3,
    });
    expect(priceOptionEntryIsValid(option, false)).toBe(true);
    expect(priceOptionToPayload(option).block_minutes).toBe(120);
  });

  it("narrows stored lengths and labels them compactly", () => {
    expect(toExperienceBlockMinutes(120)).toBe(120);
    expect(toExperienceBlockMinutes(50)).toBeNull();
    expect(toExperienceBlockMinutes(null)).toBeNull();
    expect(experienceBlockPillLabel(45)).toBe("45m");
    expect(experienceBlockPillLabel(60)).toBe("1h");
    expect(experienceBlockPillLabel(90)).toBe("1h 30m");
    expect(experienceBlockPillLabel(480)).toBe("8h");
  });
});

describe("#4490 carried from the backend review: a blank price name blocks Continue", () => {
  it("a blank or spaces-only name is an issue on the field, with plain copy", () => {
    expect(priceOptionNameIssue({ name: "" })).toBe(PRICE_NAME_REQUIRED_COPY);
    expect(priceOptionNameIssue({ name: "   " })).toBe(PRICE_NAME_REQUIRED_COPY);
    expect(priceOptionNameIssue({ name: "Walk-in" })).toBeNull();
  });
  it("an unnamed option is never valid for Continue, priced, free or hidden", () => {
    expect(priceOptionEntryIsValid(emptyPriceOption({ name: "", priceMajor: "10" }), false)).toBe(false);
    expect(priceOptionEntryIsValid(emptyPriceOption({ name: "", priceMajor: "" }), true)).toBe(false);
    expect(priceOptionEntryIsValid(emptyPriceOption({ name: " ", isHidden: true }), false)).toBe(false);
    expect(priceOptionEntryIsValid(emptyPriceOption({ name: "Walk-in", priceMajor: "10" }), false)).toBe(true);
  });
});
