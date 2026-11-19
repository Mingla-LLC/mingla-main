/**
 * rsvpGuestErrors — issue #4508: the line shown beside the guest form when the
 * server refuses a guest. It only runs after a failed submit, so the RSVP body
 * loads it on demand and it stays out of the boot payload. Pure, no react.
 */
import {
  RSVP_GUEST_LIMIT_REACHED,
  RSVP_GUEST_OWN_NUMBER,
} from "./rsvpGuestCopy";

/** Server refusals of a guest → the line shown beside the form. */
export const rsvpGuestErrorMessage = (code: string): string | null => {
  if (code.includes("rsvp_plus_ones_exceeded")) return RSVP_GUEST_LIMIT_REACHED;
  if (code.includes("rsvp_guest_own_number")) return RSVP_GUEST_OWN_NUMBER;
  if (code.includes("rsvp_guest_duplicate")) return "You've added the same person twice. Remove one and try again.";
  if (code.includes("rsvp_guest_already_listed")) return "Someone you're bringing is already on the list. Remove them and try again.";
  if (code.includes("rsvp_guest_released")) return "Someone you're bringing can't be invited to this event. Remove them and try again.";
  // R-1: signed out, a listed or released number reads the same, on purpose.
  if (code.includes("rsvp_guest_unavailable")) return "Someone you're bringing can't be added to this event. Remove them and try again.";
  if (code.includes("rsvp_guest_not_friend")) return "You can only add people from your friends list. Add them by phone number instead.";
  if (code.includes("rsvp_guest_daily_cap")) return "You've invited a lot of numbers today. Try again tomorrow, or RSVP just for yourself.";
  if (code.includes("rsvp_guest_phone_invalid")) return "One of the numbers you added isn't valid. Remove it and add it again.";
  if (code.includes("rsvp_guest_phone_country_invalid")) return "One of the numbers you added isn't valid. Remove it and add it again.";
  if (code.includes("rsvp_guest_keys_invalid") || code.includes("rsvp_guest_contact_required")) {
    return "We couldn't add one of your guests. Remove them and add them by phone number.";
  }
  return null;
};
