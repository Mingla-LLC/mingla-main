/**
 * ORCH-1269 [claim-adoption phone country mis-defaults to GB] — map a
 * `place_pool.country` free-text value to an ISO 3166-1 alpha-2 phone-country
 * code for the claim wizard's c6 phone picker.
 *
 * Why: the ORCH-1263 adoption prefill copies `national_phone_number` but never
 * mapped the place's country, so a US venue's "(919) 377-0509" rendered under
 * the picker's GB default — a wrong-country flag presented next to adopted
 * truth, and a +44 mis-composition risk for any E.164 consumer.
 *
 * Truth table: `packages/phone-input/countries.ts` COUNTRIES (ISO 3166-1 +
 * ITU-T E.164, shared with buyer checkout per ORCH-0847) — imported relatively
 * so node-env jest resolves it without the Metro-only `@mingla/phone-input`
 * alias (same absolute file, so Metro dedupes with the alias imports). This
 * module adds NO new country table (one owner per truth) — only a small alias
 * layer for the variants proven present in prod `place_pool.country`
 * (read-only probe 2026-07-03: "USA", "UK", "Nigeria", "GB邮政编码: SW1P 2AF"
 * plus unmappable postal-suffix garbage).
 *
 * Unmappable input returns null — the caller leaves the picker on its existing
 * default rather than asserting a country we don't know (no fabrication).
 */

import { COUNTRIES } from "../../../packages/phone-input/countries";

/** Valid ISO alpha-2 codes, from the shared country directory. */
const ISO2_CODES: ReadonlySet<string> = new Set(COUNTRIES.map((c) => c.code));

/** UPPERCASED English display name → ISO alpha-2, from the shared directory. */
const NAME_TO_ISO2: ReadonlyMap<string, string> = new Map(
  COUNTRIES.map((c) => [c.name.toUpperCase(), c.code]),
);

/**
 * Tolerant aliases: ISO-3 codes + common name variants for the countries
 * present in `place_pool` data. Names already carried by COUNTRIES ("United
 * States", "United Kingdom", "Nigeria", …) are NOT repeated here.
 */
const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  // United States
  USA: "US",
  "U.S.": "US",
  "U.S.A.": "US",
  "UNITED STATES OF AMERICA": "US",
  AMERICA: "US",
  // United Kingdom
  UK: "GB",
  "U.K.": "GB",
  GBR: "GB",
  "GREAT BRITAIN": "GB",
  ENGLAND: "GB",
  SCOTLAND: "GB",
  WALES: "GB",
  "NORTHERN IRELAND": "GB",
  // Nigeria
  NGA: "NG",
};

/** Resolve one normalized (trimmed, UPPERCASED) token to ISO-2, or null. */
const resolveToken = (token: string): string | null => {
  const aliased = COUNTRY_ALIASES[token];
  if (aliased !== undefined) return aliased;
  if (token.length === 2 && ISO2_CODES.has(token)) return token;
  const byName = NAME_TO_ISO2.get(token);
  if (byName !== undefined) return byName;
  return null;
};

/**
 * Map a free-text place country to an ISO alpha-2 phone-country code.
 *
 * Matching order (all on the trimmed, uppercased input):
 *  1. Alias table (ISO-3 / common variants: "USA" → "US", "UK" → "GB", …).
 *  2. Exact ISO-2 code ("US", "GB", "NG", …).
 *  3. Exact English country name from the shared directory ("NIGERIA" → "NG").
 *  4. Leading 2–3 letter code followed by a non-letter — tolerates the seeded
 *     postal-suffix rows ("GB邮政编码: SW1P 2AF" → "GB"). Longer letter runs
 *     ("USSet…", "Staten Island…", "Level 0…") stay unmappable by design.
 *
 * @returns ISO alpha-2 code, or null when the input can't be mapped with
 * confidence (caller keeps the picker's existing default, chip-free).
 */
export function phoneCountryIsoFromPlaceCountry(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const up = raw.trim().toUpperCase();
  if (up.length === 0) return null;

  const exact = resolveToken(up);
  if (exact !== null) return exact;

  const leadingCode = /^([A-Z]{2,3})(?![A-Za-z])/.exec(up);
  if (leadingCode !== null) return resolveToken(leadingCode[1]);

  return null;
}
