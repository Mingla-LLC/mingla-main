/**
 * ORCH-0965 [Home dashboard intelligent KPIs + tri-kind upcoming]
 *
 * Pure normalisation + sort + past-exclusion pipeline used by the
 * `useUpcomingForBrand` hook. Extracted from the hook so unit tests can
 * exercise the comparator + filter without RN / React Query / expo
 * scaffolding pulling in native modules at module-import time.
 *
 * Established by SPEC §4.4 / §4.4.2 / §4.4.3.
 */

import type { DraftEvent } from "../store/draftEventStore";
import type { LiveEvent } from "../store/liveEventStore";
import type { Trip } from "../services/tripsService";
import {
  computeMasterStartAtUtc,
  computeMasterEndAtUtc,
} from "./eventDateMath";
import { deriveLiveStatus } from "./eventLifecycle";

// ---------------------- Types ----------------------

export type UpcomingKind = "event" | "experience" | "trip" | "draft";

export type UpcomingStatus = "live" | "upcoming" | "draft";

export interface UpcomingItem {
  key: string;
  id: string;
  kind: UpcomingKind;
  status: UpcomingStatus;
  /** UTC instant. Null only for drafts without a scheduled date. */
  startAtUtc: Date | null;
  /** UTC instant. Null for drafts or when end time is unknown. */
  endAtUtc: Date | null;
  /** Original row — caller narrows by kind. */
  source: LiveEvent | DraftEvent | Trip;
}

export interface UpcomingCounts {
  /** Sum of all non-past items (live + upcoming + draft). */
  total: number;
  /** Alias of `total` retained for parity with the prior counts.active shape. */
  active: number;
  live: number;
  upcoming: number;
  draft: number;
}

// ---------------------- Merge (extracted to avoid hook import) ----------------------

/**
 * Local copy of `mergeServerAndLegacyLiveEvents` from
 * `mingla-business/src/hooks/useBusinessEvents.ts` — duplicated here so
 * this pure utility doesn't import the hooks module (which pulls in RN).
 * Behaviour is identical: server rows win; legacy rows kept only when
 * neither `id` nor `serverEventId` collides with a server row.
 */
export function mergeServerAndLegacyLive(
  serverEvents: LiveEvent[],
  legacyEvents: LiveEvent[],
): LiveEvent[] {
  const serverIds = new Set(serverEvents.map((event) => event.id));
  const serverEventIds = new Set(
    serverEvents
      .map((event) => event.serverEventId)
      .filter((id): id is string => id !== null),
  );
  const legacyOnly = legacyEvents.filter((event) => {
    if (serverIds.has(event.id)) return false;
    if (event.serverEventId !== null && serverEventIds.has(event.serverEventId)) {
      return false;
    }
    return true;
  });
  return [...serverEvents, ...legacyOnly];
}

// ---------------------- Normalisers ----------------------

export function normaliseEventRow(event: LiveEvent): UpcomingItem | null {
  const startAtStr = computeMasterStartAtUtc(event);
  const lifecycle = deriveLiveStatus(event, startAtStr);
  if (lifecycle === "cancelled" || lifecycle === "past") return null;

  const status: UpcomingStatus = lifecycle === "live" ? "live" : "upcoming";
  const endAtStr = computeMasterEndAtUtc(event);

  const eventType =
    (event as LiveEvent & { event_type?: UpcomingKind }).event_type ?? "event";
  const kind: UpcomingKind = eventType === "experience" ? "experience" : "event";

  return {
    key: `${kind}-${event.id}`,
    id: event.id,
    kind,
    status,
    startAtUtc: startAtStr !== null ? new Date(startAtStr) : null,
    endAtUtc: endAtStr !== null ? new Date(endAtStr) : null,
    source: event,
  };
}

export function normaliseTripRow(trip: Trip): UpcomingItem | null {
  if (
    trip.status === "draft" ||
    trip.status === "ended" ||
    trip.status === "cancelled"
  ) {
    return null;
  }
  const status: UpcomingStatus = trip.status === "live" ? "live" : "upcoming";
  const startStr = trip.businessTrip.startAt;
  const endStr = trip.businessTrip.endAt;
  return {
    key: `trip-${trip.id}`,
    id: trip.id,
    kind: "trip",
    status,
    startAtUtc: startStr !== null ? new Date(startStr) : null,
    endAtUtc: endStr !== null ? new Date(endStr) : null,
    source: trip,
  };
}

export function normaliseDraft(draft: DraftEvent): UpcomingItem {
  return {
    key: `draft-${draft.id}`,
    id: draft.id,
    kind: "draft",
    status: "draft",
    startAtUtc: null,
    endAtUtc: null,
    source: draft,
  };
}

