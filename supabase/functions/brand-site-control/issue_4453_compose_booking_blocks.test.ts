// deno-lint-ignore-file require-await -- the fixture mirrors async RPC and HTTP
/*
 * #4453 Fault 2 — Build's compose call carries SITES_BOOKING_BLOCKS.
 *
 * Studio's page gate lets a signed request add a booking block only when Core
 * signed the flag in. The compose call never did, so composer v2's
 * availability / ticket-tier / how-it-works blocks failed the first page
 * write (409 BOOKING_BLOCKS_OFF, "We couldn't create your draft"). Core now
 * reads brand_site_booking_blocks_enabled() itself and sends
 * `booking_blocks: true` only when it is on (the caller can never set it).
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleSitePlanRoute, type SitePlanContext } from "./sitePlan.ts";

const BRAND = "44530000-0000-4000-8000-0000000000f1";
const USER = "44530000-0000-4000-8000-0000000000f2";
const SITE = "44530000-0000-4000-8000-0000000000f3";
const authorize = { site_id: SITE, brand_id: BRAND, offerings_selected: ["events", "experiences"], brand: { name: "Gameland" } };

function ctx(flag: { data?: unknown; error?: { message: string } | null }, sent: Record<string, unknown>[], calls: string[]): SitePlanContext {
  const rpc = async (fn: string) => {
    calls.push(fn);
    if (fn === "brand_site_plan_authorize_compose") return { data: authorize, error: null };
    if (fn === "brand_site_booking_blocks_enabled") return { data: flag.data ?? null, error: flag.error ?? null };
    return { data: null, error: null };
  };
  return {
    userId: USER,
    userRpc: rpc,
    serviceRpc: rpc,
    callCms: async ({ payload }) => {
      sent.push(payload);
      return new Response(JSON.stringify({ ok: true, data: { pages: ["home"] } }), { status: 200 });
    },
  };
}

async function build(flag: { data?: unknown; error?: { message: string } | null }, input: Record<string, unknown> = {}) {
  const sent: Record<string, unknown>[] = [];
  const calls: string[] = [];
  const res = await handleSitePlanRoute(`/v1/brands/${BRAND}/site/compose-from-plan`, "POST",
    { operation_id: crypto.randomUUID(), ...input }, ctx(flag, sent, calls));
  return { res, sent, calls };
}

Deno.test("#4453 compose sends booking_blocks: true while SITES_BOOKING_BLOCKS is on", async () => {
  const { res, sent, calls } = await build({ data: true });
  assertEquals(res?.status, 200);
  assertEquals(calls.includes("brand_site_booking_blocks_enabled"), true, "Core reads the flag itself");
  assertEquals(sent.length, 1);
  assertEquals(sent[0]!.booking_blocks, true);
});

Deno.test("#4453 compose sends no booking_blocks when the flag is off or cannot be read", async () => {
  for (const flag of [{ data: false }, { data: null }, { data: "true" }, { error: { message: "boom" } }]) {
    const { res, sent } = await build(flag);
    assertEquals(res?.status, 200);
    assertEquals("booking_blocks" in sent[0]!, false, JSON.stringify(flag));
  }
});

Deno.test("#4453 the caller cannot sign booking_blocks in", async () => {
  const { sent } = await build({ data: false }, { booking_blocks: true });
  assertEquals("booking_blocks" in sent[0]!, false);
});
