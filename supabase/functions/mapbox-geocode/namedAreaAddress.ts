/**
 * mapbox-geocode · namedAreaAddress — issue #3291.
 *
 * PURE: no Deno APIs and no remote imports. `index.ts` imports it for
 * `featureToDetails`, and the mingla-business jest suite imports it directly,
 * so the rule runs in a required CI lane.
 */

/**
 * Issue #3291 — the address used when a feature has NO `full_address`.
 *
 * Mapbox gives streets, cities and venues no `full_address`, and their
 * `place_formatted` is only the surrounding area ("Lagos 10, Lagos, Nigeria")
 * — it never repeats the feature's own name. Returning it alone saved an
 * address that had lost the street or city the host picked. Build
 * "<name>, <area>" instead, without doubling when the area already begins with
 * the name (compared on the leading comma-separated part, ignoring case and
 * spacing — a substring check would treat "Greater London" as "London").
 * Returns null when neither part is present so the caller's next fallback runs.
 * https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature
 */
export function namedAreaAddress(
  name: string | null | undefined,
  placeFormatted: string | null | undefined,
): string | null {
  const n = typeof name === "string" ? name.trim() : "";
  const area = typeof placeFormatted === "string" ? placeFormatted.trim() : "";
  if (n.length === 0) return area.length > 0 ? area : null;
  if (area.length === 0) return n;
  const normalise = (value: string): string =>
    value.replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim().toLowerCase();
  const normalisedName = normalise(n);
  const normalisedArea = normalise(area);
  if (
    normalisedArea === normalisedName ||
    normalisedArea.startsWith(`${normalisedName},`)
  ) {
    return area;
  }
  return `${n}, ${area}`;
}
