// Issue #1985 — deterministic, server-clock relative date/time resolution.
// Storage is always ISO + IANA timezone. Locale affects display only.

export type TemporalPrecision =
  | "instant"
  | "date"
  | "weekday"
  | "window"
  | "daypart";

export interface TemporalSlotValue {
  original_text: string;
  precision: TemporalPrecision;
  local_date: string | null;
  local_time: string | null;
  timezone: string | null;
  resolved_iso: string | null;
  source: "user" | "derived" | "choice";
}

export interface DateTimeChoice {
  id: string;
  label: string;
  temporal: TemporalSlotValue;
}

export interface RelativeTimeContext {
  now: Date;
  timezone: string | null;
  locale?: string;
}

export interface RelativeTimeResult {
  temporal: TemporalSlotValue | null;
  choices: DateTimeChoice[];
  needsTimezone: boolean;
  invalidReason?: "past" | "nonexistent_local_time" | "no_future_window";
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export function isValidIanaTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function extractExplicitTimezone(text: string): string | null {
  const zone = text.match(
    /\b(?:Africa|America|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?\b/,
  )?.[0];
  if (zone && isValidIanaTimezone(zone)) return zone;
  if (/\b(?:UTC|GMT)\b/i.test(text)) return "UTC";
  return null;
}

export function chooseEffectiveTimezone(args: {
  requestText: string;
  venueTimezone?: string | null;
  preferredTimezone?: string | null;
  clientTimezone?: string | null;
}): string | null {
  const explicit = extractExplicitTimezone(args.requestText);
  if (explicit) return explicit;
  for (
    const candidate of [
      args.venueTimezone,
      args.preferredTimezone,
      args.clientTimezone,
    ]
  ) {
    if (isValidIanaTimezone(candidate)) return candidate;
  }
  return null;
}

function partsInZone(instant: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const raw = parts.find((part) => part.type === type)?.value;
    if (!raw) throw new Error(`Missing ${type} while formatting ${timezone}`);
    return Number(raw);
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function localDate(parts: LocalParts): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function parseLocalDate(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) return null;
  return { year, month, day };
}

function parseTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function sameLocal(parts: LocalParts, target: LocalParts): boolean {
  return parts.year === target.year && parts.month === target.month &&
    parts.day === target.day &&
    parts.hour === target.hour && parts.minute === target.minute;
}

/** Returns one instant normally, zero for a DST gap, and two for a repeated hour. */
export function localDateTimeToInstants(
  localDateValue: string,
  localTimeValue: string,
  timezone: string,
): Date[] {
  if (!isValidIanaTimezone(timezone)) return [];
  const date = parseLocalDate(localDateValue);
  const time = parseTime(localTimeValue);
  if (!date || !time) return [];
  const target: LocalParts = { ...date, ...time, second: 0 };
  const center = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    time.hour,
    time.minute,
  );
  const matches: Date[] = [];
  // Every IANA offset is within ±14 hours. Scanning in 15-minute steps also
  // covers the uncommon 30/45-minute offsets and both sides of a DST fold.
  for (
    let deltaMinutes = -14 * 60;
    deltaMinutes <= 14 * 60;
    deltaMinutes += 15
  ) {
    const candidate = new Date(center + deltaMinutes * 60_000);
    if (sameLocal(partsInZone(candidate, timezone), target)) {
      matches.push(
        candidate,
      );
    }
  }
  return matches.sort((a, b) => a.getTime() - b.getTime());
}

export function utcOffsetAt(instant: Date, timezone: string): string {
  const parts = partsInZone(instant, timezone);
  const representedUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const minutes = Math.round((representedUtc - instant.getTime()) / 60_000);
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

function addLocalDays(dateValue: string, days: number): string {
  const parsed = parseLocalDate(dateValue);
  if (!parsed) throw new Error("Invalid local date");
  const shifted = new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day + days),
  );
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${
    pad(shifted.getUTCDate())
  }`;
}

function weekdayOf(dateValue: string): number {
  const parsed = parseLocalDate(dateValue);
  if (!parsed) throw new Error("Invalid local date");
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day))
    .getUTCDay();
}

function nextWeekday(
  dateValue: string,
  target: number,
  strict: boolean,
): string {
  const current = weekdayOf(dateValue);
  let delta = (target - current + 7) % 7;
  if (strict && delta === 0) delta = 7;
  return addLocalDays(dateValue, delta);
}

function parseUserTime(text: string): string | null {
  const twelve = text.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i);
  if (twelve) {
    let hour = Number(twelve[1]) % 12;
    if (twelve[3].toLowerCase() === "pm") hour += 12;
    return `${pad(hour)}:${twelve[2] ?? "00"}`;
  }
  const twentyFour = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return twentyFour ? `${pad(Number(twentyFour[1]))}:${twentyFour[2]}` : null;
}

function displayChoice(
  instant: Date,
  timezone: string,
  locale = "en-US",
  repeated = false,
): string {
  const base = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
  return repeated ? `${base} (${utcOffsetAt(instant, timezone)})` : base;
}

function instantTemporal(
  originalText: string,
  localDateValue: string,
  localTimeValue: string,
  timezone: string,
  instant: Date,
  source: TemporalSlotValue["source"],
): TemporalSlotValue {
  return {
    original_text: originalText.slice(0, 240),
    precision: "instant",
    local_date: localDateValue,
    local_time: localTimeValue,
    timezone,
    resolved_iso: instant.toISOString(),
    source,
  };
}

function exactChoices(
  originalText: string,
  pairs: Array<{ date: string; time: string }>,
  context: RelativeTimeContext,
): DateTimeChoice[] {
  if (!context.timezone) return [];
  const output: DateTimeChoice[] = [];
  for (const pair of pairs) {
    const candidates = localDateTimeToInstants(
      pair.date,
      pair.time,
      context.timezone,
    );
    for (const instant of candidates) {
      if (instant.getTime() <= context.now.getTime()) continue;
      output.push({
        id: `dt_${instant.toISOString().replace(/[^0-9]/g, "").slice(0, 14)}_${
          utcOffsetAt(instant, context.timezone).replace(/[^0-9+-]/g, "")
        }`,
        label: displayChoice(
          instant,
          context.timezone,
          context.locale,
          candidates.length > 1,
        ),
        temporal: instantTemporal(
          originalText,
          pair.date,
          pair.time,
          context.timezone,
          instant,
          "choice",
        ),
      });
    }
  }
  return output.slice(0, 3);
}

function endOfMonthChoices(
  originalText: string,
  context: RelativeTimeContext,
  today: string,
): DateTimeChoice[] {
  const parsed = parseLocalDate(today);
  if (!parsed || !context.timezone) return [];
  const monthEnd = new Date(Date.UTC(parsed.year, parsed.month, 0));
  const finalStart = new Date(
    Date.UTC(parsed.year, parsed.month - 1, monthEnd.getUTCDate() - 6),
  );
  const candidateDates: string[] = [];
  for (let index = 0; index < 7; index++) {
    const date = new Date(finalStart.getTime() + index * 86_400_000);
    const value = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${
      pad(date.getUTCDate())
    }`;
    if (value >= today) candidateDates.push(value);
  }
  const spread = candidateDates.length <= 3 ? candidateDates : [
    candidateDates[0],
    candidateDates[Math.floor((candidateDates.length - 1) / 2)],
    candidateDates[candidateDates.length - 1],
  ];
  return exactChoices(
    originalText,
    spread.map((date, index) => ({
      date,
      time: ["19:00", "20:00", "18:00"][index] ?? "19:00",
    })),
    context,
  );
}

