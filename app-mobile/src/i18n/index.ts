import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getDefaultLanguageCode } from '../constants/languages'

// Import all translation files statically
import en_common from './locales/en/common.json'
import en_onboarding from './locales/en/onboarding.json'
import en_navigation from './locales/en/navigation.json'
import en_cards from './locales/en/cards.json'
import en_discover from './locales/en/discover.json'
import en_preferences from './locales/en/preferences.json'
import en_share from './locales/en/share.json'
import en_paywall from './locales/en/paywall.json'
import es_common from './locales/es/common.json'
import es_onboarding from './locales/es/onboarding.json'
import es_navigation from './locales/es/navigation.json'
import es_cards from './locales/es/cards.json'
import es_discover from './locales/es/discover.json'
import es_preferences from './locales/es/preferences.json'
import es_share from './locales/es/share.json'
import es_paywall from './locales/es/paywall.json'

const LANGUAGE_STORAGE_KEY = 'mingla_preferred_language'

/**
 * Read persisted language from AsyncStorage.
 * This is the pre-auth fallback (before profile is available).
 */
export async function getPersistedLanguage(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * Persist language choice to AsyncStorage.
 * Called when user selects a language in onboarding or settings.
 * INV-I18N-003: Always call this together with i18n.changeLanguage().
 */
export async function persistLanguage(code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, code)
  } catch {}
}

i18n.use(initReactI18next).init({
  resources: {
    en: { common: en_common, onboarding: en_onboarding, navigation: en_navigation, cards: en_cards, discover: en_discover, preferences: en_preferences, share: en_share, paywall: en_paywall },
    es: { common: es_common, onboarding: es_onboarding, navigation: es_navigation, cards: es_cards, discover: es_discover, preferences: es_preferences, share: es_share, paywall: es_paywall },
  },
  lng: getDefaultLanguageCode(),
  fallbackLng: 'en',
  ns: ['common', 'onboarding', 'navigation', 'cards', 'discover', 'preferences', 'share', 'paywall'],
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
  compatibilityJSON: 'v4',
  pluralSeparator: '_',
})

// Async bootstrap: read persisted language (takes priority over device locale)
getPersistedLanguage().then((stored) => {
  if (stored && stored !== i18n.language) {
    i18n.changeLanguage(stored)
  }
})

export default i18n
