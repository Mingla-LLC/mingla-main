/**
 * eventLifecycle — Derive an event's UI lifecycle status (Cycle 13 extraction).
 *
 * Originally inline in `app/event/[id]/index.tsx:191-203`. Extracted to a
 * shared util in Cycle 13 so the new reconciliation route + Event Detail share
 * the same predicate (single source of truth per Const #2).
 *
 * Three sources fold into the canonical "past" status:
 *   - event.status === "cancelled" (Cycle 9b-1 cancel flow)
 *   - event.endedAt !== null (Cycle 9b-1 manual End sales)
 *   - now > eventDate + 24h (time-based, end of natural live window)
 *
 * Live window: 4h before event.date through 24h after event.date.
 *
 * NOTE: `LiveEventStatus` enum has an "ended" value declared in liveEventStore
 * but client code never sets it — `endedAt: ISO` is used instead (D-CYCLE13-RECON-FOR-2
 * documents the dead-enum observation). This util reads `endedAt` directly.
 *
 * Per Cycle 13 SPEC §4.3.2 + Step 1 implementation order.
 */

import type { LiveEvent } from "../store/liveEventStore";

export type EventLifecycleStatus = "live" | "upcoming" | "past" | "cancelled";

const LIVE_WINDOW_BEFORE_MS = 4 * 60 * 60 * 1000;
const LIVE_WINDOW_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Maps a LiveEvent to its UI lifecycle bucket. UI consumers branch on this
 * (e.g., HeroStatusPill on Event Detail; headline copy on Reconciliation route).
 *
 * Cycle 13 reconciliation route maps "cancelled" through to its own headline
 * branch (NOT collapsed to "past") to surface the refund/payout-audit framing.
 * Event Detail still collapses cancelled → past for its 3-bucket pill design.
 */
export const deriveLiveStatus = (event: LiveEvent): EventLifecycleStatus => {
  if (event.status === "cancelled") return "cancelled";
  if (event.endedAt !== null) return "past";
  if (event.date === null) return "upcoming";
  const eventTime = new Date(event.date).getTime();
  if (!Number.isFinite(eventTime)) return "upcoming";
  const liveWindowStart = eventTime - LIVE_WINDOW_BEFORE_MS;
  const liveWindowEnd = eventTime + LIVE_WINDOW_AFTER_MS;
  const now = Date.now();
  if (now >= liveWindowStart && now < liveWindowEnd) return "live";
  if (now < liveWindowStart) return "upcoming";
  return "past";
};
