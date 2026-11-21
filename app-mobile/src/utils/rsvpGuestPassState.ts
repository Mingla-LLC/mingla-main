/**
 * issue #4508 P3 — a guest who holds a claimed pass for this event sees their
 * pass state on the event page ("You're going with {inviter first name}") and
 * a way to open it, instead of an unanswered Going / Maybe / Can't go prompt.
 *
 * Pure: reads the rows `fetch_user_going_rsvps` returns (a plus-one's row is
 * there only once claimed). Deno-testable.
 */

export interface GoingRsvpRowLike {
  eventId: string;
  role: "primary" | "guest";
  /** The inviter's label from the server ("Ada O.", "Ada Obi"). */
  invitedBy: string | null;
}

/** The viewer's claimed guest pass for this event, if any. */
export const claimedGuestPassFor = <T extends GoingRsvpRowLike>(
  rows: ReadonlyArray<T> | undefined,
  eventId: string | null,
): T | null => {
  if (rows === undefined || eventId === null) return null;
  // Their own RSVP on the event wins (one place per person).
  if (rows.some((row) => row.eventId === eventId && row.role === "primary")) return null;
  return rows.find((row) => row.eventId === eventId && row.role === "guest") ?? null;
};

/** "You're going with Ada" (first name only), or a plain line without one. */
export const guestPassHeadline = (invitedBy: string | null): string => {
  const first = (invitedBy ?? "").trim().split(/\s+/)[0] ?? "";
  return first.length > 0 ? `You're going with ${first}` : "You're going";
};

export const GUEST_PASS_OPEN_LABEL = "Open your pass";
