// MINGLA-INVARIANT: I-4389-HOST-SETUP-ALL-LOCALES | issue #4389 | Every host string of brand setup, Door mode, Ari's setup cards and Home setup ships in all 29 locales (English in locales/en/{brandSetup,doorMode,ariSetup,homeSetup}[.<part>].json, split by screen chunk, others in locales/<lang>/hostSetup.json) with matching placeholders; "Tap to Pay on iPhone" and "Tap to Pay" stay in English (Apple naming); no partner name.
/**
 * FAILS-ON-REVERT: deleting any key from any hostSetup.json (or adding an
 * English key without translating it) fails test 1; translating "Tap to Pay
 * on iPhone" fails test 3.
 */
import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const LANGUAGES = "ar bin bn de el en es fr ha he hi id ig it ja ko ms nl pl pt ro ru sv th tr uk vi yo zh".split(" ");
const NAMESPACES = ["brandSetup", "doorMode", "ariSetup", "homeSetup"] as const;
const LOCALES = path.resolve(__dirname, "../locales");
/** Plural suffixes a language may add beyond English's one/other (CLDR). */
const PLURAL = /_(zero|one|two|few|many|other)$/;

type Tree = { [key: string]: string | Tree };
function flatten(value: Tree, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [key, child] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") out[full] = child;
    else flatten(child, full, out);
  }
  return out;
}
const read = (file: string): Tree => JSON.parse(fs.readFileSync(path.join(LOCALES, file), "utf8")) as Tree;
const placeholders = (s: string): string[] => [...s.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort();

// A namespace's English may be split by screen chunk: en/<ns>.json plus en/<ns>.<part>.json.
const englishParts = (ns: string): string[] =>
  fs.readdirSync(path.join(LOCALES, "en")).filter((f) => f === `${ns}.json` || (f.startsWith(`${ns}.`) && f.endsWith(".json")));
const english: Record<string, string> = {};
for (const ns of NAMESPACES) {
  expect(englishParts(ns)).toContain(`${ns}.json`);
  for (const part of englishParts(ns)) {
    const words = flatten(read(`en/${part}`));
    for (const key of Object.keys(words)) if (key in english) throw new Error(`${key} is in two English parts`);
    Object.assign(english, words);
  }
}
const englishKeys = Object.keys(english).sort();

describe("#4389 host setup words in every shipped language", () => {
  test("1 — all 28 other locales carry every English key, non-empty, placeholder-safe", () => {
    expect(LANGUAGES).toHaveLength(29);
    expect(englishKeys.length).toBeGreaterThan(250);
    for (const language of LANGUAGES.filter((l) => l !== "en")) {
      const copy = flatten(read(`${language}/hostSetup.json`));
      const missing = englishKeys.filter((k) => !(k in copy));
      expect({ language, missing }).toEqual({ language, missing: [] });
      const extra = Object.keys(copy).filter((k) => !(k in english) && !(PLURAL.test(k) && `${k.replace(PLURAL, "")}_other` in english));
      expect({ language, extra }).toEqual({ language, extra: [] });
      for (const key of Object.keys(copy)) {
        expect(copy[key].trim()).not.toBe("");
        const base = key in english ? english[key] : english[`${key.replace(PLURAL, "")}_other`];
        expect({ language, key, placeholders: placeholders(copy[key]) }).toEqual({ language, key, placeholders: placeholders(base) });
      }
    }
  });

  test("2 — it is a translation, not an English copy", () => {
    for (const language of LANGUAGES.filter((l) => l !== "en")) {
      const copy = flatten(read(`${language}/hostSetup.json`));
      const same = englishKeys.filter((k) => copy[k] === english[k]);
      // Brand words ("Tap to Pay on iPhone", "RSVP", "Email", "Chats") may stay.
      expect({ language, share: same.length / englishKeys.length < 0.08 }).toEqual({ language, share: true });
    }
  });

  test("3 — Apple naming: Tap to Pay on iPhone / Tap to Pay stay in English everywhere; no partner names", () => {
    for (const language of LANGUAGES) {
      const copy = language === "en" ? english : flatten(read(`${language}/hostSetup.json`));
      for (const key of englishKeys) {
        if (english[key].includes("Tap to Pay on iPhone")) expect({ language, key, ok: copy[key].includes("Tap to Pay on iPhone") }).toEqual({ language, key, ok: true });
        else if (english[key].includes("Tap to Pay")) expect({ language, key, ok: copy[key].includes("Tap to Pay") }).toEqual({ language, key, ok: true });
      }
      for (const value of Object.values(copy)) expect(value).not.toMatch(/stripe|paystack/i);
    }
  });

  test("4 — every non-English language file is loaded with its language", () => {
    for (const group of ["A", "B", "C"]) {
      const source = fs.readFileSync(path.resolve(__dirname, `../brandGroupMediaLocales${group}.ts`), "utf8");
      for (const [, language] of source.matchAll(/import (\w+)Setup from "\.\/locales\/\w+\/hostSetup\.json";/g)) {
        expect(source).toContain(`${language}: { ...${language}, ...${language}Setup },`);
      }
    }
    const all = ["A", "B", "C"].map((g) => fs.readFileSync(path.resolve(__dirname, `../brandGroupMediaLocales${g}.ts`), "utf8")).join("\n");
    for (const language of LANGUAGES.filter((l) => l !== "en")) {
      expect(all).toContain(`./locales/${language}/hostSetup.json`);
    }
  });

  test("5 — the copy modules read the current language (French loads, English falls back)", async () => {
    const i18n = await import("../index");
    const { BRAND_SETUP_COPY } = await import("../../components/brand/brandSetupCopy");
    const { DOOR_MODE_COPY } = await import("../../components/door/doorModeCopy");
    await i18n.changeBusinessMediaLanguage("en");
    expect(BRAND_SETUP_COPY.f1.title).toBe("Name your brand");
    expect(DOOR_MODE_COPY.ticketCount(2)).toBe("2 tickets");
    await i18n.changeBusinessMediaLanguage("fr");
    expect(BRAND_SETUP_COPY.f1.title).toBe("Nommez votre marque");
    expect(BRAND_SETUP_COPY.f4.ttpTitle).toBe("Tap to Pay on iPhone");
    expect(DOOR_MODE_COPY.ticketCount(1)).toBe("1 billet");
    expect(DOOR_MODE_COPY.ticketCount(3)).toBe("3 billets");
    await i18n.changeBusinessMediaLanguage("ru");
    expect(DOOR_MODE_COPY.ticketCount(3)).toBe("3 билета");
    await i18n.changeBusinessMediaLanguage("en");
    expect(BRAND_SETUP_COPY.f1.title).toBe("Name your brand");
  });
});
