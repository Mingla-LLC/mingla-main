/**
 * issue #3380 — ONE SET OF RULES FOR A PHONE NUMBER A PERSON TYPES.
 *
 * Lives in the Business jest suite (the required gate) on purpose: the rules
 * are in `packages/phone-input/phoneNumber.ts`, and a test beside the package
 * would run nowhere. Imported by DEEP specifier so no barrel mock can stand in
 * for the real module.
 *
 * What Seth saw (2026-09-15): a Lagos guest typing `0803 123 4567` was refused
 * on the US flag with "Enter a valid phone number.", and quietly saved as
 * `+448031234567` on the UK flag. The ordering server turned `803 123 4567`
 * into a South Carolina number.
 *
 * FAILS ON REVERT: delete `phoneNumber.ts` and this suite cannot import; restore
 * the old `dialCode + digits` join and the Nigerian cases fail.
 */
import { describe, expect, test } from "@jest/globals";

import {
  composePhoneE164,
  formatPhoneNational,
  parsePhoneEntry,
  reformatPhoneEdit,
  resolvePhoneStartCountry,
} from "@mingla/phone-input/phoneNumber";

const e164 = (
  raw: string,
  countryIso: string | null,
  mode: "mobile" | "any" = "mobile",
): string | null => {
  const result = parsePhoneEntry(raw, { countryIso, mode });
  return result.ok ? result.e164 : null;
};

