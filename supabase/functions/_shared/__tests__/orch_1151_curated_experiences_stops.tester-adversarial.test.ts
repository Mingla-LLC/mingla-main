// ORCH-1151 adversarial compatibility, strengthened for #1973 strict graph input.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findTool, ToolError } from "../agentTools.ts";

const BRAND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function client() {
  let writes = 0;
  return {
    get writes() { return writes; },
    db: {
      rpc: async (fn: string, _args: Record<string, unknown>) => {
        if (fn === "biz_brand_effective_rank_for_caller" || fn === "biz_role_rank") return { data: 40, error: null };
        if (fn === "business_create_experience_graph") { writes += 1; return { data: { event: { id: crypto.randomUUID() } }, error: null }; }
        throw new Error(fn);
      },
      from: () => { throw new Error("direct table writer forbidden"); },
    } as never,
  };
}

function run(c: ReturnType<typeof client>, stops: unknown[]) {
  const tool = findTool("create_experience");
  assert(tool);
  return tool.executor({ brand_id: BRAND, title: "Strict stops", narrative: "Strict canonical stop validation", stops }, c.db, USER);
}

Deno.test("ORCH-1151 ADV-1: negative, fractional and string prices fail before any write", async () => {
  for (const price of [-1, 1.5, "100"]) {
    const c = client();
    await assertRejects(() => run(c, [{ name: "Stop", price_cents: price }]), ToolError, "price_cents");
    assertEquals(c.writes, 0);
  }
});

Deno.test("ORCH-1151 ADV-2: stop and media bounds fail before any write", async () => {
  const tooMany = client();
  await assertRejects(() => run(tooMany, Array.from({ length: 6 }, (_, i) => ({ name: `Stop ${i}`, price_cents: 0 }))), ToolError, "at most 5");
  assertEquals(tooMany.writes, 0);
  const longName = client();
  await assertRejects(() => run(longName, [{ name: "x".repeat(121), price_cents: 0 }]), ToolError, "at most 120");
  assertEquals(longName.writes, 0);
});

Deno.test("ORCH-1151 ADV-3: a valid mixed-price stop graph produces exactly one canonical write", async () => {
  const c = client();
  await run(c, [{ name: "Free", price_cents: 0 }, { name: "Paid", price_cents: 500 }]);
  assertEquals(c.writes, 1);
});

