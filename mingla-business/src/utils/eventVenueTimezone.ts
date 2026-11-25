/**
 * #4490 fix 2 (N84) — the time zone an event at a venue runs in: the venue's
 * country's zone (Lagos for a Nigerian venue), else the zone the draft
 * already has. Never the device's zone by accident.
 */
import { defaultTimezoneForBrand } from "./timezones";

export function venueTimezone(countryCode: string | null, fallback: string): string {
  const code = (countryCode ?? "").trim();
  if (code.length === 0) return fallback;
  return defaultTimezoneForBrand({ payoutCountry: code, deviceZone: fallback });
}
