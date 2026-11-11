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
 * I-ARI-CLAIM-MATCHES-RECEIPT is declared beside its enforcing check in ariClaimCheck.ts (rework 3).
 * MINGLA-INVARIANT: I-ARI-STATED-SLOTS-PRESERVED | issue #3355 | Codes, percentages (digits, number words, pc / pct / per cent, half off), fixed amounts off (in the currency's minor units), start and end dates (incl. "between … and …", "the end of <month>") and use limits the host stated (last 6 owner messages since the previous proposal of the same tool) are compared with the proposal args for every tool whose schema has that field, on both agent paths: per code and field the latest statement wins (a percent replaces an amount and the reverse), values bind to the code in their own clause in either word order, the intent read's values are primary and the words the cross-check; a stated end day is bound to 23:59:59 local and a future start day to 00:00 local; anything else missing, different or in conflict makes Ari ask instead of proposing (same test files).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  isValidIanaTimezone,
  localDateTimeToInstants,
} from "./agentRelativeTime.ts";
import { normaliseAriDiscountCode } from "./ariDiscountArgs.ts";
import { marketDefaultTimezone } from "./payoutCountries.ts";
import { formatMinor, minorFromMajor } from "./money/formatMinor.ts";
import { assertOwnerCopy } from "./ariOwnerCopy.ts";
import { toolOwnerCopy } from "./ariPresentation/toolLabels.ts";

// ── I-ARI-CLAIM-MATCHES-RECEIPT: the records ────────────────────────────────
//
// #3355 rework 3 (Seth, 2026-11-11): the rework-2 word-list guard (strip any
// sentence with a status word or a chat object, then blank and replace with
// state) is gone. The claim check in ariClaimCheck.ts reads the reply with
// one structured model call and compares each completion claim with the
// records below; these helpers only say what the chat's records are.

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

/**
 * A code, title or name this chat could be talking about: from write args
 * (code, title, name, subject …) and the host's own stated values.
 */
export function writeObjectsFrom(args: {
  evidence: readonly unknown[];
  statedCodes?: readonly string[];
  statedNames?: readonly string[];
}): string[] {
  const out = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    const text = value.replace(/\s+/g, " ").trim();
    if (text.length < 4 || text.length > 80) return;
    if (STOPWORDS.has(text.toUpperCase())) return;
    if (/^[0-9a-f-]{20,}$/i.test(text)) return;
    out.add(text);
  };
  for (const item of args.evidence) {
    const record = evidenceRecord(item);
    const toolArgs = evidenceRecord(record?.args) ??
      evidenceRecord(record?.tool_args);
    if (!toolArgs) continue;
    for (const key of OBJECT_KEYS) add(toolArgs[key]);
    const context = evidenceRecord(toolArgs.__proposal_context);
    if (context) add(context.flow_title);
  }
  for (const code of args.statedCodes ?? []) add(code);
  for (const name of args.statedNames ?? []) add(name);
  return [...out];
}

const OBJECT_KEYS = [
  "code",
  "title",
  "name",
  "subject",
  "label",
  "display_name",
  "event_title",
  "trip_title",
  "package_name",
  "tier_name",
  "campaign_name",
] as const;

export const TRUE_STATE_NOTHING_SAVED =
  "I haven't saved or sent anything for that yet.";

type EvidenceStatus =
  | "pending"
  | "executed"
  | "failed"
  | "cancelled"
  | "expired";

function evidenceRecord(item: unknown): Record<string, unknown> | null {
  return item && typeof item === "object" && !Array.isArray(item)
    ? item as Record<string, unknown>
    : null;
}

/** One write this chat can prove, in its true state. */
export interface WriteState {
  actionId: string;
  toolName: string;
  status: EvidenceStatus;
  /** The object it is about (code, title, name), when it has one. */
  object: string | null;
  args: Record<string, unknown>;
  /** The executed receipt's own words (its card title, body and rows). */
  receiptText: string | null;
}

function objectOf(args: Record<string, unknown>): string | null {
  for (const key of OBJECT_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim().length >= 2) {
      return value.replace(/\s+/g, " ").trim().slice(0, 80);
    }
  }
  return null;
}

function receiptTextOf(rendition: Record<string, unknown>): string | null {
  const title = typeof rendition.title === "string"
    ? rendition.title.trim()
    : "";
  const body = typeof rendition.body === "string" ? rendition.body.trim() : "";
  if (!title && !body) return null;
  const rows: string[] = [];
  for (const block of Array.isArray(rendition.blocks) ? rendition.blocks : []) {
    const record = evidenceRecord(block);
    if (!record || record.type !== "key_value" || !Array.isArray(record.rows)) {
      continue;
    }
    for (const row of record.rows) {
      const cell = evidenceRecord(row);
      if (typeof cell?.label === "string" && typeof cell?.value === "string") {
        rows.push(`${cell.label} ${cell.value}`);
      }
    }
  }
  const head = [title, body].filter(Boolean).map((part) =>
    /[.:!]$/.test(part) ? part : `${part}.`
  ).join(" ");
  const withRows = rows.length > 0
    ? `${head.replace(/[.:]$/, ":")} ${rows.slice(0, 4).join(", ")}.`
    : head;
  return withRows;
}

/**
 * Every write in the chat's recent rows, in its true state: proposals (their
 * args), outcomes from tool rows, receipt words from the receipt card, and
 * the database's own status for a card still open (`live`, when read).
 */
export function writeStatesFromHistory(
  rows: ReadonlyArray<{
    role?: unknown;
    content?: unknown;
    tool_calls?: unknown;
    tool_results?: unknown;
  }>,
  live?: ReadonlyMap<string, { status: string; expires_at?: string | null }>,
  now: Date = new Date(),
): WriteState[] {
  const byAction = new Map<string, WriteState>();
  const order: string[] = [];
  const receiptWords = new Map<string, string>();
  for (const row of rows) {
    if (row.role === "assistant") {
      const calls = evidenceRecord(row.tool_calls);
      if (calls && typeof calls.pending_action_id === "string") {
        const args = evidenceRecord(calls.args) ?? {};
        const actionId = calls.pending_action_id;
        if (!byAction.has(actionId)) order.push(actionId);
        byAction.set(actionId, {
          actionId,
          toolName: typeof calls.tool_name === "string" ? calls.tool_name : "",
          status: byAction.get(actionId)?.status ?? "pending",
          object: objectOf(args),
          args,
          receiptText: byAction.get(actionId)?.receiptText ?? null,
        });
      }
      const content = evidenceRecord(row.content);
      const rendition = evidenceRecord(
        evidenceRecord(content?.structured)?.rendition,
      );
      const id = typeof rendition?.rendition_id === "string"
        ? rendition.rendition_id
        : "";
      if (
        rendition && rendition.kind === "receipt" && id.startsWith("receipt:")
      ) {
        const words = receiptTextOf(rendition);
        if (words) receiptWords.set(id.slice("receipt:".length), words);
      }
    }
    if (row.role === "tool") {
      const result = evidenceRecord(row.tool_results);
      if (!result || typeof result.pending_action_id !== "string") continue;
      const actionId = result.pending_action_id;
      const outcome = result.outcome;
      const status: EvidenceStatus | null = outcome === "executed" ||
          outcome === "failed" || outcome === "cancelled" ||
          outcome === "expired"
        ? outcome
        : null;
      if (!status) continue;
      const known = byAction.get(actionId);
      if (known) {
        known.status = status;
      } else {
        order.push(actionId);
        byAction.set(actionId, {
          actionId,
          toolName: typeof result.tool_name === "string"
            ? result.tool_name
            : "",
          status,
          object: null,
          args: {},
          receiptText: null,
        });
      }
    }
  }
  const out: WriteState[] = [];
  for (const actionId of order) {
    const state = byAction.get(actionId);
    if (!state) continue;
    const words = receiptWords.get(actionId);
    if (words) state.receiptText = words;
    const db = live?.get(actionId);
    if (db && state.status === "pending") {
      if (
        db.status === "executed" || db.status === "failed" ||
        db.status === "cancelled" || db.status === "expired"
      ) {
        state.status = db.status;
      } else if (
        db.status === "pending" && db.expires_at &&
        Date.parse(db.expires_at) <= now.getTime()
      ) {
        state.status = "expired";
      }
    }
    out.push(state);
  }
  return out;
}

function ownerVerb(
  toolName: string,
): { verb: string; noun: string; done: string } {
  const copy = toolOwnerCopy(toolName);
  const words = copy.verb.trim().split(/\s+/);
  const verb = (words[0] ?? "save").toLowerCase();
  const noun = words.slice(1).join(" ").toLowerCase() || "change";
  return { verb, noun, done: copy.done };
}

/** One state, in the server's own words (owner-copy linted). */
export function writeStateText(state: WriteState): string {
  const { verb, noun, done } = ownerVerb(state.toolName);
  const name = state.object;
  const thing = name ? name : `the ${noun}`;
  let text: string;
  switch (state.status) {
    case "executed":
      text = state.receiptText ??
        `${done}${name ? `: ${name}` : ""}. Saved and checked in Mingla.`;
      break;
    case "pending":
      text =
        `Here's ${thing} ready to ${verb}. Tap Confirm to save it, or Edit to change it.`;
      break;
    case "cancelled":
      text = `The card for ${thing} was cancelled, so nothing was saved.`;
      break;
    case "expired":
      text =
        `The card for ${thing} expired before it was confirmed, so nothing was saved. Ask me and I'll prepare it again.`;
      break;
    case "failed":
      text = `${
        name ? `${name} couldn't` : "That couldn't"
      } be saved, so nothing changed. Ask me and I'll try again.`;
      break;
    default: {
      const never: never = state.status;
      text = String(never);
    }
  }
  return assertOwnerCopy(text, {
    fallback: "Here's where that stands: check the card above.",
    surface: "write_state",
    mode: "prose",
  });
}

