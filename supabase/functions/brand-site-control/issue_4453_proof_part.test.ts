/*
 * #4453 PR 3 (content foundation) — Core's half of the setup part "What
 * guests say and where you've been" and of Draft review:
 *   - the setup routes call Core's service RPCs with the caller's own user id
 *     (never one the body names), map every refusal to a plain owner message
 *     (USE_WEBSITE_CONTENT, REVIEW_NOT_CONFIRMED, PAST_TRIP_NOT_ENDED), and a
 *     stale save comes back with the latest list;
 *   - Build sends Studio the staged entries only while SITES_PROOF_PART is on,
 *     never a review without its confirmer, and stamps only rows it sent;
 *   - UNREVIEWED_SECTIONS reaches the owner as a fixable 409 naming pages.
 *
 * invariant: I-SITES-NO-INVENTED-PROOF (declared in
 * supabase/migrations/20280723004453_issue_4453_website_proof_part.sql).
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleSitePlanRoute, materializedRows, type SitePlanContext } from "./sitePlan.ts";
import { unreviewedRefusal } from "./reviewGate.ts";

const BRAND = "44530000-0000-4000-8000-0000000000b1";
const USER = "44530000-0000-4000-8000-0000000000a1";
const OTHER = "44530000-0000-4000-8000-0000000000a9";
const ROW = "44530000-0000-4000-8000-0000000000c1";

type Call = { fn: string; args: Record<string, unknown> };
function ctx(answers: Record<string, { data?: unknown; error?: { message: string } | null }>, calls: Call[], cms?: (payload: Record<string, unknown>) => unknown): SitePlanContext {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    // The flag reads as on unless a case says otherwise.
    const answer = answers[fn] ?? (fn === "brand_site_proof_part_enabled" ? { data: true, error: null } : { data: null, error: null });
    return { data: answer.data ?? null, error: answer.error ?? null };
  };
  return {
    userId: USER,
    userRpc: rpc,
    serviceRpc: rpc,
    callCms: async ({ payload }) => new Response(JSON.stringify({ ok: true, data: cms ? cms(payload) : {} }), { status: 200 }),
  };
}

Deno.test("#4453 a staged review is saved as the caller, with the tick passed through", async () => {
  const calls: Call[] = [];
  const res = await handleSitePlanRoute(`/v1/brands/${BRAND}/setup-content`, "POST", {
    kind: "review", payload: { reviewer: "Tolu" }, confirmed_real: true, user_id: OTHER,
  }, ctx({ brand_site_setup_content_save: { data: { id: ROW } } }, calls));
  assertEquals(res?.status, 200);
  const saved = calls.find((call) => call.fn === "brand_site_setup_content_save")!;
  assertEquals(saved.args.p_user_id, USER);
  assertEquals(saved.args.p_confirmed_real, true);
  assertEquals(saved.args.p_kind, "review");
});

Deno.test("#4453 refusals are plain owner messages", async () => {
  for (const [message, code, status] of [
    ["sites_use_website_content", "USE_WEBSITE_CONTENT", 409],
    ["sites_review_not_confirmed", "REVIEW_NOT_CONFIRMED", 400],
    ["sites_setup_limit_reached", "SETUP_LIMIT_REACHED", 409],
    ["sites_forbidden", "FORBIDDEN", 403],
  ] as const) {
    const res = await handleSitePlanRoute(`/v1/brands/${BRAND}/setup-content`, "POST", { kind: "story", payload: { title: "x" } },
      ctx({ brand_site_setup_content_save: { error: { message } } }, []));
    const body = await res!.json();
    assertEquals([res!.status, body.error.code], [status, code]);
  }
  const trip = await handleSitePlanRoute(`/v1/brands/${BRAND}/past-trips`, "POST", {
    title: "Porto", where: "Porto", timezone: "Europe/London", start_date: "2026-11-15", end_date: "2026-11-16",
  }, ctx({ brand_site_setup_add_past_trip: { error: { message: "historical_trip_not_ended" } } }, []));
  const tripBody = await trip!.json();
  assertEquals(tripBody.error.code, "PAST_TRIP_NOT_ENDED");
  assertEquals(tripBody.error.message, "Past trips must have ended. Add upcoming trips from Create.");
});

Deno.test("#4453 a bad shape never reaches Core", async () => {
  const calls: Call[] = [];
  for (const input of [{ kind: "testimonial", payload: {} }, { kind: "review" }, { kind: "review", payload: {}, id: "x" }]) {
    const res = await handleSitePlanRoute(`/v1/brands/${BRAND}/setup-content`, "POST", input, ctx({}, calls));
    assertEquals(res?.status, 400);
  }
  const trip = await handleSitePlanRoute(`/v1/brands/${BRAND}/past-trips`, "POST", { title: "x", where: "y", timezone: "UTC", start_date: "15/11/2026", end_date: "2026-11-16" }, ctx({}, calls));
  assertEquals(trip?.status, 400);
  assertEquals(calls.filter((call) => call.fn !== "brand_site_proof_part_enabled").length, 0);
});

Deno.test("#4453 a stale save returns the latest list", async () => {
  const res = await handleSitePlanRoute(`/v1/brands/${BRAND}/setup-content`, "POST", { kind: "story", id: ROW, payload: { title: "x" }, updated_at: "2026-11-16T00:00:00Z" },
    ctx({ brand_site_setup_content_save: { error: { message: "sites_revision_conflict" } }, brand_site_setup_content_list: { data: { items: [] } } }, []));
  const body = await res!.json();
  assertEquals(res!.status, 409);
  assertEquals(body.error.code, "REVISION_CONFLICT");
  assertEquals(body.latest, { items: [] });
});

const authorize = { site_id: "44530000-0000-4000-8000-0000000000d1", brand_id: BRAND, offerings_selected: ["trips"], brand: { name: "Proof" } };

Deno.test("#4453 Build: flag off sends nothing new; flag on sends confirmed rows and stamps only those", async () => {
  const off: Record<string, unknown>[] = [];
  await handleSitePlanRoute(`/v1/brands/${BRAND}/site/compose-from-plan`, "POST", { operation_id: "44530000-0000-4000-8000-0000000000e1" },
    ctx({ brand_site_plan_authorize_compose: { data: authorize }, brand_site_proof_part_enabled: { data: false } }, [], (p) => { off.push(p); return { pages: ["home"] }; }));
  assertEquals("review_drafts" in off[0]!, false);
  assertEquals("setup_content" in off[0]!, false);

  const calls: Call[] = [];
  const sent: Record<string, unknown>[] = [];
  const res = await handleSitePlanRoute(`/v1/brands/${BRAND}/site/compose-from-plan`, "POST", { operation_id: "44530000-0000-4000-8000-0000000000e2" },
    ctx({
      brand_site_plan_authorize_compose: { data: authorize },
      brand_site_proof_part_enabled: { data: true },
      brand_site_setup_content_pending: { data: [
        { id: ROW, kind: "review", payload: { quote: "x" }, confirmed_real_by: USER },
        { id: "44530000-0000-4000-8000-0000000000c2", kind: "review", payload: { quote: "y" }, confirmed_real_by: null },
      ] },
    }, calls, (p) => { sent.push(p); return { pages: ["home"], materialized: [{ id: ROW, entry_id: "7" }, { id: OTHER, entry_id: "8" }] }; }));
  assertEquals(res?.status, 200);
  assertEquals(sent[0]!.review_drafts, true);
  assertEquals((sent[0]!.setup_content as unknown[]).length, 1);
  const stamp = calls.find((call) => call.fn === "brand_site_setup_content_mark_materialized");
  assertEquals(stamp?.args.p_rows, [{ id: ROW, entry_id: "7" }]);
});

Deno.test("#4453 materializedRows keeps only rows Core sent", () => {
  assertEquals(materializedRows([{ id: ROW.toUpperCase(), entry_id: 3 }, { id: OTHER, entry_id: "4" }, "x"], [{ id: ROW, kind: "review", payload: {}, confirmed_real_by: USER }]), [{ id: ROW, entry_id: "3" }]);
});

Deno.test("#4453 UNREVIEWED_SECTIONS is owner-fixable and names pages, not content", async () => {
  const res = unreviewedRefusal({ code: "UNREVIEWED_SECTIONS", pages: [{ path: "", title: "Home", count: 2, blocks: ["secret"] }] }, "op");
  assert(res);
  const body = await res.json();
  assertEquals(res.status, 409);
  assertEquals(body.error.reason_code, "UNREVIEWED_SECTIONS");
  assertEquals(body.error.message, "Review the sections marked Draft before you publish.");
  assertEquals(body.error.pages, [{ path: "", title: "Home", count: 2 }]);
  assertEquals(unreviewedRefusal({ code: "OTHER" }), null);
});

Deno.test("#4453 P1-3 with SITES_PROOF_PART off every setup-part route refuses and never reaches the RPC", async () => {
  for (const [path, method, input] of [
    [`/v1/brands/${BRAND}/setup-content`, "GET", {}],
    [`/v1/brands/${BRAND}/setup-content`, "POST", { kind: "story", payload: { title: "x" } }],
    [`/v1/brands/${BRAND}/past-trips`, "POST", { title: "Porto", where: "Porto", timezone: "Europe/London", start_date: "2025-04-01", end_date: "2025-04-05" }],
  ] as const) {
    const calls: Call[] = [];
    const res = await handleSitePlanRoute(path, method, input, ctx({ brand_site_proof_part_enabled: { data: false } }, calls));
    const body = await res!.json();
    assertEquals([res!.status, body.error.code], [404, "NOT_AVAILABLE"]);
    assertEquals(calls.map((call) => call.fn), ["brand_site_proof_part_enabled"]);
  }
});
