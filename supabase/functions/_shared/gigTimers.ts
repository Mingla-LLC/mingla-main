export type TimerDecision = {
  action: string;
  refundBranch?: "declined_or_expired" | "upload_missed" | "post_missed";
  analytics: string;
} | null;
export function gigTimerDecision(
  input: {
    state: string;
    deadlineAt: string | null;
    now: Date;
    disputed?: boolean;
  },
): TimerDecision {
  if (input.disputed || input.state === "disputed" || !input.deadlineAt) {
    return null;
  }
  const deadline = new Date(input.deadlineAt);
  if (!Number.isFinite(deadline.getTime()) || deadline > input.now) return null;
  return ({
    offered: {
      action: "expire",
      refundBranch: "declined_or_expired",
      analytics: "gig_expired",
    },
    script_sent: { action: "auto_lock", analytics: "gig_auto_approved" },
    // The upload is due two days before post_by; missing it cancels the gig
    // with a full host refund (gig_refund_record moves the state).
    script_locked: {
      action: "cancel_missed_upload",
      refundBranch: "upload_missed",
      analytics: "gig_upload_missed",
    },
    delivered: { action: "auto_approve", analytics: "gig_auto_approved" },
    // #4402: an approved video must be posted by the post deadline
    // (post_by end of day in the gig zone + 24 h grace). Missing it cancels
    // the gig with a full host refund. posts_submitted deliberately has NO
    // entry and NO deadline: Admin reviews it from the queue instead.
    // Invariant (declared in its test): I-4402-POST-7 | issue #4402 | every state holding captured money has a timer action here or an Admin queue row (posts_submitted)
    approved: {
      action: "cancel_missed_post",
      refundBranch: "post_missed",
      analytics: "gig_post_missed",
    },
    posting: {
      action: "cancel_missed_post",
      refundBranch: "post_missed",
      analytics: "gig_post_missed",
    },
    posts_failed: {
      action: "cancel_missed_post",
      refundBranch: "post_missed",
      analytics: "gig_post_missed",
    },
    posts_verified: { action: "release", analytics: "gig_released" },
    released: { action: "day30", analytics: "gig_day30" },
    day30: { action: "complete", analytics: "gig_completed" },
  } as Record<string, TimerDecision>)[input.state] ?? null;
}

export function timerDedupeKey(
  contractId: string,
  state: string,
  deadlineAt: string,
): string {
  return `${contractId}:${state}:${deadlineAt}`;
}
