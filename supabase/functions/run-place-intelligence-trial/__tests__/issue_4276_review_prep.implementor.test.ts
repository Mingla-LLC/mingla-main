// Issue #4276 S4, R1, R2: prep believes the review fetch.
//
// MINGLA-INVARIANT: I-4276-REVIEW-FAILURE-NOT-READY | issue #4276 | A failed review fetch never marks a place ready for Gemini, and a depleted provider pauses the run
//
// 22,738 Gemini runs were sent places with no reviews because prep ignored the
// result. These drive the REAL runPrepIteration with a fake database and a stubbed
// Serper.
//
// FAILS-ON-REVERT: remove the `reviewOutcome.kind === "failed"` throw in
// runPrepIteration and the failure and depletion cases go ready instead.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fingerprintPhotos } from "../../_shared/imageCollage.ts";
import {
  fetchReviewsForPlace,
  handleResumeRun,
  isSerperDepleted,
  runPrepIteration,
} from "../index.ts";

const RUN = "42762000-0000-4000-a000-000000000001";
const PLACE = "42762000-0000-4000-b000-000000000001";
const ROW = "42762000-0000-4000-c000-000000000001";

interface World {
  run: Record<string, unknown>;
  row: Record<string, unknown>;
  state: Record<string, unknown> | null;
  freshReviewRows: number;
  reviewUpserts: Array<Record<string, unknown>>;
  counters: Array<Record<string, unknown>>;
  place: Record<string, unknown>;
  serperHealthy?: boolean;
}

async function world(over: Partial<World> = {}): Promise<World> {
  const photos = ["https://photos.test/1.jpg"];
  return {
    run: { id: RUN, status: "running", force_refresh_reviews: false },
    row: { id: ROW, place_pool_id: PLACE, status: "pending", started_at: null, prep_status: null },
    state: null,
    freshReviewRows: 0,
    reviewUpserts: [],
    counters: [],
    place: {
      id: PLACE,
      google_place_id: "gp-1",
      name: "A place",
      stored_photo_urls: photos,
      // Matches the fingerprint, so compose is a cache hit and needs no storage.
      photo_collage_url: "https://x.test/c.webp",
      photo_collage_fingerprint: await fingerprintPhotos(photos),
    },
    ...over,
  };
}

