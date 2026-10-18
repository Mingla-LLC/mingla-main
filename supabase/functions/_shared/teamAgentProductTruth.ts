// Issue #3720 Completion Wave 5 — optional Product Truth connector tool.
//
// The established #3802 tool registry remains byte-stable for its own
// append-only contract. This small extension is offered only when the gateway
// says the key owner can use the Feature Guide. The database repeats that
// authorization on every call; hiding the tool is not the security boundary.

import type { TeamAgentTool } from "./teamAgentTools.ts";

const READ = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
} as const;

export const TEAM_AGENT_PRODUCT_TRUTH_TOOLS: readonly TeamAgentTool[] = [{
  name: "find_capabilities",
  title: "Find verified capabilities",
  description:
    "Search the Mingla Feature Guide. Cite the returned current evidence and verification time. " +
    "Treat Needs review as unverified and never claim it is Live. If your person asks for copy, " +
    "write it through save_drafts for their review; it never sends or publishes anything.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        maxLength: 160,
        hint:
          "Send up to 160 characters from the capability, surface or outcome",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        hint: "Send a whole number from 1 to 50",
      },
    },
    required: [],
    additionalProperties: false,
  },
  annotations: READ,
  reaches: ["issue_3720_list_feature_guide"],
  writes: false,
  adminOnly: false,
  peopleText: true,
  group: "Find and check",
}];

const PRODUCT_TRUTH_BY_NAME = new Map(
  TEAM_AGENT_PRODUCT_TRUTH_TOOLS.map((tool) => [tool.name, tool]),
);

export function findProductTruthTool(name: unknown): TeamAgentTool | undefined {
  return typeof name === "string" ? PRODUCT_TRUTH_BY_NAME.get(name) : undefined;
}

export function productTruthToolsForMe(me: unknown): TeamAgentTool[] {
  if (typeof me !== "object" || me === null || Array.isArray(me)) return [];
  return (me as Record<string, unknown>).feature_guide === true
    ? [...TEAM_AGENT_PRODUCT_TRUTH_TOOLS]
    : [];
}
