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
import en_profile from './locales/en/profile.json'
import en_settings from './locales/en/settings.json'
import en_connections from './locales/en/connections.json'
import en_saved from './locales/en/saved.json'
import en_feedback from './locales/en/feedback.json'
import es_common from './locales/es/common.json'
import es_onboarding from './locales/es/onboarding.json'
import es_navigation from './locales/es/navigation.json'
import es_cards from './locales/es/cards.json'
import es_discover from './locales/es/discover.json'
import es_preferences from './locales/es/preferences.json'
import es_share from './locales/es/share.json'
import es_paywall from './locales/es/paywall.json'
import es_profile from './locales/es/profile.json'
import es_settings from './locales/es/settings.json'
import es_connections from './locales/es/connections.json'
import es_saved from './locales/es/saved.json'
import es_feedback from './locales/es/feedback.json'
import en_chat from './locales/en/chat.json'
import en_social from './locales/en/social.json'
import en_map from './locales/en/map.json'
import es_chat from './locales/es/chat.json'
import es_social from './locales/es/social.json'
import es_map from './locales/es/map.json'
import en_activity from './locales/en/activity.json'
import en_board from './locales/en/board.json'
import en_notifications from './locales/en/notifications.json'
import es_activity from './locales/es/activity.json'
import es_board from './locales/es/board.json'
import es_notifications from './locales/es/notifications.json'
import en_modals from './locales/en/modals.json'
import en_billing from './locales/en/billing.json'
import en_expanded_details from './locales/en/expanded_details.json'
import en_auth from './locales/en/auth.json'
import es_modals from './locales/es/modals.json'
import es_billing from './locales/es/billing.json'
import es_expanded_details from './locales/es/expanded_details.json'
import es_auth from './locales/es/auth.json'

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
    en: { common: en_common, onboarding: en_onboarding, navigation: en_navigation, cards: en_cards, discover: en_discover, preferences: en_preferences, share: en_share, paywall: en_paywall, profile: en_profile, settings: en_settings, connections: en_connections, saved: en_saved, feedback: en_feedback, chat: en_chat, social: en_social, map: en_map, activity: en_activity, board: en_board, notifications: en_notifications, modals: en_modals, billing: en_billing, expanded_details: en_expanded_details, auth: en_auth },
    es: { common: es_common, onboarding: es_onboarding, navigation: es_navigation, cards: es_cards, discover: es_discover, preferences: es_preferences, share: es_share, paywall: es_paywall, profile: es_profile, settings: es_settings, connections: es_connections, saved: es_saved, feedback: es_feedback, chat: es_chat, social: es_social, map: es_map, activity: es_activity, board: es_board, notifications: es_notifications, modals: es_modals, billing: es_billing, expanded_details: es_expanded_details, auth: es_auth },
  },
  lng: getDefaultLanguageCode(),
  fallbackLng: 'en',
  ns: ['common', 'onboarding', 'navigation', 'cards', 'discover', 'preferences', 'share', 'paywall', 'profile', 'settings', 'connections', 'saved', 'feedback', 'chat', 'social', 'map', 'activity', 'board', 'notifications', 'modals', 'billing', 'expanded_details', 'auth'],
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
