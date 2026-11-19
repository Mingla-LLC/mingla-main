/**
 * rsvpGuestParty — issue #4508 public surface of the guest-party model.
 *
 * Pure, no react. The live preview / friend search model is in
 * rsvpGuestPartyModel.ts (only the lazily loaded guest block imports it); the
 * pieces the eager RSVP body needs are in rsvpGuestCopy.ts. This file holds the
 * "Send it yourself too" text and the per-guest status line, which only the
 * success card (also lazy) and the Explorer app import, and re-exports the rest
 * so every name keeps its old import path.
 *
 * Keep it out of the guest block's imports: a module two on-demand chunks both
 * import is hoisted into the boot payload (that cost +8 KB once).
 */
import type {
  GuestInviteMessageInput,
  RsvpSubmittedGuest,
} from "./rsvpGuestPartyModel.ts";

// Types only (erased): the model's values must not ride along into this chunk.
export type {
  GuestInviteMessageInput,
  NumberPreviewInput,
  RsvpFriendOption,
  RsvpGuestLookup,
  RsvpGuestLookupResult,
  RsvpGuestPayload,
  RsvpNumberPreview,
  RsvpPartyGuest,
  RsvpSubmittedGuest,
} from "./rsvpGuestPartyModel.ts";
export {
  buildGuestPayload,
  isCompleteE164,
  rsvpGoingButtonLabel,
} from "./rsvpGuestCopy.ts";

// "Send it yourself too" and the success card's per-guest status line. They sit
// here because the success card and the guest block are separate on-demand
// chunks, and a module both import would be hoisted into the boot payload.
/**
 * `I've put you down for {event} with me, {short date}, {time} in {area}. Your
 * pass is waiting in the Mingla app, grab it here: {link}` — missing parts are
 * dropped rather than invented.
 */
export const buildGuestInviteMessage = (input: GuestInviteMessageInput): string => {
  const parts = input.dateLine
    .split(/\s+·\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const when = parts.length > 0 ? `, ${parts.slice(0, 2).join(", ")}` : "";
  const where = input.online
    ? ", online"
    : input.area !== null && input.area.trim().length > 0
      ? ` in ${input.area.trim()}`
      : "";
  return `I've put you down for ${input.eventName.trim() || "this event"} with me${when}${where}. Your pass is waiting in the Mingla app, grab it here: ${input.link}`;
};

/** issue #4508 P3 — a number in a country we cannot text yet. */
export const RSVP_GUEST_UNSUPPORTED_REGION =
  "We can't text this number yet. Send them your invite yourself.";

export const submittedGuestLabel = (g: RsvpSubmittedGuest): string =>
  g.displayName !== null && g.displayName.trim().length > 0
    ? g.displayName.trim()
    : g.phoneLast4 !== null
      ? `Number ending ${g.phoneLast4}`
      : "Your guest";

export const submittedGuestStatus = (
  g: RsvpSubmittedGuest,
  rsvpStatus: "going" | "waitlisted" | "pending",
): string => {
  if (g.claimed) return "Has their pass";
  if (rsvpStatus !== "going") return "We'll text them once you're in";
  // C3 / R-1: willText alone says whether a text goes. A signed-out inviter
  // gets no invite link (so a number already on the list reads like a new
  // one), and their guests are still texted.
  if (!g.willText) {
    // P3: no SMS route for the number's country; the paste text below is
    // the way to reach them.
    return g.notTextedReason === "unsupported_region"
      ? RSVP_GUEST_UNSUPPORTED_REGION
      : "We couldn't text this number";
  }
  return g.onMingla ? "Text on its way, and a note in their app" : "Text on its way";
};

