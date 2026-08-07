// Issue #1704 — the country a seeded place gets, extracted so it is unit
// testable without `Deno.serve`, network, or a database.
//
// WHAT THIS REPLACES. `index.ts` used to hold `parseCountry(address, fallback)`:
// split `formattedAddress` on commas and take the last piece, with the seeded
// city's country as the fallback. Both call sites read
// `parseCountry(p.formattedAddress, cityCountry)` — the clean value was already
// in hand and the parse won over it. Result across 88,411 rows: 'USA' and 'UK'
// and 'US' and 'United Kingdom' for two countries, plus 'U0邮政编码: SE18 5NR'.
//
// THE RULE THIS MODULE EXISTS TO STATE: a place's country comes from the seeded
// city it belongs to. Never from prose. There is no address argument here, and
// that absence is the point — a future edit cannot reintroduce the parse without
// changing this signature, and the guard in `scripts/ci` fails if it does.

/** The shape `seeding_cities` gives us. Both fields may be absent on old rows. */
export interface SeedCityRow {
  readonly name?: string | null;
  readonly country?: string | null;
  readonly country_code?: string | null;
}

export interface SeedCountryFields {
  /** Free-text prose, for display only. Never branch on this. */
  readonly country: string;
  /** ISO-3166-1 alpha-2, or null. THE field anything may branch on. */
  readonly countryCode: string | null;
}

/** Exactly two capitals. Matches the `place_pool_country_code_chk` constraint. */
const ISO_ALPHA2 = /^[A-Z]{2}$/;

/**
 * Resolve the country fields for every place seeded under `city`.
 *
 * `countryCode` is null — NOT a guess and NOT the prose lower-cased — when the
 * city row carries no valid code. Null is safe: the `place_pool_fill_country_code_trg`
 * trigger derives it from `city_id` on write, and the CHECK constraint rejects
 * anything malformed either way. A guess would defeat both.
 */
export function seedCountryFields(city: SeedCityRow | null | undefined): SeedCountryFields {
  const prose = typeof city?.country === "string" && city.country.trim() !== ""
    ? city.country.trim()
    : "Unknown";

  const raw = typeof city?.country_code === "string" ? city.country_code.trim() : "";
  const countryCode = ISO_ALPHA2.test(raw) ? raw : null;

  return { country: prose, countryCode };
}
