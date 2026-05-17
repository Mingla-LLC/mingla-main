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
  EventCoverMediaType,
} from "./draftEventStore";
import type { EventCoverMediaProvider } from "../types/eventCoverProvider";
import { useEventEditLogStore } from "./eventEditLogStore";
import { useOrderStore } from "./orderStore";
import type { SoldCountContext } from "./orderStoreHelpers";
import {
  classifySeverity,
  computeDiffSummary,
} from "../utils/liveEventAdapter";
import { validateLiveEventFieldUpdate } from "../utils/publishedEventEditGuards";
import {
  deriveChannelFlags,
  notifyEventChanged,
} from "../services/eventChangeNotifier";
import { getBrandFromCache } from "../hooks/useBrands";

export type LiveEventStatus = "scheduled" | "live" | "cancelled" | "ended";

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
  | "coverMediaUrl"
  | "coverMediaType"
  | "coverMediaProvider"
  | "coverMediaSourceUrl"
  | "coverMediaCredit"
  | "coverMediaCreditUrl"
  | "coverMediaAlt"
  | "tickets"
  | "visibility"
  | "requireApproval"
  | "allowTransfers"
  | "hideRemainingCount"
  | "passwordProtected"
  | "privateGuestList"
  | "inPersonPaymentsEnabled"
  // ORCH-0824 hotfix: new taxonomy + city fields must be editable post-publish
  // so the diff/save pipeline detects pill toggles and address re-picks.
  // Listed as SAFE_KEYS below (additive — no buyer-protection guard rails).
  | "partyTypes"
  | "vibeTags"
  | "musicGenres"
  | "city"
  | "locationGeo"
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
  serverEventId: string | null;         // Supabase events.id retained from the draft row after publish
  brandId: string;
  brandSlug: string;                   // FROZEN at publish — preserves URL stability if brand renamed later
  eventSlug: string;                   // generated; brand-scoped unique
  // Lifecycle
  status: LiveEventStatus;
  publishedAt: string;                 // ISO 8601
  cancelledAt: string | null;          // populated when status = "cancelled" (Cycle 9)
  endedAt: string | null;              // populated when last event date passes (Cycle 13)
  /**
   * ORCH-0865 REWORK 5: discriminator for event-vs-trip-vs-experience
   * routing. Optional on the type for backward-compat with persisted
   * pre-Tr2 LiveEvents (those are all event_type='event' by definition
   * because liveEventConverter only writes events; pre-Tr2 data simply
   * lacked the field). Required to be set on every row produced by
   * fetchBusinessEventsForBrand so the tap-handler `routeForEventRow`
   * helper can dispatch correctly. Missing value is interpreted as
   * 'event' by routeForEventRowDefensive — safe default for legacy
   * stored rows.
   */
  event_type?: "event" | "experience" | "trip";
  // Content snapshot (frozen from DraftEvent at publish)
  name: string;
  description: string;
  format: DraftEventFormat;
  /**
   * @deprecated ORCH-0824 — replaced by partyTypes/vibeTags/musicGenres
   * arrays below. Kept on the type for in-memory persisted-LiveEvent
   * backward compatibility (Zustand storage from pre-ORCH-0824 builds).
   * Read-only going forward; new publishes write null.
   * Cleanup target: ORCH-0824-D.
   */
  category: string | null;
  /**
   * ORCH-0824: multi-select party type slugs. Optional on the TYPE for
   * backward compat with persisted older LiveEvents; the
   * liveEventToEditableDraft adapter defaults missing values to [].
   */
  partyTypes?: string[];
  vibeTags?: string[];
  musicGenres?: string[];
  /** ORCH-0824: normalized city from Google Places autocomplete at publish. */
  city?: string | null;
  /** ORCH-0824: structured lat/lng from Google Places autocomplete at publish. */
  locationGeo?: { lat: number; lng: number } | null;
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
  coverMediaUrl: string | null;
  coverMediaType: EventCoverMediaType | null;
  coverMediaProvider?: EventCoverMediaProvider | null;
  coverMediaSourceUrl?: string | null;
  coverMediaCredit?: string | null;
  coverMediaCreditUrl?: string | null;
  coverMediaAlt?: string | null;
  /** ISO 4217 immutable commerce currency for this published event. */
  currency?: string;
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
  | "tickets"
  | "inPersonPaymentsEnabled"
  | "privateGuestList"
  | "serverEventId"
  | "coverMediaUrl"
  | "coverMediaType"
  | "coverMediaProvider"
  | "coverMediaSourceUrl"
  | "coverMediaCredit"
  | "coverMediaCreditUrl"
  | "coverMediaAlt"
