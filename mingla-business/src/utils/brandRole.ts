/**
 * Brand role hierarchy + helpers (Cycle 13a).
 *
 * I-32: BRAND_ROLE_RANK MUST mirror the SQL biz_role_rank() function values
 * verbatim. Any drift is a P0 — RLS server-side and mobile show/hide will
 * disagree. CI grep test asserts parity (see SPEC §11 regression prevention).
 *
 * SQL source of truth:
 *   supabase/migrations/20260502100000_b1_business_schema_rls.sql:11-30
 *
 * Per Cycle 13a SPEC §4.4.
 */

export type BrandRole =
  | "brand_owner"
  | "brand_admin"
  | "event_manager"
  | "finance_manager"
  | "marketing_manager"
  | "scanner"
  | "venue_staff";

/**
 * Rank values mirror SQL biz_role_rank() at
 * supabase/migrations/20260502100000_b1_business_schema_rls.sql:11-30
 * (ORCH-1047 renamed the top role literal from the old label → brand_owner).
 * Higher = more privilege. 0 = no membership.
 */
export const BRAND_ROLE_RANK = {
  // Deliberately below NO_MEMBERSHIP_RANK. The UI can distinguish a scoped
  // operator from a brand-less user, while generic rank-threshold gates remain
  // closed and only venue-capability checks can grant operational access.
  venue_staff: -1,
  scanner: 10,
  marketing_manager: 20,
  finance_manager: 30,
  event_manager: 40,
  brand_admin: 50,
  brand_owner: 60,
} as const satisfies Record<BrandRole, number>;

export const NO_MEMBERSHIP_RANK = 0;
