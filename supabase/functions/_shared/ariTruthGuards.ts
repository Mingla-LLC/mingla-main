/**
 * Issue #3355 Wave A (A6) — server guards that run before Ari's reply leaves
 * agent-chat. Both are deterministic: no model call, no write.
 *
 * Production 2026-11-10 (Lagos host):
 *   - 10:08:53 the reply said "I proposed creating the discount code
 *     FFBTSCOM10" in a turn with no pending action and no receipt for that
 *     code. Nothing had been proposed.
 *   - The host asked for FAVY10 "to run from now until 19th of December 2026";
 *     `create_discount` accepts `ends_at`, but all three codes were saved with
 *     `ends_at = NULL`. The stated end date was dropped silently.
 *
 * MINGLA-INVARIANT: I-ARI-CLAIM-MATCHES-RECEIPT | issue #3355 | Reply text that claims a past write (proposed / created / saved / sent / published / updated / deleted) must be backed by a pending action or a receipt for what it names; otherwise the server rewrites the reply to the true state before it is stored or shown (enforced by supabase/functions/_shared/__tests__/issue_3355_wave_a_truth_guards.implementor.test.ts).
 * MINGLA-INVARIANT: I-ARI-STATED-SLOTS-PRESERVED | issue #3355 | Codes, percentages, amounts, end dates and use limits the host stated (last 6 owner messages since the previous proposal of the same tool) are compared with the proposal args for every tool whose schema has that field; a stated end date the args lack is bound exactly (end of that day in the brand's time zone), and any other stated value that is missing or different makes Ari ask instead of proposing (same test file).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  isValidIanaTimezone,
  localDateTimeToInstants,
} from "./agentRelativeTime.ts";
import { normaliseAriDiscountCode } from "./ariDiscountArgs.ts";
import { marketDefaultTimezone } from "./payoutCountries.ts";

// ── I-ARI-CLAIM-MATCHES-RECEIPT ─────────────────────────────────────────────

const PAST_WRITE =
  /\b(?:i|we|ari)(?:['’]ve|\s+have|\s+just|\s+already|\s+also)*\s+(?:proposed|created|saved|sent|published|updated|deleted|removed|cancelled|canceled|made|added|set\s+up|scheduled|issued|refunded|posted)\b/i;
const NEGATION_AFTER_SUBJECT =
  /\b(?:i|we|ari)\s+(?:have\s+not|haven[’']?t|did\s+not|didn[’']?t|never|couldn[’']?t|could\s+not|can[’']?t|cannot|won[’']?t)\b/i;
const NAMED_THING = /"([^"]{2,60})"|“([^”]{2,60})”|\b([A-Z][A-Z0-9]{3,15})\b/g;
const STOPWORDS = new Set([
  "ARI",
  "NGN",
  "GBP",
  "USD",
  "EUR",
  "UTC",
  "GMT",
  "FAQ",
  "HTTP",
]);

/** Sentences of a reply (keeps their own punctuation). */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z“"'])|\n+/).filter((part) =>
    part.trim().length > 0
  );
}

/** True when a sentence says Ari already did a write. */
export function claimsPastWrite(sentence: string): boolean {
  return PAST_WRITE.test(sentence) && !NEGATION_AFTER_SUBJECT.test(sentence);
}

/** The specific things a claim names (codes, quoted names). */
export function namedThings(sentence: string): string[] {
  const out: string[] = [];
  for (const match of sentence.matchAll(NAMED_THING)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!value || STOPWORDS.has(value)) continue;
    // An all-letter capital word must look like a code (no plain shouting).
    if (match[3] && !/\d/.test(value) && value.length < 5) continue;
    out.push(value);
  }
  return out;
}

export const TRUE_STATE_NOTHING_SAVED =
  "I haven't made that change yet, so nothing has been saved or sent.";

/**
 * Rewrite any sentence that claims a write the evidence does not back.
 * `evidence` is what this conversation can prove: this turn's pending
 * action, and the recent proposals and receipts (their tool name and args).
 */
