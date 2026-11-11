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
 * MINGLA-INVARIANT: I-ARI-CLAIM-MATCHES-RECEIPT | issue #3355 | Reply text that claims a past write, in the active voice ("I've created") or the passive / outcome voice ("has been created", "was sent", "is now live"), must be backed by evidence that matches the claim's verb (tool family), its object (event, discount, message …) and every code or name it states: "proposed" by a live or executed proposal, "created / saved / sent / published …" only by an executed receipt; a negation or condition excuses only its own clause, and a proposal whose card was cancelled, expired or failed backs nothing. Otherwise the server rewrites the reply to the true state before it is stored or shown, on the agent-loop and the single-call path alike (enforced by supabase/functions/_shared/__tests__/issue_3355_wave_a_truth_guards.implementor.test.ts and issue_3355_rework_1.implementor.test.ts).
 * MINGLA-INVARIANT: I-ARI-STATED-SLOTS-PRESERVED | issue #3355 | Codes, percentages, fixed amounts off (in the currency's minor units), start and end dates and use limits the host stated (last 6 owner messages since the previous proposal of the same tool; each code its own values when one message gives several) are compared with the proposal args for every tool whose schema has that field, on both agent paths: a percent must be a percent of that size and an amount an amount of that size; a stated end day is bound to 23:59:59 local ("until / through / till / by" include the day) and a future start day to 00:00 local; anything else missing or different makes Ari ask instead of proposing (same test files).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  isValidIanaTimezone,
  localDateTimeToInstants,
} from "./agentRelativeTime.ts";
import { normaliseAriDiscountCode } from "./ariDiscountArgs.ts";
import { marketDefaultTimezone } from "./payoutCountries.ts";
import { formatMinor, minorFromMajor } from "./money/formatMinor.ts";

// ── I-ARI-CLAIM-MATCHES-RECEIPT ─────────────────────────────────────────────
//
// #3355 rework 1 (tester P1-2): a claim is found clause by clause, in the
// active voice ("I've created …") and the passive / outcome voice ("… has
// been created", "… was sent", "… is now live"). A negation or a condition
// excuses only its own clause. "Proposed" may be backed by a live proposal;
// "created / saved / sent / published …" only by an executed receipt. The
// backing evidence must match the claim's verb (tool family), its object
// (event, discount, message …) and every code or name it states.

const WRITE_VERBS =
  "proposed|prepared|drafted|created|saved|sent|published|updated|changed|deleted|removed|cancell?ed|canceled|made|added|set\\s+up|scheduled|issued|refunded|posted|applied|activated|launched";
