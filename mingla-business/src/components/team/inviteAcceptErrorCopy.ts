/**
 * #4283 — the words the in-app invite sheet shows when Accept fails.
 *
 * Pure and import-free so it can be tested on its own. The caller passes the
 * server's answer (`code` + HTTP `status` from BrandInvitationServiceError), or
 * `null` when the request never produced one.
 *
 * `status` is 0 when the request never reached Mingla (parseFunctionsError
 * returns 0 for a fetch failure with no Response). Only that case, or no
 * answer at all, is a network problem. Any status >= 400 means the server
 * answered and refused, so "Couldn't reach Mingla" would be untrue.
 */
export interface InviteAcceptFailure {
  code: string;
  status: number;
}

export const ACCEPT_COPY_NETWORK = "Couldn't reach Mingla — please try again.";
export const ACCEPT_COPY_SERVER =
  "Something went wrong on our side — please try again.";
export const ACCEPT_COPY_MEMBERSHIP_CONFLICT =
  "We couldn't add you to this brand. Ask the owner to send a new invite.";

export function acceptErrorCopy(failure: InviteAcceptFailure | null): string {
  if (failure === null) return ACCEPT_COPY_NETWORK;
  switch (failure.code) {
    case "invite_email_mismatch":
      return "This invite isn't for this account.";
    case "invite_not_actionable":
    case "invite_declined":
    case "invite_already_used":
    case "invite_revoked":
    case "invite_expired":
    case "invite_not_found":
      return "This invite is no longer available.";
    case "invite_currency_mismatch":
      return "Connect your bank to accept this brand.";
    case "invite_membership_conflict":
      return ACCEPT_COPY_MEMBERSHIP_CONFLICT;
    default:
      return failure.status >= 400 ? ACCEPT_COPY_SERVER : ACCEPT_COPY_NETWORK;
  }
}