/**
 * What a conversation's recent rows can prove: proposals (their tool and
 * args) and receipts, each receipt carrying its proposal's args. Under the
 * structural guard these only name the chat's write objects; status itself
 * comes from `writeStatesFromHistory`.
 */
export function claimEvidenceFromHistory(
  rows: ReadonlyArray<{
    role?: unknown;
    tool_calls?: unknown;
    tool_results?: unknown;
  }>,
): unknown[] {
  const proposals = new Map<string, Record<string, unknown>>();
  const evidence: unknown[] = [];
  for (const row of rows) {
    if (row.role !== "assistant") continue;
    const calls = evidenceRecord(row.tool_calls);
    if (calls && typeof calls.pending_action_id === "string") {
      proposals.set(calls.pending_action_id, calls);
      evidence.push(calls);
    }
  }
  for (const row of rows) {
    if (row.role !== "tool") continue;
    const result = evidenceRecord(row.tool_results);
    if (!result || typeof result.pending_action_id !== "string") continue;
    const proposal = proposals.get(result.pending_action_id);
    evidence.push(
      proposal && proposal.args !== undefined
        ? { ...result, args: proposal.args }
        : result,
    );
  }
  return evidence;
}

// ── I-ARI-STATED-SLOTS-PRESERVED ────────────────────────────────────────────

/** A calendar day the host named (local to the brand). */
export interface StatedDay {
  year: number;
  month: number;
  day: number;
  words: string;
  /** The host also named a time of day ("at 6pm", "18:00"). */
  has_time?: boolean;
  /**
   * #3355 rework 1 (P3-14): a numeric date both ways round is a real day
   * (12/1/2026). `alt` is the month-first reading; the brand's country picks
   * one, or Ari asks.
   */
  alt?: { month: number; day: number };
}

/** A fixed amount off the host stated, in major units of its currency. */
export interface StatedAmount {
  major: number;
  /** ISO code the host's words carry (₦, NGN, naira …), else null. */
  currency: string | null;
  words: string;
}

/** The values the host stated for one discount. */
export interface StatedValues {
  value_bps?: number;
  /** #3355 rework 1 (P1-3): a fixed amount off ("₦5,000 off"). */
  amount?: StatedAmount;
  /** The stated end, as the local calendar day. */
  ends_on?: StatedDay;
  /** #3355 rework 1 (P2-10): the stated start, as the local calendar day. */
  starts_on?: StatedDay;
  max_total_uses?: number;
  max_uses_per_buyer?: number;
}

export interface StatedSlots extends StatedValues {
  code?: string;
  /**
   * #3355 Wave F (live eval): every code a single message names ("Create
   * the codes GIRLSTRIPLAGOS and FFBTSCOM10"). A proposal for any one of
   * them keeps what the host stated; one card is made per code.
   */
  codes?: string[];
  /**
   * #3355 rework 1 (P2-9): when one message gives two codes their own
   * values ("FAVY10 10% off until 19 December and GIRLS20 20% off until 31
   * December"), each code's values, never the first code's.
   */
  per_code?: Record<string, StatedValues>;
  /**
   * #3355 rework 2: two different values for one field with no correction
   * between them (or the intent read and the words disagree). Ari asks one
   * question naming both.
   */
  conflicts?: StatedConflict[];
  /** #3355 rework 2: per object ("*" or a code), the fields the newest message stated. */
  latest_fields?: Record<string, StatedField[]>;
}

export interface StatedConflict {
  /** The code it is about; null for the one object being set up. */
  code: string | null;
  field: StatedField;
  said: [string, string];
}

const VALUE_KEYS: ReadonlyArray<keyof StatedValues> = [
  "value_bps",
  "amount",
  "ends_on",
  "starts_on",
  "max_total_uses",
  "max_uses_per_buyer",
];

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
  "(?:until|till|til|up\\s+to|through|thru|by|ends?(?:\\s+on)?|ending(?:\\s+on)?|expires?(?:\\s+on)?|expiring(?:\\s+on)?|valid\\s+(?:until|till|through)|runs?\\s+(?:until|till|through)|to)";
const START_LEAD =
  "(?:from|starting(?:\\s+(?:on|from))?|starts?(?:\\s+on)?|beginning(?:\\s+on)?|begins?(?:\\s+on)?|valid\\s+from|effective(?:\\s+from)?)";
function dayPatterns(lead: string): [RegExp, RegExp, RegExp] {
  return [
    new RegExp(
      `\\b${lead}\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH}\\.?(?:,?\\s+(\\d{4}))?`,
      "i",
    ),
    new RegExp(
      `\\b${lead}\\s+${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`,
      "i",
    ),
    new RegExp(
      `\\b${lead}\\s+(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4})\\b`,
      "i",
    ),
  ];
}
const END_PATTERNS = dayPatterns(END_LEAD);
const START_PATTERNS = dayPatterns(START_LEAD);
const STATED_TIME =
  /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\b|\b(?:noon|midday|midnight)\b/i;
const QUOTED_CODE = /["“'‘]([A-Za-z0-9 -]{4,20})["”'’]/;
const CODE_WORD =
  /\b(?:code|promo(?:\s+code)?|coupon|voucher)\s+(?:called\s+|named\s+|of\s+|is\s+|as\s+)?([A-Z0-9][A-Z0-9-]{3,15})\b/;
const CODE_ALONE =
  /\b([A-Z]{2,}[0-9]{1,}[A-Z0-9]*|[A-Z0-9]*[0-9]+[A-Z]{2,}[A-Z0-9]*)\b/;
/** An all-capitals word in a mixed-case message reads as a code name. */
const CODE_CAPS = /\b([A-Z][A-Z0-9]{4,15})\b/;
const TOTAL_USES =
  /\b(?:first|max(?:imum)?(?:\s+of)?|up\s+to|limit(?:ed)?\s+(?:it\s+)?to|only)\s+(\d{1,6})\s+(?:people|uses|buyers|tickets|times|redemptions|customers|guests)\b|\b(\d{1,6})\s+uses\b(?!\s+per\b)/i;
const PER_BUYER =
  /\b(?:once|one\s+use|1\s+use)\s+per\s+(?:person|buyer|customer)\b|\b(\d{1,3})\s+(?:uses?|times)\s+per\s+(?:person|buyer|customer)\b/i;

// #3355 rework 1 (P1-3): a fixed amount off, with or without its currency.
const AMOUNT_NUMBER =
  "(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{1,2}))?\\s?([kK])?";
const CURRENCY_SIGNS: Readonly<Record<string, string>> = Object.freeze({
  "₦": "NGN",
  "£": "GBP",
  "€": "EUR",
  "$": "USD",
  "₵": "GHS",
  "GH₵": "GHS",
  "KSH": "KES",
  "N": "NGN",
});
const CURRENCY_WORDS: Readonly<Record<string, string>> = Object.freeze({
  naira: "NGN",
  pound: "GBP",
  pounds: "GBP",
  quid: "GBP",
  euro: "EUR",
  euros: "EUR",
  dollar: "USD",
  dollars: "USD",
  cedi: "GHS",
  cedis: "GHS",
  shilling: "KES",
  shillings: "KES",
  rand: "ZAR",
});
const CURRENCY_CODES = "NGN|GBP|USD|EUR|GHS|KES|ZAR|CAD|AUD|NZD";
const AMOUNT_OFF = "\\s*(?:off\\b|discount\\b)";
// Rework 2 (P3-20): "NGN5000 off" with no space reads too.
const AMOUNT_SIGN_FIRST = new RegExp(
  `(GH₵|KSh|₦|£|€|\\$|₵|\\bN(?=\\d)|\\b(?:${CURRENCY_CODES})(?=\\s|\\d))\\s?${AMOUNT_NUMBER}${AMOUNT_OFF}`,
  "i",
);
const AMOUNT_WORD_AFTER = new RegExp(
  `\\b${AMOUNT_NUMBER}\\s?(naira|pounds?|quid|euros?|dollars?|cedis?|shillings?|rand|${CURRENCY_CODES})\\b${AMOUNT_OFF}`,
  "i",
);
const AMOUNT_BARE = new RegExp(`(?<![\\w.,%])${AMOUNT_NUMBER}\\s+off\\b`, "i");
/** Dollar currencies: "$" is the brand's own dollar when it sells in one. */
const DOLLAR_CURRENCIES = new Set(["USD", "CAD", "AUD", "NZD"]);
/** Countries that write numeric dates month first (12/19/2026). */
const MONTH_FIRST_COUNTRIES = new Set([
  "US",
  "PR",
  "GU",
  "VI",
  "AS",
  "MP",
  "UM",
  "PH",
  "FM",
  "MH",
  "PW",
]);

function validDay(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;
}

function statedDay(
  text: string,
  patterns: [RegExp, RegExp, RegExp],
  now: Date,
): StatedDay | undefined {
  let year: number | undefined;
  let month: number | undefined;
  let day: number | undefined;
  let alt: StatedDay["alt"];
  let words = "";
  let end = 0;
  const [dayFirst, monthFirst, numeric] = patterns.map((pattern) =>
    pattern.exec(text)
  );
  if (dayFirst) {
    day = Number(dayFirst[1]);
    month = MONTHS[dayFirst[2].toLowerCase().replace(/\.$/, "")];
    year = dayFirst[3] ? Number(dayFirst[3]) : undefined;
    words = dayFirst[0];
    end = dayFirst.index + dayFirst[0].length;
  } else if (monthFirst) {
    month = MONTHS[monthFirst[1].toLowerCase().replace(/\.$/, "")];
    day = Number(monthFirst[2]);
    year = monthFirst[3] ? Number(monthFirst[3]) : undefined;
    words = monthFirst[0];
    end = monthFirst.index + monthFirst[0].length;
  } else if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    year = Number(numeric[3]);
    words = numeric[0];
    end = numeric.index + numeric[0].length;
    const dayFirstOk = validDay(year, second, first);
    const monthFirstOk = validDay(year, first, second);
    if (dayFirstOk && monthFirstOk && first !== second) {
      // Both readings are real days: the brand's country decides.
      day = first;
      month = second;
      alt = { month: first, day: second };
    } else if (dayFirstOk) {
      day = first;
      month = second;
    } else if (monthFirstOk) {
      month = first;
      day = second;
    }
  }
  if (!month || !day) return undefined;
  if (!year) {
    year = now.getUTCFullYear();
    const thisYear = Date.UTC(year, month - 1, day, 23, 59, 59);
    if (thisYear < now.getTime()) year += 1;
  }
  if (!validDay(year, month, day)) return undefined;
  // A time named right after the day ("19 December at 6pm") is the host's.
  const tail = text.slice(end, end + 24);
  const has_time = STATED_TIME.test(tail) ||
    STATED_TIME.test(text.slice(Math.max(0, end - words.length - 16), end));
  return {
    year,
    month,
    day,
    words: words.replace(/^\S+\s+/, "").trim(),
    ...(has_time ? { has_time: true } : {}),
    ...(alt ? { alt } : {}),
  };
}

