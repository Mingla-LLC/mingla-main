/**
 * Issue #3380 — the device's region, for a phone picker with nothing better.
 *
 * `getDefaultCountryCode` (packages/phone-input) relies on expo-localization,
 * which the Business web bundle does not ship, so on the web it always answered
 * "US" — the browser's own locale is the honest answer there. Only ever the
 * LAST candidate: a venue's or brand's country always comes first.
 */
// Deep import: the country directory only. The package barrel also loads the
// PhoneInput component (and its keyboard library), which a plain helper must
// not drag into every module and test that asks for a region.
import { getDefaultCountryCode } from "@mingla/phone-input/countries";

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
