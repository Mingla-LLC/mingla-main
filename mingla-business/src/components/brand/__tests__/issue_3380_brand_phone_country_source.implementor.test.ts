/**
 * issue #3380 rework 2 — a typed brand phone needs a CHOSEN country.
 *
 * The defect: every production brand with a phone has no country, so the phone
 * field opened under a default +44 flag nobody picked, and bare digits typed
 * there were stamped +44. `4155550123` (United States) was saved as
 * `+444155550123`; Ghanaian, Kenyan and Irish numbers the same. Guessing a
 * country from bare digits cannot be made complete, so the guess is gone: the
 * field tracks where its country came from, and a number typed without a "+"
 * under a country nobody chose is refused with "Choose the country for this
 * number."
 *
 * FAILS ON REVERT: delete the `countrySource … === "fallback"` refusal in
 * `brandPhoneForSave` and every "is refused" case below saves a +44 number.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, jest, test } from "@jest/globals";

import {
  brandPhoneSessionCountryCount,
  clearBrandPhoneSessionCountries,
} from "../../../utils/brandPhoneSessionCountries";
import {
  BRAND_PHONE_CHOOSE_COUNTRY_LABEL,
  BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE,
  BRAND_PHONE_UK_PLUS_ADVICE,
  brandContactWithSavedPhone,
  brandPhoneCountrySourceForEdit,
  brandPhoneForEdit,
  brandPhoneForSave,
  brandPhoneSessionCountryIso,
  clearBrandPhoneSavedCountries,
  rememberBrandPhoneSavedCountry,
  type BrandPhoneCountrySource,
  type BrandPhoneDirectory,
} from "../brandContactPhoneRules";
import { updateBrand } from "../../../services/brandsService";

const BRAND_ROW_ID = "33800000-0000-4000-8000-000000000001";

// The database boundary only. `updateBrand`, the row mapping in both
// directions and the phone rules are all REAL; this stands in for the one
// `brands` row PostgREST would update and hand back.
const brandRow: Record<string, unknown> = {};
const brandRowWrites: Record<string, unknown>[] = [];
const resetBrandRow = (contactPhone: string | null): void => {
  for (const key of Object.keys(brandRow)) delete brandRow[key];
  Object.assign(brandRow, {
    id: BRAND_ROW_ID,
    account_id: "account-3380",
    name: "Phone Brand",
    slug: "phone-brand",
    description: null,
    contact_email: "hello@example.com",
    contact_phone: contactPhone,
    social_links: {},
    custom_links: [],
    default_currency: "GBP",
  });
  brandRowWrites.length = 0;
};
jest.mock("../../../services/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "brands") throw new Error(`unexpected table ${table}`);
      let payload: Record<string, unknown> | null = null;
      const query = {
        update: (next: Record<string, unknown>) => {
          payload = next;
          return query;
        },
        eq: () => query,
        is: () => query,
        select: () => query,
        single: () => {
          if (payload === null) throw new Error("only updates are expected here");
          brandRowWrites.push(payload);
          Object.assign(brandRow, payload);
          return Promise.resolve({ data: { ...brandRow }, error: null });
        },
      };
      return query;
    },
  },
}));
jest.mock("../../../services/appsFlyerService", () => ({ logAppsFlyerEvent: () => undefined }));

const source = (relativePath: string): string =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

// The country list the chip really shows.
const DIRECTORY: BrandPhoneDirectory = [
  ...source("src/components/ui/Input.tsx").matchAll(
    /\{ iso: "([A-Z]{2})", name: "[^"]*", dialCode: "(\+\d+)"/g,
  ),
].map((match) => ({ iso: match[1], dialCode: match[2] }));

const typed = (
  text: string,
  countryIso: string,
  countrySource: BrandPhoneCountrySource,
  brandCountryCode: string | null = null,
  stored: string | null = null,
) =>
  brandPhoneForSave({
    stored,
    brandCountryCode,
    edit: { text, countryIso, countrySource },
    directory: DIRECTORY,
  });

const BARE_DIGITS = [
  "4155550123", // United States
  "(415) 555-0123",
  "9193770509", // United States, area code 919 (reads as a Nigerian 091…)
  "0241234567", // Ghana
  "08031234567", // Nigeria
  "020 7946 0000", // United Kingdom
  "0800 123 4567", // United Kingdom freephone
] as const;

afterEach(() => {
  clearBrandPhoneSavedCountries();
});

describe("issue #3380 rework 2 — the field knows where its country came from", () => {
  test("a brand with no country and no saved country code opens on a country nobody chose", () => {
    expect(brandPhoneCountrySourceForEdit(null, null, DIRECTORY)).toBe("fallback");
    expect(brandPhoneCountrySourceForEdit("", null, DIRECTORY)).toBe("fallback");
    // The production shape: bare national digits, no brand country.
    expect(brandPhoneCountrySourceForEdit("08031234567", null, DIRECTORY)).toBe("fallback");
    expect(brandPhoneCountrySourceForEdit("4155550123", null, DIRECTORY)).toBe("fallback");
    // A country the directory does not know is no country.
    expect(brandPhoneCountrySourceForEdit("08031234567", "ZZ", DIRECTORY)).toBe("fallback");
  });

  test("a saved E.164 number opens under its own country; a legacy one under the brand's", () => {
    expect(brandPhoneCountrySourceForEdit("+2348031234567", null, DIRECTORY)).toBe("stored");
    expect(brandPhoneCountrySourceForEdit("+14155550123", "GB", DIRECTORY)).toBe("stored");
    expect(brandPhoneCountrySourceForEdit("08031234567", "NG", DIRECTORY)).toBe("brand");
    expect(brandPhoneCountrySourceForEdit(null, "US", DIRECTORY)).toBe("brand");
  });
});

describe("issue #3380 rework 2 — no silent +44", () => {
  test.each(BARE_DIGITS)(
    "%p typed under the default flag nobody chose is refused with the choose-country message",
    (text) => {
      const opened = brandPhoneForEdit(null, null, DIRECTORY);
      expect(opened.countryIso).toBe("GB");
      expect(typed(text, opened.countryIso, "fallback")).toEqual({
        ok: false,
        message: "Choose the country for this number.",
      });
    },
  );

  test("the production case: a legacy number re-typed with one digit changed is not stamped +44", () => {
    const stored = "4155550123";
    const result = typed("4155550124", "GB", "fallback", null, stored);
    expect(result).toEqual({ ok: false, message: BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE });
  });

  test.each([
    ["4155550123", "US", "+14155550123"],
    ["(415) 555-0123", "US", "+14155550123"],
    ["9193770509", "US", "+19193770509"],
    ["0241234567", "GH", "+233241234567"],
    ["08031234567", "NG", "+2348031234567"],
    ["020 7946 0000", "GB", "+442079460000"],
    ["0800 123 4567", "GB", "+448001234567"],
  ])("%p saves under %s once the host picks it", (text, iso, expected) => {
    expect(typed(text, iso, "picked")).toEqual({
      ok: true,
      phone: expected,
      phoneCountryIso: iso,
    });
  });

  test("picking United Kingdom itself is a choice: the same digits then save as +44", () => {
    expect(typed("020 7946 0000", "GB", "fallback").ok).toBe(false);
    expect(typed("020 7946 0000", "GB", "picked")).toEqual({
      ok: true,
      phone: "+442079460000",
      phoneCountryIso: "GB",
    });
  });

  test.each([
    ["+1 415 555 0123", "+14155550123", "US"],
    ["+234 803 123 4567", "+2348031234567", "NG"],
    ["+44 20 7946 0000", "+442079460000", "GB"],
    ["00 234 803 123 4567", "+2348031234567", "NG"],
  ])("%p names its own country and saves under the default flag", (text, expected, iso) => {
    expect(typed(text, "GB", "fallback")).toEqual({
      ok: true,
      phone: expected,
      phoneCountryIso: iso,
    });
  });

  test("emptying the box under the default flag still clears the number", () => {
    expect(typed("  ", "GB", "fallback", null, "08031234567")).toEqual({
      ok: true,
      phone: undefined,
      phoneCountryIso: undefined,
    });
  });

  test("the brand's own country composes with no pick", () => {
    expect(brandPhoneCountrySourceForEdit(null, "US", DIRECTORY)).toBe("brand");
    expect(typed("4155550123", "US", "brand", "US")).toEqual({
      ok: true,
      phone: "+14155550123",
      phoneCountryIso: "US",
    });
    expect(typed("08031234567", "NG", "brand", "NG")).toEqual({
      ok: true,
      phone: "+2348031234567",
      phoneCountryIso: "NG",
    });
  });

  test("a number re-typed under the country of the saved number composes with no pick", () => {
    expect(typed("08055550101", "NG", "stored", null, "+2348031234567")).toEqual({
      ok: true,
      phone: "+2348055550101",
      phoneCountryIso: "NG",
    });
  });

  test("a source left out is read as picked, so earlier callers behave as before", () => {
    expect(
      brandPhoneForSave({
        stored: null,
        brandCountryCode: null,
        edit: { text: "020 7946 0000", countryIso: "GB" },
        directory: DIRECTORY,
      }),
    ).toEqual({ ok: true, phone: "+442079460000", phoneCountryIso: "GB" });
  });

  test("an untouched number is never refused for having no chosen country", () => {
    expect(
      brandPhoneForSave({
        stored: "4155550123",
        brandCountryCode: null,
        edit: null,
        directory: DIRECTORY,
      }),
    ).toEqual({ ok: true, phone: "4155550123", phoneCountryIso: undefined });
  });
});

describe("issue #3380 rework 2 — a chosen country is never second-guessed into another", () => {
  test.each<[string, string, BrandPhoneCountrySource]>([
    ["08031234567", "GB", "picked"],
    ["08031234567", "GB", "brand"],
    ["9193770509", "GB", "picked"],
  ])("%p under %s (%s) is a refusal with advice, never a save under another country", (text, iso, src) => {
    const result = typed(text, iso, src, src === "brand" ? iso : null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/^That looks like a Nigerian number, not a \+44 one\./);
  });

  test.each(["0808 157 0192", "070 1234 5678", "0906 123 4567", "9193770509"])(
    "%p under a chosen UK flag says how to save a real UK number",
    (text) => {
      const result = typed(text, "GB", "picked");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toContain("Change the country to Nigeria (+234).");
      expect(result.message.endsWith(BRAND_PHONE_UK_PLUS_ADVICE)).toBe(true);
      expect(BRAND_PHONE_UK_PLUS_ADVICE).toBe(
        "If it is a UK number, type it starting with +44.",
      );
    },
  );

  test("the advice works: the same UK numbers save when typed with +44", () => {
    expect(typed("+44 808 157 0192", "GB", "picked")).toEqual({
      ok: true,
      phone: "+448081570192",
      phoneCountryIso: "GB",
    });
    expect(typed("+44 70 1234 5678", "GB", "fallback")).toEqual({
      ok: true,
      phone: "+447012345678",
      phoneCountryIso: "GB",
    });
  });

  test("a range that is not a UK one gets no UK advice", () => {
    const result = typed("08031234567", "GB", "picked");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).not.toContain("+44.");
  });

  test("a Nigerian-looking number under a chosen non-UK country gets no UK advice", () => {
    const result = typed("08031234567", "US", "picked");
    if (result.ok) {
      // Whatever the shared rules decide, it is saved under the PICKED country.
      expect(result.phoneCountryIso).toBe("US");
      return;
    }
    expect(result.message).not.toContain(BRAND_PHONE_UK_PLUS_ADVICE);
  });
});

describe("issue #3380 rework 2 — the editor passes the source and shows no unchosen flag", () => {
  const editor = source("src/components/brand/BrandEditView.tsx");
  const input = source("src/components/ui/Input.tsx");

  test("the editor opens with the source of its country and keeps it in the phone edit", () => {
    const opened = editor.slice(
      editor.indexOf("const openedPhone = useMemo("),
      editor.indexOf("const [discardDialogVisible"),
    );
    expect(opened).toContain("...brandPhoneForEdit(savedPhone, brandCountryCode, PHONE_COUNTRIES),");
    expect(opened).toMatch(
      /countrySource: brandPhoneCountrySourceForEdit\(\s*savedPhone,\s*brandCountryCode,\s*PHONE_COUNTRIES,\s*\),/,
    );
    expect(editor).toMatch(
      /useState<\{\s*text: string;\s*countryIso: string;\s*countrySource: BrandPhoneCountrySource;\s*\} \| null>\(null\)/,
    );
    // Save hands the whole edit, source included, to the rule.
    const save = editor.slice(
      editor.indexOf("const phoneToSave = brandPhoneForSave({"),
      editor.indexOf("if (!phoneToSave.ok) {"),
    );
    expect(save).toContain("edit: phoneEdit,");
  });

  test("typing keeps the source; only the country list makes it picked", () => {
    const field = editor.slice(
      editor.indexOf('accessibilityLabel="Contact email"'),
      editor.indexOf('accessibilityLabel="Contact phone"'),
    );
    const typing = field.slice(
      field.indexOf('variant="phone"'),
      field.indexOf("defaultCountryIso="),
    );
    const picking = field.slice(
      field.indexOf("onCountryChange={(country) => {"),
      field.indexOf("countryPlaceholder="),
    );
    expect(typing).toMatch(
      /countrySource:\s*phoneEdit\?\.countrySource \?\? openedPhone\.countrySource,/,
    );
    expect(typing).not.toContain('"picked"');
    expect(picking).toContain('countrySource: "picked",');
    expect(picking).toContain("if (contactPhoneError !== null) setContactPhoneError(null);");
    expect(editor.match(/countrySource: "picked"/g)).toHaveLength(1);
  });

  test("picking the country the chip defaulted to makes the form dirty", () => {
    const dirty = editor.slice(
      editor.indexOf("const isDirty = useMemo<boolean>"),
      editor.indexOf("// ONE patch per user action"),
    );
    expect(dirty).toMatch(
      /openedPhone\.countrySource === "fallback" &&\s*phoneEdit\.countrySource === "picked"/,
    );
  });

  test("the chip shows 'Choose country' instead of a flag until a country is chosen", () => {
    expect(BRAND_PHONE_CHOOSE_COUNTRY_LABEL).toBe("Choose country");
    expect(editor).toMatch(
      /countryPlaceholder=\{\s*\(phoneEdit\?\.countrySource \?\? openedPhone\.countrySource\) ===\s*"fallback"\s*\? BRAND_PHONE_CHOOSE_COUNTRY_LABEL\s*: undefined\s*\}/,
    );
    // The shared field: text in place of the flag, an honest label, no row
    // pre-selected in the list.
    expect(input).toContain("countryPlaceholder?: string;");
    expect(input).toMatch(
      /\{countryUnchosen \? \(\s*<Text style=\{styles\.countryPlaceholder\} numberOfLines=\{1\}>\s*\{countryPlaceholder\}\s*<\/Text>\s*\) : \(\s*<Text style=\{styles\.countryFlag\}>\{country\.flag\}<\/Text>\s*\)\}/,
    );
    expect(input).toContain("`${countryPlaceholder}. No country chosen yet. Tap to choose.`");
    expect(input).toContain("const isSelected = !countryUnchosen && c.iso === country.iso;");
    // Every other phone field is untouched: only the brand editor passes it.
    expect(input).toContain(
      "`Country: ${country.name}, ${country.dialCode}. Tap to change.`",
    );
  });
});

describe("issue #3380 rework 2 — sign-out forgets the remembered countries", () => {
  test("the clear function empties the map", () => {
    const saved = typed("4165550123", "CA", "picked");
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    rememberBrandPhoneSavedCountry(saved);
    expect(brandPhoneSessionCountryIso("+14165550123")).toBe("CA");
    expect(brandPhoneSessionCountryCount()).toBe(1);

    clearBrandPhoneSavedCountries();

    expect(brandPhoneSessionCountryCount()).toBe(0);
    expect(brandPhoneSessionCountryIso("+14165550123")).toBeNull();
    // The rules export IS the function sign-out calls.
    expect(clearBrandPhoneSavedCountries).toBe(clearBrandPhoneSessionCountries);
  });

  test("clearAllStores calls it", () => {
    const stores = source("src/utils/clearAllStores.ts");
    expect(stores).toContain(
      'import { clearBrandPhoneSessionCountries } from "./brandPhoneSessionCountries";',
    );
    const body = stores.slice(stores.indexOf("export const clearAllStores = (): void => {"));
    expect(body).toMatch(/^\s*clearBrandPhoneSessionCountries\(\);/m);
  });

  test("signing out really forgets a pick", () => {
    const reset = { getState: () => ({ reset: (): void => undefined }) };
    for (const name of [
      "currentBrandStore",
      "draftEventStore",
      "draftVenueStore",
      "eventEditLogStore",
      "guestStore",
      "liveEventStore",
      "orderStore",
      "scanStore",
      "scannerInvitationsStore",
      "doorSalesStore",
      "brandTeamStore",
      "notificationPrefsStore",
      "liveSectionCollapseStore",
      "todoToggleCollapseStore",
      "ariConversationSelectionStore",
      "businessRecentStore",
    ]) {
      jest.doMock(
        `../../../store/${name}`,
        () => new Proxy({}, { get: (_target, key) => (key === "__esModule" ? false : reset) }),
      );
    }
    const saved = typed("4165550123", "CA", "picked");
    if (!saved.ok) throw new Error("save refused");
    rememberBrandPhoneSavedCountry(saved);
    expect(brandPhoneSessionCountryCount()).toBe(1);

    const { clearAllStores } = jest.requireActual<{
      clearAllStores: () => void;
    }>("../../../utils/clearAllStores");
    clearAllStores();

    expect(brandPhoneSessionCountryCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The save, all the way to the row: rules -> contact block -> the REAL
// `updateBrand` -> the row mapping, out and back.
// ---------------------------------------------------------------------------

describe("issue #3380 rework 2 — what the brand row holds after Save", () => {
  /** The editor's save: refuse on the field, or write through the service. */
  const saveFromEditor = async (
    stored: string | null,
    brandCountryCode: string | null,
    edit: { text: string; countryIso: string; countrySource: BrandPhoneCountrySource } | null,
  ): Promise<{ refused: string } | { reopenedPhone: string | undefined }> => {
    const phoneToSave = brandPhoneForSave({
      stored,
      brandCountryCode,
      edit,
      directory: DIRECTORY,
    });
    if (!phoneToSave.ok) return { refused: phoneToSave.message };
    const contact = brandContactWithSavedPhone(
      { email: "hello@example.com", phone: stored ?? undefined },
      phoneToSave,
    );
    const saved = await updateBrand(BRAND_ROW_ID, { contact }, null);
    if (edit !== null) rememberBrandPhoneSavedCountry(phoneToSave);
    return { reopenedPhone: saved.contact?.phone };
  };

  test.each(BARE_DIGITS)(
    "%p under the flag nobody chose: refused, and the row is never written",
    async (text) => {
      resetBrandRow(null);
      const outcome = await saveFromEditor(null, null, {
        text,
        countryIso: brandPhoneForEdit(null, null, DIRECTORY).countryIso,
        countrySource: "fallback",
      });
      expect(outcome).toEqual({ refused: BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE });
      expect(brandRowWrites).toEqual([]);
      expect(brandRow.contact_phone).toBeNull();
    },
  );

  test.each([
    ["4155550123", "US", "+14155550123"],
    ["0241234567", "GH", "+233241234567"],
    ["08031234567", "NG", "+2348031234567"],
    ["020 7946 0000", "GB", "+442079460000"],
  ])("%p with %s picked: the row holds %s", async (text, iso, expected) => {
    resetBrandRow(null);
    const outcome = await saveFromEditor(null, null, {
      text,
      countryIso: iso,
      countrySource: "picked",
    });
    expect(brandRowWrites).toHaveLength(1);
    expect(brandRow.contact_phone).toBe(expected);
    // The brand the service hands back carries the same number.
    expect(outcome).toEqual({ reopenedPhone: expected });
  });

  test("the reported case end to end: a United States number never reaches the row as +44", async () => {
    resetBrandRow("4155550123");
    // Typed under the default flag: refused, the legacy digits stay as they were.
    expect(
      await saveFromEditor("4155550123", null, {
        text: "4155550124",
        countryIso: "GB",
        countrySource: "fallback",
      }),
    ).toEqual({ refused: BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE });
    expect(brandRow.contact_phone).toBe("4155550123");
    // The host picks United States: now it is written, as a +1 number.
    await saveFromEditor("4155550123", null, {
      text: "4155550124",
      countryIso: "US",
      countrySource: "picked",
    });
    expect(brandRow.contact_phone).toBe("+14155550124");
    expect(String(brandRow.contact_phone).startsWith("+44")).toBe(false);
  });

  test("a saved number re-opens under its own country, and new digits then compose with no pick", async () => {
    resetBrandRow(null);
    const first = await saveFromEditor(null, null, {
      text: "08031234567",
      countryIso: "NG",
      countrySource: "picked",
    });
    const reopenedPhone = (first as { reopenedPhone: string }).reopenedPhone;
    expect(brandPhoneCountrySourceForEdit(reopenedPhone, null, DIRECTORY)).toBe("stored");
    const reopened = brandPhoneForEdit(reopenedPhone, null, DIRECTORY);
    expect(reopened.countryIso).toBe("NG");

    await saveFromEditor(reopenedPhone, null, {
      text: "08031234568",
      countryIso: reopened.countryIso,
      countrySource: brandPhoneCountrySourceForEdit(reopenedPhone, null, DIRECTORY),
    });
    expect(brandRow.contact_phone).toBe("+2348031234568");
  });

  test("an untouched legacy number is written back exactly as stored when another field is saved", async () => {
    resetBrandRow("4155550123");
    const outcome = await saveFromEditor("4155550123", null, null);
    expect(outcome).toEqual({ reopenedPhone: "4155550123" });
    expect(brandRow.contact_phone).toBe("4155550123");
  });
});
