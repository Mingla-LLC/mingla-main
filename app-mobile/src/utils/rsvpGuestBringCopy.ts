/**
 * issue #4508 2.5 — the "Bring someone too" refusals (public-submit-rsvp op
 * guest_bring) in plain words. Pure, so it is Deno-testable; rsvpDeckService
 * re-exports it under its old name.
 */

export const rsvpGuestBringMessage = (code: string): string => {
  if (code.includes("not_allowed")) return "This host isn't letting guests bring anyone.";
  if (code.includes("already_brought")) return "You've already brought someone to this event.";
  if (code.includes("rsvp_full")) return "This event is full, so there's no room for another guest.";
  if (code.includes("not_your_pass") || code.includes("ineligible")) return "Only a guest with a claimed pass can bring someone.";
  if (code.includes("rsvp_guest_own_number")) return "That's you. Enter a friend's number.";
  if (code.includes("rsvp_guest_already_listed")) return "That person is already on the list.";
  if (code.includes("rsvp_guest_released")) return "That number can't be invited to this event.";
  if (code.includes("rsvp_guest_daily_cap")) return "You've invited a lot of numbers today. Try again tomorrow.";
  if (code.includes("rsvp_guest_phone")) return "Enter a valid phone number.";
  if (code.includes("rate_limited")) return "Too many tries in a row. Wait a minute, then try again.";
  // #4508 T1: a session the server could not verify.
  if (code.includes("rsvp_guest_sign_in_required")) return "Update or open the Mingla app to bring someone";
  // #4508 P3: a server without bring-a-friend answers the op as an unknown payload.
  if (code.includes("rsvp_payload_invalid")) return "Bringing someone isn't available yet. Try again soon.";
  return "We couldn't add them just now. Try again.";
};
