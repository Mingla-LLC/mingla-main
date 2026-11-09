/**
 * issue #3281 — what a day-limited ticket means for a guest's chosen days, on
 * Explorer's event page and ticket cart. Mirrors Host web's ticketDayOffer.ts
 * and dayChooserCaptions.ts so both apps say the same thing.
 *
 * Everything here returns nothing for an All dates ticket, so an event with no
 * listed ticket is unchanged.
 */
import type { PublicTicketProps } from "@mingla/offering-rendering";

import type { PublicEventOccurrenceLike } from "../../hooks/usePublicEventBySlug";
import { formatOccurrenceLine } from "../../utils/eventDateDisplay";

/** "Fri 2 Oct" for one date, "2 of 3 dates" for more; null on every date. */
export const ticketDayScopeLabel = (
  validIds: readonly string[] | null | undefined,
  allOccurrences: readonly PublicEventOccurrenceLike[],
  timezone: string,
): string | null => {
  if (validIds == null) return null;
  // issue #3281 — a cancelled date is not one the ticket can be bought for.
  const occurrences = allOccurrences.filter((day) => day.cancelled !== true);
  const days = occurrences.filter((day) => validIds.includes(day.id));
  // A ticket on every date reads the same as All dates to a guest.
  if (days.length === 0 || days.length === occurrences.length) return null;
  return days.length === 1
    ? formatOccurrenceLine(days[0], timezone)
    : `${days.length} of ${occurrences.length} dates`;
};

/** True when the guest chose days and this listed ticket admits none of them. */
export const ticketOffChosenDays = (
  validIds: readonly string[] | null | undefined,
  chosenIds: readonly string[],
): boolean =>
  validIds != null &&
  chosenIds.length > 0 &&
  !chosenIds.some((id) => validIds.includes(id));

// An All dates ticket has one shared pool, so the server sends no per-date flags.
const isFullOn = (ticket: PublicTicketProps, id: string): boolean =>
  ticket.validOccurrenceIds != null
    ? ticket.soldOutOccurrenceIds?.includes(id) === true
    : ticket.isUnlimited !== true && (ticket.capacity ?? 1) <= 0;

/**
 * The caption on each date in the day picker: "No tickets" when no ticket
 * covers it, "Sold out" when every ticket that does is full there. Only events
 * with a listed ticket get any, because only they can leave a date short.
 */
export const dayChooserCaptions = (
  tickets: readonly PublicTicketProps[],
  occurrences: readonly { id: string }[],
): Readonly<Record<string, string>> => {
  const sellable = tickets.filter(
    (ticket) => ticket.visibility !== "hidden" && ticket.visibility !== "disabled",
  );
  if (!sellable.some((ticket) => ticket.validOccurrenceIds != null)) return {};
  const captions: Record<string, string> = {};
  for (const { id } of occurrences) {
    const covering = sellable.filter(
      (ticket) => ticket.validOccurrenceIds?.includes(id) ?? true,
    );
    if (covering.length === 0) captions[id] = "No tickets";
    else if (covering.every((ticket) => isFullOn(ticket, id))) {
      captions[id] = "Sold out";
    }
  }
  return captions;
};

/** Copy for the notice after a day change took tickets out of the cart. */
export const removedTicketsNotice = (
  removed: readonly { name: string; quantity: number; dayLabel: string | null }[],
): string => {
  if (removed.length >= 3) {
    return `Removed ${removed.length} tickets — they're not on your days.`;
  }
  const day = removed[0]?.dayLabel;
  const suffix = day != null ? `only for ${day}` : "not on your days";
  return removed.length === 1
    ? `Removed ${removed[0].quantity} × ${removed[0].name} — it's ${suffix}.`
    : `Removed ${removed[0].name} and ${removed[1].name} — they're ${suffix}.`;
};
