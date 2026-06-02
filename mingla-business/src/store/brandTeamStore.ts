/**
 * brandTeamStore — in-memory optimistic cache for brand-team invitations
 * during the "Invite tapped → edge fn returned" window (ORCH-1050).
 *
 * Status: ACTIVE post-ORCH-1050. Was [TRANSITIONAL] when invitations lived
 * only client-side (Cycle 13a). ORCH-1050 wired the real backend pipeline
 * (`brand_invitations` table + `invite-brand-member` + `accept-brand-invitation`
 * edge fns + ownership-transfer RPC), so canonical state now lives in
 * Postgres and is read via React Query (`useBrandInvitations` /
 * `useBrandTeamMembers`). This store:
 *
 *   - holds OPTIMISTIC pending rows for the ~600ms between user tap and
 *     the edge fn returning success — keeps the team list responsive,
 *     - does NOT persist to AsyncStorage (no rehydration on app boot;
 *     the React Query cache is the source of truth on cold start),
 *   - is cleared on logout via clearAllStores().
 *
 * Constitutional notes:
 *   - Const #2 one owner per truth: React Query owns canonical state;
 *     this store owns short-lived optimistic state only.
 *   - Const #5 server state in React Query: invitations queries live in
 *     useBrandInvitations.ts. This module is not server state — it is
 *     an in-flight optimistic buffer.
 *   - Const #6 logout clears: reset() is registered with clearAllStores.
 *   - Const #9 no fabricated data: store starts EMPTY; never seeded.
 */

import { create } from "zustand";

import type { BrandRole } from "../utils/brandRole";

// ---- Types -----------------------------------------------------------

export type BrandTeamEntryStatus = "pending" | "accepted" | "removed";

export interface BrandTeamEntry {
  /** Client-side optimistic id; replaced by the server-issued UUID once
   * the edge fn returns. Prefixed with bti_ for clarity. */
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
  /** Reserved — not populated by optimistic flow. */
  acceptedAt: string | null;
  /** Reserved — not populated by optimistic flow. */
  removedAt: string | null;
}

export interface BrandTeamStoreState {
  entries: BrandTeamEntry[];
  // ---- Mutations ----
  /** Adds an OPTIMISTIC pending entry. Caller is responsible for clearing it
   * (via clearEntry(id)) once the edge fn returns and React Query refetches. */
  recordInvitation: (
    entry: Omit<
      BrandTeamEntry,
      "id" | "invitedAt" | "status" | "acceptedAt" | "removedAt"
    >,
  ) => BrandTeamEntry;
  /** Removes an optimistic entry by id. */
  clearEntry: (id: string) => void;
  /** Logout reset. */
  reset: () => void;
  // ---- Selectors ----
  getEntryById: (id: string) => BrandTeamEntry | null;
  getEntriesForBrand: (brandId: string) => BrandTeamEntry[];
}

// ---- ID generator --------------------------------------------------

const generateInviteId = (): string => {
  const ts36 = Date.now().toString(36);
  const rand4 = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `bti_${ts36}_${rand4}`;
};

// ---- Store ----------------------------------------------------------
// No persist middleware — short-lived in-memory only.

export const useBrandTeamStore = create<BrandTeamStoreState>()((set, get) => ({
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

  clearEntry: (id): void => {
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
  },

  reset: (): void => {
    set({ entries: [] });
  },

  // ---- Selectors ----

  getEntryById: (id): BrandTeamEntry | null =>
    get().entries.find((e) => e.id === id) ?? null,

  getEntriesForBrand: (brandId): BrandTeamEntry[] =>
    get().entries.filter((e) => e.brandId === brandId),
}));