> & {
  tickets: V1LiveTicketStub[];
  /** Pre-Cycle-10 events may not have this field. */
  privateGuestList?: boolean;
};

const upgradeV1LiveTicketToV2 = (t: V1LiveTicketStub): TicketStub => ({
  ...t,
  availableAt: "both",
});

type V2LiveEvent = Omit<
  LiveEvent,
  | "serverEventId"
  | "coverMediaUrl"
  | "coverMediaType"
  | "coverMediaProvider"
  | "coverMediaSourceUrl"
  | "coverMediaCredit"
  | "coverMediaCreditUrl"
  | "coverMediaAlt"
>;

const upgradeV1LiveEventToV2 = (e: V1LiveEvent): V2LiveEvent => ({
  ...e,
  tickets: e.tickets.map(upgradeV1LiveTicketToV2),
  inPersonPaymentsEnabled: false,
  // Cycle 12 rework — backfill pre-Cycle-10 events.
  privateGuestList: e.privateGuestList ?? false,
});

const upgradeLiveEventToV3 = (e: V2LiveEvent): LiveEvent => ({
  ...e,
  serverEventId: null,
  coverMediaUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
});

const withProviderMetadataDefaults = (event: LiveEvent): LiveEvent => ({
  ...event,
  coverMediaProvider: event.coverMediaProvider ?? null,
  coverMediaSourceUrl: event.coverMediaSourceUrl ?? null,
  coverMediaCredit: event.coverMediaCredit ?? null,
  coverMediaCreditUrl: event.coverMediaCreditUrl ?? null,
  coverMediaAlt: event.coverMediaAlt ?? null,
});

const persistOptions: PersistOptions<LiveEventState, PersistedState> = {
  name: "mingla-business.liveEvent.v1",
  storage: createJSONStorage(() => AsyncStorage),
  // ORCH-0862 / DISCOVERY-1 — partialize now returns an empty events array
  // so server snapshots NEVER persist to AsyncStorage. Compliant with
  // I-PROPOSED-J (ACTIVE post-ORCH-0742 [Zustand persist no server
  // snapshots]). Cold start re-hydrates the in-memory store from React
  // Query via useBusinessEventsForBrand on home/hub mount; no stale
  // status='scheduled' rows can survive a server-side cancel on another
  // device. Storage key name retained (`mingla-business.liveEvent.v1`)
  // so the v4→v5 migrator runs on existing users.
  partialize: (_state): PersistedState => ({ events: [] }),
  version: 5,
  migrate: (persistedState, version): PersistedState => {
    if (version < 1) {
      return { events: [] };
    }
    if (version === 1) {
      // v1 → v3: tickets gain availableAt:"both"; event gains
      // inPersonPaymentsEnabled:false, then server/media cover identity.
      const v1 = persistedState as { events: V1LiveEvent[] };
      const v2Events = v1.events.map(upgradeV1LiveEventToV2);
      return { events: v2Events.map(upgradeLiveEventToV3) };
    }
    if (version === 2) {
      const v2 = persistedState as { events: V2LiveEvent[] };
      return { events: v2.events.map(upgradeLiveEventToV3) };
    }
    if (version === 3) {
      const v3 = persistedState as { events: LiveEvent[] };
      return { events: v3.events.map(withProviderMetadataDefaults) };
    }
    if (version === 4) {
      // ORCH-0862 — v4 → v5: drop the persisted server snapshot.
      // React Query re-hydrates in-memory state via
      // useBusinessEventsForBrand on next mount. Any v4 events array is
      // discarded; no data loss because the rows live on the server.
      return { events: [] };
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
        const event = get().events.find((e) => e.id === id) ?? null;
        const validation = validateLiveEventFieldUpdate(event, patch, context, reason);
        if (!validation.ok) return validation;
        if (event === null) return { ok: false, reason: "event_not_found" };
        const trimmedReason = validation.trimmedReason;

        // ---- 2. Apply patch ----
        const now = new Date().toISOString();
        set((s) => ({
          events: s.events.map((e) =>
            e.id === id ? { ...e, ...patch, updatedAt: now } : e,
          ),
        }));

        // ---- 6. Severity classification + edit log + notification stack ----
        const changedFieldKeys = (
          Object.keys(patch) as (keyof EditableLiveEventFields)[]
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
