/**
 * issue #3827 — which ticket types a private link may use, and the two ways a
 * host can add one when none can.
 *
 * Pure (no React Native imports) so the rule is unit-testable on its own and
 * shared by the link sheet, the guests route and the event editor.
 *
 * The rule: a FREE type (guest-list sign-up link) may be public or hidden; a
 * PAID type (private ticket link) must be hidden, so the link is the only way
 * to buy it.
 */

import type { TicketStub } from "../store/draftEventStore";

export const isFreeTicketType = (ticket: Pick<TicketStub, "isFree" | "priceGbp">): boolean =>
  ticket.isFree || (ticket.priceGbp ?? 0) === 0;

export const isTicketLinkable = (
  ticket: Pick<TicketStub, "isFree" | "priceGbp" | "visibility">,
): boolean => isFreeTicketType(ticket) || ticket.visibility === "hidden";

/**
 * How the ticket-type editor opens when a host adds a type from the private
 * link sheet: a hidden paid ticket, or a free guest-list ticket.
 */
export type NewTicketPreset = "hidden-paid" | "free-guest-list";

export const NEW_TICKET_PRESETS: readonly NewTicketPreset[] = ["hidden-paid", "free-guest-list"];

/** Route params arrive as strings; anything else is ignored. */
export const parseNewTicketPreset = (value: unknown): NewTicketPreset | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "hidden-paid" || raw === "free-guest-list" ? raw : null;
};

/**
 * The published-event editor, opened on its Tickets section with the new
 * ticket sheet already open in the given preset.
 */
export const addTicketTypeForLinkRoute = (eventId: string, preset: NewTicketPreset): string =>
  `/event/${encodeURIComponent(eventId)}/edit?mode=edit-published&section=tickets&newTicket=${preset}`;

export const TICKET_LINK_EMPTY_COPY =
  "No ticket types can use a private link yet. Paid links need a hidden ticket type; free guest-list links can use any free type.";

export const TICKET_LINK_NO_TYPE_REASON = "Pick a ticket type to create a link.";
