/**
 * #4389 T1 — turn a picked Google place into the Tap to Pay on iPhone
 * card-payments address, or name the one part that is missing. Pure.
 */
export interface PickedPlace {
  line1?: string | null;
  postalCode?: string | null;
  city: string;
  regionCode: string | null;
  countryCode: string | null;
}

export type TapAddressDraft =
  | { ok: true; line1: string; city: string; state: string | null; postalCode: string; country: string }
  | { ok: false; missing: "building_number"; partial: Omit<Extract<TapAddressDraft, { ok: true }>, "ok"> }
  | { ok: false; missing: "wrong_country" | "postal_code" | "state" };

export function tapAddressFromPlace(place: PickedPlace, bankCountry: string): TapAddressDraft {
  const country = (place.countryCode ?? "").toUpperCase();
  if (country !== bankCountry.toUpperCase()) return { ok: false, missing: "wrong_country" };
  const postal = (place.postalCode ?? "").trim();
  if (!postal) return { ok: false, missing: "postal_code" };
  const state = country === "US" ? (place.regionCode ?? "").toUpperCase() || null : null;
  if (country === "US" && state === null) return { ok: false, missing: "state" };
  const line1 = (place.line1 ?? "").trim();
  const base = { line1, city: place.city, state, postalCode: postal, country };
  if (!/\d/.test(line1)) return { ok: false, missing: "building_number", partial: base };
  return { ok: true, ...base };
}

/** Prefix the building number the host typed onto the street line. */
export function withBuildingNumber(line1: string, number: string): string {
  const n = number.trim();
  return n ? `${n} ${line1}`.trim() : line1;
}
