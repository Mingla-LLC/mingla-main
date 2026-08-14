// ORCH-1146 adversarial compatibility, strengthened for #1973 canonical create.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findTool, ToolError } from "../agentTools.ts";

const BRAND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function mock() {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "biz_brand_effective_rank_for_caller" || fn === "biz_role_rank") return { data: 40, error: null };
      if (fn === "business_create_experience_graph") return { data: { event: { id: crypto.randomUUID(), status: "draft" } }, error: null };
      throw new Error(fn);
    },
    from: () => { throw new Error("direct writer forbidden"); },
  } as never;
  return { db, calls };
}

async function execute(c: ReturnType<typeof mock>, patch: Record<string, unknown>) {
  const tool = findTool("create_experience");
  assert(tool);
  return await tool.executor({ brand_id: BRAND, title: "Safe draft", narrative: "Enough description for this draft", ...patch }, c.db, USER);
}

Deno.test("ORCH-1146 ADV-1: explicit paid/free choice wins over suggestion inference", async () => {
  const c = mock();
  await execute(c, { is_free: false });
  const payload = c.calls.at(-1)?.args.p_payload as Record<string, unknown>;
  assertEquals(payload.is_free, false);
});

Deno.test("ORCH-1146 ADV-2: inferred parser tags are canonical, deduped and ordered", async () => {
  const c = mock();
  await execute(c, { intent_tags: ["GROUP activity", "romantic", "garbage", "group_activity"] });
  const payload = c.calls.at(-1)?.args.p_payload as Record<string, unknown>;
  assertEquals(payload.experience_intents, ["romantic", "group-fun"]);
});

Deno.test("ORCH-1146 ADV-3: oversized title fails before auth or write", async () => {
  const c = mock();
  await assertRejects(() => execute(c, { title: "x".repeat(121) }), ToolError, "at most 120");
  assertEquals(c.calls.length, 0);
});

Deno.test("ORCH-1146 ADV-4: arbitrary lifecycle and unknown arguments fail closed", async () => {
  const c = mock();
  await assertRejects(() => execute(c, { status: "live" }), ToolError, "status is not allowed");
  assertEquals(c.calls.length, 0);
});