const ACTIVE_CLAIM = new RegExp(
  `\\b(?:i|we|ari)(?:['’](?:ve|d))?(?:\\s+(?:have|had|just|already|also|now|successfully|then|gone\\s+ahead\\s+and|went\\s+ahead\\s+and))*\\s+(${WRITE_VERBS})\\b`,
  "gi",
);
const PASSIVE_CLAIM = new RegExp(
  `\\b(?:has|have|had|['’]s|is|are|was|were)(?:\\s+(?:now|just|already|successfully|also|all))*\\s+been(?:\\s+(?:now|just|already|successfully))*\\s+(${WRITE_VERBS})\\b|\\b(?:was|were)(?:\\s+(?:just|already|successfully|also|all))*\\s+(${WRITE_VERBS})\\b|\\b(?:is|are)\\s+now\\s+(live|active|published|scheduled)\\b`,
  "gi",
);
/** A negation inside the claim's own clause (before its verb). */
const CLAUSE_NEGATION =
  /\b(?:not|never|no|nothing|none|neither|nor|nobody|yet\s+to)\b|n['’]t\b/i;
/** A condition or hypothetical inside the claim's own clause. */
const CLAUSE_CONDITION =
  /\b(?:if|once|until|unless|whether|when|whenever|after\s+you|before\s+you|as\s+soon\s+as|would|will|could|should|can|may|might)\b/i;
/** Where a clause starts (the claim's subject never crosses one). */
const CLAUSE_BOUNDARY =
  /[,;:()—–]|\b(?:so|but|and|then|because|though|although|while|which|whereas)\b/gi;

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

type ClaimStrength = "proposed" | "done";
type ToolFamily =
  | "create"
  | "update"
  | "publish"
  | "send"
  | "delete"
  | "cancel"
  | "refund"
  | "schedule";

/** Which tool families back a claimed verb (null = any family). */
function familiesForVerb(verb: string): ToolFamily[] | null {
  const word = verb.toLowerCase().replace(/\s+/g, " ");
  switch (word) {
    case "created":
    case "issued":
    case "launched":
      return ["create"];
    case "made":
    case "set up":
    case "added":
    case "applied":
    case "activated":
      return ["create", "update"];
    case "updated":
    case "changed":
      return ["update"];
    case "sent":
    case "posted":
      return ["send", "publish"];
    case "published":
    case "live":
    case "active":
      return ["publish", "create", "update"];
    case "deleted":
    case "removed":
      return ["delete", "update"];
    case "cancelled":
    case "canceled":
      return ["cancel", "delete"];
    case "scheduled":
      return ["schedule", "send", "create", "publish"];
    case "refunded":
      return ["refund", "cancel"];
    default:
      return null;
  }
}

const TOOL_FAMILY_PREFIXES: ReadonlyArray<[RegExp, ToolFamily]> = [
  [
    /^(?:create|add|duplicate|issue|upsert|import|invite|start|open)_/,
    "create",
  ],
  [/^(?:publish|unpublish|go_live|launch)_/, "publish"],
  [/^(?:send|post|tell|notify|message|reply|announce|broadcast)_/, "send"],
  [/^(?:delete|remove|archive|end|unlist)_/, "delete"],
  [/^(?:cancel|void)_/, "cancel"],
  [/^(?:refund)_/, "refund"],
  [/^(?:schedule|reschedule)_/, "schedule"],
  [
    /^(?:update|edit|set|change|rename|pause|resume|move|assign|attach|enable|disable|toggle|bind|save|remember|draft)_/,
    "update",
  ],
];

function toolFamily(toolName: string): ToolFamily | null {
  for (const [pattern, family] of TOOL_FAMILY_PREFIXES) {
    if (pattern.test(toolName)) return family;
  }
  return null;
}

/** Object words a claim can name, and the tool-name parts that serve them. */
const CLAIM_OBJECTS: ReadonlyArray<[RegExp, RegExp]> = [
  [
    /\b(?:discounts?|codes?|promo(?:\s+codes?)?|coupons?|vouchers?|sale\s+prices?)\b/i,
    /discount/,
  ],
  [/\bevents?\b/i, /event/],
  [/\btrips?\b/i, /trip/],
  [/\bexperiences?\b/i, /experience/],
  [/\bstays?\b/i, /stay/],
  [/\b(?:tickets?|ticket\s+types?|tiers?)\b/i, /ticket|tier/],
  [
    /\b(?:messages?|emails?|announcements?|broadcasts?|blasts?|campaigns?|newsletters?)\b/i,
    /message|email|announce|broadcast|blast|campaign|tell|notify/,
  ],
  [/\b(?:invites?|invitations?)\b/i, /invite|team/],
  [/\bpayouts?\b/i, /payout/],
  [/\brefunds?\b/i, /refund/],
  [/\b(?:website|site|page)\b/i, /site|page/],
  [/\b(?:posts?)\b/i, /post|social/],
  [/\bnotes?\b/i, /note|remember/],
];

interface WriteClaim {
  sentence: string;
  strength: ClaimStrength;
  families: ToolFamily[] | null;
  objects: RegExp[];
  named: string[];
}

/** Sentences of a reply (keeps their own punctuation). */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z“"'])|\n+/).filter((part) =>
    part.trim().length > 0
  );
}

/** The text of the clause a match sits in, from its start to the match end. */
function clauseBefore(sentence: string, index: number, end: number): string {
  let start = 0;
  for (const boundary of sentence.matchAll(CLAUSE_BOUNDARY)) {
    const at = boundary.index ?? 0;
    if (at >= index) break;
    start = at + boundary[0].length;
  }
  return sentence.slice(start, end);
}

