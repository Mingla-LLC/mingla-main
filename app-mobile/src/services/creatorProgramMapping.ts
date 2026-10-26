/**
 * #3872 round 2 — pure mapping for the Creator profile step: the paid-ads
 * payload (always on) and the home-city picker on `creator_city_search` /
 * `creator_home_city_set`.
 *
 * Pure on purpose (no imports): the unit suite runs it under
 * `node --experimental-strip-types` exactly as it runs in the app.
 */

// ── Profile save ───────────────────────────────────────────────────────────

/** W2.1: paid-ads use is part of every Mingla gig. The app always sends true. */
export const PAID_ADS_NOTICE = 'Hosts can use your videos in their paid ads. This is part of every Mingla gig.';

export type ProfileSaveInput = {
  displayName: string; bio: string; homeCityId?: string | null; niches: string[]; languages: string[]; dateOfBirth?: string | null;
};

/** `creator_profile_save` params. `p_usage_ads_opt_in` is always true. */
export function profileSaveParams(input: ProfileSaveInput): Record<string, unknown> {
  return {
    p_display_name: input.displayName.trim(),
    p_bio: input.bio.trim(),
    p_home_city_id: input.homeCityId ?? null,
    p_niches: input.niches,
    p_languages: input.languages,
    p_date_of_birth: input.dateOfBirth ?? null,
    p_usage_ads_opt_in: true,
  };
}

// ── Home city ──────────────────────────────────────────────────────────────

/** One row the picker shows. `id` is null for a city Mingla doesn't know yet. */
export type CityOption = {
  key: string;
  id: string | null;
  name: string;
  region: string | null;
  countryCode: string;
  isLive: boolean;
};

/** The creator's saved home city (`home_city` on status / own profile). */
export type HomeCity = { id: string | null; name: string; isLive: boolean; countryCode?: string | null };

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** One `creator_city_search` row → a CityOption, or null when it has no name. */
export function cityOptionFromRow(row: unknown): CityOption | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;
  const name = text(r.name);
  if (!name) return null;
  const id = text(r.city_id);
  const countryCode = (text(r.country_code) ?? 'US').toUpperCase();
  const isLive = r.is_live === true && Boolean(id);
  return { key: id ?? `${name.toLowerCase()}|${countryCode}`, id, name, region: text(r.region), countryCode, isLive };
}

/** Rows → options: live cities first (by name), then the rest; no duplicates. */
export function cityOptions(rows: unknown): CityOption[] {
  const list = Array.isArray(rows) ? rows : [];
  const seen = new Set<string>();
  const options: CityOption[] = [];
  for (const row of list) {
    const option = cityOptionFromRow(row);
    if (!option || seen.has(option.key)) continue;
    seen.add(option.key);
    options.push(option);
  }
  const live = options.filter((o) => o.isLive).sort((a, b) => a.name.localeCompare(b.name));
  const rest = options.filter((o) => !o.isLive);
  return [...live, ...rest];
}

/** "Raleigh, NC · US" style second line; never a raw id. */
export function cityHint(option: CityOption): string {
  const place = [option.region, option.countryCode].filter(Boolean).join(' · ');
  return option.isLive ? (place ? `Live · ${place}` : 'Live') : place;
}

/** The notice under the field when the chosen city isn't live. */
export function notLiveNotice(cityName: string): string {
  return `Mingla isn’t live in ${cityName} yet. Hosts there can’t hire you until we launch; we’ll tell you when we do.`;
}

/** `creator_home_city_set` params for a chosen option. */
export function homeCitySetParams(option: Pick<CityOption, 'id' | 'name' | 'countryCode' | 'isLive'>): Record<string, unknown> {
  if (option.isLive && option.id) return { p_city_id: option.id, p_name: null, p_country_code: null };
  return { p_city_id: option.id ?? null, p_name: option.name.trim(), p_country_code: option.countryCode };
}

/** The live city id to pass to `creator_profile_save` (non-live cities are saved by `creator_home_city_set`). */
export function profileCityId(choice: Pick<HomeCity, 'id' | 'isLive'> | null | undefined): string | null {
  return choice?.isLive && choice.id ? choice.id : null;
}

/** `home_city` from status / profile / `creator_home_city_set` → HomeCity, or null. */
export function homeCityFrom(value: unknown): HomeCity | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const name = text(v.name);
  if (!name) return null;
  return { id: text(v.id), name, isLive: v.is_live === true, countryCode: text(v.country_code) };
}

/** A chosen option → the HomeCity shape the screen keeps. */
export function homeCityFromOption(option: CityOption): HomeCity {
  return { id: option.id, name: option.name, isLive: option.isLive, countryCode: option.countryCode };
}

/** `creator_home_city_set` answer → the saved HomeCity (throws handled by the transport). */
export function homeCityFromSetResult(result: unknown): HomeCity | null {
  if (typeof result !== 'object' || result === null) return null;
  return homeCityFrom((result as { home_city?: unknown }).home_city);
}
