/**
 * ORCH-1103 REWORK 2 — pure helpers for the presentational "suggested replies"
 * chips (Surfaces 3 & 5). Extracted from MessageList so the payload→chips and
 * tap→label logic is unit-testable in the node jest env without importing the
 * react-native component tree.
 *
 * Q2 (resolved): a chip tap sends its `label` as a NORMAL user turn — Gemini
 * re-proposes with the resolved target. The client NEVER pre-fills a tool arg.
 */

import type { AgentChoices } from "../../services/agentChatService";
import type { ChoiceOption } from "./QuickReplyChips";

interface ContentWithStructured {
  structured?: { choices?: unknown } | unknown;
}

interface MessageLike {
  role: "user" | "assistant" | "tool";
  content: ContentWithStructured | Record<string, unknown>;
}

/**
 * Pull a well-formed choices payload off an assistant message (persisted in
 * content.structured by agent-chat). Returns undefined for any message without
 * a valid payload so a malformed/legacy row degrades to a plain bubble.
 */
export function choicesOf(m: MessageLike): AgentChoices | undefined {
  if (m.role !== "assistant") return undefined;
  const structured = (m.content as { structured?: unknown })?.structured as
    | { choices?: unknown }
    | undefined;
  const choices = structured?.choices as Partial<AgentChoices> | undefined;
  if (
    !choices ||
    (choices.kind !== "brand_disambiguation" && choices.kind !== "no_brand_handoff") ||
    !Array.isArray(choices.options) ||
    choices.options.length === 0
  ) {
    return undefined;
  }
  const options = choices.options.filter(
    (o): o is ChoiceOption =>
      !!o &&
      typeof (o as ChoiceOption).id === "string" &&
      typeof (o as ChoiceOption).label === "string",
  );
  if (options.length === 0) return undefined;
  return { kind: choices.kind, prompt: choices.prompt ?? "", options };
}

/**
 * The label a chip tap must send as the next user turn. Pure so the tap-dispatch
 * contract is unit-testable: tapping option `id` sends EXACTLY this brand name /
 * yes-no label (no id, no tool pre-fill). Returns null for an unknown id so the
 * handler no-ops instead of sending an empty turn (no dead tap, no junk send).
 */
export function resolveChoiceLabel(choices: AgentChoices, optionId: string): string | null {
  const opt = choices.options.find((o) => o.id === optionId);
  return opt ? opt.label : null;
}
