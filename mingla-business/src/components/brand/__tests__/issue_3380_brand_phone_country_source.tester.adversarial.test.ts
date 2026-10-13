/**
 * issue #3380 retest 2 — tester adversarial: the SCREEN can never save a brand
 * phone under a country nobody chose.
 *
 * The implementor's test proves the rules function refuses a `fallback`
 * source. This file attacks a different angle: the path from the form to the
 * save call. It drives a model of the editor's three phone handlers (type,
 * pick a country, save) through the real rules, in the orders a host really
 * uses them (digits first and the chip never opened, paste, re-typing the
 * same legacy digits, touching the phone and then editing another field), and
 * pins the model to `BrandEditView.tsx` so the two cannot drift apart: the
 * screen must pass the real source on every path, and must not be able to
 * reach the "source left out means picked" path the rules keep for old tests.
 *
 * It also fuzzes the refusal (no digits, punctuation or whitespace typed
 * without a "+" or "00" may ever compose under `fallback`, for any default
 * country), and checks the chip and the save can never disagree.
 *
 * FAILS ON REVERT: delete the
 * `(edit.countrySource ?? "picked") === "fallback" && !namesOwnCountry`
 * refusal in `brandPhoneForSave` and the screen-model, retest-1 and fuzz cases
 * below save +44 numbers.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, jest, test } from "@jest/globals";

import {
  brandPhoneSessionCountryCount,
  clearBrandPhoneSessionCountries,
  getBrandPhoneSessionCountry,
  setBrandPhoneSessionCountry,
} from "../../../utils/brandPhoneSessionCountries";
import {
  BRAND_PHONE_CHOOSE_COUNTRY_LABEL,
  BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE,
  BRAND_PHONE_FALLBACK_COUNTRY_ISO,
  brandContactWithSavedPhone,
  brandPhoneCountrySourceForEdit,
  brandPhoneForEdit,
  brandPhoneForSave,
  rememberBrandPhoneSavedCountry,
  type BrandPhoneCountrySource,
  type BrandPhoneDirectory,
  type BrandPhoneSaveResult,
} from "../brandContactPhoneRules";
import { updateBrand } from "../../../services/brandsService";

const BRAND_ROW_ID = "33800000-0000-4000-8000-0000000000a2";

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

const read = (relativePath: string): string =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

const INPUT_SOURCE = read("src/components/ui/Input.tsx");
const EDITOR_SOURCE = read("src/components/brand/BrandEditView.tsx");
const RULES_SOURCE = read("src/components/brand/brandContactPhoneRules.ts");

/** Code only: line and block comments removed, so prose cannot satisfy a pin. */
const stripComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

const EDITOR_CODE = stripComments(EDITOR_SOURCE);
const INPUT_CODE = stripComments(INPUT_SOURCE);

// The country list the chip really shows.
const DIRECTORY: BrandPhoneDirectory = [
  ...INPUT_SOURCE.matchAll(
    /\{ iso: "([A-Z]{2})", name: "[^"]*", dialCode: "(\+\d+)"/g,
  ),
].map((match) => ({ iso: match[1], dialCode: match[2] }));

const dialOf = (iso: string): string => {
  const found = DIRECTORY.find((country) => country.iso === iso);
  if (found === undefined) throw new Error(`no ${iso} in the directory`);
  return found.dialCode;
};

// ---------------------------------------------------------------------------
// A model of the editor's phone wiring. Each method is the body of the
// matching handler in BrandEditView.tsx; the "screen pins" block below fails
// if the screen stops matching it.
// ---------------------------------------------------------------------------

interface PhoneEdit {
  text: string;
  countryIso: string;
  countrySource: BrandPhoneCountrySource;
}

class EditorModel {
  edit: PhoneEdit | null = null;
  otherFieldDirty = false;
  lastError: string | null = null;
  writes: (string | undefined)[] = [];

  constructor(
    public stored: string | undefined,
    public brandCountryCode: string | null | undefined,
  ) {}

  get opened() {
    return {
      ...brandPhoneForEdit(this.stored, this.brandCountryCode, DIRECTORY),
      countrySource: brandPhoneCountrySourceForEdit(
        this.stored,
        this.brandCountryCode,
        DIRECTORY,
      ),
    };
  }

  /** onChangeText */
  type(text: string): this {
    const opened = this.opened;
    this.edit = {
      text,
      countryIso: this.edit?.countryIso ?? opened.countryIso,
      countrySource: this.edit?.countrySource ?? opened.countrySource,
    };
    this.lastError = null;
    return this;
  }

  /** onCountryChange */
  pick(iso: string): this {
    this.edit = {
      text: this.edit?.text ?? this.opened.localText,
      countryIso: iso,
      countrySource: "picked",
    };
    this.lastError = null;
    return this;
  }

  editAnotherField(): this {
    this.otherFieldDirty = true;
    return this;
  }

  get source(): BrandPhoneCountrySource {
    return this.edit?.countrySource ?? this.opened.countrySource;
  }

  /** What the chip shows: the placeholder, or the flag of a country. */
  get chip(): string {
    return this.source === "fallback"
      ? BRAND_PHONE_CHOOSE_COUNTRY_LABEL
      : `flag:${this.edit?.countryIso ?? this.opened.countryIso}`;
  }

