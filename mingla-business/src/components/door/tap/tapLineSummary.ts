/**
 * #4271 — "2× General admission" style summary of a Tap to Pay draft's lines,
 * named from the event's ticket types. An unknown ticket type reads "Ticket"
 * rather than inventing a name.
 */
import type { TapToPayDraftLine } from "../../../services/terminal/tapToPayDraft";

export const summarizeTapLines = (
  lines: readonly TapToPayDraftLine[],
  tickets: readonly { id: string; name: string }[],
): string =>
  lines
    .map((line) => {
      const name = tickets.find((ticket) => ticket.id === line.ticketTypeId)?.name?.trim();
      return `${line.quantity}× ${name !== undefined && name.length > 0 ? name : "Ticket"}`;
    })
    .join(" · ");
