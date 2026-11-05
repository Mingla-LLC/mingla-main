// Issue #4276: the scorer never rescores a place whose AI result predates the backlog
// hold, for any caller and on every by-id path (the conductor, the venue claim approval,
// an admin). Its existing score is left untouched and it is reported as held_old_result.
// The hold date has one TypeScript home and two SQL homes; this pins all three equal.
//
// MINGLA-INVARIANT: I-4276-SCORE-STAGE-NEVER-RELEASES-HELD-AI | issue #4276 | The final-score stage never selects a place whose AI result predates the backlog hold, and the scorer leaves such a place's score untouched
//
// FAILS-ON-REVERT: remove the heldOld ids from readProtectedIds (or markHeld) in
// run-signal-scorer and the pre-hold place is upserted; change any of the three dates
// and the pin fails.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AI_SCORE_HOLD_SINCE, aiSliceIsHeld } from "../aiScoreHold.ts";

const SERVICE = "service-key";
Deno.env.set("SUPABASE_URL", "http://local.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE);

const OLD = "00000000-0000-4000-b000-000000000001";
const NEW = "00000000-0000-4000-b000-000000000002";
const PLAIN = "00000000-0000-4000-b000-000000000003";
const slice = (at: string | null) => ({ score_0_to_100: 90, inappropriate_for: false, reasoning: "x", prompt_version: "v4", ...(at ? { evaluated_at: at } : {}) });
const places = [
  { id: OLD, rating: 4.5, review_count: 300, types: ["bar"], ai_signal_scores: { drinks: slice("2026-09-01T00:00:00Z") } },
  { id: NEW, rating: 4.5, review_count: 300, types: ["bar"], ai_signal_scores: { drinks: slice("2026-11-20T00:00:00Z") } },
  { id: PLAIN, rating: 4.5, review_count: 300, types: ["bar"], ai_signal_scores: null },
];

const upserted: string[] = [];
const deleted: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const request = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(request.url);
  const path = url.pathname;
  const one = request.headers.get("accept")?.includes("vnd.pgrst.object");
  const body = (v: unknown) => Response.json(one && Array.isArray(v) ? v[0] ?? null : v);
  if (path === "/rest/v1/signal_definitions") {
    return body([{ id: "drinks", label: "Drinks", kind: "type-grounded", is_active: true, current_version_id: "v1" }]);
  }
  if (path === "/rest/v1/signal_definition_versions") {
    return body([{
      id: "v1", version_label: "v1",
      config: { min_rating: 0, min_reviews: 0, bypass_rating: 5, field_weights: {}, scale: { rating_multiplier: 2, rating_cap: 10, reviews_log_multiplier: 2, reviews_cap: 10 }, text_patterns: {}, cap: 200, clamp_min: 0, ai_blend_weight: 0.6 },
    }]);
  }
  if (path === "/rest/v1/place_pool") {
    const after = url.searchParams.get("id")?.startsWith("gt.") ? url.searchParams.get("id")!.slice(3) : null;
    return body(places.filter((p) => !after || p.id > after));
  }
  if (path === "/rest/v1/place_scores" && request.method === "GET") return body([]);
  if (path === "/rest/v1/place_scores" && request.method === "POST") {
    for (const r of JSON.parse(await request.text())) upserted.push(r.place_id);
    return new Response(null, { status: 201 });
  }
  if (path === "/rest/v1/place_scores" && request.method === "DELETE") {
    deleted.push(url.searchParams.toString());
    return new Response(null, { status: 204 });
  }
  return Response.json({ message: `unexpected ${request.method} ${path}` }, { status: 500 });
}) as typeof fetch;

const scorer = await import("../../run-signal-scorer/index.ts");
const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test({ name: "a pre-hold AI result is never rescored; newer and rules-only places are", ...opts, fn: async () => {
  upserted.length = 0;
  const res = await scorer.handler(new Request("http://local.test/x", {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ signal_id: "drinks", place_ids: [OLD, NEW, PLAIN] }),
  }));
  assertEquals(res.status, 200);
  const out = await res.json();
  assertEquals(out.held_old_result, 1);
  assertEquals(out.held_old_result_ids, [OLD]);
  assert(!upserted.includes(OLD), "the pre-hold place was rescored");
  assertEquals(upserted.sort(), [NEW, PLAIN].sort());
} });

Deno.test("aiSliceIsHeld: before the hold, or no date, is held; no slice is not", () => {
  assertEquals(aiSliceIsHeld({ evaluated_at: "2026-11-04T23:59:59Z" }), true);
  assertEquals(aiSliceIsHeld({ evaluated_at: "2026-11-05T00:00:00Z" }), false);
  assertEquals(aiSliceIsHeld({ score_0_to_100: 5 }), true);
  assertEquals(aiSliceIsHeld({ evaluated_at: "not a date" }), true);
  assertEquals(aiSliceIsHeld(undefined), false);
  assertEquals(aiSliceIsHeld(null), false);
});

Deno.test("the hold date is the same in TypeScript and both SQL homes", async () => {
  const sqlLiteral = `TIMESTAMPTZ '${AI_SCORE_HOLD_SINCE.replace("T", " ").replace("Z", "")}+00'`;
  assertEquals(sqlLiteral, "TIMESTAMPTZ '2026-11-05 00:00:00+00'");
  const root = new URL("../../../migrations/", import.meta.url);
  const selector = await Deno.readTextFile(new URL("20280410004276_issue_4276_drift_modes_and_rescore_queue.sql", root));
  const helper = await Deno.readTextFile(new URL("20280416004276_issue_4276_score_hold_and_release_only_path.sql", root));
  assert(selector.includes(`ak.ai_evaluated_at >= ${sqlLiteral}`), "the rescore selector's hold date moved");
  assert(helper.includes(`SELECT ${sqlLiteral};`), "ai_score_hold_since() moved");
});

addEventListener("unload", () => {
  globalThis.fetch = realFetch;
});