  get dirty(): boolean {
    const opened = this.opened;
    if (
      this.edit !== null &&
      (this.edit.text.trim() !== opened.localText ||
        this.edit.countryIso !== opened.countryIso ||
        (opened.countrySource === "fallback" &&
          this.edit.countrySource === "picked"))
    ) {
      return true;
    }
    return this.otherFieldDirty;
  }

  /** handleSave */
  save(): BrandPhoneSaveResult | "not dirty" {
    if (!this.dirty) return "not dirty";
    const result = brandPhoneForSave({
      stored: this.stored,
      brandCountryCode: this.brandCountryCode,
      edit: this.edit,
      directory: DIRECTORY,
    });
    if (!result.ok) {
      this.lastError = result.message;
      return result;
    }
    const contact = brandContactWithSavedPhone({ phone: this.stored }, result);
    if (this.edit !== null) rememberBrandPhoneSavedCountry(result);
    this.stored = contact?.phone;
    this.writes.push(this.stored);
    this.edit = null;
    this.otherFieldDirty = false;
    return result;
  }
}

const refused = (result: BrandPhoneSaveResult | "not dirty"): string => {
  if (result === "not dirty" || result.ok) {
    throw new Error(`expected a refusal, got ${JSON.stringify(result)}`);
  }
  return result.message;
};

const saved = (result: BrandPhoneSaveResult | "not dirty"): string | undefined => {
  if (result === "not dirty" || !result.ok) {
    throw new Error(`expected a save, got ${JSON.stringify(result)}`);
  }
  return result.phone;
};

/** The numbers retest 1 failed on. */
const RETEST_1_INPUTS = [
  "4155550123",
  "(415) 555-0123",
  "9193770509",
  "0241234567",
  "0712345678",
  "0851234567",
  "08031234567",
  "020 7946 0000",
] as const;

/** Every way a production brand can have "no country". */
const NO_BRAND_COUNTRY = [null, undefined, "", "  ", "ZZ", "not a country"] as const;

afterEach(() => {
  clearBrandPhoneSessionCountries();
});

// ---------------------------------------------------------------------------
// 1. Screen pins — the model above IS the screen
// ---------------------------------------------------------------------------

