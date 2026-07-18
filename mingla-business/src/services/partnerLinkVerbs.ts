/**
 * partnerLinkVerbs — ORCH-1384 sheet-only partner brand-link WRITE verbs
 * (cancel-pending + reissue-invitation).
 *
 * WHY ITS OWN MODULE (ORCH-1384 web eager-bundle budget fix):
 *   These two verbs are reachable ONLY from the lazy PartnerLinkDetailSheet
 *   (the sheet's cancel/resend/correct-email actions). partnerBrandLinksService
 *   itself is eager — it is pulled into the web boot `__common` chunk by the
 *   always-loaded read paths (account tab, brands list). Leaving these
 *   action-only verbs inside that eager module kept their bulk in `__common`
 *   and blew the ORCH-1083 initial-bundle budget
 *   (scripts/ci/orch-1083-initial-bundle-budget.mjs). Splitting them here — a
 *   module imported ONLY by the sheet-only invite-mutation hooks — lets Metro
 *   place them in the lazy sheet chunk instead. `disconnectLink` deliberately
 *   stays in partnerBrandLinksService: the Team MemberDetailSheet shares it, so
 *   it lands in `__common` regardless — no point moving it.
 *
 * The RPC error-code helper (`rpcErrorCode`) and its shape stay in the service
 * (shared with disconnectLink) and are imported from there.
 */

import { supabase } from "./supabase";
import { rpcErrorCode, type RpcErrorShape } from "./partnerBrandLinksService";

export interface CancelPendingRejection {
  rejected: true;
  reason: "has_upcoming_events";
  upcomingEventCount: number;
}
export interface CancelPendingSuccess {
  rejected: false;
  linkId: string;
  brandId: string;
  brandDeleted: boolean;
  invitationRevoked: boolean;
}
export type CancelPendingResult =
  | CancelPendingSuccess
  | CancelPendingRejection;

/**
 * Cancel a PENDING link — atomic quad-outcome via partner_cancel_pending_link
 * (link stamp + invitation revoke + pre-accept brand soft-delete +
 * default-brand clear; I-PROPOSED-1384-CANCEL-IS-MULTI-OBJECT).
 * `has_upcoming_events` maps to a workflow rejection (count from DETAIL).
 */
export async function cancelPendingLink(
  linkId: string,
): Promise<CancelPendingResult> {
  const { data, error } = await supabase.rpc("partner_cancel_pending_link", {
    p_link_id: linkId,
  });
  if (error !== null) {
    const shape = error as RpcErrorShape;
    if ((shape.message ?? "").includes("has_upcoming_events")) {
      const parsed = parseInt(shape.details ?? "", 10);
      return {
        rejected: true,
        reason: "has_upcoming_events",
        upcomingEventCount: Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
      };
    }
    throw new Error(rpcErrorCode(shape));
  }
  const result = (data ?? {}) as {
    link_id?: string;
    brand_id?: string;
    brand_deleted?: boolean;
    invitation_revoked?: boolean;
  };
  return {
    rejected: false,
    linkId: result.link_id ?? linkId,
    brandId: result.brand_id ?? "",
    brandDeleted: result.brand_deleted === true,
    invitationRevoked: result.invitation_revoked === true,
  };
}

interface FunctionsInvokeErrorShape {
  message?: string;
  context?: { body?: unknown };
}

/**
 * Resolve the typed `{ error }` code from a functions-invoke failure
 * (FunctionsHttpError carries the response body on context.body — same
 * pattern as rsvpErrorCodes.parseRsvpErrorCode).
 */
function parseInvokeErrorCode(error: FunctionsInvokeErrorShape): string {
  let code = "server";
  const body = error.context?.body;
  if (body !== undefined && body !== null) {
    try {
      const parsed =
        typeof body === "string"
          ? (JSON.parse(body) as { error?: string })
          : (body as { error?: string });
      if (typeof parsed.error === "string" && parsed.error.length > 0) {
        code = parsed.error;
      }
    } catch {
      // malformed body → keep the default code
    }
  }
  return code;
}

/**
 * Resend (same email) or correct-email reissue via the
 * partner-reissue-invitation edge fn: old tokens expire-now (NEVER revoked —
 * I-PROPOSED-1384-REISSUE-EXPIRES-NEVER-REVOKES), a fresh invitation is
 * minted, and the link's email VALUE + invited_at refresh atomically.
 */
export async function reissueInvitation(
  linkId: string,
  newEmail?: string,
): Promise<{ invitationId: string }> {
  const { data, error } = await supabase.functions.invoke(
    "partner-reissue-invitation",
    {
      body: {
        link_id: linkId,
        ...(newEmail !== undefined ? { new_email: newEmail } : {}),
      },
    },
  );
  if (error !== null) {
    throw new Error(parseInvokeErrorCode(error as FunctionsInvokeErrorShape));
  }
  const result = (data ?? {}) as { invitation_id?: string };
  return { invitationId: result.invitation_id ?? "" };
}
