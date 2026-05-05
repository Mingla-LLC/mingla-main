/**
 * brandTeamStore — persisted Zustand store for brand-team invitations + accepted members (Cycle 13a).
 *
 * I-31: UI-ONLY in Cycle 13a. recordInvitation creates a pending invitation
 * in client-side store; NO email is sent, NO acceptance flow exists, NO
 * functional brand-team-member sync to brand_team_members DB table.
 *
 * [TRANSITIONAL] EXIT CONDITION: B-cycle wires:
 *   - edge function `invite-brand-member` (writes to brand_invitations + sends Resend email)
 *   - edge function `accept-brand-invitation` (writes to brand_team_members on token-gated route)
 *
 * When backend lands, this store contracts to a cache (or removes entirely
 * if backend is sole authority).
 *
 * Constitutional notes:
 *   - #2 one owner per truth: brand-team UI invitations live ONLY here.
 *   - #6 logout clears: extended via clearAllStores.
 *   - #9 no fabricated data: store starts EMPTY; never seeded.
 *
 * Per Cycle 13a SPEC §4.7. Mirrors Cycle 11 scannerInvitationsStore pattern.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

import type { BrandRole } from "../utils/brandRole";

// ---- Types -----------------------------------------------------------

export type BrandTeamEntryStatus = "pending" | "accepted" | "removed";

export interface BrandTeamEntry {
  /** btm_<base36-ts>_<base36-rand4> for accepted; bti_<...> for pending. */
  id: string;
  brandId: string;
  inviteeEmail: string;
  inviteeName: string;
  role: BrandRole;
  status: BrandTeamEntryStatus;
  /** Operator account_id who sent the invitation. */
  invitedBy: string;
  /** ISO 8601. */
  invitedAt: string;
  /** null until B-cycle wires acceptance flow. */
  acceptedAt: string | null;
  /** null unless operator revoked or removed. */
  removedAt: string | null;
}

export interface BrandTeamStoreState {
  entries: BrandTeamEntry[];
  // ---- Mutations ----
  recordInvitation: (
    entry: Omit<
      BrandTeamEntry,
      "id" | "invitedAt" | "status" | "acceptedAt" | "removedAt"
    >,
  ) => BrandTeamEntry;
  /** Pending → removed. Idempotent for non-pending. Returns updated record or null. */
  revokeInvitation: (id: string) => BrandTeamEntry | null;
  /** Accepted → removed. Idempotent for non-accepted. Returns updated record or null. */
  removeAcceptedMember: (id: string) => BrandTeamEntry | null;
  /** Logout reset. */
  reset: () => void;
  // ---- Selectors ----
  /** Single existing reference; safe to subscribe. */
  getEntryById: (id: string) => BrandTeamEntry | null;
  /** Fresh array; USE VIA .getState() ONLY for one-shot lookups. Component reads use raw entries + useMemo. */
  getEntriesForBrand: (brandId: string) => BrandTeamEntry[];
}

// ---- ID generators --------------------------------------------------

const generateInviteId = (): string => {
  const ts36 = Date.now().toString(36);
  const rand4 = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `bti_${ts36}_${rand4}`;
};

// ---- Persistence ----------------------------------------------------

type PersistedState = Pick<BrandTeamStoreState, "entries">;

const persistOptions: PersistOptions<BrandTeamStoreState, PersistedState> = {
  name: "mingla-business.brandTeamStore.v1",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (s): PersistedState => ({ entries: s.entries }),
  version: 1,
};

// ---- Store ----------------------------------------------------------

export const useBrandTeamStore = create<BrandTeamStoreState>()(
  persist(
    (set, get) => ({
      entries: [],

      // ---- Mutations ----

      recordInvitation: (entry): BrandTeamEntry => {
        const newEntry: BrandTeamEntry = {
          ...entry,
          id: generateInviteId(),
          invitedAt: new Date().toISOString(),
          status: "pending",
          acceptedAt: null,
          removedAt: null,
        };
        set((s) => ({ entries: [newEntry, ...s.entries] }));
        return newEntry;
      },

      revokeInvitation: (id): BrandTeamEntry | null => {
        const existing = get().entries.find((e) => e.id === id);
        if (existing === undefined) return null;
        if (existing.status !== "pending") return existing; // idempotent
        const updated: BrandTeamEntry = {
          ...existing,
          status: "removed",
          removedAt: new Date().toISOString(),
        };
        set((s) => ({
          entries: s.entries.map((e) => (e.id === id ? updated : e)),
        }));
        return updated;
      },

      removeAcceptedMember: (id): BrandTeamEntry | null => {
        const existing = get().entries.find((e) => e.id === id);
        if (existing === undefined) return null;
        if (existing.status !== "accepted") return existing; // idempotent
        const updated: BrandTeamEntry = {
          ...existing,
          status: "removed",
          removedAt: new Date().toISOString(),
        };
        set((s) => ({
          entries: s.entries.map((e) => (e.id === id ? updated : e)),
        }));
        return updated;
      },

      reset: (): void => {
        set({ entries: [] });
      },

      // ---- Selectors ----

      getEntryById: (id): BrandTeamEntry | null =>
        get().entries.find((e) => e.id === id) ?? null,

      getEntriesForBrand: (brandId): BrandTeamEntry[] =>
        get().entries.filter((e) => e.brandId === brandId),
    }),
    persistOptions,
  ),
);
