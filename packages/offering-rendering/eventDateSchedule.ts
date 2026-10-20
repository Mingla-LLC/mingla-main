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

/** Drop ended dates; keep start order. */
export const filterUpcomingOccurrences = (
  occurrences: readonly EventDateScheduleOccurrence[],
  nowMs: number = Date.now(),
): EventDateScheduleOccurrence[] =>
  occurrences
    .filter((o) => {
      const end = Date.parse(o.endAt);
      return Number.isFinite(end) && end > nowMs;
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

  const first = Date.parse(upcoming[0]!.startAt);
  const last = Date.parse(upcoming[upcoming.length - 1]!.startAt);
  const spanDays = Math.max(1, Math.round((last - first) / MS_DAY) + 1);
  const density = upcoming.length / spanDays;
  if (density >= 0.4) return { kind: "chips", upcoming };

  const months = new Map<string, EventDateScheduleOccurrence[]>();
  for (const o of upcoming) {
    let key: string;
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: o.timezone && o.timezone.length > 0 ? o.timezone : "UTC",
        year: "numeric",
        month: "2-digit",
      }).formatToParts(new Date(o.startAt));
      const y = parts.find((p) => p.type === "year")?.value ?? "0000";
      const m = parts.find((p) => p.type === "month")?.value ?? "01";
      key = `${y}-${m}`;
    } catch {
      const d = new Date(o.startAt);
      key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    }
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
  const sundayFirst = new Set([
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
  return sundayFirst.has(cc) ? 0 : 1;
};
