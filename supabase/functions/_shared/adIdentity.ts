/**
 * adIdentity.ts — #4238 spec section 5.2 (used by W5-1). Per-platform identity
 * normalisation before SHA-256. Pure (Web Crypto only), no I/O.
 *
 * Step 0 Z6 / Z7 (read 14 Nov 2026):
 *   - Meta and Snap: phone digits with the country code, no `+` (hashedPhone,
 *     the pre-#4238 behaviour, unchanged).
 *   - Google: phone E.164 WITH the leading `+` (hashedPhoneE164); email trimmed
 *     and lower-cased and, for gmail.com / googlemail.com only, dots and any
 *     `+suffix` removed from the username (hashedEmailGoogle).
 *   - A local number (leading 0, no country code) gets no E.164 hash: the
 *     country is never guessed.
 */

export async function sha256HexOf(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const normaliseEmail = (v: string): string => v.trim().toLowerCase();

/** Google's documented email rule (Z7): gmail dots and +suffix are dropped. */
export function normaliseEmailForGoogle(v: string): string {
  const email = normaliseEmail(v);
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  const domain = email.slice(at + 1);
  if (domain !== "gmail.com" && domain !== "googlemail.com") return email;
  const user = email.slice(0, at).split("+")[0].replace(/\./g, "");
  return user ? `${user}@${domain}` : email;
}

export const phoneDigits = (v: string): string => v.replace(/[^0-9]/g, "");

/**
 * E.164 with `+`, or null when the number is local (leading 0) or too short to
 * carry a country code. A leading `00` international prefix is dropped.
 */
export function phoneE164(v: string): string | null {
  const raw = v.trim();
  let digits = phoneDigits(raw);
  if (!raw.startsWith("+") && digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length < 8 || digits.length > 15) return null;
  if (!raw.startsWith("+") && digits.startsWith("0")) return null;
  return `+${digits}`;
}

export interface IdentityHashes {
  hashedEmail: string | null;
  hashedPhone: string | null;
  hashedPhoneE164: string | null;
  hashedEmailGoogle: string | null;
}

export async function identityHashes(
  email: string | null | undefined,
  phone: string | null | undefined,
): Promise<IdentityHashes> {
  const e = typeof email === "string" && email.trim() ? email : null;
  const p = typeof phone === "string" && phone.trim() ? phone : null;
  const e164 = p ? phoneE164(p) : null;
  return {
    hashedEmail: e ? await sha256HexOf(normaliseEmail(e)) : null,
    hashedPhone: p ? await sha256HexOf(phoneDigits(p)) : null,
    hashedPhoneE164: e164 ? await sha256HexOf(e164) : null,
    hashedEmailGoogle: e ? await sha256HexOf(normaliseEmailForGoogle(e)) : null,
  };
}
