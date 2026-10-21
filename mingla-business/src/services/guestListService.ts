/**
 * guestListService — issue #3827 client for the `guest-list` edge function.
 *
 * Guest-list (comp) tickets: issue, cancel, resend, door name search and the
 * manual admit. Every call throws a typed {@link GuestListError}; the copy the
 * host sees comes from {@link guestListErrorCopy}, never from server detail.
 */

import { supabase } from "./supabase";

export type GuestListErrorCode =
  | "unauthorized"
  | "forbidden"
  | "scanner_not_authorized"
  | "event_not_open"
  | "event_already_ended"
  | "event_type_unsupported"
  | "ticket_type_not_found"
  | "event_date_choice_required"
  | "occurrence_not_available"
  | "ticket_capacity_exceeded"
  | "invalid_guests"
  | "invalid_request"
  | "not_a_guest_list_ticket"
  | "comp_already_checked_in"
  | "reason_invalid_length"
  | "not_resendable"
  | "no_email"
  | "query_too_short"
  | "query_too_long"
  | "rate_limited"
  | "internal"
  | "network";

export type GuestListOperation = "issue" | "cancel" | "resend" | "search" | "admit";

export class GuestListError extends Error {
  readonly code: GuestListErrorCode;
  readonly httpStatus: number | null;
  readonly remaining: number | null;
  readonly ticketName: string | null;
  readonly operation: GuestListOperation;

