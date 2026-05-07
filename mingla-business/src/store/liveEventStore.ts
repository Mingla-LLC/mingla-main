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
import { useEventEditLogStore } from "./eventEditLogStore";
import { useOrderStore } from "./orderStore";
import type { SoldCountContext } from "./orderStoreHelpers";
import {
  classifySeverity,
  computeDiffSummary,
} from "../utils/liveEventAdapter";
import { computeDroppedDates } from "../utils/scheduleDateExpansion";
import {
  deriveChannelFlags,
  notifyEventChanged,
} from "../services/eventChangeNotifier";
import { getBrandFromCache } from "../hooks/useBrands";

export type LiveEventStatus = "live" | "cancelled" | "ended";

/**
 * Editable subset of LiveEvent post-publish (ORCH-0704 v2).
 *
 * Frozen fields (NEVER editable post-publish, omitted from this type):
 *   id, brandId, brandSlug, eventSlug, status, publishedAt, cancelledAt,
 *   endedAt, createdAt, updatedAt, orders.
 *
 * Buyer-protection guard rails (capacity floor, tier-delete-with-sales,
 * etc.) are enforced separately in `updateLiveEventFields` validation,
 * NOT by omitting fields from this type — every field below is editable
 * UNLESS the destructive-change rules trip a refund-first reject.
 *
 * Per ORCH-0704 v2 spec §3.1.1.
 */
export type EditableLiveEventFields = Pick<
  LiveEvent,
  | "name"
  | "description"
  | "format"
  | "category"
  | "whenMode"
  | "date"
  | "doorsOpen"
  | "endsAt"
  | "timezone"
  | "recurrenceRule"
  | "multiDates"
  | "venueName"
  | "address"
  | "onlineUrl"
  | "hideAddressUntilTicket"
  | "coverHue"
  | "tickets"
  | "visibility"
  | "requireApproval"
  | "allowTransfers"
  | "hideRemainingCount"
  | "passwordProtected"
  | "privateGuestList"
  | "inPersonPaymentsEnabled"
>;

/**
 * Discriminated rejection reasons returned by `updateLiveEventFields`
 * when guard rails block a destructive change.
 *
 * Per ORCH-0704 v2 spec §3.1.2.
 */
export type UpdateLiveEventRejection =
  | "event_not_found"
  | "missing_edit_reason"
  | "invalid_edit_reason"
  | "capacity_below_sold"
  | "tier_delete_with_sales"
  | "tier_price_change_with_sales"
  | "tier_free_toggle_with_sales"
  | "multi_date_remove_with_sales"
  | "when_mode_drops_active_date"
  | "recurrence_drops_occurrence";

export type UpdateLiveEventResult =
  | { ok: true; editLogEntryId: string }
  | {
      ok: false;
      reason: UpdateLiveEventRejection;
      tierIds?: string[];
      droppedDates?: string[];
      affectedOrderCount?: number;
      details?: string;
    };

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
  /** Cycle 10: hide attendee count from buyer-side surfaces. I-26 — operator-only flag; buyer surfaces honor this when added (NOT in Cycle 10). */
  privateGuestList: boolean;
  /** Cycle 12: when true, J-D1 "Door Sales" ActionTile + /event/{id}/door route reachable. Default false. */
  inPersonPaymentsEnabled: boolean;
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
  /**
   * Update editable post-publish fields (ORCH-0704 v2). Accepts the full
   * editable subset; rejects frozen fields at the type level.
   *
   * Validates buyer-protection guard rails BEFORE applying the patch:
   *   - Reason validation: trimmed length 10..200
   *   - Capacity floor: tickets[i].capacity >= soldCountByTier[tickets[i].id]
   *   - Tier delete with sales: cannot remove a tier with sold > 0
   *   - Tier price change with sales: rejected
   *   - Tier free-toggle with sales: rejected
   *   - Multi-date entry remove with any event-wide sale: rejected
   *   - whenMode change that drops a previously-active date with sales: rejected
   *   - Recurrence rule change that drops occurrences with sales: rejected
   *
   * On success: applies patch, bumps `updatedAt`, records edit log entry,
   * fires notification stack via `eventChangeNotifier.notifyEventChanged`.
   *
   * Per ORCH-0704 v2 spec §3.2.1.
   */
  updateLiveEventFields: (
    id: string,
    patch: Partial<EditableLiveEventFields>,
    context: SoldCountContext,
    reason: string,
  ) => UpdateLiveEventResult;
  /** Logout reset — wired via `clearAllStores`. */
  reset: () => void;
}

