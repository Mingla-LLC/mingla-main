// Issue #4508 T3 / P3-T11 / R5-2 — the in-app notices that tell an inviter
// their guest took their own place (and a claimed guest that their pass was
// cancelled). One builder for every sender: public-submit-rsvp (the
// submit_event_rsvp guestNotices) and rsvp-notify's tick (the database queue
// rsvp_guest_notices, filled by the claim sweep and the anonymous-RSVP
// attach), so the words, type and idempotency key are the same.

/** One in-app notice the submit asks for (submit_event_rsvp guestNotices). */
export interface GuestNotice {
  kind?: unknown;
  userId?: unknown;
  guestId?: unknown;
  eventId?: unknown;
  eventTitle?: unknown;
  phoneLast4?: unknown;
  inviterName?: unknown;
}

const noticeText = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

/**
 * Issue #4508 T3 / P3-T11 — the notify-dispatch body for one notice, through
 * the same in-app path "This isn't me" uses to tell an inviter (type
 * rsvp_guest_released, no push). Null for anything malformed.
 *   guest_has_own_rsvp: the inviter's guest RSVPed on their own, so the
 *     guest spot was freed.
 *   guest_pass_removed: a guest who had claimed their pass was removed by
 *     the inviter (taken off the party, or the party can't go).
 */
export function guestNoticeDispatch(notice: GuestNotice): {
  userId: string;
  type: string;
  title: string;
  body: string;
  data: { eventId: string };
  relatedId: string;
  relatedType: "event";
  skipPush: true;
  idempotencyKey: string;
} | null {
  const userId = noticeText(notice.userId);
  const guestId = noticeText(notice.guestId);
  const eventId = noticeText(notice.eventId);
  if (userId === null || guestId === null || eventId === null) return null;
  const title = noticeText(notice.eventTitle);
  const forEvent = title !== null ? ` for ${title}` : "";
  const common = {
    userId,
    data: { eventId },
    relatedId: eventId,
    relatedType: "event" as const,
    skipPush: true as const,
  };
  if (notice.kind === "guest_has_own_rsvp") {
    const last4 = noticeText(notice.phoneLast4);
    const who = last4 !== null && /^\d{4}$/.test(last4)
      ? `The number ending ${last4}`
      : "Someone you were bringing";
    return {
      ...common,
      type: "rsvp_guest_released",
      title: "Your guest's spot is free",
      body: `${who} RSVPed${forEvent} on their own, so they don't need your spot.`,
      idempotencyKey: `rsvp_guest_own_rsvp:${guestId}`,
    };
  }
  if (notice.kind === "guest_pass_removed") {
    const inviter = noticeText(notice.inviterName) ?? "Your friend";
    return {
      ...common,
      type: "rsvp_guest_pass_removed",
      title: "Your guest pass was cancelled",
      body: `${inviter} is no longer bringing you${forEvent}, so your guest pass was cancelled. You can still RSVP yourself.`,
      idempotencyKey: `rsvp_guest_pass_removed:${guestId}`,
    };
  }
  return null;
}
