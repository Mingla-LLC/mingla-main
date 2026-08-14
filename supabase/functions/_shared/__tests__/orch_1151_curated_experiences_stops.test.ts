// ORCH-1151 compatibility, rewired by #1973 to one transactional experience graph.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findTool } from "../agentTools.ts";

const BRAND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function mock() {
  let payload: Record<string, unknown> | null = null;
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "biz_brand_effective_rank_for_caller" || fn === "biz_role_rank") return { data: 40, error: null };
      if (fn === "business_create_experience_graph") {
        payload = args.p_payload as Record<string, unknown>;
        return { data: { event: { id: crypto.randomUUID(), status: "draft" }, stops: payload.stops, dates: [] }, error: null };
      }
      throw new Error(fn);
    },
    from: () => { throw new Error("direct multi-write forbidden"); },
  } as never;
  return { db, getPayload: () => payload };
}

async function create(stops?: unknown[]) {
  const c = mock();
  const tool = findTool("create_experience");
  assert(tool);
  await tool.executor({
    brand_id: BRAND, title: "Curated route", narrative: "A canonical curated experience draft",
    intent_tags: ["group_activity"], ...(stops === undefined ? {} : { stops }),
  }, c.db, USER);
  return c.getPayload()!;
}

Deno.test("ORCH-1151 T1/T2: ordered menu/activity stops and prices reach one canonical call", async () => {
  const payload = await create([
    { name: "Starter", description: "First", price_cents: 1200 },
    { name: "Main", description: "Second", price_cents: 3600 },
    { name: "Dessert", description: "Third", price_cents: 900 },
  ]);
  const stops = payload.stops as Array<Record<string, unknown>>;
  assertEquals(stops.length, 3);
  assertEquals(stops.map((s) => s.stop_order), [0, 1, 2]);
  assertEquals(stops.map((s) => s.price_cents), [1200, 3600, 900]);
  assertEquals(payload.pricing_mode, "per_stop");
  assertEquals(payload.is_free, false);
});

Deno.test("ORCH-1151 T3/T4: no stops remains a private draft graph with no public dates", async () => {
  const payload = await create();
  assertEquals(payload.stops, []);
  assertEquals(payload.when, null);
  assertEquals(payload.multiDates, null);
  assert(!("published_at" in payload));
});

Deno.test("ORCH-1151 T5/T7/T8: free stop drafts preserve blank unknown location/media", async () => {
  const payload = await create([{ name: "Tea", price_cents: 0 }]);
  const stop = (payload.stops as Array<Record<string, unknown>>)[0];
  assertEquals(payload.is_free, true);
  assertEquals(stop.address, "");
  assertEquals(stop.place_id, null);
  assertEquals(stop.lat, null);
  assertEquals(stop.lng, null);
  assertEquals(stop.image_urls, []);
  assertEquals(stop.ai_description, undefined);
});

