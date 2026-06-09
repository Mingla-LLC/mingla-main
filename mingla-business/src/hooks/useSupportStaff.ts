/**
 * useSupportStaff — META-ORCH-1104 Phase 3 (business-app staff console).
 *
 * React Query hook for the signed-in user's OWN `support_staff` capability row.
 * Brand-DECOUPLED: keyed on `user.id`, NEVER `currentBrandId` (SPEC §7.1,
 * I-1104-STAFF-DECOUPLED, Lane C Finding 3). Support staffing is a Mingla-admin
 * grant on the person, not a brand-team role — a staffer with no brand at all is
 * still staff, and a brand owner who is not granted is not.
 *
 * Mirrors `useCurrentBrandRole` discipline: short, security-adjacent stale-time
 * (a revoked staffer must lose the console quickly); server state lives in React
 * Query, never Zustand (Const #5). The client gate this hook powers is COSMETIC —
 * the real boundary is `is_support_staff()` RLS server-side (SPEC §3.3). A
 * non-staff user who forces past the hidden card still reads zero queue rows.
 *
 * RLS: `support_staff_self_read` lets a user read ONLY their own row, so this
 * `.eq("user_id", userId)` returns the caller's row or nothing — never another
 * user's staffing state.
 *
 * Per SPEC §7.1.
 */

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";

// Security-adjacent: a revoked staffer should lose the console fast. Mirrors
// useCurrentBrandRole's 30s tightening (role drift = S0/S1 risk).
const STALE_TIME_MS = 30 * 1000;

export interface SupportStaffState {
  /** True only when an `support_staff` row exists AND `enabled = true`. */
  isStaff: boolean;
  /** The raw `enabled` column (admin-controlled). */
  enabled: boolean;
  /** The staffer's self-set on-duty flag (drives new-ticket push fan-out). */
  available: boolean;
  /** 'staff' | 'lead' (support_staff.role); null when not staff. */
  role: string | null;
  isLoading: boolean;
  isError: boolean;
}

interface QueryResult {
  enabled: boolean;
  available: boolean;
  role: string | null;
}

const DISABLED_KEY = ["support", "staff", "disabled"] as const;

export const supportStaffKeys = {
  all: ["support", "staff"] as const,
  byUser: (userId: string): readonly [string, string, string] =>
    ["support", "staff", userId] as const,
};

const EMPTY: QueryResult = { enabled: false, available: false, role: null };

export const useSupportStaff = (): SupportStaffState => {
  const { isAuthReady, user } = useAuth();
  const userId = user?.id ?? null;
  // Tighten on isAuthReady (mirrors useCurrentBrandRole / ORCH-1004): firing
  // before the access_token is attached returns a null row that caches as
  // "not staff" and hides the console until a manual refresh.
  const enabledQuery = isAuthReady && userId !== null;

  const { data, isLoading, isError } = useQuery<QueryResult>({
    queryKey: enabledQuery ? supportStaffKeys.byUser(userId) : DISABLED_KEY,
    enabled: enabledQuery,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<QueryResult> => {
      if (!enabledQuery || userId === null) return EMPTY;
      const { data: row, error } = await supabase
        .from("support_staff")
        .select("enabled, available, role")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (row === null) return EMPTY;
      return {
        enabled: row.enabled === true,
        available: row.available === true,
        role: typeof row.role === "string" ? row.role : null,
      };
    },
  });

  const resolved = data ?? EMPTY;
  return {
    // isStaff requires an enabled row — a disabled/absent row is NOT staff,
    // mirroring is_support_staff()'s `enabled = true` predicate server-side.
    isStaff: resolved.enabled === true,
    enabled: resolved.enabled,
    available: resolved.available,
    role: resolved.role,
    isLoading,
    isError,
  };
};
