/**
 * #4490 — venue features (pure types and data; no React, no RN, no services).
 *
 * Features, not venue types: every capability a venue offers is a FEATURE the
 * host switches on. `venue_category` is a label and a starting preset only.
 * The server is the authority (`issue_4490_get_venue_features`,
 * `issue_4490_set_venue_feature`); this file mirrors its constants so the
 * client can explain dependencies before it asks the server to act.
 */

import { VENUE_TYPE_LABELS } from "@mingla/brand-rendering/venueTypeLabels";

export type VenueFeatureKey =
  | "entry"
  | "group_packages"
  | "private_hire"
  | "by_the_hour"
  | "table_reservations"
  | "floor_plan"
  | "pick_a_table"
  | "menu"
  | "table_ordering"
  | "min_spend_tables"
  | "guest_list"
  | "memberships"
  | "stays"
  | "events_here"
  | "waitlist"
  // #4490 spec 08 O1 — sell in person (the Till) and, in O3, the station screens.
  | "till"
  | "kitchen_screens";

/** The seventeen keys in the contract's order (`issue_4490_feature_keys`). */
export const VENUE_FEATURE_KEYS: readonly VenueFeatureKey[] = [
  "entry",
  "group_packages",
  "private_hire",
  "by_the_hour",
  "table_reservations",
  "floor_plan",
  "pick_a_table",
  "menu",
  "table_ordering",
  "min_spend_tables",
  "guest_list",
  "memberships",
  "stays",
  "events_here",
  "waitlist",
  "till",
  "kitchen_screens",
];

export interface VenueFeature {
  key: VenueFeatureKey;
  enabled: boolean;
  /** null = the whole venue; otherwise only these spaces. */
  spaceIds: string[] | null;
  settings: Record<string, unknown>;
  /** Server row version (0 = no stored row yet, read from the backfill rule). */
  version: number;
  /** What still stands in the way of switching it on (parent keys or "space"). */
  blockedBy: string[];
  /**
   * #4490 fix1 (backend B2): what it still needs before guests can use it
   * ("space", "table"), on or off. A space-needing feature may now be on
   * before the first space exists. Absent on older reads.
   */
  needs?: string[];
}

/** Total: a missing row reads as disabled. */
export type VenueFeatureSet = Readonly<Record<VenueFeatureKey, VenueFeature>>;

export interface VenueFeatureState {
  venueId: string;
  brandId: string;
  venueCategory: string | null;
  version: number;
  activeSpaceCount: number;
  features: VenueFeatureSet;
  flags: { reads: boolean; writes: boolean };
}

/**
 * Features whose host and guest surfaces have shipped (mirror of
 * `issue_4490_built_features()`; reconciliation conflict 36). A switch, module
 * or offer kind appears only when its phase has shipped. `stays` is managed by
 * the Stay workspace and never switched here.
 */
export const BUILT_FEATURES: ReadonlySet<VenueFeatureKey> = new Set<VenueFeatureKey>([
  // P2: Entry (offers, passes, check-in, Today).
  "entry",
  // P3: group packages; P4: private hire (requests, calendar).
  "group_packages",
  "private_hire",
  // P5: by the hour, the floor plan, pick a table, minimum-spend tables.
  "by_the_hour",
  "table_reservations",
  "floor_plan",
  "pick_a_table",
  "min_spend_tables",
  "waitlist",
  "menu",
  "table_ordering",
  "events_here",
  // 07 I: host list, promoter link and door admission.
  "guest_list",
  // P6: memberships (monthly plans, members, member check-in).
  "memberships",
  "stays",
  // 08 O1: the Till (switchable only behind its release flag, see below).
  "till",
  // 08 O3: kitchen and bar screens (same release flag).
  "kitchen_screens",
]);

/**
 * #4490 spec 08 O1 — switched on only once its release flag (`VENUE_TILL`) is
 * on, so no host turns on a Till that devices cannot run yet. O3: the kitchen
 * and bar screens (`kitchen_screens`) sit behind the same flag.
 */
export const RELEASE_GATED_FEATURES: readonly VenueFeatureKey[] = ["till", "kitchen_screens"];

/** Features a host can switch in Settings in this build. */
export const SWITCHABLE_FEATURES: readonly VenueFeatureKey[] = VENUE_FEATURE_KEYS.filter(
  (key) => BUILT_FEATURES.has(key) && key !== "stays" && !RELEASE_GATED_FEATURES.includes(key),
);

