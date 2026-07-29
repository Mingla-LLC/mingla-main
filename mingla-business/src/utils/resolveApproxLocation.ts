/**
 * resolveApproxLocation — Issue #1363 [three-tier address]
 *
 * ONE owner for the Tier-2 (free-text → coarse coords) and Tier-3 (pin → address)
 * resolution so all six business address flows call the SAME logic (SPEC §2.1.4).
 *
 * - `resolveFreeTextLocation(text)` forward-geocodes typed text. On a real hit it
 *   returns a normalized location with `precision: "approximate"` (often
 *   city-level). On NO match / failure it returns `null` — the host then leaves
 *   lat/lng NULL and surfaces a non-silent "drop a pin" message (Constitution
 *   rule 3). It NEVER fabricates a {0,0} or any coordinate (rule 9).
 * - `resolvePinLocation(lat,lng)` reverse-geocodes a dropped pin to fill
 *   city/region/country. The COORDINATE is authoritative (`precision: "exact"`);
 *   if reverse-geocode fails, the coordinate still stands and city/region/country
 *   are left NULL (honest — never guessed).
 *
 * Both accept an injected geocoder (`deps`) so the pure logic is unit-testable
 * without the network; production callers use the business-bound defaults.
 */

import type { PlaceDetails } from "@mingla/location-input";
import {
  forwardGeocodeMapbox as businessForward,
  reverseGeocodeMapbox as businessReverse,
} from "../services/mapboxGeocodeService";

/** Persisted precision tokens (three tiers collapse to two + null when unset). */
export type CoordinatePrecision = "exact" | "approximate";

export interface ApproxLocation {
  lat: number;
  lng: number;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  /**
   * The geocoder's formatted address, when available. Hosts use it ONLY as a
   * fallback display label (e.g. a pin dropped on an EMPTY field) — a non-empty
   * brand-typed label always wins. Null when the geocoder returned nothing.
   */
  formattedAddress: string | null;
  precision: CoordinatePrecision;
}

const cleanString = (v: string | null | undefined): string | null =>
  v !== undefined && v !== null && v.trim().length > 0 ? v : null;

export interface ForwardDep {
  forward?: (query: string) => Promise<PlaceDetails>;
}
export interface ReverseDep {
  reverse?: (lat: number, lng: number) => Promise<PlaceDetails>;
}

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * Latest-wins guard for the fire-and-forget free-text resolve (issue #1363 P3-2).
 *
 * `resolveFreeTextLocation` is un-cancellable, so a SLOW earlier forward-geocode
 * can resolve AFTER the user has re-typed, picked a suggestion, or cleared the
 * field — and would otherwise patch a coordinate for text the field no longer
 * shows (a stale coordinate landing on the draft). A host records the text it is
 * resolving and, when the async result returns, calls this with the field's
 * CURRENTLY-committed text: a `true` return means the resolve was superseded and
 * the host MUST drop it (patch nothing). Whitespace-insensitive; equal text is
 * never stale, so the common (non-racing) path is a no-op.
 */
export const isFreeTextResolveStale = (
  resolvedForText: string,
  committedTextNow: string,
): boolean => resolvedForText.trim() !== committedTextNow.trim();

/**
 * Tier-2 — forward-geocode free text to a coarse coordinate. Returns null when
 * the query is empty, the geocoder throws, or the result has no finite coords
 * (never a fabricated coordinate). A hit carries `precision: "approximate"`.
 */
export async function resolveFreeTextLocation(
  text: string,
  deps: ForwardDep = {},
): Promise<ApproxLocation | null> {
  const query = text.trim();
  if (query.length === 0) return null;
  const forward = deps.forward ?? businessForward;
  try {
    const d = await forward(query);
    const lat = d.location?.lat;
    const lng = d.location?.lng;
    if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null;
    return {
      lat,
      lng,
      city: cleanString(d.city),
      region: cleanString(d.region),
      countryCode: cleanString(d.countryCode),
      formattedAddress: cleanString(d.formattedAddress),
      precision: "approximate",
    };
  } catch {
    // Non-silent by contract: the HOST surfaces the "drop a pin" hint on null.
    return null;
  }
}

/**
 * Tier-3 — a dropped pin's coordinate is authoritative (`precision: "exact"`).
 * Reverse-geocode fills city/region/country when possible; on failure the
 * coordinate still stands and those fields are NULL (never guessed). Returns
 * null ONLY when the supplied coordinate itself is non-finite (guard against a
 * bad pixel-math result — the host then keeps lat/lng null, rule 9).
 */
export async function resolvePinLocation(
  lat: number,
  lng: number,
  deps: ReverseDep = {},
): Promise<ApproxLocation | null> {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null;
  const reverse = deps.reverse ?? businessReverse;
  let city: string | null = null;
  let region: string | null = null;
  let countryCode: string | null = null;
  let formattedAddress: string | null = null;
  try {
    const d = await reverse(lat, lng);
    city = cleanString(d.city);
    region = cleanString(d.region);
    countryCode = cleanString(d.countryCode);
    formattedAddress = cleanString(d.formattedAddress);
  } catch {
    // Coordinate is authoritative; leave admin fields null rather than guess.
  }
  return { lat, lng, city, region, countryCode, formattedAddress, precision: "exact" };
}