// ---------------------- Past exclusion ----------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export function isPastForUpcoming(item: UpcomingItem, now: number = Date.now()): boolean {
  if (item.status === "draft") return false;
  if (item.endAtUtc !== null) return item.endAtUtc.getTime() < now;
  if (item.startAtUtc !== null) {
    return item.startAtUtc.getTime() + DAY_MS < now;
  }
  return false;
}

// ---------------------- Sort comparator ----------------------

export function compareUpcomingItems(a: UpcomingItem, b: UpcomingItem): number {
  if (a.status === "live" && b.status !== "live") return -1;
  if (b.status === "live" && a.status !== "live") return 1;

  if (a.status === "live" && b.status === "live") {
    if (a.startAtUtc !== null && b.startAtUtc !== null) {
      return a.startAtUtc.getTime() - b.startAtUtc.getTime();
    }
    if (a.startAtUtc !== null && b.startAtUtc === null) return -1;
    if (a.startAtUtc === null && b.startAtUtc !== null) return 1;
    return 0;
  }

  if (a.status === "draft" && b.status !== "draft") return 1;
  if (b.status === "draft" && a.status !== "draft") return -1;
  if (a.status === "draft" && b.status === "draft") {
    const aUpdated = (a.source as DraftEvent).updatedAt ?? "";
    const bUpdated = (b.source as DraftEvent).updatedAt ?? "";
    return bUpdated.localeCompare(aUpdated);
  }

  if (a.startAtUtc !== null && b.startAtUtc !== null) {
    return a.startAtUtc.getTime() - b.startAtUtc.getTime();
  }
  if (a.startAtUtc !== null && b.startAtUtc === null) return -1;
  if (a.startAtUtc === null && b.startAtUtc !== null) return 1;
  return 0;
}

// ---------------------- Composition pipeline ----------------------

export function buildUpcomingItems(
  serverEvents: LiveEvent[],
  legacyLiveEvents: LiveEvent[],
  trips: Trip[],
  drafts: DraftEvent[],
  now: number = Date.now(),
): {
  items: UpcomingItem[];
  counts: UpcomingCounts;
  primaryLiveItem: UpcomingItem | null;
  // ORCH-1143 — one-owner-per-truth for live-state (Constitution #2). The
  // home live carousel reads this; it must NOT re-derive "live" at the call
  // site. Already-sorted (live-first, start-ascending) subset of `items`.
  liveItems: UpcomingItem[];
  // ORCH-1143 SC-7 — the Upcoming-list view: `items` MINUS the currently-live
  // items (which are surfaced exclusively in the live carousel). Derived, not a
  // mutation of `items` (the carousel + counts still need the full set / the
  // live subset). One owner per truth: live-state stays single-sourced above;
  // this is just the complementary non-live projection of the SAME sorted list.
  nonLiveItems: UpcomingItem[];
} {
  const mergedEvents = mergeServerAndLegacyLive(serverEvents, legacyLiveEvents);

  const items: UpcomingItem[] = [];
  for (const event of mergedEvents) {
    const item = normaliseEventRow(event);
    if (item !== null) items.push(item);
  }
  for (const trip of trips) {
    const item = normaliseTripRow(trip);
    if (item !== null) items.push(item);
  }
  for (const draft of drafts) {
    items.push(normaliseDraft(draft));
  }

  const nonPast = items.filter((i) => !isPastForUpcoming(i, now));
  nonPast.sort(compareUpcomingItems);

  const counts: UpcomingCounts = {
    total: nonPast.length,
    active: nonPast.length,
    live: nonPast.filter((i) => i.status === "live").length,
    upcoming: nonPast.filter((i) => i.status === "upcoming").length,
    draft: nonPast.filter((i) => i.status === "draft").length,
  };

  // ORCH-1143 — `liveItems` inherits the live-first start-ascending order from
  // the comparator sort above. `primaryLiveItem` stays `liveItems[0]` (the
  // existing `find` is equivalent) and is kept for back-compat consumers.
  const liveItems = nonPast.filter((i) => i.status === "live");
  const primaryLiveItem = liveItems[0] ?? null;
  // ORCH-1143 SC-7 — non-live projection of the same sorted set (upcoming +
  // draft). Preserves `nonPast`'s order; never mutates `items`/`liveItems`.
  const nonLiveItems = nonPast.filter((i) => i.status !== "live");
  return { items: nonPast, counts, primaryLiveItem, liveItems, nonLiveItems };
}
