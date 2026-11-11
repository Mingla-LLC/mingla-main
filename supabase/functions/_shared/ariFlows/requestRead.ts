/**
 * Issue #3355 Wave A (A2) — does typed text inside an open flow carry a
 * request of its own?
 *
 * Production 2026-11-10: a host typed "Create a discount code for me using
 * "FAVY10" as the code and 10% off this code and let it run from now until
 * 19th of December 2026." while an event setup card was open. The runner had
 * no way to hear it and answered "I didn't catch that as an answer to this
 * step" twice. This read decides, without a model, whether the words are a
 * request (so the run is parked and the normal agent loop serves it in the
 * same turn) or plainly not (so "I didn't catch that" is honest).
 *
 * The result is a HINT for the model and for observability (D3a: keyword
 * reads never pick the tool), never a route by itself.
 *
 * MINGLA-INVARIANT: I-ARI-NO-JAIL | issue #3355 | Typed text inside an open flow that is not a card answer is re-read; a request parks the run and is served by the agent loop in the same turn with one "Resume" choice; the same text twice never gets the same card twice (enforced by supabase/functions/_shared/__tests__/issue_3355_wave_a_understand_first.implementor.test.ts).
 */

import { classifyOfferingIntent, classifyReadinessQuestion } from "./index.ts";

/** A request hint: an offering flow key, a tool name, or a broad kind. */
export type FlowRequestHint =
  | Exclude<ReturnType<typeof classifyOfferingIntent>, null>
  | "readiness"
  | "create_discount"
  | "ticket_tiers"
  | "refund"
  | "payouts"
  | "campaign"
  | "team"
  | "website"
  | "request";

const TOOL_NOUNS: ReadonlyArray<[FlowRequestHint, RegExp]> = [
  [
    "create_discount",
    /\b(?:discounts?|(?:discount|promo|coupon|voucher|access)\s+codes?|promo(?:tion)?s?|coupons?|vouchers?|\d{1,2}\s?%\s*off|percent\s+off)\b/i,
  ],
  ["ticket_tiers", /\b(?:ticket\s+(?:tiers?|types?|prices?)|tiers?)\b/i],
  ["refund", /\brefunds?\b/i],
  ["payouts", /\b(?:payouts?|paid\s+out|bank\s+account)\b/i],
  [
    "campaign",
    /\b(?:campaigns?|blasts?|emails?|newsletters?|sms|text\s+messages?)\b/i,
  ],
  ["team", /\b(?:team\s*mates?|team\s+members?|invite|scanners?)\b/i],
  ["website", /\bwebsite\b/i],
];

/** An imperative or wish with a real object ("create a code", "I want to add…"). */
const REQUEST_VERB =
  /(?:^|[.!?]\s+|\b(?:please|pls|can you|could you|would you|i want to|i'd like to|i would like to|i need to|i need you to|help me|let'?s|now)\s+)(?:create|make|set\s*up|add|change|update|edit|delete|remove|send|publish|cancel|refund|show|list|give|turn\s+(?:on|off)|end|pause|stop|duplicate|copy|build|generate|write|draft|schedule|invite|start|plan|open)\s+(?!(?:it|that|this|them|those|these|one|now|later|again|up)\b)[a-z0-9"'“‘£$€₦]/i;

const normalise = (text: string): string =>
  text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Null when the words carry no request (an unclear answer, small talk);
 * otherwise what the request looks like.
 */
export function readFlowRequest(
  text: string | undefined,
): FlowRequestHint | null {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length < 4 || normalized.length > 1_500) return null;
  const offering = classifyOfferingIntent(normalized);
  if (offering) return offering;
  if (classifyReadinessQuestion(normalized)) return "readiness";
  const verb = REQUEST_VERB.test(normalized);
  for (const [hint, noun] of TOOL_NOUNS) {
    // A tool-shaped request: the thing a tool makes, asked for with a verb,
    // or named with a value ("FAVY10 for 10% off").
    if (noun.test(normalized) && (verb || /\d/.test(normalized))) return hint;
  }
  return verb ? "request" : null;
}

/** Same words, ignoring case, spacing and closing punctuation. */
export function sameOwnerText(a: unknown, b: string | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const strip = (value: string) => normalise(value).replace(/[.!?\s]+$/, "");
  const left = strip(a);
  return left.length > 0 && left === strip(b);
}
