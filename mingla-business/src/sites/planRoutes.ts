/**
 * #2829 W9a — where each plan part's "Do it myself" goes (design contract
 * W9: native part screens; brand details reuse Brand edit, the first
 * offering reuses the existing creators, publishing the Website screen).
 */
import type { PlanPartKey } from "../../../packages/site-contracts/src/sitePlan.ts";
import type { SitePlanState } from "./sitePlanState";

export function planPartRoute(brandId: string, part: Exclude<PlanPartKey, "first_offering">): string {
  switch (part) {
    case "offer":
      return `/brand/${brandId}/website/plan?part=offer`;
    case "brand":
      return `/brand/${brandId}/edit`;
    case "look":
      return `/brand/${brandId}/website/design`;
    case "story":
      return `/brand/${brandId}/website/plan?part=story`;
    case "approve":
      return `/brand/${brandId}/website/plan?part=approve`;
    case "build":
      return `/brand/${brandId}/website/plan?part=build`;
    case "publish":
      return `/brand/${brandId}/website`;
    default: {
      const never: never = part;
      return never;
    }
  }
}

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
