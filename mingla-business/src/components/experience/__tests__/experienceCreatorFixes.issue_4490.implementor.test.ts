/**
 * #4490 P1-4 — experience creator fixes (Host side).
 *
 * 1. Group size: no 50-person clamp in the payload, the validator or the input.
 * 2. Block length: 15 minutes up to 8 hours; a stored long block survives an edit.
 * 3. No forced "Standard": options start unnamed and a blank name is sent as typed;
 *    the server refuses it (experience_price_name_required) with its own copy.
 * 4. New experiences ask the server to share spots across price options.
 * 5. A processing cover video: the wizard adopts the server's cover and has copy
 *    for the two new server codes.
 *
 * MINGLA-INVARIANT: I-4490-EXPERIENCE-NO-FORCED-STANDARD | issue #4490 | no Host
 * code path names a price option "Standard" on the host's behalf; the host names
 * every price, and the server refuses a blank name.
 */

import fs from "node:fs";
import path from "node:path";

import {
  EXPERIENCE_BLOCK_MINUTES,
  emptyPriceOption,
  experienceBlockPillLabel,
  priceOptionEntryIsValid,
  priceOptionToPayload,
  toExperienceBlockMinutes,
} from "../experienceWizardTypes";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(ROOT, relative), "utf8");

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

describe("#4490 wizard wiring (source)", () => {
  const pricing = read("src/components/experience/ExperiencePricingStep.tsx");
  const wizard = read("src/components/experience/ExperienceCreatorWizard.tsx");
  const edit = read("app/experience/[id]/edit.tsx");
  const types = read("src/components/experience/experienceWizardTypes.ts");

  it("has no 50-person clamp and names every price, the first one too", () => {
    expect(pricing).not.toMatch(/Math\.min\(\s*50/);
    expect(types).not.toMatch(/Math\.min\(\s*50/);
    expect(pricing).not.toMatch(/index > 0 \? \(\s*<>\s*<Text style=\{styles\.fieldLabel\}>Name/);
    expect(pricing).toContain("Group size must be at least 2 people.");
    expect(pricing).not.toContain("Group size must be 2–50 people.");
  });

  it("never seeds or sends Standard", () => {
    expect(wizard).not.toMatch(/name:\s*"Standard"/);
    expect(edit).not.toMatch(/name:\s*"Standard"/);
    expect(types).not.toMatch(/"Standard"/);
  });

  it("keeps long blocks on edit", () => {
    expect(edit).not.toContain("[15, 30, 45, 60].includes");
    expect(edit).toContain("toExperienceBlockMinutes(t.blockMinutes)");
  });

  it("asks the server to share spots for a new experience only", () => {
    expect(wizard).toMatch(
      /existingExperienceId === undefined && !isLiveEdit\s*\?\s*\{ spots_shared: true \}/,
    );
  });

  it("has copy for the two new server codes and adopts the server cover", () => {
    expect(wizard).toContain('experience_price_name_required: "Give each price a name."');
    expect(wizard).toContain("Your cover video is still processing. Try again in a minute.");
    expect(wizard).toContain("useServerCoverAdoption({");
    expect(wizard).toMatch(/\.eq\("event_type", "experience"\)/);
  });
});