export function guardWriteClaims(args: {
  text: string;
  pendingThisTurn: boolean;
  evidence: unknown[];
}): { text: string; rewritten: boolean; unsupported: string[] } {
  if (args.pendingThisTurn) {
    return { text: args.text, rewritten: false, unsupported: [] };
  }
  const blob = args.evidence.map((item) => JSON.stringify(item ?? null))
    .join("\n").toLowerCase();
  const unsupported: string[] = [];
  const kept: string[] = [];
  for (const sentence of sentences(args.text)) {
    if (!claimsPastWrite(sentence)) {
      kept.push(sentence);
      continue;
    }
    const named = namedThings(sentence);
    const backed = named.length > 0
      ? named.every((thing) => blob.includes(thing.toLowerCase()))
      : args.evidence.length > 0;
    if (backed) kept.push(sentence);
    else unsupported.push(sentence.trim());
  }
  if (unsupported.length === 0) {
    return { text: args.text, rewritten: false, unsupported };
  }
  const rest = kept.join(" ").trim();
  return {
    text: rest
      ? `${TRUE_STATE_NOTHING_SAVED} ${rest}`
      : `${TRUE_STATE_NOTHING_SAVED} Tell me what you'd like and I'll prepare it for you to approve.`,
    rewritten: true,
    unsupported,
  };
}

/** What a conversation's recent rows can prove (proposals and receipts). */
export function claimEvidenceFromHistory(
  rows: ReadonlyArray<{
    role?: unknown;
    tool_calls?: unknown;
    tool_results?: unknown;
  }>,
): unknown[] {
  const evidence: unknown[] = [];
  for (const row of rows) {
    if (
      row.role === "assistant" && row.tool_calls &&
      typeof row.tool_calls === "object"
    ) {
      const calls = row.tool_calls as { pending_action_id?: unknown };
      if (typeof calls.pending_action_id === "string") {
        evidence.push(row.tool_calls);
      }
    }
    if (
      row.role === "tool" && row.tool_results &&
      typeof row.tool_results === "object"
    ) {
      const result = row.tool_results as { outcome?: unknown };
      if (result.outcome === "executed") evidence.push(row.tool_results);
    }
  }
  return evidence;
}

// ── I-ARI-STATED-SLOTS-PRESERVED ────────────────────────────────────────────

export interface StatedSlots {
  code?: string;
  value_bps?: number;
  value_minor_major?: number;
  /** The stated end, as the local calendar day. */
  ends_on?: { year: number; month: number; day: number; words: string };
  max_total_uses?: number;
  max_uses_per_buyer?: number;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};
const MONTH =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const END_LEAD =
  "(?:until|till|til|up\\s+to|through|thru|ends?(?:\\s+on)?|ending(?:\\s+on)?|expires?(?:\\s+on)?|expiring(?:\\s+on)?|valid\\s+(?:until|till|through)|runs?\\s+(?:until|till|through)|to)";
