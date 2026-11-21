/**
 * rsvpGuestTextRoute — issue #4508 R6: can Mingla text this guest number?
 *
 * The client copy of the server's rule (public-submit-rsvp `routable`: a
 * strict E.164 number whose calling code `countryFromE164` maps to a country,
 * i.e. a country the SMS adapter routes). The server stays the authority: it
 * answers willText false with notTextedReason "unsupported_region" for any
 * other number. This copy only stops the form promising a text it cannot send.
 *
 * PARITY: `rsvp_guest_text_route.implementor.test.ts` checks every calling
 * code in the phone picker's country list against the server's
 * `countryFromE164` (supabase/functions/_shared/e164Country.ts), so the two
 * cannot drift. When Mingla can text a new country, add it in both places.
 *
 * Pure and dependency-free. Imported only by the guest model (the lazily
 * loaded guest block), never by the eager RSVP body.
 */

/** Calling codes with a guest text route, longest first. */
export const RSVP_GUEST_TEXT_CALLING_CODES: ReadonlyArray<string> = [
  "+234",
  "+44",
  "+33",
  "+32",
  "+1",
];

const E164_RE = /^\+[1-9][0-9]{7,14}$/;

/** True when a guest invite text can go to this E.164 number. */
export const rsvpGuestNumberTextable = (phone: string): boolean => {
  const trimmed = phone.trim();
  return E164_RE.test(trimmed) &&
    RSVP_GUEST_TEXT_CALLING_CODES.some((code) => trimmed.startsWith(code));
};