/** The words a clause's claim is about: its direct object or its subject. */
function claimObjectWords(
  sentence: string,
  index: number,
  end: number,
  passive: boolean,
): string {
  if (passive) return clauseBefore(sentence, index, index);
  const after = sentence.slice(end);
  const stop = after.search(
    /[,;:.!?()—–]|\b(?:for|on|to|at|in|with|from|by|until|till|so|and|but|which|that)\b/i,
  );
  return stop === -1 ? after : after.slice(0, stop);
}

function claimFor(
  sentence: string,
  match: RegExpMatchArray,
  passive: boolean,
): WriteClaim | null {
  const index = match.index ?? 0;
  const end = index + match[0].length;
  const clause = clauseBefore(sentence, index, end);
  if (CLAUSE_NEGATION.test(clause) || CLAUSE_CONDITION.test(clause)) {
    return null;
  }
  const verb = (match[1] ?? match[2] ?? match[3] ?? "").toLowerCase()
    .replace(/\s+/g, " ");
  const strength: ClaimStrength = /^(?:proposed|prepared|drafted)$/.test(verb)
    ? "proposed"
    : "done";
  let families = familiesForVerb(verb);
  const objectWords = claimObjectWords(sentence, index, end, passive);
  if (strength === "proposed") {
    // "I proposed creating / publishing …": the gerund names the family.
    const gerund = /^\s*(?:to\s+)?(\w+?)(?:ing)?\b/i.exec(
      sentence.slice(end),
    )?.[1];
    const fromGerund = gerund ? familiesForVerb(`${gerund}ed`) : null;
    families = fromGerund ?? null;
  }
  const objects = CLAIM_OBJECTS.filter(([words]) => words.test(objectWords))
    .map(([, tools]) => tools);
  return {
    sentence,
    strength,
    families,
    objects,
    named: namedThings(sentence),
  };
}

/** The write claims a sentence makes (empty when it makes none). */
export function writeClaimsIn(sentence: string): WriteClaim[] {
  if (/\?\s*$/.test(sentence.trim())) return [];
  const claims: WriteClaim[] = [];
  for (const match of sentence.matchAll(ACTIVE_CLAIM)) {
    const claim = claimFor(sentence, match, false);
    if (claim) claims.push(claim);
  }
  for (const match of sentence.matchAll(PASSIVE_CLAIM)) {
    const claim = claimFor(sentence, match, true);
    if (claim) claims.push(claim);
  }
  return claims;
}

