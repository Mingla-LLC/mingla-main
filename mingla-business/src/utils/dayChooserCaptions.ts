/**
 * issue #3281 — date picker captions for day-limited tickets. Only the lazy
 * picker imports this, so it stays out of the boot bundle.
 */
import type { TicketStub } from "../store/draftEventStore";

interface ChooserTicket {
  visibility: TicketStub["visibility"];
  validOccurrenceIds?: readonly string[] | null;
  soldOutOccurrenceIds?: readonly string[];
}

/**
 * The caption on each date in the picker. Only events with a listed ticket get
 * any, because only they can leave a date short of tickets.
 */
export const dayChooserCaptions = (
  tickets: readonly ChooserTicket[],
  occurrences: readonly { id: string }[],
): Readonly<Record<string, string>> => {
  const sellable = tickets.filter((ticket) => ticket.visibility === "public");
  if (!sellable.some((ticket) => ticket.validOccurrenceIds != null)) return {};
  const captions: Record<string, string> = {};
  for (const { id } of occurrences) {
    const covering = sellable.filter(
      (ticket) => ticket.validOccurrenceIds?.includes(id) ?? true,
    );
    if (covering.length === 0) captions[id] = "No tickets";
    else if (covering.every((ticket) => ticket.soldOutOccurrenceIds?.includes(id))) {
      captions[id] = "Sold out";
    }
  }
  return captions;
};
