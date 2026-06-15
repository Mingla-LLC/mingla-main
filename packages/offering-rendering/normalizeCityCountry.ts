// @mingla/offering-rendering — ORCH-1138 [trip-page-redesign] route-block normalizer.
//
// Seth device feedback: the "Leaving from / Destination" addresses on the trip
// page were too long and ragged. They must ALWAYS render as "City, Country" only
// (e.g. "Raleigh, USA", "Washington DC, USA", "Positano, Italy") so the two legs
// stay balanced on a single aligned row.
//
// This is a PURE function (no app src/ imports — I-MOR-0827-PACKAGE-ISOLATION) so
// BOTH the business/web trip render path (TripPreview.tsx) and the consumer trip
// adapter (ConsumerTripDetailScreen.tsx) import the SAME normalizer — never fork.
//
// The trip data model carries ONLY free-text location strings (departureText /
// destinationText / *LocationText) plus a placeId + lat/lng — there are NO
// structured Mapbox city/country string fields on the trip payload (verified
// against TripBusinessTrip / ConsumerTripDetail). The optional structured-field
// inputs below are honored when a future caller can supply them (PREFER path),
// otherwise we parse the free text (rule 9 — no fabrication: an unresolvable
// value returns null so the caller hides that leg gracefully).

/**
 * Optional structured location parts. When a caller already holds a resolved
 * city / country (e.g. from a Mapbox structured field), pass them and the parser
 * is skipped. Absent fields fall back to free-text parsing.
 */
export interface StructuredPlaceParts {
  city?: string | null;
  country?: string | null;
}

// Country aliases → short canonical display form. The United States collapses to
// "USA" per Seth's spec ("United States" / "United States of America" / "US" /
// "U.S.A." → "USA"). Every other country keeps its common name (we title-case it
// and only rewrite the handful of common long/abbreviated forms below).
const COUNTRY_ALIASES: Record<string, string> = {
  "united states": "USA",
  "united states of america": "USA",
  "us": "USA",
  "u.s.": "USA",
  "u.s.a.": "USA",
  "usa": "USA",
  "america": "USA",
  "united kingdom": "UK",
  "great britain": "UK",
  "u.k.": "UK",
  "uk": "UK",
  "uae": "UAE",
  "united arab emirates": "UAE",
};

// Common US state names + USPS abbreviations. When the LAST comma-part of a
// free-text address is a US state (e.g. "Raleigh, North Carolina, United States"
// where the country is dropped, or "Raleigh, NC"), we treat it as USA and use the
// part before it as the city.
const US_STATES = new Set<string>([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
  "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
  "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
  "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
  "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey",
  "new mexico", "new york", "north carolina", "north dakota", "ohio",
  "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina",
  "south dakota", "tennessee", "texas", "utah", "vermont", "virginia",
  "washington", "west virginia", "wisconsin", "wyoming",
  "district of columbia",
]);

const US_STATE_ABBR = new Set<string>([
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id",
  "il", "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms",
  "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok",
  "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv",
  "wi", "wy", "dc",
]);

