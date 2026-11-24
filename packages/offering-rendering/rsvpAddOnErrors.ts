/**
 * issue #3281 S6 — the RSVP body's one on-demand refusal line: a guest refusal
 * (#4508, rsvpGuestErrors) or, else, an RSVP add-on refusal. Only a refused
 * submit needs it, so the body loads it on demand and it stays out of the boot
 * payload. Pure, no react.
 *
 * The add-on copy is the #3281 spec §7 wording ("party" where the spec says
 * "tickets", since an RSVP has none). A refusal undoes the whole RSVP on the
 * server, so the form keeps everything the guest typed and picked.
 */

import { rsvpGuestErrorMessage } from "./rsvpGuestErrors.ts";

/** The refusals public-submit-rsvp returns for RSVP add-ons; null for any other code. */
export function rsvpAddOnRefusalCopy(code: string): string | null {
  if (code.includes("rsvp_add_ons_unavailable")) {
    return "Add-ons open once your spot is confirmed.";
  }
  if (code.includes("extra_capacity_exceeded")) {
    return "One of your add-ons just sold out. Pick fewer to continue.";
  }
  if (code.includes("extra_quantity_above_max")) {
    return "You've picked more of an add-on than your party allows.";
  }
  if (code.includes("extra_not_available") || code.includes("rsvp_add_on_needs_payment")) {
    return "One of your add-ons is no longer on sale. Remove it to continue.";
  }
  if (code.includes("rsvp_add_ons_invalid") || code.includes("extras_invalid")) {
    return "We couldn't read your add-ons. Change them and try again.";
  }
  return null;
}

/** A guest refusal's line, else an add-on refusal's, else null. */
export const rsvpRefusalLine = (code: string): string | null =>
  rsvpGuestErrorMessage(code) ?? rsvpAddOnRefusalCopy(code);
