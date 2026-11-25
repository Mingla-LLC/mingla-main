/**
 * #4490 N17 / N20 / N61 — what a venue's switched-on features still need, in
 * plain words, and the checklist lines that follow the venue's features
 * instead of assuming Entry (pure, unit-tested).
 *
 * Two sources say a chosen feature is not ready:
 *  - the add-venue refusals (`StartingFeaturesRefusal`): the server would not
 *    switch it on (Private hire and Floor plan need a space; Pick a table
 *    needs Floor plan);
 *  - the features read: a feature that is on but `blockedBy` still lists what
 *    stands in the way ("space" or a parent key). The backend fix for N20
 *    stores a requested feature on and reports this, so both shapes read the
 *    same here.
 */
import {
  FEATURE_PARENTS,
  featureLabel,
  joinFeatureLabels,
  type VenueFeatureKey,
  type VenueFeatureSet,
} from "../../../types/venueFeatures";

export type SetupTarget = "spaces" | "tables" | "settings" | "offers";

export interface FeatureSetupNeed {
  key: VenueFeatureKey;
  /** "Private hire needs a space first: add one, then switch it on." */
  text: string;
  /** Null = nothing for the host to do yet (e.g. waits for Mingla). */
  buttonLabel: string | null;
  target: SetupTarget | null;
}

export interface SetupRefusal {
  key: VenueFeatureKey;
  code: string;
  detail: string | null;
}

/** Mirror of `issue_4490_feature_needs_space`. */
export const FEATURES_NEEDING_SPACE: readonly VenueFeatureKey[] = ["private_hire", "floor_plan"];

function isFeatureKey(value: string): value is VenueFeatureKey {
  return Object.prototype.hasOwnProperty.call(FEATURE_PARENTS, value);
}

/** True when `key`, or a feature it needs, waits for a space. */
function waitsForSpace(key: VenueFeatureKey, seen: Set<VenueFeatureKey> = new Set()): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  if (FEATURES_NEEDING_SPACE.includes(key)) return true;
  return FEATURE_PARENTS[key].some((parent) => waitsForSpace(parent, seen));
}

function needFor(key: VenueFeatureKey, isOn: boolean, blockers: readonly string[], spaceCount: number): FeatureSetupNeed {
  const label = featureLabel(key);
  const parents = blockers.filter(isFeatureKey);
  const spaceBlocked = blockers.includes("space") || (spaceCount === 0 && waitsForSpace(key));
  if (spaceBlocked) {
    return {
      key,
      text: isOn
        ? `${label} needs a space before guests can book it.`
        : parents.length > 0
          ? `${label} needs ${joinFeatureLabels(parents)}, and that needs a space: add one, then switch them on.`
          : `${label} needs a space first: add one, then switch it on.`,
      buttonLabel: "Add a space",
      target: "spaces",
    };
  }
  return {
    key,
    text:
      parents.length > 0
        ? `${label} needs ${joinFeatureLabels(parents)} switched on first.`
        : `${label} wasn't switched on. Try it again in Features.`,
    buttonLabel: "Open features",
    target: "settings",
  };
}

/**
 * Each chosen feature that still needs setting up, once, in feature order.
 * `refused` are the add-venue refusals; `features` the current read.
 */
export function featureSetupNeeds(input: {
  features: VenueFeatureSet | null;
  activeSpaceCount: number;
  refused?: readonly SetupRefusal[] | null;
}): FeatureSetupNeed[] {
  const out = new Map<VenueFeatureKey, FeatureSetupNeed>();
  const features = input.features;
  for (const r of input.refused ?? []) {
    // Switched on since (a space was added and the host switched it on).
    if (features !== null && features[r.key].enabled && features[r.key].blockedBy.length === 0) continue;
    if (r.code === "venue_not_orderable") {
      out.set(r.key, {
        key: r.key,
        text: `${featureLabel(r.key)} starts after Mingla checks your venue.`,
        buttonLabel: null,
        target: null,
      });
      continue;
    }
    const blockers =
      r.code === "feature_requires" && r.detail !== null ? r.detail.split(",").map((x) => x.trim()) : [];
    out.set(r.key, needFor(r.key, false, blockers, input.activeSpaceCount));
  }
  if (features !== null) {
    for (const f of Object.values(features)) {
      if (!f.enabled || out.has(f.key)) continue;
      // Backend fix1: `needs` says what an on feature still waits for.
      const needs = f.needs ?? [];
      if (needs.includes("space")) {
        out.set(f.key, needFor(f.key, true, ["space"], input.activeSpaceCount));
        continue;
      }
      if (needs.includes("table")) {
        out.set(f.key, {
          key: f.key,
          text: `${featureLabel(f.key)}: add your tables so guests can book them.`,
          buttonLabel: "Add tables",
          target: "tables",
        });
        continue;
      }
      if (f.blockedBy.length === 0) continue;
      out.set(f.key, needFor(f.key, true, f.blockedBy, input.activeSpaceCount));
    }
  }
  const order = Object.keys(FEATURE_PARENTS) as VenueFeatureKey[];
  return order.filter((k) => out.has(k)).map((k) => out.get(k) as FeatureSetupNeed);
}

/** Features sold from Offers, in the order a host reads them. */
const SELLING: readonly VenueFeatureKey[] = [
  "entry",
  "group_packages",
  "private_hire",
  "by_the_hour",
  "memberships",
];

const SELL_WORDS: Readonly<Partial<Record<VenueFeatureKey, string>>> = {
  entry: "Entry, with a price for each kind of guest",
  group_packages: "a group package",
  private_hire: "private hire for a space",
  by_the_hour: "a room or table by the hour",
  memberships: "a membership plan",
};

/** "Add what you sell" line for this venue's switched-on features. */
export function sellStepMeta(features: VenueFeatureSet): string {
  const on = SELLING.filter((k) => features[k].enabled);
  if (on.length === 0) return "Switch on what you sell in Settings, then add it here";
  // #4490 fix 2: a single line starts with a capital too ("Private hire for a space").
  if (on.length === 1) return (SELL_WORDS[on[0]] ?? featureLabel(on[0])).replace(/^./, (c) => c.toUpperCase());
  const words = on.map((k) => SELL_WORDS[k] ?? featureLabel(k)).map((w) => w.replace(/, with a price for each kind of guest$/, ""));
  return `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`.replace(/^./, (c) => c.toUpperCase());
}

/** Whether spaces are required (a switched-on feature cannot work without one). */
export function spacesRequired(features: VenueFeatureSet): boolean {
  return FEATURES_NEEDING_SPACE.some((k) => features[k].enabled) || features.by_the_hour.enabled;
}

/** "Add your spaces" line for this venue's switched-on features. */
export function spacesStepMeta(features: VenueFeatureSet, activeSpaceCount: number): string {
  if (activeSpaceCount > 0) return `${activeSpaceCount} ${activeSpaceCount === 1 ? "space" : "spaces"}`;
  const needing = (["private_hire", "by_the_hour", "floor_plan"] as const).filter((k) => features[k].enabled);
  if (needing.length > 0) return `Needed for ${joinFeatureLabels(needing)}. The rooms and areas guests use`;
  const using = (["group_packages", "events_here"] as const).filter((k) => features[k].enabled);
  if (using.length > 0) return `Optional. ${joinFeatureLabels(using)} can say which room guests use`;
  if (features.entry.enabled) return "Optional for Entry. The areas guests use";
  return "The rooms and areas guests use";
}
