// Issue #4383 — INDEPENDENT TESTER adversarial proof for the Settings label
// blocks added to every locale (notifications.prefs.cat.{mingla_updates,
// brand_campaign_push, brand_offering_invite} and their hints).
//
// Most locales had no notifications.prefs block, so each one now carries a
// PARTIAL prefs.cat block. The risks this file attacks:
//   L1  a partial block must not stop an existing key (e.g.
//       notifications.prefs.cat.messages) falling back to English: run the
//       real i18next exactly as the app loads a language (init with en, then
//       addResourceBundle(lang, ns, bundle, deep, overwrite) and
//       changeLanguage), and compare every English notifications.* key with
//       the same locale file minus the six new keys. Only those six may differ.
//   L2  no locale file holds a duplicate "prefs" / "cat" / "notifications" key
//       in one object (JSON.parse keeps the last one silently, which would
//       wipe translations that were already there).
//   L3  every locale's six new values are non-empty strings (no objects, no
//       key paths, no leftover English placeholders in a non-English file for
//       the label keys).
//
// FAILS-ON-REVERT: give any locale a second "prefs" key inside
// "notifications" (or replace its prefs block with one that drops an existing
// key) -> L1/L2 fail.
//
// Run: deno test --allow-read --allow-net --allow-env app-mobile/src/i18n/__tests__/issue_4383_settings_locale_fallback.tester.adversarial.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import i18next from "npm:i18next@26.0.4";

const LOCALES = new URL("../locales/", import.meta.url);
const NEW_KEYS = [
  "mingla_updates", "mingla_updates_hint",
  "brand_campaign_push", "brand_campaign_push_hint",
  "brand_offering_invite", "brand_offering_invite_hint",
];

async function localeCodes(): Promise<string[]> {
  const codes: string[] = [];
  for await (const e of Deno.readDir(LOCALES)) if (e.isDirectory) codes.push(e.name);
  return codes.sort();
}
const readText = (code: string) => Deno.readTextFile(new URL(`${code}/settings.json`, LOCALES));

function leafKeys(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => leafKeys(v, prefix ? `${prefix}.${k}` : k));
}

function withoutNewKeys(bundle: Record<string, unknown>) {
  const copy = structuredClone(bundle) as { notifications?: { prefs?: { cat?: Record<string, unknown> } } };
  const cat = copy.notifications?.prefs?.cat;
  if (cat) for (const k of NEW_KEYS) delete cat[k];
  return copy;
}

// The app's own loading path (src/i18n/index.ts): init with English, then add
// the language bundle deep + overwrite, then switch language.
async function resolver(lang: string, bundle: Record<string, unknown>, en: Record<string, unknown>) {
  const i = i18next.createInstance();
  await i.init({
    resources: { en: { settings: en } }, lng: "en", fallbackLng: "en",
    ns: ["settings"], defaultNS: "common", interpolation: { escapeValue: false }, compatibilityJSON: "v4",
  } as never);
  if (lang !== "en") i.addResourceBundle(lang, "settings", bundle, true, true);
  await i.changeLanguage(lang);
  return (key: string) => i.t(`settings:${key}`);
}

// Every key inside one JSON object literal, per object, to find duplicates.
function duplicateKeys(text: string): string[] {
  const dups: string[] = [];
  const stack: Set<string>[] = [];
  const path: string[] = [];
  let i = 0;
  let pendingKey: string | null = null;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      const str = JSON.parse(text.slice(i, j + 1));
      let k = j + 1;
      while (/\s/.test(text[k])) k++;
      if (text[k] === ":" && stack.length) {
        const seen = stack[stack.length - 1];
        if (seen.has(str)) dups.push([...path, str].join("."));
        seen.add(str);
        pendingKey = str;
      }
      i = j + 1;
      continue;
    }
    if (ch === "{") { stack.push(new Set()); path.push(pendingKey ?? ""); pendingKey = null; }
    else if (ch === "}") { stack.pop(); path.pop(); }
    else if (ch === "[" ) { pendingKey = null; }
    i++;
  }
  return dups;
}

Deno.test("L1 a partial prefs.cat block never changes how any other notifications key resolves", async () => {
  const en = JSON.parse(await readText("en"));
  const keys = leafKeys(en.notifications, "notifications").filter((k) => !NEW_KEYS.some((n) => k.endsWith(`.cat.${n}`)));
  assert(keys.includes("notifications.prefs.cat.messages"), "the English file has prefs.cat.messages");
  let checked = 0;
  for (const code of await localeCodes()) {
    const bundle = JSON.parse(await readText(code));
    const now = await resolver(code, bundle, en);
    const before = await resolver(code, withoutNewKeys(bundle), en);
    for (const key of keys) {
      assertEquals(now(key), before(key), `${code}: ${key}`);
      const v = now(key);
      assert(typeof v === "string" && v.length > 0 && !v.startsWith("settings:") && v !== key, `${code}: ${key} -> ${v}`);
      checked++;
    }
    // The named example: a key only English has still reads in English.
    if (!bundle.notifications?.prefs?.cat?.messages) {
      assertEquals(now("notifications.prefs.cat.messages"), en.notifications.prefs.cat.messages, `${code} falls back`);
    }
  }
  assert(checked > 29 * 20, `checked ${checked}`);
});

Deno.test("L2 no locale file repeats a key inside one object", async () => {
  for (const code of await localeCodes()) {
    assertEquals(duplicateKeys(await readText(code)), [], code);
  }
});

Deno.test("L3 every locale's new values are real, non-empty strings", async () => {
  const en = JSON.parse(await readText("en"));
  for (const code of await localeCodes()) {
    const cat = JSON.parse(await readText(code)).notifications?.prefs?.cat ?? {};
    for (const k of NEW_KEYS) {
      assert(typeof cat[k] === "string" && cat[k].trim().length > 0, `${code}: ${k}`);
      assert(!cat[k].includes("notifications.prefs"), `${code}: ${k} is a key path`);
      if (code !== "en" && !k.endsWith("_hint")) {
        // A label copied from English into another language is a missed translation.
        assert(cat[k] !== en.notifications.prefs.cat[k] || ["bin", "pcm"].includes(code), `${code}: ${k} is still English (${cat[k]})`);
      }
    }
  }
});
