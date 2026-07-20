/**
 * ISSUE-989 [Campaign Builder real targeting] — the PURE mappers that turn the
 * Audience step's platform-neutral selections (city chips, interest chips,
 * radius, age/gender) into each platform's REAL targeting shape. payload.js
 * consumes these; the create edge fn + _shared adapters assemble the final wire
 * body. Country stays the fallback whenever no city is chosen.
 *
 * City chips carry per-platform resolved keys (from admin-ad-targeting-search):
 *   { label, country, meta:{key}, google:{name,country_code}, tiktok:{location_ids:[]} }
 * Interest chips are platform-tagged (interest taxonomies differ per platform —
 * never fabricate a cross-platform mapping):
 *   { platform:'meta'|'tiktok'|'reddit', id, name }
 */

/** Platforms whose city/interest taxonomy the search proxy resolves. */
export const CITY_SEARCH_PLATFORMS = ["meta", "tiktok", "google"];
export const INTEREST_SEARCH_PLATFORMS = ["meta", "tiktok", "reddit"];

// ── Radius (Meta city radius: 1-50 mi / 1-80 km) ──────────────────────────────
export const DEFAULT_RADIUS_MI = 10;
export const RADIUS_BOUNDS = {
  mile: { min: 1, max: 50 },
  kilometer: { min: 1, max: 80 },
};

export function clampRadius(value, unit = "mile") {
  const bounds = RADIUS_BOUNDS[unit] ?? RADIUS_BOUNDS.mile;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_RADIUS_MI;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(n)));
}

// ── Gender mappers (per-platform enums — the wizard value is all|women|men) ────
// Meta's mapper lives in audienceRules (metaGendersFor → [1]/[2]/null). These
// close the SILENT-DROP gap for TikTok/Snap/Reddit (Lane D finding #2).

/** TikTok gender enum (TIKTOK_GENDERS = GENDER_FEMALE|GENDER_MALE|GENDER_UNLIMITED). */
export function tiktokGenderFor(gender) {
  if (gender === "women") return "GENDER_FEMALE";
  if (gender === "men") return "GENDER_MALE";
  return undefined; // All → omit (server treats absence as unlimited)
}

/** Reddit gender scalar array (serializer takes FEMALE|MALE|null; multiple → all). */
export function redditGendersFor(gender) {
  if (gender === "women") return ["FEMALE"];
  if (gender === "men") return ["MALE"];
  return undefined; // All → omit
}

/** Snapchat demographics genders (SNAPCHAT_GENDERS = MALE|FEMALE). */
export function snapGendersFor(gender) {
  if (gender === "women") return ["FEMALE"];
  if (gender === "men") return ["MALE"];
  return undefined; // All → omit
}

// ── City chips → per-platform geo shapes ──────────────────────────────────────

/** Meta geo_locations.cities [{key, radius, distance_unit}] from the chips. */
export function metaCitiesFrom(cities, radius = DEFAULT_RADIUS_MI, distanceUnit = "mile") {
  if (!Array.isArray(cities)) return [];
  const r = clampRadius(radius, distanceUnit);
  return cities
    .filter((c) => c?.meta?.key)
    .map((c) => ({ key: String(c.meta.key), radius: r, distance_unit: distanceUnit }));
}

/** Google targeting.locations [{name, country_code}] — resolved by name at create. */
export function googleLocationsFrom(cities) {
  if (!Array.isArray(cities)) return [];
  return cities
    .filter((c) => c?.google?.name && c?.google?.country_code)
    .map((c) => ({ name: String(c.google.name), country_code: String(c.google.country_code) }));
}

/** TikTok location_ids (city) — flattened, deduped, numeric-string only. */
export function tiktokLocationIdsFrom(cities) {
  if (!Array.isArray(cities)) return [];
  const seen = new Set();
  const out = [];
  for (const c of cities) {
    for (const id of c?.tiktok?.location_ids ?? []) {
      const s = String(id);
      if (/^\d+$/.test(s) && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
  }
  return out;
}

// ── Interest chips → per-platform id/name lists ───────────────────────────────

function interestsForPlatform(interests, platform) {
  return Array.isArray(interests) ? interests.filter((i) => i?.platform === platform) : [];
}

export function metaInterestIdsFrom(interests) {
  return interestsForPlatform(interests, "meta").map((i) => String(i.id)).filter(Boolean);
}

export function tiktokInterestCategoryIdsFrom(interests) {
  return interestsForPlatform(interests, "tiktok")
    .map((i) => String(i.id))
    .filter((id) => /^\d+$/.test(id));
}

export function redditInterestNamesFrom(interests) {
  return interestsForPlatform(interests, "reddit")
    .map((i) => String(i.name ?? i.id).trim())
    .filter(Boolean);
}

// ── Snapchat demographics (age/gender — STRINGS; closes the silent drop) ───────

/**
 * One demographics entry from the wizard's age/gender. min_age is always a
 * digit STRING (GR-39); max_age is omitted at the 65 "and over" band (open top);
 * genders omitted for All. Returns null when nothing beyond the default is set,
 * so the server default ([{min_age:"18"}]) still applies.
 */
export function snapDemographicsFrom({ ageMin, ageMax, gender } = {}) {
  const entry = {};
  const min = Number(ageMin);
  if (Number.isInteger(min)) entry.min_age = String(min);
  const max = Number(ageMax);
  if (Number.isInteger(max) && max < 65) entry.max_age = String(max);
  const genders = snapGendersFor(gender);
  if (genders) entry.genders = genders;
  if (entry.min_age === undefined && entry.max_age === undefined && !entry.genders) return null;
  // min_age is mandatory on every entry — default to "18" if only gender/max set.
  if (entry.min_age === undefined) entry.min_age = "18";
  return [entry];
}
