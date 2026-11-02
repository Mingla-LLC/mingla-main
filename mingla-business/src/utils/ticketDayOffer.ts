/**
 * issue #3281 — what a day-limited ticket means for a guest's chosen days.
 *
 * Everything here returns nothing for an All dates ticket, so a page with no
 * listed ticket is unchanged.
 */
import { formatChosenDaysLabel, type OccurrenceDateLike } from "./eventDateDisplay";

export interface TicketDayView {
  dayScopeLabel: string | null;
  offChosenDays: boolean;
  lineDayCount?: number;
}

export const ticketDayView = (
  validIds: readonly string[] | null | undefined,
  occurrences: readonly OccurrenceDateLike[],
  chosenIds: readonly string[],
  perDay: boolean,
  timezone: string | null | undefined,
): TicketDayView => {
  if (validIds === null || validIds === undefined) {
    return { dayScopeLabel: null, offChosenDays: false };
  }
  const coversAll = occurrences.every((o) => validIds.includes(o.id));
  const inScope = chosenIds.filter((id) => validIds.includes(id));
  return {
    // A ticket on every date reads the same as All dates to a guest.
    dayScopeLabel: coversAll
      ? null
      : formatChosenDaysLabel(occurrences, [...validIds], timezone),
    offChosenDays: chosenIds.length > 0 && inScope.length === 0,
    lineDayCount: perDay ? Math.max(inScope.length, 1) : undefined,
  };
};

/** Copy for the notice after unticking a day removed tickets from the cart. */
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
