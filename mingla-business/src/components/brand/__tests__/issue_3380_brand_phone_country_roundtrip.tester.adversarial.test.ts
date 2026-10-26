/**
 * issue #3380 — tester adversarial pass on the brand contact phone.
 *
 * The implementor's test proves the headline round trip (pick +234, save,
 * re-open) one rule at a time. This file attacks different angles:
 *
 *   1. the WHOLE save pipeline the edit route runs, end to end and repeatedly:
 *      row -> mapBrandRowToUi -> editor rules -> computeDirtyFieldsPatch ->
 *      mapUiToBrandUpdatePatch -> row. A save with no phone edit must write
 *      nothing about the phone, however many times it runs;
 *   2. legacy rows in the shapes production actually holds (bare national
 *      digits, brand country NULL): never rewritten, never given a country
 *      code, never a reason to refuse a save of another field;
 *   3. punctuation, trunk zeros, `00` prefixes and a pasted `+code` under the
 *      wrong flag;
 *   4. shared dial codes (+1, +7) and what an untouched save does to them;
 *   5. clearing: no value that is only a "+" or a dial code is ever stored;
 *   6. the public `tel:` link never gains a "+" the stored value did not have;
 *   7. the venue-brand CREATE path and the EDIT path store the same string;
 *   8. the phone box's own edit state still makes the form dirty, and nothing
 *      still reads the retired `contact.phoneCountryIso`.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

import {
  brandPhoneE164,
  brandPhoneTelHref,
} from "../../../../../packages/brand-rendering/brandPhoneHref";
import {
  mapBrandRowToUi,
  mapUiToBrandInsert,
  mapUiToBrandUpdatePatch,
  type BrandRow,
} from "../../../services/brandMapping";
import type { Brand } from "../../../store/currentBrandStore";
import { computeDirtyFieldsPatch } from "../../../utils/brandPatch";
import { composeE164 } from "../../../utils/phone";
import {
  brandContactWithSavedPhone,
  brandPhoneForEdit,
  brandPhoneForSave,
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

const dialFor = (iso: string): string => {
  const country = DIRECTORY.find((entry) => entry.iso === iso);
  if (country === undefined) throw new Error(`no country ${iso}`);
  return country.dialCode;
};

const row = (overrides: Partial<BrandRow>): BrandRow =>
  ({
    id: "brand-3380-tester",
    account_id: "account-3380-tester",
    name: "Tester Supper Club",
    slug: "tester-supper-club",
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

type PhoneEdit = { text: string; countryIso: string } | null;

type SaveOutcome =
  | { refused: string }
  | {
      refused: null;
      /** Whether the UPDATE touches contact_phone at all. */
      wrotePhone: boolean;
      /** contact_phone after the save. */
      stored: string | null;
      patchKeys: string[];
    };

/**
 * One trip through the edit route: open the brand, optionally edit the phone
 * and/or another field, press Save. Mirrors BrandEditView.handleSave followed
 * by app/brand/[id]/edit.tsx handleSave.
 */
const saveOnce = (
  before: BrandRow,
  edit: PhoneEdit,
  otherEdit?: Partial<Brand>,
): SaveOutcome => {
  const brand = mapBrandRowToUi(before, { role: "owner" });
  const draft: Brand = { ...brand, ...otherEdit };
  const phoneToSave = brandPhoneForSave({
    stored: draft.contact?.phone,
    brandCountryCode: draft.countryCode,
    edit,
    directory: DIRECTORY,
  });
  if (!phoneToSave.ok) return { refused: phoneToSave.message };
  const draftToSave: Brand = {
    ...draft,
    contact: brandContactWithSavedPhone(draft.contact, phoneToSave),
  };
  const patch = computeDirtyFieldsPatch(draftToSave, brand);
  const written = mapUiToBrandUpdatePatch(patch) as { contact_phone?: string | null };
  const wrotePhone = Object.prototype.hasOwnProperty.call(written, "contact_phone");
  return {
    refused: null,
    wrotePhone,
    stored: wrotePhone ? written.contact_phone ?? null : before.contact_phone ?? null,
    patchKeys: Object.keys(patch),
  };
};

