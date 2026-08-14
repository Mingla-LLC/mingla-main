// ORCH-1146 compatibility, rewired by #1973 to the canonical transactional owner.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findTool, ToolError } from "../agentTools.ts";

const BRAND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function client(options: { failCreate?: boolean } = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    db: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (fn === "biz_brand_effective_rank_for_caller") return { data: 40, error: null };
        if (fn === "biz_role_rank") return { data: 40, error: null };
        if (fn === "business_create_experience_graph") {
          if (options.failCreate) return { data: null, error: { message: "atomic_create_failed" } };
          const payload = args.p_payload as Record<string, unknown>;
          return {
            data: {
              event: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "draft", visibility: "draft", published_at: null },
              stops: payload.stops,
              ticket: { is_free: payload.is_free, quantity_total: payload.capacity },
              dates: [],
            },
            error: null,
          };
        }
        throw new Error(`unexpected rpc ${fn}`);
      },
      from: () => {
        throw new Error("canonical create must not perform direct table writes");
      },
    } as never,
  };
}

function createCall(c: ReturnType<typeof client>, args: Record<string, unknown>) {
  const tool = findTool("create_experience");
  assert(tool);
  return tool.executor({ brand_id: BRAND, title: "Canonical draft", narrative: "A complete canonical draft description", ...args }, c.db, USER);
}

Deno.test("ORCH-1146 T1/T2: canonical intents, currency, capacity and free state reach one atomic owner", async () => {
  const c = client();
  await createCall(c, {
    intent_tags: ["group_activity", "date_night_active"], currency: "NGN",
    capacity_max: 8, is_free: false, suggested_price_min_cents: 4000,
    suggested_price_max_cents: 6000,
  });
  const create = c.calls.find((x) => x.fn === "business_create_experience_graph");
  assert(create);
  const payload = create.args.p_payload as Record<string, unknown>;
  assertEquals(payload.experience_intents, ["romantic", "group-fun"]);
  assertEquals(payload.currency, "NGN");
  assertEquals(payload.capacity, 8);
  assertEquals(payload.is_free, false);
  assertEquals(payload.whole_price_cents, 5000);
});

Deno.test("ORCH-1146 T3/T5/T6: minimal draft fabricates no intent, date, cover or lifecycle", async () => {
  const c = client();
  const result = await createCall(c, { intent_tags: ["not-a-real-vibe"] }) as Record<string, unknown>;
  const create = c.calls.find((x) => x.fn === "business_create_experience_graph");
  const payload = create?.args.p_payload as Record<string, unknown>;
  assertEquals(payload.experience_intents, []);
  assertEquals(payload.timezone, null);
  assertEquals(payload.when, null);
  assertEquals(payload.multiDates, null);
  assertEquals(payload.cover, {});
  for (const forbidden of ["status", "visibility", "published_at", "deleted_at", "event_type"]) {
    assert(!(forbidden in payload));
  }
  assertEquals((result.event as Record<string, unknown>).status, "draft");
  assertEquals(result.dates, []);
});

Deno.test("ORCH-1146 T7: missing currency stays unresolved for the server/brand owner", async () => {
  const c = client();
  await createCall(c, {});
  const payload = c.calls.find((x) => x.fn === "business_create_experience_graph")?.args.p_payload as Record<string, unknown>;
  assertEquals(payload.currency, null);
});

Deno.test("ORCH-1146 T9: atomic owner failure returns WRITE_FAILED with zero fallback writes", async () => {
  const c = client({ failCreate: true });
  await assertRejects(() => createCall(c, {}), ToolError, "atomic_create_failed");
  assertEquals(c.calls.filter((x) => x.fn === "business_create_experience_graph").length, 1);
});

