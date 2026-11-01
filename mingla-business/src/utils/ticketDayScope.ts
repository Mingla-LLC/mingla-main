/**
 * issue #3281 — day-limited tickets on the Host side.
 *
 * A ticket's `validDayIds` holds `MultiDateEntry.id`s. Null or undefined means
 * All dates, an array means those dates, and `[]` means every listed date was
 * deleted and the organiser must choose again. The server stores the same ids
 * as `event_dates.occurrence_key`.
 *
 * Kept out of `ticketDisplay.ts` and `eventDateDisplay.ts` so the lazy ticket
 * chunks carry it, not the boot bundle.
 */
import type {
  MultiDateEntry,
  TicketStub,
  WhenMode,
} from "../store/draftEventStore";
import { formatShortDate } from "./eventDateDisplay";

type Entries = readonly MultiDateEntry[];

const sortedEntries = (entries: Entries): MultiDateEntry[] =>
  [...entries].sort((a, b) =>
    `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`),
  );

/** The field exists only on a multi-date event with at least two dates. */
export const eventHasDayScope = (
  whenMode: WhenMode | null | undefined,
  entries: Entries | null | undefined,
): boolean => whenMode === "multi_date" && (entries?.length ?? 0) >= 2;

export const isDayLimited = (
  ticket: Pick<TicketStub, "validDayIds">,
): boolean => ticket.validDayIds !== null && ticket.validDayIds !== undefined;

/** "Fri 2 Oct", "A + B", "3 days · A – C" or "3 of 6 days · from A". */
export const formatDraftDayScopeLabel = (
  entries: Entries,
  scopeIds: readonly string[] | null | undefined,
): string | null => {
  if (scopeIds === null || scopeIds === undefined || scopeIds.length === 0) {
    return null;
  }
  const ordered = sortedEntries(entries);
  const chosen = ordered.filter((entry) => scopeIds.includes(entry.id));
  if (chosen.length === 0) return null;
  const first = formatShortDate(chosen[0].date);
  const last = formatShortDate(chosen[chosen.length - 1].date);
  if (chosen.length === 1) return first;
  if (chosen.length === 2) return `${first} + ${last}`;
  // A range must never hide an event date the ticket does not cover.
  const span =
    ordered.indexOf(chosen[chosen.length - 1]) - ordered.indexOf(chosen[0]) + 1;
  return span === chosen.length
    ? `${chosen.length} days · ${first} – ${last}`
    : `${chosen.length} of ${ordered.length} days · from ${first}`;
};

/** Dates no public, sellable ticket covers. Door-only tickets count. */
export const uncoveredEntries = (
  tickets: readonly TicketStub[],
  entries: Entries,
): MultiDateEntry[] => {
  const sellable = tickets.filter(
    (ticket) => ticket.visibility === "public",
  );
  return sortedEntries(entries).filter(
    (entry) =>
      !sellable.some(
        (ticket) =>
          !isDayLimited(ticket) || ticket.validDayIds?.includes(entry.id),
      ),
  );
};

export const coverageCaution = (
  tickets: readonly TicketStub[],
  entries: Entries,
): string | null => {
  if (tickets.length === 0) return null;
  const missing = uncoveredEntries(tickets, entries);
  if (missing.length === 0) return null;
  if (missing.length >= 3) {
    return `${missing.length} dates have no tickets, starting ${formatShortDate(missing[0].date)}. Guests who pick them won't find anything to buy.`;
  }
  const label = formatDraftDayScopeLabel(
    entries,
    missing.map((entry) => entry.id),
  );
  return missing.length === 1
    ? `No ticket covers ${label}. Guests who pick that day won't find anything to buy.`
    : `No ticket covers ${label}. Guests who pick those days won't find anything to buy.`;
};

/** A deleted date leaves every list. An emptied list stays `[]`, never All dates. */
export const ticketsWithoutDay = (
  tickets: readonly TicketStub[],
  entryId: string,
): TicketStub[] =>
  tickets.map((ticket) =>
    ticket.validDayIds?.includes(entryId)
      ? {
          ...ticket,
          validDayIds: ticket.validDayIds.filter((id) => id !== entryId),
        }
      : ticket,
  );

const ticketPhrase = (names: readonly string[]): string =>
  names.length === 1 ? names[0] : `${names.length} tickets`;

/** The body of the delete-date dialog, or null when no ticket lists the date. */
export const deleteDateImpact = (
  tickets: readonly TicketStub[],
  entryId: string,
): string | null => {
  const listing = tickets.filter((t) => t.validDayIds?.includes(entryId));
  if (listing.length === 0) return null;
  const orphaned = listing.filter((t) => t.validDayIds?.length === 1);
  const kept = listing.filter((t) => (t.validDayIds?.length ?? 0) > 1);
  const keeps = kept.length === 0
    ? ""
    : `${ticketPhrase(kept.map((t) => t.name))} ${kept.length === 1 ? "will keep its" : "will keep their"} other days.`;
  if (orphaned.length === 0) return keeps;
  const onlyHere = orphaned.length === 1
    ? `${orphaned[0].name} is only valid on this date, so it will have no days left.`
    : `${orphaned.length} tickets are only valid on this date, so they will have no days left.`;
  return `${onlyHere} You'll need to fix ${orphaned.length === 1 ? "it" : "them"} before publishing.${keeps.length > 0 ? ` ${keeps}` : ""}`;
};