/** Direct parents (mirror of `issue_4490_feature_parents`). */
export const FEATURE_PARENTS: Readonly<Record<VenueFeatureKey, readonly VenueFeatureKey[]>> = {
  entry: [],
  group_packages: [],
  private_hire: [],
  by_the_hour: [],
  table_reservations: [],
  floor_plan: ["table_reservations"],
  pick_a_table: ["floor_plan"],
  menu: [],
  table_ordering: ["menu"],
  min_spend_tables: ["table_reservations"],
  guest_list: [],
  memberships: [],
  stays: [],
  events_here: [],
  waitlist: [],
  till: [],
  kitchen_screens: ["menu"],
};

/** Every feature `key` needs, nearest parent last (roots first). */
export function featureAncestors(key: VenueFeatureKey): VenueFeatureKey[] {
  const out: VenueFeatureKey[] = [];
  const walk = (k: VenueFeatureKey): void => {
    for (const parent of FEATURE_PARENTS[k]) {
      walk(parent);
      if (!out.includes(parent)) out.push(parent);
    }
  };
  walk(key);
  return out;
}

/** Every feature that (transitively) needs `key`. */
export function featureDependents(key: VenueFeatureKey): VenueFeatureKey[] {
  const out: VenueFeatureKey[] = [];
  const visit = (k: VenueFeatureKey): void => {
    for (const candidate of VENUE_FEATURE_KEYS) {
      if (FEATURE_PARENTS[candidate].includes(k) && !out.includes(candidate)) {
        out.push(candidate);
        visit(candidate);
      }
    }
  };
  visit(key);
  return VENUE_FEATURE_KEYS.filter((k) => out.includes(k));
}

/**
 * What else changes when a host flips one switch (the cascade the server will
 * apply with `p_cascade = true`). Turning on adds missing parents; turning off
 * removes enabled dependents. The host confirms this list before one call.
 */
export function featureCascade(
  features: VenueFeatureSet,
  key: VenueFeatureKey,
  enable: boolean,
): VenueFeatureKey[] {
  if (enable) {
    return featureAncestors(key).filter((parent) => !features[parent].enabled);
  }
  return featureDependents(key).filter((child) => features[child].enabled);
}

/** Human words for each feature (host copy; "Features", never "modules"). */
export const FEATURE_COPY: Readonly<Record<VenueFeatureKey, { label: string; summary: string }>> = {
  entry: { label: "Entry", summary: "Walk-in, day passes, timed sessions" },
  group_packages: { label: "Group packages", summary: "Per-guest deals with extras" },
  private_hire: { label: "Private hire", summary: "Whole spaces, by request" },
  by_the_hour: { label: "By the hour", summary: "Rooms, courts, lanes, tables, desks" },
  table_reservations: { label: "Table reservations", summary: "Tables, turn times and bookings" },
  floor_plan: { label: "Floor plan", summary: "Tables drawn where they are" },
  pick_a_table: { label: "Pick a table", summary: "Guests choose their own table" },
  menu: { label: "Menu", summary: "Your menu, online" },
  table_ordering: { label: "Table ordering", summary: "Guests order from their table by QR" },
  min_spend_tables: { label: "Minimum-spend tables", summary: "Bottle service, VIP sections" },
  guest_list: { label: "Guest list", summary: "Names on the gate" },
  memberships: { label: "Memberships", summary: "Monthly plans and credits" },
  stays: { label: "Stays", summary: "Rooms by the night" },
  events_here: { label: "Events here", summary: "Your events and experiences show on this venue's page" },
  waitlist: { label: "Waitlist", summary: "Quote waits and seat walk-ins" },
  till: { label: "Sell in person", summary: "Sell anything you offer from one screen" },
  kitchen_screens: { label: "Kitchen and bar screens", summary: "Each station gets its own screen" },
};

export function featureLabel(key: VenueFeatureKey): string {
  return FEATURE_COPY[key].label;
}