type PersistedState = Pick<LiveEventState, "events">;

// Cycle 12 — v1 LiveEvent + V1 TicketStub (no availableAt + no
// inPersonPaymentsEnabled). v2 adds both fields with safe defaults.
//
// Cycle 12 rework — privateGuestList is also marked optional in V1 because
// pre-Cycle-10 published events were persisted under v1 BEFORE that field
// was added (Cycle 10 added the field without a persist version bump). The
// migrate now backfills it to false so EditPublishedScreen's diff display
// never sees undefined for this field.
type V1LiveTicketStub = Omit<TicketStub, "availableAt">;
type V1LiveEvent = Omit<
  LiveEvent,
  "tickets" | "inPersonPaymentsEnabled" | "privateGuestList"
> & {
  tickets: V1LiveTicketStub[];
  /** Pre-Cycle-10 events may not have this field. */
  privateGuestList?: boolean;
};

const upgradeV1LiveTicketToV2 = (t: V1LiveTicketStub): TicketStub => ({
  ...t,
  availableAt: "both",
});

const upgradeV1LiveEventToV2 = (e: V1LiveEvent): LiveEvent => ({
  ...e,
  tickets: e.tickets.map(upgradeV1LiveTicketToV2),
  inPersonPaymentsEnabled: false,
  // Cycle 12 rework — backfill pre-Cycle-10 events.
  privateGuestList: e.privateGuestList ?? false,
});

