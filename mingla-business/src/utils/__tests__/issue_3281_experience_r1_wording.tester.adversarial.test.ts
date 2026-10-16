/**
 * issue #3281 Round 1 PR 1a — independent tester adversarial pins.
 */

import fs from "node:fs";
import path from "node:path";

import { defaultTimezoneForBrand } from "../timezones";

const root = path.resolve(__dirname, "../../..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(root, rel), "utf8");

describe("issue #3281 Round 1 PR 1a — adversarial", () => {
  it("unknown country falls through to currency then device", () => {
    expect(
      defaultTimezoneForBrand({
        payoutCountry: "ZZ",
        currency: "GBP",
        deviceZone: "Pacific/Honolulu",
      }),
    ).toBe("Europe/London");
    expect(
      defaultTimezoneForBrand({
        payoutCountry: "ZZ",
        currency: "ZZZ",
        deviceZone: "Pacific/Honolulu",
      }),
    ).toBe("Pacific/Honolulu");
  });

  it("event wizard does NOT pass offeringNoun (stays event copy)", () => {
    const eventWizard = read("src/components/event/EventCreatorWizard.tsx");
    expect(eventWizard).not.toMatch(/offeringNoun=/);
  });

  it("consumer twin also bans getHours and wires zone helpers", () => {
    const consumer = fs.readFileSync(
      path.join(
        root,
        "../app-mobile/src/components/expandedCard/ExperienceReservePicker.tsx",
      ),
      "utf8",
    );
    expect(consumer).toMatch(/experienceTimeChoices/);
    expect(consumer).not.toMatch(/\.getHours\s*\(/);
    expect(consumer).toMatch(/unitAllInCents/);
  });

  it("section-order gate anchor '(8) The itinerary' still present in body source", () => {
    const body = fs.readFileSync(
      path.join(
        root,
        "../packages/offering-rendering/ExperienceOfferingBody.tsx",
      ),
      "utf8",
    );
    expect(body).toContain("(8) The itinerary");
  });
});
