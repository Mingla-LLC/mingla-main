/**
 * Phone validation utilities for buyer checkout.
 *
 * Per ORCH-0847 Phase B (SPEC §4.3.3) — the country-picker PhoneInput component
 * (from `@mingla/phone-input`) always emits `+{countryDialCode}{localDigits}`
 * strings. Those match E.164 (1–3 digit dial code + 1–12 digit subscriber
 * number, total ≤ 15 digits per ITU-T E.164). The server validator at
 * `supabase/functions/_shared/ticketCheckout.ts:78-86` already accepts these
 * via its first-line regex `/^\+[1-9][0-9]{1,14}$/`.
 *
 * The legacy 10-digit / 11-with-leading-1 US fallback in the SERVER validator
 * stays for backward-compat with any legacy callers; this client file no
 * longer relies on that fallback because the new `<PhoneInput>` always emits
 * proper E.164 strings.
 */

/**
 * Tests whether a string is a valid E.164 phone number.
 * Matches the server validator's first-line regex exactly.
 *
 * @example isValidE164("+447700900000") → true
 * @example isValidE164("+14155551234")  → true
 * @example isValidE164("+2348012345678") → true
 * @example isValidE164("+1234")         → false  (too short)
 * @example isValidE164("447700900000")  → false  (missing leading +)
 */
export const isValidE164 = (value: string): boolean =>
  /^\+[1-9][0-9]{1,14}$/.test(value.trim());

/**
 * Composes an E.164 string from a country dial code + local digits.
 * Strips non-digits from `localDigits` before composition. Returns `null`
 * if the composed string fails E.164 validation (e.g., empty local digits,
 * total length exceeds 15).
 *
 * @example composeE164("+44", "7700900000") → "+447700900000"
 * @example composeE164("+234", "8012345678") → "+2348012345678"
 * @example composeE164("+44", "")          → null  (empty local digits)
 * @example composeE164("+44", "abc")       → null  (no digits)
 */
/**
 * issue #2462 — COUNTRIES WHOSE SUBSCRIBER NUMBER KEEPS ITS LEADING ZERO.
 *
 * Almost every country uses `0` as a national trunk prefix that is DROPPED in
 * E.164 (`0803…` -> `+234803…`). Italy is the famous exception: the leading zero
 * is part of the subscriber number and must be KEPT (`+39 06 …` is correct).
 * San Marino and Vatican City share Italy's numbering plan.
 *
 * Stripping is therefore the default and this set is the carve-out — the
 * opposite of a blocklist, so a country we have not thought about is handled
 * correctly rather than silently corrupted.
 */
const KEEPS_LEADING_ZERO = new Set(["+39", "+378", "+379"]);

/**
 * issue #2462 — DIAL CODES WITH NO NATIONAL TRUNK PREFIX AT ALL.
 *
 * The NANP (+1) has no trunk `0` — a leading zero there reaches the operator,
 * never a subscriber. So a leading zero on a +1 number is not a prefix to strip,
 * it is PROOF THE NUMBER IS NOT A NANP NUMBER, and the honest answer is to
 * refuse rather than to normalise.
 *
 * This distinction is load-bearing, and my first attempt got it wrong. Stripping
 * the zero from the real production row `+109069902335` (a Nigerian number typed
 * while the picker still showed the US default) yields `9069902335` — ten digits,
 * a structurally valid NANP number in Michigan's 906. The corruption would have
 * survived validation looking perfectly healthy. Refusing is what surfaces the
 * wrong-country mistake to the guest while they can still fix it.
 */
const NO_TRUNK_PREFIX = new Set(["+1"]);

/**
 * issue #2462 — LENGTH OF THE NATIONAL SIGNIFICANT NUMBER, per dial code.
 *
 * WHY THIS EXISTS. `isValidE164` only asks "1–15 digits, first one non-zero".
 * That accepted `+23409076649069` (a Nigerian number typed the way every
 * Nigerian writes it, `09076649069`, with the trunk zero left on) and
 * `+109069902335` (a Nigerian number sent with the US dial code because the
 * picker default was never changed). Both are undeliverable. Measured on
 * production: 17 of 71 We Go Again buyers, 19 of 114 platform-wide.
 *
 * ONLY COUNTRIES WE CAN STATE CONFIDENTLY ARE LISTED. An unlisted dial code
 * falls through to the generic E.164 check, which is exactly today's behaviour —
 * this table can only ever make validation stricter for numbers we understand,
 * never reject a country we have not characterised.
 */
