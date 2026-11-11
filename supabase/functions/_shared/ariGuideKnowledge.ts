// Issue #3355 Wave B (B1) — Ari's product knowledge comes from the Feature
// Guide (I-ARI-KNOWLEDGE-FROM-GUIDE).
//
//   * A how-to or "can I / I want to" message reads the guide before the
//     first model call (ariGuideInitialCalls), so steps come from how_to.
//   * A reply that says Mingla can't do something, in a turn where no guide
//     search ran, runs one guide search and the model answers again
//     (ariGuideRecoveryCalls, used as the loop's premature-text recovery).
//   * The reply carries the capability keys it was grounded on
//     (ariGuideCitations) as structured data, never as prose.
//
// The invariant is declared beside its enforcing test:
// supabase/functions/_shared/__tests__/issue_3355_wave_b_guide.implementor.test.ts

import type { AgentLoopObservation, AgentLoopToolCall } from "./agentLoop.ts";

export const GUIDE_TOOL = "search_mingla_guide";

/** "I can't…", "Mingla doesn't support…", "that's not available" and friends. */
const CANT_REPLY =
  /\b(?:i|we|ari|mingla|you)\s+(?:can(?:no|['’])t|can not|am not able to|are not able to|is not able to|'m not able to|'re not able to|am unable to|are unable to|is unable to|don['’]t|doesn['’]t|do not|does not)\s+(?:yet\s+)?(?:do|support|offer|have|allow|let|help|create|make|set|upload|import|add|send|handle)\b|\b(?:not|isn['’]t|aren['’]t)\s+(?:currently\s+|yet\s+)?(?:possible|supported|available)\b|\bno way to\b|\bcan['’]t do that yet\b|\bnot something i can\b/i;

export function isAriCantReply(text: string): boolean {
  return CANT_REPLY.test(text);
}

/** A how-to, "can I…", "I want to…" or "is there a way…" message. */
const HOW_TO_ASK =
  /\bhow\s+(?:do|can|could|would|should)\s+(?:i|we|you)\b|\bhow\s+to\b|\bwhere\s+(?:do|can)\s+(?:i|we)\b|\b(?:can|could)\s+(?:i|we|mingla|ari)\b|\bis\s+(?:it|there)\s+(?:possible|a\s+way)\b|\bi\s+(?:want|need|would\s+like|['’]d\s+like)\s+to\b|\bdoes\s+mingla\b|\bsteps?\s+(?:to|for)\b/i;

export function isAriHowToAsk(text: string): boolean {
  return HOW_TO_ASK.test(text);
}

function guideCall(query: string): AgentLoopToolCall {
  return {
    name: GUIDE_TOOL,
    args: { query: query.replace(/\s+/g, " ").trim().slice(0, 300), limit: 3 },
  };
}

/** The guide read that runs before the model for a how-to or capability ask. */
export function ariGuideInitialCalls(message: string): AgentLoopToolCall[] {
  const query = message.trim();
  return query.length >= 2 && isAriHowToAsk(query) ? [guideCall(query)] : [];
}

/**
 * I-ARI-KNOWLEDGE-FROM-GUIDE: a "can't" reply in a turn with no guide search
 * gets exactly one guide search (with the owner's words), and the model is
 * asked again with what it found.
 */
export function ariGuideRecoveryCalls(
  replyText: string,
  observations: readonly AgentLoopObservation[],
  ownerMessage: string,
): AgentLoopToolCall[] {
  if (!isAriCantReply(replyText)) return [];
  if (observations.some((observation) => observation.tool === GUIDE_TOOL)) {
    return [];
  }
  const query = ownerMessage.trim() || replyText.trim();
  return query.length >= 2 ? [guideCall(query)] : [];
}

export interface AriGuideCitation {
  capability_key: string;
  title: string;
  status: string;
}

/** The guide entries this turn read (best first), for the reply's structured data. */
export function ariGuideCitations(
  observations: readonly AgentLoopObservation[],
  max = 3,
): AriGuideCitation[] {
  const seen = new Set<string>();
  const citations: AriGuideCitation[] = [];
  for (const observation of observations) {
    if (observation.tool !== GUIDE_TOOL || observation.error) continue;
    const results = (observation.result as { results?: unknown } | undefined)
      ?.results;
    if (!Array.isArray(results)) continue;
    for (const row of results) {
      const key = (row as { capability_key?: unknown })?.capability_key;
      if (typeof key !== "string" || !key || seen.has(key)) continue;
      seen.add(key);
      citations.push({
        capability_key: key,
        title: String((row as { title?: unknown }).title ?? ""),
        status: String((row as { status?: unknown }).status ?? ""),
      });
      if (citations.length >= max) return citations;
    }
  }
  return citations;
}
