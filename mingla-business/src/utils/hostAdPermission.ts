import type { BrandRole } from "./brandRole";

export type HostAdAction =
  | "read"
  | "plan"
  | "fund"
  | "launch"
  | "pause"
  | "end";

export type HostAdPermissionInput = {
  role: BrandRole | null;
  accepted: boolean;
  permissionsOverride: Record<string, unknown>;
};

function enabled(
  overrides: Record<string, unknown>,
  permission: string,
): boolean {
  return overrides[permission] === true;
}

/**
 * UX mirror of `public.ad_can_host_action` (20281118014238). Owner: every
 * action. Brand admin: read, plan, fund, launch, pause. Finance: read, fund.
 * Marketing: read, plan; fund/launch/pause only with ads_spend. End stays
 * owner-only.
 *
 * The edge function remains authoritative. Keep every action independent so
 * payout authority cannot silently become campaign-planning or delivery
 * authority (and vice versa).
 */
export function canHostAdAction(
  input: HostAdPermissionInput,
  action: HostAdAction,
): boolean {
  const { role, accepted, permissionsOverride } = input;
  if (role === "brand_owner") return true;
  if (!accepted || role === null) return false;

  switch (action) {
    case "read":
      return ["brand_admin", "marketing_manager", "finance_manager"].includes(
        role,
      ) || enabled(permissionsOverride, "ads_view");
    case "plan":
      return ["brand_admin", "marketing_manager"].includes(role) ||
        enabled(permissionsOverride, "ads_plan");
    case "fund":
      // #4238 ads roles: brand admins fund (a launch holds the budget first).
      return role === "brand_admin" || role === "finance_manager" ||
        enabled(permissionsOverride, "ads_fund") ||
        enabled(permissionsOverride, "ads_spend");
    case "launch":
      return role === "brand_admin" ||
        (role === "marketing_manager" &&
          enabled(permissionsOverride, "ads_spend")) ||
        enabled(permissionsOverride, "ads_launch");
    case "pause":
      return role === "brand_admin" ||
        (role === "marketing_manager" &&
          enabled(permissionsOverride, "ads_spend")) ||
        enabled(permissionsOverride, "ads_pause");
    case "end":
      return false;
  }
}

/**
 * #4238 ads roles: UX mirror of the Ads credit top-up check
 * (`biz_can_manage_payments_for_brand`: owner, brand admin, finance).
 * Used only when the server's capabilities are absent (older server).
 */
export function canHostAdTopUp(
  input: Pick<HostAdPermissionInput, "role" | "accepted">,
): boolean {
  if (input.role === "brand_owner") return true;
  if (!input.accepted) return false;
  return input.role === "brand_admin" || input.role === "finance_manager";
}

/**
 * #4238 ads roles: UX mirror of `public.ad_can_withdraw_credit` (owner or an
 * accepted finance_manager). Used only when the server's capabilities are
 * absent (older server).
 */
export function canHostAdWithdraw(
  input: Pick<HostAdPermissionInput, "role" | "accepted">,
): boolean {
  if (input.role === "brand_owner") return true;
  return input.accepted && input.role === "finance_manager";
}