function amountNumber(
  whole: string,
  decimals: string | undefined,
  thousands: string | undefined,
): number {
  const value = Number(
    `${whole.replace(/,/g, "")}${decimals ? `.${decimals}` : ""}`,
  );
  return thousands ? value * 1000 : value;
}

// ── #3355 rework 2: every stated value with where it sits ───────────────────
//
// A message is read as a list of value mentions (a percent, an amount, an
// end or start day, a use limit), each with its place in the words. Each
// mention is bound to the code it belongs to (the code in its own clause,
// before or after it), and per code and field the LATEST statement wins: a
// newer message replaces an older one (a percent replaces an amount, and the
// reverse), and inside one message a correction ("actually", "instead",
// "make it", "not 10%") keeps the newer value. Two different values for one
// field with no correction between them are a conflict: Ari asks.

/** One slot of a discount the host can state (percent and amount share "value"). */
export type StatedField =
  | "value"
  | "ends_on"
  | "starts_on"
  | "max_total_uses"
  | "max_uses_per_buyer";

interface ValueMention {
  field: StatedField;
  index: number;
  end: number;
  values: StatedValues;
  /** Equality key: two mentions with the same key say the same thing. */
  key: string;
  /** The host's words for it, as Ari repeats them in a question. */
  words: string;
  negated: boolean;
}

const NUMBER_WORDS: Readonly<Record<string, number>> = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
});
const TENS = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
const UNITS = "one|two|three|four|five|six|seven|eight|nine";
const NUMBER_WORD =
  `(?:(?:a|one)\\s+hundred|(?:${TENS})(?:[\\s-](?:${UNITS}))?|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|ten|${UNITS})`;
const PERCENT_SUFFIX = "\\s?(?:%|percent\\b|per\\s?cent\\b|pc\\b|pct\\b)";
const PERCENT_DIGITS = new RegExp(
  `\\b(\\d{1,2}(?:\\.\\d{1,2})?|100)${PERCENT_SUFFIX}`,
  "gi",
);
const PERCENT_WORDS = new RegExp(`\\b(${NUMBER_WORD})${PERCENT_SUFFIX}`, "gi");
const PERCENT_FRACTION =
  /\b(?:(half)|(?:a\s+)?(quarter)|(?:a\s+|one\s+)?(third))\s+(?:off|price)\b/gi;

/** "twenty-five" → 25; null when it is not a number word. */
export function numberWordValue(words: string): number | null {
  const text = words.toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ")
    .trim();
  if (/^(?:a|one) hundred$/.test(text)) return 100;
  const parts = text.split(" ");
  let total = 0;
  for (const part of parts) {
    const value = NUMBER_WORDS[part];
    if (value === undefined) return null;
    total += value;
  }
  return total > 0 && total <= 100 ? total : null;
}

// #3355 rework 3 (R3-8): amounts in words ("fifteen hundred naira off",
// "five thousand naira", "five k off", "two grand off").
const AMOUNT_WORD_TOKEN =
  `(?:${TENS}|${UNITS}|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|hundred|thousand|grand|k|and)`;
const AMOUNT_IN_WORDS = new RegExp(
  `\\b((?:a|${TENS}|${UNITS}|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)(?:[\\s-]+${AMOUNT_WORD_TOKEN})*)\\s+(?:(naira|pounds?|quid|euros?|dollars?|cedis?|shillings?|rand|${CURRENCY_CODES})\\s+)?(?:off|discount)\\b`,
  "gi",
);

/** "fifteen hundred" → 1500, "five k" → 5000; null when not an amount. */
export function amountWordsValue(words: string): number | null {
  const parts = words.toLowerCase().replace(/-/g, " ").split(/\s+/).filter(
    Boolean,
  );
  let total = 0;
  let current = 0;
  let multiplied = false;
  for (const part of parts) {
    if (part === "and") continue;
    if (part === "a") {
      current += 1;
      continue;
    }
    if (part === "hundred") {
      current = (current || 1) * 100;
      multiplied = true;
      continue;
    }
    if (part === "thousand" || part === "k" || part === "grand") {
      total += (current || 1) * 1000;
      current = 0;
      multiplied = true;
      continue;
    }
    const value = NUMBER_WORDS[part];
    if (value === undefined) return null;
    current += value;
  }
  const value = total + current;
  return value > 0 ? (multiplied ? value : -value) : null;
}