const reopen = (stored: string | null, countryCode: string | null) => {
  const brand = mapBrandRowToUi(row({ contact_phone: stored, country_code: countryCode }), {
    role: "owner",
  });
  return brandPhoneForEdit(brand.contact?.phone, brand.countryCode, DIRECTORY);
};

describe("issue #3380 tester — a save with no phone edit never drifts", () => {
  // The shapes production holds today (digits masked): six bare national
  // numbers and two E.164, every one on a brand whose country is NULL.
  const LEGACY_NO_COUNTRY = [
    "7031234567",
    "08031234567",
    "09131234567",
    "2012345678",
    "9131234567",
    "0803 123 4567",
    "0803-123-4567",
    "(0803) 123 4567",
    "N/A",
    "ext 204",
    "12345",
  ];

  test.each(LEGACY_NO_COUNTRY)(
    "legacy %p on a brand with no country: three saves of another field never touch it",
    (legacy) => {
      let stored: string | null = legacy;
      for (let pass = 0; pass < 3; pass += 1) {
        const outcome = saveOnce(row({ contact_phone: stored }), null, {
          displayName: `Renamed ${pass}`,
        });
        expect(outcome.refused).toBeNull();
        if (outcome.refused !== null) return;
        // The phone is not in the UPDATE at all, and no code was invented.
        expect(outcome.wrotePhone).toBe(false);
        expect(outcome.patchKeys).toEqual(["displayName"]);
        expect(outcome.stored).toBe(legacy);
        stored = outcome.stored;
      }
      expect(stored).not.toMatch(/^\+/);
    },
  );

  test("legacy on a brand with no country opens exactly as saved, with no dial code in the box", () => {
    for (const legacy of LEGACY_NO_COUNTRY) {
      const opened = reopen(legacy, null);
      expect(opened.localText).toBe(legacy);
      expect(opened.savedWithCountry).toBe(false);
      expect(opened.localText).not.toMatch(/^\+/);
    }
  });

  test.each([
    ["+2348031234567", null],
    ["+2348031234567", "GB"],
    ["+14165550123", null],
    ["+14165550123", "CA"],
    ["+74951234567", null],
    ["+74951234567", "RU"],
    ["+447700900123", "NG"],
    ["+33123456789", null],
  ])("E.164 %p on a brand in %p survives three untouched saves byte for byte", (e164, country) => {
    let stored: string | null = e164;
    for (let pass = 0; pass < 3; pass += 1) {
      const outcome = saveOnce(row({ contact_phone: stored, country_code: country }), null, {
        tagline: `Tagline ${pass}`,
      });
      expect(outcome.refused).toBeNull();
      if (outcome.refused !== null) return;
      expect(outcome.wrotePhone).toBe(false);
      expect(outcome.stored).toBe(e164);
      stored = outcome.stored;
    }
  });

  test("a legacy number on a brand WITH a country is upgraded once, then is stable", () => {
    const first = saveOnce(row({ contact_phone: "0803 123 4567", country_code: "NG" }), null, {
      displayName: "Renamed",
    });
    expect(first).toMatchObject({ refused: null, wrotePhone: true, stored: "+2348031234567" });

    const second = saveOnce(row({ contact_phone: "+2348031234567", country_code: "NG" }), null, {
      displayName: "Renamed again",
    });
    expect(second).toMatchObject({ refused: null, wrotePhone: false, stored: "+2348031234567" });
    expect(reopen("+2348031234567", "NG")).toEqual({
      localText: "8031234567",
      countryIso: "NG",
      savedWithCountry: true,
    });
  });

  test("an untouched legacy number that reads as ANOTHER country is left alone, whatever the brand country", () => {
    // UK mobile on a US brand; Nigerian mobile (with and without the 0) on a UK brand.
    for (const [legacy, country] of [
      ["07700900123", "US"],
      ["08031234567", "GB"],
      ["8031234567", "GB"],
      ["7031234567", "GB"],
      ["07700900123", "NG"],
    ] as const) {
      const outcome = saveOnce(row({ contact_phone: legacy, country_code: country }), null, {
        displayName: "Renamed",
      });
      expect(outcome).toMatchObject({ refused: null, wrotePhone: false, stored: legacy });
    }
  });

  test("an untouched value that is not a phone number at all never blocks a save", () => {
    for (const junk of ["N/A", "ext 204", "12345", "call the office"]) {
      const outcome = saveOnce(row({ contact_phone: junk, country_code: "NG" }), null, {
        displayName: "Renamed",
      });
      expect(outcome).toMatchObject({ refused: null, wrotePhone: false, stored: junk });
    }
  });

  test("the email in the contact block survives a phone edit and a phone clear", () => {
    const brand = mapBrandRowToUi(row({ contact_phone: "+2348031234567" }), { role: "owner" });
    for (const edit of [
      { text: "0805 555 0101", countryIso: "NG" },
      { text: "", countryIso: "NG" },
    ]) {
      const saved = brandPhoneForSave({
        stored: brand.contact?.phone,
        brandCountryCode: null,
        edit,
        directory: DIRECTORY,
      });
      expect(saved.ok).toBe(true);
      if (!saved.ok) return;
      const written = mapUiToBrandUpdatePatch({
        contact: brandContactWithSavedPhone(brand.contact, saved),
      });
      expect(written.contact_email).toBe("hello@example.test");
    }
  });
});

