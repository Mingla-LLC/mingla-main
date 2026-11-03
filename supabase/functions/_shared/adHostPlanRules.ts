/**
 * #4238 — Host ad plan rules checked by ad-plan before any money moves.
 * Pure: the caller reads the rows; this decides.
 */

export type CountryAvailabilityRow = {
  platform: string;
  country_code: string;
  status: "works" | "not_available" | string;
  reason?: string | null;
};

/**
 * The first selected app that runs in none of the chosen countries, or null.
 * A missing row means the app works there (staff have not marked it).
 */
export function appUnavailableInEveryCountry(
  platforms: readonly string[],
  countries: readonly string[],
  rows: readonly CountryAvailabilityRow[],
): string | null {
  const wanted = countries.map((code) => code.trim().toUpperCase());
  if (wanted.length === 0) return null;
  for (const platform of platforms) {
    const blocked = wanted.every((country) =>
      rows.some((row) =>
        row.platform === platform &&
        row.country_code.toUpperCase() === country &&
        row.status === "not_available"
      )
    );
    if (blocked) return platform;
  }
  return null;
}

/** Countries one app can't run in (for a plain per-app note). */
export function countriesAppCannotRunIn(
  platform: string,
  countries: readonly string[],
  rows: readonly CountryAvailabilityRow[],
): string[] {
  return countries.map((code) => code.trim().toUpperCase()).filter((country) =>
    rows.some((row) =>
      row.platform === platform &&
      row.country_code.toUpperCase() === country &&
      row.status === "not_available"
    )
  );
}
