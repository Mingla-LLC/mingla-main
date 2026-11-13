// Issue #1447 / #4422 — the plain copy for RSVP rows that the shared #4063
// messages do not render (rows without the event enrichment, and the
// templates with no shared message). Moved out of index.ts so it can be
// tested without starting the worker.
//
// #4422: every text starts with "Mingla:" (the built #4063 sender), no label
// is case-changed, and each text is fitted to one GSM-7 segment by shortening
// the event title (see fitTitleToSegment).

import { fitTitleToSegment, renderBuyerSms } from "../_shared/sms/buyerSms.ts";

export type RsvpTemplateKey =
  | "rsvp_acknowledgement"
  | "rsvp_pass"
  | "rsvp_event_updated"
  // Issue #3827 — a ticket or experience buyer told about a live edit.
  | "buyer_event_updated"
  | "rsvp_waitlist_promoted"
  | "rsvp_approved"
  | "rsvp_denied"
  | "rsvp_removed";

export interface RsvpCopy {
  title: string;
  body: string;
  sms: string;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

/** The acknowledgement label for an RSVP state, in its real capitals. */
export function acknowledgementLabel(p: Record<string, unknown>): string {
  const state = text(p.status);
  const approval = text(p.approvalStatus);
  return state === "waitlisted"
    ? "Waitlisted"
    : approval === "pending"
    ? "Request sent"
    : state === "maybe"
    ? "Maybe saved"
    : state === "not_going"
    ? "RSVP updated"
    : "You're going";
}

/**
 * `link` is the full link for email and push; `smsLink` is what the text
 * shows (the short link's display form when one was minted).
 */
export function copyFor(
  template: RsvpTemplateKey,
  p: Record<string, unknown>,
  link: string,
  smsLink: string = link,
): RsvpCopy {
  const event = text(p.eventName) ?? "your event";
  switch (template) {
    case "rsvp_pass":
      return {
        title: `You're going to ${event}`,
        body: [
          event,
          text(p.dateLine),
          text(p.venueLine),
          `Hosted by ${text(p.brandName) ?? "Mingla"}`,
        ].filter(Boolean).join("\n\n"),
        sms: fitTitleToSegment(
          (title) =>
            `Mingla: Your RSVP for ${title} is confirmed. Open your secure invite: ${smsLink}`,
          event,
        ),
      };
    case "rsvp_acknowledgement": {
      const label = acknowledgementLabel(p);
      return {
        title: `${label}: ${event}`,
        body: `${label}: ${event}.`,
        sms: fitTitleToSegment(
          (title) => `Mingla: ${label}: ${title}. ${smsLink}`,
          event,
        ),
      };
    }
    case "rsvp_event_updated":
      return {
        title: `Plans changed: ${event}`,
        body: "The host updated this event.",
        sms: renderBuyerSms("S20D", { title: event, link: smsLink }),
      };
    // Issue #3827 — only reached without a notice, which the worker refuses
    // before sending; the case keeps the switch exhaustive.
    case "buyer_event_updated":
      return {
        title: `Details changed: ${event}`,
        body: "The host changed the details of this event.",
        sms: renderBuyerSms("S20D", { title: event, link: smsLink }),
      };
    case "rsvp_waitlist_promoted":
      return {
        title: `You're in! ${event}`,
        body: "A spot opened, so your RSVP is in.",
        sms: fitTitleToSegment(
          (title) =>
            `Mingla: A spot opened at ${title}, so your RSVP is in. ${smsLink}`,
          event,
        ),
      };
    case "rsvp_approved":
      return {
        title: `You're approved: ${event}`,
        body: "The host approved your RSVP.",
        sms: fitTitleToSegment(
          (title) =>
            `Mingla: The host approved your RSVP to ${title}. ${smsLink}`,
          event,
        ),
      };
    case "rsvp_denied":
      return {
        title: `RSVP update: ${event}`,
        body: "The host couldn't fit your RSVP this time.",
        sms: fitTitleToSegment(
          (title) => `Mingla: The host couldn't fit your RSVP for ${title}.`,
          event,
        ),
      };
    case "rsvp_removed":
      return {
        title: `Update: ${event}`,
        body: "The host removed you from this event.",
        sms: fitTitleToSegment(
          (title) => `Mingla: The host removed you from ${title}.`,
          event,
        ),
      };
    default: {
      const unreachable: never = template;
      throw new Error(`rsvp_template_unknown:${String(unreachable)}`);
    }
  }
}
