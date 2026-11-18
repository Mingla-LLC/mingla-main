/**
 * #4490 P1-10 — what a feature switch asks before it acts (pure, unit-tested).
 */
import {
  FEATURE_COPY,
  joinFeatureLabels,
  type VenueFeatureKey,
} from "../../../types/venueFeatures";

/** The confirm copy for a switch (null = no confirm needed). Pure. */
export function featureSwitchConfirm(
  key: VenueFeatureKey,
  enable: boolean,
  cascade: readonly VenueFeatureKey[],
): { title: string; body: string; confirm: string } | null {
  const label = FEATURE_COPY[key].label;
  if (enable) {
    if (cascade.length === 0) return null;
    return {
      title: `Turn on ${label}?`,
      body: `${label} needs ${joinFeatureLabels(cascade)}, so ${cascade.length === 1 ? "it turns" : "they turn"} on too.`,
      confirm: cascade.length === 1 ? "Turn on both" : "Turn them all on",
    };
  }
  const bookings =
    key === "table_reservations" || cascade.includes("table_reservations")
      ? " Bookings already made stay valid; guests can't book new ones."
      : "";
  if (cascade.length === 0 && bookings.length === 0) return null;
  return {
    title: `Turn off ${label}?`,
    body:
      cascade.length > 0
        ? `${joinFeatureLabels(cascade)} ${cascade.length === 1 ? "needs" : "need"} ${label}, so ${cascade.length === 1 ? "it turns" : "they turn"} off too.${bookings}`
        : bookings.trim(),
    confirm: cascade.length > 0 ? "Turn them off" : `Turn off ${label}`,
  };
}

