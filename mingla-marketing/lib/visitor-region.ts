/**
 * #4452 follow-up (B15): the visitor's region from the browser's language
 * ("en-NG" -> "NG"), so the city search ranks their own country's cities
 * first. A hint only; null when the browser gives no region.
 */
export function visitorRegion(langs?: readonly string[]): string | null {
  const list = langs ?? (typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [])
  for (const tag of list) {
    try {
      const region = new Intl.Locale(String(tag)).region
      if (region && /^[A-Z]{2}$/.test(region)) return region
    } catch {
      // A malformed tag gives no hint.
    }
  }
  return null
}
