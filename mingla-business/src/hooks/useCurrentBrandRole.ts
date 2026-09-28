/**
 * useCurrentBrandRole — React Query hook for the current user's role within a brand (Cycle 13a).
 *
 * SPEC §4.6. Reads `brand_team_members` for the authenticated user; on null,
 * falls back to brand_owner SYNTHESIS for solo operators: the brand row's
 * `account_id` IS the owner's auth user id, so `account_id === auth.uid()`
 * means brand_owner.
 *
 * The synthesis fallback is CRITICAL — without it, every existing solo
 * operator on a deploy of Cycle 13a loses access (no brand_team_members row
 * yet). The synthesis mirrors the SQL-side authority verbatim:
 * `public.biz_brand_effective_rank` grants brand_owner via
 * `b.account_id = p_user_id AND b.deleted_at IS NULL` — see
 * 20260819000000_orch_1047_account_owner_to_brand_owner_rename.sql:134-164.
 * The server performs no intermediate account lookup and neither does this
 * hook; #3602 removed the one it used to attempt.
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
 * #3602 — CORRECTION OF RECORD. This header used to claim the stub branch was
 * "dead code in practice" because the DB chain returned real values. The
 * opposite was true for 146 days: Step 2 of the DB chain returned HTTP 400 on
 * every single call (it projected a column that has never existed), so it
 * NEVER produced a value, and this stub branch — fed by `useBrandList()`,
 * which unions directly-owned brands in as `"owner"` — is what actually
 * carried brand_owner for every solo operator. What the broken Step 2 did
 * NOT rescue was `isError`, which stayed permanently true and hard-closed the
 * brand Payments surface. With #3602 fixed, Step 2 resolves for real, so the
 * stub branch is finally what this header always described: a fallback that
 * only fires for un-persisted local brands.
 *
 * EXIT CONDITION: every brand persisted with membership rows → the DB chain
 * answers on Step 1 or Step 2 → `data.role` wins above and the stub branch
 * stops firing. Removing it is a separate blast-radius pass over 40+
 * consumers (#3602 §10 q2), deliberately not done here.
 *
 * Stale-store risk: if B-cycle later demotes the operator's role on a brand
 * (e.g. brand_owner → event_manager) but the local `Brand.role` is still
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
import { useBrandList } from "./useBrandListShim";
import {
  BRAND_ROLE_RANK,
  NO_MEMBERSHIP_RANK,
  type BrandRole,
} from "../utils/brandRole";

export interface CurrentBrandRoleState {
  role: BrandRole | null;
  rank: number;
  permissionsOverride: Record<string, unknown>;
  /**
   * #1863 §4.0.2 — `brand_team_members.accepted_at IS NOT NULL` for this
   * membership. ADDITIVE: `role`, `rank` and `permissionsOverride` semantics
   * are unchanged, because nine other gated surfaces read them.
   *
   * The server requires acceptance on BOTH branches of
   * `biz_can_manage_payments_for_brand`, so `canManageBrandPayments` needs it
   * to mirror the predicate. A pending `brand_admin` who was treated as
   * accepted would get the full payments surface and the identical 403 storm.
   */
  readonly accepted: boolean;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

// ORCH-0740 Cycle 1: tightened from 5min to 30s.
// Role-bearing cache is security-adjacent (permission drift = S0/S1 risk
// per ORCH-0738 CF-1). 30s defense-in-depth until Cycle 3 wires Realtime
// push for brand_team_members changes (then this can relax back to 5min).
const STALE_TIME_MS = 30 * 1000; // 30s — security-adjacent (CF-1)

export const brandRoleKeys = {
  all: ["brand-role"] as const,
  byBrand: (brandId: string, userId: string): readonly [string, string, string] =>
    ["brand-role", brandId, userId] as const,
  // ORCH-0740 Cycle 1: prefix-match all role-cache variants for a brand.
  // Used by useSoftDeleteBrand.onSuccess to invalidate the role cache for
  // any user (single-user app today; multi-user team membership tomorrow).
  allForBrand: (brandId: string): readonly [string, string] =>
    ["brand-role", brandId] as const,
};

interface QueryResult {
  role: BrandRole | null;
  permissionsOverride: Record<string, unknown>;
  /** #1863 §4.0.2 — mirrors brand_team_members.accepted_at IS NOT NULL. */
  accepted: boolean;
}

const DISABLED_KEY = ["brand-role-disabled"] as const;

/**
 * The role read, extracted from the inline `queryFn` so it is directly
 * executable outside React.
 *
 * Exported for the #3602 regression tests: the required jest lane runs
 * `testEnvironment: "node"` with the ts-jest preset and no React Native / RTL,
 * so a test cannot mount the hook there. This mirrors the sibling convention
 * already in this directory — `useCreatorAccount.ts` exports
 * `fetchCreatorAccount` for exactly the same reason, and its test imports it
 * directly.
 *
 * Callers are responsible for the `enabled` guard; this executor assumes a
 * usable session and a non-null brand id.
 */
