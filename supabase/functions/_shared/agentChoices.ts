// ORCH-1103 REWORK 2 — presentational "suggested replies" detector.
//
// Detects the two conversational moments where Ari should surface tappable chips
// ON TOP of its prose (SPEC §6.ii disambiguation / §6.v no-brand handoff;
// DESIGN §5 / §7). This is PURELY presentational: tapping a chip sends its
// `label` as a normal user turn (Q2 — Gemini stays the sole proposer). It does
// NOT touch the tool-confirm contract. A miss = prose-only (graceful degrade);
// a false-positive = harmless extra chips whose labels just re-send as a turn.
//
// Extracted into a _shared module (not inline in agent-chat) so it's importable
// and unit-testable without invoking the edge function's Deno.serve handler.

import type { BrandSummary } from "./agentSystemPrompt.ts";

export interface AgentChoices {
  kind: "brand_disambiguation" | "no_brand_handoff";
  // A short label for screen readers / fallback; the visible question is Ari's prose.
  prompt: string;
  // Tapping option N sends options[N].label as the next user message.
  options: { id: string; label: string }[];
}

const EDIT_DELETE_INTENT =
  /\b(edit|update|rename|change|modify|delete|remove|deactivate|archive)\b/i;
const BRAND_WORD = /\bbrand(s)?\b/i;
const CREATE_EVENT_INTENT =
  /\b(create|make|set up|setup|schedule|host|add|plan|start)\b/i;
const EVENT_OBJECT = /\b(event|experience|trip|gathering|party|show)s?\b/i;
// Ari's text turn must read like a question (asking which brand) rather than a
// flat statement, so we don't decorate every reply.
const ARI_IS_ASKING = /\?/;

/**
 * Returns a presentational choices payload for a TEXT turn (Gemini answered with
 * text — i.e. it's asking a question, not proposing a write), or undefined.
 *
 * Detection is intent-keyword + state based and intentionally conservative.
 */
export function detectChoices(
  userMessage: string,
  ariText: string,
  brands: BrandSummary[],
): AgentChoices | undefined {
  const msg = userMessage;

  // (1) "Which brand?" disambiguation — the user expressed edit/delete intent
  // against "my brand" with no clear target, there are ≥2 brands, and Ari is
  // asking. Chips = the candidate brands; tapping one sends its name as the
  // next user turn (SPEC §6.ii Q2 — Gemini re-proposes with the resolved brand).
  if (
    brands.length >= 2 &&
    EDIT_DELETE_INTENT.test(msg) &&
    BRAND_WORD.test(msg) &&
    ARI_IS_ASKING.test(ariText)
  ) {
    return {
      kind: "brand_disambiguation",
      prompt: "Which brand?",
      // Names are already escaped at the prompt boundary; here they only ride
      // back to the client as plain chip labels (no prompt interpolation).
      options: brands.slice(0, 8).map((b) => ({ id: b.id, label: b.name })),
    };
  }

  // (2) No-brand → "create one?" handoff — the user asked to create an
  // event/experience/trip, they have ZERO brands, and Ari is explaining they
  // need a brand first. Chips = yes/no; "Yes…" sends a create-a-brand turn,
  // "Not now" backs off (SPEC §6.v, non-chaining).
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

  return undefined;
}
