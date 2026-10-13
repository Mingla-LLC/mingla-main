/**
 * issue #3380 tester retest — a number typed under the wrong country.
 *
 * Angles the implementor's file does not take:
 *   - a sweep of every Nigerian mobile prefix under every characterised flag,
 *     asserting the INVARIANT (never a non-+234 number) rather than examples;
 *   - the reverse directions (UK digits under other flags, US digits typed
 *     with their leading 1);
 *   - the way out of a refusal (fix the flag, clear the box, type a "+");
 *   - a legacy number the host touched and put back;
 *   - the in-memory country hint: what it may and may not carry between
 *     numbers and brands, and its size cap;
 *   - the editor's wiring of the refusal, read from source.
 *
 * FAILS ON REVERT: delete the `if (!text.startsWith("+")) { … }` probe block
 * in `brandPhoneForSave` (added by 4a325c3f6) and the sweep, the punctuation
 * cases and the touched-and-put-back case all save a +44 / +1 / +233 number.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

import {
  brandContactWithSavedPhone,
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

const dialOf = (iso: string): string => {
  const country = DIRECTORY.find((entry) => entry.iso === iso);
  if (country === undefined) throw new Error(`no ${iso} in the directory`);
  return country.dialCode;
};

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

const refusalOf = (text: string, countryIso: string): string => {
  const result = typed(text, countryIso);
  if (result.ok) {
    throw new Error(
      `"${text}" under ${countryIso} was saved as ${String(result.phone)}`,
    );
  }
  return result.message;
};

describe("issue #3380 tester retest — Nigerian digits never leave under another code", () => {
  // 070x, 080x, 081x, 090x, 091x. Left out on purpose: 0800 (UK freephone is
  // let through under +44) and 071x (a real UK mobile range as well).
  const prefixes: string[] = [];
  for (const head of ["070", "080", "081", "090", "091"]) {
    for (let last = 0; last <= 9; last += 1) {
      if (head === "080" && last === 0) continue;
      prefixes.push(`${head}${last}`);
    }
  }
  const flags = ["GB", "GG", "IM", "JE", "US", "CA", "GH", "KE", "ZA", "IE"];

  test("every Nigerian mobile prefix, under every characterised flag, is refused and names Nigeria", () => {
    const leaks: string[] = [];
    for (const prefix of prefixes) {
      const text = `${prefix}2345678`;
      for (const iso of flags) {
        const result = typed(text, iso);
        if (result.ok) {
          leaks.push(`${text} under ${iso} -> ${String(result.phone)}`);
        } else if (!result.message.includes("Nigeria (+234)")) {
          leaks.push(`${text} under ${iso} -> "${result.message}"`);
        }
      }
    }
    expect(leaks).toEqual([]);
    expect(prefixes.length * flags.length).toBe(490);
  });

  test("the same prefixes save as Nigerian once the chip says Nigeria", () => {
    for (const prefix of prefixes) {
      expect(typed(`${prefix}2345678`, "NG")).toEqual({
        ok: true,
        phone: `+234${prefix.slice(1)}2345678`,
        phoneCountryIso: "NG",
      });
    }
  });

  test.each([
    ["0803 123 4567"],
    ["0803-123-4567"],
    ["(0803) 123 4567"],
    ["0803.123.4567"],
    ["  08031234567  "],
    ["8031234567"],
    ["2348031234567"],
    ["234 803 123 4567"],
  ])("however it is punctuated, %s is refused under GB, US, GH and KE", (text) => {
    for (const iso of ["GB", "US", "GH", "KE"]) {
      const message = refusalOf(text, iso);
      expect(message).toContain("Nigerian");
      expect(message).toContain("Nigeria (+234)");
      // It says which code the chip is on, so the host can see the mismatch.
      expect(message).toContain(`not a ${dialOf(iso)} one`);
    }
  });
});

describe("issue #3380 tester retest — the reverse directions", () => {
  test.each([["07700900123"], ["7700900123"], ["07911 123456"]])(
    "a UK mobile %s under NG, US, GH or KE is refused and names the United Kingdom",
    (text) => {
      for (const iso of ["NG", "US", "GH", "KE"]) {
        const message = refusalOf(text, iso);
        expect(message).toContain("the United Kingdom (+44)");
        expect(message).toContain(`not a ${dialOf(iso)} one`);
      }
      expect(typed(text, "GB")).toMatchObject({ ok: true, phoneCountryIso: "GB" });
    },
  );

  test.each([["14155550123"], ["1 (415) 555-0123"], ["1-415-555-0123"]])(
    "a US number typed with its leading 1 (%s) under GB, NG, GH or KE is refused and names the United States",
    (text) => {
      for (const iso of ["GB", "NG", "GH", "KE"]) {
        expect(refusalOf(text, iso)).toContain("the United States (+1)");
      }
      expect(typed(text, "US")).toEqual({
        ok: true,
        phone: "+14155550123",
        phoneCountryIso: "US",
      });
    },
  );

  test("a US ten-digit number under GH or KE is refused, never given their code", () => {
    for (const iso of ["GH", "KE"]) {
      expect(typed("(415) 555-0123", iso).ok).toBe(false);
    }
  });
});

describe("issue #3380 tester retest — the way out of a refusal", () => {
  test("fixing the flag saves the same digits correctly", () => {
    expect(typed("08031234567", "GB").ok).toBe(false);
    expect(typed("08031234567", "NG")).toEqual({
      ok: true,
      phone: "+2348031234567",
      phoneCountryIso: "NG",
    });
  });

  test("clearing the box clears the number, whatever the flag and whatever was stored", () => {
    for (const iso of ["GB", "US", "NG", "GH", "KE"]) {
      for (const text of ["", "   "]) {
        expect(typed(text, iso, "08031234567")).toEqual({
          ok: true,
          phone: undefined,
          phoneCountryIso: undefined,
        });
      }
    }
  });

  test.each([
    ["+2348031234567", "+2348031234567", "NG"],
    ["+234 (0) 803 123 4567", "+2348031234567", "NG"],
    ["002348031234567", "+2348031234567", "NG"],
    ["+44 7700 900123", "+447700900123", "GB"],
    ["+1 415 555 0123", "+14155550123", "US"],
    ["+33 6 12 34 56 78", "+33612345678", "FR"],
  ])("a typed %s is saved as typed under every flag", (text, e164, iso) => {
    for (const flag of ["GB", "US", "NG", "GH", "KE", "FR", "BS"]) {
      expect(typed(text, flag)).toEqual({
        ok: true,
        phone: e164,
        phoneCountryIso: iso,
      });
    }
  });

  test("UK 0800 freephone is saved under +44; 0808, 070 and 09 are refused there but save with a typed +44", () => {
    expect(typed("0800 123 4567", "GB")).toEqual({
      ok: true,
      phone: "+448001234567",
      phoneCountryIso: "GB",
    });
    for (const [national, e164] of [
      ["0808 157 0192", "+448081570192"],
      ["070 1234 5678", "+447012345678"],
      ["0901 123 4567", "+449011234567"],
    ]) {
      expect(typed(national, "GB").ok).toBe(false);
      for (const flag of ["GB", "NG", "US"]) {
        expect(typed(`+44 ${national}`, flag)).toEqual({
          ok: true,
          phone: e164,
          phoneCountryIso: "GB",
        });
      }
    }
  });
});

describe("issue #3380 tester retest — a legacy number the host touched and put back", () => {
  const stored = "08031234567";

  test("is refused under the default flag, and the stored value is not what gets rewritten", () => {
    const opened = brandPhoneForEdit(stored, null, DIRECTORY);
    expect(opened).toEqual({
      localText: stored,
      countryIso: "GB",
      savedWithCountry: false,
    });
    // The box holds exactly what it opened with; only `phoneEdit` is non-null.
    const result = typed(opened.localText, opened.countryIso, stored, null);
    expect(result.ok).toBe(false);
  });

  test("only the country changed: the same digits save under the country picked", () => {
    const opened = brandPhoneForEdit(stored, null, DIRECTORY);
    expect(typed(opened.localText, "NG", stored, null)).toEqual({
      ok: true,
      phone: "+2348031234567",
      phoneCountryIso: "NG",
    });
  });
});

describe("issue #3380 tester retest — an untouched legacy number on a brand with no country", () => {
  test.each([
    ["08031234567"],
    ["0803 123 4567"],
    ["  08031234567  "],
    ["(415) 555-0123"],
    ["4155550123"],
    ["07700900123"],
    ["0241234567"],
    ["call the front desk"],
    ["08031234567 ext 4"],
    ["+"],
    ["0000000"],
  ])("%s is kept exactly and never blocks the save", (legacy) => {
    for (const brandCountryCode of [null, undefined, "", "ZZ", "Atlantis"]) {
      const result = brandPhoneForSave({
        stored: legacy,
        brandCountryCode,
        edit: null,
        directory: DIRECTORY,
      });
      expect(result).toEqual({
        ok: true,
        phone: legacy.trim(),
        phoneCountryIso: undefined,
      });
      if (!result.ok) return;
      // The contact block is handed back as the same object: nothing to send.
      const contact = { email: "hello@example.test", phone: legacy };
      expect(brandContactWithSavedPhone(contact, result)).toBe(contact);
      // And the unsaved value is never remembered under a country.
      rememberBrandPhoneSavedCountry(result);
      expect(brandPhoneSessionCountryIso(legacy)).toBeNull();
    }
  });
});

describe("issue #3380 tester retest — re-opening, and the in-memory country hint", () => {
  test("+1242 is the Bahamas on any brand, and no remembered pick can move it", () => {
    for (const brandCountry of [null, "US", "CA", "GB", "BS"]) {
      for (const pick of [null, "US", "CA", "GB"]) {
        expect(
          brandPhoneForEdit("+12425551234", brandCountry, DIRECTORY, pick),
        ).toEqual({
          localText: "5551234",
          countryIso: "BS",
          savedWithCountry: true,
        });
      }
    }
  });

  test("inside +1 the brand's own country beats a remembered pick", () => {
    expect(brandPhoneForEdit("+14165550123", "CA", DIRECTORY, "US").countryIso).toBe("CA");
    expect(brandPhoneForEdit("+14165550123", "US", DIRECTORY, "CA").countryIso).toBe("US");
  });

  test("a pick from outside the number's dial code is ignored", () => {
    for (const pick of ["GB", "NG", "BS", "ZZ", ""]) {
      expect(brandPhoneForEdit("+14165550123", null, DIRECTORY, pick).countryIso).toBe("US");
    }
  });

  test("a save under Canada on a brand with no country re-opens under Canada in the same run", () => {
    const number = "+16045550177";
    expect(brandPhoneForEdit(number, null, DIRECTORY).countryIso).toBe("US");
    const saved = typed("(604) 555-0177", "CA");
    expect(saved).toEqual({ ok: true, phone: number, phoneCountryIso: "CA" });
    if (!saved.ok) return;
    rememberBrandPhoneSavedCountry(saved);

    expect(brandPhoneForEdit(number, null, DIRECTORY)).toEqual({
      localText: "6045550177",
      countryIso: "CA",
      savedWithCountry: true,
    });
    // The hint is keyed by the exact number: a neighbour does not inherit it.
    expect(brandPhoneForEdit("+16045550178", null, DIRECTORY).countryIso).toBe("US");
    expect(brandPhoneSessionCountryIso("+16045550178")).toBeNull();
    // Another brand holding the same number but with its own country keeps it.
    expect(brandPhoneForEdit(number, "US", DIRECTORY).countryIso).toBe("US");
    // The number saved is the same whichever country the chip shows.
    expect(
      brandPhoneForSave({
        stored: number,
        brandCountryCode: null,
        edit: null,
        directory: DIRECTORY,
      }),
    ).toEqual({ ok: true, phone: number, phoneCountryIso: "CA" });
  });

  test("a later save of the same number under another country replaces the hint", () => {
    const number = "+16045550179";
    rememberBrandPhoneSavedCountry({ ok: true, phone: number, phoneCountryIso: "CA" });
    rememberBrandPhoneSavedCountry({ ok: true, phone: number, phoneCountryIso: "pr" });
    expect(brandPhoneSessionCountryIso(number)).toBe("PR");
    expect(brandPhoneForEdit(number, null, DIRECTORY).countryIso).toBe("PR");
  });

  test("a cleared number and a refused save leave no hint behind", () => {
    rememberBrandPhoneSavedCountry({ ok: true, phone: undefined, phoneCountryIso: undefined });
    rememberBrandPhoneSavedCountry({ ok: true, phone: "+16045550180", phoneCountryIso: undefined });
    expect(brandPhoneSessionCountryIso("+16045550180")).toBeNull();
    expect(brandPhoneSessionCountryIso(undefined)).toBeNull();
    expect(brandPhoneSessionCountryIso("")).toBeNull();
  });

  test("the hint holds at most fifty numbers: the oldest is dropped", () => {
    const first = "+16045551000";
    rememberBrandPhoneSavedCountry({ ok: true, phone: first, phoneCountryIso: "CA" });
    expect(brandPhoneSessionCountryIso(first)).toBe("CA");
    for (let index = 1; index <= 50; index += 1) {
      rememberBrandPhoneSavedCountry({
        ok: true,
        phone: `+1604555${1000 + index}`,
        phoneCountryIso: "CA",
      });
    }
    expect(brandPhoneSessionCountryIso(first)).toBeNull();
    expect(brandPhoneForEdit(first, null, DIRECTORY).countryIso).toBe("US");
    expect(brandPhoneSessionCountryIso("+16045551050")).toBe("CA");
  });
});

describe("issue #3380 tester retest — the editor shows the refusal and never dead-ends", () => {
  const editor = source("src/components/brand/BrandEditView.tsx");
  const save = editor.slice(
    editor.indexOf("const phoneToSave = brandPhoneForSave({"),
    editor.indexOf("const handleBackPress"),
  );

  test("a refusal puts the message on the field and stops before anything is sent", () => {
    const refusal = save.slice(
      save.indexOf("if (!phoneToSave.ok) {"),
      save.indexOf("const draftToSave"),
    );
    expect(refusal).toContain("setContactPhoneError(phoneToSave.message);");
    expect(refusal).toContain("announceForAccessibility(phoneToSave.message)");
    expect(refusal).toMatch(/return;\s*}\s*$/);
    expect(refusal).not.toContain("onSave(");
    expect(save.indexOf("if (!phoneToSave.ok) {")).toBeLessThan(
      save.indexOf("await onSave(draftToSave)"),
    );
    expect(editor).toContain("error={contactPhoneError}");
    expect(editor).toContain('errorId="brand-edit-contact-phone-error"');
  });

  test("the Save button is never disabled by the phone error", () => {
    const button = editor.slice(
      editor.indexOf("const saveButton = ("),
      editor.indexOf("accessibilityLabel=\"Save brand changes\""),
    );
    expect(button).toContain("disabled={!isDirty || submitting}");
    expect(button).not.toContain("contactPhoneError");
  });

  test("typing in the box and picking a country each clear the message", () => {
    const field = editor.slice(
      editor.indexOf('accessibilityLabel="Contact email"'),
      editor.indexOf('accessibilityLabel="Contact phone"'),
    );
    const typing = field.slice(
      field.indexOf('variant="phone"'),
      field.indexOf("defaultCountryIso="),
    );
    const picking = field.slice(field.indexOf("onCountryChange={(country) => {"));
    for (const handler of [typing, picking]) {
      expect(handler).toContain("setPhoneEdit({");
      expect(handler).toContain(
        "if (contactPhoneError !== null) setContactPhoneError(null);",
      );
    }
    expect(picking).toContain("countryIso: country.iso,");
  });

  test("the country is remembered only after the save succeeded, and only for a number the host edited", () => {
    const remember = save.indexOf("rememberBrandPhoneSavedCountry(phoneToSave)");
    expect(remember).toBeGreaterThan(save.indexOf("await onSave(draftToSave)"));
    expect(remember).toBeLessThan(save.indexOf("} catch (error) {"));
    expect(save).toContain(
      "if (phoneEdit !== null) rememberBrandPhoneSavedCountry(phoneToSave);",
    );
    expect(editor.match(/rememberBrandPhoneSavedCountry\(/g)).toHaveLength(1);
  });
});
