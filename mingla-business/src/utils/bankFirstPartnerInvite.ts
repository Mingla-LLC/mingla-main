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

// ─── #948 W4 [web-skip-download] — invite-funnel WRITER (append-only) ─────────
//
// Appended HERE (not in a shared module) on purpose: the eager
// accept-brand-invitation route already imports this module for
// `decideBankFirstInviteNext`, so adding the writer costs the eager __common
// chunk nothing (Metro keeps this module in the accept route's own chunk — it is
// the sole eager importer). The invite-funnel READER (`isInviteFunnelValue`)
// lives in the separate `inviteFunnelSignal.ts` so the LAZY /connect body can
// read the signal WITHOUT pulling this module (which would hoist it into
// __common — the ORCH-1083 leak). `decideBankFirstInviteNext` is untouched: the
// signal is appended at the call site, not inside it.

export const INVITE_FUNNEL_PARAM = "from";
export const INVITE_FUNNEL_VALUE = "invite";

/**
 * Append the invite-funnel signal to a connect href. `?`/`&`-safe: adds `?` when
 * the href has no query yet, otherwise `&`. Call sites pass the bare href
 * returned by `decideBankFirstInviteNext` (no query), so in practice this yields
 * `.../connect?from=invite`. (The legacy success route inlines the same literal
 * to avoid importing this module into a second eager chunk.)
 */
export function withInviteFunnelParam(connectHref: string): string {
  const separator = connectHref.includes("?") ? "&" : "?";
  return `${connectHref}${separator}${INVITE_FUNNEL_PARAM}=${INVITE_FUNNEL_VALUE}`;
}
