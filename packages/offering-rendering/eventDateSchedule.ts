/**
 * issue #3281 many-dates — pure schedule helpers for the shared EventDatePicker.
 * No React Native imports beyond types used by callers; layout math is pure.
 */

export type EventDateScheduleStatus =
  | "loading"
  | "ready"
  | "error"
  | "offline"
  | "stale";

export type EventDateScheduleOccurrence = {
  id: string;
  startAt: string;
  endAt: string;
  timezone?: string | null;
  overrideTitle?: string | null;
  overrideLocation?: string | null;
  soldOut?: boolean | null;
  placesLeft?: number | null;
};

export type EventDateLayoutKind = "chips" | "tiles" | "pass" | "empty" | "single";

export type EventDateLayout = {
  kind: EventDateLayoutKind;
  /** Upcoming (endAt > now) occurrences in start order. */
  upcoming: EventDateScheduleOccurrence[];
  /** When kind === "tiles", grouped by YYYY-MM in event zone (UTC fallback). */
  months?: Array<{ key: string; dates: EventDateScheduleOccurrence[] }>;
};

const MS_DAY = 24 * 60 * 60 * 1000;

const SUNDAY_FIRST_COUNTRIES = new Set([
  "US",
  "CA",
  "JP",
  "KR",
  "TW",
  "PH",
  "IL",
  "DO",
  "GT",
  "HN",
  "MX",
  "NI",
  "PA",
  "PR",
  "SV",
]);

/** YYYY-MM-DD in the occurrence zone (UTC fallback); null if unparsable. */
export const occurrenceLocalDay = (
  startAt: string,
  timezone?: string | null,
): string | null => {
  const ms = Date.parse(startAt);
  if (!Number.isFinite(ms)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone && timezone.length > 0 ? timezone : "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(ms));
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (!y || !m || !d) return null;
    return `${y}-${m}-${d}`;
  } catch {
    return null;
  }
};

/** Drop ended / unparsable dates; keep start order. */
export const filterUpcomingOccurrences = (
  occurrences: readonly EventDateScheduleOccurrence[],
  nowMs: number = Date.now(),
): EventDateScheduleOccurrence[] =>
  occurrences
    .filter((o) => {
      const end = Date.parse(o.endAt);
      const start = Date.parse(o.startAt);
      return Number.isFinite(end) && Number.isFinite(start) && end > nowMs;
    })
    .slice()
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));

/**
 * Layout rule (approved many-dates spec):
 * - 0 upcoming → empty
 * - 1 → single
 * - allDaysPass → pass
 * - density upcoming/spanDays >= 0.4 → chips (and <=6 prefers chips)
 * - else tiles by month
 */
export const chooseEventDateLayout = (
  occurrences: readonly EventDateScheduleOccurrence[],
  opts: { allDaysPass?: boolean; nowMs?: number } = {},
): EventDateLayout => {
  const nowMs = opts.nowMs ?? Date.now();
  const upcoming = filterUpcomingOccurrences(occurrences, nowMs);
  if (upcoming.length === 0) return { kind: "empty", upcoming };
  if (opts.allDaysPass === true) return { kind: "pass", upcoming };
  if (upcoming.length === 1) return { kind: "single", upcoming };
  if (upcoming.length <= 6) return { kind: "chips", upcoming };

  const firstDay =
    occurrenceLocalDay(upcoming[0]!.startAt, upcoming[0]!.timezone) ??
    upcoming[0]!.startAt.slice(0, 10);
  const lastDay =
    occurrenceLocalDay(
      upcoming[upcoming.length - 1]!.startAt,
      upcoming[upcoming.length - 1]!.timezone,
    ) ?? upcoming[upcoming.length - 1]!.startAt.slice(0, 10);
  const firstMs = Date.parse(`${firstDay}T00:00:00.000Z`);
  const lastMs = Date.parse(`${lastDay}T00:00:00.000Z`);
  const spanDays = Number.isFinite(firstMs) && Number.isFinite(lastMs)
    ? Math.max(1, Math.floor((lastMs - firstMs) / MS_DAY) + 1)
    : upcoming.length;
  const density = upcoming.length / spanDays;
  if (density >= 0.4) return { kind: "chips", upcoming };

  const months = new Map<string, EventDateScheduleOccurrence[]>();
  for (const o of upcoming) {
    const day = occurrenceLocalDay(o.startAt, o.timezone);
    const key = day !== null ? day.slice(0, 7) : "0000-01";
    const list = months.get(key) ?? [];
    list.push(o);
    months.set(key, list);
  }
  return {
    kind: "tiles",
    upcoming,
    months: [...months.entries()].map(([key, dates]) => ({ key, dates })),
  };
};

/** "Only N left" at 10 or fewer; null when unknown / unlimited / hidden. */
export const placesLeftChip = (
  placesLeft: number | null | undefined,
): string | null => {
  if (typeof placesLeft !== "number" || !Number.isFinite(placesLeft)) return null;
  if (placesLeft <= 0) return "Sold out";
  if (placesLeft <= 10) return `Only ${placesLeft} left`;
  return null;
};

/**
 * Week starts: Sunday for US/CA/JP/etc., Monday otherwise (Intl getWeekInfo when
 * available; fallback table for Node without the proposal).
 */
export const weekStartForCountry = (countryCode: string | null | undefined): 0 | 1 => {
  const cc = (countryCode ?? "").trim().toUpperCase();
  if (cc.length !== 2) return 1;
  try {
    const locale = `en-${cc}`;
    const info = (
      new Intl.Locale(locale) as Intl.Locale & {
        getWeekInfo?: () => { firstDay: number };
      }
    ).getWeekInfo?.();
    if (info && (info.firstDay === 7 || info.firstDay === 0)) return 0;
    if (info && info.firstDay === 1) return 1;
  } catch {
    /* fall through */
  }
  return SUNDAY_FIRST_COUNTRIES.has(cc) ? 0 : 1;
};
