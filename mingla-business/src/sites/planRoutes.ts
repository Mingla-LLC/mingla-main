/**
 * #2829 W9a / #2830 — the first offering is the one setup step that opens on
 * top of setup: it reuses the existing creators.
 */
import type { SitePlanState } from "./sitePlanState";

const CREATOR: ReadonlyArray<[kind: "trips" | "events" | "experiences", route: string]> = [
  ["trips", "/trip/create"],
  ["events", "/event/create"],
  ["experiences", "/experience/create"],
];

/**
 * The creator for the first ticked kind that has no public offering yet
 * (Core's live counts), else the first ticked kind; null when nothing that
 * has offerings was ticked (venue-only brands skip part 7).
 */
export function firstOfferingRoute(state: SitePlanState): string | null {
  const ticked = new Set(state.plan?.offeringsSelected ?? state.prefillOfferings ?? []);
  const candidates = CREATOR.filter(([kind]) => ticked.has(kind));
  const empty = candidates.find(([kind]) => state.liveCounts[kind] === 0);
  return (empty ?? candidates[0])?.[1] ?? null;
}
