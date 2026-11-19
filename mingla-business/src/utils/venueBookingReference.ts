/**
 * #4490 fix 3 (N108) — the one short booking reference a person reads.
 *
 * The server keeps a 20-character reference ("VB-8CCAC3230254495296AF"); a
 * person reads and types the first eight ("VB-8CCAC323") on every Host and
 * guest screen: requests, gate sales, check-in rows, bookings, Today and the
 * guest's pass. Search keeps working because the short form starts the long
 * one (check-in matches by prefix). Anything not in that shape is shown as is.
 */
const LONG_REFERENCE = /^(VB|ST)-([0-9A-F]{8})[0-9A-F]+$/i;

export function shortBookingReference(reference: string): string;
export function shortBookingReference(reference: string | null | undefined): string | null;
export function shortBookingReference(reference: string | null | undefined): string | null {
  if (typeof reference !== "string") return null;
  const trimmed = reference.trim();
  const match = LONG_REFERENCE.exec(trimmed);
  return match === null ? trimmed : `${match[1].toUpperCase()}-${match[2].toUpperCase()}`;
}
