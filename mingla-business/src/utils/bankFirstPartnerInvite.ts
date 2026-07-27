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

// ─── #948 W4 [web-skip-download] — invite-funnel signal (append-only) ────────
//
// The web bank-connect screen (`BrandBankConnectBody.web.tsx`) hides its top
// "Back" button and reveals a "Skip for now" affordance ONLY when it is reached
// from the partner-invite funnel. That phase is signalled by a `?from=invite`
// query param appended at the two invite→connect redirect call sites — NOT
// inside `decideBankFirstInviteNext`, whose bare-href contract stays pinned by
// its existing unit + route tests. These helpers are the pure, testable readers
// and writer for that signal.

export const INVITE_FUNNEL_PARAM = "from";
export const INVITE_FUNNEL_VALUE = "invite";

/**
 * Append the invite-funnel signal to a connect href. `?`/`&`-safe: adds `?` when
 * the href has no query yet, otherwise `&`. Call sites pass the bare href
 * returned by `decideBankFirstInviteNext` (already `encodeURIComponent`-safe on
 * the brandId, no query), so in practice this yields `.../connect?from=invite`.
 */
export function withInviteFunnelParam(connectHref: string): string {
  const separator = connectHref.includes("?") ? "&" : "?";
  return `${connectHref}${separator}${INVITE_FUNNEL_PARAM}=${INVITE_FUNNEL_VALUE}`;
}

/**
 * Exact-match reader for the invite-funnel signal. Treats ONLY a first value of
 * exactly "invite" as truthy — `"invitee"`, `"dashboard"`, and absent are all
 * NON-invite. Exact (not substring) match is load-bearing: it is the airtight
 * gate that keeps the dashboard/direct/bookmark entry's Back button intact.
 */
export function isInviteFunnelValue(
  value: string | string[] | undefined,
): boolean {
  const first = Array.isArray(value) ? value[0] : value;
  return first === INVITE_FUNNEL_VALUE;
}
