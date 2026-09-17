/**
 * Issue #3380 — the pure half of the venue menu's "Who's ordering?" phone:
 * where the picker starts and what is wrong with a number. React- and
 * React-Native-free (deep imports only), so the ordering surface can use it at
 * module scope without loading the picker component.
 */
import { getCountryByCode } from "@mingla/phone-input/countries";
import {
  parsePhoneEntry,
  resolvePhoneStartCountry,
} from "@mingla/phone-input/phoneNumber";

import { devicePhoneRegion } from "../../utils/devicePhoneRegion";

const phoneCountryKnown = (iso: string): boolean => {
  try {
    return getCountryByCode(iso) !== undefined;
  } catch {
    return false;
  }
};

/** issue #3380 — venue country, then the visitor's browser region. */
export const buyerOrderPhoneStartCountry = (
  venueCountry: string | null | undefined,
): string | null =>
  resolvePhoneStartCountry([venueCountry, devicePhoneRegion()], phoneCountryKnown);

/**
 * issue #3380 — the verdict on the guest's number, in words, or null. Mobile
 * rules, because the order's "it's ready" message is a text.
 */
export const buyerOrderPhoneFailure = (
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
