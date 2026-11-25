/** Dependency-light snapshot selection for the eager Hub venue-card chunk. */
import type {
  VenueFeatureKey,
  VenueFeatureSet,
} from "../../types/venueFeatures";

export type VenueCardSnapshotKind =
  | "door"
  | "requests"
  | "stay"
  | "tables"
  | "setup";

const DOOR_FEATURES: readonly VenueFeatureKey[] = [
  "entry",
  "group_packages",
  "by_the_hour",
  "guest_list",
  "memberships",
];

const on = (
  features: VenueFeatureSet | null,
  key: VenueFeatureKey,
): boolean => features?.[key].enabled === true;

/**
 * Priority is deliberate: a Stay keeps its own reservations inbox; a venue
 * with a real door keeps the original door snapshot; private hire then beats
 * table reservations because requests are the action that can expire.
 */
export function venueCardSnapshotKind(
  features: VenueFeatureSet | null,
  venueCategory: string | null,
): VenueCardSnapshotKind {
  if (venueCategory === "stay" || on(features, "stays")) return "stay";
  if (DOOR_FEATURES.some((key) => on(features, key))) return "door";
  if (on(features, "private_hire")) return "requests";
  if (on(features, "table_reservations") || on(features, "waitlist")) {
    return "tables";
  }
  return "setup";
}