/** True when a sentence says Ari already did a write. */
export function claimsPastWrite(sentence: string): boolean {
  return writeClaimsIn(sentence).length > 0;
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

type EvidenceStatus =
  | "pending"
  | "executed"
  | "failed"
  | "cancelled"
  | "expired";

interface ClaimEvidence {
  toolName: string;
  status: EvidenceStatus;
  blob: string;
}

function evidenceRecord(item: unknown): Record<string, unknown> | null {
  return item && typeof item === "object" && !Array.isArray(item)
    ? item as Record<string, unknown>
    : null;
}

/**
 * The evidence as one entry per pending action: a proposal with its final
 * outcome when a receipt for the same action is present, a receipt alone
 * otherwise. Anything that is neither is ignored.
 */
function resolveEvidence(evidence: readonly unknown[]): ClaimEvidence[] {
  const byAction = new Map<string, ClaimEvidence>();
  const loose: ClaimEvidence[] = [];
  const statusOf = (value: unknown): EvidenceStatus | null =>
    value === "executed" || value === "failed" || value === "cancelled" ||
      value === "expired"
      ? value
      : null;
  for (const item of evidence) {
    const record = evidenceRecord(item);
    if (!record) continue;
    const toolName = typeof record.tool_name === "string"
      ? record.tool_name
      : "";
    const outcome = statusOf(record.outcome);
    const actionId = typeof record.pending_action_id === "string"
      ? record.pending_action_id
      : null;
    if (!outcome && !actionId) continue;
    const blob = JSON.stringify(record).toLowerCase();
    if (!actionId) {
      if (outcome) loose.push({ toolName, status: outcome, blob });
      continue;
    }
    const known = byAction.get(actionId);
    if (!known) {
      byAction.set(actionId, {
        toolName,
        status: outcome ?? "pending",
        blob,
      });
      continue;
    }
    known.blob = `${known.blob}\n${blob}`;
    if (!known.toolName) known.toolName = toolName;
    if (outcome) known.status = outcome;
  }
  return [...byAction.values(), ...loose];
}

function claimBacked(claim: WriteClaim, evidence: ClaimEvidence[]): boolean {
  return evidence.some((item) => {
    if (claim.strength === "done" && item.status !== "executed") return false;
    if (
      claim.strength === "proposed" &&
      item.status !== "executed" && item.status !== "pending"
    ) return false;
    const tool = item.toolName.toLowerCase();
    if (claim.families) {
      const family = toolFamily(tool);
      if (!family || !claim.families.includes(family)) return false;
    }
    if (
      claim.objects.length > 0 &&
      !claim.objects.some((pattern) => pattern.test(tool))
    ) return false;
    return claim.named.every((thing) =>
      item.blob.includes(thing.toLowerCase())
    );
  });
}

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
  const evidence = resolveEvidence(args.evidence);
  const unsupported: string[] = [];
  const kept: string[] = [];
  for (const sentence of sentences(args.text)) {
    const claims = writeClaimsIn(sentence);
    if (claims.every((claim) => claimBacked(claim, evidence))) {
      kept.push(sentence);
    } else {
      unsupported.push(sentence.trim());
    }
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

/**
 * What a conversation's recent rows can prove: live proposals (their tool
 * and args) and executed receipts, each receipt carrying its proposal's
 * args. A proposal whose card was cancelled, expired or failed proves
 * nothing, and neither does its receipt.
 */
export function claimEvidenceFromHistory(
  rows: ReadonlyArray<{
    role?: unknown;
    tool_calls?: unknown;
    tool_results?: unknown;
  }>,
): unknown[] {
  const proposals = new Map<string, Record<string, unknown>>();
  const outcomes = new Map<string, string>();
  const evidence: unknown[] = [];
  for (const row of rows) {
    if (row.role === "assistant") {
      const calls = evidenceRecord(row.tool_calls);
      if (calls && typeof calls.pending_action_id === "string") {
        proposals.set(calls.pending_action_id, calls);
      }
    }
    if (row.role === "tool") {
      const result = evidenceRecord(row.tool_results);
      if (result && typeof result.pending_action_id === "string") {
        outcomes.set(result.pending_action_id, String(result.outcome ?? ""));
      }
    }
  }
  for (const [actionId, calls] of proposals) {
    const outcome = outcomes.get(actionId);
    if (outcome === undefined || outcome === "executed") {
      evidence.push(calls);
    }
  }
  for (const row of rows) {
    if (row.role !== "tool") continue;
    const result = evidenceRecord(row.tool_results);
    if (!result || result.outcome !== "executed") continue;
    const actionId = typeof result.pending_action_id === "string"
      ? result.pending_action_id
      : null;
    const proposal = actionId ? proposals.get(actionId) : undefined;
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
const AMOUNT_SIGN_FIRST = new RegExp(
  `(GH₵|KSh|₦|£|€|\\$|₵|\\bN(?=\\d)|\\b(?:${CURRENCY_CODES})\\b)\\s?${AMOUNT_NUMBER}${AMOUNT_OFF}`,
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

function statedAmount(text: string): StatedAmount | undefined {
  const signFirst = AMOUNT_SIGN_FIRST.exec(text);
  if (signFirst) {
    const sign = signFirst[1].toUpperCase();
    const currency = CURRENCY_SIGNS[signFirst[1]] ?? CURRENCY_SIGNS[sign] ??
      (new RegExp(`^(?:${CURRENCY_CODES})$`).test(sign) ? sign : null);
    return {
      major: amountNumber(signFirst[2], signFirst[3], signFirst[4]),
      currency,
      words: signFirst[0].trim(),
    };
  }
  const wordAfter = AMOUNT_WORD_AFTER.exec(text);
  if (wordAfter) {
    const word = wordAfter[4].toLowerCase();
    return {
      major: amountNumber(wordAfter[1], wordAfter[2], wordAfter[3]),
      currency: CURRENCY_WORDS[word] ?? word.toUpperCase(),
      words: wordAfter[0].trim(),
    };
  }
  const bare = AMOUNT_BARE.exec(text);
  if (bare) {
    return {
      major: amountNumber(bare[1], bare[2], bare[3]),
      currency: null,
      words: bare[0].trim(),
    };
  }
  return undefined;
}

/** The discount values one stretch of the host's words states. */
function valuesIn(text: string, now: Date): StatedValues {
  const values: StatedValues = {};
  const percent = PERCENT.exec(text);
  if (percent) values.value_bps = Math.round(Number(percent[1]) * 100);
  else {
    const amount = statedAmount(text);
    if (amount && Number.isFinite(amount.major) && amount.major > 0) {
      values.amount = amount;
    }
  }
  const ends = statedDay(text, END_PATTERNS, now);
  if (ends) values.ends_on = ends;
  const starts = statedDay(text, START_PATTERNS, now);
  if (starts) values.starts_on = starts;
  const total = TOTAL_USES.exec(text);
  if (total) values.max_total_uses = Number(total[1] ?? total[2]);
  const perBuyer = PER_BUYER.exec(text);
  if (perBuyer) {
    values.max_uses_per_buyer = perBuyer[1] ? Number(perBuyer[1]) : 1;
  }
  return values;
}

function hasValues(values: StatedValues): boolean {
  return VALUE_KEYS.some((key) => values[key] !== undefined);
}

function assignValues(target: StatedValues, values: StatedValues): void {
  for (const key of VALUE_KEYS) {
    if (values[key] !== undefined) {
      (target as Record<string, unknown>)[key] = values[key];
    }
  }
}

/** Every code a message names, with where it first appears. */
function codeMentions(text: string): Array<{ code: string; index: number }> {
  const found = new Map<string, number>();
  const add = (raw: string, index: number) => {
    const code = normaliseAriDiscountCode(raw);
    if (!/^[A-Z0-9]{4,16}$/.test(code) || STOPWORDS.has(code)) return;
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
    let single: string | undefined;
    if (code && /^[A-Z0-9-]{4,16}$/i.test(code)) {
      single = normaliseAriDiscountCode(code);
      slots.code = single;
    }
    const mentions = codeMentions(text);
    if (mentions.length >= 2) {
      slots.codes = mentions.map((mention) => mention.code).slice(0, 10);
      // Each code's own stretch of words, up to the next code.
      const segments = mentions.map((mention, index) => ({
        code: mention.code,
        values: valuesIn(
          text.slice(mention.index, mentions[index + 1]?.index ?? text.length),
          now,
        ),
      }));
      const withValues = segments.filter((segment) =>
        hasValues(segment.values)
      );
      if (withValues.length >= 2) {
        slots.per_code = Object.fromEntries(
          segments.map((segment) => [segment.code, segment.values]),
        );
        for (const key of VALUE_KEYS) {
          if (segments.some((segment) => segment.values[key] !== undefined)) {
            delete slots[key];
          }
        }
        assignValues(slots, valuesIn(text.slice(0, mentions[0].index), now));
        continue;
      }
      delete slots.per_code;
      assignValues(slots, valuesIn(text, now));
      continue;
    }
    const values = valuesIn(text, now);
    if (mentions.length === 1 || single) {
      const named = mentions[0]?.code ?? single ?? "";
      delete slots.codes;
      if (slots.per_code && slots.per_code[named]) {
        assignValues(slots.per_code[named], values);
        continue;
      }
      delete slots.per_code;
    } else if (slots.per_code) {
      // No code named: the new words apply to every code being set up.
      for (const own of Object.values(slots.per_code)) {
        assignValues(own, values);
      }
    }
    assignValues(slots, values);
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
      hostCodeTokens(ownerMessages).has(code)
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
      }: you asked for ${list}, and I want to make sure that's exactly what goes on it. Is that right? Say yes and I'll prepare it with ${
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
  /\bI(?:['’]m| am)\s+(?:about to|going to)\s+(?:propose|create|set up|prepare|draft)\b|\bI(?:['’]ll| will)\s+(?:now\s+(?:propose|create|set up|prepare)|start with)\b|\blet me (?:propose|create)\b/i;

export function announcesWriteWithoutCall(text: string): boolean {
  return ANNOUNCED_WRITE.test(String(text ?? ""));
}
