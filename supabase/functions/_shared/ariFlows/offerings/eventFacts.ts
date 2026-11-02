/**
 * Issue #3355 P7 — the event facts Ari asks for, and how it reads the
 * owner's words. Shared by the engine's create_event flow (event.ts) and the
 * pre-engine event planner (agentConversationPlanner.ts), so both parse the
 * same way.
 *
 * I-ARI-NO-INVENTED-FACTS: nothing here fills a gap. A suggested end time is
 * only ever offered on a card (the owner picks it or types another); a title
 * is the owner's own words with wrapping quotes removed.
 */

import {
  isValidIanaTimezone,
  resolveRelativeTime,
} from "../../agentRelativeTime.ts";

/**
 * What an event needs, derived from the Host publish checks
 * (mingla-business/src/utils/draftEventValidation.ts and the publish RPC).
 * `draft` facts are asked before the draft is created; `publish` facts are
 * asked when the owner wants it publish-ready.
 */
export const EVENT_FACTS: ReadonlyArray<{
  key: string;
  needed_for: "draft" | "publish";
  source_gate: string;
}> = Object.freeze([
  { key: "title", needed_for: "draft", source_gate: "validateBasics name" },
  { key: "start", needed_for: "draft", source_gate: "validateWhen date" },
  { key: "timezone", needed_for: "draft", source_gate: "event timezone" },
  { key: "end", needed_for: "draft", source_gate: "validateWhen endsAt" },
  { key: "format", needed_for: "draft", source_gate: "format" },
  { key: "place", needed_for: "draft", source_gate: "validateWhere address+city" },
  { key: "link", needed_for: "draft", source_gate: "validateWhere onlineUrl" },
  { key: "party_types", needed_for: "publish", source_gate: "party_types_required" },
  { key: "description", needed_for: "publish", source_gate: "validateBasics description" },
  { key: "tickets", needed_for: "publish", source_gate: "event_ticket_required" },
  { key: "visibility", needed_for: "publish", source_gate: "requestedVisibility" },
]);

const QUOTE_PAIRS: ReadonlyArray<[string, RegExp]> = [
  ["“", /^“([^”]{2,120})”/],
  ['"', /^"([^"]{2,120})"/],
  ["‘", /^‘(.{2,120}?)’(?=\s|[.,!?;:]|$)/],
  ["'", /^'(.{2,120}?)'(?=\s|[.,!?;:]|$)/],
];

/** Strip quote marks that wrap the whole title, keep apostrophes inside. */
export function cleanTitle(value: string): string {
  let title = value.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 2; i += 1) {
    const wrapped = /^[“"‘'](.+)[”"’']$/.exec(title);
    if (!wrapped) break;
    title = wrapped[1].trim();
  }
  return title.replace(/[,;:]+$/, "").trim().slice(0, 120);
}

const DATE_TAIL =
  /\s+(?:on|at|for|from|this|next)\s+(?=(?:today|tomorrow|tonight|next|this|in\s+\d+|(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\d{1,4}(?:[-/:]|\s*(?:am|pm)\b)))[\s\S]*$/i;

/**
 * The title the owner gave ("called Seth's Party", named ‘Lantern Supper’).
 * D-19: curly quotes are removed, apostrophes and "Vol. 2" are kept.
 */
export function extractEventTitle(
  text: string,
  brandName?: string,
): string | undefined {
  const lead = /\b(?:called|named|titled|title(?:d)?\s+it)\s+/i.exec(text);
  let title: string | undefined;
  if (lead) {
    const rest = text.slice(lead.index + lead[0].length);
    for (const [, pattern] of QUOTE_PAIRS) {
      const quoted = pattern.exec(rest);
      if (quoted) {
        title = quoted[1];
        break;
      }
    }
    if (!title) {
      const end = /[,!?;\n]|\.(?=\s+[A-Za-z]|\s*$)/.exec(rest);
      title = (end ? rest.slice(0, end.index) : rest).replace(DATE_TAIL, "");
    }
  } else {
    const quoted = /[“"]([^”"]{3,120})[”"]|‘([^’]{3,120})’/.exec(text);
    title = quoted?.[1] ?? quoted?.[2];
  }
  if (!title) return undefined;
  let cleaned = cleanTitle(title);
  if (brandName) {
    const suffix = cleaned.toLocaleLowerCase().lastIndexOf(
      ` for ${brandName.toLocaleLowerCase()}`,
    );
    if (suffix > 0) cleaned = cleaned.slice(0, suffix).trim();
  }
  return cleaned.length >= 2 ? cleaned.slice(0, 120) : undefined;
}

/** Parse the owner's start ("next Friday at 7pm", "6 Nov 7pm"). */
export function parseEventStart(
  text: string,
  timezone: string,
  now: Date,
): string | null {
  const tries = [text];
  if (!/\b20\d{2}\b/.test(text)) {
    // "Friday 6 Nov at 7pm": the year goes right after the day and month.
    const dayMonth =
      /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?)\b/i;
    const year = now.getUTCFullYear();
    for (const candidate of [year, year + 1]) {
      if (dayMonth.test(text)) {
        tries.push(text.replace(dayMonth, `$1 ${candidate}`));
      }
    }
  }
  for (const attempt of tries) {
    const result = resolveRelativeTime(attempt, { now, timezone });
    const iso = result.temporal?.resolved_iso;
    if (
      iso && result.temporal?.precision === "instant" &&
      new Date(iso).getTime() > now.getTime()
    ) return iso;
  }
  return null;
}

