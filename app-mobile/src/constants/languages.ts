export interface LanguageData {
  code: string    // ISO 639-1 (e.g., 'en')
  name: string    // English name (e.g., 'English')
  nativeName: string  // Native name (e.g., 'English')
}

// Priority order: English first, then Nigerian languages, then European, then alphabetical.
export const LANGUAGES: LanguageData[] = [
  // ─── Priority ───
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'bin', name: 'Bini', nativeName: 'Ẹ̀dó' },
  { code: 'ha', name: 'Hausa', nativeName: 'Hausa' },
  { code: 'ig', name: 'Igbo', nativeName: 'Igbo' },
  { code: 'yo', name: 'Yoruba', nativeName: 'Yorùbá' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  // ─── Alphabetical ───
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'zh', name: 'Chinese', nativeName: '中文' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
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

export function getDeviceLanguageCode(): string | null {
  try {
    const { getLocales } = require('expo-localization')
    const languageCode = getLocales()?.[0]?.languageCode
    return typeof languageCode === 'string' && languageCode.length > 0
      ? languageCode
      : null
  } catch {
    return null
  }
}

export function isDeviceLanguageSupported(): boolean {
  const deviceLanguage = getDeviceLanguageCode()
  return deviceLanguage === null || LANGUAGES.some((language) => language.code === deviceLanguage)
}

/**
 * Detect default language from device locale.
 * Uses Expo's getLocales() if available, falls back to 'en'.
 */
export function getDefaultLanguageCode(): string {
  const deviceLang = getDeviceLanguageCode()
  if (deviceLang && LANGUAGES.some((l) => l.code === deviceLang)) return deviceLang
  return 'en'
}