describe("issue #3380 retest 2 — the editor always passes the real country source", () => {
  const phoneField = EDITOR_CODE.slice(
    EDITOR_CODE.indexOf('variant="phone"'),
    EDITOR_CODE.indexOf('errorId="brand-edit-contact-phone-error"'),
  );

  test("the phone field block was found", () => {
    expect(phoneField.length).toBeGreaterThan(200);
  });

  test("the source is a required part of the phone edit, never optional", () => {
    expect(EDITOR_CODE).toMatch(
      /useState<\{\s*text: string;\s*countryIso: string;\s*countrySource: BrandPhoneCountrySource;\s*\} \| null>\(null\)/,
    );
    expect(EDITOR_CODE).not.toMatch(/countrySource\?\s*:/);
    // No cast can smuggle a source in.
    expect(EDITOR_CODE).not.toMatch(/as BrandPhoneCountrySource/);
    expect(EDITOR_CODE).not.toMatch(/as any|as unknown as \{[^}]*countrySource/);
  });

  test("the save call hands over the phone edit itself, not a rebuilt object that could drop the source", () => {
    const calls = EDITOR_CODE.match(/brandPhoneForSave\(\{[\s\S]*?\}\)/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/\bedit: phoneEdit,/);
    expect(calls[0]).not.toMatch(/edit: \{/);
    expect(calls[0]).toMatch(/stored: draft\.contact\?\.phone,/);
    expect(calls[0]).toMatch(/brandCountryCode: draft\.countryCode,/);
    expect(calls[0]).toMatch(/directory: PHONE_COUNTRIES,/);
  });

  test("every write of the phone edit carries a source; none can leave it out", () => {
    const writes = EDITOR_CODE.match(/setPhoneEdit\(\{[\s\S]*?\}\);/g) ?? [];
    expect(writes).toHaveLength(2);
    for (const write of writes) expect(write).toMatch(/countrySource/);
    // The only other write clears it after a successful save.
    const all = EDITOR_CODE.match(/setPhoneEdit\(/g) ?? [];
    const nulls = EDITOR_CODE.match(/setPhoneEdit\(null\)/g) ?? [];
    expect(all.length - nulls.length).toBe(2);
    // Never a functional update that could spread an old shape.
    expect(EDITOR_CODE).not.toMatch(/setPhoneEdit\(\s*\(/);
  });

  test("typing keeps whatever the source already was; it never invents one", () => {
    const typing = phoneField.slice(
      phoneField.indexOf("onChangeText={"),
      phoneField.indexOf("defaultCountryIso="),
    );
    expect(typing).toMatch(
      /countrySource:\s*phoneEdit\?\.countrySource \?\? openedPhone\.countrySource,/,
    );
    expect(typing).toMatch(
      /countryIso: phoneEdit\?\.countryIso \?\? openedPhone\.countryIso,/,
    );
    expect(typing).not.toMatch(/"picked"|"stored"|"brand"/);
  });

  test("only the country list can make the source picked", () => {
    expect(EDITOR_CODE.match(/countrySource: "picked"/g) ?? []).toHaveLength(1);
    const picking = phoneField.slice(
      phoneField.indexOf("onCountryChange={"),
      phoneField.indexOf("countryPlaceholder="),
    );
    expect(picking).toMatch(/countryIso: country\.iso,\s*countrySource: "picked",/);
    // Nowhere else assigns a literal source.
    expect(EDITOR_CODE).not.toMatch(/countrySource: "(stored|brand|fallback)"/);
    expect(EDITOR_CODE).not.toMatch(/countrySource = /);
  });

  test("the opened source comes from the rules, off the same saved number and brand country as the save", () => {
    expect(EDITOR_CODE).toMatch(
      /countrySource: brandPhoneCountrySourceForEdit\(\s*savedPhone,\s*brandCountryCode,\s*PHONE_COUNTRIES,\s*\)/,
    );
    expect(EDITOR_CODE).toMatch(/const savedPhone = draft\?\.contact\?\.phone;/);
    expect(EDITOR_CODE).toMatch(/const brandCountryCode = draft\?\.countryCode;/);
  });

  test("the chip placeholder and the save read the same source expression", () => {
    expect(phoneField).toMatch(
      /countryPlaceholder=\{\s*\(phoneEdit\?\.countrySource \?\? openedPhone\.countrySource\) ===\s*"fallback"\s*\? BRAND_PHONE_CHOOSE_COUNTRY_LABEL\s*: undefined\s*\}/,
    );
  });

  test("the dirty rule in the model is the screen's", () => {
    expect(EDITOR_CODE).toMatch(
      /phoneEdit !== null &&\s*\(phoneEdit\.text\.trim\(\) !== openedPhone\.localText \|\|\s*phoneEdit\.countryIso !== openedPhone\.countryIso \|\|\s*\(openedPhone\.countrySource === "fallback" &&\s*phoneEdit\.countrySource === "picked"\)\)/,
    );
  });

  test("the editor is the only caller of the save rule in the app", () => {
    const callers: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "__tests__") continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          if (/brandPhoneForSave\(/.test(stripComments(readFileSync(full, "utf8")))) {
            callers.push(full.replace(`${process.cwd()}/`, ""));
          }
        }
      }
    };
    walk(join(process.cwd(), "src"));
    walk(join(process.cwd(), "app"));
    expect(callers.sort()).toEqual([
      "src/components/brand/BrandEditView.tsx",
      "src/components/brand/brandContactPhoneRules.ts",
    ]);
  });

  test("the rules never produce picked on open", () => {
    for (const stored of [null, "", "08031234567", "+2348031234567", "+14165550123", "+999"]) {
      for (const brand of [...NO_BRAND_COUNTRY, "GB", "NG", "US", "gb"]) {
        expect(
          brandPhoneCountrySourceForEdit(stored, brand, DIRECTORY),
        ).not.toBe("picked");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Every path from the form to the save call, on a brand with no country
// ---------------------------------------------------------------------------

describe("issue #3380 retest 2 — a host who never opens the country list cannot save bare digits", () => {
  test.each(NO_BRAND_COUNTRY.map((brand) => [String(JSON.stringify(brand)), brand] as const))(
    "brand country %s: digits typed first, chip never opened",
    (_label, brand) => {
      for (const input of RETEST_1_INPUTS) {
        const screen = new EditorModel(undefined, brand);
        expect(screen.chip).toBe(BRAND_PHONE_CHOOSE_COUNTRY_LABEL);
        screen.type(input);
        expect(screen.edit?.countrySource).toBe("fallback");
        expect(screen.chip).toBe(BRAND_PHONE_CHOOSE_COUNTRY_LABEL);
        expect(refused(screen.save())).toBe(BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE);
        expect(screen.writes).toEqual([]);
        expect(screen.stored).toBeUndefined();
      }
    },
  );

  test("typed one key at a time, the source stays fallback on every keystroke", () => {
    const screen = new EditorModel(undefined, null);
    let text = "";
    for (const key of "4155550123") {
      text += key;
      screen.type(text);
      expect(screen.edit?.countrySource).toBe("fallback");
      expect(screen.edit?.countryIso).toBe(BRAND_PHONE_FALLBACK_COUNTRY_ISO);
    }
    expect(refused(screen.save())).toBe(BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE);
    // Saving again and again never wears the refusal down.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(refused(screen.save())).toBe(BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE);
    }
    expect(screen.writes).toEqual([]);
  });

  test("a pasted number replaces a legacy one and is still refused", () => {
    for (const input of RETEST_1_INPUTS) {
      const screen = new EditorModel("07000000000", null);
      screen.type(input);
      expect(refused(screen.save())).toBe(BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE);
      expect(screen.stored).toBe("07000000000");
    }
  });

  test("a legacy number re-typed character for character is not composed, even with another field edited", () => {
    for (const legacy of RETEST_1_INPUTS) {
      const screen = new EditorModel(legacy, null);
      // Select all, type the same digits again.
      screen.type("").type(legacy);
      expect(screen.edit?.countrySource).toBe("fallback");
      // The phone alone is not a change, so Save is not even live.
      expect(screen.dirty).toBe(false);
      expect(screen.save()).toBe("not dirty");
      // Another field makes Save live; the phone still cannot become +44.
      screen.editAnotherField();
      const result = screen.save();
      if (result !== "not dirty" && result.ok) {
        expect(result.phone).toBe(legacy);
      } else {
        expect(refused(result)).toBe(BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE);
      }
      expect(screen.stored).toBe(legacy);
      expect(screen.stored?.startsWith("+")).toBe(false);
    }
  });

  test("touching the phone, then editing another field, then saving never writes a +44 number", () => {
    for (const input of RETEST_1_INPUTS) {
      const screen = new EditorModel(undefined, null);
      screen.type(input).editAnotherField();
      expect(refused(screen.save())).toBe(BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE);
      expect(screen.writes).toEqual([]);
    }
  });

  test("the refusal does not turn into a pick: typing again after the error is still fallback", () => {
    const screen = new EditorModel(undefined, null);
    screen.type("4155550123");
    refused(screen.save());
    screen.type("4155550124");
    expect(screen.edit?.countrySource).toBe("fallback");
    expect(refused(screen.save())).toBe(BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE);
  });

  test("the model with the source dropped is the retest-1 defect, so the pins above matter", () => {
    // What a code path that omitted the source would do.
    const result = brandPhoneForSave({
      stored: null,
      brandCountryCode: null,
      edit: { text: "4155550123", countryIso: "GB" },
      directory: DIRECTORY,
    });
    expect(result).toEqual({ ok: true, phone: "+444155550123", phoneCountryIso: "GB" });
  });
});

// ---------------------------------------------------------------------------
// 3. Fuzz — nothing typed without "+" / "00" composes under fallback
// ---------------------------------------------------------------------------

describe("issue #3380 retest 2 — the fallback refusal has no hole", () => {
  test("no bare number composes under fallback, whatever the default country or punctuation", () => {
    let seed = 3380;
    const next = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % bound;
    };
    const separators = ["", " ", "-", ".", "(", ")", "\t", "  "];
    const isos = DIRECTORY.map((country) => country.iso);
    let checked = 0;
    for (let round = 0; round < 4000; round += 1) {
      const length = 4 + next(13);
      let text = "";
      for (let index = 0; index < length; index += 1) {
        text += String(next(10));
        if (next(4) === 0) text += separators[next(separators.length)];
      }
      const compact = text.replace(/[\s().-]/g, "");
      // Leave out what the rules read as an international prefix.
      if (/^00[1-9]/.test(compact)) continue;
      const iso = isos[next(isos.length)];
      for (const padded of [text, ` ${text}`, `${text}\n`, ` ${text}`]) {
        const result = brandPhoneForSave({
          stored: next(2) === 0 ? null : "08031234567",
          brandCountryCode: null,
          edit: { text: padded, countryIso: iso, countrySource: "fallback" },
          directory: DIRECTORY,
        });
        checked += 1;
        if (padded.trim().length === 0) continue;
        expect({ padded, iso, result }).toEqual({
          padded,
          iso,
          result: { ok: false, message: BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE },
        });
      }
    }
    expect(checked).toBeGreaterThan(10000);
  });

  test("under fallback a saved number is only ever the country code the host typed", () => {
    const typedInternational: [string, string][] = [
      ["+14155550123", "+14155550123"],
      ["+1 (415) 555-0123", "+14155550123"],
      ["+2348031234567", "+2348031234567"],
      ["+234 (0) 803 123 4567", "+2348031234567"],
      ["+233241234567", "+233241234567"],
      ["+442079460000", "+442079460000"],
      ["00442079460000", "+442079460000"],
      ["0012125550123", "+12125550123"],
      ["00 234 803 123 4567", "+2348031234567"],
    ];
    for (const [text, expected] of typedInternational) {
      for (const iso of ["GB", "US", "NG", "GH", "FR"]) {
        const result = brandPhoneForSave({
          stored: null,
          brandCountryCode: null,
          edit: { text, countryIso: iso, countrySource: "fallback" },
          directory: DIRECTORY,
        });
        expect({ text, iso, result }).toMatchObject({
          result: { ok: true, phone: expected },
        });
      }
    }
  });

  test("look-alike prefixes are not read as a typed country code", () => {
    const lookalikes = [
      "＋447911123456", // full-width plus
      "000447911123456", // three zeros
      "0 7911 123456",
      "44 7911 123456", // country code with no plus
      "447911123456",
      "2348031234567",
      "1 415 555 0123",
      "p+447911123456",
      "tel:+447911123456",
    ];
    for (const text of lookalikes) {
      const result = brandPhoneForSave({
        stored: null,
        brandCountryCode: null,
        edit: { text, countryIso: "GB", countrySource: "fallback" },
        directory: DIRECTORY,
      });
      expect({ text, ok: result.ok }).toEqual({ text, ok: false });
    }
  });

  test("the refusal comes before any composing, and reads the source it was given", () => {
    const rules = stripComments(RULES_SOURCE);
    const refusalAt = rules.indexOf(
      '(edit.countrySource ?? "picked") === "fallback" && !namesOwnCountry',
    );
    const saveStart = rules.indexOf("export function brandPhoneForSave(");
    const firstTypedCompose = rules.indexOf(
      "composePhoneE164(country.dialCode, text)",
    );
    expect(refusalAt).toBeGreaterThan(saveStart);
    expect(firstTypedCompose).toBeGreaterThan(refusalAt);
    // No probe of the typed text runs before it either.
    const between = rules.slice(rules.indexOf("const text = edit.text.trim();"), refusalAt);
    expect(between).not.toMatch(/parsePhoneEntry\(|composePhoneE164\(/);
  });
});

// ---------------------------------------------------------------------------
// 4. After a pick: the picked country or a refusal with advice, never another
// ---------------------------------------------------------------------------

describe("issue #3380 retest 2 — a picked country is the only country a bare number can be saved under", () => {
  const EXPECTED: Record<string, Record<string, string | null>> = {
    US: {
      "4155550123": "+14155550123",
      "(415) 555-0123": "+14155550123",
      "9193770509": "+19193770509",
      "0241234567": null,
      "0712345678": null,
      "0851234567": null,
      "08031234567": null,
      "020 7946 0000": null,
    },
    NG: {
      "08031234567": "+2348031234567",
      "0241234567": null,
      "0712345678": null,
      "0851234567": null,
    },
    GH: {
      "0241234567": "+233241234567",
      "4155550123": null,
      "(415) 555-0123": null,
      "9193770509": null,
      "08031234567": null,
      "020 7946 0000": null,
    },
    GB: {
      "020 7946 0000": "+442079460000",
      "08031234567": null,
      "9193770509": null,
    },
  };

  test.each(["US", "GB", "NG", "GH"])(
    "picked %s: every retest-1 number saves under it or is refused with advice",
    (iso) => {
      for (const input of RETEST_1_INPUTS) {
        // Digits first, then the pick: the order retest 1 was done in.
        const screen = new EditorModel(undefined, null);
        screen.type(input);
        expect(refused(screen.save())).toBe(BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE);
        screen.pick(iso);
        expect(screen.chip).toBe(`flag:${iso}`);
        const result = screen.save();
        if (result === "not dirty") throw new Error("a pick must make the form dirty");
        if (result.ok) {
          expect(result.phone?.startsWith(dialOf(iso))).toBe(true);
          expect(result.phoneCountryIso).toBe(iso);
          expect(screen.stored).toBe(result.phone);
        } else {
          expect(result.message.length).toBeGreaterThan(10);
          expect(result.message).not.toBe(BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE);
          expect(screen.writes).toEqual([]);
        }
        const expected = EXPECTED[iso][input];
        if (expected === null) expect(result.ok).toBe(false);
        if (typeof expected === "string") expect(saved(result)).toBe(expected);

        // The pick first, then the digits: same answer.
        const other = new EditorModel(undefined, null).pick(iso).type(input);
        expect(other.edit?.countrySource).toBe("picked");
        const again = other.save();
        if (again === "not dirty") throw new Error("typed digits must be dirty");
        expect(again.ok).toBe(result.ok);
        if (again.ok && result.ok) expect(again.phone).toBe(result.phone);
      }
    },
  );

  test("9193770509 is a United States number once the host says so, never a Nigerian one", () => {
    const screen = new EditorModel(undefined, null).type("9193770509").pick("US");
    expect(saved(screen.save())).toBe("+19193770509");
    const reopened = new EditorModel(screen.stored, null);
    expect(reopened.opened.countrySource).toBe("stored");
    expect(reopened.opened.localText).toBe("9193770509");
    expect(reopened.chip).toBe("flag:US");
  });

  test("picking one country and then another saves under the last one", () => {
    const screen = new EditorModel(undefined, null)
      .type("4155550123")
      .pick("GH")
      .pick("US");
    expect(saved(screen.save())).toBe("+14155550123");
  });
});

// ---------------------------------------------------------------------------
// 5. stored / brand sources, untouched values, clearing
// ---------------------------------------------------------------------------

describe("issue #3380 retest 2 — a country that came from somewhere keeps composing", () => {
  test("a saved E.164 number: new digits compose under its own country with no pick", () => {
    const screen = new EditorModel("+2348031234567", null);
    expect(screen.opened).toMatchObject({
      localText: "8031234567",
      countryIso: "NG",
      countrySource: "stored",
    });
    expect(screen.chip).toBe("flag:NG");
    screen.type("8039999999");
    expect(screen.edit?.countrySource).toBe("stored");
    expect(saved(screen.save())).toBe("+2348039999999");
  });

  test("a brand with a country: bare digits compose under the brand's country with no pick", () => {
    const screen = new EditorModel(undefined, "GH");
    expect(screen.opened.countrySource).toBe("brand");
    expect(screen.chip).toBe("flag:GH");
    screen.type("0241234567");
    expect(screen.edit?.countrySource).toBe("brand");
    expect(saved(screen.save())).toBe("+233241234567");
  });

  test("a saved number whose dial code is not in the list is not treated as having a country", () => {
    const screen = new EditorModel("+99912345678", null);
    expect(screen.opened.countrySource).toBe("fallback");
    expect(screen.chip).toBe(BRAND_PHONE_CHOOSE_COUNTRY_LABEL);
    screen.type("7911123456");
    expect(refused(screen.save())).toBe(BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE);
  });
});

describe("issue #3380 retest 2 — numbers nobody touched, and clearing", () => {
  test("an untouched legacy number on a brand with no country is written back byte for byte and never blocks a save", () => {
    for (const legacy of [...RETEST_1_INPUTS, "not a number", "+", "12"]) {
      for (const brand of NO_BRAND_COUNTRY) {
        const screen = new EditorModel(legacy, brand).editAnotherField();
        const result = screen.save();
        expect(result).toEqual({ ok: true, phone: legacy, phoneCountryIso: undefined });
        expect(screen.stored).toBe(legacy);
        // The contact block is handed back untouched, not rebuilt.
        const contact = { phone: legacy, email: "a@b.co" };
        expect(
          brandContactWithSavedPhone(contact, {
            ok: true,
            phone: legacy,
            phoneCountryIso: undefined,
          }),
        ).toBe(contact);
      }
    }
  });

  test("clearing the phone saves empty under every source", () => {
    const sources: BrandPhoneCountrySource[] = ["stored", "brand", "picked", "fallback"];
    for (const countrySource of sources) {
      for (const text of ["", "   ", "\n"]) {
        expect(
          brandPhoneForSave({
            stored: "08031234567",
            brandCountryCode: null,
            edit: { text, countryIso: "GB", countrySource },
            directory: DIRECTORY,
          }),
        ).toEqual({ ok: true, phone: undefined, phoneCountryIso: undefined });
      }
    }
    // On the screen: a legacy number, cleared, with the chip never opened.
    const screen = new EditorModel("08031234567", null).type("");
    expect(screen.dirty).toBe(true);
    expect(saved(screen.save())).toBeUndefined();
    expect(screen.stored).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. The chip and the save can never disagree
// ---------------------------------------------------------------------------

describe("issue #3380 retest 2 — the chip and the save agree in every reachable state", () => {
  test("random walks: 'Choose country' never composes a bare number, and a flag is never shown under fallback", () => {
    let seed = 20261013;
    const next = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % bound;
    };
    const texts = [...RETEST_1_INPUTS, "", "7911123456", "+14155550123", "00442079460000"];
    const picks = ["US", "GB", "NG", "GH", "CA", "KE"];
    const starts: [string | undefined, string | null][] = [
      [undefined, null],
      ["08031234567", null],
      ["4155550123", null],
      ["+2348031234567", null],
      ["+14165550123", null],
      [undefined, "NG"],
      ["0241234567", "GH"],
    ];
    let saves = 0;
    for (let walk = 0; walk < 600; walk += 1) {
      const [stored, brand] = starts[next(starts.length)];
      const screen = new EditorModel(stored, brand);
      for (let step = 0; step < 12; step += 1) {
        const action = next(5);
        if (action === 0 || action === 1) screen.type(texts[next(texts.length)]);
        else if (action === 2) screen.pick(picks[next(picks.length)]);
        else if (action === 3) screen.editAnotherField();
        else {
          const chipBefore = screen.chip;
          const sourceBefore = screen.source;
          const editBefore = screen.edit;
          const result = screen.save();
          // The chip is the placeholder exactly when the source is fallback.
          expect(chipBefore === BRAND_PHONE_CHOOSE_COUNTRY_LABEL).toBe(
            sourceBefore === "fallback",
          );
          if (result === "not dirty" || !result.ok || editBefore === null) continue;
          saves += 1;
          const compact = editBefore.text.trim().replace(/[\s().-]/g, "");
          const typedCode = compact.startsWith("+") || /^00[1-9]/.test(compact);
          if (chipBefore === BRAND_PHONE_CHOOSE_COUNTRY_LABEL) {
            // Nothing, or a number that names its own country: never a bare one.
            expect(result.phone === undefined || typedCode).toBe(true);
          } else if (result.phone !== undefined && !typedCode) {
            // A bare number is saved under the country on the chip, no other.
            expect(chipBefore).toBe(`flag:${editBefore.countryIso}`);
            expect(result.phone.startsWith(dialOf(editBefore.countryIso))).toBe(true);
          }
        }
      }
    }
    expect(saves).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// 7. Input.tsx — nothing changes for a phone field that does not ask
// ---------------------------------------------------------------------------

describe("issue #3380 retest 2 — the shared phone field is unchanged unless the placeholder is set", () => {
  test("the placeholder only counts on a phone field, and only as non-empty text", () => {
    expect(INPUT_CODE).toMatch(
      /const countryUnchosen =\s*isPhone &&\s*typeof countryPlaceholder === "string" &&\s*countryPlaceholder\.length > 0;/,
    );
    // It is not given a default that would switch it on for everyone.
    expect(INPUT_CODE).toMatch(/onCountryChange,\s*countryPlaceholder,\s*onFocus,/);
    expect(INPUT_CODE).not.toMatch(/countryPlaceholder\s*=\s*["'`]/);
  });

  test("with it absent the chip label, the flag and the selected row are what they were", () => {
    expect(INPUT_CODE).toMatch(
      /accessibilityLabel=\{\s*countryUnchosen\s*\? `\$\{countryPlaceholder\}\. No country chosen yet\. Tap to choose\.`\s*: `Country: \$\{country\.name\}, \$\{country\.dialCode\}\. Tap to change\.`\s*\}/,
    );
    expect(INPUT_CODE).toMatch(
      /\{countryUnchosen \? \(\s*<Text style=\{styles\.countryPlaceholder\} numberOfLines=\{1\}>\s*\{countryPlaceholder\}\s*<\/Text>\s*\) : \(\s*<Text style=\{styles\.countryFlag\}>\{country\.flag\}<\/Text>\s*\)\}/,
    );
    expect(INPUT_CODE).toMatch(
      /const isSelected = !countryUnchosen && c\.iso === country\.iso;/,
    );
    // Those are the only three places the flag reads it.
    expect(INPUT_CODE.match(/countryUnchosen/g) ?? []).toHaveLength(4);
  });

  test("picking a row always reports it, including the row the field defaulted to", () => {
    expect(INPUT_CODE).toMatch(
      /const handlePickCountry = useCallback\(\s*\(next: PhoneCountry\): void => \{\s*setCountry\(next\);\s*setPickerOpen\(false\);\s*onCountryChange\?\.\(next\);\s*\},/,
    );
    // No "same country, nothing to do" short-circuit anywhere in the handler.
    const handler = INPUT_CODE.slice(
      INPUT_CODE.indexOf("const handlePickCountry"),
      INPUT_CODE.indexOf("const handleClosePicker"),
    );
    expect(handler).not.toMatch(/\bif\b|===|return/);
  });

  test("the chip stays a labelled button that opens the list", () => {
    const chip = INPUT_CODE.slice(
      INPUT_CODE.indexOf("onPress={handleOpenPicker}"),
      INPUT_CODE.indexOf("style={styles.countryChip}"),
    );
    expect(chip).toMatch(/accessibilityRole="button"/);
    expect(chip).toMatch(/accessibilityLabel=/);
  });

  test("no other phone field in the app sets the placeholder", () => {
    const users: string[] = [];
    const phoneFields: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "__tests__") continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) {
          const code = stripComments(readFileSync(full, "utf8"));
          const relative = full.replace(`${process.cwd()}/`, "");
          if (relative === "src/components/ui/Input.tsx") continue;
          if (/countryPlaceholder/.test(code)) users.push(relative);
          if (/variant="phone"/.test(code)) phoneFields.push(relative);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    walk(join(process.cwd(), "app"));
    expect(users).toEqual(["src/components/brand/BrandEditView.tsx"]);
    // The other phone fields exist and are the ones left alone.
    expect(phoneFields.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Sign-out, and the boot bundle
// ---------------------------------------------------------------------------

describe("issue #3380 retest 2 — the remembered countries die with the session", () => {
  test("the store file imports nothing, and sign-out reaches it without the phone rules", () => {
    const store = read("src/utils/brandPhoneSessionCountries.ts");
    expect(stripComments(store)).not.toMatch(/\bimport\b|\brequire\(|export \* from|export \{[^}]*\} from/);
    const signOut = stripComments(read("src/utils/clearAllStores.ts"));
    expect(signOut).toMatch(
      /import \{ clearBrandPhoneSessionCountries \} from "\.\/brandPhoneSessionCountries";/,
    );
    expect(signOut).not.toMatch(/brandContactPhoneRules|phone-input|brand-rendering/);
    const body = signOut.slice(signOut.indexOf("export const clearAllStores"));
    expect(body).toMatch(/clearBrandPhoneSessionCountries\(\);/);
  });

  test("a pick made by one account does not open the next account's number", () => {
    // Account A saves a +1 number as Canada on a brand with no country.
    const first = new EditorModel(undefined, null).type("4165550123").pick("CA");
    expect(saved(first.save())).toBe("+14165550123");
    expect(new EditorModel("+14165550123", null).opened.countryIso).toBe("CA");
    expect(brandPhoneSessionCountryCount()).toBe(1);

    // What sign-out calls.
    clearBrandPhoneSessionCountries();
    expect(brandPhoneSessionCountryCount()).toBe(0);
    expect(getBrandPhoneSessionCountry("+14165550123")).toBeNull();
    expect(new EditorModel("+14165550123", null).opened.countryIso).not.toBe("CA");
  });

  test("a refused save remembers nothing, and neither does an untouched one", () => {
    const screen = new EditorModel(undefined, null).type("4155550123");
    refused(screen.save());
    expect(brandPhoneSessionCountryCount()).toBe(0);
    const untouched = new EditorModel("+14165550123", null).editAnotherField();
    saved(untouched.save());
    expect(brandPhoneSessionCountryCount()).toBe(0);
  });

  test("the map is bounded, so a long session cannot grow it without limit", () => {
    for (let index = 0; index < 120; index += 1) {
      setBrandPhoneSessionCountry(`+1416555${String(index).padStart(4, "0")}`, "ca");
    }
    expect(brandPhoneSessionCountryCount()).toBe(50);
    expect(getBrandPhoneSessionCountry("+14165550000")).toBeNull();
    expect(getBrandPhoneSessionCountry("+14165550119")).toBe("CA");
  });
});

// ---------------------------------------------------------------------------
// 9. Dirty state
// ---------------------------------------------------------------------------

describe("issue #3380 retest 2 — choosing the default country is a real change", () => {
  test("picking the country the chip defaulted to makes Save live and writes E.164", () => {
    const screen = new EditorModel("7911123456", null);
    expect(screen.opened.countryIso).toBe(BRAND_PHONE_FALLBACK_COUNTRY_ISO);
    expect(screen.dirty).toBe(false);
    screen.pick(BRAND_PHONE_FALLBACK_COUNTRY_ISO);
    expect(screen.dirty).toBe(true);
    expect(screen.chip).toBe("flag:GB");
    expect(saved(screen.save())).toBe("+447911123456");
    // Saved: the form is clean again and opens with a real country.
    expect(screen.edit).toBeNull();
    expect(screen.dirty).toBe(false);
    expect(screen.opened).toMatchObject({
      localText: "7911123456",
      countryIso: "GB",
      countrySource: "stored",
    });
  });

  test("picking the same country a saved number already has is not a change", () => {
    const screen = new EditorModel("+447911123456", null).pick("GB");
    expect(screen.dirty).toBe(false);
    expect(screen.save()).toBe("not dirty");
  });

  test("a discarded edit leaves nothing behind: the next open reads only the saved number", () => {
    const abandoned = new EditorModel("08031234567", null).type("4155550123").pick("US");
    expect(abandoned.dirty).toBe(true);
    // Discard closes the screen; the edit lives in component state only.
    expect(EDITOR_CODE).toMatch(
      /const handleDiscardConfirm = useCallback\(\(\): void => \{\s*setDiscardDialogVisible\(false\);\s*onCancel\(\);\s*\}, \[onCancel\]\);/,
    );
    expect(EDITOR_CODE).not.toMatch(/phoneEdit[^\n]*(AsyncStorage|persist|zustand)/i);
    const reopened = new EditorModel("08031234567", null);
    expect(reopened.edit).toBeNull();
    expect(reopened.opened).toMatchObject({
      localText: "08031234567",
      countrySource: "fallback",
    });
    expect(reopened.chip).toBe(BRAND_PHONE_CHOOSE_COUNTRY_LABEL);
    expect(brandPhoneSessionCountryCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 10. The row. The screen model is driven as above, but every accepted save is
// sent through the REAL `updateBrand` and the next open reads what the REAL
// row mapping hands back, so the form, the service and the mapping are tested
// as one path.
// ---------------------------------------------------------------------------

describe("issue #3380 retest 2 — nothing under an unchosen country ever reaches the brand row", () => {
  /** Save the model; an accepted save is written through the service. */
  const persist = async (model: EditorModel): Promise<BrandPhoneSaveResult | "not dirty"> => {
    const result = model.save();
    if (result !== "not dirty" && result.ok) {
      const saved = await updateBrand(BRAND_ROW_ID, { contact: { phone: model.stored } }, null);
      // The next open reads the number the service returned, not the model's.
      model.stored = saved.contact?.phone;
    }
    return result;
  };

  const RIGHT_COUNTRY: Record<(typeof RETEST_1_INPUTS)[number], [string, string]> = {
    "4155550123": ["US", "+14155550123"],
    "(415) 555-0123": ["US", "+14155550123"],
    "9193770509": ["US", "+19193770509"],
    "0241234567": ["GH", "+233241234567"],
    "0712345678": ["KE", "+254712345678"],
    "0851234567": ["IE", "+353851234567"],
    "08031234567": ["NG", "+2348031234567"],
    "020 7946 0000": ["GB", "+442079460000"],
  };

  test.each(RETEST_1_INPUTS)(
    "%p: refused for every kind of 'no country', written once the host picks the country",
    async (text) => {
      const [iso, expected] = RIGHT_COUNTRY[text];
      for (const brandCountry of NO_BRAND_COUNTRY) {
        resetBrandRow(null);
        clearBrandPhoneSessionCountries();
        const model = new EditorModel(undefined, brandCountry);
        expect(refused(await persist(model.type(text)))).toBe(BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE);
        // Trying again, and editing something else, still writes nothing.
        expect(refused(await persist(model.editAnotherField()))).toBe(
          BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE,
        );
        expect(brandRowWrites).toEqual([]);
        expect(brandRow.contact_phone).toBeNull();

        expect(saved(await persist(model.pick(iso)))).toBe(expected);
        expect(brandRowWrites).toHaveLength(1);
        expect(brandRow.contact_phone).toBe(expected);
        if (iso !== "GB") expect(String(brandRow.contact_phone).startsWith("+44")).toBe(false);
      }
    },
  );

  test("a legacy number left alone survives any number of unrelated saves, byte for byte", async () => {
    resetBrandRow("08031234567");
    const model = new EditorModel("08031234567", null);
    for (let round = 0; round < 3; round += 1) {
      expect(saved(await persist(model.editAnotherField()))).toBe("08031234567");
      expect(brandRow.contact_phone).toBe("08031234567");
      expect(model.stored).toBe("08031234567");
      expect(model.chip).toBe(BRAND_PHONE_CHOOSE_COUNTRY_LABEL);
    }
  });

  test("a row that comes back with spaces in an E.164 number still opens under its own country", async () => {
    resetBrandRow(null);
    const model = new EditorModel(undefined, null);
    expect(saved(await persist(model.type("08031234567").pick("NG")))).toBe("+2348031234567");
    // Someone edits the row by hand; the next save of another field reads it back.
    brandRow.contact_phone = " +234 803 123 4567 ";
    const reread = await updateBrand(BRAND_ROW_ID, { contact: { phone: "+2348031234567" } }, null);
    expect(reread.contact?.phone).toBe("+2348031234567");
    const reopened = new EditorModel(reread.contact?.phone, null);
    expect(reopened.source).toBe("stored");
    expect(reopened.chip).toBe("flag:NG");
    // New digits now compose under Nigeria with no pick, and are written.
    expect(saved(await persist(reopened.type("08031234568")))).toBe("+2348031234568");
    expect(brandRow.contact_phone).toBe("+2348031234568");
  });

  test("clearing the number writes an empty phone, whatever the source", async () => {
    for (const [stored, brandCountry] of [
      ["+2348031234567", null],
      ["08031234567", "NG"],
      ["4155550123", null],
    ] as const) {
      resetBrandRow(stored);
      const model = new EditorModel(stored, brandCountry);
      expect(saved(await persist(model.type("")))).toBeUndefined();
      expect(brandRow.contact_phone).toBeNull();
    }
  });
});
