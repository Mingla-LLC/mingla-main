/**
 * issue #3380 rework — a number typed under the wrong country is refused, and
 * a picked country survives re-opening inside a shared dial code.
 *
 * The defect: every production brand with a phone has no country, so a stored
 * `08031234567` opens under the default +44 flag. Changing one digit and
 * saving stored `+448031234567`, and the public page dialled a stranger in the
 * UK. The typed-edit branch composed the number with no wrong-country check.
 *
 * FAILS ON REVERT: delete the `if (!text.startsWith("+")) { … }` probe block
 * in `brandPhoneForSave` and every "is refused" case below saves a +44 number.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

import {
  mapBrandRowToUi,
  mapUiToBrandUpdatePatch,
  type BrandRow,
} from "../../../services/brandMapping";
import type { Brand } from "../../../store/currentBrandStore";
import { computeDirtyFieldsPatch } from "../../../utils/brandPatch";
import {
  brandContactWithSavedPhone,
  brandPhoneCountryFromStored,
  brandPhoneForEdit,
  brandPhoneForSave,
  brandPhoneSessionCountryIso,
  rememberBrandPhoneSavedCountry,
  type BrandPhoneDirectory,
} from "../brandContactPhoneRules";

const source = (relativePath: string): string =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

// The country list the chip really shows.
const DIRECTORY: BrandPhoneDirectory = [
  ...source("src/components/ui/Input.tsx").matchAll(
    /\{ iso: "([A-Z]{2})", name: "[^"]*", dialCode: "(\+\d+)"/g,
  ),
].map((match) => ({ iso: match[1], dialCode: match[2] }));

const row = (overrides: Partial<BrandRow>): BrandRow =>
  ({
    id: "brand-3380-rework",
    account_id: "account-3380-rework",
    name: "Rework Supper Club",
    slug: "rework-supper-club",
    description: null,
    profile_photo_url: null,
    contact_email: "hello@example.test",
    contact_phone: null,
    social_links: null,
    custom_links: null,
    display_attendee_count: true,
    country_code: null,
    ...overrides,
  }) as BrandRow;

const typed = (
  text: string,
  countryIso: string,
  stored: string | null = null,
  brandCountryCode: string | null = null,
) =>
  brandPhoneForSave({
    stored,
    brandCountryCode,
    edit: { text, countryIso },
    directory: DIRECTORY,
  });

/** Pick a country, type a number, save through the editor's path, re-open. */
const saveThenReopen = (input: {
  pickedIso: string;
  text: string;
  brandCountryCode: string | null;
}): { stored: string | undefined; reopened: ReturnType<typeof brandPhoneForEdit> } => {
  const saved = typed(input.text, input.pickedIso, null, input.brandCountryCode);
  if (!saved.ok) throw new Error(`save refused: ${saved.message}`);
  // What BrandEditView does after a successful save.
  rememberBrandPhoneSavedCountry(saved);
  return {
    stored: saved.phone,
    reopened: brandPhoneForEdit(saved.phone, input.brandCountryCode, DIRECTORY),
  };
};

describe("issue #3380 rework — a number typed under the wrong country is refused", () => {
  test.each(["08031234567", "7031234568", "09131234567", "9131234567"])(
    "%p typed under the UK flag is refused with the message that names Nigeria",
    (text) => {
      const result = typed(text, "GB");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/^That looks like a Nigerian number, not a \+44 one\./);
      expect(result.message).toContain("Change the country to Nigeria (+234).");
    },
  );

  test("the production case: a legacy number opened under the default +44 flag, one digit changed, is not stored as a UK number", () => {
    // Opens under GB because the brand has no country.
    const opened = brandPhoneForEdit("08031234567", null, DIRECTORY);
    expect(opened).toMatchObject({ countryIso: "GB", localText: "08031234567" });

    const result = typed("08031234568", opened.countryIso, "08031234567", null);
    expect(result.ok).toBe(false);
    expect(result).not.toMatchObject({ phone: "+448031234568" });

    // The same digits under the country they belong to save as that country's number.
    expect(typed("08031234568", "NG", "08031234567", null)).toEqual({
      ok: true,
      phone: "+2348031234568",
      phoneCountryIso: "NG",
    });
  });

  test("changing only the chip over a legacy number is judged the same way", () => {
    // Untouched text, chip moved to the US: still a Nigerian number.
    const result = typed("08031234567", "US", "08031234567", null);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/Nigeria/);
  });

  test.each([
    ["020 7946 0000", "+442079460000"],
    ["07911 123456", "+447911123456"],
    ["0800 123 4567", "+448001234567"],
    ["0800 123456", "+44800123456"],
  ])("a real UK number %p still saves under the UK flag as %s", (text, expected) => {
    expect(typed(text, "GB")).toEqual({ ok: true, phone: expected, phoneCountryIso: "GB" });
  });

  test("a UK mobile typed under the Nigerian flag is refused too, naming the UK", () => {
    const result = typed("07911 123456", "NG");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/UK number/);
  });

  test("a typed + names its own country and is never second-guessed", () => {
    expect(typed("+234 803 123 4567", "GB")).toEqual({
      ok: true,
      phone: "+2348031234567",
      phoneCountryIso: "NG",
    });
    // A UK range the probe cannot tell from a Nigerian mobile is still reachable with +44.
    expect(typed("+44 808 157 0192", "GB")).toMatchObject({ ok: true, phone: "+448081570192" });
  });

  test("clearing the box is never refused, whatever was there", () => {
    expect(typed("", "GB", "08031234567", null)).toEqual({
      ok: true,
      phone: undefined,
      phoneCountryIso: undefined,
    });
  });
});