export const fetchCurrentBrandRole = async (
  brandId: string,
  userId: string,
): Promise<QueryResult> => {
  // Step 1: try brand_team_members for active row.
  // #1863 §4.0.2 — `accepted_at` joins the select so the payments predicate
  // can mirror the server's acceptance requirement. Additive column only.
  const { data: memberRow, error: memberErr } = await supabase
    .from("brand_team_members")
    .select("role, permissions_override, accepted_at")
    .eq("brand_id", brandId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();
  if (memberErr) throw memberErr;
  if (memberRow !== null) {
    return {
      role: memberRow.role as BrandRole,
      permissionsOverride:
        (memberRow.permissions_override as Record<string, unknown> | null) ?? {},
      accepted: memberRow.accepted_at !== null,
    };
  }
  // Step 2: brand_owner synthesis fallback for solo operators.
  // Without this, every existing solo operator loses access on deploy.
  // Cycle 17e-A: filter deleted_at IS NULL per I-PROPOSED-A — soft-deleted
  // brands MUST NOT grant role synthesis to anyone (closed brand = no access).
  const { data: brandRow, error: brandErr } = await supabase
    .from("brands")
    .select("account_id")
    .eq("id", brandId)
    .is("deleted_at", null)
    .maybeSingle();
  if (brandErr) throw brandErr;
  if (brandRow === null) {
    return { role: null, permissionsOverride: {}, accepted: false };
  }
  // #3602 — do NOT re-introduce an account-table read here. The creator_accounts
  // table has no user_id column and never had one (see the baseline squash,
  // 20260505000000_baseline_squash_orch_0729.sql:8020-8032); its PRIMARY KEY IS
  // the auth user id, and brands.account_id FKs straight to it
  // (brands_account_id_fkey). The read that used to sit here therefore returned
  // HTTP 400 42703 on every call for 146 days, which forced isError:true and put
  // "Couldn't check your access — check your connection" on the brand Payments
  // screen for anyone without a brand_team_members row. React Query retried it
  // twice more each time, so one page load emitted three failing requests and
  // ~3s of backoff before any consumer learned anything. The comparison below
  // is the verbatim client mirror of biz_brand_effective_rank's owner branch
  // (`b.account_id = p_user_id`), which performs no such hop either.
  if (brandRow.account_id === userId) {
    // #1863 §4.0.2 — the brand-owner trigger writes accepted_at =
    // created_at (20260819000000_orch_1047_*.sql:195-213), and a
    // synthesised owner is by definition an accepted relationship.
    // Returning `false` here would lock every solo operator out of their
    // own payments surface.
    return { role: "brand_owner", permissionsOverride: {}, accepted: true };
  }
  return { role: null, permissionsOverride: {}, accepted: false };
};

export const useCurrentBrandRole = (
  brandId: string | null,
): CurrentBrandRoleState => {
  const { isAuthReady, user } = useAuth();
  const userId = user?.id ?? null;

  // ORCH-1004 — tighten from `userId !== null` to the canonical isAuthReady
  // signal. Both reads (brand_team_members, brands) are RLS auth.uid()-scoped;
  // firing before the access_token is attached returns a
  // null role (rank 0) that caches as success and locks the operator out of
  // gated surfaces until a manual refresh. isAuthReady ⟹ a usable session.
  const enabled = isAuthReady && brandId !== null && userId !== null;

  // [TRANSITIONAL] stub-mode synthesis input — read the local brand's
  // `Brand.role` so we can synthesize when the DB chain returns null for
  // local-only stub brands. EXIT: B-cycle persists brand rows. Cycle 17e-A
  // makes this dead code in practice (DB chain returns real values for every
  // persisted brand) but kept as belt-and-suspenders.
  const brandList = useBrandList();
  const stubBrandRole =
    brandId === null
      ? null
      : (brandList.find((b) => b.id === brandId)?.role ?? null);

  const { data, isLoading, isError, refetch } = useQuery<QueryResult>({
    queryKey: enabled
      ? brandRoleKeys.byBrand(brandId, userId)
      : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<QueryResult> => {
      if (!enabled || brandId === null || userId === null) {
        return { role: null, permissionsOverride: {}, accepted: false };
      }
      return await fetchCurrentBrandRole(brandId, userId);
    },
  });

  let role: BrandRole | null = data?.role ?? null;
  let accepted: boolean = data?.accepted ?? false;

  // [TRANSITIONAL] stub-mode synthesis fallback — fires when the DB chain
  // returns no role (typically because the brand is a local-only stub from
  // `brandList.STUB_BRANDS` and isn't persisted to the production DB yet).
  // Maps the existing local-only `Brand.role` enum to the 6-role enum:
  //   "owner" → "brand_owner" (rank 60 — top of hierarchy)
  //   "admin" → "brand_admin"   (rank 50)
  //
  // #3602 — this branch was documented as "dead code in practice". It was the
  // opposite: the DB chain's Step 2 returned HTTP 400 on every call for 146
  // days, so this branch is what actually produced brand_owner for every solo
  // operator, via `useBrandList()` (brandsService unions directly-owned brands
  // in as "owner"). That is why nobody noticed the broken query — role and rank
  // were rescued here; only `isError` was not. With #3602 fixed the DB chain
  // answers for real and `data.role` wins above, so this branch now genuinely
  // only covers un-persisted local brands. Do NOT read this as dead code and
  // delete it in passing — 40+ consumers depend on the role it produces, and
  // removing it needs its own blast-radius pass (#3602 §10 q2).
  //
  // EXIT CONDITION: remove once every brand is persisted with membership rows.
  // Also documented in the file header.
  if (role === null && stubBrandRole !== null) {
    // #1863 §4.0.2 — a local-only stub brand has no membership row to accept
    // and the operator is its creator, so the synthesised role is accepted.
    if (stubBrandRole === "owner") {
      role = "brand_owner";
      accepted = true;
    } else if (stubBrandRole === "admin") {
      role = "brand_admin";
      accepted = true;
    }
  }

  const rank = role !== null ? BRAND_ROLE_RANK[role] : NO_MEMBERSHIP_RANK;
  const permissionsOverride = data?.permissionsOverride ?? {};

  return {
    role,
    rank,
    permissionsOverride,
    accepted,
    isLoading,
    isError,
    refetch,
  };
};
