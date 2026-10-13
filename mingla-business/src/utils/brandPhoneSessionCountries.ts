/**
 * Issue #3380 — the country a host last picked for a brand phone number, kept
 * in memory for THIS run of the app only.
 *
 * It lives in its own file, with no imports, so sign-out can empty it
 * (`clearAllStores`, Constitution rule 6) without pulling the phone rules into
 * the code every screen loads. `brandContactPhoneRules.ts` is the only reader
 * and writer; see `rememberBrandPhoneSavedCountry` there for why this is a
 * hint and not a saved fact.
 */

const SESSION_COUNTRY_LIMIT = 50;
const sessionCountryByNumber = new Map<string, string>();

/** Remember the country an E.164 number was saved under; oldest entry drops. */
export function setBrandPhoneSessionCountry(
  e164: string,
  countryIso: string,
): void {
  sessionCountryByNumber.delete(e164);
  sessionCountryByNumber.set(e164, countryIso.toUpperCase());
  if (sessionCountryByNumber.size > SESSION_COUNTRY_LIMIT) {
    const oldest = sessionCountryByNumber.keys().next();
    if (oldest.done !== true) sessionCountryByNumber.delete(oldest.value);
  }
}

/** The country remembered for an E.164 number, if any. */
export function getBrandPhoneSessionCountry(e164: string): string | null {
  return sessionCountryByNumber.get(e164) ?? null;
}

/** How many numbers are remembered (for tests and sign-out proof). */
export function brandPhoneSessionCountryCount(): number {
  return sessionCountryByNumber.size;
}

/** Forget every remembered country. Called on sign-out. */
export function clearBrandPhoneSessionCountries(): void {
  sessionCountryByNumber.clear();
}
