// MINGLA-INVARIANT: I-4541-FORMS-LOCALE-PARITY | issue #4541 | every Explorer locale has the `forms` namespace with the en keys and placeholders, translated, lazily loaded.
/**
 * #4541 R2.12 / R3.5 (T-34) — every guest-facing forms string in the Explorer
 * app resolves through the `forms` namespace in all 29 locales:
 *
 *   - each `forms.json` has exactly the en keys, none empty;
 *   - every placeholder (`{{brand}}`, `{{first}}`, …) is kept per key;
 *   - no locale is an English fallback;
 *   - the "Questions from hosts" settings row has a label and line everywhere
 *     (`settings:notifications.prefs.cat.brand_form_request[_hint]`, the path
 *     AccountSettings reads);
 *   - `src/i18n/index.ts` registers `forms`: en statically, the other 28 only
 *     through `localeLoaders` (I-LOCALES-LAZY-LOAD).
 *
 * Red on a missing key, a dropped placeholder, an English copy or a missing
 * loader line.
 */
const root = new URL("../locales/", import.meta.url);
const placeholders = (value: string): string[] =>
  [...value.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();

async function locales(): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of Deno.readDir(root)) if (entry.isDirectory) out.push(entry.name);
  return out.sort();
}

Deno.test("#4541 T-34 forms keys and placeholders match en in all 29 locales", async () => {
  const languages = await locales();
  if (languages.length !== 29) throw new Error(`expected 29 locales, got ${languages.length}`);
  const english = JSON.parse(await Deno.readTextFile(new URL("en/forms.json", root))) as Record<string, string>;
  const keys = Object.keys(english).sort();
  if (keys.length < 100) throw new Error(`en/forms.json looks truncated (${keys.length} keys)`);
  for (const language of languages) {
    const copy = JSON.parse(await Deno.readTextFile(new URL(`${language}/forms.json`, root))) as Record<string, unknown>;
    if (Object.keys(copy).sort().join("|") !== keys.join("|")) throw new Error(`${language}/forms.json keys differ from en`);
    let same = 0;
    for (const key of keys) {
      const value = copy[key];
      if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${language}/forms.json ${key} is empty`);
      if (placeholders(value).join(",") !== placeholders(english[key]).join(",")) {
        throw new Error(`${language}/forms.json ${key} changed its placeholders`);
      }
      if (value === english[key]) same += 1;
    }
    if (language !== "en" && same > 5) throw new Error(`${language}/forms.json is an English fallback (${same} keys unchanged)`);
  }
});

Deno.test("#4541 R3.5 the Questions from hosts settings row is labelled in every locale", async () => {
  for (const language of await locales()) {
    const settings = JSON.parse(await Deno.readTextFile(new URL(`${language}/settings.json`, root)));
    const cat = settings?.notifications?.prefs?.cat ?? {};
    for (const key of ["brand_form_request", "brand_form_request_hint"]) {
      if (typeof cat[key] !== "string" || cat[key].length === 0) throw new Error(`${language}/settings.json missing ${key}`);
    }
  }
  const en = JSON.parse(await Deno.readTextFile(new URL("en/settings.json", root)));
  if (en.notifications.prefs.cat.brand_form_request !== "Questions from hosts") throw new Error("en label changed");
});

Deno.test("#4541 R2.12 forms is registered: en eager, the other 28 lazy (I-LOCALES-LAZY-LOAD)", async () => {
  const index = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  if (!index.includes("import en_forms from './locales/en/forms.json'")) throw new Error("en forms not imported");
  if (!/'purchases', 'enquiry', 'forms',/.test(index)) throw new Error("forms missing from NAMESPACES");
  if (!index.includes("forms: en_forms,")) throw new Error("forms missing from en resources");
  for (const language of await locales()) {
    if (language === "en") continue;
    if (!index.includes(`forms: (await import('./locales/${language}/forms.json')).default,`)) {
      throw new Error(`${language} forms is not in localeLoaders`);
    }
    if (new RegExp(`^import .* from './locales/${language}/`, "m").test(index)) {
      throw new Error(`${language} is statically imported`);
    }
  }
});

Deno.test("#4541 R2.12 the Explorer forms screens read their words from the forms namespace", async () => {
  const forms = new URL("../../components/forms/", import.meta.url);
  for (const file of ["BrandFormScreen.tsx", "QuestionsCard.tsx", "FormHandoffBlock.tsx", "CheckoutQuestionsBlock.tsx", "StillToAnswerRow.tsx", "useFormPrimitives.tsx"]) {
    const text = await Deno.readTextFile(new URL(file, forms));
    if (!text.includes('useTranslation("forms")')) throw new Error(`${file} does not use the forms namespace`);
  }
});
