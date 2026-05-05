/**
 * useCurrentBrandRole — React Query hook for the current user's role within a brand (Cycle 13a).
 *
 * SPEC §4.6. Reads `brand_team_members` for the authenticated user; on null,
 * falls back to account_owner SYNTHESIS for solo operators (brand creator's
 * auth.uid() === creator_accounts.user_id of brands.account_id).
 *
 * The synthesis fallback is CRITICAL — without it, every existing solo
 * operator on a deploy of Cycle 13a loses access (no brand_team_members row
 * yet). The synthesis matches the SQL-side authority: RLS treats the brand
 * creator as account_owner via the same join chain (see biz_rank_for_caller
 * function in the b1 migration: brands.account_id → creator_accounts.user_id).
 *
 * [TRANSITIONAL] Stub-mode synthesis fallback (Cycle 13a rework v2 / DEC-092):
 * the local-only stub brands seeded by `brandList.STUB_BRANDS` (lm / tll / sl
 * / hr) DO NOT exist in the production `brands` table. The DB synthesis chain
 * returns null for those IDs, leaving rank=0 and locking the operator out of
 * every gated surface (Create event, Edit event, Refund, etc. — 9 surfaces
 * total). To bridge this gap until B-cycle persists real brand rows, the hook
 * reads `currentBrandStore.brand.role` (`'owner' | 'admin'`) when the DB
 * chain returns null and synthesizes the corresponding 6-role enum value.
 *
 * EXIT CONDITION: B-cycle ships brand persistence + brand_team_members writes
 * → DB chain returns real values → stub branch becomes dead code (the
 * `data.role` from the queryFn always wins when present, so the stub branch
 * only fires for un-persisted local brands).
 *
 * Stale-store risk: if B-cycle later demotes the operator's role on a brand
 * (e.g. account_owner → event_manager) but the local `Brand.role` is still
 * "owner", the DB query returns the demoted role → `data.role` wins → stub
 * fallback does NOT override. Safe.
 *
 * Const #5: server state in React Query — never Zustand. I-32: rank values
 * mirror SQL biz_role_rank() verbatim (CI grep gate enforces parity).
 *
 * Failure posture: any fetch error → consumer sees `isError: true` and
 * `rank: 0`; gates default-closed (defensive). The RLS server-side enforcement
 * is the ultimate safety net; mobile gates are the UX convenience layer.
 */

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import { useCurrentBrandStore } from "../store/currentBrandStore";
import {
  BRAND_ROLE_RANK,
  NO_MEMBERSHIP_RANK,
  type BrandRole,
} from "../utils/brandRole";

export interface CurrentBrandRoleState {
  role: BrandRole | null;
  rank: number;
  permissionsOverride: Record<string, unknown>;
  isLoading: boolean;
  isError: boolean;
}

const STALE_TIME_MS = 5 * 60 * 1000; // 5 min — role changes are rare

export const brandRoleKeys = {
  all: ["brand-role"] as const,
  byBrand: (brandId: string, userId: string): readonly [string, string, string] =>
    ["brand-role", brandId, userId] as const,
};

interface QueryResult {
  role: BrandRole | null;
  permissionsOverride: Record<string, unknown>;
}

const DISABLED_KEY = ["brand-role-disabled"] as const;

export const useCurrentBrandRole = (
  brandId: string | null,
): CurrentBrandRoleState => {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const enabled = brandId !== null && userId !== null;

  // [TRANSITIONAL] stub-mode synthesis input — read the local brand's
  // `Brand.role` so we can synthesize when the DB chain returns null for
  // local-only stub brands. EXIT: B-cycle persists brand rows.
  const stubBrandRole = useCurrentBrandStore((s) => {
    if (brandId === null) return null;
    return s.brands.find((b) => b.id === brandId)?.role ?? null;
  });

  const { data, isLoading, isError } = useQuery<QueryResult>({
    queryKey: enabled
      ? brandRoleKeys.byBrand(brandId, userId)
      : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<QueryResult> => {
      if (!enabled || brandId === null || userId === null) {
        return { role: null, permissionsOverride: {} };
      }
      // Step 1: try brand_team_members for active row.
      const { data: memberRow, error: memberErr } = await supabase
        .from("brand_team_members")
        .select("role, permissions_override")
        .eq("brand_id", brandId)
        .eq("user_id", userId)
        .is("removed_at", null)
        .maybeSingle();
      if (memberErr) throw memberErr;
      if (memberRow !== null) {
        return {
          role: memberRow.role as BrandRole,
          permissionsOverride:
            (memberRow.permissions_override as Record<string, unknown> | null) ??
            {},
        };
      }
      // Step 2: account_owner synthesis fallback for solo operators.
      // Without this, every existing solo operator loses access on deploy.
      const { data: brandRow, error: brandErr } = await supabase
        .from("brands")
        .select("account_id")
        .eq("id", brandId)
        .maybeSingle();
      if (brandErr) throw brandErr;
      if (brandRow === null) {
        return { role: null, permissionsOverride: {} };
      }
      const { data: accountRow, error: accountErr } = await supabase
        .from("creator_accounts")
        .select("user_id")
        .eq("id", brandRow.account_id)
        .maybeSingle();
      if (accountErr) throw accountErr;
      if (accountRow !== null && accountRow.user_id === userId) {
        return { role: "account_owner", permissionsOverride: {} };
      }
      return { role: null, permissionsOverride: {} };
    },
  });

  let role: BrandRole | null = data?.role ?? null;

  // [TRANSITIONAL] stub-mode synthesis fallback — fires when the DB chain
  // returns no role (typically because the brand is a local-only stub from
  // `brandList.STUB_BRANDS` and isn't persisted to the production DB yet).
  // Maps the existing local-only `Brand.role` enum to the 6-role enum:
  //   "owner" → "account_owner" (rank 60 — top of hierarchy)
  //   "admin" → "brand_admin"   (rank 50)
  // Once B-cycle persists brands + brand_team_members, the queryFn returns
  // a non-null role on Step 1 or Step 2, `data.role` wins above, and this
  // branch becomes dead code. EXIT condition documented in file header.
  if (role === null && stubBrandRole !== null) {
    if (stubBrandRole === "owner") {
      role = "account_owner";
    } else if (stubBrandRole === "admin") {
      role = "brand_admin";
    }
  }

  const rank = role !== null ? BRAND_ROLE_RANK[role] : NO_MEMBERSHIP_RANK;
  const permissionsOverride = data?.permissionsOverride ?? {};

  return { role, rank, permissionsOverride, isLoading, isError };
};
