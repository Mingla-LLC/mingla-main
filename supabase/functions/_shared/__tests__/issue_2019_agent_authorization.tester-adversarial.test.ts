const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };

Deno.test("#2019 tester: proposal and confirmation authorization ordering is fail-closed", async () => {
  const chat = await read("agent-chat/index.ts");
  const confirm = await read("agent-confirm-action/index.ts");
  const proposalAuth = chat.indexOf("await authorizeAgentTool(tool, gemini.toolCall.args");
  const pendingInsert = chat.indexOf('.from("agent_pending_actions")', proposalAuth);
  assert(proposalAuth > 0 && pendingInsert > proposalAuth, "proposal persisted before authorization");
  const finalArgs = confirm.indexOf("const finalArgs");
  const confirmAuth = confirm.indexOf("await authorizeAgentTool(tool, finalArgs");
  const executing = confirm.indexOf('status: "executing"', confirmAuth);
  assert(finalArgs > 0 && confirmAuth > finalArgs && executing > confirmAuth, "final args not authorized before executing");
});

Deno.test("#2019 tester: no duplicate owner/rank helper or service-role authorization", async () => {
  const files = await Promise.all([
    read("_shared/agentToolHelpers.ts"), read("_shared/agentTools.ts"),
    read("_shared/agentDomainTools.ts"), read("_shared/agentToolAuthorization.ts"),
  ]);
  const source = files.join("\n");
  assert(!source.includes("assertBrandOwned"), "owner-only helper remains");
  assert(!source.includes("assertEventOwned"), "owner-only event helper remains");
  assert(!source.includes("biz_brand_effective_rank\""), "non-caller-bound rank RPC remains");
  assert(!source.includes("service_role"), "service role appears in authorization surface");
  assert(!/\b(owner|account_owner)\s*:\s*\d+/.test(source), "stale/local role map remains");
});

Deno.test("#2019 tester: every registry writer is wrapped and reauthorized", async () => {
  const tools = await read("_shared/agentTools.ts");
  const auth = await read("_shared/agentToolAuthorization.ts");
  assert(tools.includes("secureAgentTools(["), "runtime registry bypasses wrapper");
  assert(auth.includes("await authorizeAgentTool({ ...declaration, name: definition.name }"), "executor wrapper lacks reauth");
  assert(auth.includes("biz_brand_effective_rank_for_caller"), "caller-bound authority missing");
  assert(auth.includes('rpc("biz_role_rank"'), "canonical required-rank authority missing");
});
