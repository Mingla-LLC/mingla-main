/**
 * issue #3380 — the brand contact phone keeps its country across save and
 * re-open.
 *
 * Before: `brands.contact_phone` held only the digits typed in the box. The
 * country the host picked was never saved, so a +234 number re-opened under
 * the default +44 flag, and the public page dialled it with no country code.
 *
 * Now the number is saved as E.164 and the country and local digits are read
 * back out of it on open.
 *
 * FAILS ON REVERT:
 *   - restore `draft.contact?.phoneCountryIso ?? draft.countryCode ?? "GB"` in
 *     BrandEditView and the source checks fail;
 *   - restore `tel:${phone}` on the public page and a spaced E.164 number is
 *     dialled with its spaces;
 *   - delete brandContactPhoneRules.ts and nothing here can run.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

import { brandPhoneTelHref } from "../../../../../packages/brand-rendering/brandPhoneHref";
import {
  brandContactPhoneForStorage,
  mapBrandRowToUi,
  mapUiToBrandInsert,
  mapUiToBrandUpdatePatch,
  type BrandRow,
} from "../../../services/brandMapping";
import {
  brandContactWithSavedPhone,
  brandPhoneCountryFromStored,
  brandPhoneForEdit,
  brandPhoneForSave,
  type BrandPhoneDirectory,
} from "../brandContactPhoneRules";

const source = (relativePath: string): string =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

/**
 * The editor's own country list, read from the picker's source so the test
 * judges numbers against exactly what the chip shows (rendering the Input
 * itself is not needed to prove a pure rule).
 */
const DIRECTORY: BrandPhoneDirectory = [
  ...source("src/components/ui/Input.tsx").matchAll(
    /\{ iso: "([A-Z]{2})", name: "[^"]*", dialCode: "(\+\d+)"/g,
  ),
].map((match) => ({ iso: match[1], dialCode: match[2] }));

const brandRow = (overrides: Partial<BrandRow>): BrandRow =>
  ({
    id: "brand-3380",
    account_id: "account-3380",
    name: "Lagos Supper Club",
    slug: "lagos-supper-club",
    description: null,
    profile_photo_url: null,
    contact_email: null,
    contact_phone: null,
    social_links: null,
    custom_links: null,
    display_attendee_count: true,
    country_code: null,
    ...overrides,
  }) as BrandRow;

/** Pick a country, type a number, save, then open the editor again. */
const saveThenReopen = (input: {
  stored: string | null;
  brandCountryCode: string | null;
  pickedIso: string;
  typed: string;
}): {
  storedAfterSave: string | null;
  reopened: ReturnType<typeof brandPhoneForEdit>;
} => {
  const saved = brandPhoneForSave({
    stored: input.stored,
    brandCountryCode: input.brandCountryCode,
    edit: { text: input.typed, countryIso: input.pickedIso },
    directory: DIRECTORY,
  });
  if (!saved.ok) throw new Error(`save refused: ${saved.message}`);
  const contact = brandContactWithSavedPhone(
    input.stored === null ? undefined : { phone: input.stored },
    saved,
  );
  // The same mapper the update mutation writes with…
  const written = mapUiToBrandUpdatePatch({ contact });
  const storedAfterSave = written.contact_phone ?? null;
  // …and the same mapper the brand is read back with.
  const reread = mapBrandRowToUi(
    brandRow({
      contact_phone: storedAfterSave,
      country_code: input.brandCountryCode,
    }),
    { role: "owner" },
  );
  return {
    storedAfterSave,
    reopened: brandPhoneForEdit(
      reread.contact?.phone,
      reread.countryCode,
      DIRECTORY,
    ),
  };
};

