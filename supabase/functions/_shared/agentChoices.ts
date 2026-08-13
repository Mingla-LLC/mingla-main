// #1970 / #424 Wave 0 — presentational suggested-replies detector.
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