function localDate(instantIso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instantIso));
}

const CLOCK =
  /\b((?:[01]?\d|2[0-3]):[0-5]\d\s*(?:a\.?m\.?|p\.?m\.?)?|(?:1[0-2]|0?[1-9])(?:[:.][0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)|midnight|noon)\b/i;
const DURATION = /\b(\d{1,2}(?:\.\d)?|an?|one|two|three|four|five|six)\s*(?:hours?|hrs?)\b/i;
const WORD_HOURS: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

/**
 * The end the owner gave, relative to the start: a clock ("10:30pm",
 * "until midnight") or a length ("3 hours"). A clock at or before the start
 * means the next day. Null when the words hold no end.
 */
export function parseEventEnd(
  text: string,
  startIso: string,
  timezone: string,
  now: Date,
): string | null {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime()) || !isValidIanaTimezone(timezone)) {
    return null;
  }
  const clock = CLOCK.exec(text)?.[1];
  if (clock) {
    const words = clock.toLowerCase() === "midnight"
      ? "12am"
      : clock.toLowerCase() === "noon"
      ? "12pm"
      : clock.replace(/(\d)\.(\d)/, "$1:$2");
    const date = localDate(startIso, timezone);
    for (const day of [0, 1]) {
      const [y, m, d] = date.split("-").map(Number);
      const target = new Date(Date.UTC(y, m - 1, d + day)).toISOString()
        .slice(0, 10);
      const result = resolveRelativeTime(`${target} ${words}`, {
        now,
        timezone,
      });
      const iso = result.temporal?.resolved_iso;
      if (iso && new Date(iso).getTime() > start.getTime()) return iso;
    }
    return null;
  }
  const length = DURATION.exec(text)?.[1]?.toLowerCase();
  if (length) {
    const hours = WORD_HOURS[length] ?? Number(length);
    if (Number.isFinite(hours) && hours > 0 && hours <= 24) {
      return new Date(start.getTime() + hours * 3_600_000).toISOString();
    }
  }
  return null;
}

/** A suggestion only, shown on a card: two hours after the start. */
export function suggestedEventEnd(startIso: string): string {
  return new Date(new Date(startIso).getTime() + 2 * 3_600_000).toISOString();
}

/** "Fri 6 Nov, 7:00 pm" in the event's own time zone. */
export function formatEventStart(iso: string, timezone: string): string {
  const instant = new Date(iso);
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(instant);
  return `${day}, ${formatEventClock(iso, timezone)}`;
}

/** "7:00 pm" in the event's own time zone. */
export function formatEventClock(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso)).replace(/\s?([ap])m$/i, " $1m").toLowerCase();
}

/** D-18: "London time", from the zone itself (no hard-coded abbreviations). */
export function zoneWords(timezone: string): string {
  const city = timezone.split("/").pop()?.replace(/_/g, " ") ?? timezone;
  return timezone === "UTC" ? "UTC" : `${city} time`;
}

/** Owner words for a time zone answer ("London", "Europe/London", "Lagos"). */
export function parseTimezoneAnswer(text: string): string | null {
  const trimmed = text.trim();
  const explicit = /\b(?:Africa|America|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?\b/
    .exec(trimmed)?.[0];
  if (explicit && isValidIanaTimezone(explicit)) return explicit;
  const city = trimmed.replace(/\b(?:time|timezone|time zone)\b/gi, "")
    .replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (!city || city.length > 40) return null;
  const slug = city.split(" ").map((word) =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join("_");
  for (const area of ["Europe", "America", "Africa", "Asia", "Australia"]) {
    const candidate = `${area}/${slug}`;
    if (isValidIanaTimezone(candidate)) return candidate;
  }
  return null;
}

/** A place picked on the Ari card (Mapbox address search). */
export interface PickedPlace {
  venue_name: string;
  address: string;
  city: string;
  country_code: string | null;
  lat: number;
  lng: number;
  /** Mapbox `feature_type`: "poi" for a named venue, "address" for a street address. */
  feature_type: string | null;
  /** #3355 P9 — the address search's own id (an experience stop's place_id). */
  place_id?: string | null;
}

/**
 * Seth's decision 4: a place that looks like a home — a Mapbox street
 * address with no venue/POI name — gets the "show the address only to ticket
 * holders?" question.
 */
export function isHomeLike(place: PickedPlace): boolean {
  return place.feature_type === "address";
}

/** The canonical party types (eventTaxonomy.ts parity list). */
export { PARTY_TYPES } from "../../eventTaxonomy.ts";
