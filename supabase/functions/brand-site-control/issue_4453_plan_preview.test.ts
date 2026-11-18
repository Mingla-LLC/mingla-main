/*
 * #4453 milestone 10 — Core's half of the pre-build plan preview:
 *   - SITES_PLAN_PREVIEW off: the route is NOT_AVAILABLE and the plan read is
 *     byte-for-byte what it was (no `plan_preview` key);
 *   - on: the plan gate is the user RPC, the revision must match, a ✕ style is
 *     refused before anything is counted, the rate limit is Core's, the feed is
 *     read BY BRAND, and the only RPCs called are reads plus the counter;
 *   - the picks are deterministic and never a ✕ style.
 *
 * invariant: I-SITES-PLAN-PREVIEW-WRITES-NOTHING (Core side: no write RPC; the
 * Studio side is pinned in mingla-site-cms/src/lib/planPreview.issue4453.test.ts).
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleSitePlanRoute, type SitePlanContext } from "./sitePlan.ts";
import { planPreviewPicks } from "../_shared/siteContracts/planPreview.ts";
import { FORMAT_KEYS, styleFitLevel } from "../_shared/siteContracts/formats.ts";

const BRAND = "44530000-0000-4000-8000-0000000010b1";
const USER = "44530000-0000-4000-8000-0000000010a1";
const TRIP = "44530000-0000-4000-8000-0000000010f1";
type Call = { fn: string; args: Record<string, unknown> };
const inputs = {
  brand_id: BRAND, site_id: null, revision: 7, offerings_selected: ["trips"], venue_descriptor: null,
  story: { main_action: "Reserve the next trip" }, value_points: [], faq: [], process_steps: null, quick_facts: null,
  brand: { name: "Young and Stamped", description: "Go far. Go together.", city: "London", contact_email: "hi@example.com" },
};
const READS = new Set(["brand_site_plan_preview_on", "brand_site_plan_preview_inputs", "brand_site_live_fingerprints",
  "brand_site_plan_preview_take", "brand_site_offerings_feed_for_brand", "brand_site_plan_get", "brand_site_flag_on",
  "brand_context_completeness", "brand_site_compose_facts", "brand_site_compose_facts_for_brand",
  "brand_site_offering_dates_for_brand", "brand_site_venue_slots_for_brand", "brand_site_ticket_tiers_for_brand"]);

function ctx(opts: { on: boolean; allowed?: boolean }, calls: Call[], sent: Record<string, unknown>[]): SitePlanContext {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (fn === "brand_site_plan_preview_on") return { data: opts.on, error: null };
    if (fn === "brand_site_flag_on") return { data: false, error: null };
    if (fn === "brand_site_plan_preview_inputs") return { data: inputs, error: null };
    if (fn === "brand_site_live_fingerprints") return { data: [], error: null };
    if (fn === "brand_site_plan_preview_take") return { data: { allowed: opts.allowed !== false }, error: null };
    if (fn === "brand_site_offerings_feed_for_brand") {
      return { data: { generated_at: "2026-11-16T10:00:00.000Z", brand: { slug: "youngandstamped" }, offerings: [{ id: TRIP, kind: "trip", start_at: "2099-01-01T00:00:00Z", end_at: "2099-01-08T00:00:00Z" }] }, error: null };
    }
    if (fn === "brand_site_plan_get") return { data: { plan: { brand_id: BRAND } }, error: null };
    // The brand twins answer exactly what the site reads would once the site exists.
    if (fn === "brand_site_compose_facts_for_brand") return { data: { venues: {}, published_menu: false, mingla_reviews: 12 }, error: null };
    if (fn === "brand_site_offering_dates_for_brand") {
      return { data: { days: [{ local_date: "2099-01-01", slots: [{ state: "open" }, { state: "few" }, { state: "full" }] }] }, error: null };
    }
    return { data: null, error: null };
  };
  return {
    userId: USER,
    userRpc: rpc,
    serviceRpc: rpc,
    callCms: async (args) => {
      sent.push(args as unknown as Record<string, unknown>);
      return new Response(JSON.stringify({ ok: true, data: { previews: [{ key: "plan-previews/x", style: "voyage" }], preview_origin: "https://preview.sites.usemingla.com", generated_at: "2026-11-16T10:00:00.000Z" } }), { status: 200 });
    },
  };
}
const route = `/v1/brands/${BRAND}/plan-previews`;

Deno.test("#4453 M10 flag off: the route is NOT_AVAILABLE and the plan read has no plan_preview key", async () => {
  const calls: Call[] = []; const sent: Record<string, unknown>[] = [];
  const res = await handleSitePlanRoute(route, "POST", { plan_revision: 7 }, ctx({ on: false }, calls, sent));
  assertEquals(res?.status, 404);
  assertEquals(((await res!.json()) as { error: { code: string } }).error.code, "NOT_AVAILABLE");
  assertEquals(sent.length, 0);
  assert(!calls.some((call) => call.fn === "brand_site_plan_preview_take"), "nothing counted while off");
  const get = await handleSitePlanRoute(`/v1/brands/${BRAND}/site-plan`, "GET", {}, ctx({ on: false }, [], []));
  const body = await get!.json() as { data: Record<string, unknown> };
  assert(!("plan_preview" in body.data), "flag off: the plan read is unchanged");
  const getOn = await handleSitePlanRoute(`/v1/brands/${BRAND}/site-plan`, "GET", {}, ctx({ on: true }, [], []));
  assertEquals(((await getOn!.json()) as { data: Record<string, unknown> }).data.plan_preview, true);
});

Deno.test("#4453 M10 a stale revision and a ✕ style are refused before anything is counted", async () => {
  const calls: Call[] = []; const sent: Record<string, unknown>[] = [];
  const stale = await handleSitePlanRoute(route, "POST", { plan_revision: 6 }, ctx({ on: true }, calls, sent));
  assertEquals(stale?.status, 409);
  const avoid = await handleSitePlanRoute(route, "POST", { plan_revision: 7, styles: ["pulse"] }, ctx({ on: true }, calls, sent));
  assertEquals(avoid?.status, 400, "Pulse is ✕ for trips");
  const four = await handleSitePlanRoute(route, "POST", { plan_revision: 7, styles: ["voyage", "terra", "journal", "haven"] }, ctx({ on: true }, calls, sent));
  assertEquals(four?.status, 400);
  assert(!calls.some((call) => call.fn === "brand_site_plan_preview_take"));
  assertEquals(sent.length, 0);
});

Deno.test("#4453 M10 the rate limit is Core's: refused with PLAN_PREVIEW_RATE_LIMITED and no Studio call", async () => {
  const calls: Call[] = []; const sent: Record<string, unknown>[] = [];
  const res = await handleSitePlanRoute(route, "POST", { plan_revision: 7 }, ctx({ on: true, allowed: false }, calls, sent));
  assertEquals(res?.status, 429);
  const body = await res!.json() as { error: { code: string; message: string } };
  assertEquals(body.error.code, "PLAN_PREVIEW_RATE_LIMITED");
  assertEquals(body.error.message, "Try again in a minute.");
  assertEquals(sent.length, 0);
});

Deno.test("#4453 M10 a preview reads by brand, writes nothing, and sends Studio Ari's three picks", async () => {
  const calls: Call[] = []; const sent: Record<string, unknown>[] = [];
  const res = await handleSitePlanRoute(route, "POST", { plan_revision: 7 }, ctx({ on: true }, calls, sent));
  assertEquals(res?.status, 200);
  const body = await res!.json() as { data: { picks: { key: string }[]; format: string; skipped_line: string; previews: unknown[] } };
  assertEquals(body.data.format, "trips");
  assertEquals(body.data.picks.map((pick) => pick.key), ["voyage", "terra", "journal"]);
  assert(body.data.skipped_line.startsWith("Ari skipped"));
  for (const call of calls) assert(READS.has(call.fn), `only reads and the counter: ${call.fn}`);
  assert(!calls.some((call) => call.fn === "brand_site_offerings_feed"), "the feed is read by brand");
  assertEquals(sent.length, 1);
  const args = sent[0] as { siteId: string; path: string; payload: Record<string, unknown> };
  assertEquals(args.path, "/api/internal/plan-preview");
  assertEquals(args.siteId, BRAND);
  assertEquals(args.payload.kind, "plan_preview");
  assertEquals(args.payload.styles, ["voyage", "terra", "journal"]);
  assertEquals((args.payload.facts as { upcoming: { trip: number } }).upcoming.trip, 1);
  // SC-PP4 (tester P1-2): no site yet, so the BRAND twins of Build's fact reads run,
  // and the facts Studio composes with equal what Build will read once the site exists.
  assert(!calls.some((call) => "p_site_id" in call.args), "no site yet: no site-scoped reads");
  assert(calls.some((call) => call.fn === "brand_site_compose_facts_for_brand" && call.args.p_brand_id === BRAND), "brand compose facts read");
  const dates = calls.find((call) => call.fn === "brand_site_offering_dates_for_brand");
  assertEquals(dates?.args, { p_brand_id: BRAND, p_offering_id: TRIP, p_source: "trip_departures", p_days: 14 });
  const facts = args.payload.facts as { bookable: { trip?: number }; mingla_reviews: number };
  assertEquals(facts.bookable.trip, 2, "open dates counted exactly as Build counts them (openCount)");
  assertEquals(facts.mingla_reviews, 12);
});

Deno.test("#4453 M10 the picks are deterministic and never a ✕ style, for every format", () => {
  for (const format of FORMAT_KEYS) {
    const a = planPreviewPicks(format, {});
    assertEquals(a, planPreviewPicks(format, {}));
    assertEquals(a.length, 3);
    for (const pick of a) assert(styleFitLevel(format, pick.key) !== "avoid", `${format}: ${pick.key}`);
  }
});
