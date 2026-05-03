/**
 * scanStore — persisted Zustand store for ticket scan events (Cycle 11).
 *
 * I-27: Each ticketId scanned exactly once at scanResult==="success". Cycle 11
 * enforces this client-side via getSuccessfulScanByTicketId. B-cycle DB
 * enforcement (scan_events.ticket_id partial UNIQUE index WHERE
 * scan_result='success' OR edge-function pre-insert check) MUST land before
 * multi-device door operations.
 *
 * [TRANSITIONAL] Client-side authoritative until B-cycle. offlineQueued: true
 * on every scan today (no backend sync). When B-cycle ships scan-ticket edge
 * function:
 *   - flip offlineQueued: false after server ack on each entry
 *   - on next sync after offline period, batch-replay queued entries
 *   - DB UNIQUE constraint deduplicates against existing server-side rows
 *
 * Constitutional notes:
 *   - #2 one owner per truth: scans live ONLY here. NEVER duplicated in
 *     orderStore or guestStore.
 *   - #6 logout clears: extended via `clearAllStores`.
 *   - #9 no fabricated data: store starts EMPTY; never seeded.
 *
 * API surface:
 *   - recordScan — append-only mutation; returns the new ScanRecord so caller
 *     can fire side effects (audit log / activity feed). Pure data store.
 *   - reset — logout cascade.
 *   - getScanByTicketId — latest scan (any result). Single existing reference;
 *     safe to subscribe.
 *   - getSuccessfulScanByTicketId — latest successful scan only — used by J-S3
 *     duplicate guard. Safe to subscribe.
 *   - getScansForOrder / getScansForEvent — fresh arrays; USE VIA .getState()
 *     ONLY (one-shot lookups). For component reads, use raw entries + useMemo
 *     (see Cycle 9c v2 selector lesson).
 *
 * Per Cycle 11 SPEC §4.6.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

// ---- Types -----------------------------------------------------------

export type ScanResult =
  | "success"
  | "duplicate"
  | "wrong_event"
  | "not_found"
  | "void"
  | "cancelled_order";

export interface ScanRecord {
  /** sc_<base36-ts>_<base36-rand4> */
  id: string;
  /** tkt_<orderSuffix>_<lineIdx>_<seatIdx> OR cg_xxx (synthetic for manual comp check-in) */
  ticketId: string;
  /** ord_xxxxx — derived from ticketId for order scans; empty string for comp scans */
  orderId: string;
  /** For cross-event filtering. */
  eventId: string;
  /** Denormalized for brand-scoped queries. */
  brandId: string;
  /** Operator account_id (auth.users.id); audit. */
  scannerUserId: string;
  /** ISO 8601. */
  scannedAt: string;
  scanResult: ScanResult;
  /** "qr" = scanned via camera; "manual" = checked in via J-G2 CTA. */
  via: "qr" | "manual";
  /** True until B-cycle wires backend sync; today always true. */
  offlineQueued: boolean;
  /** Display cache (recoverable from order/comp lookup). */
  buyerNameAtScan: string;
  ticketNameAtScan: string;
}

export interface ScanStoreState {
  entries: ScanRecord[];
  // ---- Mutations ----
  /** Append-only. Returns the new ScanRecord (caller fires audit log). */
  recordScan: (entry: Omit<ScanRecord, "id" | "scannedAt">) => ScanRecord;
  /** Logout reset — wired via clearAllStores. */
  reset: () => void;
  // ---- Selectors ----
  /** Single existing reference; safe to subscribe. Returns the LATEST scan (any result) for the ticketId. */
  getScanByTicketId: (ticketId: string) => ScanRecord | null;
  /** Successful scan only — used by J-S3 duplicate guard. */
  getSuccessfulScanByTicketId: (ticketId: string) => ScanRecord | null;
  /** Fresh array; USE VIA .getState() ONLY (never direct subscription). */
  getScansForOrder: (orderId: string) => ScanRecord[];
  getScansForEvent: (eventId: string) => ScanRecord[];
}

// ---- ID generator ---------------------------------------------------

const generateScanId = (): string => {
  const ts36 = Date.now().toString(36);
  const rand4 = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `sc_${ts36}_${rand4}`;
};

// ---- Persistence ----------------------------------------------------

type PersistedState = Pick<ScanStoreState, "entries">;

const persistOptions: PersistOptions<ScanStoreState, PersistedState> = {
  name: "mingla-business.scanStore.v1",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (s): PersistedState => ({ entries: s.entries }),
  version: 1,
};

// ---- Store ----------------------------------------------------------

export const useScanStore = create<ScanStoreState>()(
  persist(
    (set, get) => ({
      entries: [],

      // ---- Mutations ----

      // Caller-side audit log per Cycle 9c v2 require-cycle pattern;
      // orderId === "" indicates comp manual check-in (synthetic ticketId = comp.id).
      recordScan: (entry): ScanRecord => {
        const newEntry: ScanRecord = {
          ...entry,
          id: generateScanId(),
          scannedAt: new Date().toISOString(),
        };
        // Prepend so getScansForEvent returns newest-first naturally.
        set((s) => ({ entries: [newEntry, ...s.entries] }));
        return newEntry;
      },

      reset: (): void => {
        set({ entries: [] });
      },

      // ---- Selectors ----

      // Latest scan across ALL results (used by getScansForOrder consumers
      // who want any record). Newest-first prepend means find() returns
      // latest naturally.
      getScanByTicketId: (ticketId): ScanRecord | null =>
        get().entries.find((s) => s.ticketId === ticketId) ?? null,

      getSuccessfulScanByTicketId: (ticketId): ScanRecord | null =>
        get().entries.find(
          (s) => s.ticketId === ticketId && s.scanResult === "success",
        ) ?? null,

      getScansForOrder: (orderId): ScanRecord[] =>
        get().entries.filter((s) => s.orderId === orderId),

      getScansForEvent: (eventId): ScanRecord[] =>
        get().entries.filter((s) => s.eventId === eventId),
    }),
    persistOptions,
  ),
);
