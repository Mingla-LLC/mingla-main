/** Issue #1985 — strict client boundary for question-bound AgentChoicesV2. */

import type {
  AgentChoicesV2,
  AgentChoiceSubmissionV2,
} from "../../services/agentChatService";

interface MessageLike {
  role: "user" | "assistant" | "tool";
  content: { structured?: unknown } | Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Legacy V1 and malformed rows remain readable as prose, but are never interactive. */
export function choicesOf(message: MessageLike): AgentChoicesV2 | undefined {
  if (message.role !== "assistant") return undefined;
  const structured = (message.content as { structured?: unknown }).structured;
  const raw = isRecord(structured) ? structured.choices : undefined;
  if (!isRecord(raw) || raw.schema_version !== 2) return undefined;
  if (
    typeof raw.question_id !== "string" ||
    !new Set(["clarifying", "multi_select", "next_step"]).has(String(raw.kind)) ||
    typeof raw.prompt !== "string" ||
    !Array.isArray(raw.required_slot_keys) ||
    raw.required_slot_keys.some((key) => typeof key !== "string") ||
    !Array.isArray(raw.options) ||
    raw.options.length > 4
  ) return undefined;
  const options = raw.options.filter((option): option is AgentChoicesV2["options"][number] => {
    if (!isRecord(option) || typeof option.id !== "string" || typeof option.label !== "string" || !isRecord(option.payload)) return false;
    if (option.payload.type === "slot_patch") return isRecord(option.payload.slot_updates);
    if (option.payload.type === "handoff") return typeof option.payload.route === "string";
    return option.payload.type === "task_command" && new Set(["pause", "resume", "cancel", "start_new", "continue_planning"]).has(String(option.payload.command));
  });
  if (options.length !== raw.options.length) return undefined;
  return {
    schema_version: 2,
    question_id: raw.question_id,
    kind: raw.kind as AgentChoicesV2["kind"],
    prompt: raw.prompt,
    required_slot_keys: raw.required_slot_keys as string[],
    options,
  };
}

/** Build semantic submission from server-owned option IDs; labels are display-only. */
export function buildChoiceSubmission(
  choices: AgentChoicesV2,
  optionIds: string[],
  freeText?: string,
): AgentChoiceSubmissionV2 | null {
  const ids = [...new Set(optionIds)];
  if (ids.length > 3 || ids.some((id) => !choices.options.some((option) => option.id === id))) return null;
  const trimmed = freeText?.trim();
  if (ids.length === 0 && !trimmed) return null;
  return {
    question_id: choices.question_id,
    option_ids: ids,
    ...(trimmed ? { free_text: trimmed } : {}),
  };
}

export function choiceLabel(choices: AgentChoicesV2, optionIds: string[], freeText?: string): string {
  if (freeText?.trim()) return freeText.trim();
  return optionIds
    .map((id) => choices.options.find((option) => option.id === id)?.label)
    .filter((label): label is string => !!label)
    .join(", ");
}
