import { useMemo, useSyncExternalStore } from "react";

import en from "./locales/en/brandGroupMedia.json";

export const BUSINESS_MEDIA_LANGUAGES = [
  "ar", "bin", "bn", "de", "el", "en", "es", "fr", "ha", "he",
  "hi", "id", "ig", "it", "ja", "ko", "ms", "nl", "pl", "pt",
  "ro", "ru", "sv", "th", "tr", "uk", "vi", "yo", "zh",
] as const;

export type BusinessMediaLanguage = (typeof BUSINESS_MEDIA_LANGUAGES)[number];
export type BusinessMediaVariables = Record<string, string | number>;
export type BusinessMediaTranslator = (key: string, variables?: BusinessMediaVariables) => string;

type TranslationTree = { [key: string]: string | TranslationTree };
type LanguageSnapshot = { language: BusinessMediaLanguage; copy: TranslationTree };
type NonEnglishLanguage = Exclude<BusinessMediaLanguage, "en">;
type LocaleGroup = Partial<Record<NonEnglishLanguage, TranslationTree>>;

const supported = new Set<string>(BUSINESS_MEDIA_LANGUAGES);
const localeGroupByLanguage: Record<NonEnglishLanguage, "a" | "b" | "c"> = {
  ar: "a", bin: "a", bn: "a", de: "a", el: "a", es: "a", fr: "a", ha: "a", he: "a", hi: "a",
  id: "b", ig: "b", it: "b", ja: "b", ko: "b", ms: "b", nl: "b", pl: "b", pt: "b", ro: "b",
  ru: "c", sv: "c", th: "c", tr: "c", uk: "c", vi: "c", yo: "c", zh: "c",
};
const localeGroupLoaders: Record<"a" | "b" | "c", () => Promise<{ default: LocaleGroup }>> = {
  a: () => import("./brandGroupMediaLocalesA"),
  b: () => import("./brandGroupMediaLocalesB"),
  c: () => import("./brandGroupMediaLocalesC"),
};
const cachedCopy: Partial<Record<BusinessMediaLanguage, TranslationTree>> = { en };
const listeners = new Set<() => void>();
let snapshot: LanguageSnapshot = { language: "en", copy: en };

function normalizedLanguage(value: unknown): BusinessMediaLanguage | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase().split(/[-_]/)[0];
  return supported.has(code) ? code as BusinessMediaLanguage : null;
}

export function resolveBusinessMediaLanguage(
  preferredLanguage: unknown,
  environmentLanguage: unknown,
): BusinessMediaLanguage {
  return normalizedLanguage(preferredLanguage) ?? normalizedLanguage(environmentLanguage) ?? "en";
}

function deviceLanguage(): BusinessMediaLanguage {
  const browserLanguage = typeof navigator !== "undefined" ? navigator.language : null;
  const intlLanguage = Intl.DateTimeFormat().resolvedOptions().locale;
  return normalizedLanguage(browserLanguage) ?? resolveBusinessMediaLanguage(null, intlLanguage);
}

function nestedValue(copy: TranslationTree, key: string): string | null {
  let current: string | TranslationTree = copy;
  for (const part of key.split(".")) {
    if (typeof current === "string" || !(part in current)) return null;
    current = current[part];
  }
  return typeof current === "string" ? current : null;
}

function translatedValue(
  copy: TranslationTree,
  language: BusinessMediaLanguage,
  key: string,
  variables: BusinessMediaVariables,
): string | null {
  if (typeof variables.count === "number") {
    const category = new Intl.PluralRules(language).select(variables.count);
    return nestedValue(copy, `${key}_${category}`) ?? nestedValue(copy, `${key}_other`) ?? nestedValue(copy, key);
  }
  return nestedValue(copy, key);
}

function translate(
  language: BusinessMediaLanguage,
  copy: TranslationTree,
  key: string,
  variables: BusinessMediaVariables = {},
): string {
  const template = translatedValue(copy, language, key, variables)
    ?? translatedValue(en, "en", key, variables)
    ?? key;
  return template.replace(/{{\s*([A-Za-z0-9_]+)\s*}}/g, (token, name: string) => (
    Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : token
  ));
}

async function loadCopy(language: BusinessMediaLanguage): Promise<TranslationTree> {
  const cached = cachedCopy[language];
  if (cached) return cached;
  const nonEnglishLanguage = language as NonEnglishLanguage;
  const loaded = await localeGroupLoaders[localeGroupByLanguage[nonEnglishLanguage]]();
  const copy = loaded.default[nonEnglishLanguage];
  if (!copy) throw new Error(`missing_business_media_locale:${language}`);
  cachedCopy[language] = copy;
  return copy;
}

export async function changeBusinessMediaLanguage(
  language: BusinessMediaLanguage,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const copy = await loadCopy(language);
  if (!isCurrent() || (snapshot.language === language && snapshot.copy === copy)) return;
  snapshot = { language, copy };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): LanguageSnapshot {
  return snapshot;
}

export function useBusinessMediaTranslation(): {
  t: BusinessMediaTranslator;
  language: BusinessMediaLanguage;
} {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const t = useMemo<BusinessMediaTranslator>(
    () => (key, variables) => translate(current.language, current.copy, key, variables),
    [current],
  );
  return { t, language: current.language };
}

/** Auth-gated profile preference wins over the boot-time browser/device locale. */
export async function syncBusinessMediaLanguage(
  userId: string,
  isCurrentUser: () => boolean = () => true,
): Promise<void> {
  const { supabase } = await import("../services/supabase");
  const { data, error } = await supabase
    .from("profiles")
    .select("preferred_language")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.warn("[i18n] preferred language read failed", error.message);
  }
  const preferred = error ? null : (data as { preferred_language?: unknown } | null)?.preferred_language;
  const nextLanguage = resolveBusinessMediaLanguage(preferred, deviceLanguage());
  await changeBusinessMediaLanguage(nextLanguage, isCurrentUser);
}

const businessMediaI18n = {
  get language(): BusinessMediaLanguage {
    return snapshot.language;
  },
  changeLanguage: changeBusinessMediaLanguage,
};

void changeBusinessMediaLanguage(deviceLanguage());

export default businessMediaI18n;
