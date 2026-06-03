/**
 * offeringKind — META-ORCH-1059 [experiences-business-parity] Pass 1.
 *
 * The per-kind config object that lets the shared offering primitives
 * (OfferingListCard, OfferingManageSheet) "see through the right lens" for
 * events vs trips vs experiences. Events already have the best version of each
 * surface; rather than fork the UI three ways, the shared primitives read this
 * config for the labels, nouns, and route shapes that differ per kind.
 *
 * Architecture principle: generalize the EVENT components into shared,
 * kind-configurable primitives. NO hardcoded "event"/"attendees" strings in the
 * shared components — every kind-specific word comes from here.
 */

export type OfferingKind = "event" | "trip" | "experience";

export interface OfferingKindConfig {
  kind: OfferingKind;
  /** Singular noun for the offering itself ("event" / "trip" / "experience"). */
  noun: string;
  /** Singular form of the per-kind headcount metric ("attendee" / "traveler" / "spot"). */
  metricSingular: string;
  /** Plural form of the per-kind headcount metric ("attendees" / "travelers" / "spots"). */
  metricPlural: string;
  /** Title shown at the top of the manage sheet ("Manage event", etc.). */
  manageSheetTitle: string;
  /** Public-page route prefix: `/e` (events), `/t` (trips), `/exp` (experiences). */
  publicPathPrefix: string;
  /** Dashboard/edit route segment: `event` / `trip` / `experience`. */
  routeSegment: string;
}

const EVENT_CONFIG: OfferingKindConfig = {
  kind: "event",
  noun: "event",
  metricSingular: "attendee",
  metricPlural: "attendees",
  manageSheetTitle: "Manage event",
  publicPathPrefix: "/e",
  routeSegment: "event",
};

const TRIP_CONFIG: OfferingKindConfig = {
  kind: "trip",
  noun: "trip",
  metricSingular: "traveler",
  metricPlural: "travelers",
  manageSheetTitle: "Trip options",
  publicPathPrefix: "/t",
  routeSegment: "trip",
};

const EXPERIENCE_CONFIG: OfferingKindConfig = {
  kind: "experience",
  noun: "experience",
  metricSingular: "spot",
  metricPlural: "spots",
  manageSheetTitle: "Experience options",
  publicPathPrefix: "/exp",
  routeSegment: "experience",
};

const CONFIG_BY_KIND: Record<OfferingKind, OfferingKindConfig> = {
  event: EVENT_CONFIG,
  trip: TRIP_CONFIG,
  experience: EXPERIENCE_CONFIG,
};

export function offeringKindConfig(kind: OfferingKind): OfferingKindConfig {
  return CONFIG_BY_KIND[kind];
}

/**
 * Format the per-kind headcount metric label, e.g. `1 traveler` / `3 spots sold`.
 * Experiences read as "N spots sold"; events/trips as "N attendees"/"N travelers".
 */
export function formatOfferingMetric(
  kind: OfferingKind,
  count: number,
): string {
  const cfg = offeringKindConfig(kind);
  const noun = count === 1 ? cfg.metricSingular : cfg.metricPlural;
  // Experiences: "spots sold" reads more naturally for capacity-based offerings.
  if (kind === "experience") {
    return `${count} ${noun} sold`;
  }
  return `${count} ${noun}`;
}
