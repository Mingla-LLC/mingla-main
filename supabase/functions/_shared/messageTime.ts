// Issue #4063 — one deterministic time vocabulary for email, push and web.
// Never fall back to the runtime's local timezone: an absent or invalid
// listing timezone is rendered in UTC and reported as unknown to callers.

export interface MessageTime {
  date: string;
  time: string;
  zoneLabel: string;
  dayWord: "today" | "tonight" | "tomorrow" | null;
  tzKnown: boolean;
}

interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
}

const ICU_SPACES = /[\u00A0\u2009\u202F]/g;

export function plainSpaces(text: string): string {
  return text.replace(ICU_SPACES, " ");
}

function resolvedTimezone(timezone: string | null): {
  timezone: string;
  known: boolean;
} {
  if (typeof timezone !== "string" || timezone.trim().length === 0) {
    return { timezone: "UTC", known: false };
  }

  const candidate = timezone.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(
      new Date(0),
    );
    return { timezone: candidate, known: true };
  } catch {
    return { timezone: "UTC", known: false };
  }
}

function numericPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  const value = parts.find((part) => part.type === type)?.value;
  if (value === undefined) throw new Error(`message_time_missing_${type}`);
  return Number(value);
}

function zonedDateParts(instant: Date, timezone: string): ZonedDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);

  return {
    year: numericPart(parts, "year"),
    month: numericPart(parts, "month"),
    day: numericPart(parts, "day"),
    hour: numericPart(parts, "hour"),
  };
}

function calendarDistance(from: ZonedDateParts, to: ZonedDateParts): number {
  const fromUtc = Date.UTC(from.year, from.month - 1, from.day);
  const toUtc = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

function formattedDate(
  instant: Date,
  timezone: string,
  includeYear: boolean,
): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(includeYear ? { year: "numeric" as const } : {}),
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const base = `${read("weekday")} ${read("day")} ${read("month")}`;
  return includeYear ? `${base} ${read("year")}` : base;
}

function formattedTime(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return plainSpaces(
    `${read("hour")}:${read("minute")} ${read("dayPeriod").toUpperCase()}`,
  );
}

export function zonePlaceLabel(timezone: string | null): string {
  const resolved = resolvedTimezone(timezone);
  if (!resolved.known) return "UTC";

  const normalized = resolved.timezone.toUpperCase();
  if (
    normalized === "UTC" || normalized === "ETC/UTC" ||
    normalized === "ETC/GMT"
  ) {
    return "UTC";
  }

  const place = resolved.timezone.split("/").pop()?.replaceAll("_", " ") ?? "";
  return place.length > 0 ? `${place} time` : "UTC";
}

export function formatMessageTime(
  instantIso: string,
  timezone: string | null,
  now: Date = new Date(),
): MessageTime | null {
  const instant = new Date(instantIso);
  if (Number.isNaN(instant.getTime())) return null;

  const reference = Number.isNaN(now.getTime()) ? new Date() : now;
  const resolved = resolvedTimezone(timezone);
  const instantParts = zonedDateParts(instant, resolved.timezone);
  const nowParts = zonedDateParts(reference, resolved.timezone);
  const distance = calendarDistance(nowParts, instantParts);
  const dayWord = distance === 0
    ? (instantParts.hour >= 17 ? "tonight" : "today")
    : distance === 1
    ? "tomorrow"
    : null;

  return {
    date: formattedDate(
      instant,
      resolved.timezone,
      instantParts.year !== nowParts.year,
    ),
    time: formattedTime(instant, resolved.timezone),
    zoneLabel: zonePlaceLabel(timezone),
    dayWord,
    tzKnown: resolved.known,
  };
}

export function formatDateRange(
  startIso: string,
  endIso: string | null,
  timezone: string | null,
  now: Date = new Date(),
): string {
  const start = formatMessageTime(startIso, timezone, now);
  if (start === null) return "";
  if (endIso === null) return start.date;

  const end = formatMessageTime(endIso, timezone, now);
  if (end === null || end.date === start.date) return start.date;
  return `${start.date} – ${end.date}`;
}