// deno-lint-ignore no-explicit-any
function fakeDb(w: World): any {
  // deno-lint-ignore no-explicit-any
  const from = (table: string): any => {
    let patch: Record<string, unknown> | null = null;
    let eqStatus: unknown;
    // deno-lint-ignore no-explicit-any
    const result = (): any => {
      switch (table) {
        case "place_intelligence_runs":
          if (patch && (eqStatus === undefined || w.run.status === eqStatus)) {
            Object.assign(w.run, patch);
            return { data: w.run, error: null };
          }
          return { data: patch ? null : w.run, error: null };
        case "place_intelligence_trial_runs":
          if (patch) Object.assign(w.row, patch);
          return { data: [w.row], error: null };
        case "place_review_fetch_state":
          if (patch) w.state = patch;
          return { data: w.state, error: null };
        case "place_external_reviews":
          if (patch) return { data: null, error: null };
          return { data: Array(w.freshReviewRows).fill({ id: "r", media: [] }), count: w.freshReviewRows, error: null };
        case "place_pool":
          return { data: w.place, error: null };
      }
      return { data: null, error: null };
    };
    // deno-lint-ignore no-explicit-any
    const chain: any = {
      select: () => chain,
      update: (p: Record<string, unknown>) => { patch = p; return chain; },
      upsert: (p: Record<string, unknown> | Array<Record<string, unknown>>) => {
        if (table === "place_external_reviews") w.reviewUpserts.push(...(p as Array<Record<string, unknown>>));
        patch = Array.isArray(p) ? {} : p;
        return chain;
      },
      eq: (col: string, val: unknown) => { if (col === "status") eqStatus = val; return chain; },
      in: () => chain, is: () => chain, or: () => chain, gte: () => chain,
      order: () => chain, limit: () => chain,
      maybeSingle: () => Promise.resolve(result()),
      // deno-lint-ignore no-explicit-any
      then: (res: any, rej: any) => Promise.resolve(result()).then(res, rej),
    };
    return chain;
  };
  return {
    from,
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn === "increment_run_counters") w.counters.push(args);
      // #4276: prep checks Serper's latest health check first.
      if (fn === "place_intel_provider_healthy") return Promise.resolve({ data: w.serperHealthy !== false, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

/** Stubs only Serper. Returns the Serper calls made and a restore function. */
function stubSerper(respond: (call: number) => Response) {
  const real = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("serper.dev")) {
      calls.push(JSON.parse(String(init?.body)));
      return Promise.resolve(respond(calls.length));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const prep = (w: World) =>
  runPrepIteration({
    db: fakeDb(w),
    serperKey: "k",
    runId: RUN,
    stuckCutoff: new Date().toISOString(),
    workerStartedAtMs: Date.now(),
    iteration: 1,
  });

const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test({ name: "a failed fetch marks the place review-failed, not ready", ...opts, fn: async () => {
  const w = await world();
  const s = stubSerper(() => new Response("boom", { status: 500 }));
  try {
    const r = await prep(w);
    assertEquals(r.prep_failed, 1);
    assertEquals(r.prepped, 0);
    assertEquals(r.paused_by_provider, false);
    assertEquals(w.row.prep_status, "review_failed");
    assertEquals(w.row.status, "failed");
    assert(String(w.row.error_message).includes("review_fetch_failed"));
    assertEquals(w.counters.length, 1);
    assertEquals(w.run.status, "running", "one bad place doesn't stop the run");
    assertEquals(w.state?.outcome, "failed");
    assert(String(w.state?.last_error).includes("boom"));
  } finally { s.restore(); }
}});

Deno.test({ name: "a depleted provider pauses the run and keeps the place queued", ...opts, fn: async () => {
  const w = await world();
  const s = stubSerper(() => new Response('{"message":"Not enough credits"}', { status: 400 }));
  try {
    const r = await prep(w);
    assertEquals(r.paused_by_provider, true);
    assertEquals(r.prep_failed, 0);
    assertEquals(w.run.status, "paused");
    assertEquals(w.run.error_reason, "review_provider_out_of_credits");
    assertEquals(w.row.status, "pending", "the place is fine; it waits for the resume");
    assertEquals(w.row.prep_status, null);
    assertEquals(w.counters.length, 0, "nothing was processed");
  } finally { s.restore(); }
}});

Deno.test({ name: "no reviews on Google is ready, and recorded apart from a failure", ...opts, fn: async () => {
  const w = await world();
  const s = stubSerper(() => Response.json({ reviews: [] }));
  try {
    const r = await prep(w);
    assertEquals(r.prepped, 1);
    assertEquals(w.row.prep_status, "ready");
    assertEquals(w.state?.outcome, "none_on_google");
    assertEquals(w.state?.last_error, null);
  } finally { s.restore(); }
}});

Deno.test({ name: "reviews store no raw copy, and paging stops at the page cap when Google keeps going", ...opts, fn: async () => {
  const w = await world();
  const s = stubSerper((n) =>
    Response.json({
      reviews: [{ id: `r${n}`, snippet: "good", rating: 5, not_kept: "x" }],
      nextPageToken: "always-more",
    })
  );
  try {
    const r = await prep(w);
    assertEquals(r.prepped, 1);
    assertEquals(s.calls.length, 5, "R2: never more than 5 pages");
    assertEquals(w.reviewUpserts.length, 5);
    for (const row of w.reviewUpserts) assertEquals("raw" in row, false, "R1: raw must not be written");
    assertEquals(w.state?.outcome, "fetched");
    assertEquals(w.state?.review_count, 5);
  } finally { s.restore(); }
}});

/** A Serper page of `count` reviews, of which only `withText` have any words. */
function reviewPage(page: number, count: number, withText: number, more: boolean) {
  const reviews = Array.from({ length: count }, (_, i) => ({
    id: `p${page}-r${i}`,
    snippet: i < withText ? "words" : "   ",
    rating: 5,
  }));
  return Response.json(more ? { reviews, nextPageToken: "more" } : { reviews });
}

Deno.test({ name: "paging stops as soon as 30 reviews with text are held", ...opts, fn: async () => {
  const w = await world();
  const s = stubSerper((n) => reviewPage(n, 10, 10, true));
  try {
    assertEquals((await prep(w)).prepped, 1);
    assertEquals(s.calls.length, 3, "30 with text arrive on page 3; pages 4 and 5 would be wasted credit");
    assertEquals(w.state?.review_count, 30);
  } finally { s.restore(); }
}});

Deno.test({ name: "reviews without text don't count towards the 30", ...opts, fn: async () => {
  const w = await world();
  const s = stubSerper((n) => reviewPage(n, 10, 4, true));
  try {
    assertEquals((await prep(w)).prepped, 1);
    assertEquals(s.calls.length, 5, "only 20 with text by the cap, so it pages all the way");
  } finally { s.restore(); }
}});

Deno.test({ name: "paging stops when Google has no more, however few are held", ...opts, fn: async () => {
  const w = await world();
  const s = stubSerper((n) => reviewPage(n, 10, 10, n < 2));
  try {
    assertEquals((await prep(w)).prepped, 1);
    assertEquals(s.calls.length, 2);
    assertEquals(w.state?.review_count, 20);
  } finally { s.restore(); }
}});

Deno.test({ name: "a fresh empty result is reused, unless the run forces a redo", ...opts, fn: async () => {
  const fresh = { outcome: "none_on_google", last_checked_at: new Date().toISOString() };

  const reuse = await world({ state: { ...fresh } });
  const s1 = stubSerper(() => Response.json({ reviews: [] }));
  try {
    assertEquals((await prep(reuse)).prepped, 1);
    assertEquals(s1.calls.length, 0, "a fresh check needs no Serper credit");
  } finally { s1.restore(); }

  const redo = await world({ state: { ...fresh } });
  redo.run.force_refresh_reviews = true;
  const s2 = stubSerper(() => Response.json({ reviews: [] }));
  try {
    assertEquals((await prep(redo)).prepped, 1);
    assertEquals(s2.calls.length, 1, "a forced redo must really fetch");
  } finally { s2.restore(); }
}});

Deno.test({ name: "a failed fetch is never treated as fresh, even with rows from before it failed", ...opts, fn: async () => {
  const w = await world({
    state: { outcome: "failed", last_checked_at: new Date().toISOString() },
    freshReviewRows: 3,
  });
  const s = stubSerper(() => Response.json({ reviews: [] }));
  try {
    const outcome = await fetchReviewsForPlace(fakeDb(w), PLACE, false, "k");
    assertEquals(outcome.kind, "none_on_google");
    assertEquals(s.calls.length, 1);
  } finally { s.restore(); }
}});

Deno.test("depletion is recognised on the body and on 402, not on any 400", () => {
  assertEquals(isSerperDepleted(400, "Not enough credits"), true);
  assertEquals(isSerperDepleted(402, ""), true);
  assertEquals(isSerperDepleted(400, "bad placeId"), false);
  assertEquals(isSerperDepleted(429, "slow down"), false);
});

Deno.test("resume only moves a paused run, and goes through the queue", async () => {
  const w = await world();
  w.run.status = "paused";
  const res = await handleResumeRun(fakeDb(w), { run_id: RUN });
  assertEquals(res.status, 200);
  assertEquals(w.run.status, "queued", "the cron promotes it under the run limit");

  const running = await world();
  const refused = await handleResumeRun(fakeDb(running), { run_id: RUN });
  assertEquals(refused.status, 409);
  assertEquals(running.run.status, "running");
});

// #4276 rework: an outage costs nothing. FAILS-ON-REVERT: drop the health check at the
// top of runPrepIteration and Serper is called and the place is claimed.
Deno.test({ name: "an unhealthy Serper pauses the run before any place is claimed or fetched", ...opts, fn: async () => {
  const w = await world({ serperHealthy: false });
  const s = stubSerper(() => Response.json({ reviews: [] }));
  try {
    const r = await prep(w);
    assertEquals(r.paused_by_provider, true);
    assertEquals(r.prepped + r.prep_failed, 0);
    assertEquals(s.calls.length, 0, "no Serper request");
    assertEquals(w.row.status, "pending", "the place was not claimed");
    assertEquals(w.run.status, "paused");
    assertEquals(w.run.error_reason, "review_provider_out_of_credits");
  } finally { s.restore(); }
}});
