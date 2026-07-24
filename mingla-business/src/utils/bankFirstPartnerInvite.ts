import type { AcceptBrandInvitationResult } from "../services/brandInvitationsService";
import type { BrandRole } from "./brandRole";

const PAYMENTS_CAPABLE_ROLES: ReadonlySet<BrandRole> = new Set([
  "brand_owner",
  "brand_admin",
  "finance_manager",
]);

export type BankFirstInviteDecision =
  | { kind: "connect"; href: string }
  | { kind: "download" }
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
    result.brandId.trim().length === 0
  ) {
    return { kind: "inline" };
  }

  // D5 — a partner whose payout rail is already connected skips the bank step
  // and advances to the existing web get-app step. This stays distinct from a
  // standard team join, whose founder-approved flow has no download secondary.
  if (hasConnectedPayoutRail) return { kind: "download" };

  return {
    kind: "connect",
    href: `/brand/${encodeURIComponent(result.brandId)}/connect`,
  };
}
