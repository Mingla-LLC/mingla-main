/**
 * #4238 — the countries a Host ad starts with, chosen by name.
 *
 * Never invent a country: the list starts from what the Host already saved,
 * then a legacy saved text, then the brand's own country, else empty.
 * Pure module: no React, no I/O.
 */

import { COUNTRIES, getCountryByCode } from "@mingla/phone-input/countries";

const ISO_RE = /^[A-Z]{2}$/;

const isKnownCountry = (code: string): boolean => {
  try {
    return getCountryByCode(code) !== undefined;
  } catch {
    return false;
  }
};

function cleanCountries(values: readonly unknown[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => String(value ?? "").trim().toUpperCase())
        .filter((code) => ISO_RE.test(code) && isKnownCountry(code)),
    ),
  ];
}

/**
 * Precedence: saved draft array → legacy saved text → brand country → [].
 * Unknown codes (e.g. "ZZ") are dropped.
 */
export function initialHostAdCountries(
  brandCountry: string | null | undefined,
  draftCountries?: readonly unknown[] | null,
  legacyCountriesText?: string | null,
): string[] {
  if (Array.isArray(draftCountries)) {
    const fromDraft = cleanCountries(draftCountries);
    if (fromDraft.length > 0) return fromDraft;
  }
  if (typeof legacyCountriesText === "string" && legacyCountriesText.trim()) {
    const fromLegacy = cleanCountries(legacyCountriesText.split(/[\s,]+/));
    if (fromLegacy.length > 0) return fromLegacy;
  }
  return cleanCountries(brandCountry ? [brandCountry] : []);
}

/** "🇳🇬 Nigeria", falling back to the code for an unknown country. */
export function countryLabel(code: string): string {
  const country = isKnownCountry(code) ? getCountryByCode(code) : undefined;
  return country ? `${country.flag} ${country.name}` : code;
}

/** "Nigeria", falling back to the code. */
export function countryName(code: string): string {
  const country = isKnownCountry(code) ? getCountryByCode(code) : undefined;
  return country ? country.name : code;
}

/** #4238 rework 3: the web country sheet's rows: not yet chosen, matching the search. */
export function hostAdCountryMatches(
  query: string,
  chosen: readonly string[],
): { code: string; name: string; flag: string }[] {
  const q = query.trim().toLowerCase();
  return COUNTRIES.filter((country) => !chosen.includes(country.code))
    .filter((country) => q === "" || country.name.toLowerCase().includes(q) || country.code.toLowerCase() === q)
    .map((country) => ({ code: country.code, name: country.name, flag: country.flag }));
}
