/*
 * #4453 milestone 7 — Core's half of Ari's design pass and composer v2:
 *   - Build sends Studio `design_pass` (and Draft review) ONLY while
 *     SITES_ARI_DESIGN_PASS covers the brand; with it off Build is unchanged;
 *   - the plan read carries SITES_STYLE_LIBRARY as Core's own value;
 *   - Mingla's facts are counts and ids from the feed and the booking reads,
 *     failing closed (0) when a read fails; no name, price or date is passed;
 *   - the design-pass actions are Studio designer actions Core gates.
 *
 * invariant: I-SITES-DESIGN-PASS-FLAGS-PER-BRAND (declared in
 * supabase/migrations/__tests__/issue_4453_ari_design_pass.implementor.pg17.test.sql).
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleSitePlanRoute, type SitePlanContext } from "./sitePlan.ts";
import { composeFacts, DESIGN_PASS_ACTIONS, openCount, planFormat } from "./designPass.ts";
import { ARI_CMS_ACTIONS, ARI_DESIGNER_ACTIONS } from "./siteAri.ts";

const BRAND = "44530000-0000-4000-8000-0000000000b1";
const SITE = "44530000-0000-4000-8000-0000000000d1";
const USER = "44530000-0000-4000-8000-0000000000a1";
const OP = "44530000-0000-4000-8000-0000000000e1";
const TRIP = "44530000-0000-4000-8000-0000000000f1";
const PAST = "44530000-0000-4000-8000-0000000000f2";

type Call = { fn: string; args: Record<string, unknown> };
const composeInputs = {
  site_id: SITE,
  brand_id: BRAND,
  design_key: "terra",
  offerings_selected: ["trips"],
  venue_descriptor: null,
  story: { why: "We go further together" },
  value_points: [{ title: "Two guides", sentence: "Two guides on every trip." }],
  faq: [{ question: "Fit?", answer: "Five hours a day." }],
  process_steps: null,
  quick_facts: null,
  brand: { name: "Young and Stamped", description: "Go far.", address: "1 High St", city: "London", contact_email: "hi@example.com" },
};

function ctx(flags: Record<string, boolean>, calls: Call[], sent: Record<string, unknown>[], failing: Set<string> = new Set()): SitePlanContext {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (failing.has(fn)) return { data: null, error: { message: "boom" } };
    if (fn === "brand_site_flag_on") return { data: flags[String(args.p_flag)] === true, error: null };
    if (fn === "brand_site_plan_authorize_compose") return { data: composeInputs, error: null };
    if (fn === "brand_site_plan_get") return { data: { plan: { brand_id: BRAND } }, error: null };
    if (fn === "brand_site_offerings_feed") {
      return { data: { offerings: [
        { id: TRIP, kind: "trip", start_at: "2099-01-01T00:00:00Z", end_at: "2099-01-08T00:00:00Z", title: "Porto", min_price_minor: 69000 },
        { id: PAST, kind: "trip", start_at: "2020-01-01T00:00:00Z", end_at: "2020-01-08T00:00:00Z" },
      ] }, error: null };
    }
    if (fn === "brand_site_compose_facts") return { data: { venues: {}, published_menu: false, live_stay_offerings: 0, mingla_reviews: 4 }, error: null };
    if (fn === "brand_site_offering_dates") return { data: { days: [{ state: "open" }, { state: "full" }, { state: "few" }] }, error: null };
    return { data: null, error: null };
  };
  return {
    userId: USER,
    userRpc: rpc,
    serviceRpc: rpc,
    callCms: async ({ payload }) => {
      sent.push(payload as Record<string, unknown>);
      return new Response(JSON.stringify({ ok: true, data: { pages: ["home", "trips", "about"] } }), { status: 200 });
    },
  };
}

Deno.test("#4453 M7 Build sends design_pass only while SITES_ARI_DESIGN_PASS covers the brand", async () => {
  const offSent: Record<string, unknown>[] = [];
  await handleSitePlanRoute(`/v1/brands/${BRAND}/site/compose-from-plan`, "POST", { operation_id: OP }, ctx({}, [], offSent));
  assertEquals(offSent.length, 1);
  assert(!("design_pass" in offSent[0]!), "design_pass sent with the flag off");

  const calls: Call[] = [];
  const onSent: Record<string, unknown>[] = [];
  const res = await handleSitePlanRoute(`/v1/brands/${BRAND}/site/compose-from-plan`, "POST", { operation_id: OP }, ctx({ SITES_ARI_DESIGN_PASS: true }, calls, onSent));
  assertEquals(res?.status, 200);
  const pass = onSent[0]!.design_pass as Record<string, any>;
  assertEquals(onSent[0]!.review_drafts, true);
  assertEquals(pass.design_key, "terra");
  assertEquals(pass.answers.faq, composeInputs.faq);
  assertEquals(pass.address, "1 High St");
  assertEquals(pass.facts.upcoming.trip, 1);
  assertEquals(pass.facts.ended.trip, 1);
  assertEquals(pass.facts.next_offering.trip, TRIP);
  assertEquals(pass.facts.bookable.trip, 2);
  // Facts carry no names, prices or dates for Studio to type.
  assert(!/Porto|69000|2099/.test(JSON.stringify(pass.facts)), "a fact leaked copy, a price or a date");
  const flag = calls.find((call) => call.fn === "brand_site_flag_on")!;
  assertEquals(flag.args, { p_flag: "SITES_ARI_DESIGN_PASS", p_brand_id: BRAND });
});

Deno.test("#4453 M7 a failed feed read fails the Build closed (never a half-informed composition)", async () => {
  const sent: Record<string, unknown>[] = [];
  const res = await handleSitePlanRoute(`/v1/brands/${BRAND}/site/compose-from-plan`, "POST", { operation_id: OP },
    ctx({ SITES_ARI_DESIGN_PASS: true }, [], sent, new Set(["brand_site_offerings_feed"])));
  assertEquals(res?.status, 503);
  assertEquals(sent.length, 0);
});

Deno.test("#4453 M7 the plan read carries SITES_STYLE_LIBRARY as Core's value", async () => {
  const on = await handleSitePlanRoute(`/v1/brands/${BRAND}/site-plan`, "GET", {}, ctx({ SITES_STYLE_LIBRARY: true }, [], []));
  assertEquals((await on!.json()).data.style_library, true);
  const off = await handleSitePlanRoute(`/v1/brands/${BRAND}/site-plan`, "GET", { style_library: true }, ctx({}, [], []));
  assertEquals((await off!.json()).data.style_library, false);
});

Deno.test("#4453 M7 facts fail closed and count only open entries", async () => {
  assertEquals(openCount({ days: [{ slots: [{ state: "open" }, { state: "full" }] }, { slots: [{ state: "few" }] }] }), 2);
  assertEquals(openCount(null), 0);
  const failing = async (fn: string) => ({ data: null, error: fn ? { message: "x" } : null });
  const facts = await composeFacts(failing, SITE, [{ id: TRIP, kind: "trip", start_at: "2099-01-01T00:00:00Z" }]);
  assertEquals(facts.bookable.trip, 0);
  assertEquals(facts.mingla_reviews, 0);
  assertEquals(facts.venue_id, {});
});

Deno.test("#4453 M7 the design-pass actions are designer actions Core routes and gates", () => {
  for (const action of DESIGN_PASS_ACTIONS) {
    assert(ARI_CMS_ACTIONS.has(action) && ARI_DESIGNER_ACTIONS.has(action), action);
  }
  assertEquals(planFormat({ offerings_selected: ["trips", "events"], venue_descriptor: null, story: { main_action: "Come to an event" }, design_key: null }), "events");
});
