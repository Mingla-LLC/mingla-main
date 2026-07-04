// META-ORCH-1290 [venue authoring: score-on-approve] — admin approve orchestration.
// Invariant: I-PROPOSED-1290-NO-BUSINESS-SIGNAL-SCORES-PRE-APPROVE (the scores are
// computed at APPROVE by evaluate_signals, blended by run-signal-scorer) + SC-10
// (the ≥5-gallery deck gate is enforced at approve).
//
// META-ORCH-1290 D-2: business signal scores are computed at APPROVE, never at
// authoring — reverting re-introduces pre-approval scoring / hides the pitch.
//
// MUST FAIL when reverted:
//   * remove the evaluate_signals invoke → T-1290A-1 ordering fails (only the
//     scorer is invoked; the pipeline eval invoke is absent);
//   * swallow an eval failure and go-live anyway → T-1290A-2 fail-close fails
//     (run-signal-scorer invoked / is_servable flipped despite the eval error);
//   * remove the ≥5-gallery gate from the approve path → T-1290A-3 fails
//     (a <5-photo venue flips is_servable=true).

import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

import { approveGoLiveWithAuthoredApply, runApproveGoLive } from "../index.ts";

interface CapturedWrite { table: string; op: "update" | "insert"; payload: Record<string, unknown>; }
interface Invoke { name: string; body: unknown; seq: number; }

function makeFakeAdmin(config: {
  rows?: Record<string, Record<string, unknown> | null>;
  lists?: Record<string, unknown[]>;
  failTables?: Set<string>;
  invokeResult?: (name: string) => { data: unknown; error: unknown };
}) {
  const writes: CapturedWrite[] = [];
  const invokes: Invoke[] = [];
  let seq = 0;
  const rows = config.rows ?? {};
  const lists = config.lists ?? {};
  const failTables = config.failTables ?? new Set<string>();
  const invokeResult = config.invokeResult ?? (() => ({ data: {}, error: null }));

  function makeQuery(table: string) {
    let op: "select" | "update" | "insert" = "select";
    const q = {
      select(_c?: string) { return q; },
      eq(_k: string, _v: unknown) { return q; },
      order(_k: string, _o?: unknown) { return q; },
      maybeSingle() {
        if (failTables.has(table)) return Promise.resolve({ data: null, error: { message: `${table}_boom` } });
        return Promise.resolve({ data: rows[table] ?? null, error: null });
      },
      update(payload: Record<string, unknown>) { op = "update"; writes.push({ table, op: "update", payload }); return q; },
      insert(payload: Record<string, unknown>) { op = "insert"; writes.push({ table, op: "insert", payload }); return q; },
      // deno-lint-ignore no-explicit-any
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown): any {
        const value = op === "select" ? { data: lists[table] ?? [], error: null } : { data: null, error: null };
        return Promise.resolve(value).then(resolve, reject);
      },
    };
    return q;
  }
  return {
    admin: {
      from: (t: string) => makeQuery(t),
      functions: {
        invoke(name: string, opts: { body?: unknown }) {
          invokes.push({ name, body: opts?.body, seq: seq++ });
          return Promise.resolve(invokeResult(name));
        },
      },
    },
    writes,
    invokes,
  };
}

const BRAND_ID = "9a000000-0000-4000-8000-000000000001";
const VENUE_ID = "5b000000-0000-4000-8000-000000000002";
const PLACE_ID = "3c7ebebf-7249-45a2-8b0b-c6b5ec319ec0";

function servablePlace(galleryCount: number): Record<string, unknown> {
  return {
    id: PLACE_ID,
    google_place_id: "gp-lantern",
    name: "The Lantern Room",
    lat: 38.9,
    lng: -77.0,
    types: ["restaurant", "food", "point_of_interest"],
    business_status: "OPERATIONAL",
    website: "https://lantern.example",
    opening_hours: { periods: [] },
    photos: [{ ref: "x" }],
    stored_photo_urls: ["https://cdn/p1.jpg"],
    fetched_via: "nearby_search",
    review_count: 100,
    rating: 4.4,
    business_gallery_urls: Array.from({ length: galleryCount }, (_, i) => `https://cdn/g${i}.jpg`),
    business_authoring_inputs: { tier1: { description: "Operator pitch long enough to stand in." } },
    raw_google_data: {},
  };
}
const ROWS = (galleryCount: number) => ({
  venue_listings: { id: VENUE_ID, brand_id: BRAND_ID, place_pool_id: PLACE_ID, cover_media_url: "https://cdn/cover.jpg", cover_media_type: "image" },
  brands: { id: BRAND_ID, account_id: "7a000000-0000-4000-8000-000000000009" },
  place_pool: servablePlace(galleryCount),
});
const LISTS = { brand_hours: [], signal_definitions: [{ id: "date_night" }] };

