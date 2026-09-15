/**
 * issue #3380 — the Explorer app's venue ordering and reservation phone fields.
 *
 * Lives in the Business jest suite (the one required gate) as a SOURCE scan
 * because app-mobile modules pull React Native and the consumer app has no
 * required jest lane. Comments are stripped first so prose cannot satisfy it.
 *
 * FAILS ON REVERT:
 *   - remove `renderPhoneField` from ConsumerVenueOrderingSheet and the Explorer
 *     "Who's ordering?" is a free-text box again;
 *   - restore `buildPendingCollabPhoneE164` in VenueReserveSheet and 0803… under
 *     +234 is sent as +23408031234567 again;
 *   - drop `countryCode` from the read model or the route and every picker on
 *     the venue page starts on the device region instead of the venue's country.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parsePhoneEntry } from "@mingla/phone-input/phoneNumber";

const repo = join(__dirname, "..", "..", "..", "..", "..");
const code = (relative: string): string =>
  readFileSync(join(repo, relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const SLOTS = "app-mobile/src/components/venueOrdering/ConsumerVenueOrderingSlots.tsx";
const RESERVE = "app-mobile/src/components/expandedCard/VenueReserveSheet.tsx";
const ROUTE = "app-mobile/app/b/[brandSlug]/v/[venueSlug].tsx";
const READ_MODEL = "app-mobile/src/services/publicVenueService.ts";
const WRAPPER = "app-mobile/src/components/onboarding/PhoneInput.tsx";

describe("#3380 Explorer 'Who's ordering?'", () => {
  test("the review sheet renders the country picker, not the free-text box", () => {
    const slots = code(SLOTS);
    expect(slots).toContain("renderPhoneField={(args) => (");
    expect(slots).toContain("<ConsumerVenueOrderPhoneField");
    expect(slots).toMatch(/<PhoneInput\s+smartEntry/);
    expect(slots).toContain("phoneFailure={");
    expect(slots).toContain('mode: "mobile"');
  });

  test("the picker starts on the venue's country and writes it into the order", () => {
    const slots = code(SLOTS);
    expect(slots).toContain("resolvePhoneStartCountry(");
    expect(slots).toContain("[venueCountry, device]");
    expect(slots).toContain("onChange({ phoneCountryIso: start });");
    expect(slots).toContain("onChange({ phoneCountryIso: iso });");
    expect(slots).toContain("const slotProps = { ordering, palette, surface, theme, countryCode };");
  });
});

describe("#3380 Explorer venue reservation sheet", () => {
  test("uses the shared rules instead of joining the dial code to the digits", () => {
    const reserve = code(RESERVE);
    expect(reserve).not.toContain("buildPendingCollabPhoneE164");
    expect(reserve).toContain("parsePhoneEntry(phoneInput, {");
    expect(reserve).toContain("reservePhoneStartCountry(venueCountryCode)");
    expect(reserve).toMatch(/<PhoneInput\s+smartEntry/);
    expect(reserve).toContain(
      'setError(phoneProblem ?? "Add a phone number so the venue can reach you.");',
    );
  });

  test("the old join produced a wrong number the new rules refuse to build", () => {
    // What `dialCode + digits` sent for a Nigerian typing their number normally.
    expect(`+234${"08031234567"}`).toBe("+23408031234567");
    const parsed = parsePhoneEntry("0803 123 4567", { countryIso: "NG" });
    expect(parsed).toEqual({ ok: true, e164: "+2348031234567", countryIso: "NG" });
  });
});

describe("#3380 the Explorer venue page knows its country", () => {
  test("the read model maps country_code", () => {
    const model = code(READ_MODEL);
    expect(model).toContain("countryCode: string | null;");
    expect(model).toContain("country_code?: string | null;");
    expect(model).toMatch(/countryCode:\s*typeof row\.country_code === "string"/);
  });

  test("the route hands it to both the reservation sheet and ordering", () => {
    const route = code(ROUTE);
    expect(route.match(/countryCode=\{venue\.countryCode\}/g) ?? []).toHaveLength(2);
  });

  test("the app's PhoneInput wrapper passes smart entry through", () => {
    expect(code(WRAPPER)).toContain("smartEntry?: boolean;");
  });
});
