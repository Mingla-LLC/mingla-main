/**
 * liveEventStore — persisted Zustand store for PUBLISHED events.
 *
 * Constitutional notes:
 *   - #6 logout clears: extended via `clearAllStores` (line is added in
 *     `clearAllStores.ts` to call `useLiveEventStore.getState().reset()`).
 *   - #2 one owner per truth: live events live ONLY here. NEVER duplicated
 *     in draftEventStore. The publishDraft action (in draftEventStore.ts)
 *     is the SINGLE ownership transfer point — establishes invariant I-16.
 *
 * I-16 — Live-event ownership separation:
 *   `addLiveEvent` is called by EXACTLY one place: `liveEventConverter.ts`,
 *   from `draftEventStore.publishDraft`. No other caller is permitted.
 *   See `[I-16 GUARD]` comment in `addLiveEvent` below.
 *
 * [TRANSITIONAL] Zustand persist holds all live events client-side.
 * B1 backend cycle migrates to server storage; this store contracts to
 * a cache + ID-only when backend lands.
 *
 * Per Cycle 6 spec §3.1.
 */

import { useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

import type {
  DraftEventFormat,
  DraftEventVisibility,
  MultiDateEntry,
  RecurrenceRule,
  TicketStub,
  WhenMode,
} from "./draftEventStore";

export type LiveEventStatus = "live" | "cancelled" | "ended";

export interface LiveEvent {
  // Identity
  id: string;                          // le_<ts36>
  brandId: string;
  brandSlug: string;                   // FROZEN at publish — preserves URL stability if brand renamed later
  eventSlug: string;                   // generated; brand-scoped unique
  // Lifecycle
  status: LiveEventStatus;
  publishedAt: string;                 // ISO 8601
  cancelledAt: string | null;          // populated when status = "cancelled" (Cycle 9)
  endedAt: string | null;              // populated when last event date passes (Cycle 13)
  // Content snapshot (frozen from DraftEvent at publish)
  name: string;
  description: string;
  format: DraftEventFormat;
  category: string | null;
  whenMode: WhenMode;
  date: string | null;
  doorsOpen: string | null;
  endsAt: string | null;
  timezone: string;
  recurrenceRule: RecurrenceRule | null;
  multiDates: MultiDateEntry[] | null;
  venueName: string | null;
  address: string | null;
  onlineUrl: string | null;
  hideAddressUntilTicket: boolean;
  coverHue: number;
  tickets: TicketStub[];
  visibility: DraftEventVisibility;
  requireApproval: boolean;
  allowTransfers: boolean;
  hideRemainingCount: boolean;
  passwordProtected: boolean;
  // Forward-compat for Cycle 9 (orders) — empty until B3 wires Stripe
  // [TRANSITIONAL] orders array empty in Cycle 6; populated by B3 webhooks.
  orders: never[];
  // Meta
  createdAt: string;                   // when the original draft was created
  updatedAt: string;                   // last modification (publish initially)
}

export interface LiveEventState {
  events: LiveEvent[];
  /**
   * [I-16 GUARD] Adds a fully-formed LiveEvent to the store.
   * MUST be called EXCLUSIVELY by `liveEventConverter.convertDraftToLiveEvent`,
   * which itself is called EXCLUSIVELY by `draftEventStore.publishDraft`.
   * No other code path is permitted to call this. Direct calls from
   * components, hooks, or other stores violate I-16 (live-event ownership
   * separation) and must be rejected at code review.
   */
  addLiveEvent: (event: LiveEvent) => void;
  /** Lookup by id. */
  getLiveEvent: (id: string) => LiveEvent | null;
  /** Lookup by (brandSlug, eventSlug) — drives public URL routing. */
  getLiveEventBySlug: (
    brandSlug: string,
    eventSlug: string,
  ) => LiveEvent | null;
  /** All live events for a brand — used by Cycle 9 + the slug uniqueness check. */
  getLiveEventsForBrand: (brandId: string) => LiveEvent[];
  /** Update lifecycle fields (Cycle 9 cancel; Cycle 13 endedAt computation). */
  updateLifecycle: (
    id: string,
    patch: Partial<Pick<LiveEvent, "status" | "cancelledAt" | "endedAt">>,
  ) => void;
  /** Logout reset — wired via `clearAllStores`. */
  reset: () => void;
}

type PersistedState = Pick<LiveEventState, "events">;

const persistOptions: PersistOptions<LiveEventState, PersistedState> = {
  name: "mingla-business.liveEvent.v1",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state): PersistedState => ({ events: state.events }),
  version: 1,
  // No migrate function — net new store. Future cycles add migrators here.
};

export const useLiveEventStore = create<LiveEventState>()(
  persist(
    (set, get) => ({
      events: [],
      addLiveEvent: (event): void => {
        // [I-16 GUARD] See LiveEventState.addLiveEvent docstring.
        // Only liveEventConverter (called from publishDraft) should be here.
        set((s) => ({ events: [...s.events, event] }));
      },
      getLiveEvent: (id): LiveEvent | null =>
        get().events.find((e) => e.id === id) ?? null,
      getLiveEventBySlug: (brandSlug, eventSlug): LiveEvent | null =>
        get().events.find(
          (e) => e.brandSlug === brandSlug && e.eventSlug === eventSlug,
        ) ?? null,
      getLiveEventsForBrand: (brandId): LiveEvent[] =>
        get().events.filter((e) => e.brandId === brandId),
      updateLifecycle: (id, patch): void => {
        const now = new Date().toISOString();
        set((s) => ({
          events: s.events.map((e) =>
            e.id === id ? { ...e, ...patch, updatedAt: now } : e,
          ),
        }));
      },
      reset: (): void => {
        set({ events: [] });
      },
    }),
    persistOptions,
  ),
);

/**
 * Selector hook — public page URL → LiveEvent | null.
 *
 * IMPORTANT — selects raw `events` array (stable reference) and filters via
 * useMemo. Inlining `s.events.find(...)` would return a different reference
 * each render, breaking useSyncExternalStore's Object.is snapshot caching.
 * Same pattern as `useDraftById` in draftEventStore.ts.
 */
export const useLiveEventBySlug = (
  brandSlug: string | null,
  eventSlug: string | null,
): LiveEvent | null => {
  const events = useLiveEventStore((s) => s.events);
  return useMemo((): LiveEvent | null => {
    if (brandSlug === null || eventSlug === null) return null;
    return (
      events.find(
        (e) => e.brandSlug === brandSlug && e.eventSlug === eventSlug,
      ) ?? null
    );
  }, [events, brandSlug, eventSlug]);
};

/**
 * Selector hook — all live events for a brand (Cycle 9 future).
 */
export const useLiveEventsForBrand = (
  brandId: string | null,
): LiveEvent[] => {
  const events = useLiveEventStore((s) => s.events);
  return useMemo(
    (): LiveEvent[] =>
      brandId === null ? [] : events.filter((e) => e.brandId === brandId),
    [events, brandId],
  );
};