describe("issue #3380 tester — what a typed number is saved as", () => {
  test.each([
    ["NG", "0803 123 4567", "+2348031234567"],
    ["NG", "08031234567", "+2348031234567"],
    ["NG", "(0803) 123-4567", "+2348031234567"],
    ["NG", " 0803.123.4567 ", "+2348031234567"],
    ["NG", "803 123 4567", "+2348031234567"],
    ["NG", "+234 803 123 4567", "+2348031234567"],
    ["NG", "+234 (0) 803 123 4567", "+2348031234567"],
    ["NG", "00234 803 123 4567", "+2348031234567"],
    ["GB", "07700 900123", "+447700900123"],
    ["GB", "020 7946 0000", "+442079460000"],
    ["US", "(415) 555-0123", "+14155550123"],
    ["CA", "416-555-0123", "+14165550123"],
  ])("under %s, %p is saved as %s and re-opens under the same country", (iso, typed, expected) => {
    const outcome = saveOnce(row({}), { text: typed, countryIso: iso });
    expect(outcome).toMatchObject({ refused: null, wrotePhone: true, stored: expected });

    // Re-opened on a brand in that country: same flag, dial code taken off.
    const opened = reopen(expected, iso);
    expect(opened.countryIso).toBe(iso);
    expect(opened.savedWithCountry).toBe(true);
    expect(`${dialFor(iso)}${opened.localText}`).toBe(expected);
  });

  test.each(["GB", "US", "KE", "FR"])(
    "a full +234 number pasted under the %s flag is saved as the Nigerian number it is",
    (flag) => {
      const outcome = saveOnce(row({}), { text: "+234 803 123 4567", countryIso: flag });
      expect(outcome).toMatchObject({ refused: null, stored: "+2348031234567" });
      // Never the pasted digits behind the selected flag's code.
      expect(outcome.refused === null && outcome.stored).not.toContain(dialFor(flag));
      expect(reopen("+2348031234567", null).countryIso).toBe("NG");
    },
  );

  test("a lower-case country code from the picker still resolves; an unknown one is refused, not guessed", () => {
    expect(saveOnce(row({}), { text: "08031234567", countryIso: "ng" })).toMatchObject({
      stored: "+2348031234567",
    });
    const unknown = saveOnce(row({}), { text: "08031234567", countryIso: "ZZ" });
    expect(unknown.refused).toMatch(/country/i);
  });

  test("a shared +1 number keeps its digits whichever +1 country the brand is in", () => {
    expect(reopen("+14165550123", "CA")).toMatchObject({ countryIso: "CA", localText: "4165550123" });
    expect(reopen("+14165550123", "US")).toMatchObject({ countryIso: "US", localText: "4165550123" });
    // A +1 number on a brand outside the plan still opens under a +1 country.
    const elsewhere = reopen("+14165550123", "NG");
    expect(dialFor(elsewhere.countryIso)).toBe("+1");
    expect(elsewhere.localText).toBe("4165550123");
  });

  test("a +7 number opens under the brand's own +7 country and is never re-coded", () => {
    expect(reopen("+74951234567", "RU")).toMatchObject({ countryIso: "RU", localText: "4951234567" });
    expect(reopen("+77012345678", "KZ")).toMatchObject({ countryIso: "KZ", localText: "7012345678" });
    const noCountry = reopen("+74951234567", null);
    expect(dialFor(noCountry.countryIso)).toBe("+7");
    expect(`+7${noCountry.localText}`).toBe("+74951234567");
  });

  test("whatever country an E.164 number opens under, flag plus box always rebuild the saved number", () => {
    for (const e164 of [
      "+2348031234567",
      "+14165550123",
      "+12425551234",
      "+74951234567",
      "+447700900123",
      "+33123456789",
      "+61412345678",
    ]) {
      for (const country of [null, "NG", "GB", "US", "CA", "RU"]) {
        const opened = reopen(e164, country);
        expect(opened.savedWithCountry).toBe(true);
        expect(`${dialFor(opened.countryIso)}${opened.localText}`).toBe(e164);
      }
    }
  });
});

