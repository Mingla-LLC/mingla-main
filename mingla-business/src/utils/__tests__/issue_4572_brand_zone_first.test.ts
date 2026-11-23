/**
 * #4572 item 7e (D9) — a new event, RSVP or experience starts in the brand's
 * saved time zone, then the payout / payment country, then the currency, then
 * the device.
 *
 * FAILS-ON-REVERT (true line deletion):
 *   - delete the `brandZone` branch in defaultTimezoneForBrand → BZ-1 / BZ-2 fail;
 *   - delete `if (draftDate !== null) return null;` → BZ-5 fails;
 *   - delete the brandZoneForNewDraft effect from EventCreatorWizard or
 *     RsvpCreatorWizard, or `brandZone:` from the experience wizard → BZ-7 fails.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { brandZoneForNewDraft, defaultTimezoneForBrand } from "../timezones";

const NY = "America/New_York";

describe("#4572 7e brand zone first", () => {
  test("BZ-1 the brand's saved zone wins over a New York device", () => {
    expect(defaultTimezoneForBrand({ brandZone: "Africa/Lagos", deviceZone: NY })).toBe("Africa/Lagos");
  });

  test("BZ-2 the saved zone wins even when the payout country implies another", () => {
    expect(
      defaultTimezoneForBrand({ brandZone: "Africa/Lagos", payoutCountry: "GB", currency: "GBP", deviceZone: NY }),
    ).toBe("Africa/Lagos");
  });

  test("BZ-3 adversarial: an invalid saved zone falls through to the country", () => {
    expect(
      defaultTimezoneForBrand({ brandZone: "Not/AZone", payoutCountry: "NG", deviceZone: NY }),
    ).toBe("Africa/Lagos");
    expect(defaultTimezoneForBrand({ brandZone: "   ", currency: "GBP", deviceZone: NY })).toBe("Europe/London");
  });

  test("BZ-4 a new undated draft on the device zone moves to the brand zone", () => {
    expect(
      brandZoneForNewDraft({
        brand: { defaultTimezone: "Africa/Lagos", payoutCountry: "US" },
        draftDate: null,
        draftTimezone: NY,
        deviceZone: NY,
      }),
    ).toBe("Africa/Lagos");
  });

  test("BZ-5 a dated draft never changes zone", () => {
    expect(
      brandZoneForNewDraft({
        brand: { defaultTimezone: "Africa/Lagos" },
        draftDate: "2026-12-06",
        draftTimezone: NY,
        deviceZone: NY,
      }),
    ).toBeNull();
  });

  test("BZ-6 a host-picked zone (not the device default) and a missing brand are left alone", () => {
    expect(
      brandZoneForNewDraft({
        brand: { defaultTimezone: "Africa/Lagos" },
        draftDate: null,
        draftTimezone: "Europe/Paris",
        deviceZone: NY,
      }),
    ).toBeNull();
    expect(brandZoneForNewDraft({ brand: null, draftDate: null, draftTimezone: NY, deviceZone: NY })).toBeNull();
  });

  test("BZ-7 every wizard reads the one rule", () => {
    const REPO = join(__dirname, "..", "..", "..");
    const code = (rel: string): string =>
      readFileSync(join(REPO, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    for (const rel of [
      "src/components/event/EventCreatorWizard.tsx",
      "src/components/rsvp/RsvpCreatorWizard.tsx",
    ]) {
      const src = code(rel);
      expect(src).toMatch(/brandZoneForNewDraft\(\{\s*brand,\s*draftDate: liveDraft\.date,/);
      expect(src).toContain("updateDraft(liveDraft.id, { timezone: zone })");
    }
    expect(code("src/components/experience/ExperienceCreatorWizard.tsx")).toContain(
      "brandZone: brand?.defaultTimezone ?? null",
    );
    expect(code("src/hooks/useExperienceDraftAdapter.ts")).toContain("brandZone: brandTzHints?.brandZone");
  });
});
