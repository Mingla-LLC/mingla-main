/**
 * #4490 click-test D9 — the add-venue "Features" step (pure, unit-tested).
 *
 * Features, not venue types: the step shows the switches the chosen type
 * starts with ("Usual for <type> venues") and the other built ones ("More you
 * can switch on"). The type only decides which start on. Table ordering waits
 * for Mingla to approve the venue, so it is listed but cannot start on.
 */
import {
  SWITCHABLE_FEATURES,
  builtPreset,
  venueTypeOption,
  type VenueFeatureKey,
  type VenueTypeKey,
} from "../../../types/venueFeatures";

/** Switches a brand-new (not yet approved) venue can start with. */
export function canStartWith(key: VenueFeatureKey): boolean {
  return key !== "table_ordering";
}

/** What the type starts with (built, startable). */
export function typeStartingFeatures(category: VenueTypeKey | null): VenueFeatureKey[] {
  if (category === null) return [];
  return builtPreset(category).filter(canStartWith);
}

/** The step's two lists for a type. */
export function wizardFeatureRows(category: VenueTypeKey | null): {
  usual: VenueFeatureKey[];
  more: VenueFeatureKey[];
} {
  const preset = category === null ? [] : builtPreset(category);
  return {
    usual: SWITCHABLE_FEATURES.filter((k) => preset.includes(k)),
    more: SWITCHABLE_FEATURES.filter((k) => !preset.includes(k)),
  };
}

/** The switches as chosen: the host's own list, or the type's starting set. */
export function chosenStartingFeatures(
  category: VenueTypeKey | null,
  chosen: readonly VenueFeatureKey[] | null | undefined,
): VenueFeatureKey[] {
  const base = chosen ?? typeStartingFeatures(category);
  return SWITCHABLE_FEATURES.filter((k) => base.includes(k) && canStartWith(k));
}

/** Flip one switch; Table ordering never starts on. Pure. */
export function toggleStartingFeature(
  current: readonly VenueFeatureKey[],
  key: VenueFeatureKey,
  on: boolean,
): VenueFeatureKey[] {
  if (!canStartWith(key)) return [...current];
  const set = new Set(current);
  if (on) set.add(key);
  else set.delete(key);
  return SWITCHABLE_FEATURES.filter((k) => set.has(k));
}

/** "Usual for play and games venues". */
export function usualHeading(category: VenueTypeKey | null): string {
  const label = venueTypeOption(category)?.label;
  return label !== undefined ? `Usual for ${label.toLowerCase()} venues` : "Usual for venues like yours";
}
