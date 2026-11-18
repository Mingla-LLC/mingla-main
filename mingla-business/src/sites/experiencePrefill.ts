/**
 * #4453 milestone 5 (spec v2 §5.1, §10.3) — the pre-fill a brand's website
 * sends to its Mingla experience page (`?date=&slot=&guests=`). The page
 * re-validates every value and silently ignores a bad one; the venue twin is
 * bookingPrefill.ts.
 */
type Param = string | string[] | undefined;

// The three validators below are byte-for-byte twins of bookingPrefill.ts
// (prefillDate, prefillTime, prefillCount). They are copied, not imported:
// the experience and venue pages are separate web chunks, and a module both
// import moves into the eager __common chunk (#3493 boot payload gate). A
// test pins the twins to the same answers.
const first = (value: Param): string | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw.length > 0 && raw.length <= 64 ? raw : null;
};

function prefillDate(value: Param): string | null {
  const raw = first(value);
  if (!raw || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(raw)) return null;
  const [y, m, d] = raw.split("-").map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d ? raw : null;
}

function prefillTime(value: Param): string | null {
  const raw = first(value);
  return raw && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : null;
}

function prefillCount(value: Param, max = 20): number | null {
  const raw = first(value);
  if (!raw || !/^\d{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= max ? n : null;
}

/** The validators, exported only for the twin-parity test. */
export const EXPERIENCE_PREFILL_VALIDATORS = { prefillDate, prefillTime, prefillCount } as const;

export type ExperiencePrefill = { date: string | null; slot: string | null; guests: number | null };

/** A Mingla website's experience pre-fill (`?date=&slot=&guests=`), re-validated. */
export function experiencePrefill(params: Record<string, Param>): ExperiencePrefill {
  return { date: prefillDate(params.date), slot: prefillTime(params.slot), guests: prefillCount(params.guests) };
}

/** The local `YYYY-MM-DD` and `HH:MM` of an instant in a zone (an invalid zone reads as UTC). */
export function localParts(iso: string, timeZone: string): { date: string; time: string } | null {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  } catch {
    return localParts(iso, "UTC");
  }
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/**
 * The experience date the site's link names: the occurrence on that local day
 * at that local time (in the date's own zone), else the first on that day when
 * no time was sent. Null when none matches (the guest picks, as before).
 */
export function matchExperienceDate<D extends { id: string; startAt: string; timezone?: string | null }>(
  dates: ReadonlyArray<D>, prefill: ExperiencePrefill, fallbackZone: string,
): D | null {
  if (!prefill.date) return null;
  const sameDay = dates.filter((date) => localParts(date.startAt, date.timezone || fallbackZone)?.date === prefill.date);
  if (!prefill.slot) return sameDay[0] ?? null;
  return sameDay.find((date) => localParts(date.startAt, date.timezone || fallbackZone)?.time === prefill.slot) ?? null;
}
