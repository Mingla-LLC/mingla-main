// Issue #3355 Wave D (D2, D4) — Ari logs where it falls short, and changes
// approach when a host is stuck.
//
// D2: each turn is classified server-side into gap signals. The owner's words
// give repeated_request and frustration; the committed reply gives refusal,
// empty_reply, tool_error, dropped_route and flow_parked; ari-message-feedback
// gives negative_feedback. Every signal is written by
// public.ari_record_turn_gaps (service role) at most once per type per turn,
// fail-soft (a logging failure never touches the turn), with a PII-minimised
// excerpt and a transcript pointer (conversation_id + message_id).
//
// D4 (D7a): after a second failure inside the last 5 owner turns (refusal,
// repeat, park or frustration) or one strong frustration signal, Ari parks
// any open setup, answers from the guide with the direct screen, and offers
// "Ask the Mingla team" as a confirmation card: the existing receipt-backed
// tell_owner_in_brand_group send into the brand's group, posted only after
// the host taps Confirm, at most once per Ari conversation per hour.
//
// Invariants (declared beside their enforcing tests):
//   I-ARI-GAPS-LOGGED-ONCE-PER-TURN, I-ARI-ESCALATES-AFTER-SECOND-FAILURE,
//   I-ARI-ASK-TEAM-ONLY-ON-TAP.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { isAriCantReply } from "./ariGuideKnowledge.ts";
import { readFlowRequest } from "./ariFlows/requestRead.ts";
import { scrubAriExcerpt } from "./ariPii.ts";

export const ARI_GAP_TYPES = [
  "refusal",
  "flow_parked",
  "repeated_request",
  "negative_feedback",
  "frustration",
  "empty_reply",
  "tool_error",
  "dropped_route",
] as const;
export type AriGapType = typeof ARI_GAP_TYPES[number];

export interface AriGapSignal {
  type: AriGapType;
  excerpt: string;
  strong?: boolean;
  detail?: Record<string, unknown>;
}

/** The gap types that count as "a failure" for escalation (D4). */
export const ARI_ESCALATION_FAILURE_TYPES: ReadonlySet<AriGapType> = new Set([
  "refusal",
  "repeated_request",
  "flow_parked",
  "frustration",
]);

// ── Frustration lexicon ──────────────────────────────────────────────────

