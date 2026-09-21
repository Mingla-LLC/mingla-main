/**
 * Issue #3386 — pure helpers for the admin decision on a host's venue details
 * change request (a LIVE venue's name, category or address).
 *
 * The decision itself is the SQL RPC `admin_review_venue_details_change`
 * (is_admin_user() first, applies atomically, writes admin_audit_log). The edge
 * function only validates the body, calls that RPC with the admin's own JWT,
 * and then tells the host through notify-dispatch — the same inbox + push
 * pattern `business.claim_decision` uses.
 *
 * No Deno or network imports, so the Business jest suite can prove every
 * branch (mingla-business/src/services/__tests__/venueDetailsChangeReview.issue3386.test.ts).
 */

export const VENUE_DETAILS_CHANGE_REVIEW_ACTION = "review_details_change";
export const VENUE_DETAILS_CHANGE_NOTIFICATION_TYPE =
  "business.venue_details_change_decision";

export type VenueDetailsChangeDecisionInput = "approve" | "reject";
export type VenueDetailsChangeDecision = "approved" | "rejected";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The longest reason a host is shown; the RPC refuses more than 1,000. */
export const VENUE_DETAILS_REJECTION_REASON_MAX = 1000;

export function normalizeVenueDetailsChangeReviewBody(
  body: unknown,
):
  | {
    ok: true;
    venueId: string;
    requestId: string;
    decision: VenueDetailsChangeDecisionInput;
    reason: string | null;
  }
  | { ok: false; error: string } {
  if (body === null || typeof body !== "object") {
    return { ok: false, error: "invalid_body" };
  }
  const b = body as Record<string, unknown>;
  const venueId = typeof b.venue_id === "string" ? b.venue_id.trim() : "";
  const requestId = typeof b.request_id === "string" ? b.request_id.trim() : "";
  const decision = typeof b.decision === "string" ? b.decision.trim() : "";
  const reason = typeof b.rejection_reason === "string"
    ? b.rejection_reason.trim()
    : "";

  if (!UUID_RE.test(venueId)) return { ok: false, error: "venue_id_required" };
  if (!UUID_RE.test(requestId)) {
    return { ok: false, error: "request_id_required" };
  }
  if (decision !== "approve" && decision !== "reject") {
    return { ok: false, error: "invalid_decision" };
  }
  if (decision === "reject" && reason.length === 0) {
    return { ok: false, error: "rejection_reason_required" };
  }
  if (reason.length > VENUE_DETAILS_REJECTION_REASON_MAX) {
    return { ok: false, error: "rejection_reason_too_long" };
  }
  return {
    ok: true,
    venueId,
    requestId,
    decision,
    reason: decision === "reject" ? reason : null,
  };
}

export interface VenueDetailsChangeDecisionReceipt {
  ok: true;
  noop: boolean;
  decision: VenueDetailsChangeDecision;
  venueId: string;
  brandId: string;
  requestId: string;
  requestedBy: string | null;
  venueName: string;
  rejectionReason: string | null;
}

/**
 * Read the RPC's jsonb answer without trusting its shape. Anything that is not
 * a complete success is `{ ok: false, code }`, so the caller never notifies a
 * host about a decision that did not happen.
 */
export function readVenueDetailsChangeDecision(
  result: unknown,
): VenueDetailsChangeDecisionReceipt | { ok: false; code: string } {
  if (result === null || typeof result !== "object") {
    return { ok: false, code: "invalid_result" };
  }
  const r = result as Record<string, unknown>;
  if (r.ok !== true) {
    return {
      ok: false,
      code: typeof r.code === "string" && r.code.length > 0
        ? r.code
        : "request_not_current",
    };
  }
  const decision = r.decision === "approved" || r.decision === "rejected"
    ? r.decision
    : null;
  const venueId = typeof r.venue_id === "string" ? r.venue_id : "";
  const brandId = typeof r.brand_id === "string" ? r.brand_id : "";
  const requestId = typeof r.request_id === "string" ? r.request_id : "";
  if (
    decision === null || venueId === "" || brandId === "" || requestId === ""
  ) {
    return { ok: false, code: "invalid_result" };
  }
  return {
    ok: true,
    noop: r.noop === true,
    decision,
    venueId,
    brandId,
    requestId,
    requestedBy: typeof r.requested_by === "string" ? r.requested_by : null,
    venueName:
      typeof r.venue_name === "string" && r.venue_name.trim().length > 0
        ? r.venue_name.trim()
        : "Your venue",
    rejectionReason: typeof r.rejection_reason === "string" &&
        r.rejection_reason.trim().length > 0
      ? r.rejection_reason.trim()
      : null,
  };
}

const REASON_IN_PUSH_MAX = 140;

/** What the host reads in the inbox and the push. Plain words, no jargon. */
export function venueDetailsChangeDecisionCopy(
  decision: VenueDetailsChangeDecision,
  venueName: string,
  rejectionReason: string | null,
): { title: string; body: string } {
  if (decision === "approved") {
    return {
      title: "Venue details updated",
      body:
        `Mingla approved your changes. ${venueName} now shows the new details.`,
    };
  }
  const reason = (rejectionReason ?? "").trim();
  if (reason.length === 0) {
    return {
      title: "Venue details not changed",
      body:
        `Mingla didn't approve the changes to ${venueName}. Tap to see why.`,
    };
  }
  const shown = reason.length > REASON_IN_PUSH_MAX
    ? `${reason.slice(0, REASON_IN_PUSH_MAX - 1).trimEnd()}…`
    : reason;
  return {
    title: "Venue details not changed",
    body: `Mingla didn't approve the changes to ${venueName}: ${shown}`,
  };
}

/** Lands on the venue's Settings, where the Venue details card shows the outcome. */
export function venueDetailsChangeDeepLink(venueId: string): string {
  return `mingla-business://venue/${venueId}/settings`;
}

/** The brand owner and whoever sent the request, once each. */
export function venueDetailsChangeRecipients(
  brandAccountId: string | null | undefined,
  requestedBy: string | null | undefined,
): string[] {
  const out: string[] = [];
  for (const id of [brandAccountId, requestedBy]) {
    if (typeof id === "string" && UUID_RE.test(id) && !out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}

/** One notification per request, decision and person, however often it retries. */
export function venueDetailsChangeIdempotencyKey(
  requestId: string,
  decision: VenueDetailsChangeDecision,
  userId: string,
): string {
  return `${VENUE_DETAILS_CHANGE_NOTIFICATION_TYPE}:${requestId}:${decision}:${userId}`;
}
