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
      : // #4490 P2 — the server pauses live Entry offers when Entry goes off.
        key === "entry"
        ? " Your live Entry offers pause. Passes already bought stay valid; guests can't buy new ones."
        : // #4490 P6 — the server stops new joins; members carry on.
          key === "memberships"
          ? " Nobody new can join your plans and the Plans tab leaves your venue page. Current members keep their membership and their payment emails."
          : key === "group_packages" || key === "private_hire" || key === "by_the_hour"
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


// ---------------------------------------------------------------------------
// #4490 click-test D30 — every switch that changed, said out loud
// ---------------------------------------------------------------------------

/**
 * The features (other than the one the host flipped) whose on/off changed
 * between two reads. The server may switch a feature with no stored row
 * through the backfill rule (Waitlist follows Table reservations) without
 * listing it in `changed_keys`, so the row status compares states instead.
 */
export function otherChangedFeatures(
  before: Readonly<Record<VenueFeatureKey, { enabled: boolean }>> | null,
  after: Readonly<Record<VenueFeatureKey, { enabled: boolean }>>,
  flipped: VenueFeatureKey,
  serverChanged: readonly VenueFeatureKey[] = [],
): VenueFeatureKey[] {
  const out = new Set<VenueFeatureKey>(serverChanged.filter((k) => k !== flipped));
  if (before !== null) {
    for (const key of Object.keys(after) as VenueFeatureKey[]) {
      if (key === flipped) continue;
      if (before[key] !== undefined && before[key].enabled !== after[key].enabled) out.add(key);
    }
  }
  return [...out];
}

/** "Saved. Waitlist turned on too." / "Saved". */
export function featureSavedLine(
  after: Readonly<Record<VenueFeatureKey, { enabled: boolean }>>,
  others: readonly VenueFeatureKey[],
): string {
  if (others.length === 0) return "Saved";
  const on = others.filter((k) => after[k].enabled);
  const off = others.filter((k) => !after[k].enabled);
  const parts: string[] = [];
  if (on.length > 0) parts.push(`${joinFeatureLabels(on)} turned on too.`);
  if (off.length > 0) parts.push(`${joinFeatureLabels(off)} turned off too.`);
  return `Saved. ${parts.join(" ")}`;
}
