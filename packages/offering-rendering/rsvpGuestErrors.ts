/**
 * rsvpGuestErrors — issue #4508: the line shown beside the guest form when the
 * server refuses a guest. It only runs after a failed submit, so the RSVP body
 * loads it on demand and it stays out of the boot payload. Pure, no react.
 */

/** Server refusals of a guest → the line shown beside the form. The first two
 * read exactly as the form's own inline refusals (RSVP_GUEST_LIMIT_REACHED and
 * RSVP_GUEST_OWN_NUMBER in rsvpGuestPartyModel.ts; a test pins them equal). */
/** issue #4508 T1 — a caller without a session sent a guest (an older page,
 * or a sign-in that expired). */
export const RSVP_GUEST_SIGN_IN_COPY = "Update or open the Mingla app to bring someone";
/** issue #4508 T3 — this account already holds a guest pass for the event. */
export const RSVP_GUEST_HAS_PASS_COPY =
  "You already have a pass for this event from a friend.";
/** issue #4508 P3 — a server without the bring-a-friend change refuses a
 * number-only guest or a friend pick (rsvp_guest_contact_required /
 * rsvp_guest_keys_invalid). A current client never sends anything else. */
export const RSVP_GUEST_NOT_AVAILABLE_COPY = "Bringing someone isn't available yet. Try again soon.";

export const rsvpGuestErrorMessage = (code: string): string | null => {
  if (code.includes("rsvp_guest_sign_in_required")) return RSVP_GUEST_SIGN_IN_COPY;
  if (code.includes("rsvp_guest_has_pass")) return RSVP_GUEST_HAS_PASS_COPY;
  if (code.includes("rsvp_plus_ones_exceeded")) return "That's the most this host allows.";
  if (code.includes("rsvp_guest_own_number")) return "That's you. Enter a friend's number.";
  if (code.includes("rsvp_guest_duplicate")) return "You've added the same person twice. Remove one and try again.";
  if (code.includes("rsvp_guest_already_listed")) return "Someone you're bringing is already on the list. Remove them and try again.";
  if (code.includes("rsvp_guest_released")) return "Someone you're bringing can't be invited to this event. Remove them and try again.";
  if (code.includes("rsvp_guest_not_friend")) return "You can only add people from your friends list. Add them by phone number instead.";
  if (code.includes("rsvp_guest_daily_cap")) return "You've invited a lot of numbers today. Try again tomorrow, or RSVP just for yourself.";
  if (code.includes("rsvp_guest_phone_invalid")) return "One of the numbers you added isn't valid. Remove it and add it again.";
  if (code.includes("rsvp_guest_phone_country_invalid")) return "One of the numbers you added isn't valid. Remove it and add it again.";
  if (code.includes("rsvp_guest_keys_invalid") || code.includes("rsvp_guest_contact_required")) {
    return RSVP_GUEST_NOT_AVAILABLE_COPY;
  }
  return null;
};