const END_DAY_FIRST = new RegExp(
  `\\b${END_LEAD}\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH}\\.?(?:,?\\s+(\\d{4}))?`,
  "i",
);
const END_MONTH_FIRST = new RegExp(
  `\\b${END_LEAD}\\s+${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`,
  "i",
);
const END_NUMERIC = new RegExp(
  `\\b${END_LEAD}\\s+(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4})\\b`,
  "i",
);
const PERCENT = /\b(\d{1,2}(?:\.\d{1,2})?|100)\s?(?:%|percent\b|per\s+cent\b)/i;
const QUOTED_CODE = /["“'‘]([A-Za-z0-9 -]{4,20})["”'’]/;
const CODE_WORD =
  /\b(?:code|promo(?:\s+code)?|coupon|voucher)\s+(?:called\s+|named\s+|of\s+|is\s+|as\s+)?([A-Z0-9][A-Z0-9-]{3,15})\b/;
const CODE_ALONE =
  /\b([A-Z]{2,}[0-9]{1,}[A-Z0-9]*|[A-Z0-9]*[0-9]+[A-Z]{2,}[A-Z0-9]*)\b/;
/** An all-capitals word in a mixed-case message reads as a code name. */
const CODE_CAPS = /\b([A-Z][A-Z0-9]{4,15})\b/;
const TOTAL_USES =
  /\b(?:first|max(?:imum)?(?:\s+of)?|up\s+to|limit(?:ed)?\s+(?:it\s+)?to|only)\s+(\d{1,6})\s+(?:people|uses|buyers|tickets|times|redemptions|customers|guests)\b|\b(\d{1,6})\s+uses\b/i;
const PER_BUYER =
  /\b(?:once|one\s+use|1\s+use)\s+per\s+(?:person|buyer|customer)\b|\b(\d{1,3})\s+(?:uses?|times)\s+per\s+(?:person|buyer|customer)\b/i;

function validDay(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;
}

function endOn(text: string, now: Date): StatedSlots["ends_on"] | undefined {
  let year: number | undefined;
  let month: number | undefined;
  let day: number | undefined;
  let words = "";
  const dayFirst = END_DAY_FIRST.exec(text);
  const monthFirst = END_MONTH_FIRST.exec(text);
  const numeric = END_NUMERIC.exec(text);
  if (dayFirst) {
    day = Number(dayFirst[1]);
    month = MONTHS[dayFirst[2].toLowerCase().replace(/\.$/, "")];
    year = dayFirst[3] ? Number(dayFirst[3]) : undefined;
    words = dayFirst[0];
  } else if (monthFirst) {
    month = MONTHS[monthFirst[1].toLowerCase().replace(/\.$/, "")];
    day = Number(monthFirst[2]);
    year = monthFirst[3] ? Number(monthFirst[3]) : undefined;
    words = monthFirst[0];
  } else if (numeric) {
    // Day first (the hosts this ships to write 19/12/2026).
    day = Number(numeric[1]);
    month = Number(numeric[2]);
    year = Number(numeric[3]);
    words = numeric[0];
  }
  if (!month || !day) return undefined;
  if (!year) {
    year = now.getUTCFullYear();
    const thisYear = Date.UTC(year, month - 1, day, 23, 59, 59);
    if (thisYear < now.getTime()) year += 1;
  }
  if (!validDay(year, month, day)) return undefined;
  return { year, month, day, words: words.replace(/^\S+\s+/, "").trim() };
}

/** The values a host stated, newest message winning per value. */
export function extractStatedSlots(
  ownerMessages: readonly string[],
  now: Date = new Date(),
): StatedSlots {
  const slots: StatedSlots = {};
  for (const message of ownerMessages) {
    const text = message.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const quoted = QUOTED_CODE.exec(text)?.[1];
    const caps = /[a-z]/.test(text) ? CODE_CAPS.exec(text)?.[1] : undefined;
    const code = (quoted && normaliseAriDiscountCode(quoted)) ||
      CODE_WORD.exec(text)?.[1] || CODE_ALONE.exec(text)?.[1] ||
      (caps && !STOPWORDS.has(caps) ? caps : undefined);
    if (code && /^[A-Z0-9-]{4,16}$/i.test(code)) {
      slots.code = normaliseAriDiscountCode(code);
    }
    const percent = PERCENT.exec(text);
    if (percent) slots.value_bps = Math.round(Number(percent[1]) * 100);
    const ends = endOn(text, now);
    if (ends) slots.ends_on = ends;
    const total = TOTAL_USES.exec(text);
    if (total) slots.max_total_uses = Number(total[1] ?? total[2]);
    const perBuyer = PER_BUYER.exec(text);
    if (perBuyer) {
      slots.max_uses_per_buyer = perBuyer[1] ? Number(perBuyer[1]) : 1;
    }
  }
  return slots;
}

/**
 * #3355 Wave E (E1) — the intent read's stated values, as the model read
 * them. Shape mirrors `AriStatedValues` in ariIntentRead.ts (kept structural
 * here so this guard has no dependency on the read).
 */
export interface ModelStatedValues {
  code?: string;
  percent_off?: number;
  ends_on?: string;
  max_total_uses?: number;
  max_uses_per_buyer?: number;
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function wordsHaveNumber(words: string, value: number): boolean {
  return new RegExp(
    `(?:^|[^0-9.])${String(value).replace(".", "\\.")}(?![0-9])`,
  )
    .test(words);
}

/**
 * The model's stated values fill only what the deterministic read missed,
 * and only when the host's own words carry them (a code the host typed, a
 * number the host wrote, a day and month the host named). A value the model
 * invented is dropped, so it can never reach a card or a question.
 */
export function mergeModelStatedSlots(
  base: StatedSlots,
  model: ModelStatedValues | null | undefined,
  ownerMessages: readonly string[],
): StatedSlots {
  if (!model) return base;
  const words = ownerMessages.join("\n");
  const lower = words.toLowerCase();
  const out: StatedSlots = { ...base };
  if (!out.code && typeof model.code === "string") {
    const code = normaliseAriDiscountCode(model.code);
    if (
      code && /^[A-Z0-9-]{4,16}$/.test(code) &&
      words.toUpperCase().includes(code)
    ) out.code = code;
  }
  if (
    out.value_bps === undefined && typeof model.percent_off === "number" &&
    model.percent_off > 0 && model.percent_off <= 100 &&
    wordsHaveNumber(words, model.percent_off) &&
    /%|percent|per cent/i.test(words)
  ) {
    out.value_bps = Math.round(model.percent_off * 100);
  }
  if (!out.ends_on && typeof model.ends_on === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(model.ends_on);
    if (match) {
      const [year, month, day] = [
        Number(match[1]),
        Number(match[2]),
        Number(
          match[3],
        ),
      ];
      const monthName = MONTH_NAMES[month - 1] ?? "";
      const named = monthName && (lower.includes(monthName.slice(0, 3)));
      const numeric = new RegExp(`\\b0?${day}[/.-]0?${month}\\b`).test(words);
      if (
        validDay(year, month, day) && wordsHaveNumber(words, day) &&
        (named || numeric)
      ) {
        out.ends_on = { year, month, day, words: model.ends_on };
      }
    }
  }
  if (
    out.max_total_uses === undefined &&
    typeof model.max_total_uses === "number" &&
    Number.isInteger(model.max_total_uses) && model.max_total_uses > 0 &&
    wordsHaveNumber(words, model.max_total_uses)
  ) out.max_total_uses = model.max_total_uses;
  if (
    out.max_uses_per_buyer === undefined &&
    typeof model.max_uses_per_buyer === "number" &&
    Number.isInteger(model.max_uses_per_buyer) &&
    model.max_uses_per_buyer > 0 &&
    (wordsHaveNumber(words, model.max_uses_per_buyer) ||
      (model.max_uses_per_buyer === 1 && /\b(?:once|one)\b/i.test(words))) &&
    /\bper\s+(?:person|buyer|customer)\b/i.test(words)
  ) out.max_uses_per_buyer = model.max_uses_per_buyer;
  return out;
}

/** The widest UTC offset (14 h): a value this close to the local end is that day. */
const ZONE_OFFSET_SLACK_MS = 14 * 60 * 60 * 1000;

/** 23:59:59 on the stated day in the brand's time zone, as UTC ISO. */
export function endOfLocalDayIso(
  day: { year: number; month: number; day: number },
  timezone: string,
): string | null {
  const local = `${day.year}-${String(day.month).padStart(2, "0")}-${
    String(day.day).padStart(2, "0")
  }`;
  const instants = localDateTimeToInstants(local, "23:59", timezone);
  const last = instants.at(-1);
  if (!last) return null;
  return new Date(last.getTime() + 59_000).toISOString().replace(".000Z", "Z");
}

function localDayOf(iso: unknown, timezone: string): string | null {
  if (typeof iso !== "string") return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return parts;
}

function spokenDay(day: { year: number; month: number; day: number }): string {
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${day.day} ${names[day.month - 1]} ${day.year}`;
}

export type StatedSlotCheck =
  | { kind: "ok"; args: Record<string, unknown>; bound: string[] }
  | { kind: "ask"; text: string; missing: string[] };

/**
 * Compare what the host stated with a proposal's args, for every field the
 * tool's schema has. A stated end date the args lack is bound exactly (it is
 * unambiguous once the brand's time zone is known, and the confirmation card
 * shows it); any other stated value that is missing or different is asked
 * about instead of proposed, so it is never dropped.
 */
export function checkStatedSlots(args: {
  toolName: string;
  toolArgs: Record<string, unknown>;
  schemaKeys: ReadonlySet<string>;
  stated: StatedSlots;
  timezone: string | null;
}): StatedSlotCheck {
  const { stated, schemaKeys } = args;
  const out: Record<string, unknown> = { ...args.toolArgs };
  const bound: string[] = [];
  const asks: string[] = [];
  const missing: string[] = [];

  if (stated.code && schemaKeys.has("code") && out.kind !== "automatic") {
    const proposed = normaliseAriDiscountCode(out.code);
    if (proposed !== stated.code) {
      missing.push("code");
      asks.push(`the code ${stated.code}`);
    }
  }
  if (stated.value_bps !== undefined && schemaKeys.has("value_bps")) {
    if (out.value_type === "percent" || out.value_bps !== undefined) {
      if (Number(out.value_bps) !== stated.value_bps) {
        missing.push("value_bps");
        asks.push(`${stated.value_bps / 100}% off`);
      }
    }
  }
  if (stated.ends_on && schemaKeys.has("ends_at")) {
    const wanted = `${stated.ends_on.year}-${
      String(stated.ends_on.month).padStart(2, "0")
    }-${String(stated.ends_on.day).padStart(2, "0")}`;
    if (!args.timezone) {
      missing.push("ends_at");
      asks.push(
        `an end on ${spokenDay(stated.ends_on)} (which time zone is that in?)`,
      );
    } else if (
      out.ends_at === undefined || out.ends_at === null || out.ends_at === ""
    ) {
      const iso = endOfLocalDayIso(stated.ends_on, args.timezone);
      if (iso) {
        out.ends_at = iso;
        bound.push("ends_at");
      } else {
        missing.push("ends_at");
        asks.push(`an end on ${spokenDay(stated.ends_on)}`);
      }
    } else if (localDayOf(out.ends_at, args.timezone) !== wanted) {
      // #3355 Wave F (live eval): Flash writes the stated day's end in UTC
      // ("2026-12-19T23:59:59Z"), which is already 20 December in Lagos. A
      // value within a time-zone offset of the stated day's local end is that
      // day, so it is bound exactly; a different day is still asked about.
      const iso = endOfLocalDayIso(stated.ends_on, args.timezone);
      const proposedAt = Date.parse(String(out.ends_at));
      if (
        iso && Number.isFinite(proposedAt) &&
        Math.abs(proposedAt - Date.parse(iso)) <= ZONE_OFFSET_SLACK_MS
      ) {
        out.ends_at = iso;
        bound.push("ends_at");
      } else {
        missing.push("ends_at");
        asks.push(`an end on ${spokenDay(stated.ends_on)}`);
      }
    }
  }
  if (stated.max_total_uses !== undefined && schemaKeys.has("max_total_uses")) {
    if (Number(out.max_total_uses) !== stated.max_total_uses) {
      missing.push("max_total_uses");
      asks.push(`a limit of ${stated.max_total_uses} uses`);
    }
  }
  if (
    stated.max_uses_per_buyer !== undefined &&
    schemaKeys.has("max_uses_per_buyer")
  ) {
    if (Number(out.max_uses_per_buyer) !== stated.max_uses_per_buyer) {
      missing.push("max_uses_per_buyer");
      asks.push(
        stated.max_uses_per_buyer === 1
          ? "one use per buyer"
          : `${stated.max_uses_per_buyer} uses per buyer`,
      );
    }
  }
  if (asks.length > 0) {
    const list = asks.length === 1
      ? asks[0]
      : `${asks.slice(0, -1).join(", ")} and ${asks.at(-1)}`;
    return {
      kind: "ask",
      missing,
      text:
        `Before I set this up: you asked for ${list}, and I want to make sure that's exactly what goes on it. Is that right? Say yes and I'll prepare it with ${
          asks.length === 1 ? "that" : "those"
        } for you to approve. Nothing has been saved yet.`,
    };
  }
  return { kind: "ok", args: out, bound };
}

/**
 * The host's own words for a proposal: the last `limit` owner messages since
 * the previous proposal of the same tool (an earlier code's details never
 * leak onto the next one), oldest first, plus this turn's message.
 */
export function ownerMessagesForProposal(args: {
  history: ReadonlyArray<{
    role?: unknown;
    content?: unknown;
    tool_calls?: unknown;
  }>;
  toolName: string;
  current: string;
  limit?: number;
}): string[] {
  const limit = args.limit ?? 6;
  const collected: string[] = [args.current];
  for (let index = args.history.length - 1; index >= 0; index -= 1) {
    const row = args.history[index];
    if (
      row.role === "assistant" && row.tool_calls &&
      (row.tool_calls as { tool_name?: unknown }).tool_name === args.toolName
    ) break;
    if (row.role !== "user") continue;
    const text = (row.content as { text?: unknown } | null)?.text;
    if (typeof text === "string" && text.trim()) collected.push(text);
    if (collected.length >= limit) break;
  }
  return collected.reverse();
}

const UUID_ARG =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * agent-chat's stage before a proposal card: the host's stated values,
 * checked against the tool's own schema, in the brand's time zone (read with
 * the caller's login, so RLS decides). Nothing stated: unchanged, no read.
 */
export async function preserveStatedSlots(args: {
  toolName: string;
  toolArgs: Record<string, unknown>;
  parameters: Record<string, unknown>;
  ownerMessages: readonly string[];
  userClient: SupabaseClient;
  now?: Date;
  /** #3355 Wave E — the intent read's stated values (grounded again here). */
  modelStated?: ModelStatedValues | null;
}): Promise<StatedSlotCheck> {
  const properties = (args.parameters as { properties?: unknown }).properties;
  const schemaKeys = new Set(
    properties && typeof properties === "object" ? Object.keys(properties) : [],
  );
  const stated = mergeModelStatedSlots(
    extractStatedSlots(args.ownerMessages, args.now),
    args.modelStated,
    args.ownerMessages,
  );
  const relevant = (stated.code && schemaKeys.has("code")) ||
    (stated.value_bps !== undefined && schemaKeys.has("value_bps")) ||
    (stated.ends_on && schemaKeys.has("ends_at")) ||
    (stated.max_total_uses !== undefined && schemaKeys.has("max_total_uses")) ||
    (stated.max_uses_per_buyer !== undefined &&
      schemaKeys.has("max_uses_per_buyer"));
  if (!relevant) return { kind: "ok", args: args.toolArgs, bound: [] };
  let timezone: string | null = null;
  if (stated.ends_on && schemaKeys.has("ends_at")) {
    const brandId = args.toolArgs.brand_id;
    if (typeof brandId === "string" && UUID_ARG.test(brandId)) {
      const { data } = await args.userClient.from("brands")
        .select("default_timezone,country_code")
        .eq("id", brandId)
        .maybeSingle();
      const brand = (data ?? null) as
        | { default_timezone?: unknown; country_code?: unknown }
        | null;
      timezone = isValidIanaTimezone(brand?.default_timezone)
        ? String(brand!.default_timezone)
        : marketDefaultTimezone(brand?.country_code);
    }
  }
  return checkStatedSlots({
    toolName: args.toolName,
    toolArgs: args.toolArgs,
    schemaKeys,
    stated,
    timezone,
  });
}
