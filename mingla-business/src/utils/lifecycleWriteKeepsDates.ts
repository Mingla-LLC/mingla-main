/**
 * lifecycleWriteKeepsDates — issue #3645.
 *
 * WHAT WENT WRONG. A cancelled event's manage screen showed "Date TBD". The
 * cancel (and end-ticket-sales) RPCs answer with the event row and its tickets
 * but NOT its dates, so the event mapped from that answer has no date. That
 * dateless event was written straight into the cache the manage screen reads,
 * replacing an event that had a perfectly good date a moment earlier.
 *
 * Cancelling does not change when an event was. When a lifecycle answer
 * carries no date, the date already known for the SAME event is kept.
 */

interface DateBearingEvent {
  id: string;
  date: string | null;
  doorsOpen: string | null;
  endsAt: string | null;
  masterStartAtUtc?: string | null;
  masterEndAtUtc?: string | null;
  timezone: string;
}

const hasDate = (event: DateBearingEvent): boolean =>
  event.date !== null ||
  (typeof event.masterStartAtUtc === "string" && event.masterStartAtUtc.length > 0);

/**
 * `next` is the event mapped from a lifecycle RPC's answer; `previous` is the
 * same event as the cache held it. Returns `next` untouched unless it has no
 * date and `previous` is the same event with one.
 */
export function keepEventDatesAcrossLifecycleWrite<T extends DateBearingEvent>(
  next: T,
  previous: T | null | undefined,
): T {
  if (previous === null || previous === undefined) return next;
  if (previous.id !== next.id) return next;
  if (hasDate(next) || !hasDate(previous)) return next;
  return {
    ...next,
    date: previous.date,
    doorsOpen: previous.doorsOpen,
    endsAt: previous.endsAt,
    masterStartAtUtc: previous.masterStartAtUtc ?? null,
    masterEndAtUtc: previous.masterEndAtUtc ?? null,
    // The date's own timezone travels with it.
    timezone: previous.timezone,
  };
}