/** "Menu", "Menu and Table ordering", "Menu, Waitlist and Table ordering". */
export function joinFeatureLabels(keys: readonly VenueFeatureKey[]): string {
  const labels = keys.map(featureLabel);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** The nine venue types (`venue_listings.venue_category`). */
export type VenueTypeKey =
  | "restaurant"
  | "play"
  | "creative_and_arts"
  | "stay"
  | "bar_lounge"
  | "club"
  | "cafe"
  | "event_space"
  | "coworking";

export interface VenueTypeOption {
  key: VenueTypeKey;
  label: string;
  description: string;
  /**
   * Starting switches only (the add-venue Features step and "Change type"
   * offer these; nothing is ever switched off by a type). P6: every feature is
   * built, so each type now starts with what venues of that kind usually sell
   * (spec 04 §4 data sheets). The server's `issue_4490_feature_preset` is only
   * the fallback when a create sends no list; see the P6 UI report.
   */
  preset: readonly VenueFeatureKey[];
}

// #4490 Explorer W6: labels come from the shared owner (same words in Discover and the deck).
export const VENUE_TYPES: readonly VenueTypeOption[] = [
  {
    key: "restaurant",
    label: VENUE_TYPE_LABELS.restaurant,
    description: "Food and drink, tables by time",
    preset: ["table_reservations", "waitlist", "menu", "table_ordering"],
  },
  {
    key: "play",
    label: VENUE_TYPE_LABELS.play,
    description: "Games, activities and family fun",
    preset: ["entry", "group_packages", "private_hire", "menu", "table_ordering", "events_here"],
  },
  {
    key: "bar_lounge",
    label: VENUE_TYPE_LABELS.bar_lounge,
    description: "Drinks, tables and nights out",
    preset: ["table_reservations", "min_spend_tables", "private_hire", "menu", "table_ordering", "events_here"],
  },
  {
    key: "club",
    label: VENUE_TYPE_LABELS.club,
    description: "Entry, tables and big nights",
    preset: ["entry", "table_reservations", "min_spend_tables", "menu", "table_ordering", "events_here"],
  },
  {
    key: "cafe",
    label: VENUE_TYPE_LABELS.cafe,
    description: "Coffee, food, day passes and a room to book",
    preset: ["entry", "by_the_hour", "menu", "table_ordering", "events_here"],
  },
  {
    key: "coworking",
    label: VENUE_TYPE_LABELS.coworking,
    description: "Desks, rooms and day passes",
    preset: ["entry", "by_the_hour", "private_hire", "memberships"],
  },
  {
    key: "event_space",
    label: VENUE_TYPE_LABELS.event_space,
    description: "Halls, gardens and rooms to hire",
    preset: ["private_hire", "events_here"],
  },
  {
    key: "creative_and_arts",
    label: VENUE_TYPE_LABELS.creative_and_arts,
    description: "Studios, galleries and performance",
    preset: ["entry", "by_the_hour", "private_hire", "memberships", "events_here"],
  },
  {
    key: "stay",
    label: VENUE_TYPE_LABELS.stay,
    description: "Hotels, resorts and short stays",
    preset: ["stays"],
  },
];

export function venueTypeOption(key: string | null | undefined): VenueTypeOption | null {
  return VENUE_TYPES.find((option) => option.key === key) ?? null;
}

/** What a type's preset can switch on in this build (built, not stays). */
export function builtPreset(key: VenueTypeKey): VenueFeatureKey[] {
  const option = venueTypeOption(key);
  if (option === null) return [];
  return option.preset.filter((feature) => BUILT_FEATURES.has(feature) && feature !== "stays");
}

function emptyFeature(key: VenueFeatureKey): VenueFeature {
  return { key, enabled: false, spaceIds: null, settings: {}, version: 0, blockedBy: [] };
}

/** Build a total set from partial rows (a missing row = disabled). */
export function featureSetFrom(
  rows: readonly Partial<VenueFeature>[] | Partial<Record<VenueFeatureKey, boolean>>,
): VenueFeatureSet {
  const out = {} as Record<VenueFeatureKey, VenueFeature>;
  for (const key of VENUE_FEATURE_KEYS) out[key] = emptyFeature(key);
  if (Array.isArray(rows)) {
    for (const row of rows as readonly Partial<VenueFeature>[]) {
      const key = row.key;
      if (key === undefined || !VENUE_FEATURE_KEYS.includes(key)) continue;
      out[key] = { ...out[key], ...row, key };
    }
  } else {
    for (const key of VENUE_FEATURE_KEYS) {
      const value = (rows as Partial<Record<VenueFeatureKey, boolean>>)[key];
      if (value === true) out[key] = { ...out[key], enabled: true };
    }
  }
  return out;
}

/**
 * The server backfill rule for a venue that has not touched features
 * (spec 02 §2.3; `issue_4490_venue_feature_rows`): menu on for non-stay
 * venues, table reservations and waitlist equal to the old reservations
 * switch, table ordering equal to the old ordering switch.
 */
export function backfilledFeatureSet(input: {
  reservationsEnabled: boolean;
  orderingEnabled?: boolean;
  isStay?: boolean;
}): VenueFeatureSet {
  return featureSetFrom({
    table_reservations: input.reservationsEnabled,
    waitlist: input.reservationsEnabled,
    menu: input.isStay !== true,
    table_ordering: input.orderingEnabled === true,
    stays: input.isStay === true,
  });
}

/** #4490 E2 — "Entry · Menu · Events here" from the venue's switched-on, shipped features. */
export function featureLine(enabled: ReadonlySet<string>): string | null {
  const keys = VENUE_FEATURE_KEYS.filter((k) => enabled.has(k) && BUILT_FEATURES.has(k) && k !== "stays");
  if (keys.length === 0) return null;
  return keys.map(featureLabel).join(" · ");
}