describe("#3380 Nigerian numbers, written the way Nigerians write them", () => {
  test.each([
    "0803 123 4567",
    "08031234567",
    "803 123 4567",
    "8031234567",
    "+234 803 123 4567",
    "+2348031234567",
    "+234 (0) 803 123 4567",
    "2348031234567",
  ])("%s on the Nigerian flag is +2348031234567", (raw) => {
    expect(e164(raw, "NG")).toBe("+2348031234567");
  });

  test("a wrong-length Nigerian number says how many digits it needs", () => {
    const result = parsePhoneEntry("080312345", { countryIso: "NG" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe("too_short");
    expect(result.message).toBe(
      "Nigerian mobile numbers have 10 digits after the 0 — you entered 8.",
    );
  });

  test("a Nigerian landline is refused where the number will be texted", () => {
    const result = parsePhoneEntry("0201 234 5678", { countryIso: "NG" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/Nigerian mobile numbers start with 07, 08 or 09/);
  });
});

describe("#3380 a number is never saved under the wrong country", () => {
  test("0803… on the UK flag is REFUSED and names Nigeria (was +448031234567)", () => {
    const result = parsePhoneEntry("08031234567", { countryIso: "GB" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe("wrong_country");
    expect(result.suggestedCountryIso).toBe("NG");
    expect(result.message).toContain("Nigeria (+234)");
  });

  test("0803… on the US flag names Nigeria instead of a vague refusal", () => {
    const result = parsePhoneEntry("0803 123 4567", { countryIso: "US" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.suggestedCountryIso).toBe("NG");
    expect(result.message).not.toBe("Enter a valid phone number.");
  });

  test("803 123 4567 on the US flag is not turned into +1 803…", () => {
    expect(e164("803 123 4567", "US")).toBeNull();
  });

  test("a UK mobile typed under Nigeria names the UK", () => {
    const result = parsePhoneEntry("07911 123456", { countryIso: "NG" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.suggestedCountryIso).toBe("GB");
  });

  test("a typed +code wins over the picker, and reports the country to follow", () => {
    const result = parsePhoneEntry("+234 803 123 4567", { countryIso: "US" });
    expect(result).toEqual({ ok: true, e164: "+2348031234567", countryIso: "NG" });
    expect(parsePhoneEntry("0044 7700 900123", { countryIso: "NG" })).toEqual({
      ok: true,
      e164: "+447700900123",
      countryIso: "GB",
    });
  });
});

describe("#3380 UK and US local formats", () => {
  test("UK drops the leading 0", () => {
    expect(e164("07700 900123", "GB")).toBe("+447700900123");
    expect(e164("7700 900123", "GB")).toBe("+447700900123");
  });

  test("a UK landline is fine for a contact line, refused for a text", () => {
    expect(e164("020 7946 0000", "GB", "any")).toBe("+442079460000");
    expect(e164("020 7946 0000", "GB", "mobile")).toBeNull();
  });

  test.each(["4155550123", "(415) 555-0123", "415-555-0123", "1 415 555 0123", "+1 415 555 0123"])(
    "US 10 digits: %s",
    (raw) => {
      expect(e164(raw, "US")).toBe("+14155550123");
    },
  );

  test("a US number with the wrong digit count says so", () => {
    const result = parsePhoneEntry("415555012", { countryIso: "US" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("US and Canadian numbers have 10 digits — you entered 9.");
  });

  test("Canada shares the plan but keeps its own flag", () => {
    expect(parsePhoneEntry("416 555 0123", { countryIso: "CA" })).toEqual({
      ok: true,
      e164: "+14165550123",
      countryIso: "CA",
    });
  });
});

describe("#3380 countries nobody has characterised still work", () => {
  test("Australia through the picker's dial code", () => {
    expect(
      parsePhoneEntry("0412 345 678", { countryIso: "AU", dialCode: "+61" }),
    ).toEqual({ ok: true, e164: "+61412345678", countryIso: "AU" });
  });

  test("no country and no + asks for the country, never guesses", () => {
    const result = parsePhoneEntry("803 123 4567", {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe("country_required");
  });

  test("empty input is empty, not invalid", () => {
    const result = parsePhoneEntry("  ", { countryIso: "NG" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe("empty");
  });
});

describe("#3380 checkout keeps every answer it gave (composeE164 is now a view)", () => {
  test.each([
    ["+234", "09076649069", "+2349076649069"],
    ["+234", "0803 123 4567", "+2348031234567"],
    ["+234", "2348012345678", "+2348012345678"],
    ["+1", "2345551234", "+12345551234"],
    ["+39", "0612345678", "+390612345678"],
    ["+61", "0412345678", "+61412345678"],
    ["+44", "020 7946 0000", "+442079460000"],
  ])("composePhoneE164(%s, %s) → %s", (dial, local, expected) => {
    expect(composePhoneE164(dial, local)).toBe(expected);
  });

  test.each([
    ["+1", "09069902335"],
    ["+44", "2348158037496"],
    ["+234", "080312345678"],
    ["+234", "80312345"],
    ["+234", ""],
    ["+234", "000"],
  ])("composePhoneE164(%s, %s) → null", (dial, local) => {
    expect(composePhoneE164(dial, local)).toBeNull();
  });
});

describe("#3380 formatting as you type keeps the person's place", () => {
  test.each([
    ["NG", "08031234567", "0803 123 4567"],
    ["NG", "8031234567", "803 123 4567"],
    ["GB", "07700900123", "07700 900123"],
    ["GB", "02079460000", "020 7946 0000"],
    ["US", "4155550123", "(415) 555-0123"],
    ["US", "4155", "(415) 5"],
  ])("%s %s → %s", (iso, raw, formatted) => {
    expect(formatPhoneNational(iso, raw)).toBe(formatted);
  });

  test("an uncharacterised country keeps what was typed", () => {
    expect(formatPhoneNational("AU", "0412 345 678")).toBe("0412 345 678");
  });

  test("a digit inserted mid-number keeps the cursor after that digit", () => {
    // "0803 123 4567" → the person types 9 after "0803 12".
    const result = reformatPhoneEdit({
      countryIso: "NG",
      previousText: "0803 124567",
      nextText: "0803 1294567",
      cursor: 8,
    });
    expect(result.text).toBe("0803 129 4567");
    expect(result.text.slice(0, result.cursor)).toBe("0803 129");
  });

  test("backspacing over a separator removes the digit before it", () => {
    const result = reformatPhoneEdit({
      countryIso: "NG",
      previousText: "0803 123",
      nextText: "0803123",
      cursor: 4,
    });
    // Without this the reformat would put the space straight back and the
    // key would appear to do nothing.
    expect(result.text).toBe("0801 23");
    expect(result.cursor).toBe(3);
  });
});

describe("#3380 the picker starts on the venue's country", () => {
  const known = (iso: string): boolean => ["NG", "US", "GB"].includes(iso);

  test("venue country first, then brand, then device", () => {
    expect(resolvePhoneStartCountry(["NG", "GB", "US"], known)).toBe("NG");
    expect(resolvePhoneStartCountry([null, "gb", "US"], known)).toBe("GB");
    expect(resolvePhoneStartCountry([undefined, "", "US"], known)).toBe("US");
  });

  test("a code the directory does not know never becomes a flag", () => {
    expect(resolvePhoneStartCountry(["XX", "Nigeria", null], known)).toBeNull();
  });
});
