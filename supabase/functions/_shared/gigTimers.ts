export type TimerDecision = {
  action: string;
  refundBranch?: "declined_or_expired" | "upload_missed";
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
