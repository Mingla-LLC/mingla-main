/**
 * issue #3281 Round 1 PR 1a — Host-side implementor pins.
 * Fails on revert of: brand timezone default, When-step experience noun,
 * pricing summary formatter, and zone-aware reserve picker wiring.
 */

import fs from "node:fs";
import path from "node:path";

import {
  defaultTimezoneForBrand,
  detectDeviceTimezone,
} from "../timezones";

const root = path.resolve(__dirname, "../../..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(root, rel), "utf8");

describe("issue #3281 Round 1 PR 1a — Host wording / zone / money", () => {
  it("defaults NGN / NG brands to Africa/Lagos (not the device zone)", () => {
    expect(
      defaultTimezoneForBrand({
        payoutCountry: "NG",
        currency: "USD",
        deviceZone: "America/New_York",
      }),
    ).toBe("Africa/Lagos");
    expect(
      defaultTimezoneForBrand({
        payoutCountry: null,
        currency: "NGN",
        deviceZone: "America/New_York",
      }),
    ).toBe("Africa/Lagos");
    expect(
      defaultTimezoneForBrand({
        payoutCountry: null,
        currency: null,
        deviceZone: "Europe/Berlin",
      }),
    ).toBe("Europe/Berlin");
    expect(typeof detectDeviceTimezone()).toBe("string");
  });

  it("CreatorStep2When accepts offeringNoun and experience copy", () => {
    const when = read("src/components/event/CreatorStep2When.tsx");
    expect(when).toMatch(/offeringNoun = "event"/);
    expect(when).toMatch(/Opens/);
    expect(when).toMatch(/Open \$\{h\} hours/);
    expect(when).toMatch(/How often does this \{noun\} happen\?/);
  });

  it("ExperienceCreatorWizard passes offeringNoun=experience and brand tz hints", () => {
    const wiz = read("src/components/experience/ExperienceCreatorWizard.tsx");
    expect(wiz).toMatch(/offeringNoun="experience"/);
    expect(wiz).toMatch(/defaultTimezoneForBrand|brandTzHints|payoutCountry/);
    expect(wiz).toMatch(/priceDecimals/);
  });

  it("ExperiencePricingStep formats totals with priceDecimals (not toFixed(2))", () => {
    const step = read("src/components/experience/ExperiencePricingStep.tsx");
    expect(step).toMatch(/priceDecimals/);
    expect(step).toMatch(/formatSummaryTotal/);
    expect(step).not.toMatch(/resolvedTotalMajor\.toFixed\(2\)/);
    expect(step).toMatch(/formatSummaryTotal\(resolvedTotalMajor\)/);
  });

  it("ExperienceReservePicker uses experienceTimeZone (no getHours)", () => {
    const picker = read("src/components/experience/ExperienceReservePicker.tsx");
    expect(picker).toMatch(/experienceTimeChoices/);
    expect(picker).toMatch(/unitAllInCents/);
    expect(picker).not.toMatch(/\.getHours\s*\(/);
  });

  it("FAIL-ON-REVERT: adapter seeds timezone via defaultTimezoneForBrand", () => {
    const adapter = read("src/hooks/useExperienceDraftAdapter.ts");
    expect(adapter).toMatch(/defaultTimezoneForBrand/);
    expect(adapter).not.toMatch(
      /timezone: initialWhen\?\.timezone \?\? detectDeviceTimezone\(\)/,
    );
  });
});
