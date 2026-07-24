import type { AcceptBrandInvitationResult } from "../services/brandInvitationsService";
import type { BrandRole } from "./brandRole";

const PAYMENTS_CAPABLE_ROLES: ReadonlySet<BrandRole> = new Set([
  "brand_owner",
  "brand_admin",
  "finance_manager",
]);

export type BankFirstInviteDecision =
  | { kind: "connect"; href: string }
  | { kind: "inline" };

/**
 * #948 W3 — the resolved invite outcome alone decides whether bank setup is
 * next. Auth readiness is intentionally absent: the accept route has already
 * reached a terminal success phase before this function runs.
 */
export function decideBankFirstInviteNext(
  result: Pick<
    AcceptBrandInvitationResult,
    | "brandId"
    | "partnerSetup"
    | "role"
    | "stripeChargesEnabled"
    | "paystackSubaccountCode"
  >,
): BankFirstInviteDecision {
  const hasConnectedPayoutRail =
    result.stripeChargesEnabled === true ||
    (typeof result.paystackSubaccountCode === "string" &&
      result.paystackSubaccountCode.trim().length > 0);

  if (
    !result.partnerSetup ||
    !PAYMENTS_CAPABLE_ROLES.has(result.role) ||
    result.brandId.trim().length === 0 ||
    hasConnectedPayoutRail
  ) {
    return { kind: "inline" };
  }

  return {
    kind: "connect",
    href: `/brand/${encodeURIComponent(result.brandId)}/connect`,
  };
}
