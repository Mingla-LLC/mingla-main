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
  | "account_owner"
  | "brand_admin"
  | "event_manager"
  | "finance_manager"
  | "marketing_manager"
  | "scanner";

/**
 * Rank values mirror SQL biz_role_rank() at
 * supabase/migrations/20260502100000_b1_business_schema_rls.sql:11-30.
 * Higher = more privilege. 0 = no membership.
 */
export const BRAND_ROLE_RANK = {
  scanner: 10,
  marketing_manager: 20,
  finance_manager: 30,
  event_manager: 40,
  brand_admin: 50,
  account_owner: 60,
} as const satisfies Record<BrandRole, number>;

export const NO_MEMBERSHIP_RANK = 0;

export const meetsRoleRank = (
  currentRank: number,
  requiredRank: number,
): boolean => currentRank >= requiredRank;

export const roleDisplayName = (role: BrandRole): string => {
  switch (role) {
    case "account_owner":
      return "Account owner";
    case "brand_admin":
      return "Brand admin";
    case "event_manager":
      return "Event manager";
    case "finance_manager":
      return "Finance manager";
    case "marketing_manager":
      return "Marketing manager";
    case "scanner":
      return "Scanner";
    default: {
      const _exhaust: never = role;
      return _exhaust;
    }
  }
};

export const roleDescription = (role: BrandRole): string => {
  switch (role) {
    case "account_owner":
      return "Full control of the account, brands, and billing.";
    case "brand_admin":
      return "Manage brand settings, team, events, and finances.";
    case "event_manager":
      return "Create and edit events; manage tickets and scanners.";
    case "finance_manager":
      return "View and refund orders; manage payouts.";
    case "marketing_manager":
      return "Edit brand profile and public pages.";
    case "scanner":
      return "Scan tickets at the door (event-scoped).";
    default: {
      const _exhaust: never = role;
      return _exhaust;
    }
  }
};
