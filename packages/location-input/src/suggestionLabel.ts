/**
 * @mingla/location-input · suggestionLabel
 *
 * Issue #3291 — the address a host SAVES must contain the name they tapped.
 *
 * A suggestion row shows a bold name ("Ozumba Mbadiwe Avenue") over a grey
 * line. Mapbox fills the grey line from `full_address` when the feature has one
 * and `place_formatted` otherwise. `place_formatted` is only the SURROUNDING
 * AREA ("Lagos 10, Lagos, Nigeria") and never repeats the name, and streets,
 * cities and venues have no `full_address`. Saving the grey line (#1407) dropped
 * the street/city name for every such pick; house-number rows looked fine only
 * because their `full_address` already starts with the name.
 *
 * One owner for the rule, used for the pending pill, the saved label and the
 * row's accessibility label:
 *   - grey line already begins with the name → the grey line (no doubling)
 *   - otherwise                              → "<name>, <grey line>"
 *   - after retrieve, the looked-up full address wins ONLY when it begins with
 *     the name.
 *
 * "Begins with" compares the address's leading comma-separated part to the
 * name, ignoring case and spacing. A substring check is deliberately NOT used:
 * "Greater London, England" contains "London" without being London.
 */

export interface SuggestionLabelSource {
  displayName: string;
  fullAddress: string;
}

const normalise = (value: string): string =>
  value.replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim().toLowerCase();

/** True when `address` leads with `name` as its first comma-separated part. */
export function addressBeginsWithName(address: string, name: string): boolean {
  const n = normalise(name);
  if (n.length === 0) return false;
  const a = normalise(address);
  return a === n || a.startsWith(`${n},`);
}

/** The row's label: always carries the name, never repeats it. */
export function composeSuggestionLabel(s: SuggestionLabelSource): string {
  const name = (s.displayName ?? "").trim();
  const secondary = (s.fullAddress ?? "").trim();
  if (name.length === 0) return secondary;
  if (secondary.length === 0) return name;
  if (addressBeginsWithName(secondary, name)) return secondary;
  return `${name}, ${secondary}`;
}

/**
 * The label saved after retrieve. The looked-up full address is more complete
 * than the row, so it wins — but only when it still carries the tapped name.
 */
export function resolvePickedLabel(
  s: SuggestionLabelSource,
  retrievedAddress: string | null | undefined,
): string {
  const retrieved = (retrievedAddress ?? "").trim();
  const name = (s.displayName ?? "").trim();
  if (
    retrieved.length > 0 &&
    (name.length === 0 || addressBeginsWithName(retrieved, name))
  ) {
    return retrieved;
  }
  return composeSuggestionLabel(s);
}
