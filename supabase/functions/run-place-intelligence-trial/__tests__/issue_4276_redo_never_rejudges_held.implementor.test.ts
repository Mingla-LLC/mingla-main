// Issue #4276 (round 4): a redo never re-judges a place held in the score backlog.
//
// MINGLA-INVARIANT: I-4276-REDO-NEVER-REJUDGES-HELD-BACKLOG | issue #4276 | A planned redo of Intelligence never re-judges a place whose AI result predates ai_score_hold_since(), even when the list it is given includes one
//
// Seth keeps the backlog held. Re-judging a held place would write a slice dated now and
// let the score stage put it live, one place at a time. The redo list from the database
// (place_intel_places_without_reviews) already leaves those places out; handleStartRun
// checks the slices again before it queues anything. This drives the real handleStartRun
// with a list that wrongly includes a backlog place.
//
// FAILS-ON-REVERT: remove the heldPlaceIds check from handleStartRun and the estimate
// counts 3 places instead of 2.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleStartRun, heldPlaceIds } from "../index.ts";

type Row = Record<string, unknown>;

const CITY = "city-1";
const POOL = [{ id: "never-judged", review_count: 3 }, { id: "backlog", review_count: 2 }, { id: "judged-after-hold", review_count: 1 }];
const COMPLETED = [{ place_pool_id: "backlog" }, { place_pool_id: "judged-after-hold" }];
const AI: Record<string, unknown> = {
  backlog: { sig: { score: 50, evaluated_at: "2026-09-01T00:00:00Z" } },
  "judged-after-hold": { sig: { score: 60, evaluated_at: "2026-11-10T00:00:00Z" } },
};

function fakeDb(redoList: string[]) {
  const reads: string[] = [];
  // deno-lint-ignore no-explicit-any
  const from = (table: string): any => {
    let columns = "";
    let ids: string[] = [];
    const result = (): { data: unknown; error: null } => {
      if (table === "seeding_cities") return { data: { id: CITY, name: "City", country: "Land" }, error: null };
      if (table === "place_pool" && columns.startsWith("id, review_count")) return { data: POOL, error: null };
      if (table === "place_pool" && columns.startsWith("id, ai_signal_scores")) {
        reads.push(`ai:${ids.join(",")}`);
        return { data: ids.map((id) => ({ id, ai_signal_scores: AI[id] ?? null })), error: null };
      }
      if (table === "place_intelligence_trial_runs") return { data: COMPLETED, error: null };
      return { data: [], error: null };
    };
    // deno-lint-ignore no-explicit-any
    const chain: any = {
      select: (c: string) => { columns = c; return chain; },
      eq: () => chain, or: () => chain, order: () => chain, range: () => chain, limit: () => chain,
      in: (_k: string, v: string[]) => { ids = v; return chain; },
      maybeSingle: () => Promise.resolve(result()),
      single: () => Promise.resolve(result()),
      // deno-lint-ignore no-explicit-any
      then: (res: any, rej: any) => Promise.resolve(result()).then(res, rej),
    };
    return chain;
  };
  return {
    reads,
    db: {
      from,
      rpc: (name: string) => Promise.resolve({ data: name === "place_intel_places_without_reviews" ? redoList : null, error: null }),
    },
  };
}

const body = (patch: Row = {}) => ({
  action: "start_run", city_id: CITY, mode: "remainder", place_scope: "servable_and_held",
  include_no_reviews: true, force_refresh_reviews: true, estimate_only: true, ...patch,
});

Deno.test("a redo given a backlog place skips it on the server; a place judged after the hold can still be redone", async () => {
  // The list wrongly includes the backlog place.
  const { db, reads } = fakeDb(["backlog", "judged-after-hold"]);
  // deno-lint-ignore no-explicit-any
  const res = await handleStartRun(db as any, body(), "admin-1", "service-key");
  const out = await res.json();
  assertEquals(res.status, 200);
  assertEquals(out.totalPlaces, 2, "never-judged + judged-after-hold; the backlog place is skipped");
  assertEquals(reads, ["ai:backlog,judged-after-hold"], "the slices were checked on the server");
});

Deno.test("without a redo, nothing already judged is taken (as before)", async () => {
  const { db, reads } = fakeDb(["backlog", "judged-after-hold"]);
  // deno-lint-ignore no-explicit-any
  const res = await handleStartRun(db as any, body({ include_no_reviews: undefined }), "admin-1", "service-key");
  assertEquals((await res.json()).totalPlaces, 1);
  assertEquals(reads, []);
});

Deno.test("heldPlaceIds: a slice from before the hold, or with no usable date, is held", () => {
  assertEquals(heldPlaceIds([
    { id: "a", ai_signal_scores: { s: { evaluated_at: "2026-09-01T00:00:00Z" } } },
    { id: "b", ai_signal_scores: { s: { evaluated_at: "2026-11-10T00:00:00Z" } } },
    { id: "c", ai_signal_scores: { s: { evaluated_at: "2026-11-10T00:00:00Z" }, t: { score: 1 } } },
    { id: "d", ai_signal_scores: null },
  ]), ["a", "c"]);
});
