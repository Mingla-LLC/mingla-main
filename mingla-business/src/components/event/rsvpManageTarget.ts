/**
 * #3645 — shared RSVP detector for Hub EventManageMenu copy.
 * Mirrors EventListCard: live `event_type === "rsvp"` or draft `isRsvp`.
 */

export function isRsvpManageTarget(event: {
  event_type?: string | null;
  isRsvp?: boolean;
}): boolean {
  return event.event_type === "rsvp" || event.isRsvp === true;
}
