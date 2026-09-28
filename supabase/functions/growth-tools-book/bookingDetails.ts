// ISSUE-3601 — pure builders for the booking calendar entry + notification list.
//
// ZERO IMPORTS, BY CONTRACT. No remote URL, no `../_shared/**`, no `Deno.env`.
// That is what keeps the regression suites hermetic (`deno test --allow-read`
// only — no network, no env priming) and is the whole reason these builders are
// extracted out of `index.ts` instead of stubbing `fetch`.
//
// Why the four friendly labels below are DUPLICATED rather than shared with
// `supabase/functions/growth-tools-gate/index.ts:1086-1092` (#3601): that mapping
// keys on `tool` ("venues" | "events" | "trips" | "experiences"), this one keys on
// `source` (venue_grader / event_predictor / trip_quoter / pricing_audit) — no key
// overlaps — it is a non-exported inline ternary, and its fallback branch is
// literally the product-name default this issue exists to delete. Do not
// "de-duplicate" these into a shared module: that would re-couple two different
// key spaces and reintroduce the wrong default for unknown input.

export const INFO_NOTIFY_EMAIL = "info@usemingla.com";
export const SCHEDULER_BASE_LINE = "Booked from the Mingla Scheduler.";
export const SHARED_LINK_ORIGIN_LABEL = "a shared scheduler link";

// C0 controls, DEL + C1 controls, and U+2028/U+2029. The last two are included
// because JavaScript treats them as line terminators, so a plain `\n`-only filter
// lets them through and a forged description line still lands.
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;

/**
 * Collapse any client-supplied string to a single safe line.
 *
 * Non-strings return "". Control characters are REPLACED with a space, never
 * deleted — deleting would join words ("Blue\nNote" -> "BlueNote") and hide the
 * injection instead of neutralising it.
 */
export function sanitizeLine(raw: unknown, maxLen: number): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen)
    .trim();
}

const ORIGIN_LABELS: Record<string, string> = {
  venue_grader: "Venue Website Grader",
  event_predictor: "Event Turnout Predictor",
  trip_quoter: "Quote Any Trip",
  pricing_audit: "Undercharging Audit",
};

/**
 * Friendly origin label for a `source` tag. Absent, empty and `direct` (any
 * casing) all mean "the link was shared bare", which is a real and common path —
 * `usemingla.com/schedule` is designed to be pasted into a cold email or a DM.
 *
 * An unknown tag is returned VERBATIM with its original casing, so any standalone
 * link can be tagged (`?source=cold_email`) and read back on the invite. It must
 * NEVER fall back to a product name — that fabricated sentence is the bug (#3601).
 *
 * The `typeof` guard is defence in depth: the declared parameter is a string, and
 * every in-repo caller passes `sanitizeLine(...)` output, but a non-string must
 * not throw on a public unauthenticated function.
 *
 * DO NOT "simplify" the `Object.hasOwn` guard back to `ORIGIN_LABELS[key] ?? key`.
 * `ORIGIN_LABELS` is a plain object literal, so a bracket lookup walks
 * `Object.prototype`, and `??` only fires on nullish — an inherited member is not
 * nullish, so it is returned as the label. `toLowerCase()` shields the mixed-case
 * inherited names by accident, which leaves the all-lowercase ones: BOTH
 * `constructor` (`function Object() { [native code] }`) AND `__proto__`
 * (`[object Object]`) leaked onto the prospect's own calendar invite and into the
 * notification Seth and info@ read, from a URL anyone can type
 * (`usemingla.com/schedule?source=__proto__`). It also broke the declared `string`
 * return type. The own-property test is the only structural close — a guard
 * against the specific names would miss the next one.
 */
export function originLabel(source: string): string {
  const s = typeof source === "string" ? source.trim() : "";
  if (s === "" || s.toLowerCase() === "direct") return SHARED_LINK_ORIGIN_LABEL;
  const key = s.toLowerCase();
  return Object.hasOwn(ORIGIN_LABELS, key) ? ORIGIN_LABELS[key] : s;
}

/**
 * The Google Calendar event description. Line 1 and line 2 are UNCONDITIONAL: no
 * request parameter can vary the base sentence, and the origin line is always
 * present so a blank can never be ambiguous between "came in cold" and "we lost
 * the parameter". Optional Venue / Their report lines drop out when empty, so the
 * result never contains a blank line.
 *
 * Sanitises its own inputs (defence in depth — safe no matter who calls it).
 * `email` is passed through UNSANITISED BY DESIGN: `EMAIL_RE` at `index.ts:56`
 * (/^[^\s@]+@[^\s@]+\.[^\s@]+$/) already rejects every whitespace character,
 * including \n, \r, U+2028 and U+2029, so a validated email cannot carry a line
 * break. This is not a missed field.
 */
export function buildEventDescription(input: {
  name: string;
  email: string;
  venue: string;
  reportUrl: string;
  source: string;
}): string {
  const name = sanitizeLine(input.name, 120);
  const venue = sanitizeLine(input.venue, 120);
  const reportUrl = sanitizeLine(input.reportUrl, 500);
  const source = sanitizeLine(input.source, 40);
  return [
    SCHEDULER_BASE_LINE,
    `Came from: ${originLabel(source)}`,
    venue ? `Venue: ${venue}` : "",
    `Booked by: ${name} (${input.email})`,
    reportUrl ? `Their report: ${reportUrl}` : "",
  ].filter(Boolean).join("\n");
}

/**
 * Calendar guest list: the booker plus info@, so a booked call exists somewhere
 * other than one person's calendar. Exactly one entry when the booker IS info@ —
 * a duplicate attendee would be a second copy of the same guest on the invite.
 */
export function buildAttendees(
  bookerEmail: string,
  bookerName: string,
): Array<{ email: string; displayName?: string }> {
  const booker = { email: bookerEmail, displayName: bookerName };
  const normalised = typeof bookerEmail === "string"
    ? bookerEmail.trim().toLowerCase()
    : "";
  if (normalised === INFO_NOTIFY_EMAIL) return [booker];
  return [booker, { email: INFO_NOTIFY_EMAIL }];
}

/**
 * Recipients of the "New Mingla call" notification: `notifyTo` first, then info@,
 * trimmed, empties dropped, de-duplicated case-insensitively — so info@ can never
 * be emailed twice if BOOKING_NOTIFY_TO is ever pointed at it.
 *
 * `notifyTo` is a PARAMETER, not a module-scope env read: `NOTIFY_TO` at
 * `index.ts:54` is evaluated at import time, so a function reading it directly
 * could not be tested without priming the environment before import.
 */
export function buildNotifyRecipients(notifyTo: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [notifyTo, INFO_NOTIFY_EMAIL]) {
    const trimmed = typeof candidate === "string" ? candidate.trim() : "";
    if (trimmed === "") continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}