  constructor(args: {
    code: GuestListErrorCode;
    operation: GuestListOperation;
    httpStatus?: number | null;
    remaining?: number | null;
    ticketName?: string | null;
  }) {
    super(guestListErrorCopy(args.code, args.operation, args.remaining ?? null, args.ticketName ?? null));
    this.name = "GuestListError";
    this.code = args.code;
    this.operation = args.operation;
    this.httpStatus = args.httpStatus ?? null;
    this.remaining = args.remaining ?? null;
    this.ticketName = args.ticketName ?? null;
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set<GuestListErrorCode>([
  "unauthorized", "forbidden", "scanner_not_authorized", "event_not_open",
  "event_already_ended", "event_type_unsupported", "ticket_type_not_found",
  "event_date_choice_required", "occurrence_not_available", "ticket_capacity_exceeded",
  "invalid_guests", "invalid_request", "not_a_guest_list_ticket", "comp_already_checked_in",
  "reason_invalid_length", "not_resendable", "no_email", "query_too_short",
  "query_too_long", "rate_limited", "internal", "network",
]);

/** Host copy for each code (spec §3). */
export const guestListErrorCopy = (
  code: GuestListErrorCode,
  operation: GuestListOperation,
  remaining: number | null = null,
  ticketName: string | null = null,
): string => {
  switch (code) {
    case "unauthorized":
      return "You're signed out. Sign in and try again.";
    case "forbidden":
      return "You don't have permission to manage this event's guest list.";
    case "scanner_not_authorized":
      return "You're not authorized to check guests in for this event. Ask the event owner to add you as a scanner.";
    case "event_not_open":
      return "This event isn't open, so guest-list tickets can't be added.";
    case "event_already_ended":
      return "This event has ended.";
    case "event_type_unsupported":
      return "Guest-list tickets are for ticketed events.";
    case "ticket_type_not_found":
      return "That ticket type was removed. Pick another one.";
    case "event_date_choice_required":
      return "Pick which date they're coming.";
    case "occurrence_not_available":
      return "That date has passed. Pick another one.";
    case "ticket_capacity_exceeded":
      return `Not enough places left on ${ticketName ?? "this ticket type"}. ${remaining ?? 0} left.`;
    case "invalid_guests":
    case "invalid_request":
      return "Check the highlighted guests and try again.";
    case "not_a_guest_list_ticket":
      return "This isn't a guest-list ticket.";
    case "comp_already_checked_in":
      return "They're already checked in, so this ticket can't be cancelled.";
    case "reason_invalid_length":
      return "Keep the reason under 200 characters.";
    case "not_resendable":
      return "This ticket was cancelled, so it can't be resent.";
    case "no_email":
      return "There's no email for this guest.";
    case "query_too_short":
      return "Type at least 2 letters.";
    case "query_too_long":
      return "Keep the search under 80 characters.";
    case "rate_limited":
      if (operation === "issue") {
        return "You've added a lot of guests in a short time. Wait a few minutes and try again.";
      }
      if (operation === "resend") return "Ticket already resent 3 times this hour. Try again later.";
      return "Too many searches. Wait a moment.";
    case "network":
      return operation === "search" || operation === "admit"
        ? "Couldn't search. Check your connection and try again."
        : "Something went wrong. Nothing was charged. Try again. Guests already added won't be added twice.";
    case "internal":
      return "Something went wrong. Nothing was charged. Try again. Guests already added won't be added twice.";
  }
};

const readErrorPayload = async (
  ctx: Response,
): Promise<{ code?: unknown; remaining?: unknown; ticketName?: unknown }> => {
  try {
    const text = await ctx.text();
    const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const invoke = async <T>(operation: GuestListOperation, body: Record<string, unknown>): Promise<T> => {
  let response: { data: unknown; error: unknown };
  try {
    response = await supabase.functions.invoke("guest-list", { body: { operation, ...body } });
  } catch {
    throw new GuestListError({ code: "network", operation });
  }
  if (response.error) {
    const ctx = (response.error as { context?: Response }).context;
    if (ctx === undefined || ctx === null || typeof ctx.text !== "function") {
      // No HTTP response at all: the request never reached the function.
      throw new GuestListError({ code: "network", operation });
    }
    const payload = await readErrorPayload(ctx);
    const raw = typeof payload.code === "string" ? payload.code : "internal";
    throw new GuestListError({
      code: KNOWN_CODES.has(raw) ? (raw as GuestListErrorCode) : "internal",
      operation,
      httpStatus: typeof ctx.status === "number" ? ctx.status : null,
      remaining: typeof payload.remaining === "number" ? payload.remaining : null,
      ticketName: typeof payload.ticketName === "string" ? payload.ticketName : null,
    });
  }
  return response.data as T;
};

// ---- issue -----------------------------------------------------------------

export interface GuestListPlusOneInput {
  name: string | null;
  email: string | null;
  phoneE164: string | null;
}

export interface GuestListGuestInput {
  index: number;
  name: string;
  email: string | null;
  phoneE164: string | null;
  plusOnes: GuestListPlusOneInput[];
}

export interface GuestListIssueInput {
  eventId: string;
  ticketTypeId: string;
  eventDateId: string | null;
  guests: GuestListGuestInput[];
  note: string | null;
  /** One id per sheet submission, reused on every retry of it. */
  clientRequestId: string;
}

export type GuestListIssueFailureCode =
  | "already_on_guest_list"
  | "lead_not_added"
  | "internal";

export interface GuestListIssueResult {
  index: number;
  /** null for the guest; the plus-one's position for a named plus-one. */
  plusOneIndex: number | null;
  status: "added" | "replayed" | "failed";
  orderId: string | null;
  ticketCount: number | null;
  emailQueued: boolean;
  smsQueued: boolean;
  code: GuestListIssueFailureCode | null;
}

export interface GuestListIssueResponse {
  eventDateId: string | null;
  results: GuestListIssueResult[];
  addedCount: number;
  failedCount: number;
  remaining: number | null;
}

export const issueGuestListTickets = (input: GuestListIssueInput): Promise<GuestListIssueResponse> =>
  invoke<GuestListIssueResponse>("issue", {
    eventId: input.eventId,
    ticketTypeId: input.ticketTypeId,
    eventDateId: input.eventDateId,
    guests: input.guests,
    note: input.note,
    clientRequestId: input.clientRequestId,
  });

export const guestListIssueFailureCopy = (code: GuestListIssueFailureCode | null): string => {
  if (code === "already_on_guest_list") return "Already on the guest list for this event.";
  if (code === "lead_not_added") return "Couldn't attach this plus-one to their guest. Add them as their own guest.";
  return "Couldn't add this guest. Try again.";
};

// ---- cancel / resend -------------------------------------------------------

export const cancelGuestListTicket = (input: {
  orderId: string;
  reason: string | null;
  clientRequestId: string;
}): Promise<{ orderId: string; status: "cancelled"; idempotentReplay: boolean }> =>
  invoke("cancel", { orderId: input.orderId, reason: input.reason, clientRequestId: input.clientRequestId });

/** Any paid order of the event (issue #3827 Q10 / discovery D-1). */
export const resendGuestListTicket = (input: {
  orderId: string;
  clientRequestId: string;
}): Promise<{ queued: true }> =>
  invoke("resend", { orderId: input.orderId, clientRequestId: input.clientRequestId });

// ---- door ------------------------------------------------------------------

export type DoorTicketStatus = "valid" | "used" | "void" | "refunded" | "transferred";

export interface DoorGuestTicket {
  ticketId: string;
  ticketName: string;
  status: DoorTicketStatus;
  usedAt: string | null;
  eventDateIds: string[];
}

export interface DoorGuest {
  orderId: string;
  displayName: string;
  maskedEmail: string | null;
  isGuestList: boolean;
  cameWithName: string | null;
  viaLinkLabel: string | null;
  tickets: DoorGuestTicket[];
}

export const searchDoorGuests = (input: {
  eventId: string;
  query: string;
}): Promise<{ orders: DoorGuest[]; truncated: boolean }> =>
  invoke("search", { eventId: input.eventId, query: input.query });

/** The biz_ticket_scan result vocabulary (success, duplicate, void, …). */
export type AdmitResult = string;

export interface AdmitResponse {
  result: AdmitResult;
  ticketId: string | null;
  orderId: string | null;
  buyerName: string | null;
  ticketName: string | null;
  nextStartAt: string | null;
  lastEndAt: string | null;
  eventDateId: string | null;
}

export const admitTicket = (input: { eventId: string; ticketId: string }): Promise<AdmitResponse> =>
  invoke("admit", { eventId: input.eventId, ticketId: input.ticketId });
