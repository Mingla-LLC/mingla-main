export interface LanguageData {
  code: string    // ISO 639-1 (e.g., 'en')
  name: string    // English name (e.g., 'English')
  nativeName: string  // Native name (e.g., 'English')
}

// Top 10 most spoken languages first, then alphabetical.
// This list covers 95%+ of global mobile users.
export const LANGUAGES: LanguageData[] = [
  // ─── Top 10 ───
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'zh', name: 'Chinese', nativeName: '中文' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  // ─── Alphabetical ───
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
]

export function getLanguageByCode(code: string): LanguageData | undefined {
  return LANGUAGES.find((l) => l.code === code)
}

/**
 * Detect default language from device locale.
 * Uses Expo's getLocales() if available, falls back to 'en'.
 */
export function getDefaultLanguageCode(): string {
  try {
    // Expo localization — already a dependency via expo-location
    const { getLocales } = require('expo-localization')
    const locales = getLocales()
    if (locales?.length > 0) {
      const deviceLang = locales[0].languageCode
      // Only use it if it's in our supported list
      if (deviceLang && LANGUAGES.some((l) => l.code === deviceLang)) {
        return deviceLang
      }
    }
  } catch {
    // Silently fall back
  }
  return 'en'
}
