// Issue #1985 — persisted, question-bound choices carrying typed values.
//
// AgentChoicesV2 is the only runtime authority. The legacy detectChoices
// export remains below solely so append-only historical unit tests compile;
// agent-chat no longer imports or calls it, and V1 rows are inert in clients.
//
// Chip tap still sends the label as a normal user turn (Q2). Client never
// pre-fills tool IDs. A miss = prose-only; a false-positive = extra chips.
//
// Kinds:
//   brand_disambiguation — ≥2 brands, edit/delete intent, Ari is asking
//   no_brand_handoff     — 0 brands, create offering intent
//   clarifying           — Ari asked a missing-field question (when/where/name)
//   multi_select         — Ari listed pick-all options
//   next_step            — Ari offered a concrete next action after a write

import type { BrandSummary } from "./agentSystemPrompt.ts";

export type AgentChoicePayload =
  | {
      type: "slot_patch";
      slot_updates: Record<string, unknown>;
    }
  | {
      type: "task_command";
      command: "pause" | "resume" | "cancel" | "start_new" | "continue_planning";
    }
  | {
      type: "handoff";
      route: string;
    };

export interface AgentChoiceOptionV2 {
  id: string;
  label: string;
  payload: AgentChoicePayload;
}

export type AgentChoiceKindV2 = "clarifying" | "multi_select" | "next_step";

export interface AgentChoicesV2 {
  schema_version: 2;
  question_id: string;
  kind: AgentChoiceKindV2;
  prompt: string;
  required_slot_keys: string[];
  options: AgentChoiceOptionV2[];
}

export interface AgentChoiceSubmissionV2 {
  question_id: string;
  option_ids: string[];
  free_text?: string;
}

const AFFIRMATIVE_ONLY = /^(?:yes(?:,?\s+(?:do|continue|please|create).*)?|continue|do it|go ahead|proceed)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, max = 240): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

export function validateAgentChoicesV2(value: unknown): AgentChoicesV2 | null {
  if (!isRecord(value) || value.schema_version !== 2) return null;
  if (!boundedString(value.question_id) || !boundedString(value.prompt)) return null;
  if (!new Set(["clarifying", "multi_select", "next_step"]).has(value.kind as string)) return null;
  if (!Array.isArray(value.required_slot_keys) || value.required_slot_keys.some((key) => !boundedString(key))) return null;
  if (!Array.isArray(value.options) || value.options.length > 4) return null;
  const options: AgentChoiceOptionV2[] = [];
  const seen = new Set<string>();
  for (const rawOption of value.options) {
    if (!isRecord(rawOption) || !boundedString(rawOption.id) || !boundedString(rawOption.label, 100) || seen.has(rawOption.id)) return null;
    if (!isRecord(rawOption.payload)) return null;
    seen.add(rawOption.id);
    let payload: AgentChoicePayload;
    if (rawOption.payload.type === "slot_patch" && isRecord(rawOption.payload.slot_updates)) {
      payload = { type: "slot_patch", slot_updates: rawOption.payload.slot_updates };
    } else if (
      rawOption.payload.type === "task_command" &&
      new Set(["pause", "resume", "cancel", "start_new", "continue_planning"]).has(rawOption.payload.command as string)
    ) {
      payload = { type: "task_command", command: rawOption.payload.command as "pause" | "resume" | "cancel" | "start_new" | "continue_planning" };
    } else if (rawOption.payload.type === "handoff" && boundedString(rawOption.payload.route)) {
      payload = { type: "handoff", route: rawOption.payload.route };
    } else {
      return null;
    }
    options.push({ id: rawOption.id, label: rawOption.label, payload });
  }
  const choices: AgentChoicesV2 = {
    schema_version: 2,
    question_id: value.question_id,
    kind: value.kind as AgentChoiceKindV2,
    prompt: value.prompt,
    required_slot_keys: value.required_slot_keys as string[],
    options,
  };
  if (choices.required_slot_keys.length > 0) {
    if (choices.options.some((option) => AFFIRMATIVE_ONLY.test(option.label))) return null;
    if (choices.options.some((option) => option.payload.type !== "slot_patch")) return null;
  }
  if (choices.kind === "next_step" && choices.options.some((option) => option.payload.type === "slot_patch")) return null;
  return choices;
}

export function assertAgentChoicesV2(value: unknown): AgentChoicesV2 {
  const parsed = validateAgentChoicesV2(value);
  if (!parsed) throw new Error("AgentChoicesV2 payload is invalid");
  return parsed;
}