/** "  raleigh " → "Raleigh"; "WASHINGTON DC" → "Washington DC"; preserves all-caps acronyms ≤3 chars. */
function titleCasePlace(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((word) => {
      // Keep short tokens that are already all-caps as acronyms (DC, NY-style
      // city suffixes), and keep mixed-case tokens with internal caps as-is.
      if (word.length <= 3 && word === word.toUpperCase()) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/** Strip a parenthetical airport/IATA code and any "Intl"/"International airport" noise from a city token. */
function stripAirportNoise(raw: string): string {
  return raw
    // drop "(NAP)" / "( NAP )" parentheticals
    .replace(/\([^)]*\)/g, " ")
    // drop trailing airport words so "Naples Intl" → "Naples"
    .replace(/\b(intl|international)\b/gi, " ")
    .replace(/\b(airport|apt)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize a raw country token to its short display form, or title-case it. */
function normalizeCountry(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\.$/, "");
  if (COUNTRY_ALIASES[key] !== undefined) return COUNTRY_ALIASES[key];
  if (COUNTRY_ALIASES[key + "."] !== undefined) return COUNTRY_ALIASES[key + "."];
  return titleCasePlace(raw);
}

function isUsState(token: string): boolean {
  const key = token.trim().toLowerCase();
  return US_STATES.has(key) || US_STATE_ABBR.has(key);
}

function isCountryToken(token: string): boolean {
  return COUNTRY_ALIASES[token.trim().toLowerCase().replace(/\.$/, "")] !== undefined;
}

/**
 * Normalize a departure/destination value to exactly "City, Country".
 *
 * Resolution order:
 *   1. Structured parts (PREFER) — when a caller supplies a resolved city and/or
 *      country, use them directly (still normalizing the country form).
 *   2. Free-text parse — split on commas, strip airport/street noise, identify
 *      the country (or infer USA from a US state), use the leading part as the
 *      city.
 *
 * Returns:
 *   - "City, Country" when both resolve.
 *   - "City" when only a city resolves (no country).
 *   - null when nothing resolvable (rule 9 — caller hides that leg; no fabrication).
 */
export function normalizeCityCountry(
  freeText: string | null | undefined,
  structured?: StructuredPlaceParts | null,
): string | null {
  // 1) PREFER structured fields when present.
  const structuredCity =
    structured?.city != null && structured.city.trim().length > 0
      ? titleCasePlace(stripAirportNoise(structured.city))
      : null;
  const structuredCountry =
    structured?.country != null && structured.country.trim().length > 0
      ? normalizeCountry(structured.country)
      : null;

  if (structuredCity !== null) {
    return structuredCountry !== null
      ? `${structuredCity}, ${structuredCountry}`
      : structuredCity;
  }

  // 2) Free-text parse.
  if (freeText == null) return null;
  const cleaned = freeText.trim();
  if (cleaned.length === 0) return null;

  const parts = cleaned
    .split(",")
    .map((p) => stripAirportNoise(p))
    .filter((p) => p.length > 0);

  if (parts.length === 0) return null;

  // Single token: it's the city (could already be just a city). Drop a trailing
  // country/state if it's the only token only when it's clearly a country.
  if (parts.length === 1) {
    const only = parts[0];
    if (isCountryToken(only)) return normalizeCountry(only);
    return titleCasePlace(only);
  }

  // Walk from the end: find the country. If the last part is a country, use it.
  // If the last part is a US state (country dropped), the country is USA.
  let country: string | null = null;
  let cityEndIdx = parts.length; // exclusive upper bound for the city candidate

  const last = parts[parts.length - 1];
  if (isCountryToken(last)) {
    country = normalizeCountry(last);
    cityEndIdx = parts.length - 1;
    // If the part before the country is a US state, drop it too (Raleigh, NC, USA).
    if (
      country === "USA" &&
      cityEndIdx > 1 &&
      isUsState(parts[cityEndIdx - 1])
    ) {
      cityEndIdx -= 1;
    } else if (cityEndIdx > 1 && isUsState(parts[cityEndIdx - 1])) {
      // Non-US-aliased country but trailing token is a US state name — only drop
      // when country resolved to USA; otherwise keep (handled above). No-op here.
    }
  } else if (isUsState(last)) {
    // Country was dropped; a US state implies USA. ("Raleigh, North Carolina")
    country = "USA";
    cityEndIdx = parts.length - 1;
    // Drop any further trailing US state tokens (defensive).
    while (cityEndIdx > 1 && isUsState(parts[cityEndIdx - 1])) cityEndIdx -= 1;
  } else {
    // Last part is neither a known country nor a US state → treat it as the
    // country (free-text country we don't have an alias for, e.g. "Italy").
    country = normalizeCountry(last);
    cityEndIdx = parts.length - 1;
  }

  // The city is the FIRST remaining part (the most specific locality) — trip
  // departure/destination values are place/city names, not street addresses, so
  // parts[0] is the locality and any middle region parts are dropped. ONE guard:
  // if parts[0] is clearly a street line (leading house number, or a street
  // suffix like Ave/St/Rd/Blvd/Ln/Dr) AND a following locality part exists, skip
  // it and use the next part as the city.
  let cityIdx = 0;
  if (
    cityEndIdx > 1 &&
    looksLikeStreetLine(parts[0]) &&
    !looksLikeStreetLine(parts[1])
  ) {
    cityIdx = 1;
  }
  const cityRaw = cityIdx < cityEndIdx ? parts[cityIdx] : "";
  const city = cityRaw.length > 0 ? titleCasePlace(cityRaw) : null;

  if (city === null) {
    return country;
  }
  return country !== null ? `${city}, ${country}` : city;
}

/** Heuristic: does a comma-part look like a street line rather than a locality? */
function looksLikeStreetLine(token: string): boolean {
  const t = token.trim();
  if (/^\d/.test(t)) return true; // leading house number
  return /\b(ave|avenue|st|street|rd|road|blvd|boulevard|ln|lane|dr|drive|way|ct|court|pl|place|hwy|highway|suite|ste|apt|unit|fl|floor)\b\.?/i.test(
    t,
  );
}
