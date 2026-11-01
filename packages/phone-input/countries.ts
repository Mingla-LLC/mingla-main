/**
 * Country directory for @mingla/phone-input.
 *
 * Per ORCH-0847 Phase A — extracted verbatim from
 * `app-mobile/src/constants/countries.ts`. Source: ISO 3166-1 + ITU-T E.164.
 * Top 10 most-common countries sorted to the top; remainder alphabetical.
 */

import type { CountryData } from "./types";
import { COUNTRY_DIRECTORY } from "./countryDirectory";

export const COUNTRIES: CountryData[] = COUNTRY_DIRECTORY.map((country) => ({
  ...country,
}));

export function getDefaultCountryCode(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getLocales } = require("expo-localization");
    const locale = getLocales()[0];
    return locale?.regionCode ?? "US";
  } catch {
    return "US";
  }
}

export function getCountryByCode(code: string): CountryData | undefined {
  return COUNTRIES.find((c) => c.code === code);
}

export function formatPhoneDisplay(phone: string): string {
  return phone;
}
