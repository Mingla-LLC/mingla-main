/** Issue #1703 — a venue's stored number, made dialable from anywhere. */
export interface DialablePhone {
  /** What a human reads. Keeps the venue's own local grouping. */
  readonly display: string;
  /** What goes after `tel:`. E.164 when the country resolves, local digits otherwise. */
  readonly tel: string;
  /** True only when `tel` carries a country code. */
  readonly international: boolean;
}

/**
 * Returns null when there is no number at all — the caller must then render NO
 * control, never a disabled one. Never guesses a prefix: an unresolvable country
 * or a length that does not fit the country's plan returns the number unchanged
 * with `international: false`.
 */
export function dialablePhone(
  raw: string | null | undefined,
  countryCode: string | null | undefined,
): DialablePhone | null;

export function supportedDialCountries(): string[];

export const PHONE_PLANS: Readonly<Record<string, {
  dial: string; trunk: string | null; nsnLengths: number[];
}>>;

export function resolveUserPhoneE164(
  raw: string | null | undefined,
  countryIso: string | null | undefined,
): string | null;