export function validateChoiceSubmission(value: unknown): AgentChoiceSubmissionV2 | null {
  if (!isRecord(value) || !boundedString(value.question_id) || !Array.isArray(value.option_ids)) return null;
  if (value.option_ids.length > 3 || value.option_ids.some((id) => !boundedString(id))) return null;
  if (value.free_text !== undefined && (typeof value.free_text !== "string" || value.free_text.trim().length === 0 || value.free_text.length > 4096)) return null;
  if (value.option_ids.length === 0 && value.free_text === undefined) return null;
  return {
    question_id: value.question_id,
    option_ids: value.option_ids as string[],
    ...(typeof value.free_text === "string" ? { free_text: value.free_text.trim() } : {}),
  };
}

export type AgentChoiceKind =
  | "brand_disambiguation"
  | "no_brand_handoff"
  | "clarifying"
  | "multi_select"
  | "next_step";

export interface AgentChoices {
  kind: AgentChoiceKind;
  prompt: string;
  options: { id: string; label: string }[];
}

const EDIT_DELETE_INTENT =
  /\b(edit|update|rename|change|modify|delete|remove|deactivate|archive)\b/i;
const BRAND_WORD = /\bbrand(s)?\b/i;
const CREATE_EVENT_INTENT =
  /\b(create|make|set up|setup|schedule|host|add|plan|start)\b/i;
const EVENT_OBJECT = /\b(event|experience|trip|gathering|party|show)s?\b/i;
const ARI_IS_ASKING = /\?/;
const MISSING_FIELD =
  /\b(when|where|what (?:date|time|name|title|price|location)|which (?:date|time|venue|location|city)|what(?:'s| is) (?:the )?(?:date|time|name|title|price|location))\b/i;
const MULTI_SELECT_CUE =
  /\b(pick all|select all that apply|which of these|choose any|all that apply)\b/i;
const NEXT_STEP_CUE =
  /\b(want me to|shall i|should i|next (?:i can|step)|add (?:your )?(?:first )?(?:event|ticket|cover)|publish (?:it|this)|schedule a (?:blast|campaign))\b/i;
const OPTION_LINE = /^\s*(?:[-*]|\d+[.)])\s+(.+?)\s*$/gm;

function parseListedOptions(text: string): { id: string; label: string }[] {
  const options: { id: string; label: string }[] = [];
  OPTION_LINE.lastIndex = 0;
  let m;
  let i = 0;
  while ((m = OPTION_LINE.exec(text)) && i < 8) {
    const label = m[1].replace(/^["']|["']$/g, "").trim();
    if (label.length > 0 && label.length < 80) {
      options.push({ id: `opt_${i}`, label });
      i++;
    }
  }
  return options;
}

function firstQuestion(text: string): string {
  const idx = text.indexOf("?");
  if (idx < 0) return text.slice(0, 140).trim();
  const start = Math.max(0, text.lastIndexOf("\n", idx));
  return text.slice(start, idx + 1).trim().slice(0, 200);
}

/**
 * Returns a presentational choices payload for a TEXT turn, or undefined.
 * Conservative: existing brand/handoff detectors win first.
 */
export function detectChoices(
  userMessage: string,
  ariText: string,
  brands: BrandSummary[],
): AgentChoices | undefined {
  const msg = userMessage;

  if (
    brands.length >= 2 &&
    EDIT_DELETE_INTENT.test(msg) &&
    BRAND_WORD.test(msg) &&
    ARI_IS_ASKING.test(ariText)
  ) {
    return {
      kind: "brand_disambiguation",
      prompt: "Which brand?",
      options: brands.slice(0, 8).map((b) => ({ id: b.id, label: b.name })),
    };
  }

  if (
    brands.length === 0 &&
    CREATE_EVENT_INTENT.test(msg) &&
    EVENT_OBJECT.test(msg)
  ) {
    return {
      kind: "no_brand_handoff",
      prompt: "Create a brand first?",
      options: [
        { id: "yes", label: "Yes, create a brand" },
        { id: "no", label: "Not now" },
      ],
    };
  }

  if (MULTI_SELECT_CUE.test(ariText)) {
    const options = parseListedOptions(ariText);
    if (options.length >= 2) {
      return {
        kind: "multi_select",
        prompt: firstQuestion(ariText) || "Pick all that apply",
        options,
      };
    }
  }

  if (ARI_IS_ASKING.test(ariText) && MISSING_FIELD.test(ariText)) {
    return {
      kind: "clarifying",
      prompt: firstQuestion(ariText),
      options: [],
    };
  }

  if (NEXT_STEP_CUE.test(ariText) && ARI_IS_ASKING.test(ariText)) {
    const listed = parseListedOptions(ariText);
    const options = listed.length >= 1
      ? listed
      : [
        { id: "yes", label: "Yes, do that" },
        { id: "no", label: "Not now" },
      ];
    return {
      kind: "next_step",
      prompt: firstQuestion(ariText) || "Next step?",
      options: options.slice(0, 6),
    };
  }

  return undefined;
}
