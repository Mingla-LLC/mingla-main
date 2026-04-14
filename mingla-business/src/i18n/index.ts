import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";

// EN
import en_common from "./locales/en/common.json";
import en_onboarding from "./locales/en/onboarding.json";
import en_home from "./locales/en/home.json";

// ES
import es_common from "./locales/es/common.json";
import es_onboarding from "./locales/es/onboarding.json";
import es_home from "./locales/es/home.json";

const LANGUAGE_STORAGE_KEY = "mingla_business_preferred_language";
const SUPPORTED_LANGUAGES = ["en", "es"] as const;
type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

function getDefaultLanguageCode(): SupportedLanguage {
  const deviceLang = Localization.getLocales()[0]?.languageCode ?? "en";
  return SUPPORTED_LANGUAGES.includes(deviceLang as SupportedLanguage)
    ? (deviceLang as SupportedLanguage)
    : "en";
}

export async function getPersistedLanguage(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function persistLanguage(code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  } catch {
    // Storage write failed — non-critical, language resets to device default on next launch
  }
}

i18n.use(initReactI18next).init({
  resources: {
    en: { common: en_common, onboarding: en_onboarding, home: en_home },
    es: { common: es_common, onboarding: es_onboarding, home: es_home },
  },
  lng: getDefaultLanguageCode(),
  fallbackLng: "en",
  ns: ["common", "onboarding", "home"],
  defaultNS: "common",
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
  compatibilityJSON: "v4",
  pluralSeparator: "_",
});

// Restore persisted language on boot
getPersistedLanguage().then((stored) => {
  if (stored && stored !== i18n.language) {
    i18n.changeLanguage(stored);
  }
});

export default i18n;
