// MINGLA-INVARIANT: I-BRAND-GROUP-MEDIA-ALL-LOCALES | issue #3988 | Every Host gallery and viewer string ships in all 29 locales with matching interpolation and CLDR plural contracts; English fallback is not an acceptable launch state.
import fs from "node:fs";
import path from "node:path";

const LANGUAGES = "ar bin bn de el en es fr ha he hi id ig it ja ko ms nl pl pt ro ru sv th tr uk vi yo zh".split(" ");
const STRUCTURAL_SHARED = new Set([
  "media.subtitle", "media.subtitle_panel", "media.file_row_meta",
  "media.month_year", "format.kb", "format.mb",
]);
const VALID_COGNATES = new Set([
  "id:chat.media", "id:media.title", "it:chat.media", "it:media.title",
  "it:media.count_files_one", "ms:chat.media", "ms:media.title",
  "nl:chat.media", "nl:media.title",
]);

function flatten(value: Record<string, unknown>, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [key, child] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) flatten(child as Record<string, unknown>, full, out);
    else if (typeof child === "string") out[full] = child;
  }
  return out;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/{{([a-z_]+)}}/gi)].map((match) => match[1]).sort();
}

function localePath(language: string): string {
  return path.resolve(__dirname, `../locales/${language}/brandGroupMedia.json`);
}

describe("#3988 Host brand-group media translations", () => {
  const english = flatten(JSON.parse(fs.readFileSync(localePath("en"), "utf8")) as Record<string, unknown>);
  const fixedEnglishKeys = Object.keys(english).filter((key) => !/^media\.count_(photos_videos|files)_/.test(key)).sort();

  test("all 29 locales are complete, translated, and placeholder-safe", () => {
    expect(LANGUAGES).toHaveLength(29);
    for (const language of LANGUAGES) {
      const copy = flatten(JSON.parse(fs.readFileSync(localePath(language), "utf8")) as Record<string, unknown>);
      const fixedKeys = Object.keys(copy).filter((key) => !/^media\.count_(photos_videos|files)_/.test(key)).sort();
      expect(fixedKeys).toEqual(fixedEnglishKeys);
      for (const key of fixedEnglishKeys) {
        expect(copy[key].trim()).not.toBe("");
        expect(placeholders(copy[key])).toEqual(placeholders(english[key]));
        if (language !== "en" && !STRUCTURAL_SHARED.has(key) && !VALID_COGNATES.has(`${language}:${key}`)) {
          expect(copy[key]).not.toBe(english[key]);
        }
      }
    }
  });

  test("plural keys exactly match each locale's CLDR categories", () => {
    for (const language of LANGUAGES) {
      const copy = flatten(JSON.parse(fs.readFileSync(localePath(language), "utf8")) as Record<string, unknown>);
      const categories = new Intl.PluralRules(language).resolvedOptions().pluralCategories.sort();
      for (const stem of ["media.count_photos_videos", "media.count_files"]) {
        const actual = Object.keys(copy).filter((key) => key.startsWith(`${stem}_`)).map((key) => key.slice(stem.length + 1)).sort();
        expect(actual).toEqual(categories);
        for (const category of categories) {
          expect(placeholders(copy[`${stem}_${category}`])).toEqual(["count"]);
        }
      }
    }
  });

  test("RTL sentence copy is not a Latin fallback", () => {
    for (const [language, script] of [["ar", /[\u0600-\u06ff]/], ["he", /[\u0590-\u05ff]/]] as const) {
      const copy = flatten(JSON.parse(fs.readFileSync(localePath(language), "utf8")) as Record<string, unknown>);
      for (const [key, value] of Object.entries(copy)) {
        if (STRUCTURAL_SHARED.has(key)) continue;
        expect(value).toMatch(script);
      }
    }
  });
});