describe("issue #3380 tester — clearing, and things that are not numbers", () => {
  test.each(["", " ", "\t", "   \n"])("clearing the box (%p) writes NULL, not an empty string or a +", (text) => {
    const outcome = saveOnce(row({ contact_phone: "+2348031234567", country_code: "NG" }), {
      text,
      countryIso: "NG",
    });
    expect(outcome).toMatchObject({ refused: null, wrotePhone: true, stored: null });
  });

  test("clearing a LEGACY number on a brand with no country clears it too", () => {
    expect(
      saveOnce(row({ contact_phone: "08031234567" }), { text: "", countryIso: "GB" }),
    ).toMatchObject({ refused: null, wrotePhone: true, stored: null });
  });

  test.each(["+", "+234", "+ 234", "0000", "call 0803", "abc", "+44"])(
    "%p under Nigeria is refused with a message and nothing is stored",
    (text) => {
      const outcome = saveOnce(row({ contact_phone: "+2348031234567", country_code: "NG" }), {
        text,
        countryIso: "NG",
      });
      expect(outcome.refused).not.toBeNull();
      expect(typeof outcome.refused === "string" && outcome.refused.length).toBeGreaterThan(10);
    },
  );

  test("no accepted save anywhere in this file's inputs stores a value that is only a + or a dial code", () => {
    const dialCodes = new Set(DIRECTORY.map((country) => country.dialCode));
    for (const country of ["NG", "GB", "US", "FR", "KZ"]) {
      for (const text of ["+", `${dialFor(country)}`, ` ${dialFor(country)} `, "0", "00"]) {
        const outcome = saveOnce(row({}), { text, countryIso: country });
        if (outcome.refused === null) {
          expect(outcome.stored === null || !dialCodes.has(outcome.stored)).toBe(true);
          expect(outcome.stored).not.toBe("+");
        }
      }
    }
  });
});