// ── T-1290A-1: happy approve — apply → evaluate_signals → run-signal-scorer ───
Deno.test("T-1290A-1: approve invokes evaluate_signals (pipeline) BEFORE run-signal-scorer, then flips servable", async () => {
  const { admin, writes, invokes } = makeFakeAdmin({ rows: ROWS(6), lists: LISTS });
  // deno-lint-ignore no-explicit-any
  const res = await approveGoLiveWithAuthoredApply(admin as any, VENUE_ID, PLACE_ID, null, BRAND_ID);
  assert(res.ok, `expected ok, got ${JSON.stringify(res)}`);

  // Two invokes, IN ORDER: the pipeline eval, then the scorer.
  assertEquals(invokes.length, 2);
  assertEquals(invokes[0].name, "run-business-place-authoring-pipeline");
  assertEquals((invokes[0].body as { action?: string }).action, "evaluate_signals");
  assertEquals(invokes[1].name, "run-signal-scorer");
  assert(invokes[0].seq < invokes[1].seq, "eval must precede the scorer");

  // The authored patch lands, THEN servable flips (after the eval invoke).
  const flip = writes.find((w) => w.table === "place_pool" && w.payload.is_servable === true);
  assert(flip, "servable flip expected on a ≥5-gallery, bouncer-passing venue");
});

// ── T-1290A-2: eval fails → fail-close (no scorer, no servable flip) ──────────
Deno.test("T-1290A-2: evaluate_signals failure fails-close — signal_eval_failed, no scorer, no flip", async () => {
  const { admin, writes, invokes } = makeFakeAdmin({
    rows: ROWS(6),
    lists: LISTS,
    invokeResult: (name) =>
      name === "run-business-place-authoring-pipeline"
        ? { data: null, error: { message: "gemini_failed:500" } }
        : { data: {}, error: null },
  });
  // deno-lint-ignore no-explicit-any
  const res = await approveGoLiveWithAuthoredApply(admin as any, VENUE_ID, PLACE_ID, null, BRAND_ID);
  assertEquals(res.ok, false);
  assert(!res.ok && res.error.startsWith("signal_eval_failed"), `expected signal_eval_failed, got ${JSON.stringify(res)}`);
  // Fail-close: the scorer was NEVER invoked and is_servable was never flipped.
  assert(!invokes.some((i) => i.name === "run-signal-scorer"), "scorer must not run when the eval fails");
  assert(!writes.some((w) => w.table === "place_pool" && w.payload.is_servable === true), "no servable flip on eval failure");
});

// ── T-1290A-3: SC-10 — the ≥5-gallery deck gate is enforced at approve ────────
Deno.test("T-1290A-3: a <5-gallery venue does NOT flip servable at approve (gate relocated)", async () => {
  // 3 gallery photos, bouncer otherwise passes, gate enforced.
  const short = makeFakeAdmin({ rows: ROWS(3), lists: LISTS });
  // deno-lint-ignore no-explicit-any
  const shortRes = await runApproveGoLive(short.admin as any, PLACE_ID, null, true);
  assert(shortRes.rebounced, "re-bounce ran");
  assert(!short.writes.some((w) => w.table === "place_pool" && w.payload.is_servable === true), "<5 gallery must not flip servable");
  assert(shortRes.bounce_reasons.some((r) => r.startsWith("GALLERY_MIN")), "a GALLERY_MIN reason is recorded");
  assert(!short.invokes.some((i) => i.name === "run-signal-scorer"), "no scoring for an off-deck venue");

  // 5 gallery photos → gate passes → servable flips.
  const ok = makeFakeAdmin({ rows: ROWS(5), lists: LISTS });
  // deno-lint-ignore no-explicit-any
  await runApproveGoLive(ok.admin as any, PLACE_ID, null, true);
  assert(ok.writes.some((w) => w.table === "place_pool" && w.payload.is_servable === true), "≥5 gallery flips servable");
});
