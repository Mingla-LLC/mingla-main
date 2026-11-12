/**
 * Issue #3355 ship-prep — what the model is offered on a turn, by the
 * "Ari understands first" rollout switch (ariRollout.ts).
 *
 * Switch on: the current registry (AGENT_TOOLS) with the generated per-tool
 * descriptions (ariToolDescriptions.ts), the Feature Guide search tool and
 * remember_note.
 *
 * Switch off: the tool list and declarations production runs today
 * (origin/main 811c033211): each tool's own short description, no
 * search_mingla_guide, save_memory_note instead of remember_note, the
 * owner-note tool without the "Ask the Mingla team" topic, and the old
 * capability map behind search_capabilities. Same order, same schemas.
 *
 * [TRANSITIONAL] off path — exit: rollout ari-understand-first-3355 active at
 * 100% for every brand; then this module collapses to AGENT_TOOLS.
 *
 * MINGLA-INVARIANT: I-ARI-GUIDE-ONLY-WHEN-ON | issue #3355 | search_mingla_guide is offered, pre-read and forced (refusal recovery, stuck-host reads) only when the rollout switch covers the turn's brand (enforced by supabase/functions/_shared/__tests__/issue_3355_ship_prep_gating.implementor.test.ts).
 */

import { AGENT_TOOLS, findTool, isAgentStateToolCall } from "./agentTools.ts";
import type { AgentTool, AgentToolDefinition } from "./agentToolHelpers.ts";
import {
  ARI_LEGACY_SEARCH_CAPABILITIES,
  legacySaveMemoryNoteExecutor,
} from "./agentAri10xTools.ts";
import { secureLegacyAgentTools } from "./agentToolAuthorization.ts";
import { ariToolDeclarations } from "./ariToolDescriptions.ts";
import type { AgentLoopNormalizedError } from "./agentLoop.ts";
import { withTicketsSold } from "./ariEventSales.ts";

/** Tools that exist only on the switch's on path. */
export const ARI_UNDERSTAND_FIRST_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "search_mingla_guide",
]);

/**
 * origin/main's memory write (811c033211), offered only on the off path; not
 * part of the registry (AGENT_TOOLS), so it is declared here.
 */
const LEGACY_SAVE_MEMORY_NOTE: AgentToolDefinition = {
  name: "save_memory_note",
  description:
    "Save an explicit approved preference, correction, business fact or working style. Do not infer sensitive facts.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["kind", "content"],
    properties: {
      brand_id: { type: "string", format: "uuid", nullable: true },
      kind: {
        type: "string",
        enum: ["preference", "correction", "business_fact", "workflow"],
      },
      content: { type: "string", minLength: 1, maxLength: 1200 },
      evidence_message_id: { type: "string", format: "uuid", nullable: true },
    },
  },
  executor: legacySaveMemoryNoteExecutor,
};

/** origin/main's owner-note declaration (no ask_mingla_team topic). */
const LEGACY_TELL_OWNER = {
  description:
    "After the teammate confirms, post one note in the brand's group chat asking the owner to do an owner-only step (payment setup). Sent as the teammate. The server writes the exact words; never write your own. Offer it when open_handoff returns requires_owner with tell_owner.via brand_group; when it says team_screen, say its message and link the Team screen instead.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["brand_id", "about"],
    properties: {
      brand_id: { type: "string", format: "uuid" },
      about: { type: "string", enum: ["payment_setup"] },
      send_to: { type: "string", maxLength: 200 },
      message: { type: "string", maxLength: 600 },
    },
  } as Record<string, unknown>,
};

const LEGACY_REPLACEMENTS: ReadonlyMap<string, AgentTool> = new Map(
  secureLegacyAgentTools([
    LEGACY_SAVE_MEMORY_NOTE,
    ARI_LEGACY_SEARCH_CAPABILITIES,
  ]).map((tool) => [
    tool.name === "save_memory_note" ? "remember_note" : tool.name,
    tool,
  ]),
);

/** The legacy registry, in origin/main's order. Built once. */
const LEGACY_AGENT_TOOLS: readonly AgentTool[] = Object.freeze(
  AGENT_TOOLS.flatMap((tool): AgentTool[] => {
    if (ARI_UNDERSTAND_FIRST_ONLY_TOOLS.has(tool.name)) return [];
    const replacement = LEGACY_REPLACEMENTS.get(tool.name);
    if (replacement) return [replacement];
    if (tool.name === "tell_owner_in_brand_group") {
      return [{
        ...tool,
        description: LEGACY_TELL_OWNER.description,
        parameters: LEGACY_TELL_OWNER.parameters,
      }];
    }
    return [tool];
  }),
);

/**
 * #3355 rework 9 (fix 5, I-ARI-SOLD-COUNT-FROM-TICKETS): on the on path,
 * list_events labels each row's ticket numbers (ticket types vs tickets
 * sold, read as the caller). Same name, schema and authorization; only the
 * result is labelled (ariEventSales.ts). The off path keeps main's row.
 */
function withLabelledTickets(tool: AgentTool): AgentTool {
  return {
    ...tool,
    executor: async (args, client, userId, context) =>
      await withTicketsSold(
        await tool.executor(args, client, userId, context),
        client,
      ),
  };
}

/** The on path's registry: AGENT_TOOLS, with list_events labelled. */
const UNDERSTAND_FIRST_AGENT_TOOLS: readonly AgentTool[] = Object.freeze(
  AGENT_TOOLS.map((tool) =>
    tool.name === "list_events" ? withLabelledTickets(tool) : tool
  ),
);

/** The registry this turn's model may see and call. */
export function ariTurnAgentTools(understandFirst: boolean): AgentTool[] {
  return understandFirst
    ? [...UNDERSTAND_FIRST_AGENT_TOOLS]
    : [...LEGACY_AGENT_TOOLS];
}

/** A tool by name, from this turn's registry. */
export function findAriTurnTool(
  name: string,
  understandFirst: boolean,
): AgentTool | undefined {
  return understandFirst
    ? (name === "list_events"
      ? UNDERSTAND_FIRST_AGENT_TOOLS.find((tool) => tool.name === name)
      : findTool(name))
    : LEGACY_AGENT_TOOLS.find((tool) => tool.name === name);
}

/** Reversible Ari-owned state on this turn (save_memory_note when off). */
export function isAriTurnAgentStateCall(
  name: string,
  understandFirst: boolean,
): boolean {
  if (!understandFirst && name === "remember_note") return false;
  if (!understandFirst && name === "save_memory_note") return true;
  return isAgentStateToolCall(name);
}

interface DeclarableTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** The declarations sent to the model for this turn's tools. */
export function ariTurnToolDeclarations(
  tools: readonly DeclarableTool[],
  understandFirst: boolean,
): DeclarableTool[] {
  if (understandFirst) return ariToolDeclarations(tools);
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

/**
 * A failed tool as the model sees it. Off: origin/main's observation (code,
 * message, recoverable) without the Wave B user_reason / next_step.
 */
export function ariTurnToolError(
  normal: AgentLoopNormalizedError,
  understandFirst: boolean,
): AgentLoopNormalizedError {
  if (understandFirst) return normal;
  return {
    code: normal.code,
    message: normal.message,
    recoverable: normal.recoverable,
  };
}
