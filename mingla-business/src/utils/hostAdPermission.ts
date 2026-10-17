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
 * UX mirror of `public.ad_can_host_action`.
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
      return role === "finance_manager" ||
        enabled(permissionsOverride, "ads_fund") ||
        enabled(permissionsOverride, "ads_spend");
    case "launch":
      return (role === "marketing_manager" &&
          enabled(permissionsOverride, "ads_spend")) ||
        enabled(permissionsOverride, "ads_launch");
    case "pause":
      return (role === "marketing_manager" &&
          enabled(permissionsOverride, "ads_spend")) ||
        enabled(permissionsOverride, "ads_pause");
    case "end":
      return false;
  }
}
