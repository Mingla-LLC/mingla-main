/**
 * guestStore — #3827: legacy device-only comps; read only to offer Re-add;
 * never written.
 *
 * Before #3827 a host's "comp guest" was saved only on the phone that added
 * it: no ticket, no QR, no email, invisible to the door scanner. Guest-list
 * guests are now real server orders (source = comp) issued through the
 * guest-list edge function. This store survives only so a phone that still
 * holds old entries can show the Guests screen's one-time "Re-add" banner;
 * each entry is removed once it is re-added on the server.
 *
 * API surface:
 *   - entries — the legacy entries (read only; never appended to).
 *   - removeCompEntry — drop one entry after it was re-added on the server.
 *   - reset — logout cascade (clearAllStores).
 *   - getCompEntriesForEvent — fresh array; USE VIA .getState() ONLY.
 *   - getCompEntryById — single existing reference; safe to subscribe.
 *
 * [TRANSITIONAL] Exit: delete this store once no live install can hold
 * pre-#3827 entries (after a native build that shipped #3827 has been the
 * minimum supported version for one release).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

// ---- Types -----------------------------------------------------------

export interface CompGuestEntry {
  /** cg_<base36-ts>_<base36-rand4> */
  id: string;
  eventId: string;
  /** Denormalized for fast brand-scoped queries. */
  brandId: string;
  /** Operator-supplied. 1..120 chars trimmed. NEVER empty. */
  name: string;
  /** Operator-supplied. 1..200 chars trimmed. */
  email: string;
  /** Empty string if not provided. 0..50 chars. */
  phone: string;
  /** Optional ticket type association. null = "general comp". */
  ticketTypeId: string | null;
  /** Snapshot at creation if ticketTypeId set; null otherwise. */
  ticketNameAtCreation: string | null;
  /** ISO 8601. */
  addedAt: string;
  /** Operator account_id (audit). */
  addedBy: string;
  /** Operator-provided, optional. 0..200 chars trimmed. */
  notes: string;
}

export interface GuestStoreState {
  entries: CompGuestEntry[];
  // ---- Mutations ----
  /** Returns the removed entry, or null if id not found. */
  removeCompEntry: (id: string) => CompGuestEntry | null;
  /** Logout reset — wired via clearAllStores. */
  reset: () => void;
  // ---- Selectors ----
  /**
   * All comp entries for an event, newest first.
   * USE VIA .getState() ONLY — fresh array breaks useSyncExternalStore
   * Object.is on direct subscription. For component reads, use raw
   * `entries` + useMemo (see SPEC §4.4 selector rules).
   */
  getCompEntriesForEvent: (eventId: string) => CompGuestEntry[];
  /** Safe to subscribe — single existing reference. */
  getCompEntryById: (id: string) => CompGuestEntry | null;
}

// ---- Persistence ----------------------------------------------------

type PersistedState = Pick<GuestStoreState, "entries">;

const persistOptions: PersistOptions<GuestStoreState, PersistedState> = {
  name: "mingla-business.guestStore.v1",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (s): PersistedState => ({ entries: s.entries }),
  version: 1,
};

// ---- Store ----------------------------------------------------------

export const useGuestStore = create<GuestStoreState>()(
  persist(
    (set, get) => ({
      entries: [],

      // ---- Mutations ----

      removeCompEntry: (id): CompGuestEntry | null => {
        const existing = get().entries.find((e) => e.id === id);
        if (existing === undefined) return null;
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
        // issue #3827: called after the entry was re-added on the server.
        return existing;
      },

      reset: (): void => {
        set({ entries: [] });
      },

      // ---- Selectors ----

      getCompEntriesForEvent: (eventId): CompGuestEntry[] =>
        get().entries.filter((e) => e.eventId === eventId),

      getCompEntryById: (id): CompGuestEntry | null =>
        get().entries.find((e) => e.id === id) ?? null,
    }),
    persistOptions,
  ),
);
