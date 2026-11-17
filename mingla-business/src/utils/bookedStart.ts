/**
 * issue #3281 — the guest-chosen experience start (`orders.booked_start_at`,
 * round 1b / #3979), worded once for every Host surface that shows it: order
 * detail, the door scanner, "Find by name", the guest list and guest detail.
 * (The CSV cell lives with the on-intent CSV code, in guestCsvDayOrder.ts.)
 *
 * The time is always read in the offering's own time zone, never the phone's:
 * a host checking a Lagos experience from Chicago must see the Lagos time the
 * guest picked. A missing or unknown zone reads as UTC rather than the
 * phone's zone, so two phones never disagree about one booking.
 *
 * Pure and small on purpose: it sits in the eager web chunk (#3493).
 */

const SHAPE: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
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
  const d = new Date(typeof iso === "string" && iso.trim() !== "" ? iso : NaN);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(undefined, { ...SHAPE, timeZone: timeZone || "UTC" }).format(d);
  } catch {
    // An unknown zone name: UTC, never the phone's zone.
    return new Intl.DateTimeFormat(undefined, { ...SHAPE, timeZone: "UTC" }).format(d);
  }
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
 * The door line for one scan or name admit, or null. Only results where the
 * booked start helps the door name it: let in, already in, or early for the
 * time they picked. Void, wrong event, cancelled and not found never do.
 */
export const doorBookedLine = (
  result: string,
  iso: string | null | undefined,
  timeZone: string | null | undefined,
): string | null =>
  result === "success" || result === "duplicate" || result === "not_yet_open"
    ? bookedStartLine(iso, timeZone)
    : null;
