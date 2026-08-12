export interface DialablePhone {
  display: string;
  tel: string;
  international: boolean;
}

export function dialablePhone(
  raw: string | null | undefined,
  countryCode: string | null | undefined,
): DialablePhone | null;

export function resolveUserPhoneE164(
  raw: string | null | undefined,
  countryIso: string | null | undefined,
): string | null;

export function supportedDialCountries(): string[];

export const PHONE_PLANS: Readonly<
  Record<string, { dial: string; trunk: string | null; nsnLengths: number[] }>
>;