/** #3355 rework 3 (R3-10): named days the host may end a code on. */
const HOLIDAY_DAYS: ReadonlyArray<[RegExp, number, number]> = [
  [/christmas\s+eve|xmas\s+eve/i, 12, 24],
  [/boxing\s+day/i, 12, 26],
  [/new\s+year['’]?s?\s+eve/i, 12, 31],
  [/new\s+year['’]?s?(?:\s+day)?/i, 1, 1],
  [/christmas(?:\s+day)?|xmas/i, 12, 25],
  [/valentine['’]?s?(?:\s+day)?/i, 2, 14],
];
const END_HOLIDAY = new RegExp(
  `\\b${END_LEAD}\\s+(?:the\\s+)?(christmas\\s+eve|xmas\\s+eve|boxing\\s+day|new\\s+year['’]?s?\\s+eve|new\\s+year['’]?s?(?:\\s+day)?|christmas(?:\\s+day)?|xmas|valentine['’]?s?(?:\\s+day)?)\\b`,
  "gi",
);
/** "for 2 weeks", "for ten days", "for a month" (from the start, or today). */
const FOR_DURATION = new RegExp(
  `\\b(?:for|lasts?|run(?:s|ning)?\\s+for|valid\\s+for)\\s+(?:the\\s+next\\s+)?(\\d{1,3}|a|an|one|${NUMBER_WORD})\\s+(days?|weeks?|months?)\\b`,
  "gi",
);
/** "from 10% to 15%", "change the 10% to 15%": the second value is the one. */
const CHANGE_LEAD =
  /\b(?:from|change|changing|up|raise|lower|bump|move|switch|go|going|increase|reduce|drop|take)\b[^.?!]{0,24}$/i;

/** A currency code run into its amount ("NGN5000"): never a discount code. */
const CURRENCY_AMOUNT_TOKEN = new RegExp(`^(?:${CURRENCY_CODES}|KSH|N)\\d+K?$`);

const CORRECTION =
  /\b(?:actually|instead|rather|nope|no|not|make\s+it|change\s+(?:it|that)\s+to|scratch\s+that|sorry|i\s+mean[t]?|correction|wait|on\s+second\s+thought)\b/i;
const NEGATED_LEAD =
  /\b(?:not|never|instead\s+of|rather\s+than|no\s+longer)\s+(?:a\s+|the\s+|at\s+)?$/i;
const CLAUSE_BREAK = /[,;]|\band\b|\bbut\b|\bplus\b|\bwhile\b|\bwhereas\b/gi;
const SHARED_WORDS = /\b(?:both|all|each|every|either)\b/i;

function percentKey(bps: number): string {
  return `p:${bps}`;
}

function dayKey(day: StatedDay): string {
  return `${day.year}-${day.month}-${day.day}${
    day.alt ? `|${day.alt.month}-${day.alt.day}` : ""
  }${day.has_time ? "@t" : ""}`;
}

function globalOf(pattern: RegExp): RegExp {
  return new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
}

const BETWEEN_DAYS = new RegExp(
  `\\b(?:between|from)\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?(?:\\s+${MONTH}\\.?)?\\s+(?:and|to|until|till|through|-|–)\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH}\\.?(?:,?\\s+(\\d{4}))?`,
  "gi",
);
const END_OF_MONTH = new RegExp(
  `\\b(?:until|till|til|through|thru|by|to|ends?|ending)\\s+(?:the\\s+)?end\\s+of\\s+${MONTH}\\.?(?:,?\\s+(\\d{4}))?`,
  "gi",
);

function inferYear(
  month: number,
  day: number,
  now: Date,
  year?: number,
): number {
  if (year) return year;
  let guess = now.getUTCFullYear();
  if (Date.UTC(guess, month - 1, day, 23, 59, 59) < now.getTime()) guess += 1;
  return guess;
}

function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Every value mention in one message, in the order the host wrote them. */
function valueMentions(text: string, now: Date): ValueMention[] {
  const found: ValueMention[] = [];
  const overlaps = (field: StatedField, index: number, end: number) =>
    found.some((other) =>
      other.field === field && index < other.end && end > other.index
    );
  const push = (mention: Omit<ValueMention, "negated">) => {
    if (overlaps(mention.field, mention.index, mention.end)) return;
    const lead = text.slice(Math.max(0, mention.index - 18), mention.index);
    found.push({ ...mention, negated: NEGATED_LEAD.test(lead) });
  };
  const percent = (index: number, end: number, value: number) => {
    if (!(value > 0 && value <= 100)) return;
    const bps = Math.round(value * 100);
    push({
      field: "value",
      index,
      end,
      values: { value_bps: bps },
      key: percentKey(bps),
      words: `${bps / 100}% off`,
    });
  };
  for (const match of text.matchAll(PERCENT_DIGITS)) {
    const index = match.index ?? 0;
    percent(index, index + match[0].length, Number(match[1]));
  }
  for (const match of text.matchAll(PERCENT_WORDS)) {
    const value = numberWordValue(match[1]);
    const index = match.index ?? 0;
    if (value !== null) {
      percent(index, index + match[0].length, value);
    }
  }
  for (const match of text.matchAll(PERCENT_FRACTION)) {
    const value = match[1] ? 50 : match[2] ? 25 : 33.33;
    const index = match.index ?? 0;
    percent(index, index + match[0].length, value);
  }
  for (const match of text.matchAll(AMOUNT_IN_WORDS)) {
    const raw = amountWordsValue(match[1]);
    const currencyWord = match[2]?.toLowerCase();
    // A bare number word needs a currency ("twenty naira off"); a hundred /
    // thousand / k reads on its own ("fifteen hundred off").
    if (raw === null || (raw < 0 && !currencyWord)) continue;
    const major = Math.abs(raw);
    const index = match.index ?? 0;
    const end = index + match[0].length;
    if (overlaps("value", index, end)) continue;
    const currency = currencyWord
      ? CURRENCY_WORDS[currencyWord] ?? currencyWord.toUpperCase()
      : null;
    push({
      field: "value",
      index,
      end,
      values: { amount: { major, currency, words: match[0].trim() } },
      key: `a:${major}:${currency ?? ""}`,
      words: match[0].trim(),
    });
  }
  for (const pattern of [AMOUNT_SIGN_FIRST, AMOUNT_WORD_AFTER, AMOUNT_BARE]) {
    for (const match of text.matchAll(globalOf(pattern))) {
      const amount = amountFromMatch(pattern, match);
      if (!amount || !Number.isFinite(amount.major) || amount.major <= 0) {
        continue;
      }
      const index = match.index ?? 0;
      // An amount inside a percent ("10 percent off") is the percent.
      if (overlaps("value", index, index + match[0].length)) continue;
      push({
        field: "value",
        index,
        end: index + match[0].length,
        values: { amount },
        key: `a:${amount.major}:${amount.currency ?? ""}`,
        words: amount.words,
      });
    }
  }
  for (const match of text.matchAll(BETWEEN_DAYS)) {
    const index = match.index ?? 0;
    const end = index + match[0].length;
    const endMonth = MONTHS[match[4].toLowerCase().replace(/\.$/, "")];
    const startMonth = match[2]
      ? MONTHS[match[2].toLowerCase().replace(/\.$/, "")]
      : endMonth;
    const year = match[5] ? Number(match[5]) : undefined;
    const startDay = Number(match[1]);
    const endDay = Number(match[3]);
    if (!startMonth || !endMonth) continue;
    const endYear = inferYear(endMonth, endDay, now, year);
    const startYear = year ??
      (startMonth > endMonth ? endYear - 1 : endYear);
    if (
      !validDay(startYear, startMonth, startDay) ||
      !validDay(endYear, endMonth, endDay)
    ) continue;
    const starts: StatedDay = {
      year: startYear,
      month: startMonth,
      day: startDay,
      words: match[0].trim(),
    };
    const ends: StatedDay = {
      year: endYear,
      month: endMonth,
      day: endDay,
      words: match[0].trim(),
    };
    push({
      field: "starts_on",
      index,
      end,
      values: { starts_on: starts },
      key: dayKey(starts),
      words: spokenDay(starts),
    });
    push({
      field: "ends_on",
      index,
      end,
      values: { ends_on: ends },
      key: dayKey(ends),
      words: spokenDay(ends),
    });
  }
  for (const match of text.matchAll(END_OF_MONTH)) {
    const index = match.index ?? 0;
    const month = MONTHS[match[1].toLowerCase().replace(/\.$/, "")];
    if (!month) continue;
    const year = inferYear(
      month,
      1,
      now,
      match[2] ? Number(match[2]) : undefined,
    );
    const ends: StatedDay = {
      year,
      month,
      day: lastDayOf(year, month),
      words: match[0].trim(),
    };
    push({
      field: "ends_on",
      index,
      end: index + match[0].length,
      values: { ends_on: ends },
      key: dayKey(ends),
      words: spokenDay(ends),
    });
  }
  for (const match of text.matchAll(END_HOLIDAY)) {
    const index = match.index ?? 0;
    const named = HOLIDAY_DAYS.find(([pattern]) => pattern.test(match[1]));
    if (!named) continue;
    const [, month, dayOfMonth] = named;
    const year = inferYear(month, dayOfMonth, now, undefined);
    const ends: StatedDay = {
      year,
      month,
      day: dayOfMonth,
      words: match[1].trim(),
    };
    push({
      field: "ends_on",
      index,
      end: index + match[0].length,
      values: { ends_on: ends },
      key: dayKey(ends),
      words: spokenDay(ends),
    });
  }
  for (const match of text.matchAll(FOR_DURATION)) {
    const index = match.index ?? 0;
    const count = /^\d+$/.test(match[1])
      ? Number(match[1])
      : /^(?:a|an|one)$/i.test(match[1])
      ? 1
      : numberWordValue(match[1]);
    if (!count || count <= 0) continue;
    const unit = match[2].toLowerCase();
    const base = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    ));
    if (unit.startsWith("month")) {
      base.setUTCMonth(base.getUTCMonth() + count);
    } else {
      base.setUTCDate(
        base.getUTCDate() + count * (unit.startsWith("week") ? 7 : 1),
      );
    }
    const ends: StatedDay = {
      year: base.getUTCFullYear(),
      month: base.getUTCMonth() + 1,
      day: base.getUTCDate(),
      words: match[0].trim(),
    };
    push({
      field: "ends_on",
      index,
      end: index + match[0].length,
      values: { ends_on: ends },
      key: dayKey(ends),
      words: spokenDay(ends),
    });
  }
  for (
    const [field, patterns] of [
      ["ends_on", END_PATTERNS],
      ["starts_on", START_PATTERNS],
    ] as const
  ) {
    for (const pattern of patterns) {
      for (const match of text.matchAll(globalOf(pattern))) {
        const index = match.index ?? 0;
        const end = index + match[0].length;
        const window = text.slice(Math.max(0, index - 16), end + 24);
        const day = statedDay(window, patterns, now);
        if (!day) continue;
        push({
          field,
          index,
          end,
          values: field === "ends_on" ? { ends_on: day } : { starts_on: day },
          key: dayKey(day),
          words: spokenDay(day),
        });
      }
    }
  }
  for (const match of text.matchAll(globalOf(PER_BUYER))) {
    const index = match.index ?? 0;
    const value = match[1] ? Number(match[1]) : 1;
    push({
      field: "max_uses_per_buyer",
      index,
      end: index + match[0].length,
      values: { max_uses_per_buyer: value },
      key: String(value),
      words: value === 1 ? "one use per buyer" : `${value} uses per buyer`,
    });
  }
  for (const match of text.matchAll(globalOf(TOTAL_USES))) {
    const index = match.index ?? 0;
    const value = Number(match[1] ?? match[2]);
    if (!Number.isFinite(value) || value <= 0) continue;
    push({
      field: "max_total_uses",
      index,
      end: index + match[0].length,
      values: { max_total_uses: value },
      key: String(value),
      words: `a limit of ${value} uses`,
    });
  }
  const sorted = found.sort((left, right) => left.index - right.index);
  // "from 10% to 15%", "change the 10% to 15%": the first is the old value.
  for (let at = 0; at + 1 < sorted.length; at++) {
    const first = sorted[at];
    const second = sorted[at + 1];
    if (first.field !== "value" || second.field !== "value") continue;
    const between = text.slice(first.end, second.index);
    if (!/^\s*(?:to|→|->|into|up\s+to)\s*$/i.test(between)) continue;
    const lead = text.slice(Math.max(0, first.index - 40), first.index);
    if (CHANGE_LEAD.test(lead)) first.negated = true;
  }
  return sorted;
}

function amountFromMatch(
  pattern: RegExp,
  match: RegExpMatchArray,
): StatedAmount | undefined {
  if (pattern === AMOUNT_SIGN_FIRST) {
    const sign = match[1].toUpperCase();
    const currency = CURRENCY_SIGNS[match[1]] ?? CURRENCY_SIGNS[sign] ??
      (new RegExp(`^(?:${CURRENCY_CODES})$`).test(sign) ? sign : null);
    return {
      major: amountNumber(match[2], match[3], match[4]),
      currency,
      words: match[0].trim(),
    };
  }
  if (pattern === AMOUNT_WORD_AFTER) {
    const word = match[4].toLowerCase();
    return {
      major: amountNumber(match[1], match[2], match[3]),
      currency: CURRENCY_WORDS[word] ?? word.toUpperCase(),
      words: match[0].trim(),
    };
  }
  return {
    major: amountNumber(match[1], match[2], match[3]),
    currency: null,
    words: match[0].trim(),
  };
}

/** One message's statement per field for one object (latest wins). */
function resolveInMessage(
  text: string,
  mentions: readonly ValueMention[],
): {
  fields: Map<StatedField, ValueMention>;
  conflicts: Map<StatedField, [ValueMention, ValueMention]>;
} {
  const fields = new Map<StatedField, ValueMention>();
  const conflicts = new Map<StatedField, [ValueMention, ValueMention]>();
  const byField = new Map<StatedField, ValueMention[]>();
  for (const mention of mentions) {
    if (mention.negated) continue;
    byField.set(mention.field, [
      ...(byField.get(mention.field) ?? []),
      mention,
    ]);
  }
  for (const [field, list] of byField) {
    let current = list[0];
    let conflict: [ValueMention, ValueMention] | null = null;
    for (const next of list.slice(1)) {
      if (next.key === current.key) {
        current = next;
        continue;
      }
      const between = text.slice(current.end, next.index);
      const after = text.slice(next.end, next.end + 14);
      if (CORRECTION.test(between) || /^\s*instead\b/i.test(after)) {
        conflict = null;
      } else {
        conflict = [current, next];
      }
      current = next;
    }
    fields.set(field, current);
    if (conflict) conflicts.set(field, conflict);
  }
  return { fields, conflicts };
}

interface LedgerEntry {
  mention: ValueMention;
  message: number;
}
interface Ledger {
  fields: Map<StatedField, LedgerEntry>;
  conflicts: Map<StatedField, { said: [string, string]; message: number }>;
}

function ledgerFor(ledgers: Map<string, Ledger>, key: string): Ledger {
  let ledger = ledgers.get(key);
  if (!ledger) {
    ledger = { fields: new Map(), conflicts: new Map() };
    ledgers.set(key, ledger);
  }
  return ledger;
}

/** Bind each mention to the object(s) it belongs to in a message. */
function bindMentions(
  text: string,
  codes: ReadonlyArray<{ code: string; index: number }>,
  mentions: readonly ValueMention[],
  unnamedTargets: readonly string[],
): Map<string, ValueMention[]> {
  const bound = new Map<string, ValueMention[]>();
  const give = (key: string, mention: ValueMention) =>
    bound.set(key, [...(bound.get(key) ?? []), mention]);
  if (codes.length === 0) {
    for (const mention of mentions) {
      for (const key of unnamedTargets) give(key, mention);
    }
    return bound;
  }
  if (codes.length === 1) {
    for (const mention of mentions) give(codes[0].code, mention);
    return bound;
  }
  // Two or more codes: the clause a value sits in names its code.
  const breaks = [0];
  for (const match of text.matchAll(CLAUSE_BREAK)) {
    breaks.push((match.index ?? 0) + match[0].length);
  }
  breaks.push(text.length + 1);
  const clauseOf = (at: number) => {
    let clause = 0;
    for (let index = 0; index < breaks.length - 1; index += 1) {
      if (at >= breaks[index]) clause = index;
    }
    return clause;
  };
  const clauseCodes = new Map<number, string[]>();
  for (const code of codes) {
    const clause = clauseOf(code.index);
    clauseCodes.set(clause, [...(clauseCodes.get(clause) ?? []), code.code]);
  }
  const all = codes.map((code) => code.code);
  const loose: ValueMention[] = [];
  for (const mention of mentions) {
    const clause = clauseOf(mention.index);
    const own = clauseCodes.get(clause) ?? [];
    const clauseText = text.slice(
      breaks[clause],
      breaks[clause + 1] ?? text.length,
    );
    if (SHARED_WORDS.test(clauseText) && own.length !== 1) {
      for (const code of all) give(code, mention);
    } else if (own.length > 0) {
      for (const code of own) give(code, mention);
    } else {
      loose.push(mention);
    }
  }
  if (loose.length > 0) {
    const anyOwn = [...bound.keys()].length > 0;
    for (const mention of loose) {
      if (!anyOwn) {
        // "FAVY10 and GIRLS20, 10% off": the values are for every code named.
        for (const code of all) give(code, mention);
        continue;
      }
      // Otherwise the nearest clause before it that names one code, else after.
      const clause = clauseOf(mention.index);
      let target: string | null = null;
      for (let at = clause - 1; at >= 0 && !target; at -= 1) {
        const own = clauseCodes.get(at);
        if (own && own.length === 1) target = own[0];
      }
      for (let at = clause + 1; at < breaks.length && !target; at += 1) {
        const own = clauseCodes.get(at);
        if (own && own.length === 1) target = own[0];
      }
      if (target) give(target, mention);
    }
  }
  return bound;
}

/**
 * Copy stated values onto a target, one slot per field: a percent replaces
 * an amount and the reverse (rework 2, P1-18).
 */
function assignValues(target: StatedValues, values: StatedValues): void {
  for (const key of VALUE_KEYS) {
    if (values[key] === undefined) continue;
    clearField(target, fieldOfKey(key));
  }
  for (const key of VALUE_KEYS) {
    if (values[key] !== undefined) {
      (target as Record<string, unknown>)[key] = values[key];
    }
  }
}

function valuesOfLedger(
  ledger: Ledger | undefined,
): { values: StatedValues; latest: Map<StatedField, number> } {
  const values: StatedValues = {};
  const latest = new Map<StatedField, number>();
  if (!ledger) return { values, latest };
  for (const [field, entry] of ledger.fields) {
    assignValues(values, entry.mention.values);
    latest.set(field, entry.message);
  }
  return { values, latest };
}

/** Every code a message names, with where it first appears. */
function codeMentions(text: string): Array<{ code: string; index: number }> {
  const found = new Map<string, number>();
  const add = (raw: string, index: number) => {
    const code = normaliseAriDiscountCode(raw);
    if (!/^[A-Z0-9]{4,16}$/.test(code) || STOPWORDS.has(code)) return;
    // "NGN5000" is an amount, not a code.
    if (CURRENCY_AMOUNT_TOKEN.test(code)) return;
    if (!found.has(code) || (found.get(code) ?? 0) > index) {
      found.set(code, index);
    }
  };
  for (const match of text.matchAll(new RegExp(CODE_ALONE.source, "g"))) {
    add(match[1], match.index ?? 0);
  }
  if (/[a-z]/.test(text)) {
    for (const match of text.matchAll(new RegExp(CODE_CAPS.source, "g"))) {
      add(match[1], match.index ?? 0);
    }
  }
  for (const match of text.matchAll(new RegExp(QUOTED_CODE.source, "g"))) {
    add(match[1], (match.index ?? 0) + 1);
  }
  const word = CODE_WORD.exec(text);
  if (word?.[1]) add(word[1], (word.index ?? 0) + word[0].indexOf(word[1]));
  return [...found.entries()].map(([code, index]) => ({ code, index }))
    .sort((left, right) => left.index - right.index);
}

/**
 * The host's own words as whole code tokens (P3-13): "my party 10% off"
 * never contains the code PARTY10, though the letters run together.
 */
export function hostCodeTokens(ownerMessages: readonly string[]): Set<string> {
  const tokens = new Set<string>();
  for (const message of ownerMessages) {
    for (const token of message.split(/[^A-Za-z0-9-]+/)) {
      const code = normaliseAriDiscountCode(token);
      if (code) tokens.add(code);
    }
    for (
      const quoted of message.matchAll(/["“'‘]([A-Za-z0-9 -]{4,20})["”'’]/g)
    ) {
      const code = normaliseAriDiscountCode(quoted[1]);
      if (code) tokens.add(code);
    }
  }
  return tokens;
}

function fieldOfKey(key: keyof StatedValues): StatedField {
  return key === "value_bps" || key === "amount" ? "value" : key;
}

/**
 * The values a host stated, per object, newest statement winning per field
 * (I-ARI-STATED-SLOTS-PRESERVED).
 */
export function extractStatedSlots(
  ownerMessages: readonly string[],
  now: Date = new Date(),
): StatedSlots {
  const ledgers = new Map<string, Ledger>();
  let current: string[] = [];
  let primary: string | undefined;
  let multi: string[] | undefined;
  ownerMessages.forEach((message, messageIndex) => {
    const text = message.replace(/\s+/g, " ").trim();
    if (!text) return;
    const quoted = QUOTED_CODE.exec(text)?.[1];
    const caps = /[a-z]/.test(text) ? CODE_CAPS.exec(text)?.[1] : undefined;
    const code = (quoted && normaliseAriDiscountCode(quoted)) ||
      CODE_WORD.exec(text)?.[1] || CODE_ALONE.exec(text)?.[1] ||
      (caps && !STOPWORDS.has(caps) ? caps : undefined);
    if (
      code && /^[A-Z0-9-]{4,16}$/i.test(code) &&
      !CURRENCY_AMOUNT_TOKEN.test(normaliseAriDiscountCode(code))
    ) {
      primary = normaliseAriDiscountCode(code);
    }
    const codes = codeMentions(text);
    if (codes.length >= 2) {
      multi = codes.map((mention) => mention.code).slice(0, 10);
      current = multi;
    } else if (codes.length === 1) {
      // A follow-up naming one of the codes being set up changes only that
      // code; a new code starts a new single object.
      if (!multi?.includes(codes[0].code)) multi = undefined;
      current = [codes[0].code];
    }
    const mentions = valueMentions(text, now);
    const bound = bindMentions(text, codes, mentions, ["*", ...current]);
    for (const [key, list] of bound) {
      const ledger = ledgerFor(ledgers, key);
      const { fields, conflicts } = resolveInMessage(text, list);
      for (const [field, mention] of fields) {
        ledger.fields.set(field, { mention, message: messageIndex });
        ledger.conflicts.delete(field);
      }
      for (const [field, [first, second]] of conflicts) {
        ledger.conflicts.set(field, {
          said: [first.words, second.words],
          message: messageIndex,
        });
      }
    }
  });
  const slots: StatedSlots = {};
  if (primary) slots.code = primary;
  const last = ownerMessages.length - 1;
  const conflicts: StatedConflict[] = [];
  const latestFields: Record<string, StatedField[]> = {};
  const collectConflicts = (
    ledger: Ledger | undefined,
    code: string | null,
    floor: Map<StatedField, number>,
  ) => {
    for (const [field, conflict] of ledger?.conflicts ?? []) {
      if (conflict.message >= (floor.get(field) ?? -1)) {
        conflicts.push({ code, field, said: conflict.said });
      }
    }
  };
  if (multi && multi.length >= 2) {
    slots.codes = multi;
    const top = valuesOfLedger(ledgers.get("*"));
    assignValues(slots, top.values);
    slots.per_code = {};
    for (const name of multi) {
      const own = valuesOfLedger(ledgers.get(name));
      slots.per_code[name] = own.values;
      latestFields[name] = [...own.latest].filter(([, at]) => at === last)
        .map(([field]) => field);
      collectConflicts(ledgers.get(name), name, own.latest);
    }
    latestFields["*"] = [...top.latest].filter(([, at]) => at === last)
      .map(([field]) => field);
  } else {
    // One object: the unnamed words and the code's own, newest per field.
    const top = valuesOfLedger(ledgers.get("*"));
    const named = current[0] ? valuesOfLedger(ledgers.get(current[0])) : null;
    const merged: StatedValues = {};
    const latest = new Map<StatedField, number>();
    const fields = new Set<StatedField>([
      ...top.latest.keys(),
      ...(named?.latest.keys() ?? []),
    ]);
    for (const field of fields) {
      const fromTop = top.latest.get(field) ?? -1;
      const fromNamed = named?.latest.get(field) ?? -1;
      const source = fromNamed >= fromTop && named ? named.values : top.values;
      for (const key of VALUE_KEYS) {
        if (fieldOfKey(key) === field && source[key] !== undefined) {
          (merged as Record<string, unknown>)[key] = source[key];
        }
      }
      latest.set(field, Math.max(fromTop, fromNamed));
    }
    assignValues(slots, merged);
    latestFields["*"] = [...latest].filter(([, at]) => at === last)
      .map(([field]) => field);
    collectConflicts(ledgers.get("*"), null, latest);
    if (current[0]) collectConflicts(ledgers.get(current[0]), null, latest);
  }
  if (conflicts.length > 0) slots.conflicts = conflicts;
  slots.latest_fields = latestFields;
  return slots;
}

/**
 * #3355 Wave E (E1) — the intent read's stated values, as the model read
 * them. Shape mirrors `AriStatedValues` in ariIntentRead.ts (kept structural
 * here so this guard has no dependency on the read). Rework 2: `per_code`
 * carries each code's own values when the host named several.
 */
export interface ModelStatedValues {
  code?: string;
  title?: string;
  percent_off?: number;
  amount_off?: number;
  ends_on?: string;
  starts_on?: string;
  max_total_uses?: number;
  max_uses_per_buyer?: number;
  per_code?: ReadonlyArray<ModelCodeValues>;
}

export interface ModelCodeValues {
  code: string;
  percent_off?: number;
  amount_off?: number;
  ends_on?: string;
  starts_on?: string;
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
  if (
    new RegExp(`(?:^|[^0-9.])${String(value).replace(".", "\\.")}(?![0-9])`)
      .test(words)
  ) return true;
  for (
    const match of words.matchAll(new RegExp(`\\b${NUMBER_WORD}\\b`, "gi"))
  ) {
    if (numberWordValue(match[0]) === value) return true;
  }
  return false;
}

function hasPercentWords(words: string): boolean {
  return /%|percent|per\s?cent|\bpc\b|\bpct\b|\bhalf\b|\bquarter\b|\bthird\b/i
    .test(words);
}

/**
 * A model value, kept only when the host's own words carry it: its number
 * (or day) in `words`, and what makes it a percent, an amount off or a
 * per-buyer limit anywhere in `context`.
 */
function groundedModelValues(
  model: ModelCodeValues | ModelStatedValues,
  words: string,
  context: string = words,
): Array<
  { field: StatedField; values: StatedValues; key: string; said: string }
> {
  const lower = context.toLowerCase();
  const out: Array<
    { field: StatedField; values: StatedValues; key: string; said: string }
  > = [];
  const fraction: Record<number, RegExp> = {
    50: /\bhalf\b/i,
    25: /\bquarter\b/i,
  };
  if (
    typeof model.percent_off === "number" && model.percent_off > 0 &&
    model.percent_off <= 100 && hasPercentWords(context) &&
    (wordsHaveNumber(words, model.percent_off) ||
      (fraction[model.percent_off]?.test(words) ?? false))
  ) {
    const bps = Math.round(model.percent_off * 100);
    out.push({
      field: "value",
      values: { value_bps: bps },
      key: percentKey(bps),
      said: `${model.percent_off}% off`,
    });
  } else if (
    typeof model.amount_off === "number" && model.amount_off > 0 &&
    /\boff\b|\bdiscount\b/i.test(context) &&
    (wordsHaveNumber(words, model.amount_off) ||
      (model.amount_off % 1000 === 0 &&
        new RegExp(`\\b${model.amount_off / 1000}\\s?k\\b`, "i").test(words)))
  ) {
    const amount: StatedAmount = {
      major: model.amount_off,
      currency: null,
      words: `${model.amount_off} off`,
    };
    out.push({
      field: "value",
      values: { amount },
      key: `a:${model.amount_off}:`,
      said: amount.words,
    });
  }
  for (const field of ["ends_on", "starts_on"] as const) {
    const raw = model[field];
    if (typeof raw !== "string") continue;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!match) continue;
    const [year, month, day] = [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    ];
    const monthName = MONTH_NAMES[month - 1] ?? "";
    const named = monthName && lower.includes(monthName.slice(0, 3));
    const numeric = new RegExp(`\\b0?${day}[/.-]0?${month}\\b`).test(words);
    if (
      validDay(year, month, day) && wordsHaveNumber(words, day) &&
      (named || numeric)
    ) {
      const stated: StatedDay = { year, month, day, words: raw };
      out.push({
        field,
        values: field === "ends_on"
          ? { ends_on: stated }
          : { starts_on: stated },
        key: dayKey(stated),
        said: spokenDay(stated),
      });
    }
  }
  if (
    typeof model.max_total_uses === "number" &&
    Number.isInteger(model.max_total_uses) && model.max_total_uses > 0 &&
    wordsHaveNumber(words, model.max_total_uses)
  ) {
    out.push({
      field: "max_total_uses",
      values: { max_total_uses: model.max_total_uses },
      key: String(model.max_total_uses),
      said: `a limit of ${model.max_total_uses} uses`,
    });
  }
  if (
    typeof model.max_uses_per_buyer === "number" &&
    Number.isInteger(model.max_uses_per_buyer) &&
    model.max_uses_per_buyer > 0 &&
    (wordsHaveNumber(words, model.max_uses_per_buyer) ||
      (model.max_uses_per_buyer === 1 && /\b(?:once|one)\b/i.test(words))) &&
    /\bper\s+(?:person|buyer|customer)\b/i.test(context)
  ) {
    out.push({
      field: "max_uses_per_buyer",
      values: { max_uses_per_buyer: model.max_uses_per_buyer },
      key: String(model.max_uses_per_buyer),
      said: model.max_uses_per_buyer === 1
        ? "one use per buyer"
        : `${model.max_uses_per_buyer} uses per buyer`,
    });
  }
  return out;
}

function keyOfValues(field: StatedField, values: StatedValues): string | null {
  switch (field) {
    case "value":
      if (values.value_bps !== undefined) return percentKey(values.value_bps);
      // Amounts compare by size: the currency is checked against the brand's.
      if (values.amount) return `a:${values.amount.major}`;
      return null;
    case "ends_on":
      return values.ends_on
        ? dayKey({ ...values.ends_on, has_time: undefined, alt: undefined })
        : null;
    case "starts_on":
      return values.starts_on
        ? dayKey({ ...values.starts_on, has_time: undefined, alt: undefined })
        : null;
    case "max_total_uses":
      return values.max_total_uses !== undefined
        ? String(values.max_total_uses)
        : null;
    case "max_uses_per_buyer":
      return values.max_uses_per_buyer !== undefined
        ? String(values.max_uses_per_buyer)
        : null;
    default: {
      const never: never = field;
      return never;
    }
  }
}

function saidOfValues(field: StatedField, values: StatedValues): string {
  switch (field) {
    case "value":
      return values.value_bps !== undefined
        ? `${values.value_bps / 100}% off`
        : values.amount?.words ?? "an amount off";
    case "ends_on":
      return values.ends_on ? spokenDay(values.ends_on) : "an end day";
    case "starts_on":
      return values.starts_on ? spokenDay(values.starts_on) : "a start day";
    case "max_total_uses":
      return `a limit of ${values.max_total_uses} uses`;
    case "max_uses_per_buyer":
      return values.max_uses_per_buyer === 1
        ? "one use per buyer"
        : `${values.max_uses_per_buyer} uses per buyer`;
    default: {
      const never: never = field;
      return never;
    }
  }
}

function clearField(target: StatedValues, field: StatedField): void {
  for (const key of VALUE_KEYS) {
    if (fieldOfKey(key) === field) delete target[key];
  }
}

/**
 * #3355 rework 2 — the intent read's stated values are the primary source
 * and the deterministic read is the cross-check. The model reads the host's
 * newest message, so for one object and field:
 *   - the deterministic read has nothing, or only an older message's value:
 *     the model's value wins (the latest statement);
 *   - both read the newest message and disagree: a conflict, Ari asks.
 * A model value the host's own words do not carry is dropped, so nothing
 * invented reaches a card or a question. Values stay bound to their code.
 */
export function mergeModelStatedSlots(
  base: StatedSlots,
  model: ModelStatedValues | null | undefined,
  ownerMessages: readonly string[],
): StatedSlots {
  if (!model) return base;
  const lastWords = ownerMessages.at(-1) ?? "";
  const allWords = ownerMessages.join("\n");
  const out: StatedSlots = {
    ...base,
    ...(base.per_code
      ? {
        per_code: Object.fromEntries(
          Object.entries(base.per_code).map((
            [code, values],
          ) => [code, { ...values }]),
        ),
      }
      : {}),
    ...(base.conflicts ? { conflicts: [...base.conflicts] } : {}),
  };
  const tokens = hostCodeTokens(ownerMessages);
  if (!out.code && typeof model.code === "string") {
    const code = normaliseAriDiscountCode(model.code);
    if (code && /^[A-Z0-9-]{4,16}$/.test(code) && tokens.has(code)) {
      out.code = code;
    }
  }
  const apply = (
    target: StatedValues,
    latest: readonly StatedField[],
    values: ModelCodeValues | ModelStatedValues,
    code: string | null,
  ) => {
    // Grounded in the newest message first; a value the deterministic read
    // has not heard at all may be grounded anywhere in the window.
    const fresh = groundedModelValues(values, lastWords, allWords);
    const anywhere = groundedModelValues(values, allWords);
    for (const read of anywhere) {
      const inLast = fresh.some((item) => item.field === read.field);
      const known = keyOfValues(read.field, target);
      if (known === null) {
        assignValues(target, read.values);
        continue;
      }
      if (!inLast) continue;
      if (!latest.includes(read.field)) {
        // The deterministic value is from an older message: the newest wins.
        clearField(target, read.field);
        assignValues(target, read.values);
        continue;
      }
      const said = keyOfValues(read.field, read.values) ?? "";
      if (said.split("@")[0] !== known.split("@")[0]) {
        out.conflicts = [
          ...(out.conflicts ?? []),
          {
            code,
            field: read.field,
            said: [saidOfValues(read.field, target), read.said],
          },
        ];
      }
    }
  };
  if (Array.isArray(model.per_code) && model.per_code.length > 0) {
    for (const item of model.per_code) {
      const code = normaliseAriDiscountCode(item?.code);
      if (!code || !tokens.has(code)) continue;
      if (out.per_code) {
        const own = out.per_code[code] ?? {};
        out.per_code[code] = own;
        apply(own, out.latest_fields?.[code] ?? [], item, code);
      } else if (!out.code || out.code === code) {
        apply(out, out.latest_fields?.["*"] ?? [], item, null);
      }
    }
  }
  const flatCode = typeof model.code === "string"
    ? normaliseAriDiscountCode(model.code)
    : "";
  if (out.per_code && flatCode && out.per_code[flatCode]) {
    apply(
      out.per_code[flatCode],
      out.latest_fields?.[flatCode] ?? [],
      model,
      flatCode,
    );
  } else if (!out.per_code) {
    apply(out, out.latest_fields?.["*"] ?? [], model, null);
  }
  // With several codes and no code on the model's flat values, they belong
  // to no one code: they are never spread onto every code.
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

/** The first instant of the stated day in the brand's time zone, as UTC ISO. */
export function startOfLocalDayIso(
  day: { year: number; month: number; day: number },
  timezone: string,
): string | null {
  const local = `${day.year}-${String(day.month).padStart(2, "0")}-${
    String(day.day).padStart(2, "0")
  }`;
  for (const time of ["00:00", "01:00"]) {
    const first = localDateTimeToInstants(local, time, timezone)[0];
    if (first) return first.toISOString().replace(".000Z", "Z");
  }
  return null;
}

function isoDay(day: { year: number; month: number; day: number }): string {
  return `${day.year}-${String(day.month).padStart(2, "0")}-${
    String(day.day).padStart(2, "0")
  }`;
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
 * A numeric day read both ways round (12/1/2026): the brand's country picks
 * the reading; with no country, null (Ari asks which day).
 */
function resolveDay(
  day: StatedDay,
  country: string | null | undefined,
): StatedDay | null {
  if (!day.alt) return day;
  const code = typeof country === "string" ? country.trim().toUpperCase() : "";
  if (!code) return null;
  return MONTH_FIRST_COUNTRIES.has(code)
    ? { ...day, month: day.alt.month, day: day.alt.day, alt: undefined }
    : { ...day, alt: undefined };
}

function eitherDay(day: StatedDay): string {
  const first = spokenDay(day);
  const second = day.alt
    ? spokenDay({ year: day.year, month: day.alt.month, day: day.alt.day })
    : first;
  return `${first} or ${second}`;
}

function spokenAmount(amount: StatedAmount, currency: string | null): string {
  const code = amount.currency ?? currency;
  const text = code
    ? formatMinor(minorFromMajor(amount.major, code), code)
    : null;
  return `${text ?? String(amount.major)} off`;
}

/** The proposal's own discount value in plain words ("NGN 1,000.00 off"). */
function proposedValueWords(
  out: Record<string, unknown>,
  currency: string | null | undefined,
): string | null {
  if (
    out.value_type === "percent" ||
    (out.value_type === undefined && out.value_bps !== undefined)
  ) {
    const bps = Number(out.value_bps);
    return Number.isFinite(bps) && bps > 0 ? `${bps / 100}% off` : null;
  }
  if (out.value_type === "amount") {
    const minor = Number(out.value_minor);
    const code = typeof currency === "string"
      ? currency.trim().toUpperCase()
      : "";
    if (!Number.isFinite(minor) || minor <= 0 || !code) return null;
    const text = formatMinor(minor, code);
    return text ? `${text} off` : null;
  }
  return null;
}

/**
 * Compare what the host stated with a proposal's args, for every field the
 * tool's schema has. A stated end (or start) day the args lack is bound
 * exactly once the brand's time zone is known (the confirmation card shows
 * it); any other stated value that is missing or different is asked about
 * instead of proposed, so it is never dropped or changed.
 */
export function checkStatedSlots(args: {
  toolName: string;
  toolArgs: Record<string, unknown>;
  schemaKeys: ReadonlySet<string>;
  stated: StatedSlots;
  timezone: string | null;
  /** #3355 rework 1: the brand's country (numeric day order). */
  country?: string | null;
  /** #3355 rework 1: the brand's currency (amounts off). */
  currency?: string | null;
  now?: Date;
}): StatedSlotCheck {
  const { schemaKeys } = args;
  const out: Record<string, unknown> = { ...args.toolArgs };
  const now = args.now ?? new Date();
  const bound: string[] = [];
  const asks: string[] = [];
  const missing: string[] = [];
  const proposedCode = normaliseAriDiscountCode(out.code);
  // P2-9: a code with its own values in the host's words uses those.
  const stated: StatedSlots = { ...args.stated };
  const own = args.stated.per_code?.[proposedCode];
  if (own) assignValues(stated, own);

  // #3355 rework 2: the host said two things for one field (or the intent
  // read and the words disagree): one question naming both, nothing proposed.
  const fieldInSchema = (field: StatedField) =>
    field === "value"
      ? schemaKeys.has("value_bps") || schemaKeys.has("value_minor")
      : field === "ends_on"
      ? schemaKeys.has("ends_at")
      : field === "starts_on"
      ? schemaKeys.has("starts_at")
      : schemaKeys.has(field);
  const conflict = (args.stated.conflicts ?? []).find((item) =>
    (item.code === null || item.code === proposedCode) &&
    fieldInSchema(item.field)
  );
  if (conflict) {
    const subject = conflict.code ? ` up ${conflict.code}` : " this up";
    return {
      kind: "ask",
      missing: [conflict.field],
      text: `Before I set${subject}: you said ${conflict.said[0]} and ${
        conflict.said[1]
      }. Which one should go on it? Tell me and I'll prepare it for you to approve. Nothing has been saved yet.`,
    };
  }
  /** What the proposal had instead, in plain words, for the question. */
  const had: string[] = [];

  if (
    stated.codes && stated.codes.length >= 2 && schemaKeys.has("code") &&
    out.kind !== "automatic"
  ) {
    if (!stated.codes.includes(proposedCode)) {
      missing.push("code");
      asks.push(`one of the codes ${stated.codes.join(", ")}`);
    }
  } else if (
    stated.code && schemaKeys.has("code") && out.kind !== "automatic"
  ) {
    if (proposedCode !== stated.code) {
      missing.push("code");
      asks.push(`the code ${stated.code}`);
    }
  }
  // P1-3: a stated percent is a percent of exactly that size.
  if (stated.value_bps !== undefined && schemaKeys.has("value_bps")) {
    const wrongKind = schemaKeys.has("value_type") &&
      out.value_type !== undefined && out.value_type !== "percent";
    if (wrongKind || Number(out.value_bps) !== stated.value_bps) {
      missing.push("value_bps");
      asks.push(`${stated.value_bps / 100}% off`);
      const proposedHad = proposedValueWords(out, args.currency);
      if (proposedHad) had.push(proposedHad);
    }
  }
  // P1-3: a stated amount off is a fixed amount of exactly that size, in
  // the currency's own minor units (₦5,000 is 500000 kobo).
  if (stated.amount && schemaKeys.has("value_minor")) {
    const brandCurrency = typeof args.currency === "string"
      ? args.currency.trim().toUpperCase()
      : null;
    let currency = stated.amount.currency;
    if (
      currency === "USD" && brandCurrency &&
      DOLLAR_CURRENCIES.has(brandCurrency)
    ) {
      currency = brandCurrency;
    }
    currency = currency ?? brandCurrency;
    const wrongKind = schemaKeys.has("value_type") &&
      out.value_type !== "amount";
    if (
      !currency || (brandCurrency && currency !== brandCurrency) || wrongKind ||
      Number(out.value_minor) !== minorFromMajor(stated.amount.major, currency)
    ) {
      missing.push("value_minor");
      asks.push(spokenAmount(stated.amount, currency));
      const proposedHad = proposedValueWords(out, args.currency);
      if (proposedHad) had.push(proposedHad);
    }
  }
  if (stated.starts_on && schemaKeys.has("starts_at")) {
    const day = resolveDay(stated.starts_on, args.country);
    if (!day) {
      missing.push("starts_at");
      asks.push(
        `a start on ${eitherDay(stated.starts_on)} (which day did you mean?)`,
      );
    } else if (!args.timezone) {
      missing.push("starts_at");
      asks.push(`a start on ${spokenDay(day)} (which time zone is that in?)`);
    } else {
      const iso = startOfLocalDayIso(day, args.timezone);
      const wanted = isoDay(day);
      if (
        out.starts_at === undefined || out.starts_at === null ||
        out.starts_at === ""
      ) {
        if (iso && Date.parse(iso) > now.getTime()) {
          out.starts_at = iso;
          bound.push("starts_at");
        } else if (
          !iso || localDayOf(now.toISOString(), args.timezone) !== wanted
        ) {
          // A start already behind us is not what the host meant: ask.
          missing.push("starts_at");
          asks.push(`a start on ${spokenDay(day)}`);
        }
        // A start of today with no time is "from now": nothing to bind.
      } else if (localDayOf(out.starts_at, args.timezone) !== wanted) {
        const proposedAt = Date.parse(String(out.starts_at));
        if (
          iso && Number.isFinite(proposedAt) &&
          Math.abs(proposedAt - Date.parse(iso)) <= ZONE_OFFSET_SLACK_MS
        ) {
          out.starts_at = iso;
          bound.push("starts_at");
        } else {
          missing.push("starts_at");
          asks.push(`a start on ${spokenDay(day)}`);
        }
      }
    }
  }
  if (stated.ends_on && schemaKeys.has("ends_at")) {
    const day = resolveDay(stated.ends_on, args.country);
    if (!day) {
      missing.push("ends_at");
      asks.push(
        `an end on ${eitherDay(stated.ends_on)} (which day did you mean?)`,
      );
    } else if (!args.timezone) {
      missing.push("ends_at");
      asks.push(
        `an end on ${spokenDay(day)} (which time zone is that in?)`,
      );
    } else {
      const wanted = isoDay(day);
      const iso = endOfLocalDayIso(day, args.timezone);
      if (
        out.ends_at === undefined || out.ends_at === null || out.ends_at === ""
      ) {
        if (iso) {
          out.ends_at = iso;
          bound.push("ends_at");
        } else {
          missing.push("ends_at");
          asks.push(`an end on ${spokenDay(day)}`);
        }
      } else if (localDayOf(out.ends_at, args.timezone) !== wanted) {
        // #3355 Wave F (live eval): Flash writes the stated day's end in UTC
        // ("2026-12-19T23:59:59Z"), which is already 20 December in Lagos. A
        // value within a time-zone offset of the stated day's local end is
        // that day, so it is bound exactly; a different day is still asked.
        const proposedAt = Date.parse(String(out.ends_at));
        if (
          iso && Number.isFinite(proposedAt) &&
          Math.abs(proposedAt - Date.parse(iso)) <= ZONE_OFFSET_SLACK_MS
        ) {
          out.ends_at = iso;
          bound.push("ends_at");
        } else {
          missing.push("ends_at");
          asks.push(`an end on ${spokenDay(day)}`);
        }
      } else if (iso && out.ends_at !== iso) {
        // P2-8: "until / through / till / by 19 December" includes the whole
        // day, so an instant earlier that day (often its midnight) is bound
        // to 23:59:59 local. A time the host named stays theirs.
        const proposedAt = Date.parse(String(out.ends_at));
        if (!day.has_time && proposedAt !== Date.parse(iso)) {
          out.ends_at = iso;
          bound.push("ends_at");
        } else if (proposedAt === Date.parse(iso)) {
          // The same instant written with an offset: one canonical UTC form.
          out.ends_at = iso;
        }
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
    const subject = proposedCode && own ? ` ${proposedCode}` : "";
    return {
      kind: "ask",
      missing,
      text: `Before I set${
        subject ? ` up${subject}` : " this up"
      }: you asked for ${list}${
        had.length > 0 ? `, but I had ${had.join(" and ")}` : ""
      }, and I want to make sure that's exactly what goes on it. Is that right? Say yes and I'll prepare it with ${
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
  // #3355 Wave F (live eval): Flash proposed "VIP10, 10% off" for a host who
  // had named no code at all. A code is the host's to choose: one the
  // host's words never contain is asked for, never proposed.
  // MINGLA-INVARIANT: I-ARI-NO-INVENTED-CODE | issue #3355 | A create_discount proposal whose code does not appear in the host's own recent words is replaced by a question asking for the code.
  if (
    args.toolName === "create_discount" && args.toolArgs.kind !== "automatic"
  ) {
    const proposed = normaliseAriDiscountCode(args.toolArgs.code);
    // #3355 rework 1 (P3-13): whole tokens of the host's words, so "my party
    // 10% off" never contains PARTY10.
    const words = hostCodeTokens(args.ownerMessages);
    if (proposed && !words.has(proposed)) {
      return {
        kind: "ask",
        missing: ["code"],
        text:
          "Before I set this up: what code should people type at checkout? For example FAVY10. Tell me the code and how much off, and I'll prepare it for you to approve. Nothing has been saved yet.",
      };
    }
  }
  const perCode = Object.values(stated.per_code ?? {});
  const anyStated = (key: keyof StatedValues) =>
    stated[key] !== undefined || perCode.some((own) => own[key] !== undefined);
  const relevant = (stated.code && schemaKeys.has("code")) ||
    (stated.codes && schemaKeys.has("code")) ||
    (anyStated("value_bps") && schemaKeys.has("value_bps")) ||
    (anyStated("amount") && schemaKeys.has("value_minor")) ||
    (anyStated("ends_on") && schemaKeys.has("ends_at")) ||
    (anyStated("starts_on") && schemaKeys.has("starts_at")) ||
    (anyStated("max_total_uses") && schemaKeys.has("max_total_uses")) ||
    (anyStated("max_uses_per_buyer") && schemaKeys.has("max_uses_per_buyer"));
  if (!relevant) return { kind: "ok", args: args.toolArgs, bound: [] };
  let timezone: string | null = null;
  let country: string | null = null;
  let currency: string | null = null;
  const needsBrand = (anyStated("ends_on") && schemaKeys.has("ends_at")) ||
    (anyStated("starts_on") && schemaKeys.has("starts_at")) ||
    (anyStated("amount") && schemaKeys.has("value_minor"));
  if (needsBrand) {
    const brandId = args.toolArgs.brand_id;
    if (typeof brandId === "string" && UUID_ARG.test(brandId)) {
      const { data } = await args.userClient.from("brands")
        .select("default_timezone,country_code,default_currency")
        .eq("id", brandId)
        .maybeSingle();
      const brand = (data ?? null) as
        | {
          default_timezone?: unknown;
          country_code?: unknown;
          default_currency?: unknown;
        }
        | null;
      timezone = isValidIanaTimezone(brand?.default_timezone)
        ? String(brand?.default_timezone)
        : marketDefaultTimezone(brand?.country_code);
      country = typeof brand?.country_code === "string"
        ? brand.country_code
        : null;
      currency = typeof brand?.default_currency === "string"
        ? brand.default_currency
        : null;
    }
  }
  return checkStatedSlots({
    toolName: args.toolName,
    toolArgs: args.toolArgs,
    schemaKeys,
    stated,
    timezone,
    country,
    currency,
    now: args.now,
  });
}

/**
 * #3355 Wave F (live eval): "I am about to propose two discount codes … I
 * will start with GIRLSTRIPLAGOS" — a reply that announces a write and then
 * makes none. The loop sends it back once to make the proposal as a call.
 * MINGLA-INVARIANT: I-ARI-ANNOUNCED-WRITE-IS-MADE | issue #3355 | A final reply that announces Ari is about to propose or create something, with no proposal in the turn, is returned to the model once to make the proposal as a tool call.
 */
const ANNOUNCED_WRITE =
  /\bI(?:['’]m| am)\s+(?:about to|going to)\s+(?:propose|create|set up|prepare|draft)\b|\bI(?:['’]ll| will)\s+(?:now\s+|go ahead and\s+)?(?:propose|create|set up|prepare|draft)\b(?![^.?!]*\?)|\bI(?:['’]ll| will)\s+start with\b|\blet me (?:propose|create)\b/i;

export function announcesWriteWithoutCall(text: string): boolean {
  return ANNOUNCED_WRITE.test(String(text ?? ""));
}