describe("issue #3380 tester — the public tel: link", () => {
  test("an E.164 number dials as compact E.164 however it is punctuated", () => {
    for (const stored of [
      "+2348031234567",
      "+234 803 123 4567",
      "+234-803-123-4567",
      "+234 (803) 123.4567",
      "  +2348031234567  ",
    ]) {
      expect(brandPhoneTelHref(stored)).toBe("tel:+2348031234567");
    }
  });

  test("a legacy value is dialled exactly as saved and never gains a +", () => {
    for (const legacy of [
      "08031234567",
      "0803 123 4567",
      "7031234567",
      "002348031234567",
      "2348031234567",
      "(415) 555-0123",
      "N/A",
    ]) {
      expect(brandPhoneE164(legacy)).toBeNull();
      expect(brandPhoneTelHref(legacy)).toBe(`tel:${legacy}`);
      expect(brandPhoneTelHref(legacy)).not.toContain("+");
    }
  });

  test("a + in front of a trunk zero, or too few digits, is not treated as E.164", () => {
    expect(brandPhoneE164("+0803 123 4567")).toBeNull();
    expect(brandPhoneE164("+29012")).toBeNull();
    expect(brandPhoneE164("+")).toBeNull();
    expect(brandPhoneE164("")).toBeNull();
    expect(brandPhoneE164(null)).toBeNull();
    expect(brandPhoneE164(undefined)).toBeNull();
    expect(brandPhoneE164("+1234567890123456")).toBeNull();
  });

  test("no phone, no link: both surfaces only build the link when a number exists", () => {
    const publicPage = source("../packages/brand-rendering/PublicBrandPage.tsx");
    // [TEST-MOD-APPROVED #4111] D10: the public brand page shows no brand phone,
    // so it never builds a tel: link (the Host profile below still does).
    expect(publicPage).not.toMatch(/tel:/);
    expect(publicPage).not.toContain("`tel:${phone}`");

    const profile = source("src/components/brand/BrandProfileView.tsx");
    expect(profile).toMatch(
      /brand\.contact\.phone\.length > 0\) \{\s*chips\.push\(\{ key: "phone"[^\n]*url: brandPhoneTelHref\(brand\.contact\.phone\) \}\);/,
    );
    expect(profile).not.toContain("`tel:${brand.contact.phone}`");

    // A blank column never becomes a contact phone on either read path.
    expect(mapBrandRowToUi(row({ contact_phone: "   " }), { role: "owner" }).contact?.phone).toBeUndefined();
    expect(mapBrandRowToUi(row({ contact_phone: "" }), { role: "owner" }).contact?.phone).toBeUndefined();
    const publicService = source("src/services/publicEventsService.ts");
    expect(publicService).toMatch(
      /if \(typeof phone === "string" && phone\.trim\(\)\.length > 0\) \{\s*out\.phone = phone;/,
    );
  });
});

describe("issue #3380 tester — create and edit store the same string", () => {
  test.each([
    ["NG", "0803 123 4567"],
    ["NG", "(0803) 123-4567"],
    ["GB", "07700 900123"],
    ["US", "(415) 555-0123"],
    ["NG", "+234 803 123 4567"],
  ])("under %s, %p: the venue-brand creator and the brand editor agree", (iso, typed) => {
    // Create: VenueCreatorWizard composes with composeE164, then the insert mapper.
    const composed = composeE164(dialFor(iso), typed);
    expect(composed).not.toBeNull();
    const created = mapUiToBrandInsert({
      accountId: "account-3380-tester",
      brand: {
        displayName: "Tester Supper Club",
        slug: "tester-supper-club",
        contact: { phone: composed ?? undefined },
      },
    }).contact_phone;

    const edited = saveOnce(row({}), { text: typed, countryIso: iso });

    expect(edited.refused).toBeNull();
    expect(edited.refused === null && edited.stored).toBe(created);
    expect(created).toMatch(/^\+[1-9]\d{6,14}$/);
  });

  test("the creator still composes with the country, and the venue-brand RPC receives that value", () => {
    const wizard = source("src/components/venue/VenueCreatorWizard.tsx");
    expect(wizard).toMatch(
      /composeE164\(c6DialCode\(st\.contactPhoneCountryIso\), st\.contactPhone\)/,
    );
    expect(source("src/services/brandsService.ts")).toContain(
      'p_contact_phone: input.contact.phone ?? "",',
    );
  });
});

describe("issue #3380 tester — the phone box's own edit state", () => {
  const editor = source("src/components/brand/BrandEditView.tsx");

  test("a phone-only change makes the form dirty, so Save and the discard prompt both fire", () => {
    const dirty = editor.slice(
      editor.indexOf("const isDirty = useMemo<boolean>"),
      editor.indexOf("// ONE patch per user action"),
    );
    expect(dirty).toContain("phoneEdit !== null");
    expect(dirty).toContain("phoneEdit.text.trim() !== openedPhone.localText");
    expect(dirty).toContain("phoneEdit.countryIso !== openedPhone.countryIso");
    expect(dirty).toMatch(/\[draft, brand, phoneEdit, openedPhone\]/);

    // Save reads the CURRENT phone edit (not a stale closure) and is gated on isDirty.
    expect(editor).toMatch(/if \(!isDirty \|\| submitting \|\| draft === null\) return;/);
    expect(editor).toMatch(
      /\[draft, isDirty, submitting, onSave, onAfterSave, fireToast, phoneEdit\]/,
    );
    // Back with a dirty phone asks before discarding; discard leaves the screen,
    // which unmounts the editor and its phone state with it.
    expect(editor).toMatch(/if \(isDirty\) \{\s*setDiscardDialogVisible\(true\);/);
    expect(editor).toMatch(
      /const handleDiscardConfirm = useCallback\(\(\): void => \{\s*setDiscardDialogVisible\(false\);\s*onCancel\(\);/,
    );
  });

  test("after a successful save the box returns to untouched, and a refusal saves nothing", () => {
    const save = editor.slice(
      editor.indexOf("const phoneToSave = brandPhoneForSave({"),
      editor.indexOf("} catch (error) {", editor.indexOf("const phoneToSave = brandPhoneForSave({")),
    );
    // Refusal returns BEFORE onSave.
    expect(save.indexOf("if (!phoneToSave.ok) {")).toBeGreaterThan(0);
    expect(save.indexOf("setContactPhoneError(phoneToSave.message);")).toBeLessThan(
      save.indexOf("await onSave(draftToSave);"),
    );
    expect(save.indexOf("setPhoneEdit(null);")).toBeGreaterThan(
      save.indexOf("await onSave(draftToSave);"),
    );
    // The error is shown on the field, not swallowed.
    expect(editor).toContain("error={contactPhoneError}");
  });

  test("the box never types into the draft brand directly any more", () => {
    expect(editor).not.toMatch(/contact: \{ \.\.\.draft\.contact, phone: v \}/);
    expect(editor).not.toContain("phoneCountryIso");
    expect(editor).toContain("defaultCountryIso={openedPhone.countryIso}");
  });

  test("nothing in the Host app or the shared packages still reads contact.phoneCountryIso", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
        // Code only: a changelog comment that names the old field is not a reader.
        const code = readFileSync(full, "utf8")
          .split("\n")
          .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
          .join("\n");
        if (/contact\??\.phoneCountryIso/.test(code)) offenders.push(full);
      }
    };
    walk(join(process.cwd(), "src"));
    walk(join(process.cwd(), "app"));
    walk(join(process.cwd(), "..", "packages", "brand-rendering"));
    expect(offenders).toEqual([]);
  });

  test("a brand that still carries the retired country field is not re-sent unless the number changed", () => {
    const contact = { email: "hello@example.test", phone: "+2348031234567", phoneCountryIso: "GB" };
    const untouched = brandPhoneForSave({
      stored: contact.phone,
      brandCountryCode: null,
      edit: null,
      directory: DIRECTORY,
    });
    expect(untouched.ok).toBe(true);
    if (!untouched.ok) return;
    // Same object back: the dirty diff sees no contact change.
    expect(brandContactWithSavedPhone(contact, untouched)).toBe(contact);

    const changed = brandPhoneForSave({
      stored: contact.phone,
      brandCountryCode: null,
      edit: { text: "0805 555 0101", countryIso: "NG" },
      directory: DIRECTORY,
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(brandContactWithSavedPhone(contact, changed)).toEqual({
      email: "hello@example.test",
      phone: "+2348055550101",
    });
  });
});
