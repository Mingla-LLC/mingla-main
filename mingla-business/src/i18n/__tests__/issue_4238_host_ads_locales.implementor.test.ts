// MINGLA-INVARIANT: I-4238-HOST-ADS-ALL-LOCALES | issue #4238 | W6a: Every Promote builder string ships in all 29 Host locales (English in locales/en/hostAds.json, others in locales/<lang>/hostAds.json, machine-translated with no human review: standing rule) with the same placeholders, the lazy language groups load them, and no locale names a payment provider or uses Mingla's internal words in English.
/**
 * FAILS-ON-REVERT: deleting a key from any hostAds.json, adding an English
 * key without translating it, dropping a {{placeholder}}, unwiring a language
 * group, or writing a provider name into any locale fails below.
 */
import { describe, expect, test } from "@jest/globals";
import { hostAdCopyIsPlain } from "../../components/marketing/ads/hostAdCopy";
import groupA from "../brandGroupMediaLocalesA";
import groupB from "../brandGroupMediaLocalesB";
import groupC from "../brandGroupMediaLocalesC";

const LANGUAGES = "ar bin bn de el en es fr ha he hi id ig it ja ko ms nl pl pt ro ru sv th tr uk vi yo zh".split(" ");
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
// #4238 rework 1: the locale files are LOADED as modules (executed), not read
// as text (I-PROPOSED-1047-BIZ-NO-SOLE-SOURCE-PIN).
const loadLocale = (language: string): Tree =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(`../locales/${language}/hostAds.json`) as Tree;
const read = (language: string): Record<string, string> => flatten(loadLocale(language));
const placeholders = (s: string): string[] => [...s.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort();
const english = read("en");
const englishKeys = Object.keys(english).sort();

describe("#4238 W6a Promote builder words in every Host language", () => {
  test("all 28 other locales carry every English key, non-empty, placeholder-safe", () => {
    expect(LANGUAGES).toHaveLength(29);
    expect(englishKeys.length).toBeGreaterThan(250);
    for (const language of LANGUAGES.filter((l) => l !== "en")) {
      const copy = read(language);
      const missing = englishKeys.filter((k) => !(k in copy));
      expect({ language, missing }).toEqual({ language, missing: [] });
      const extra = Object.keys(copy).filter(
        (k) => !(k in english) && !(PLURAL.test(k) && `${k.replace(PLURAL, "")}_other` in english),
      );
      expect({ language, extra }).toEqual({ language, extra: [] });
      for (const key of Object.keys(copy)) {
        expect(copy[key].trim()).not.toBe("");
        const base = key in english ? english[key] : english[`${key.replace(PLURAL, "")}_other`];
        expect({ language, key, placeholders: placeholders(copy[key]) }).toEqual({
          language,
          key,
          placeholders: placeholders(base),
        });
      }
    }
  });

  test("no locale names a payment provider; English uses the Host's own words", () => {
    for (const language of LANGUAGES) {
      for (const [key, value] of Object.entries(read(language))) {
        expect({ language, key, provider: /stripe|paystack|flutterwave|adyen|paypal/i.test(value) }).toEqual({
          language,
          key,
          provider: false,
        });
      }
    }
    for (const [key, value] of Object.entries(english)) {
      expect({ key, plain: hostAdCopyIsPlain(value) }).toEqual({ key, plain: true });
    }
  });

  test("the lazy language groups load hostAds.json for every non-English language", () => {
    const groups = { ...groupA, ...groupB, ...groupC } as Record<string, Tree>;
    for (const language of LANGUAGES.filter((l) => l !== "en")) {
      const loaded = groups[language];
      expect({ language, wired: loaded !== undefined }).toEqual({ language, wired: true });
      // Every hostAds string of this language is what the group serves.
      expect((loaded as Tree).hostAds).toEqual(loadLocale(language).hostAds);
    }
  });

  test("the fee is 15% in every language's fee lines", () => {
    for (const language of LANGUAGES) {
      const copy = read(language);
      expect({ language, fee: copy["hostAds.builder.review.feeLine"].includes("15") }).toEqual({ language, fee: true });
      expect({ language, split: copy["hostAds.builder.topUp.split"].includes("15") }).toEqual({ language, split: true });
    }
  });
});
