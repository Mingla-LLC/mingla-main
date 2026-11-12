// Issue #3355 rework 9 (fix 6) — a chat's automatic title says what that
// chat is about.
//
// Local demo 2026-11-12: four of five chats were titled "Review event
// operations" by the #3429 safe taxonomy (agent_safe_provisional_title),
// which maps any message about events, tickets or guests to that phrase. On
// the "Ari understands first" path the title is made from the host's first
// message instead: a code request names the code ("FAVY10 discount code"),
// otherwise the first sentence, trimmed of greetings and "can you…", in
// sentence case, at most 48 characters on a word boundary. Emails, phone
// numbers and card-like numbers are scrubbed first (scrubAriExcerpt), and
// the "[email]" style markers never reach a title. A title that is a generic
// taxonomy phrase, or one the host's other recent chats already use, is
// never given: the next words of the message tell them apart, else " (2)",
// " (3)". The off path keeps the taxonomy title as it is.
//
// MINGLA-INVARIANT: I-ARI-CHAT-TITLE-SPECIFIC | issue #3355 | On the "Ari understands first" path a new chat (and a regenerated title) is titled from the host's first message, never with a generic taxonomy phrase and never with a title the host's other recent chats already have; contact and card details are scrubbed out (enforced by supabase/functions/_shared/__tests__/issue_3355_rework_9.implementor.test.ts).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { scrubAriExcerpt } from "./ariPii.ts";

/** Phrases that say nothing about one chat (the #3429 taxonomy and kin). */
export const ARI_GENERIC_TITLES: ReadonlySet<string> = new Set(
  [
    "Plan with Ari",
    "Plan an event with Ari",
    "Review event operations",
    "Update the business website",
    "Plan a marketing campaign",
    "Review business payments",
    "Manage the business team",
    "Update the business profile",
    "Review business performance",
    "Manage venue operations",
    "Manage stay operations",
    "Review attached image",
    "Review attached document",
    "New chat",
    "Chat with Ari",
    "Ari chat",
    "Untitled",
    "Help",
    "Question",
    "Hello",
    "Hi",
    "Hey",
  ].map((title) => title.toLowerCase()),
);

export const ARI_CHAT_TITLE_MAX = 48;
/** The column allows 60; a numbered twin stays inside it. */
const TITLE_HARD_MAX = 60;