export const dayScopeHelper = (
  scopeIds: readonly string[] | null | undefined,
  dateCount: number,
  hasSales: boolean,
): string => {
  if (scopeIds === null || scopeIds === undefined) {
    return "Works on every date, including any you add later.";
  }
  if (scopeIds.length === 0) return "Pick at least one day, or choose All dates.";
  if (hasSales) {
    return "Days with sales stay on this ticket. You can add days, or remove days nobody has bought.";
  }
  if (scopeIds.length === dateCount) {
    return "Every current date. Dates you add later won't be included.";
  }
  return scopeIds.length === 1
    ? "Only guests who pick this day can buy it."
    : "Only guests who pick one of these days can buy it.";
};

export const capacityLabel = (limited: boolean): string =>
  limited ? "Capacity per day" : "Total capacity";

export const capacityHelper = (
  scopeIds: readonly string[] | null | undefined,
  entries: Entries,
  capacity: number | null,
  pricingMode: "per_day" | "all_days" | undefined,
): string => {
  if (scopeIds === null || scopeIds === undefined) {
    return pricingMode === "all_days"
      ? "Shared across all dates. Each guest uses 1, however many days they pick."
      : "Shared across all dates. A guest who picks 2 days uses 2.";
  }
  if (scopeIds.length === 1) {
    const day = formatDraftDayScopeLabel(entries, scopeIds);
    return capacity === null
      ? `The most guests this ticket admits on ${day}.`
      : `Up to ${capacity} guests on ${day}.`;
  }
  return capacity === null
    ? "The most guests this ticket admits on each of its days."
    : `Up to ${capacity} guests on each of its ${scopeIds.length} days.`;
};

/** Hidden when the pricing mode is unknown, so it never states wrong arithmetic. */
export const priceHelper = (
  dayCount: number,
  pricingMode: "per_day" | "all_days" | undefined,
  price: string | null,
  timesPrice: string | null,
): string | null => {
  if (pricingMode === undefined || price === null) return null;
  if (dayCount === 1) return `Guests pay ${price} for this day.`;
  return pricingMode === "per_day"
    ? `Priced per day. A guest who picks all ${dayCount} days pays ${timesPrice} and gets a pass for each.`
    : `One price. A guest pays ${price} whether they pick 1 day or all ${dayCount}, and gets one pass for the days they pick.`;
};

export interface DayTap {
  next: string[] | null;
  alert: string | null;
}

/**
 * One tap on a day in the Valid on picker. A day with sales stays, and while
 * sales are unknown every selected day stays. Removing the last day returns to
 * All dates, so the picker never writes `[]`.
 */
export const tapValidDay = (
  entries: Entries,
  selected: readonly string[] | null,
  entryId: string,
  soldByDay: Readonly<Record<string, number>> | null,
): DayTap => {
  const soldOn = (id: string): number => soldByDay?.[id] ?? 0;
  if (selected === null) {
    const next = [
      ...new Set([
        entryId,
        ...entries.map((e) => e.id).filter((id) => soldOn(id) > 0),
      ]),
    ];
    return {
      next,
      alert:
        next.length > 1
          ? `Days with sales were kept: ${formatDraftDayScopeLabel(entries, next)}.`
          : null,
    };
  }
  if (!selected.includes(entryId)) {
    return { next: [...selected, entryId], alert: null };
  }
  if (soldByDay === null) {
    return {
      next: [...selected],
      alert: "Still checking sales. Try again in a moment.",
    };
  }
  const sold = soldOn(entryId);
  if (sold > 0) {
    const day = formatDraftDayScopeLabel(entries, [entryId]);
    return {
      next: [...selected],
      alert: `${day} has ${sold} guest${sold === 1 ? "" : "s"} on this ticket, so it stays. Refund them first to remove it.`,
    };
  }
  const next = selected.filter((id) => id !== entryId);
  return { next: next.length === 0 ? null : next, alert: null };
};

export interface PassDays {
  ticketTypeId?: string | null;
  eventDateIds: readonly string[];
  status: string;
}

const LIVE_PASS_STATUSES = new Set(["valid", "used", "transferred"]);

/**
 * Sold passes per ticket and date key. A pass with no day row admits any day,
 * so it counts on every date, as the server's counter does.
 */
export const soldByTicketAndDay = (
  orders: readonly { ticketDays?: readonly PassDays[] | null }[],
  dateKeys: Readonly<Record<string, string | null>>,
): Record<string, Record<string, number>> => {
  const out: Record<string, Record<string, number>> = {};
  const allKeys = Object.values(dateKeys).filter(
    (key): key is string => key !== null,
  );
  for (const order of orders) {
    for (const pass of order.ticketDays ?? []) {
      if (!pass.ticketTypeId || !LIVE_PASS_STATUSES.has(pass.status)) continue;
      const keys = pass.eventDateIds.length === 0
        ? allKeys
        : pass.eventDateIds
            .map((id) => dateKeys[id])
            .filter((key): key is string => typeof key === "string");
      const row = (out[pass.ticketTypeId] ??= {});
      for (const key of keys) row[key] = (row[key] ?? 0) + 1;
    }
  }
  return out;
};
