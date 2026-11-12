/**
 * #4389 Door mode — the one way into the door sale (/event/[id]/door/sell).
 *
 * With an event it goes straight in. Without one it looks at the brand's events
 * (the cached business list, fetched if missing): none live or on today returns
 * "none" so the caller can say so; one goes straight in; two or more open the
 * soonest with "Which event?" first (?pick=1), so the host picks before selling.
 *
 * Used by Event › Door "Sell at door" and, later, Home's Take a payment pill.
 */
import { queryClient } from "../config/queryClient";
import { businessEventKeys } from "../hooks/useBusinessEvents";
import { fetchBusinessEventsForBrand } from "../services/businessEvents";
import { doorSaleCandidates } from "../components/door/doorModeState";

export type OpenDoorSaleResult = "opened" | "picker" | "none";

interface RouterLike {
  push: (href: never) => void;
}

/** The door sale route for an event (query values are encoded). */
export const doorSaleHref = (
  eventId: string,
  options: { pick?: boolean; source?: string | null; draft?: string | null } = {},
): string => {
  const query: string[] = [];
  if (options.pick === true) query.push("pick=1");
  if (options.source) query.push(`source=${encodeURIComponent(options.source)}`);
  if (options.draft) query.push(`draft=${encodeURIComponent(options.draft)}`);
  return `/event/${eventId}/door/sell${query.length > 0 ? `?${query.join("&")}` : ""}`;
};

export const openDoorSale = async (
  router: RouterLike,
  brandId: string | null,
  eventId?: string | null,
  options: { source?: string } = {},
): Promise<OpenDoorSaleResult> => {
  const source = options.source ?? null;
  if (typeof eventId === "string" && eventId.length > 0) {
    // orch-strict-grep-allow route-by-event-type — the door sale route exists only under /event/[id]/door.
    router.push(doorSaleHref(eventId, { source }) as never);
    return "opened";
  }
  if (brandId === null) return "none";
  const events = await queryClient.fetchQuery({
    queryKey: businessEventKeys.list(brandId),
    queryFn: () => fetchBusinessEventsForBrand(brandId),
    staleTime: 30_000,
  });
  const candidates = doorSaleCandidates(events, Date.now());
  if (candidates.length === 0) return "none";
  const pick = candidates.length > 1;
  // orch-strict-grep-allow route-by-event-type — the door sale route exists only under /event/[id]/door.
  router.push(doorSaleHref(candidates[0].eventId, { pick, source }) as never);
  return pick ? "picker" : "opened";
};

/**
 * #4389 — is there an event to sell for now (live or on today)? Same list and
 * rule as openDoorSale, so a "Take a payment" button shows only when it opens one.
 */
export const hasDoorSaleEvent = async (brandId: string): Promise<boolean> => {
  const events = await queryClient.fetchQuery({
    queryKey: businessEventKeys.list(brandId),
    queryFn: () => fetchBusinessEventsForBrand(brandId),
    staleTime: 30_000,
  });
  return doorSaleCandidates(events, Date.now()).length > 0;
};
