import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import ar from "./locales/ar/brandGroupMedia.json";
import bin from "./locales/bin/brandGroupMedia.json";
import bn from "./locales/bn/brandGroupMedia.json";
import de from "./locales/de/brandGroupMedia.json";
import el from "./locales/el/brandGroupMedia.json";
import en from "./locales/en/brandGroupMedia.json";
import es from "./locales/es/brandGroupMedia.json";
import fr from "./locales/fr/brandGroupMedia.json";
import ha from "./locales/ha/brandGroupMedia.json";
import he from "./locales/he/brandGroupMedia.json";
import hi from "./locales/hi/brandGroupMedia.json";
import id from "./locales/id/brandGroupMedia.json";
import ig from "./locales/ig/brandGroupMedia.json";
import it from "./locales/it/brandGroupMedia.json";
import ja from "./locales/ja/brandGroupMedia.json";
import ko from "./locales/ko/brandGroupMedia.json";
import ms from "./locales/ms/brandGroupMedia.json";
import nl from "./locales/nl/brandGroupMedia.json";
import pl from "./locales/pl/brandGroupMedia.json";
import pt from "./locales/pt/brandGroupMedia.json";
import ro from "./locales/ro/brandGroupMedia.json";
import ru from "./locales/ru/brandGroupMedia.json";
import sv from "./locales/sv/brandGroupMedia.json";
import th from "./locales/th/brandGroupMedia.json";
import tr from "./locales/tr/brandGroupMedia.json";
import uk from "./locales/uk/brandGroupMedia.json";
import vi from "./locales/vi/brandGroupMedia.json";
import yo from "./locales/yo/brandGroupMedia.json";
import zh from "./locales/zh/brandGroupMedia.json";

export const BUSINESS_MEDIA_LANGUAGES = [
  "ar", "bin", "bn", "de", "el", "en", "es", "fr", "ha", "he",
  "hi", "id", "ig", "it", "ja", "ko", "ms", "nl", "pl", "pt",
  "ro", "ru", "sv", "th", "tr", "uk", "vi", "yo", "zh",
] as const;

type BusinessMediaLanguage = (typeof BUSINESS_MEDIA_LANGUAGES)[number];

const supported = new Set<string>(BUSINESS_MEDIA_LANGUAGES);
const resources = {
  ar: { brandGroupMedia: ar }, bin: { brandGroupMedia: bin },
  bn: { brandGroupMedia: bn }, de: { brandGroupMedia: de },
  el: { brandGroupMedia: el }, en: { brandGroupMedia: en },
  es: { brandGroupMedia: es }, fr: { brandGroupMedia: fr },
  ha: { brandGroupMedia: ha }, he: { brandGroupMedia: he },
  hi: { brandGroupMedia: hi }, id: { brandGroupMedia: id },
  ig: { brandGroupMedia: ig }, it: { brandGroupMedia: it },
  ja: { brandGroupMedia: ja }, ko: { brandGroupMedia: ko },
  ms: { brandGroupMedia: ms }, nl: { brandGroupMedia: nl },
  pl: { brandGroupMedia: pl }, pt: { brandGroupMedia: pt },
  ro: { brandGroupMedia: ro }, ru: { brandGroupMedia: ru },
  sv: { brandGroupMedia: sv }, th: { brandGroupMedia: th },
  tr: { brandGroupMedia: tr }, uk: { brandGroupMedia: uk },
  vi: { brandGroupMedia: vi }, yo: { brandGroupMedia: yo },
  zh: { brandGroupMedia: zh },
} as const;

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

// eslint-disable-next-line import/no-named-as-default-member
void i18n.use(initReactI18next).init({
  resources,
  lng: deviceLanguage(),
  fallbackLng: "en",
  supportedLngs: [...BUSINESS_MEDIA_LANGUAGES],
  nonExplicitSupportedLngs: true,
  ns: ["brandGroupMedia"],
  defaultNS: "brandGroupMedia",
  interpolation: { escapeValue: false },
  compatibilityJSON: "v4",
  react: { useSuspense: false },
  initAsync: false,
});

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
  // eslint-disable-next-line import/no-named-as-default-member
  if (isCurrentUser() && nextLanguage !== i18n.language) await i18n.changeLanguage(nextLanguage);
}

export default i18n;
