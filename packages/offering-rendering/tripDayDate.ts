// issue #4420 audit — dependency-free so the deno suites and the trip body
// share one formatter.

/**
 * issue #4420 audit — a trip day's calendar date ("2027-01-27") as guests read
 * it ("Wed, Jan 27"). The day-by-day list printed the raw ISO string. Parsed by
 * hand (Hermes-safe) and formatted in UTC, so the stored calendar date never
 * shifts with the device's zone. Anything that is not a plain Y-M-D is
 * returned unchanged.
 */
export function formatTripDayDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (match === null) return date;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(d.getTime())) return date;
  try {
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return date;
  }
}
