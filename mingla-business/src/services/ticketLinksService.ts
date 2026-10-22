import { supabase } from "./supabase";
import type { TicketLinkKind, TicketLinkState } from "./ticketLinkPublicTypes";

export type { TicketLinkKind, TicketLinkState } from "./ticketLinkPublicTypes";

export interface TicketLinkRecord {
  id: string;
  eventId: string;
  ticketTypeId: string;
  ticketTypeName: string;
  eventDateId: string | null;
  kind: TicketLinkKind;
  label: string;
  maxUses: number | null;
  partyMax: number;
  approvalMode: "auto" | "host";
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  state: TicketLinkState;
  usesTaken: number;
  usesLeft: number | null;
  pendingCount: number;
  pendingPeople: number;
  issuedPeople: number;
  paidOrders: number;
  paidTickets: number;
  url: string;
}

export interface TicketLinkPerson {
  position: number;
  name: string;
  email: string;
  phone: string;
  alreadyOnList: boolean;
}

export interface TicketLinkRequest {
  id: string;
  linkId: string;
  linkLabel: string;
  ticketTypeName: string;
  createdAt: string;
  eventDateId: string | null;
  /** issue #3827 — every date the group asked for (several on a multi-date event). */
  dates?: Array<{ id: string; startAt: string; endAt: string; timezone: string }>;
  memberCount: number;
  members: TicketLinkPerson[];
}

export class TicketLinkError extends Error {
  constructor(
    readonly code: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(ticketLinkErrorCopy(code, detail));
    this.name = "TicketLinkError";
  }
}

export function ticketLinkErrorCopy(code: string, detail: Record<string, unknown> = {}): string {
  switch (code) {
    case "forbidden": return "You don't have permission to manage this event's links.";
    case "event_unavailable": return "This event isn't published, so links can't be used yet.";
    case "event_ended": return "This event has ended.";
    case "event_type_unsupported": return "Private links are for ticketed events.";
    case "tier_not_sellable_online": return "This ticket type is paused or door-only. Turn on online sales to use a private link.";
    case "paid_tier_must_be_hidden": return "Paid private links require a hidden ticket type.";
    case "occurrence_not_available": return "That date is no longer available.";
    case "event_date_choice_required": return "Choose an event date before joining the guest list.";
    case "not_a_guest_list_link": return "This invitation opens checkout instead of the guest list.";
    case "invalid_request": return "Check the details for every person and try again.";
    case "rate_limited": return "Too many attempts. Wait a moment and try again.";
    case "expiry_in_past": return "Pick a time in the future.";
    case "too_many_links": return "This event already has 100 links. Revoke some before adding more.";
    case "max_below_used": return `${Number(detail.used ?? 0)} people already used this link. Set the limit to that number or more.`;
    case "link_revoked": return "This link was revoked.";
    case "link_full": return "This link has no places left.";
    case "ticket_capacity_exceeded": return "There aren't enough event places left for this group.";
    case "network": return "Couldn't reach Mingla. Check your connection and try again.";
    case "link_service_unavailable": return "Private links are temporarily unavailable. Try again shortly.";
    default: return "Something went wrong. Try again.";
  }
}

async function readError(error: unknown): Promise<TicketLinkError> {
  const context = (error as { context?: Response } | null)?.context;
  if (!context || typeof context.text !== "function") return new TicketLinkError("network");
  try {
    const payload = JSON.parse(await context.text()) as Record<string, unknown>;
    return new TicketLinkError(typeof payload.code === "string" ? payload.code : "internal", payload);
  } catch {
    return new TicketLinkError("internal");
  }
}

async function invokeHost<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("ticket-links", { body });
  if (error) throw await readError(error);
  return data as T;
}

export const listTicketLinks = async (eventId: string): Promise<TicketLinkRecord[]> =>
  (await invokeHost<{ links: TicketLinkRecord[] }>({ op: "list", eventId })).links;

export const createTicketLink = async (input: {
  eventId: string;
  ticketTypeId: string;
  eventDateId: string | null;
  label: string;
  maxUses: number | null;
  partyMax: number;
  approvalMode: "auto" | "host";
  expiresAt: string | null;
}): Promise<TicketLinkRecord> =>
  (await invokeHost<{ link: TicketLinkRecord }>({ op: "create", ...input })).link;

export const updateTicketLink = async (linkId: string, patch: Record<string, unknown>): Promise<void> => {
  await invokeHost({ op: "update", linkId, patch });
};

export const revokeTicketLink = async (linkId: string): Promise<void> => {
  await invokeHost({ op: "revoke", linkId });
};

export const resetTicketLink = async (linkId: string): Promise<{ id: string; url: string }> =>
  (await invokeHost<{ link: { id: string; url: string } }>({ op: "reset", linkId })).link;

export const listTicketLinkRequests = async (eventId: string, linkId?: string): Promise<TicketLinkRequest[]> =>
  (await invokeHost<{ requests: TicketLinkRequest[] }>({ op: "requests", eventId, linkId: linkId ?? null })).requests;

export const decideTicketLinkRequest = async (input: {
  signupId: string;
  decision: "approve" | "decline";
  clientRequestId: string;
}): Promise<{ status: string; leadOrderId?: string; issuedCount: number; skippedNames: string[] }> =>
  invokeHost({ op: "decide", ...input });
