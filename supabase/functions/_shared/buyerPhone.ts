// ===========================================================================
// Issue #3380 — the ordering rails' phone number, with the guest's country.
//
// `normalizePhoneE164` (ticketCheckout.ts) knows two shapes: "+…", or ten
// digits it assumes are American. A Lagos guest typing `0803 123 4567` was
// refused, and one typing `803 123 4567` was saved as +1 803 123 4567 — a
// number in South Carolina. Both ordering rails used it.
//
// This resolver takes the country the guest chose (`buyer.phoneCountryIso`, the
// same field venue-reservation-create already accepts) and converts through
// the ONE entry rule set every app uses (`packages/phone-input/phoneNumber.ts`),
// so the server can never disagree with the form that sent the number.
//
// BACKWARD COMPATIBLE BY CONSTRUCTION
//   1. An E.164 value is returned byte-for-byte, exactly as before — every
//      deployed client that already sends "+…" is untouched.
//   2. A national number WITH a country is converted by the shared rules.
//   3. A national number WITHOUT a country (an app build from before this
//      change) keeps the old ten-digit reading, but `legacyNanpGuess` says so,
//      and the caller refuses it once it knows the venue is not in North
//      America. Refusing is the fix: the old reading turned a Nigerian mobile
//      into somebody else's American number.
// ===========================================================================

// Deno needs the explicit `.ts` extension; the Business jest suite (which
// proves this file) compiles it without `allowImportingTsExtensions`.
// @ts-ignore -- TS5097 under ts-jest only.
import { parsePhoneEntry } from "../../../packages/phone-input/phoneNumber.ts";

/** What a guest reads when a number arrives without a country we can trust. */
export const LEGACY_NANP_REFUSAL =
  "Add the country code to the number — for example +234 for Nigeria or +44 for the UK.";

const E164_RE = /^\+[1-9][0-9]{1,14}$/;
const ISO_RE = /^[A-Z]{2}$/;

export interface BuyerPhoneResolution {
  /** Canonical phone, or null when it cannot be used. */
  e164: string | null;
  /**
   * The specific reason, when the guest typed SOMETHING we could not use.
   * null when the field was simply empty (the generic copy is right then).
   */
  message: string | null;
  /** True only on the legacy "ten digits means +1" reading. */
  legacyNanpGuess: boolean;
}

export function resolveBuyerPhone(
  raw: unknown,
  countryIso: unknown,
): BuyerPhoneResolution {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { e164: null, message: null, legacyNanpGuess: false };
  }
  const trimmed = raw.trim();
  if (E164_RE.test(trimmed)) {
    return { e164: trimmed, message: null, legacyNanpGuess: false };
  }

  const iso = typeof countryIso === "string" &&
      ISO_RE.test(countryIso.trim().toUpperCase())
    ? countryIso.trim().toUpperCase()
    : null;

  // A "+" the guest typed names the country on its own ("+234 803 123 4567"
  // with spaces used to be refused outright).
  if (iso !== null || trimmed.startsWith("+")) {
    const result = parsePhoneEntry(trimmed, { countryIso: iso, mode: "any" });
    if (result.ok) {
      return { e164: result.e164, message: null, legacyNanpGuess: false };
    }
    return {
      e164: null,
      message: result.problem === "country_required"
        ? LEGACY_NANP_REFUSAL
        : result.message,
      legacyNanpGuess: false,
    };
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) {
    return { e164: `+1${digits}`, message: null, legacyNanpGuess: true };
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return { e164: `+${digits}`, message: null, legacyNanpGuess: true };
  }
  return {
    e164: null,
    message: LEGACY_NANP_REFUSAL,
    legacyNanpGuess: false,
  };
}

/**
 * The old "ten digits are American" reading is only believable for a venue in
 * the North American plan. Anywhere else it is refused, never guessed.
 */
export function legacyNanpGuessAllowed(paymentCountry: unknown): boolean {
  if (typeof paymentCountry !== "string" || paymentCountry.trim() === "") {
    return true;
  }
  const country = paymentCountry.trim().toUpperCase();
  return country === "US" || country === "CA";
}
