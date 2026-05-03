/**
 * eventEditLogStore — append-only audit log of LiveEvent edits (ORCH-0704 v2).
 *
 * Every successful `updateLiveEventFields` call records exactly one
 * entry here. Entries are immutable post-write — the store exposes ONLY
 * append (recordEdit) + reads + reset (logout).
 *
 * Used by:
 *   - `updateLiveEventFields` (calls `recordEdit` after applying the patch)
 *   - Cycle 9c buyer order detail page (will call `getEditsForEventSince`
 *     to render material-change banner since the buyer's last seen)
 *
 * Constitutional notes:
 *   - #6 logout clears: wired via `clearAllStores.ts`
 *   - #2 one owner per truth: edit history lives ONLY here. NEVER duplicated.
 *
 * I-20 — Edit reason mandatory + audit log permanence:
 *   `recordEdit` is the SOLE write API. There is no `updateEdit` /
 *   `deleteEdit`. Every successful mutation in `liveEventStore.updateLiveEventFields`
 *   MUST call `recordEdit` before returning success.
 *
 * [TRANSITIONAL] Zustand persist holds entries client-side. B-cycle
 * migrates audit log to server storage; this store contracts to a
 * cache + ID-only when backend lands.
 *
 * EXIT CONDITION (banner consumer): Cycle 9c builds the buyer order
 * detail page, reads `getEditsForEventSince(eventId, order.lastSeenEventUpdatedAt)`,
 * renders the material-change banner with the latest entry's reason.
 *
 * Per ORCH-0704 v2 spec §3.1.3 + §3.2.2.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

export type EditSeverity = "additive" | "material" | "destructive";

// NOTE: "destructive" used by Cycle 9c order-level mutations (refund/cancel).
// ORCH-0704 event edits classify as "additive" or "material" only (destructive
// is unreachable from updateLiveEventFields — guard rails reject pre-apply).

export interface EventEditEntry {
  /** ee_<base36-timestamp>_<base36-rand4> */
  id: string;
  eventId: string;
  /** Denormalized for fast brand-scoped queries. */
  brandId: string;
  /** ISO 8601. */
  editedAt: string;
  /** Operator's explanation (10..200 chars trimmed). */
  reason: string;
  severity: EditSeverity;
  /** Field keys that changed in this edit. */
  changedFieldKeys: string[];
  /** Human-readable diff lines, used in notification copy. */
  diffSummary: string[];
  /**
   * Order IDs affected by this edit. Populated post-Cycle-9c via
   * `useOrderStore.getOrdersForEvent(eventId).map(o => o.id)`.
   */
  affectedOrderIds: string[];
  /**
   * NEW (Cycle 9c). When set, this entry was triggered by an order-level
   * action (refund / cancel / resend) rather than an event-level edit.
   * Order-level events log here (single audit trail per Q-9c-3 default A)
   * so the buyer's material-change banner reads from one stream.
   */
  orderId?: string;
}

export interface EventEditLogState {
  entries: EventEditEntry[];
  /**
   * Append-only. Returns the newly created entry (caller stores entry.id
   * in UpdateLiveEventResult.editLogEntryId).
   */
  recordEdit: (entry: Omit<EventEditEntry, "id" | "editedAt">) => EventEditEntry;
  /** All entries for an event, newest first. */
  getEditsForEvent: (eventId: string) => EventEditEntry[];
  /** Single most-recent entry for an event, or null. */
  getLatestEditForEvent: (eventId: string) => EventEditEntry | null;
  /**
   * All entries for an event whose `editedAt` is strictly greater than
   * `sinceIso`. Used by Cycle 9c material-change banner.
   */
  getEditsForEventSince: (eventId: string, sinceIso: string) => EventEditEntry[];
  /** Logout reset — wired via `clearAllStores`. */
  reset: () => void;
}

const generateEditEntryId = (): string => {
  const ts36 = Date.now().toString(36);
  const rand4 = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `ee_${ts36}_${rand4}`;
};

type PersistedState = Pick<EventEditLogState, "entries">;

const persistOptions: PersistOptions<EventEditLogState, PersistedState> = {
  name: "mingla-business.eventEditLog.v1",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (s): PersistedState => ({ entries: s.entries }),
  version: 1,
};

export const useEventEditLogStore = create<EventEditLogState>()(
  persist(
    (set, get) => ({
      entries: [],
      recordEdit: (entry): EventEditEntry => {
        const newEntry: EventEditEntry = {
          ...entry,
          id: generateEditEntryId(),
          editedAt: new Date().toISOString(),
        };
        // Prepend so getEditsForEvent returns newest-first naturally.
        set((s) => ({ entries: [newEntry, ...s.entries] }));
        return newEntry;
      },
      getEditsForEvent: (eventId): EventEditEntry[] =>
        get().entries.filter((e) => e.eventId === eventId),
      getLatestEditForEvent: (eventId): EventEditEntry | null => {
        const filtered = get().entries.filter((e) => e.eventId === eventId);
        return filtered.length > 0 ? filtered[0] : null;
      },
      getEditsForEventSince: (eventId, sinceIso): EventEditEntry[] =>
        get().entries.filter(
          (e) => e.eventId === eventId && e.editedAt > sinceIso,
        ),
      reset: (): void => {
        set({ entries: [] });
      },
    }),
    persistOptions,
  ),
);
