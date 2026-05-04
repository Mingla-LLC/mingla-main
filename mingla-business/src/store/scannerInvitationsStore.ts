/**
 * scannerInvitationsStore — persisted Zustand store for scanner-team invitations (Cycle 11).
 *
 * I-28: UI-ONLY in Cycle 11. recordInvitation creates a pending invitation
 * in client-side store; NO email is sent, NO acceptance flow exists, NO
 * auth gate is enforced. Operator sees pending invitations in their
 * scanner-team list with TRANSITIONAL "emails ship in B-cycle" copy.
 *
 * Const #1 No dead taps: operator's "Invite scanner" tap creates a visible
 * pending entry in the local store; the row's PENDING pill + TRANSITIONAL
 * subtext is honest state. NOT a dead tap.
 *
 * [TRANSITIONAL] EXIT CONDITION: B-cycle wires:
 *   - edge function `invite-scanner` (writes to scanner_invitations + sends Resend email)
 *   - edge function `accept-scanner-invitation` (writes to event_scanners on token-gated route)
 *   - `/event/[id]/scanner` route auth-gate checks event_scanners membership for non-operator users
 *
 * When backend lands, this store contracts to a cache (or removes entirely
 * if backend is sole authority).
 *
 * Constitutional notes:
 *   - #2 one owner per truth: invitations live ONLY here.
 *   - #6 logout clears: extended via `clearAllStores`.
 *   - #9 no fabricated data: store starts EMPTY; never seeded.
 *
 * Per Cycle 11 SPEC §4.7.
 *
 * Cycle 13a continuity: the brand-team-member equivalent of this scanner
 * invitation pattern ships at `src/store/brandTeamStore.ts` (Cycle 13a SPEC
 * §4.7). Both stores follow the I-28 / I-31 TRANSITIONAL UI-only pattern
 * until B-cycle wires the corresponding edge functions
 * (`invite-scanner` / `invite-brand-member`). NO logic change to this file —
 * cross-reference only.
 *
 * Cycle 13b Q1 (SPEC §4.5 / DEC-093): `canManualCheckIn` field DROPPED from
 * `ScannerPermissions`. The field was decorative in Cycle 11/12 (gated 0
 * consumers in scan logic, only rendered an informational pill on the team
 * list). Persist v1→v2 migration strips the field on hydrate. The
 * `canAcceptPayments` toggle (Cycle 12 Decision #4) STAYS unchanged.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

// ---- Types -----------------------------------------------------------

export type ScannerInvitationStatus = "pending" | "accepted" | "revoked";

export interface ScannerPermissions {
  /** Always true — scanners can always scan. */
  canScan: boolean;
  // Cycle 12 — operator-controllable per scanner. Semantics = "can take
  // cash + manual payments at the door". Card reader + NFC remain
  // TRANSITIONAL until B-cycle Stripe Terminal SDK lands.
  canAcceptPayments: boolean;
}

export interface ScannerInvitation {
  /** si_<base36-ts>_<base36-rand4> */
  id: string;
  eventId: string;
  brandId: string;
  inviteeEmail: string;
  inviteeName: string;
  permissions: ScannerPermissions;
  status: ScannerInvitationStatus;
  /** Operator account_id who sent the invitation. */
  invitedBy: string;
  /** ISO 8601. */
  invitedAt: string;
  /** null until B-cycle wires acceptance flow. */
  acceptedAt: string | null;
  /** null unless operator revoked. */
  revokedAt: string | null;
}

export interface ScannerInvitationsStoreState {
  entries: ScannerInvitation[];
  // ---- Mutations ----
  recordInvitation: (
    entry: Omit<
      ScannerInvitation,
      "id" | "invitedAt" | "status" | "acceptedAt" | "revokedAt"
    >,
  ) => ScannerInvitation;
  /** Sets status="revoked" + revokedAt. Returns updated record or null. */
  revokeInvitation: (id: string) => ScannerInvitation | null;
  /** Logout reset. */
  reset: () => void;
  // ---- Selectors ----
  /** Fresh array; USE VIA .getState() ONLY (never direct subscription). */
  getInvitationsForEvent: (eventId: string) => ScannerInvitation[];
  /** Single existing reference; safe to subscribe. */
  getInvitationById: (id: string) => ScannerInvitation | null;
}

// ---- ID generator ---------------------------------------------------

const generateInviteId = (): string => {
  const ts36 = Date.now().toString(36);
  const rand4 = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `si_${ts36}_${rand4}`;
};

// ---- Persistence ----------------------------------------------------

type PersistedState = Pick<ScannerInvitationsStoreState, "entries">;

const persistOptions: PersistOptions<
  ScannerInvitationsStoreState,
  PersistedState
> = {
  name: "mingla-business.scannerInvitationsStore.v2",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (s): PersistedState => ({ entries: s.entries }),
  version: 2,
  migrate: (persistedState, version) => {
    // v1 → v2 (Cycle 13b Q1 / SPEC §4.5): drop `canManualCheckIn` from each
    // entry's permissions. The field was decorative-only in Cycle 11/12 —
    // never consumed in scan logic. Verbatim destructure ensures the key
    // is GONE post-hydrate, not just `undefined`.
    if (version === 1) {
      const v1 = persistedState as {
        entries: Array<{
          permissions: {
            canScan: boolean;
            canManualCheckIn?: boolean;
            canAcceptPayments: boolean;
          };
          [key: string]: unknown;
        }>;
      };
      return {
        entries: (v1.entries ?? []).map((e) => {
          const { canManualCheckIn: _drop, ...restPerms } = e.permissions;
          return { ...e, permissions: restPerms };
        }),
      } as PersistedState;
    }
    return persistedState as PersistedState;
  },
};

// ---- Store ----------------------------------------------------------

export const useScannerInvitationsStore =
  create<ScannerInvitationsStoreState>()(
    persist(
      (set, get) => ({
        entries: [],

        // ---- Mutations ----

        recordInvitation: (entry): ScannerInvitation => {
          const newEntry: ScannerInvitation = {
            ...entry,
            id: generateInviteId(),
            invitedAt: new Date().toISOString(),
            status: "pending",
            acceptedAt: null,
            revokedAt: null,
          };
          set((s) => ({ entries: [newEntry, ...s.entries] }));
          return newEntry;
        },

        revokeInvitation: (id): ScannerInvitation | null => {
          const existing = get().entries.find((e) => e.id === id);
          if (existing === undefined) return null;
          if (existing.status !== "pending") return existing; // idempotent
          const updated: ScannerInvitation = {
            ...existing,
            status: "revoked",
            revokedAt: new Date().toISOString(),
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

        getInvitationsForEvent: (eventId): ScannerInvitation[] =>
          get().entries.filter((e) => e.eventId === eventId),

        getInvitationById: (id): ScannerInvitation | null =>
          get().entries.find((e) => e.id === id) ?? null,
      }),
      persistOptions,
    ),
  );
