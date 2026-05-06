/**
 * Cycle 17d §C — TTL evict ended-event entries from phone stores.
 *
 * Prevents AsyncStorage soft-cap drift on heavy operators across 12-month
 * usage. Only evicts events with endedAt !== null AND end_at + 30d in past
 * (F-H2 guard: never evict in-progress events even if end_at slipped due
 * to concert delays).
 *
 * Called once at app start from app/_layout.tsx after Zustand hydration.
 *
 * Per Cycle 17d §C; D-17d-2 (TTL=30 days); D-17d-3 (app-start trigger).
 */

import { useLiveEventStore } from "../store/liveEventStore";
import { useOrderStore } from "../store/orderStore";
import { useGuestStore } from "../store/guestStore";
import { useEventEditLogStore } from "../store/eventEditLogStore";
import { useScanStore } from "../store/scanStore";
import { useDoorSalesStore } from "../store/doorSalesStore";

export const ENDED_EVENT_TTL_DAYS = 30;
const ENDED_EVENT_TTL_MS = ENDED_EVENT_TTL_DAYS * 86_400_000;

export interface EvictionResult {
  evictedEventCount: number;
  evictedEntryCount: number;
}

interface EventIdEntry {
  eventId: string;
}

interface PrunableStore<T extends EventIdEntry> {
  getState: () => { entries: T[] };
  setState: (partial: { entries: T[] }) => void;
}

/**
 * Generic prune helper. Filters store entries by eventId membership in
 * `endedEventIds`. Try/catch logs in DEV; one store failure does not cascade.
 */
const pruneStore = <T extends EventIdEntry>(
  store: PrunableStore<T>,
  endedEventIds: ReadonlySet<string>,
  label: string,
): number => {
  try {
    const before = store.getState().entries;
    const after = before.filter((e) => !endedEventIds.has(e.eventId));
    const pruned = before.length - after.length;
    if (pruned > 0) {
      store.setState({ entries: after });
    }
    return pruned;
  } catch (error) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error(`[evictEndedEvents] ${label} failed:`, error);
    }
    return 0;
  }
};

export const evictEndedEvents = (): EvictionResult => {
  const events = useLiveEventStore.getState().events;
  const now = Date.now();

  // Build set of eventIds eligible for eviction.
  // Guard: endedAt !== null (operator-confirmed end) AND TTL elapsed.
  const endedEventIds = new Set<string>();
  for (const event of events) {
    if (event.endedAt === null) continue;
    const endedAtMs = Date.parse(event.endedAt);
    if (Number.isNaN(endedAtMs)) continue; // defensive — malformed timestamp
    if (now - endedAtMs > ENDED_EVENT_TTL_MS) {
      endedEventIds.add(event.id);
    }
  }

  if (endedEventIds.size === 0) {
    return { evictedEventCount: 0, evictedEntryCount: 0 };
  }

  let evictedEntryCount = 0;
  evictedEntryCount += pruneStore(useOrderStore, endedEventIds, "orderStore");
  evictedEntryCount += pruneStore(useGuestStore, endedEventIds, "guestStore");
  evictedEntryCount += pruneStore(useEventEditLogStore, endedEventIds, "eventEditLogStore");
  evictedEntryCount += pruneStore(useScanStore, endedEventIds, "scanStore");
  evictedEntryCount += pruneStore(useDoorSalesStore, endedEventIds, "doorSalesStore");

  return {
    evictedEventCount: endedEventIds.size,
    evictedEntryCount,
  };
};
