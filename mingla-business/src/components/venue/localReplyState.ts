// #3872 — a place's one reply to a Local review: none yet, editable for 24
// hours after publishing, then final.
export type LocalReplyState =
  | { kind: "none" }
  | { kind: "editable"; hoursLeft: number }
  | { kind: "locked" };

export function replyState(
  review: { reply: string | null; reply_at: string | null; reply_editable_until: string | null },
  nowMs: number,
): LocalReplyState {
  if (!review.reply || review.reply_at === null) return { kind: "none" };
  const until = review.reply_editable_until ? new Date(review.reply_editable_until).getTime() : Number.NaN;
  if (Number.isFinite(until) && until > nowMs) {
    return { kind: "editable", hoursLeft: Math.max(1, Math.ceil((until - nowMs) / 3_600_000)) };
  }
  return { kind: "locked" };
}