const persistOptions: PersistOptions<LiveEventState, PersistedState> = {
  name: "mingla-business.liveEvent.v1",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state): PersistedState => ({ events: state.events }),
  version: 2,
  migrate: (persistedState, version): PersistedState => {
    if (version < 1) {
      return { events: [] };
    }
    if (version === 1) {
      // v1 → v2: tickets gain availableAt:"both"; event gains
      // inPersonPaymentsEnabled:false. Cycle 12 additive migrate.
      const v1 = persistedState as { events: V1LiveEvent[] };
      return { events: v1.events.map(upgradeV1LiveEventToV2) };
    }
    return persistedState as PersistedState;
  },
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
      updateLiveEventFields: (id, patch, context, reason): UpdateLiveEventResult => {
        // ---- 1. Reason validation (I-20 — reason mandatory + length range) ----
        const trimmedReason = reason.trim();
        if (trimmedReason.length === 0) {
          return { ok: false, reason: "missing_edit_reason" };
        }
        if (trimmedReason.length < 10 || trimmedReason.length > 200) {
          return { ok: false, reason: "invalid_edit_reason" };
        }

        // ---- 2. Event lookup ----
        const event = get().events.find((e) => e.id === id);
        if (event === undefined) {
          return { ok: false, reason: "event_not_found" };
        }

        const { soldCountByTier, soldCountForEvent } = context;

        // ---- 3. Schedule diff (whenMode / recurrence / multiDates dropped dates) ----
        const beforeSchedule = {
          whenMode: event.whenMode,
          date: event.date,
          recurrenceRule: event.recurrenceRule,
          multiDates: event.multiDates,
        };
        const afterSchedule = {
          whenMode: patch.whenMode ?? event.whenMode,
          date: patch.date !== undefined ? patch.date : event.date,
          recurrenceRule:
            patch.recurrenceRule !== undefined
              ? patch.recurrenceRule
              : event.recurrenceRule,
          multiDates:
            patch.multiDates !== undefined ? patch.multiDates : event.multiDates,
        };
        const droppedDates = computeDroppedDates(beforeSchedule, afterSchedule);

        if (droppedDates.length > 0 && soldCountForEvent > 0) {
          // Classify rejection by what changed.
          if (afterSchedule.whenMode !== beforeSchedule.whenMode) {
            return {
              ok: false,
              reason: "when_mode_drops_active_date",
              droppedDates,
              affectedOrderCount: soldCountForEvent,
            };
          }
          if (
            JSON.stringify(afterSchedule.recurrenceRule) !==
            JSON.stringify(beforeSchedule.recurrenceRule)
          ) {
            return {
              ok: false,
              reason: "recurrence_drops_occurrence",
              droppedDates,
              affectedOrderCount: soldCountForEvent,
            };
          }
          // Otherwise — multi-date entry removal
          return {
            ok: false,
            reason: "multi_date_remove_with_sales",
            droppedDates,
            affectedOrderCount: soldCountForEvent,
          };
        }

        // ---- 4. Per-tier guard rails ----
        if (patch.tickets !== undefined) {
          const oldById = new Map(event.tickets.map((t) => [t.id, t]));
          const newIds = new Set(patch.tickets.map((t) => t.id));

          // Tier delete with sales
          for (const oldT of event.tickets) {
            const sold = soldCountByTier[oldT.id] ?? 0;
            if (!newIds.has(oldT.id) && sold > 0) {
              return {
                ok: false,
                reason: "tier_delete_with_sales",
                tierIds: [oldT.id],
                affectedOrderCount: sold,
              };
            }
          }

          // Per-tier mutations
          for (const newT of patch.tickets) {
            const oldT = oldById.get(newT.id);
            if (oldT === undefined) continue; // new tier
            const sold = soldCountByTier[newT.id] ?? 0;
            if (sold === 0) continue; // unsold tier

            // Capacity floor (only when tier has fixed capacity)
            if (newT.capacity !== null && newT.capacity < sold) {
              return {
                ok: false,
                reason: "capacity_below_sold",
                tierIds: [newT.id],
                affectedOrderCount: sold,
              };
            }
            // Price change with sales
            if (newT.priceGbp !== oldT.priceGbp) {
              return {
                ok: false,
                reason: "tier_price_change_with_sales",
                tierIds: [newT.id],
                affectedOrderCount: sold,
              };
            }
            // Free toggle with sales
            if (newT.isFree !== oldT.isFree) {
              return {
                ok: false,
                reason: "tier_free_toggle_with_sales",
                tierIds: [newT.id],
                affectedOrderCount: sold,
              };
            }
          }
        }

        // ---- 5. Apply patch ----
        const now = new Date().toISOString();
        set((s) => ({
          events: s.events.map((e) =>
            e.id === id ? { ...e, ...patch, updatedAt: now } : e,
          ),
        }));

        // ---- 6. Severity classification + edit log + notification stack ----
        const changedFieldKeys = (
          Object.keys(patch) as Array<keyof EditableLiveEventFields>
        ).filter((k) => {
          const a = event[k];
          const b = (patch as Record<string, unknown>)[k];
          return JSON.stringify(a) !== JSON.stringify(b);
        });
        const severity = classifySeverity(changedFieldKeys);
        const diffSummary = computeDiffSummary(event, patch);

        // Cycle 9c — populate affectedOrderIds + hasWebPurchaseOrders from useOrderStore
        const ordersForEvent = useOrderStore
          .getState()
          .getOrdersForEvent(id);
        const affectedOrderIds = ordersForEvent.map((o) => o.id);
        const hasWebPurchaseOrders = ordersForEvent.some(
          (o) =>
            o.paymentMethod === "card" ||
            o.paymentMethod === "apple_pay" ||
            o.paymentMethod === "google_pay",
        );

        const entry = useEventEditLogStore.getState().recordEdit({
          eventId: id,
          brandId: event.brandId,
          reason: trimmedReason,
          severity,
          changedFieldKeys: changedFieldKeys.map(String),
          diffSummary,
          affectedOrderIds,
        });

        // Resolve brand display name for notification copy.
        // Cycle 2 / ORCH-0742: outside-component context reads the live Brand
        // record from the React Query cache by ID. Empty string on cache miss
        // — best-effort, fire-and-forget notification.
        const cachedBrand = getBrandFromCache(event.brandId);
        const brandName = cachedBrand?.displayName ?? "";

        // Fire notification stack (fire-and-forget)
        void notifyEventChanged(
          {
            eventId: id,
            eventName: event.name,
            brandName,
            brandSlug: event.brandSlug,
            eventSlug: event.eventSlug,
            reason: trimmedReason,
            diffSummary,
            severity,
            affectedOrderIds,
            occurredAt: now,
          },
          deriveChannelFlags(severity, hasWebPurchaseOrders),
        );

        return { ok: true, editLogEntryId: entry.id };
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
