/**
 * Ve3 — pure helpers for admin-review-venue-claim (unit-testable without Deno env).
 */

export type ReviewAction =
  | "mark_called"
  | "approve"
  | "reject"
  | "need_more_info";

export function normalizeReviewBody(
  body: unknown,
):
  | { ok: true; brandId: string; action: ReviewAction; rejectionReason: string }
  | { ok: false; error: string } {
  if (body === null || typeof body !== "object") {
    return { ok: false, error: "invalid_body" };
  }
  const b = body as Record<string, unknown>;
  const brandId = typeof b.brand_id === "string" ? b.brand_id.trim() : "";
  const action = typeof b.action === "string" ? b.action.trim() : "";
  const rejectionReason = typeof b.rejection_reason === "string"
    ? b.rejection_reason.trim()
    : "";

  if (brandId.length === 0) return { ok: false, error: "brand_id_required" };
  if (
    action !== "mark_called" &&
    action !== "approve" &&
    action !== "reject" &&
    action !== "need_more_info"
  ) {
    return { ok: false, error: "invalid_action" };
  }
  if (action === "reject" && rejectionReason.length === 0) {
    return { ok: false, error: "rejection_reason_required" };
  }

  return {
    ok: true,
    brandId,
    action: action as ReviewAction,
    rejectionReason,
  };
}

export function auditActionForReview(action: ReviewAction): string {
  switch (action) {
    case "mark_called":
      return "claim.mark_called";
    case "approve":
      return "claim.approve";
    case "reject":
      return "claim.reject";
    case "need_more_info":
      return "claim.need_more_info";
  }
}

export function pushCopyForReview(
  action: ReviewAction,
  brandName: string,
): { title: string; body: string } | null {
  switch (action) {
    case "approve":
      return {
        title: "Venue verified",
        body: `${brandName} is now live on Mingla.`,
      };
    case "reject":
      return {
        title: "Venue submission update",
        body: `We couldn't approve ${brandName} at this time.`,
      };
    case "need_more_info":
      return {
        title: "More info needed",
        body: `We need more information about ${brandName}.`,
      };
    default:
      return null;
  }
}
