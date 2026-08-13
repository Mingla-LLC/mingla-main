// deno-lint-ignore-file no-explicit-any require-await
import { AGENT_TOOLS } from "../agentTools.ts";
import { AGENT_TOOL_AUTHORIZATION, authorizeAgentTool, secureAgentTools } from "../agentToolAuthorization.ts";
import { ToolError } from "../agentToolHelpers.ts";

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const UUID = "11111111-1111-4111-8111-111111111111";

Deno.test("#2019 registry is exact, duplicate-free, and fully declared", () => {
  assert(AGENT_TOOLS.length === 64, `expected 64 tools, got ${AGENT_TOOLS.length}`);
  assert(new Set(AGENT_TOOLS.map((t) => t.name)).size === 64, "duplicate tool");
  assert(Object.keys(AGENT_TOOL_AUTHORIZATION).length === 64, "authorization registry drift");
  for (const tool of AGENT_TOOLS) {
    const expected = AGENT_TOOL_AUTHORIZATION[tool.name];
    assert(expected?.requiredRole === tool.requiredRole, `${tool.name}: role drift`);
    assert(expected?.resource === tool.resource, `${tool.name}: resource drift`);
    assert(!["owner", "account_owner"].includes(tool.requiredRole), `${tool.name}: stale role accepted`);
  }
});

Deno.test("#2019 declarations exactly translate the accepted capability ledger", async () => {
  const ledger = JSON.parse(await Deno.readTextFile(
    new URL("../../../../docs/contracts/ari-capability-ledger.json", import.meta.url),
  ));
  const translate: Record<string, string> = {
    business_user: "business_user", self: "self", brand_member: "scanner",
    owner_or_marketing_manager: "marketing_manager", owner_or_finance_manager: "finance_manager",
    owner_or_event_manager: "event_manager", owner_or_manager: "event_manager",
    owner_or_admin: "brand_admin", owner: "deed_owner",
  };
  const rows = ledger.capabilities.filter((row: any) => AGENT_TOOL_AUTHORIZATION[row.ari_tool]);
  assert(rows.length === 64, `expected 64 ledger rows, got ${rows.length}`);
  for (const row of rows) {
    assert(
      AGENT_TOOL_AUTHORIZATION[row.ari_tool].requiredRole === translate[row.required_role],
      `${row.ari_tool}: ledger translation drift`,
    );
  }
});

function client(rank: number, required: number, deedOwner = false, rpcError = false): any {
  return {
    rpc(name: string) {
      if (rpcError) return Promise.resolve({ data: null, error: { message: "down" } });
      return Promise.resolve({ data: name === "biz_role_rank" ? required : rank, error: null });
    },
    from() {
      const q: any = {
        select: () => q, eq: (_key: string, value: string) => {
          if (_key === "account_id") q.owner = value;
          return q;
        }, is: () => q,
        maybeSingle: () => Promise.resolve({ data: deedOwner ? { id: UUID } : null, error: null }),
      };
      return q;
    },
  };
}

Deno.test("#2019 canonical role boundary is caller-bound and monotonic", async () => {
  const tool = { name: "create_event", requiredRole: "event_manager", resource: "brand" } as const;
  await authorizeAgentTool(tool, { brand_id: UUID }, client(40, 40), UUID);
  await authorizeAgentTool(tool, { brand_id: UUID }, client(50, 40), UUID);
  await authorizeAgentTool(
    { name: "get_payout_status", requiredRole: "finance_manager", resource: "brand" },
    { brand_id: UUID }, client(40, 30), UUID,
  );
  let denied = false;
  try { await authorizeAgentTool(tool, { brand_id: UUID }, client(30, 40), UUID); }
  catch (e) { denied = e instanceof ToolError && e.code === "ROLE_DENIED"; }
  assert(denied, "one-rank-below caller reached executor boundary");
});

Deno.test("#2019 authority outage fails closed and deed ownership is exact", async () => {
  const ranked = { name: "update_brand", requiredRole: "brand_admin", resource: "brand" } as const;
  let unavailable = false;
  try { await authorizeAgentTool(ranked, { brand_id: UUID }, client(60, 50, true, true), UUID); }
  catch (e) { unavailable = e instanceof ToolError && e.code === "ROLE_CHECK_UNAVAILABLE"; }
  assert(unavailable, "authority error fell back to owner");

  const deletion = { name: "delete_brand", requiredRole: "deed_owner", resource: "brand" } as const;
  let denied = false;
  try { await authorizeAgentTool(deletion, { brand_id: UUID }, client(60, 60, false), UUID); }
  catch (e) { denied = e instanceof ToolError && e.code === "BRAND_ACCESS_DENIED"; }
  assert(denied, "rank-60 non-deed owner could delete brand");
  await authorizeAgentTool(deletion, { brand_id: UUID }, client(0, 0, true), UUID);
});

Deno.test("#2019 full rank x operation-class matrix", async () => {
  const classes = [
    ["get_brand_analytics", "scanner", 10],
    ["draft_campaign", "marketing_manager", 20],
    ["get_payout_status", "finance_manager", 30],
    ["create_event", "event_manager", 40],
    ["update_brand", "brand_admin", 50],
  ] as const;
  const callerRanks = [0, 10, 20, 30, 40, 50, 60];
  for (const [name, requiredRole, threshold] of classes) {
    for (const actual of callerRanks) {
      let allowed = true;
      try {
        await authorizeAgentTool(
          { name, requiredRole, resource: "brand" },
          { brand_id: UUID }, client(actual, threshold), UUID,
        );
      } catch (error) {
        allowed = !(error instanceof ToolError && error.code === "ROLE_DENIED");
      }
      assert(allowed === (actual >= threshold), `${name}: rank ${actual} matrix mismatch`);
    }
  }
});

Deno.test("#2019 wrapped executor cannot be bypassed and catches revocation", async () => {
  let calls = 0;
  let currentRank = 40;
  const fake: any = {
    rpc(name: string) {
      return Promise.resolve({ data: name === "biz_role_rank" ? 40 : currentRank, error: null });
    },
  };
  const [secured] = secureAgentTools([{
    name: "create_event", description: "fixture",
    parameters: { type: "object", required: ["brand_id"], properties: { brand_id: { format: "uuid" } } },
    executor: async () => { calls++; return { reached: true }; },
  }, ...AGENT_TOOLS.filter((tool) => tool.name !== "create_event").map((tool) => ({
    name: tool.name, description: tool.description, parameters: tool.parameters, executor: tool.executor,
  }))]);
  await secured.executor({ brand_id: UUID }, fake, UUID);
  assert(calls === 1, "authorized executor did not reach domain boundary");
  currentRank = 0;
  let denied = false;
  try { await secured.executor({ brand_id: UUID }, fake, UUID); }
  catch (error) { denied = error instanceof ToolError && error.code === "ROLE_DENIED"; }
  assert(denied && calls === 1, "revoked caller reached domain boundary");
});
