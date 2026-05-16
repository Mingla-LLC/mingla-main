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
export const composeE164 = (
  countryDialCode: string,
  localDigits: string,
): string | null => {
  const digits = localDigits.replace(/\D/g, "");
  if (digits.length === 0) return null;
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
