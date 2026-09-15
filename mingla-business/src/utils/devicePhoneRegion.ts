/**
 * Issue #3380 — the device's region, for a phone picker with nothing better.
 *
 * `getDefaultCountryCode` (packages/phone-input) relies on expo-localization,
 * which the Business web bundle does not ship, so on the web it always answered
 * "US" — the browser's own locale is the honest answer there. Only ever the
 * LAST candidate: a venue's or brand's country always comes first.
 */
import { getDefaultCountryCode } from "@mingla/phone-input";

export const devicePhoneRegion = (): string | null => {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const region = locale
      .split("-")
      .find((part, index) => index > 0 && /^[A-Za-z]{2}$/.test(part));
    if (region !== undefined) return region.toUpperCase();
  } catch {
    // Intl unavailable — fall through.
  }
  try {
    return getDefaultCountryCode();
  } catch {
    return null;
  }
};
