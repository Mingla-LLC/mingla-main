// Issue #4508 — the words a brought guest receives.
//
// 1.12 invite text: "Mingla: {Ada O.} is bringing you to {event}, {date}. Get
//      your pass in the Mingla app: {link}". The adapter appends its STOP line;
//      the event name is shortened so the whole text stays one segment.
// 1.13 in-app and push for a guest who already has an account:
//      "{Ada O.} is bringing you to {event}".
// 2.1  reminder: "Mingla: your pass for {event} tomorrow is waiting. {Ada O.}
//      saved you a spot: {link}".
// The link is the guest's short claim link (usemingla.com/c/<code>).

import { fitTitleToSegment, toGsm7Text } from "../_shared/sms/buyerSms.ts";
import { inviterForText } from "../_shared/rsvpInviterName.ts";
import { formatMessageTime } from "../_shared/messageTime.ts";

export interface GuestCopy {
  title: string;
  body: string;
  sms: string;
}

export interface GuestMessageContext {
  exists: boolean;
  claimed?: boolean;
  eligible?: boolean;
  guestId?: string;
  rsvpId?: string;
  eventId?: string;
  eventTitle?: string | null;
  eventStartAt?: string | null;
  eventTimezone?: string | null;
  inviterLabel?: string | null;
  /** Never text this guest: no number, or the number's daily limit. */
  smsHold?: string | null;
}

// R-11: the inviter-name rule lives in _shared so the guest pass email uses
// the very same one.
export { inviterForText };

export function parseGuestMessageContext(
  data: unknown,
): GuestMessageContext | null {
  const value = Array.isArray(data) ? data[0] : data;
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.exists !== "boolean") return null;
  const str = (x: unknown): string | null =>
    typeof x === "string" && x.trim().length > 0 ? x.trim() : null;
  return {
    exists: v.exists,
    claimed: v.claimed === true,
    eligible: v.eligible === true,
    guestId: str(v.guestId) ?? undefined,
    rsvpId: str(v.rsvpId) ?? undefined,
    eventId: str(v.eventId) ?? undefined,
    eventTitle: str(v.eventTitle),
    eventStartAt: str(v.eventStartAt),
    eventTimezone: str(v.eventTimezone),
    inviterLabel: str(v.inviterLabel),
    smsHold: str(v.smsHold),
  };
}

export function buildGuestInviteCopy(input: {
  inviter: string | null | undefined;
  title: string | null | undefined;
  date: string | null | undefined;
  link: string;
}): GuestCopy {
  const inviter = inviterForText(input.inviter);
  const event = (input.title ?? "").trim() || "your event";
  const date = toGsm7Text(input.date ?? "");
  return {
    title: `${inviter} is bringing you to ${event}`,
    body: "Your pass is waiting in the Mingla app.",
    sms: fitTitleToSegment(
      (title) =>
        date.length > 0
          ? `Mingla: ${inviter} is bringing you to ${title}, ${date}. Get your pass in the Mingla app: ${input.link}`
          : `Mingla: ${inviter} is bringing you to ${title}. Get your pass in the Mingla app: ${input.link}`,
      event,
    ),
  };
}

export function buildGuestReminderCopy(input: {
  inviter: string | null | undefined;
  title: string | null | undefined;
  link: string;
}): GuestCopy {
  const inviter = inviterForText(input.inviter);
  const event = (input.title ?? "").trim() || "your event";
  return {
    title: `Your pass for ${event} is waiting`,
    body: `${inviter} saved you a spot. Get your pass in the Mingla app.`,
    sms: fitTitleToSegment(
      (title) =>
        `Mingla: your pass for ${title} tomorrow is waiting. ${inviter} saved you a spot: ${input.link}`,
      event,
    ),
  };
}

/** The pass templates whose guest copy names the inviter (1.12, 1.13). */
export function isGuestInviteTemplate(
  template: string,
  payload: Record<string, unknown>,
): boolean {
  return payload.role === "guest" &&
    (template === "rsvp_pass" || template === "rsvp_approved" ||
      template === "rsvp_waitlist_promoted");
}