function resolveExact(
  originalText: string,
  date: string,
  time: string,
  context: RelativeTimeContext,
): RelativeTimeResult {
  if (!context.timezone) {
    return { temporal: null, choices: [], needsTimezone: true };
  }
  const candidates = localDateTimeToInstants(date, time, context.timezone);
  if (candidates.length === 0) {
    const nearby = exactChoices(originalText, [
      { date, time: addMinutesToTime(time, 30) },
      { date, time: addMinutesToTime(time, 60) },
    ], context);
    return {
      temporal: null,
      choices: nearby,
      needsTimezone: false,
      invalidReason: "nonexistent_local_time",
    };
  }
  const future = candidates.filter((instant) =>
    instant.getTime() > context.now.getTime()
  );
  if (future.length === 0) {
    return {
      temporal: null,
      choices: [],
      needsTimezone: false,
      invalidReason: "past",
    };
  }
  if (future.length > 1) {
    return {
      temporal: null,
      choices: future.slice(0, 3).map((instant) => ({
        id: `dt_${instant.toISOString().replace(/[^0-9]/g, "").slice(0, 14)}_${
          utcOffsetAt(instant, context.timezone as string).replace(
            /[^0-9+-]/g,
            "",
          )
        }`,
        label: displayChoice(
          instant,
          context.timezone as string,
          context.locale,
          true,
        ),
        temporal: instantTemporal(
          originalText,
          date,
          time,
          context.timezone as string,
          instant,
          "choice",
        ),
      })),
      needsTimezone: false,
    };
  }
  return {
    temporal: instantTemporal(
      originalText,
      date,
      time,
      context.timezone,
      future[0],
      "user",
    ),
    choices: [],
    needsTimezone: false,
  };
}

