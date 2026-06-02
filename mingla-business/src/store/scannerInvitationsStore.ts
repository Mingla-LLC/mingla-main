/**
 * scannerInvitationsStore — optimistic-UI cache for scanner-team invitations.
 *
 * Status: ACTIVE post-ORCH-1051 (META-ORCH-1048 sub-C).
 *
 * Canonical state for scanner invitations lives in
 * `public.scanner_invitations` (server) and is read into the UI via React
 * Query through `useScannerInvitations*` hooks + `scannerInvitationsService`.
 * The legacy [TRANSITIONAL] Cycle 11/12/13 path that persisted invitations
 * to AsyncStorage and never reached the server is GONE.
 *
 * This store remains only as a contract — kept so existing imports
 * (logout reset wiring + smoke tests) keep compiling — but no longer
 * persists to AsyncStorage and no longer holds any UI-of-record state.
 * Calls to `recordInvitation` raise immediately so that any leftover wiring
 * surfaces as a noisy crash, not a silent UI lie.
 *
 * Constitutional notes:
 *   - #2 one owner per truth: scanner invitations live in Postgres now.
 *   - #5 server state in React Query, never Zustand.
 *   - #6 logout clears: `reset()` is still wired into clearAllStores so old
 *     callers don't break; it now no-ops.
 *
 * Per ORCH-1051 SPEC Layer 5.
 */

import { create } from "zustand";

// ---- Types -----------------------------------------------------------

export type ScannerInvitationStatus = "pending" | "accepted" | "revoked";

export interface ScannerPermissions {
  /** Always true — scanners can always scan. */
  canScan: boolean;
  /** Cash + manual at the door. Card reader + NFC remain TRANSITIONAL until
   * the B-cycle Stripe Terminal SDK lands. */
  canAcceptPayments: boolean;
}

export interface ScannerInvitation {
  id: string;
  eventId: string;
  brandId: string;
  inviteeEmail: string;
  inviteeName: string;
  permissions: ScannerPermissions;
  status: ScannerInvitationStatus;
  invitedBy: string;
  invitedAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export interface ScannerInvitationsStoreState {
  entries: ScannerInvitation[];
  /**
   * Hard-deprecated. Server is the sole owner of scanner invitations now.
   * Use `useInviteScanner()` from `src/hooks/useScannerInvitations.ts`.
   */
  recordInvitation: () => never;
  /**
   * Hard-deprecated. Use `useRevokeScannerInvitation()` from
   * `src/hooks/useScannerInvitations.ts`.
   */
  revokeInvitation: () => never;
  /** Logout reset hook. No-op since the store no longer holds state. */
  reset: () => void;
  /** Always returns an empty array — keeps the old call-site signature alive
   *  until call sites migrate to `useScannerInvitationsForEvent()`. */
  getInvitationsForEvent: (eventId: string) => ScannerInvitation[];
  /** Always returns null — keeps the old call-site signature alive until
   *  call sites migrate to the query hooks. */
  getInvitationById: (id: string) => ScannerInvitation | null;
}

// ---- Store ----------------------------------------------------------

const deprecated = (): never => {
  throw new Error(
    "scannerInvitationsStore: server is the sole owner post-ORCH-1051. " +
      "Use useInviteScanner / useRevokeScannerInvitation hooks.",
  );
};

export const useScannerInvitationsStore =
  create<ScannerInvitationsStoreState>()(
    (set) => ({
      entries: [],
      recordInvitation: deprecated,
      revokeInvitation: deprecated,
      reset: (): void => {
        set({ entries: [] });
      },
      getInvitationsForEvent: (): ScannerInvitation[] => [],
      getInvitationById: (): ScannerInvitation | null => null,
    }),
  );