/** The friend-is-going push (2.3). */
export function buildFriendGoingCopy(input: {
  actorName: string | null | undefined;
  eventTitle: string | null | undefined;
}): { title: string; body: string } {
  const name = (input.actorName ?? "").trim() || "A friend";
  const event = (input.eventTitle ?? "").trim() || "an event";
  return {
    title: `${name} is going to ${event}`,
    body: `${name} is going to ${event}. Join them?`,
  };
}

export interface GuestMessageDeps {
  /** rsvp_guest_message_context; "unavailable" when the read failed. */
  context(guestId: string): Promise<GuestMessageContext | "unavailable">;
  /** The guest's short claim link, or null when it could not be minted. */
  claimLink(guestId: string): Promise<{ url: string; display: string } | null>;
}

export type GuestMessageDecision =
  | { kind: "not_guest_row" }
  | {
    kind: "finish";
    status: "failed_terminal" | "failed_retryable";
    code: string;
  }
  | { kind: "message"; copy: GuestCopy; link: string | null };

const textOf = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

/**
 * Issue #4508 — decides what a queue row for a brought guest becomes:
 * not a guest invite/reminder row (carry on as before), finished without a
 * send (a released guest, a reminder no longer needed, a read that failed),
 * or a message naming the inviter with the guest's claim link.
 */
export async function resolveGuestMessage(
  deps: GuestMessageDeps,
  input: {
    template: string;
    channel: string;
    payload: Record<string, unknown>;
  },
): Promise<GuestMessageDecision> {
  const isReminder = input.template === "rsvp_guest_reminder";
  const guestId = textOf(input.payload.guestId);
  if (!isReminder && !isGuestInviteTemplate(input.template, input.payload)) {
    return { kind: "not_guest_row" };
  }
  if (guestId === null) {
    return isReminder
      ? {
        kind: "finish",
        status: "failed_terminal",
        code: "rsvp_guest_missing",
      }
      : { kind: "not_guest_row" };
  }
  const ctx = await deps.context(guestId);
  if (ctx === "unavailable") {
    return {
      kind: "finish",
      status: "failed_retryable",
      code: "rsvp_guest_context_unavailable",
    };
  }
  // 1.18 — a released guest is never texted again.
  if (!ctx.exists) {
    return {
      kind: "finish",
      status: "failed_terminal",
      code: "rsvp_guest_released",
    };
  }
  // #4508: a guest with no number, or whose number already had its guest
  // invites for the day, is never texted (in-app and push still go).
  if (input.channel === "sms" && ctx.smsHold) {
    return {
      kind: "finish",
      status: "failed_terminal",
      code: "rsvp_guest_sms_held",
    };
  }
  if (isReminder && (ctx.claimed || !ctx.eligible)) {
    return {
      kind: "finish",
      status: "failed_terminal",
      code: "rsvp_guest_reminder_not_needed",
    };
  }
  // The invite email keeps the shared #4063 message; texts, push and in-app
  // name the inviter. A reminder reads the same on every channel.
  if (!isReminder && input.channel === "email") {
    return { kind: "not_guest_row" };
  }
  const link = await deps.claimLink(guestId);
  if (link === null && input.channel === "sms") {
    return {
      kind: "finish",
      status: "failed_retryable",
      code: "rsvp_guest_link_unavailable",
    };
  }
  const display = link?.display ?? "usemingla.com/download";
  const date = ctx.eventStartAt && ctx.eventTimezone
    ? formatMessageTime(ctx.eventStartAt, ctx.eventTimezone)?.date ?? null
    : null;
  const title = ctx.eventTitle ?? textOf(input.payload.eventName);
  const copy = isReminder
    ? buildGuestReminderCopy({
      inviter: ctx.inviterLabel,
      title,
      link: display,
    })
    : buildGuestInviteCopy({
      inviter: ctx.inviterLabel,
      title,
      date,
      link: display,
    });
  return { kind: "message", copy, link: link?.url ?? null };
}
