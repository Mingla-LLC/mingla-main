import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createTeamAgentHandler } from "../teamAgentMcp.ts";
import {
  findProductTruthTool,
  productTruthToolsForMe,
  TEAM_AGENT_PRODUCT_TRUTH_TOOLS,
} from "../teamAgentProductTruth.ts";
import { checkArguments, TEAM_AGENT_TOOLS } from "../teamAgentTools.ts";

const KEY = "mgla_c_" + "p".repeat(43);
const URL_ = "https://example.test/functions/v1/team-agent";

function request(id: number, method: string, params: Record<string, unknown>) {
  return new Request(URL_, {
    method: "POST",
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

Deno.test("#3720 Product Truth tool is an additive, permission-scoped connector extension", () => {
  assertEquals(TEAM_AGENT_TOOLS.length, 26);
  assertEquals(TEAM_AGENT_PRODUCT_TRUTH_TOOLS.map((tool) => tool.name), [
    "find_capabilities",
  ]);
  assertEquals(productTruthToolsForMe({ feature_guide: false }), []);
  assertEquals(productTruthToolsForMe({ feature_guide: true }).length, 1);
  const tool = findProductTruthTool("find_capabilities")!;
  assert(tool.annotations.readOnlyHint);
  assert(!tool.writes);
  assertEquals(tool.reaches, ["issue_3720_list_feature_guide"]);
  assertMatch(tool.description, /Needs review/);
  assertMatch(tool.description, /save_drafts/);
  assertMatch(tool.description, /never sends or publishes/);
});

Deno.test("#3720 Product Truth arguments fail closed before the gateway", () => {
  const tool = findProductTruthTool("find_capabilities")!;
  assert(checkArguments(tool, { query: "Brand groups", limit: 10 }).ok);
  assert(!checkArguments(tool, { query: "x".repeat(161) }).ok);
  assert(!checkArguments(tool, { limit: 51 }).ok);
  assert(!checkArguments(tool, { query: "Files", promote: true }).ok);
});

Deno.test("#3720 tools/list exposes Product Truth only when the gateway confirms permission", async () => {
  const makeHandler = (allowed: boolean) =>
    createTeamAgentHandler({
      minRefusalMs: 0,
      gateway: async (_hash, tool) => ({
        ok: true,
        result: {},
        me: { role: "growth", agent: "codex", feature_guide: allowed },
        gateway_tool: tool,
      }),
    });
  const denied = await (await makeHandler(false)(
    request(1, "tools/list", {}),
  )).json();
  const allowed = await (await makeHandler(true)(
    request(2, "tools/list", {}),
  )).json();
  assert(
    !denied.result.tools.some((tool: { name: string }) =>
      tool.name === "find_capabilities"
    ),
  );
  assert(
    allowed.result.tools.some((tool: { name: string }) =>
      tool.name === "find_capabilities"
    ),
  );
});

Deno.test("#3720 find_capabilities reaches only the bounded read gateway", async () => {
  const seen: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const handler = createTeamAgentHandler({
    minRefusalMs: 0,
    gateway: async (_hash, tool, args) => {
      seen.push({ tool, args });
      return {
        ok: true,
        result: {
          capabilities: [{
            capability_key: "official-brand-groups",
            effective_status: "Live",
            evidence: [{
              kind: "live_check",
              url: "https://example.test/proof",
            }],
          }],
        },
        me: { role: "growth", agent: "codex", feature_guide: true },
      };
    },
  });
  const response = await handler(request(3, "tools/call", {
    name: "find_capabilities",
    arguments: { query: "Brand groups", limit: 5 },
  }));
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(seen, [{
    tool: "find_capabilities",
    args: { query: "Brand groups", limit: 5 },
  }]);
  assertMatch(body.result.content[0].text, /official-brand-groups/);
  assertMatch(body.result.content[0].text, /live_check/);
});

Deno.test("#3720 Edge routing keeps Product Truth on its service-only gateway", () => {
  const edge = Deno.readTextFileSync(
    new URL("../../team-agent/index.ts", import.meta.url),
  );
  assertMatch(
    edge,
    /const PRODUCT_TRUTH_TOOLS = new Set\(\[\s*"find_capabilities",\s*"mcp:tools\/list",\s*\]\)/,
  );
  assertMatch(
    edge,
    /PRODUCT_TRUTH_TOOLS\.has\(tool\)\s*\? "team_agent_product_truth_call"/,
  );
  assertMatch(
    edge,
    /CONTENT_TOOLS\.has\(tool\)\s*\? "team_agent_content_call"/,
  );
  assertMatch(edge, /: "team_agent_call"/);
});
