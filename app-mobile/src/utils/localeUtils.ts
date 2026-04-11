import i18n from '../i18n'

/**
 * Maps i18n language codes to BCP 47 locale tags for date/number formatting.
 * Falls back to 'en-US' for unmapped codes.
 */
const LOCALE_MAP: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  pt: 'pt-BR',
  nl: 'nl-NL',
  ar: 'ar-SA',
  bn: 'bn-BD',
  zh: 'zh-CN',
  el: 'el-GR',
  he: 'he-IL',
  hi: 'hi-IN',
  id: 'id-ID',
  it: 'it-IT',
  ja: 'ja-JP',
  ko: 'ko-KR',
  ms: 'ms-MY',
  pl: 'pl-PL',
  ro: 'ro-RO',
  ru: 'ru-RU',
  sv: 'sv-SE',
  th: 'th-TH',
  tr: 'tr-TR',
  uk: 'uk-UA',
  vi: 'vi-VN',
  ha: 'ha-NG',
  ig: 'ig-NG',
  yo: 'yo-NG',
  bin: 'en-NG',  // Bini/Edo — no standard BCP 47 tag, use Nigerian English
}

/**
 * Get the current user's locale for date/number formatting.
 * Uses the i18n language setting, mapped to a BCP 47 locale tag.
 */
export function getUserLocale(): string {
  return LOCALE_MAP[i18n.language] || 'en-US'
}
