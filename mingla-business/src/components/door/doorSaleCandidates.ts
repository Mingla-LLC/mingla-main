/**
 * #4389 Door mode — which events a door sale can be for right now. Split out
 * of doorModeState.ts so openDoorSale (Home, F4, the event door route) does
 * not pull Door mode's state into the eager web __common chunk.
 */
import type { LiveEvent } from "../../store/liveEventStore";
import { deriveLiveStatus } from "../../utils/eventLifecycle";
import { computeMasterStartAtUtc } from "../../utils/eventDateMath";

export interface DoorSaleCandidate {
  eventId: string;
  name: string;
  live: boolean;
  startAtUtc: string | null;
}

const sameLocalDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * The events a door sale can be for right now: live, or starting today, and
 * not cancelled, ended or past. Soonest first. Two or more ask "Which event?".
 */
export const doorSaleCandidates = (events: readonly LiveEvent[], nowMs: number): DoorSaleCandidate[] => {
  const now = new Date(nowMs);
  return events
    .flatMap((event): DoorSaleCandidate[] => {
      const startAtUtc = computeMasterStartAtUtc(event);
      const status = deriveLiveStatus(event, startAtUtc);
      if (status === "past" || status === "cancelled") return [];
      const startMs = startAtUtc === null ? Number.NaN : Date.parse(startAtUtc);
      const today = Number.isFinite(startMs) && sameLocalDay(new Date(startMs), now);
      if (status !== "live" && !today) return [];
      return [{ eventId: event.id, name: event.name, live: status === "live", startAtUtc }];
    })
    .sort((a, b) => {
      const at = a.startAtUtc === null ? Number.POSITIVE_INFINITY : Date.parse(a.startAtUtc);
      const bt = b.startAtUtc === null ? Number.POSITIVE_INFINITY : Date.parse(b.startAtUtc);
      return at - bt;
    });
};