describe("issue #3380 — brand phone keeps its country", () => {
  test("the picker directory was read", () => {
    expect(DIRECTORY.length).toBeGreaterThan(200);
    expect(DIRECTORY).toContainEqual({ iso: "NG", dialCode: "+234" });
  });

  test("a +234 number picked, saved and re-opened shows Nigeria and the same local digits", () => {
    const { storedAfterSave, reopened } = saveThenReopen({
      stored: null,
      brandCountryCode: null,
      pickedIso: "NG",
      typed: "8031234567",
    });

    expect(storedAfterSave).toBe("+2348031234567");
    expect(reopened).toEqual({
      localText: "8031234567",
      countryIso: "NG",
      savedWithCountry: true,
    });
  });

  test("it survives a second save without being touched, even on a UK brand", () => {
    const untouched = brandPhoneForSave({
      stored: "+2348031234567",
      brandCountryCode: "GB",
      edit: null,
      directory: DIRECTORY,
    });

    expect(untouched).toEqual({
      ok: true,
      phone: "+2348031234567",
      phoneCountryIso: "NG",
    });
    expect(brandPhoneForEdit("+2348031234567", "GB", DIRECTORY).countryIso).toBe("NG");
  });

  test("the number the way a Nigerian writes it is saved once, without the trunk zero", () => {
    const { storedAfterSave, reopened } = saveThenReopen({
      stored: null,
      brandCountryCode: "NG",
      pickedIso: "NG",
      typed: "0803 123 4567",
    });

    expect(storedAfterSave).toBe("+2348031234567");
    expect(reopened.countryIso).toBe("NG");
    expect(reopened.localText).toBe("8031234567");
  });

  test("other countries round-trip too, and a shared +1 opens under the brand's own country", () => {
    expect(
      saveThenReopen({ stored: null, brandCountryCode: null, pickedIso: "GB", typed: "07700 900123" }),
    ).toEqual({
      storedAfterSave: "+447700900123",
      reopened: { localText: "7700900123", countryIso: "GB", savedWithCountry: true },
    });
    expect(
      saveThenReopen({ stored: null, brandCountryCode: "CA", pickedIso: "CA", typed: "(416) 555-0123" }).reopened,
    ).toEqual({ localText: "4165550123", countryIso: "CA", savedWithCountry: true });
    expect(brandPhoneCountryFromStored("+14155550123", null, DIRECTORY)?.iso).toBe("US");
    // A country the shared rules do not characterise still resolves by dial code.
    expect(
      saveThenReopen({ stored: null, brandCountryCode: null, pickedIso: "AU", typed: "412 345 678" }),
    ).toEqual({
      storedAfterSave: "+61412345678",
      reopened: { localText: "412345678", countryIso: "AU", savedWithCountry: true },
    });
  });

  test("a wrong-country number is refused with a message, not saved under the wrong flag", () => {
    const refused = brandPhoneForSave({
      stored: null,
      brandCountryCode: null,
      edit: { text: "08031234567", countryIso: "US" },
      directory: DIRECTORY,
    });

    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.message).toMatch(/Nigeria/);
  });

  test("a legacy bare number opens under the brand's country, then the default, exactly as saved", () => {
    expect(brandPhoneForEdit("08031234567", "NG", DIRECTORY)).toEqual({
      localText: "08031234567",
      countryIso: "NG",
      savedWithCountry: false,
    });
    expect(brandPhoneForEdit("08031234567", null, DIRECTORY)).toEqual({
      localText: "08031234567",
      countryIso: "GB",
      savedWithCountry: false,
    });
    expect(brandPhoneCountryFromStored("08031234567", "NG", DIRECTORY)).toBeNull();
  });

  test("an untouched legacy number never blocks a save, and is upgraded only under the brand's own country", () => {
    expect(
      brandPhoneForSave({ stored: "08031234567", brandCountryCode: "NG", edit: null, directory: DIRECTORY }),
    ).toEqual({ ok: true, phone: "+2348031234567", phoneCountryIso: "NG" });
    // No brand country: nothing to save it under, so it is left alone.
    expect(
      brandPhoneForSave({ stored: "08031234567", brandCountryCode: null, edit: null, directory: DIRECTORY }),
    ).toEqual({ ok: true, phone: "08031234567", phoneCountryIso: undefined });
    // Reads as another country's number: left alone, never stamped with +44.
    expect(
      brandPhoneForSave({ stored: "08031234567", brandCountryCode: "GB", edit: null, directory: DIRECTORY }),
    ).toEqual({ ok: true, phone: "08031234567", phoneCountryIso: undefined });
  });

  test("clearing the box clears the number", () => {
    const cleared = brandPhoneForSave({
      stored: "+2348031234567",
      brandCountryCode: "NG",
      edit: { text: "  ", countryIso: "NG" },
      directory: DIRECTORY,
    });

    expect(cleared).toEqual({ ok: true, phone: undefined, phoneCountryIso: undefined });
    expect(
      mapUiToBrandUpdatePatch({
        contact: brandContactWithSavedPhone({ phone: "+2348031234567" }, cleared as never),
      }).contact_phone,
    ).toBeNull();
  });

  test("create and edit write the same shape, and a legacy value passes through untouched", () => {
    const created = mapUiToBrandInsert({
      accountId: "account-3380",
      brand: {
        displayName: "Lagos Supper Club",
        slug: "lagos-supper-club",
        contact: { phone: "+234 803 123 4567" },
      },
    });
    const edited = mapUiToBrandUpdatePatch({ contact: { phone: "+234 803 123 4567" } });

    expect(created.contact_phone).toBe("+2348031234567");
    expect(edited.contact_phone).toBe("+2348031234567");
    expect(brandContactPhoneForStorage("0803 123 4567")).toBe("0803 123 4567");
    expect(brandContactPhoneForStorage("   ")).toBeNull();
  });

  test("the public phone link dials E.164 when one is saved and never invents a code for a legacy value", () => {
    expect(brandPhoneTelHref("+2348031234567")).toBe("tel:+2348031234567");
    expect(brandPhoneTelHref("+234 803 123 4567")).toBe("tel:+2348031234567");
    expect(brandPhoneTelHref("08031234567")).toBe("tel:08031234567");
    expect(brandPhoneTelHref("0803 123 4567")).toBe("tel:0803 123 4567");
  });

  test("the editor and both public surfaces are wired to these rules", () => {
    const editor = source("src/components/brand/BrandEditView.tsx");
    const profile = source("src/components/brand/BrandProfileView.tsx");
    const publicPage = source("../packages/brand-rendering/PublicBrandPage.tsx");

    expect(editor).toContain("brandPhoneForEdit(savedPhone, brandCountryCode, PHONE_COUNTRIES)");
    expect(editor).toContain("defaultCountryIso={openedPhone.countryIso}");
    expect(editor).toContain("value={phoneEdit?.text ?? openedPhone.localText}");
    expect(editor).toContain("await onSave(draftToSave);");
    expect(editor).not.toContain('draft.contact?.phoneCountryIso ?? draft.countryCode ?? "GB"');
    expect(profile).toContain("url: brandPhoneTelHref(brand.contact.phone)");
    expect(profile).not.toContain("url: `tel:${brand.contact.phone}`");
    // [TEST-MOD-APPROVED #4111] D10: the public brand page no longer shows the
    // brand's phone at all (venue pages keep theirs), so it builds no tel: link.
    expect(publicPage).not.toContain("tel:");
    expect(publicPage).not.toContain("onExternal(`tel:${phone}`)");
  });
});
