/**
 * issue #3281 — the guest-chosen experience start (`orders.booked_start_at`,
 * round 1b / #3979), worded once for every Host surface that shows it: order
 * detail, the door scanner, "Find by name", the guest list and guest detail.
 *
 * The time is always read in the offering's own time zone, never the phone's:
 * a host checking a Lagos experience from Chicago must see the Lagos time the
 * guest picked. A missing or unknown zone falls back to UTC rather than the
 * phone's zone, so two phones never disagree about one booking.
 *
 * Pure: no React, no store reads.
 */

const hasValue = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

const zoneOrUtc = (timeZone: string | null | undefined): string => {
  if (!hasValue(timeZone)) return "UTC";
  try {
    // Throws RangeError for a zone the runtime does not know.
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return timeZone;
  } catch {
    return "UTC";
  }
};

const parse = (iso: string | null | undefined): Date | null => {
  if (!hasValue(iso)) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * "Sat, Nov 14, 7:30 PM" in the offering's zone (the reader's locale decides
 * the order and the clock). Null when there is no booked start, or when it is
 * not a readable instant: never an invented time (Constitution #9).
 */
export const formatBookedStart = (
  iso: string | null | undefined,
  timeZone: string | null | undefined,
): string | null => {
  const d = parse(iso);
  if (d === null) return null;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: zoneOrUtc(timeZone),
  }).format(d);
};

/** The door and roster line: "Booked for Sat, Nov 14, 7:30 PM", or null. */
export const bookedStartLine = (
  iso: string | null | undefined,
  timeZone: string | null | undefined,
): string | null => {
  const when = formatBookedStart(iso, timeZone);
  return when === null ? null : `Booked for ${when}`;
};

/**
 * The CSV cell: "2026-11-14 19:30" — the offering's wall-clock time, sortable
 * and locale-free so a spreadsheet reads it the same everywhere. Blank when
 * there is no booked start.
 */
export const bookedStartCsvCell = (
  iso: string | null | undefined,
  timeZone: string | null | undefined,
): string => {
  const d = parse(iso);
  if (d === null) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: zoneOrUtc(timeZone),
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
};