describe("issue #3380 rework — an untouched legacy number is not given another country's code", () => {
  const saveOtherField = (before: BrandRow) => {
    const brand = mapBrandRowToUi(before, { role: "owner" });
    const draft: Brand = { ...brand, displayName: "Renamed" };
    const phoneToSave = brandPhoneForSave({
      stored: draft.contact?.phone,
      brandCountryCode: draft.countryCode,
      edit: null,
      directory: DIRECTORY,
    });
    if (!phoneToSave.ok) throw new Error(phoneToSave.message);
    const patch = computeDirtyFieldsPatch(
      { ...draft, contact: brandContactWithSavedPhone(draft.contact, phoneToSave) },
      brand,
    );
    return mapUiToBrandUpdatePatch(patch) as { contact_phone?: string | null };
  };

  test.each([
    ["08031234567", "GB"],
    ["7031234568", "GB"],
    ["09131234567", "GB"],
    ["9131234567", "GB"],
    ["07911123456", "NG"],
    ["08031234567", "US"],
    ["N/A", "NG"],
    ["08031234567", null],
  ])(
    "legacy %p on a brand in %p: saving another field leaves it out of the UPDATE",
    (legacy, country) => {
      const written = saveOtherField(row({ contact_phone: legacy, country_code: country }));
      expect(Object.prototype.hasOwnProperty.call(written, "contact_phone")).toBe(false);
    },
  );
});

describe("issue #3380 rework — the picked country survives re-opening", () => {
  test("a Bahamas number re-opens under the Bahamas, on any brand, with no memory of the pick", () => {
    for (const brandCountry of [null, "US", "CA", "NG", "BS"]) {
      // Explicit null: nothing remembered from this run of the app.
      expect(brandPhoneForEdit("+12425551234", brandCountry, DIRECTORY, null)).toEqual({
        localText: "5551234",
        countryIso: "BS",
        savedWithCountry: true,
      });
    }
  });

  test("saved under the Bahamas, re-opened under the Bahamas, same number", () => {
    const { stored, reopened } = saveThenReopen({
      pickedIso: "BS",
      text: "555 1234",
      brandCountryCode: null,
    });
    expect(stored).toBe("+12425551234");
    expect(reopened).toEqual({ localText: "5551234", countryIso: "BS", savedWithCountry: true });
  });

  test("saved under Canada on a brand with no country, it re-opens under Canada", () => {
    const { stored, reopened } = saveThenReopen({
      pickedIso: "CA",
      text: "(604) 555-0142",
      brandCountryCode: null,
    });
    expect(stored).toBe("+16045550142");
    expect(reopened).toEqual({ localText: "6045550142", countryIso: "CA", savedWithCountry: true });
    expect(brandPhoneSessionCountryIso("+16045550142")).toBe("CA");
  });

  test("saved under Kazakhstan on a brand with no country, it re-opens under Kazakhstan", () => {
    const { stored, reopened } = saveThenReopen({
      pickedIso: "KZ",
      text: "701 234 5679",
      brandCountryCode: null,
    });
    expect(stored).toBe("+77012345679");
    expect(reopened.countryIso).toBe("KZ");
  });

  test("the brand's own country comes before the pick, and the pick before the first match", () => {
    const number = "+16045550199";
    // Nothing known: today's first match.
    expect(brandPhoneCountryFromStored(number, null, DIRECTORY, null)?.iso).toBe("US");
    // The pick decides when the brand has no country…
    expect(brandPhoneCountryFromStored(number, null, DIRECTORY, "CA")?.iso).toBe("CA");
    // …or a country outside the shared code…
    expect(brandPhoneCountryFromStored(number, "NG", DIRECTORY, "CA")?.iso).toBe("CA");
    // …but the brand's own country inside the code wins.
    expect(brandPhoneCountryFromStored(number, "US", DIRECTORY, "CA")?.iso).toBe("US");
    expect(brandPhoneCountryFromStored(number, "CA", DIRECTORY, "US")?.iso).toBe("CA");
    // A pick from a different dial code is ignored, never trusted.
    expect(brandPhoneCountryFromStored(number, null, DIRECTORY, "NG")?.iso).toBe("US");
    expect(brandPhoneCountryFromStored("+12425551234", null, DIRECTORY, "US")?.iso).toBe("BS");
  });

  test("the dialled number is the same whichever country the chip shows", () => {
    const dial = (iso: string): string =>
      DIRECTORY.find((country) => country.iso === iso)?.dialCode ?? "";
    for (const pick of [null, "CA", "US", "PR"]) {
      const opened = brandPhoneForEdit("+16045550142", null, DIRECTORY, pick);
      expect(`${dial(opened.countryIso)}${opened.localText}`).toBe("+16045550142");
    }
  });

  test("only a successful save of a real number is remembered", () => {
    rememberBrandPhoneSavedCountry({ ok: true, phone: "08031234567", phoneCountryIso: undefined });
    rememberBrandPhoneSavedCountry({ ok: true, phone: undefined, phoneCountryIso: undefined });
    expect(brandPhoneSessionCountryIso("08031234567")).toBeNull();
    expect(brandPhoneSessionCountryIso(null)).toBeNull();
  });

  test("the editor remembers the pick after a save, and still opens through the same rule", () => {
    const editor = source("src/components/brand/BrandEditView.tsx");
    const afterSave = editor.slice(editor.indexOf("await onSave(draftToSave);"));
    expect(afterSave.indexOf("rememberBrandPhoneSavedCountry(phoneToSave)")).toBeGreaterThan(0);
    expect(afterSave.indexOf("rememberBrandPhoneSavedCountry(phoneToSave)")).toBeLessThan(
      afterSave.indexOf("setPhoneEdit(null);"),
    );
    expect(editor).toContain("brandPhoneForEdit(savedPhone, brandCountryCode, PHONE_COUNTRIES)");
  });
});
