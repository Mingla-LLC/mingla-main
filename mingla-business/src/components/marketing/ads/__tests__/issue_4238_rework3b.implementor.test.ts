// MINGLA-INVARIANT: I-4238-DAY-BY-DAY-TERMS-ALL-LOCALES | issue #4238 rework 3b (rework 4 reshaped) | The detail "Day by day" terms line exists in all 29 Host locales and resolves through the Host copy helper. (The Home Ads total moved to rework 4: one shared summary line for Home and Promote.)
// #4238 rework 4: behaviour only. Locale files are LOADED as modules (executed),
// never read as text (I-PROPOSED-1047-BIZ-NO-SOLE-SOURCE-PIN).
import { hm } from "../hostAdManageCopy";

const LANGUAGES = "ar bin bn de el en es fr ha he hi id ig it ja ko ms nl pl pt ro ru sv th tr uk vi yo zh".split(" ");

const loadLocale = (language: string): unknown =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(`../../../../i18n/locales/${language}/hostAds.json`) as unknown;

const find = (obj: unknown): string | undefined => {
  if (obj === null || typeof obj !== "object") return undefined;
  const rec = obj as Record<string, unknown>;
  if (typeof rec.dayByDayTerms === "string") return rec.dayByDayTerms;
  for (const v of Object.values(rec)) {
    const hit = find(v);
    if (hit !== undefined) return hit;
  }
  return undefined;
};

describe("#4238 rework 3b: Day by day terms label", () => {
  test("29 locales each have a non-empty dayByDayTerms", () => {
    expect(LANGUAGES).toHaveLength(29);
    for (const l of LANGUAGES) expect((find(loadLocale(l)) ?? "").length).toBeGreaterThan(10);
  });

  test("the Host copy helper resolves the detail terms line (not the raw key)", () => {
    const line = hm("detail.dayByDayTerms");
    expect(line).not.toMatch(/dayByDayTerms/);
    expect(line.length).toBeGreaterThan(10);
  });
});
