// ORCH-1220 [Explorer form: "All of it" = select-all] — pure interest reducer.
//
// Extracted from get-the-app-modal.tsx so the SELECT-ALL contract is unit-
// testable WITHOUT React (the .tsx pulls framer-motion/React at module load).
// The modal imports these and the chip handler delegates to `nextInterest`.
//
// "All of it" is a SELECT-ALL control, NOT an independent toggle:
//   - Tapping it while NOT everything is selected → selects ALL 5 values.
//   - Tapping it while everything IS selected      → clears everything.
//   - Tapping a specific pill toggles just that pill, then 'all' is recomputed:
//     present iff EVERY specific pill is selected (so individually picking all
//     of them auto-reflects "All of it"; deselecting any one removes 'all').

/** The select-all sentinel value (also a stored enum value when active). */
export const ALL_VALUE = 'all'

/** The interest enum order (must match the modal's INTERESTS chip order). */
export const INTEREST_VALUES: ReadonlyArray<string> = [
  'places',
  'events',
  'trips',
  'experiences',
  ALL_VALUE,
]

/** The specific interest pills — everything except the select-all chip. */
export const SPECIFIC_INTERESTS: ReadonlyArray<string> = INTEREST_VALUES.filter(
  (v) => v !== ALL_VALUE,
)

/** Selected-everything set: every specific pill PLUS 'all'. */
export const ALL_SELECTED: ReadonlyArray<string> = [
  ...SPECIFIC_INTERESTS,
  ALL_VALUE,
]

/** True when every specific interest pill is present in `selected`. */
export function allSpecificSelected(selected: ReadonlyArray<string>): boolean {
  return SPECIFIC_INTERESTS.every((v) => selected.includes(v))
}

/**
 * Toggle one interest chip with SELECT-ALL semantics. Pure → unit-testable.
 * Returns the next interest array (specific values in INTEREST_VALUES order,
 * with 'all' appended iff every specific pill is selected).
 */
export function nextInterest(
  prev: ReadonlyArray<string>,
  value: string,
): string[] {
  if (value === ALL_VALUE) {
    // Toggle the whole set: all → clear, anything-less → all.
    return allSpecificSelected(prev) ? [] : [...ALL_SELECTED]
  }

  // Specific pill: toggle it among the specific pills, then derive 'all'.
  const specifics = new Set(prev.filter((v) => v !== ALL_VALUE))
  if (specifics.has(value)) specifics.delete(value)
  else specifics.add(value)

  // Preserve INTEREST_VALUES order for a stable, predictable array.
  const ordered = SPECIFIC_INTERESTS.filter((v) => specifics.has(v))
  return SPECIFIC_INTERESTS.every((v) => specifics.has(v))
    ? [...ordered, ALL_VALUE]
    : ordered
}