function addMinutesToTime(time: string, minutes: number): string {
  const parsed = parseTime(time);
  if (!parsed) return time;
  const total = (parsed.hour * 60 + parsed.minute + minutes) % (24 * 60);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function resolveRelativeTime(
  text: string,
  context: RelativeTimeContext,
): RelativeTimeResult {
  const original = text.trim().slice(0, 240);
  if (!context.timezone) {
    const containsRelative =
      /\b(today|tomorrow|in \d+ (?:day|week)s?|next |this |weekend|end of (?:the )?month|morning|afternoon|evening|later)\b/i
        .test(text);
    return { temporal: null, choices: [], needsTimezone: containsRelative };
  }
  const nowLocal = partsInZone(context.now, context.timezone);
  const today = localDate(nowLocal);
  const userTime = parseUserTime(text);

  if (/\bend of (?:the )?month\b/i.test(text)) {
    const choices = endOfMonthChoices(original, context, today);
    return {
      temporal: {
        original_text: original,
        precision: "window",
        local_date: null,
        local_time: null,
        timezone: context.timezone,
        resolved_iso: null,
        source: "user",
      },
      choices,
      needsTimezone: false,
      ...(choices.length === 0
        ? { invalidReason: "no_future_window" as const }
        : {}),
    };
  }

  let date: string | null = null;
  let precision: TemporalPrecision = "date";
  if (/\btomorrow\b/i.test(text)) date = addLocalDays(today, 1);
  else if (/\btoday\b/i.test(text)) date = today;
  else {
    const delta = text.match(/\bin\s+(\d{1,3})\s+(day|week)s?\b/i);
    if (delta) {
      date = addLocalDays(
        today,
        Number(delta[1]) * (delta[2].toLowerCase() === "week" ? 7 : 1),
      );
    }
  }
  const weekday = text.match(
    /\b(next|this)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
  );
  if (weekday) {
    precision = "weekday";
    const target = WEEKDAY_INDEX[weekday[2].toLowerCase()];
    date = nextWeekday(today, target, weekday[1].toLowerCase() === "next");
    if (
      weekday[1].toLowerCase() === "this" && date === today &&
      nowLocal.hour >= 23
    ) {
      return {
        temporal: null,
        choices: exactChoices(original, [{
          date: addLocalDays(date, 7),
          time: userTime ?? "19:00",
        }], context),
        needsTimezone: false,
        invalidReason: "past",
      };
    }
  }

  if (!date && /\bthis weekend\b/i.test(text)) {
    const saturday = nextWeekday(today, 6, false);
    const choices = exactChoices(original, [
      { date: saturday, time: "19:00" },
      { date: saturday, time: "20:00" },
      { date: addLocalDays(saturday, 1), time: "18:00" },
    ], context);
    return {
      temporal: {
        original_text: original,
        precision: "window",
        local_date: null,
        local_time: null,
        timezone: context.timezone,
        resolved_iso: null,
        source: "user",
      },
      choices,
      needsTimezone: false,
      ...(choices.length === 0
        ? { invalidReason: "no_future_window" as const }
        : {}),
    };
  }

  if (!date) return { temporal: null, choices: [], needsTimezone: false };
  if (userTime) return resolveExact(original, date, userTime, context);

  const daypart = /\bmorning\b/i.test(text)
    ? ["09:00", "10:30"]
    : /\bafternoon\b/i.test(text)
    ? ["13:00", "15:00"]
    : /\bevening|later\b/i.test(text)
    ? ["18:00", "19:30", "21:00"]
    : ["18:00", "19:30", "21:00"];
  const choices = exactChoices(
    original,
    daypart.map((time) => ({ date, time })),
    context,
  );
  return {
    temporal: {
      original_text: original,
      precision: /\bmorning|afternoon|evening|later\b/i.test(text)
        ? "daypart"
        : precision,
      local_date: date,
      local_time: null,
      timezone: context.timezone,
      resolved_iso: null,
      source: "user",
    },
    choices,
    needsTimezone: false,
    ...(choices.length === 0
      ? { invalidReason: "no_future_window" as const }
      : {}),
  };
}

export function plannerClockContext(now: Date, timezone: string | null): {
  now_iso: string;
  local_date: string | null;
  timezone: string | null;
  utc_offset_at_target: string | null;
} {
  return {
    now_iso: now.toISOString(),
    local_date: timezone ? localDate(partsInZone(now, timezone)) : null,
    timezone,
    utc_offset_at_target: timezone ? utcOffsetAt(now, timezone) : null,
  };
}
