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
    // [TEST-MOD-APPROVED #4420] the time grid lives in the shared hook the
    // sheet now reads (one owner for the sheet and the inline picker).
    expect(picker).toMatch(/useExperienceReserveState\(/);
    expect(read("../packages/offering-rendering/useExperienceReserveState.ts")).toMatch(/experienceTimeChoices/);
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

// issue #4522 G-5 — a new trip lives in the brand's own zone first
// (brands.default_timezone), then payout country, currency, device. Before:
// a Tokyo brand paid in USD got New York (its booking-deadline eve 14 hours off).
describe("issue #4522 G-5 — the brand's own zone comes first", () => {
  it("reads brandZone before payout country, currency and device", () => {
    expect(
      defaultTimezoneForBrand({
        brandZone: "Asia/Tokyo",
        payoutCountry: "US",
        currency: "USD",
        deviceZone: "Europe/Berlin",
      }),
    ).toBe("Asia/Tokyo");
  });
  it("falls back as before when the brand has no zone or an unknown one", () => {
    expect(
      defaultTimezoneForBrand({ brandZone: null, payoutCountry: "NG", currency: "USD" }),
    ).toBe("Africa/Lagos");
    expect(
      defaultTimezoneForBrand({ brandZone: "Not/AZone", payoutCountry: "NG" }),
    ).toBe("Africa/Lagos");
  });
  it("the new-trip and experience call sites pass the brand's zone", () => {
    expect(read("app/trip/[id]/edit.tsx")).toMatch(/brandZone: currentBrand\.defaultTimezone \?\? null/);
    expect(read("src/components/experience/ExperienceCreatorWizard.tsx")).toMatch(
      /brandZone: brand\?\.defaultTimezone \?\? null/,
    );
    expect(read("src/hooks/useExperienceDraftAdapter.ts")).toMatch(/brandZone: brandTzHints\?\.brandZone/);
  });
});

