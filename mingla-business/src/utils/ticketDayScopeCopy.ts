/**
 * issue #3281 — the ticket sheet's Valid on rules and copy. Only the lazy sheet
 * imports this, so its long strings stay out of the boot bundle.
 */
import type { MultiDateEntry } from "../store/draftEventStore";
import { formatDraftDayScopeLabel } from "./ticketDayScope";

type Entries = readonly MultiDateEntry[];

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
): string | null => {
  if (scopeIds === null || scopeIds === undefined) {
    // What a guest uses depends on the mode, so say nothing when it is unknown.
    if (pricingMode === undefined) return null;
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
  if (selected === null && soldByDay === null) {
    // Leaving All dates needs the sold days, or it could drop one.
    return { next: null, alert: "Still checking sales. Try again in a moment." };
  }
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
