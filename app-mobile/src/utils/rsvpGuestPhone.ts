/**
 * issue #4508 R5 — the Explorer RSVP guest number, resolved to E.164 with the
 * SAME parser the shared phone field uses (`@mingla/phone-input`
 * `parsePhoneEntry`, the field's own smart-entry rule, `any` mode), so any
 * valid international number is accepted (Ghana included). Whether a text can
 * go to it is a separate rule (rsvpGuestTextRoute.ts), applied after.
 *
 * `@mingla/card-identity` `resolveUserPhoneE164` stays the owner of a
 * person's OWN number (the primary field): it knows only the countries an
 * account number can come from, which is why a guest number from elsewhere
 * read "Enter a valid phone number".
 *
 * Pure (relative imports, no react-native) so it is Deno-testable.
 */

import { parsePhoneEntry } from "../../../packages/phone-input/phoneNumber.ts";
import { COUNTRY_DIRECTORY } from "../../../packages/phone-input/countryDirectory.ts";

/** E.164 for what was typed under the picked country, or null. */
export const resolveRsvpGuestPhone = (
  raw: string,
  countryIso: string | null,
): string | null => {
  const iso = countryIso?.trim().toUpperCase() ?? null;
  const dialCode = iso === null
    ? null
    : COUNTRY_DIRECTORY.find((c) => c.code === iso)?.dialCode ?? null;
  const entry = parsePhoneEntry(raw, { countryIso: iso, dialCode, mode: "any" });
  return entry.ok ? entry.e164 : null;
};