const STRONG_CUES: ReadonlyArray<[string, RegExp]> = [
  ["not_working", /\b(?:not|isn['’]?t|aren['’]?t|still not)\s+working\b/i],
  ["doesnt_work", /\b(?:doesn['’]?t|does not|didn['’]?t|did not)\s+work\b/i],
  ["useless", /\buseless\b/i],
  ["stupid", /\b(?:stupid|dumb|rubbish|terrible|horrible|ridiculous)\b/i],
  ["wtf", /\b(?:wtf|wth|ffs)\b/i],
  ["waste", /\bwaste of (?:my )?time\b/i],
  ["already_said", /\bi (?:already|just) (?:said|told|asked|typed)\b/i],
  [
    "listen",
    /\b(?:are you (?:even )?listening|you(?:['’]re| are) not listening|read (?:my|what i))\b/i,
  ],
  ["give_up", /\b(?:give up|forget it|never ?mind)\b/i],
];

const WEAK_CUES: ReadonlyArray<[string, RegExp]> = [
  ["why", /\bwhy\b/i],
  ["again", /\bagain\b/i],
  ["still", /\bstill\b/i],
  ["seriously", /\b(?:seriously|come on|please just)\b/i],
  ["punctuation", /(?:!{2,}|\?{2,}|\?!|!\?)/],
];

function capsWordCount(text: string): number {
  const words = text.match(/\b[A-Za-z][A-Za-z'’]+\b/g) ?? [];
  let run = 0;
  let best = 0;
  for (const word of words) {
    const letters = word.replace(/['’]/g, "");
    const caps = letters.length >= 2 && letters === letters.toUpperCase();
    run = caps ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

export interface AriFrustration {
  frustrated: boolean;
  strong: boolean;
  cues: string[];
}

/**
 * The frustration lexicon. ALL CAPS (3+ words in a row) or a strong cue is
 * strong; two weak cues are strong; a lone "why" question is not frustration.
 */
export function detectAriFrustration(text: string): AriFrustration {
  const value = String(text ?? "");
  const cues: string[] = [];
  let strongCount = 0;
  if (capsWordCount(value) >= 3) {
    cues.push("all_caps");
    strongCount += 1;
  }
  for (const [name, pattern] of STRONG_CUES) {
    if (pattern.test(value)) {
      cues.push(name);
      strongCount += 1;
    }
  }
  const weak = WEAK_CUES.filter(([, pattern]) => pattern.test(value)).map((
    [name],
  ) => name);
  cues.push(...weak);
  const loneWhy = strongCount === 0 && weak.length === 1 && weak[0] === "why";
  const frustrated = strongCount > 0 || (weak.length > 0 && !loneWhy);
  return {
    frustrated,
    strong: strongCount > 0 || weak.length >= 2,
    cues,
  };
}

// ── Repeated request ─────────────────────────────────────────────────────

/** Lower case, letters and digits only, single spaces. */
export function normalizeAriOwnerText(text: string): string {
  return String(text ?? "").toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
}

/**
 * The same owner words (12+ characters once normalised), or the same specific
 * request (readFlowRequest hint), within the previous 3 owner turns.
 * `priorOwnerTexts` is most recent first and excludes this turn.
 */
export function detectAriRepeat(
  current: string,
  priorOwnerTexts: readonly string[],
  /**
   * #3355 Wave F (live eval): per prior owner turn (same order), whether Ari
   * answered it with a proposal card. A host asking for the next discount
   * code after the last one was proposed is a new request, not a repeat, so
   * "same intent" counts only unserved turns. Same words always count.
   */
  priorServed: readonly boolean[] = [],
): { repeated: boolean; how: "same_text" | "same_intent" | null } {
  const recent = priorOwnerTexts.slice(0, 3);
  const words = normalizeAriOwnerText(current);
  if (
    words.length >= 12 &&
    recent.some((prior) => normalizeAriOwnerText(prior) === words)
  ) {
    return { repeated: true, how: "same_text" };
  }
  const hint = readFlowRequest(current);
  if (hint && hint !== "request" && hint !== "readiness") {
    if (
      recent.some((prior, index) =>
        priorServed[index] !== true && readFlowRequest(prior) === hint
      )
    ) {
      return { repeated: true, how: "same_intent" };
    }
  }
  return { repeated: false, how: null };
}

// ── Classifiers ──────────────────────────────────────────────────────────

/** Signals carried by the owner's own words (before Ari answers). */
export function classifyAriOwnerTurn(args: {
  text: string;
  priorOwnerTexts: readonly string[];
  priorServed?: readonly boolean[];
}): AriGapSignal[] {
  const text = String(args.text ?? "").trim();
  if (!text) return [];
  const excerpt = scrubAriExcerpt(text);
  const signals: AriGapSignal[] = [];
  const repeat = detectAriRepeat(
    text,
    args.priorOwnerTexts,
    args.priorServed ?? [],
  );
  if (repeat.repeated) {
    signals.push({
      type: "repeated_request",
      excerpt,
      detail: { how: repeat.how },
    });
  }
  const frustration = detectAriFrustration(text);
  if (frustration.frustrated) {
    signals.push({
      type: "frustration",
      excerpt,
      strong: frustration.strong,
      detail: { cues: frustration.cues.slice(0, 6) },
    });
  }
  return signals;
}

/** Ari did not understand the host ("I didn't catch that …"). */
const DIDNT_UNDERSTAND =
  /\bI (?:didn['’]t|did not|couldn['’]t|could not) (?:catch|understand|follow) (?:that|what you)\b/i;

/** Signals carried by the reply Ari committed. */
export function classifyAriReplyGaps(args: {
  replyText: string;
  ownerText?: string | null;
  hasRendition: boolean;
  errorCodes?: readonly string[];
  droppedRoutes?: number;
  flowParked?: boolean;
}): AriGapSignal[] {
  const reply = String(args.replyText ?? "");
  const excerpt = scrubAriExcerpt(
    args.ownerText && args.ownerText.trim() ? args.ownerText : reply,
  );
  const signals: AriGapSignal[] = [];
  if (reply.trim() && (isAriCantReply(reply) || DIDNT_UNDERSTAND.test(reply))) {
    signals.push({
      type: "refusal",
      excerpt,
      detail: { reply: scrubAriExcerpt(reply, 160) },
    });
  }
  if (!reply.trim() && !args.hasRendition) {
    signals.push({ type: "empty_reply", excerpt });
  }
  const codes = [...new Set((args.errorCodes ?? []).filter(Boolean))];
  if (codes.length > 0) {
    signals.push({
      type: "tool_error",
      excerpt,
      detail: { codes: codes.slice(0, 5) },
    });
  }
  if ((args.droppedRoutes ?? 0) > 0) {
    signals.push({
      type: "dropped_route",
      excerpt,
      detail: { count: args.droppedRoutes },
    });
  }
  if (args.flowParked) signals.push({ type: "flow_parked", excerpt });
  return signals;
}

/** At most one signal per type (the first wins). */
export function dedupeAriGaps(
  signals: readonly AriGapSignal[],
): AriGapSignal[] {
  const seen = new Set<AriGapType>();
  return signals.filter((signal) => {
    if (seen.has(signal.type)) return false;
    seen.add(signal.type);
    return true;
  });
}

// ── Escalation (D4) ──────────────────────────────────────────────────────

export interface AriRecentGap {
  id?: string;
  type: string;
  strong?: boolean;
  excerpt?: string;
}

export interface AriEscalation {
  escalate: boolean;
  reason: "second_failure" | "strong_frustration" | null;
}

/**
 * Change approach after a second failure inside the last 5 owner turns, or
 * on one strong frustration signal now.
 */
export function decideAriEscalation(args: {
  ownerSignals: readonly AriGapSignal[];
  recentGaps: readonly AriRecentGap[];
}): AriEscalation {
  if (
    args.ownerSignals.some((signal) =>
      signal.type === "frustration" && signal.strong === true
    )
  ) {
    return { escalate: true, reason: "strong_frustration" };
  }
  const failures = [
    ...args.recentGaps.filter((gap) =>
      ARI_ESCALATION_FAILURE_TYPES.has(gap.type as AriGapType)
    ),
    ...args.ownerSignals.filter((signal) =>
      ARI_ESCALATION_FAILURE_TYPES.has(signal.type)
    ),
  ];
  return failures.length >= 2
    ? { escalate: true, reason: "second_failure" }
    : { escalate: false, reason: null };
}

// ── Reads and writes (fail-soft) ─────────────────────────────────────────

/** The caller's previous owner texts in this chat, most recent first. */
export async function readAriPriorOwnerTexts(args: {
  caller: SupabaseClient;
  conversationId: string;
  excludeMessageId?: string | null;
}): Promise<string[]> {
  try {
    const { data, error } = await args.caller.from("agent_messages")
      .select("id,content")
      .eq("conversation_id", args.conversationId)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(5);
    if (error || !Array.isArray(data)) return [];
    return (data as { id?: string; content?: { text?: unknown } }[])
      .filter((row) => row.id !== args.excludeMessageId)
      .map((row) =>
        typeof row.content?.text === "string" ? row.content.text : ""
      )
      .filter(Boolean)
      .slice(0, 3);
  } catch (_error) {
    return [];
  }
}

/**
 * #3355 Wave F — for the caller's previous owner turns in this chat (most
 * recent first, the same rows readAriPriorOwnerTexts returns), whether Ari
 * answered each with a proposal card. Fail-soft: unknown is "not served".
 */
export async function readAriPriorOwnerServed(args: {
  caller: SupabaseClient;
  conversationId: string;
  excludeMessageId?: string | null;
}): Promise<boolean[]> {
  try {
    const { data, error } = await args.caller.from("agent_messages")
      .select("id,role,content,tool_calls")
      .eq("conversation_id", args.conversationId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: false })
      .limit(16);
    if (error || !Array.isArray(data)) return [];
    return priorOwnerServedFromRows(
      data as PriorRow[],
      args.excludeMessageId ?? null,
    );
  } catch (_error) {
    return [];
  }
}

interface PriorRow {
  id?: string;
  role?: string;
  content?: { text?: unknown } | null;
  tool_calls?: unknown;
}

/** Newest-first rows → served flags for the prior owner turns with text. */
export function priorOwnerServedFromRows(
  rows: readonly PriorRow[],
  excludeMessageId: string | null,
): boolean[] {
  const served: boolean[] = [];
  let proposalSince = false;
  for (const row of rows) {
    if (row.role === "assistant") {
      const calls = row.tool_calls as { pending_action_id?: unknown } | null;
      if (calls && typeof calls.pending_action_id === "string") {
        proposalSince = true;
      }
      continue;
    }
    if (row.role !== "user") continue;
    if (row.id === excludeMessageId) {
      proposalSince = false;
      continue;
    }
    if (typeof row.content?.text === "string" && row.content.text) {
      served.push(proposalSince);
    }
    proposalSince = false;
    if (served.length >= 3) break;
  }
  return served;
}

/** The gap rows inside this chat's last 5 owner turns (caller JWT). */
export async function readAriRecentGaps(args: {
  caller: SupabaseClient;
  conversationId: string;
}): Promise<AriRecentGap[]> {
  try {
    const { data, error } = await args.caller.rpc(
      "ari_conversation_gap_signals",
      { p_conversation_id: args.conversationId },
    );
    if (error || !Array.isArray(data)) return [];
    return (data as AriRecentGap[]).filter((row) =>
      row && typeof row.type === "string"
    );
  } catch (_error) {
    return [];
  }
}

/**
 * Write this turn's signals (service role). Never throws: a missing function
 * (migration not applied yet) or any error is logged and ignored.
 */
export async function recordAriTurnGaps(args: {
  service: SupabaseClient;
  userId: string;
  conversationId: string;
  messageId: string | null;
  turnKey: string;
  signals: readonly AriGapSignal[];
}): Promise<number> {
  const gaps = dedupeAriGaps(args.signals).slice(0, 8).map((signal) => ({
    type: signal.type,
    excerpt: scrubAriExcerpt(signal.excerpt),
    strong: signal.strong === true,
    detail: signal.detail ?? {},
  }));
  if (gaps.length === 0) return 0;
  try {
    const { data, error } = await args.service.rpc("ari_record_turn_gaps", {
      p_user_id: args.userId,
      p_conversation_id: args.conversationId,
      p_message_id: args.messageId,
      p_turn_key: args.turnKey.slice(0, 200),
      p_gaps: gaps,
    });
    if (error) {
      console.warn(
        "[ari-gaps] not recorded",
        String(error.message ?? "").slice(0, 120),
      );
      return 0;
    }
    return typeof data === "number" ? data : 0;
  } catch (error) {
    console.warn(
      "[ari-gaps] not recorded",
      error instanceof Error ? error.message.slice(0, 120) : "unknown",
    );
    return 0;
  }
}

// ── "Ask the Mingla team" (D4, D7a) ─────────────────────────────────────

export const ARI_ASK_TEAM_TOPIC = "ask_mingla_team";
export const ARI_ASK_TEAM_TITLE = "Ask the Mingla team";

const TRIED_WORDS: Readonly<Record<string, string>> = Object.freeze({
  refusal: "said it couldn't do it",
  flow_parked: "set a guided setup aside",
  repeated_request: "was asked the same thing again",
  frustration: "kept the host waiting",
  empty_reply: "gave an empty reply",
  tool_error: "hit an error",
  dropped_route: "couldn't link the right screen",
  negative_feedback: "got a thumbs down",
});

/**
 * The note's exact words. PII-minimised: only scrubbed gap excerpts (at most
 * two, 140 characters each), what Ari tried, and a short chat reference.
 */
export function askTeamNoteText(args: {
  firstName: string | null;
  brandName: string;
  asked: readonly string[];
  tried: readonly string[];
  chatRef: string;
}): string {
  const who = args.firstName?.trim() || "A host";
  const asked = args.asked.map((text) => scrubAriExcerpt(text, 140))
    .filter(Boolean).slice(0, 2);
  const tried = [...new Set(args.tried.map((type) => TRIED_WORDS[type]))]
    .filter(Boolean).slice(0, 3);
  const parts = [
    `${who} asked Ari for help with ${args.brandName} and Ari couldn't finish it.`,
    asked.length > 0
      ? `They asked: ${asked.map((text) => `"${text}"`).join(" and ")}.`
      : "",
    tried.length > 0 ? `Ari ${tried.join(", then ")}.` : "",
    `Could someone from the Mingla team help here? (Ari chat ${args.chatRef})`,
  ];
  return parts.filter(Boolean).join(" ").slice(0, 600);
}

interface GapEventRow {
  id: string;
  gap_type: string;
  excerpt: string;
  created_at: string;
}

/**
 * The gap rows a note is built from (the caller's own, by id when given,
 * else the chat's 5 latest). The executor rebuilds the note from the same
 * ids, so the words a host confirms are the words that post.
 */
export async function readAskTeamGaps(args: {
  caller: SupabaseClient;
  ariConversationId: string;
  gapIds?: readonly string[] | null;
}): Promise<GapEventRow[]> {
  let query = args.caller.from("ari_capability_gap_events")
    .select("id,gap_type,excerpt,created_at")
    .eq("conversation_id", args.ariConversationId);
  if (args.gapIds && args.gapIds.length > 0) {
    query = query.in("id", [...args.gapIds]);
  }
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(5);
  if (error || !Array.isArray(data)) return [];
  return (data as GapEventRow[]).sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
  );
}

/** The note for these gap rows (oldest first). */
export function askTeamNoteFromGaps(args: {
  firstName: string | null;
  brandName: string;
  ariConversationId: string;
  gaps: readonly GapEventRow[];
}): string {
  const asked: string[] = [];
  for (const gap of args.gaps) {
    const text = String(gap.excerpt ?? "").trim();
    if (text && !asked.includes(text)) asked.push(text);
  }
  return askTeamNoteText({
    firstName: args.firstName,
    brandName: args.brandName,
    asked: asked.slice(-2),
    tried: args.gaps.map((gap) => gap.gap_type),
    chatRef: args.ariConversationId.slice(0, 8),
  });
}

/**
 * An "Ask the Mingla team" note already went out (or is going out) for this
 * Ari chat within the hour. Read as the caller; a failed read is "no".
 */
export async function askTeamSentRecently(args: {
  caller: SupabaseClient;
  userId: string;
  ariConversationId: string;
  nowMs?: number;
}): Promise<boolean> {
  try {
    const since = new Date((args.nowMs ?? Date.now()) - 3_600_000)
      .toISOString();
    const { data, error } = await args.caller.from("agent_pending_actions")
      .select("id")
      .eq("user_id", args.userId)
      .eq("tool_name", "tell_owner_in_brand_group")
      .eq("tool_args->>about", ARI_ASK_TEAM_TOPIC)
      .eq("tool_args->>ari_conversation_id", args.ariConversationId)
      .in("status", ["executing", "executed"])
      .gte("created_at", since)
      .limit(1);
    return !error && Array.isArray(data) && data.length > 0;
  } catch (_error) {
    return false;
  }
}

/** What Ari says above the card, after its own answer. */
export const ASK_TEAM_LEAD =
  "If that still doesn't sort it, I can ask the Mingla team for you. Tap Confirm and I'll post this note in your brand group chat; nothing is sent until you do.";

/** What Ari says when the team was already asked in this chat this hour. */
export const ASK_TEAM_ALREADY_SENT =
  "I've already asked the Mingla team about this in the last hour. They'll reply in your brand group chat.";
