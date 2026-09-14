/**
 * issue #3313 — capacity is PER NIGHT on a recurring event (Seth, 2026-09-14).
 *
 * A recurring event's ticket capacity (for example 60) belongs to EACH night,
 * not to the whole run. The server enforces that at checkout from
 * `issue_3313_ticket_type_occurrence_taken`; this module is the organiser-side
 * twin of its SOLD half, computed from the orders the organiser already loads.
 *
 * The counting rule is the server's, exactly:
 *   - a live pass (valid / used / transferred) counts on each night it admits;
 *   - a pass with NO night recorded admits any night (I-PROPOSED-2160-A), so it
 *     counts on every night.
 *
 * Every other event keeps one shared capacity and never calls this.
 */
import type { WhenMode } from "../store/draftEventStore";

const LIVE_PASS_STATUSES: ReadonlySet<string> = new Set([
  "valid",
  "used",
  "transferred",
]);

/** A recurring event's capacity is per night. Nothing else's is. */
export const isPerNightCapacity = (whenMode: WhenMode | null | undefined): boolean =>
  whenMode === "recurring";

interface PassLike {
  ticketTypeId?: string | null;
  eventDateIds: readonly string[];
  status: string;
}

interface OrderLike {
  eventId: string;
  ticketDays?: readonly PassLike[] | null;
}

/**
 * Passes sold on the BUSIEST night, per ticket type.
 *
 * This is the number a per-night capacity can never go below, and the honest
 * "how full is it" figure for an organiser: the whole run's total is not
 * comparable with a per-night capacity.
 */
export const busiestNightSoldByTicketType = (
  orders: readonly OrderLike[],
  eventId: string,
): Record<string, number> => {
  const perNight = new Map<string, Map<string, number>>();
  const anyNight = new Map<string, number>();
  for (const order of orders) {
    if (order.eventId !== eventId) continue;
    for (const pass of order.ticketDays ?? []) {
      const ticketTypeId = pass.ticketTypeId;
      if (typeof ticketTypeId !== "string" || ticketTypeId.length === 0) continue;
      if (!LIVE_PASS_STATUSES.has(pass.status)) continue;
      if (pass.eventDateIds.length === 0) {
        anyNight.set(ticketTypeId, (anyNight.get(ticketTypeId) ?? 0) + 1);
        continue;
      }
      let nights = perNight.get(ticketTypeId);
      if (nights === undefined) {
        nights = new Map<string, number>();
        perNight.set(ticketTypeId, nights);
      }
      for (const night of new Set(pass.eventDateIds)) {
        nights.set(night, (nights.get(night) ?? 0) + 1);
      }
    }
  }
  const out: Record<string, number> = {};
  const ids = new Set<string>([...perNight.keys(), ...anyNight.keys()]);
  for (const id of ids) {
    const nights = perNight.get(id);
    const busiest =
      nights === undefined ? 0 : Math.max(0, ...Array.from(nights.values()));
    out[id] = busiest + (anyNight.get(id) ?? 0);
  }
  return out;
};
