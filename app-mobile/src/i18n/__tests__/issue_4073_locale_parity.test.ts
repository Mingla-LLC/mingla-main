// @ts-nocheck — Deno-runtime locale suite; app-mobile's tsc sweep has no Deno globals.
const localesRoot = new URL("../locales/", import.meta.url);
const locales = ["ar", "bin", "bn", "de", "el", "en", "es", "fr", "ha", "he", "hi", "id", "ig", "it", "ja", "ko", "ms", "nl", "pl", "pt", "ro", "ru", "sv", "th", "tr", "uk", "vi", "yo", "zh"] as const;
const pluralStems = ["filters.show", "count.events", "count.experiences", "count.trips", "count.stays", "guests.value", "card.type.stops"] as const;
const coachKeys = ["coach.step4.title", "coach.step4.body_all", "coach.step4.body_subset", "coach.step5.title", "coach.step5.body", "coach.list_two", "coach.list_three", "spotlight.step_counter"] as const;

function selectedDiscoverKey(key: string): boolean {
  return key === "title" || key.startsWith("city.") || key.startsWith("pill.") || /^filters\.(button|button_selected|clear|show_|option_)/.test(key) || key.startsWith("count.") || key.startsWith("group.") || key.startsWith("when.") || key.startsWith("checkin.") || key.startsWith("price.") || key.startsWith("guests.") || key.startsWith("property.") || key.startsWith("good_for.") || key.startsWith("taxonomy.") || key.startsWith("section.") || key.startsWith("card.") || key.startsWith("empty.") || key.startsWith("error.") || key.startsWith("banner.") || key.startsWith("stays.");
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
}

function nested(root: Record<string, unknown>, path: string): string {
  const value = path.split(".").reduce<unknown>((current, part) => (current as Record<string, unknown>)[part], root);
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${path} is empty`);
  return value;
}

Deno.test("#4073 Discover and coach copy is complete in all 29 locales", async () => {
  const englishDiscover = JSON.parse(await Deno.readTextFile(new URL("en/discover.json", localesRoot))) as Record<string, string>;
  const englishModals = JSON.parse(await Deno.readTextFile(new URL("en/modals.json", localesRoot))) as Record<string, unknown>;
  const required = Object.keys(englishDiscover).filter((key) =>
    selectedDiscoverKey(key) && !pluralStems.some((stem) => key.startsWith(`${stem}_`))
  );
  if (required.length < 130) throw new Error(`expected full Discover contract, got ${required.length} keys`);
  for (const locale of locales) {
    const discover = JSON.parse(await Deno.readTextFile(new URL(`${locale}/discover.json`, localesRoot))) as Record<string, string>;
    const modals = JSON.parse(await Deno.readTextFile(new URL(`${locale}/modals.json`, localesRoot))) as Record<string, unknown>;
    let localizedValues = 0;
    for (const key of required) {
      const value = discover[key];
      if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${locale}/${key} is empty`);
      if (placeholders(value).join("|") !== placeholders(englishDiscover[key]).join("|")) throw new Error(`${locale}/${key} placeholders differ`);
      if (locale !== "en" && value !== englishDiscover[key]) localizedValues += 1;
    }
    for (const key of coachKeys) {
      const value = nested(modals, key);
      const english = nested(englishModals, key);
      if (placeholders(value).join("|") !== placeholders(english).join("|")) throw new Error(`${locale}/${key} placeholders differ`);
      if (locale !== "en" && value !== english) localizedValues += 1;
    }
    for (const stem of pluralStems) {
      const expected = new Intl.PluralRules(locale).resolvedOptions().pluralCategories.map((category) => `${stem}_${category}`).sort();
      const actual = Object.keys(discover).filter((key) => key.startsWith(`${stem}_`)).sort();
      if (actual.join("|") !== expected.join("|")) throw new Error(`${locale}/${stem} plural categories: ${actual.join(",")}`);
      const englishPlural = englishDiscover[`${stem}_other`];
      for (const key of actual) {
        const value = discover[key];
        if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${locale}/${key} is empty`);
        if (placeholders(value).join("|") !== placeholders(englishPlural).join("|")) throw new Error(`${locale}/${key} placeholders differ`);
        if (locale !== "en" && value !== englishPlural) localizedValues += 1;
      }
    }
    if (locale !== "en" && localizedValues < 10) throw new Error(`${locale} is an English fallback`);
  }
});
Deno.test("#4073 Arabic and Hebrew sentence copy is not a Latin-only fallback", async () => {
  for (const locale of ["ar", "he"] as const) {
    const discover = JSON.parse(await Deno.readTextFile(new URL(`${locale}/discover.json`, localesRoot))) as Record<string, string>;
    for (const [key, value] of Object.entries(discover).filter(([key]) => selectedDiscoverKey(key) && !key.startsWith("taxonomy."))) {
      const prose = value.replaceAll(/\{\{\w+\}\}/g, "").replaceAll("Mingla", "").replaceAll("Ticketmaster", "");
      if (/[A-Za-z]{4}/.test(prose) && !(/[\u0590-\u05ff\u0600-\u06ff]/.test(prose))) throw new Error(`${locale}/${key} is Latin-only`);
    }
  }
});
