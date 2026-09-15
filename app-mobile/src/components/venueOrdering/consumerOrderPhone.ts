/**
 * Issue #3380 — the pure half of the Explorer "Who's ordering?" phone: where
 * the picker starts and what is wrong with a number. React-Native-free, and
 * imported by RELATIVE path so the Business jest suites that mount this
 * surface resolve it without an app-mobile install.
 */
import {
  getCountryByCode,
  getDefaultCountryCode,
} from "../../../../packages/phone-input/countries";
import {
  parsePhoneEntry,
  resolvePhoneStartCountry,
} from "../../../../packages/phone-input/phoneNumber";

/** issue #3380 — venue country, then the device region. */
export const consumerOrderPhoneStartCountry = (
  venueCountry: string | null | undefined,
): string | null => {
  let device: string | null = null;
  try {
    device = getDefaultCountryCode();
  } catch {
    device = null;
  }
  return resolvePhoneStartCountry(
    [venueCountry, device],
    (iso) => getCountryByCode(iso) !== undefined,
  );
};

/** issue #3380 — the verdict on the guest's number, in words, or null. */
export const consumerOrderPhoneFailure = (
  phone: string,
  countryIso: string | null,
): { message: string; suggestedCountryIso: string | null } | null => {
  if (phone.replace(/\D/g, "").length === 0) return null;
  const result = parsePhoneEntry(phone, {
    countryIso,
    dialCode:
      countryIso === null ? null : (getCountryByCode(countryIso)?.dialCode ?? null),
    mode: "mobile",
  });
  return result.ok
    ? null
    : { message: result.message, suggestedCountryIso: result.suggestedCountryIso };
};