const NSN_LENGTHS: Readonly<Record<string, readonly number[]>> = {
  "+234": [10], // Nigeria    — 7/8/9 + 9 digits
  "+1": [10], // NANP       — area code + 7
  "+44": [9, 10], // UK         — 9 (most) or 10 (some mobile/geographic)
  "+233": [9], // Ghana
  "+254": [9], // Kenya
  "+27": [9], // South Africa
  "+353": [9], // Ireland
};

/**
 * Composes an E.164 string from a country dial code + local digits.
 *
 * issue #2462 — this used to be `dialCode + digits.replace(/\D/g,"")` with no
 * normalisation at all, so it happily produced numbers that passed both the
 * client regex and the server regex and could never receive a message. Three
 * things now happen before validation, in this order:
 *
 *   1. THE NATIONAL TRUNK ZERO IS DROPPED (except for Italy & co, above). This
 *      is the one that mattered: Nigerians type `09076649069`.
 *   2. A DUPLICATED COUNTRY CODE IS DROPPED. Guests routinely paste their full
 *      international number into a field that already shows `+234`, producing
 *      `+2342348012345678`. Only stripped when the remainder is a LENGTH WE
 *      RECOGNISE for that country, so a legitimate US number in area code 234
 *      (Ohio) is never mangled.
 *   3. THE RESULT IS LENGTH-CHECKED against the country's plan when we know it.
 *      This is what catches a Nigerian number sent on the US dial code.
 *
 * Returns `null` when the result is not a number we believe can be delivered —
 * the caller then shows the field as invalid rather than reserving a ticket
 * against an address that will never receive the pass.
 *
 * @example composeE164("+234", "09076649069")  → "+2349076649069"  (trunk zero dropped)
 * @example composeE164("+234", "9071364247")   → "+2349071364247"
 * @example composeE164("+234", "2348012345678")→ "+2348012345678"  (pasted country code)
 * @example composeE164("+1",   "09069902335")  → null  (NANP has no trunk 0)
 * @example composeE164("+39",  "0612345678")   → "+390612345678"   (Italy keeps its zero)
 * @example composeE164("+44",  "")             → null  (empty local digits)
 */
export const composeE164 = (
  countryDialCode: string,
  localDigits: string,
): string | null => {
  let digits = localDigits.replace(/\D/g, "");
  if (digits.length === 0) return null;

  // (1) national trunk prefix
  if (NO_TRUNK_PREFIX.has(countryDialCode)) {
    // Not a prefix here — it is evidence of the wrong country. Refuse.
    if (digits.startsWith("0")) return null;
  } else if (!KEEPS_LEADING_ZERO.has(countryDialCode)) {
    digits = digits.replace(/^0+/, "");
    if (digits.length === 0) return null;
  }

  const expected = NSN_LENGTHS[countryDialCode];
  const ccDigits = countryDialCode.replace(/\D/g, "");

  // (2) the guest pasted the country code as well. Only trusted when the
  // remainder is a length we recognise for this country — otherwise a real
  // +1 234-xxx-xxxx would lose its area code.
  if (
    expected !== undefined &&
    digits.length > ccDigits.length &&
    digits.startsWith(ccDigits) &&
    expected.includes(digits.length - ccDigits.length) &&
    !expected.includes(digits.length)
  ) {
    digits = digits.slice(ccDigits.length);
  }

  // (3) the country's own plan, when we know it
  if (expected !== undefined && !expected.includes(digits.length)) return null;

  const composed = `${countryDialCode}${digits}`;
  return isValidE164(composed) ? composed : null;
};

/**
 * Back-compat alias for `isValidE164`. Kept so any non-buyer.tsx caller that
 * still imports `isRequiredPhoneValid` keeps working through ORCH-0847.
 *
 * @deprecated Use `isValidE164` (and `composeE164` to build the value) with
 * the shared `<PhoneInput>` from `@mingla/phone-input`.
 */
export const isRequiredPhoneValid = (raw: string): boolean =>
  isValidE164(raw);

/**
 * Back-compat alias for `composeE164` matching the pre-ORCH-0847 helper name.
 * Returns the input unchanged if it's already a valid E.164 string; otherwise
 * tries the legacy 10/11-digit US fallback for any non-PhoneInput caller.
 *
 * @deprecated Use `composeE164` directly with a country dial code.
 */
export const normalizePhoneE164 = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (isValidE164(trimmed)) return trimmed;
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
};