const FILLER =
  /^(?:(?:hi|hey|hello|hiya|good\s+(?:morning|afternoon|evening)|ari|please|pls|plz|kindly|ok(?:ay)?|so|um+|uh+|abeg|biko|oya|yo|thanks|thank\s+you)\b[\s,!.:-]*|(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:help\s+me\s+(?:to\s+)?)?|i\s+(?:want|wanna|need|would\s+like|['’]d\s+like)\s+(?:you\s+)?to\s+|i\s+need\s+(?:you\s+)?|help\s+me\s+(?:to\s+)?|let['’]?s\s+|(?:do\s+you\s+)?know\s+how\s+to\s+)/i;

const CODE =
  /\b([A-Z][A-Z0-9]{2,15}[0-9][A-Z0-9]*|[A-Z0-9]*[0-9][A-Z][A-Z0-9]{2,15})\b/;
const CODE_WORDS = /\b(?:discount|promo|coupon|voucher|code)\b|\d\s*%\s*off\b/i;

function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  let out = (space > max * 0.5 ? cut.slice(0, space) : text.slice(0, max))
    .replace(/[\s,;:–—-]+$/, "");
  // A cut never ends on "the", "at", "until" or a stray number.
  for (let index = 0; index < 4; index++) {
    const next = out.replace(
      /\s+(?:the|a|an|at|to|of|for|in|on|and|or|until|till|from|with|by|my|our|your|that|\d{1,4})$/i,
      "",
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

function sentenceCase(text: string): string {
  return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;
}

function tidy(text: string): string {
  return text.replace(/\[(?:email|phone|number)\]/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

/** The first message, scrubbed and trimmed to its first sentence. */
function firstSentence(message: string): string {
  let text = tidy(scrubAriExcerpt(message, 400));
  for (let index = 0; index < 4; index++) {
    const next = text.replace(FILLER, "").trim();
    if (next === text) break;
    text = next;
  }
  const question = /^[^.!?\n]*\?/.exec(text);
  const sentence = question
    ? question[0]
    : (/^[^.!\n]+/.exec(text)?.[0] ?? text);
  return sentence.replace(/[\s,;:!.–—-]+$/, "").trim();
}

/** The words beyond the first sentence, to tell two chats apart. */
function longerSentence(message: string): string {
  return tidy(scrubAriExcerpt(message, 400)).replace(FILLER, "")
    .replace(/[\s,;:!.–—-]+$/, "").trim();
}

function isGeneric(title: string): boolean {
  const key = title.toLowerCase().replace(/[.!?]+$/, "").trim();
  return !key || ARI_GENERIC_TITLES.has(key) ||
    key.split(/\s+/).length < 2 && key.length < 12;
}

/**
 * The title for a chat from its first host message, never generic and never
 * one of `recentTitles`. Null when the message gives nothing to say (empty
 * or only a greeting): the caller keeps the title it has.
 */
export function ariChatTitle(args: {
  firstMessage: string;
  recentTitles?: readonly string[];
}): string | null {
  const message = String(args.firstMessage ?? "");
  if (!message.trim()) return null;
  const taken = new Set(
    (args.recentTitles ?? []).map((title) => title.trim().toLowerCase()),
  );
  const candidates: string[] = [];
  const code = CODE.exec(message)?.[1];
  if (code && CODE_WORDS.test(message)) {
    candidates.push(`${code} discount code`);
  }
  const first = firstSentence(message);
  if (first) {
    candidates.push(sentenceCase(cutAtWord(first, ARI_CHAT_TITLE_MAX)));
  }
  const longer = longerSentence(message);
  if (longer && longer !== first) {
    candidates.push(sentenceCase(cutAtWord(longer, TITLE_HARD_MAX - 5)));
  }
  const usable = candidates.map((title) => title.trim()).filter((title) =>
    title.length > 0 && !isGeneric(title)
  );
  if (usable.length === 0) return null;
  for (const title of usable) {
    if (!taken.has(title.toLowerCase())) return title;
  }
  const base = cutAtWord(usable[0], TITLE_HARD_MAX - 5);
  for (let n = 2; n < 100; n++) {
    const title = `${base} (${n})`;
    if (!taken.has(title.toLowerCase())) return title;
  }
  return null;
}

type TitleClient = Pick<SupabaseClient, "from">;

/** The version label written beside a title this module made. */
export const ARI_CHAT_TITLE_VERSION = "ari-first-message-v1";

/**
 * Re-title one chat from its first host message (service client; the chat
 * is the caller's own, checked by user_id). A manual title is never
 * replaced unless `replaceManual`. Returns the new title, or null when it
 * was left as it was. Never throws.
 */
export async function retitleAriChat(args: {
  service: TitleClient;
  userId: string;
  conversationId: string;
  brandId: string | null;
  firstMessage: string;
  replaceManual?: boolean;
  now?: Date;
}): Promise<string | null> {
  try {
    const { data: chat } = await args.service.from("agent_conversations")
      .select("id,title,title_source")
      .eq("id", args.conversationId)
      .eq("user_id", args.userId)
      .maybeSingle();
    if (!chat) return null;
    if (chat.title_source === "manual" && !args.replaceManual) return null;
    let recent = args.service.from("agent_conversations")
      .select("title")
      .eq("user_id", args.userId)
      .neq("id", args.conversationId);
    if (args.brandId) recent = recent.eq("brand_id", args.brandId);
    const { data: rows } = await recent
      .order("updated_at", { ascending: false })
      .limit(50);
    const title = ariChatTitle({
      firstMessage: args.firstMessage,
      recentTitles: ((rows ?? []) as Array<{ title?: unknown }>).flatMap((
        row,
      ) => typeof row.title === "string" ? [row.title] : []),
    });
    if (!title || title === chat.title) return title;
    const now = (args.now ?? new Date()).toISOString();
    const { error } = await args.service.from("agent_conversations")
      .update({
        title,
        title_source: "generated",
        title_generation_version: ARI_CHAT_TITLE_VERSION,
        title_generated_at: now,
      })
      .eq("id", args.conversationId)
      .eq("user_id", args.userId);
    return error ? null : title;
  } catch (_error) {
    return null;
  }
}
