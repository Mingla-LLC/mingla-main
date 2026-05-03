/**
 * guestStore — persisted Zustand store for operator-created comp guests.
 *
 * Cycle 10: comp guests live client-only. B-cycle migrates to backend
 * (decision deferred to B-cycle SPEC: either tickets table with
 * order_id IS NULL OR a new comp_guests table with its own RLS).
 *
 * I-25: Comp guests live in useGuestStore.entries ONLY — NEVER as
 * phantom OrderRecord rows (would violate I-19 immutable order
 * financials). CheckoutPaymentMethod union does NOT include "comp".
 *
 * Constitutional notes:
 *   - #2 one owner per truth: comp guests live ONLY here. NEVER duplicated
 *     in liveEventStore or orderStore.
 *   - #6 logout clears: extended via `clearAllStores`.
 *   - #9 no fabricated data: store starts EMPTY; never seeded.
 *
 * API surface:
 *   - recordCompEntry — append-only mutation; returns the new entry so
 *     caller can fire side effects (audit log via useEventEditLogStore).
 *   - removeCompEntry — returns the removed entry or null; caller fires
 *     audit log entry. Side effects fired by COMPONENT layer to break
 *     potential require cycles (Cycle 9c v2 lesson).
 *   - reset — logout cascade.
 *   - getCompEntriesForEvent — fresh array; USE VIA .getState() ONLY,
 *     never via direct subscription (would break useSyncExternalStore).
 *   - getCompEntryById — single existing reference; safe to subscribe.
 *
 * [TRANSITIONAL] Zustand persist holds entries client-side. B-cycle
 * migrates to Supabase. When backend lands, this store contracts to a
 * cache + ID-only.
 *
 * Per Cycle 10 SPEC §4.4.
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
  /** Returns the new entry (caller fires audit log + notification side effects). */
  recordCompEntry: (
    entry: Omit<CompGuestEntry, "id" | "addedAt">,
  ) => CompGuestEntry;
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

// ---- ID generator ---------------------------------------------------

const generateCompId = (): string => {
  const ts36 = Date.now().toString(36);
  const rand4 = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `cg_${ts36}_${rand4}`;
};

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

      recordCompEntry: (entry): CompGuestEntry => {
        const newEntry: CompGuestEntry = {
          ...entry,
          id: generateCompId(),
          addedAt: new Date().toISOString(),
        };
        // Prepend so getCompEntriesForEvent returns newest-first naturally.
        set((s) => ({ entries: [newEntry, ...s.entries] }));
        // Side effects (audit log) fired by caller (AddCompGuestSheet) to
        // keep the store pure-data and avoid require-cycle pitfalls.
        return newEntry;
      },

      removeCompEntry: (id): CompGuestEntry | null => {
        const existing = get().entries.find((e) => e.id === id);
        if (existing === undefined) return null;
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
        // Side effects fired by caller (J-G2 detail's remove handler).
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
