// META-ORCH-1290 [venue authoring: score-on-approve] — Leg A pipeline behavioral.
// Invariant: I-PROPOSED-1290-NO-BUSINESS-SIGNAL-SCORES-PRE-APPROVE.
//
// META-ORCH-1290 D-2: business signal scores are computed at APPROVE, never at
// authoring — reverting re-introduces pre-approval scoring / hides the pitch.
//
// MUST FAIL when D-2 is reverted:
//   * re-add `ai_signal_scores: ...` to handleTier2's place_pool.update →
//     T-1290-1 fails (the submit payload must carry NO ai_signal_scores key);
//   * remove the ai_signal_scores write from handleEvaluateSignals → T-1290-2
//     fails (approve must produce the 16-signal scores);
//   * drop the requireServiceRole guard → T-1290-3 fails (a non-service token
//     must be rejected on the evaluate_signals branch).

import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  handleEvaluateSignals,
  handleTier2,
  requireServiceRole,
} from "../index.ts";

interface CapturedWrite {
  table: string;
  op: "update" | "upsert" | "insert";
  payload: Record<string, unknown>;
}

function makeFakeClient(config: {
  rows?: Record<string, Record<string, unknown> | null>;
  lists?: Record<string, unknown[]>;
}) {
  const writes: CapturedWrite[] = [];
  const rows = config.rows ?? {};
  const lists = config.lists ?? {};
  function makeQuery(table: string) {
    let op: "select" | "update" | "upsert" | "insert" = "select";
    const q = {
      select(_c?: string) { return q; },
      eq(_k: string, _v: unknown) { return q; },
      is(_k: string, _v: unknown) { return q; },
      order(_k: string, _o?: unknown) { return q; },
      maybeSingle() { return Promise.resolve({ data: rows[table] ?? null, error: null }); },
      single() { return Promise.resolve({ data: rows[table] ?? null, error: null }); },
      update(payload: Record<string, unknown>) { op = "update"; writes.push({ table, op: "update", payload }); return q; },
      insert(payload: Record<string, unknown>) { op = "insert"; writes.push({ table, op: "insert", payload }); return q; },
      upsert(payload: Record<string, unknown>, _o?: unknown) { op = "upsert"; writes.push({ table, op: "upsert", payload }); return q; },
      // deno-lint-ignore no-explicit-any
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown): any {
        const value = op === "select" ? { data: lists[table] ?? null, error: null } : { data: null, error: null };
        return Promise.resolve(value).then(resolve, reject);
      },
    };
    return q;
  }
  return { client: { from: (t: string) => makeQuery(t) }, writes };
}

const BRAND = {
  id: "9a000000-0000-4000-8000-000000000001",
  account_id: "7a000000-0000-4000-8000-000000000009",
  name: "Test Brand",
  description: null,
  place_pool_id: null,
  google_place_id: null,
  venue_category: "restaurant" as const,
  cover_media_url: null,
  cover_media_type: null,
};
const VENUE = {
  id: "5b000000-0000-4000-8000-000000000002",
  brand_id: BRAND.id,
  place_pool_id: "3c7ebebf-7249-45a2-8b0b-c6b5ec319ec0",
  google_place_id: null,
  venue_category: "restaurant" as const,
  name: "Test Venue",
  cover_media_url: null,
  cover_media_type: null,
  claim_status: "pending_review",
};
const PLACE_ID = "3c7ebebf-7249-45a2-8b0b-c6b5ec319ec0";

function stubGemini(responseObj: Record<string, unknown>): () => void {
  Deno.env.set("GEMINI_API_KEY", "test-key-not-real");
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Request | URL | string) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("generativelanguage.googleapis.com")) {
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(responseObj) }] } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  }) as typeof fetch;
  return () => { globalThis.fetch = realFetch; };
}

function placeUpdates(writes: CapturedWrite[]): Record<string, unknown>[] {
  return writes.filter((w) => w.table === "place_pool" && w.op === "update").map((w) => w.payload);
}

// ── T-1290-1: handleTier2 (submit, bio-draft) writes NO ai_signal_scores ─────
Deno.test("T-1290-1: handleTier2 submit writes the bio-draft but NO ai_signal_scores (D-2)", async () => {
  // create-new authored place → apply mode → update carries the widest key-set,
  // yet STILL must NOT include ai_signal_scores.
  const place: Record<string, unknown> = {
    id: PLACE_ID,
    google_place_id: null,
    business_author_brand_id: BRAND.id, // apply mode
    name: "Test Venue",
    address: "1 Test St",
    city: "Raleigh",
    country: "US",
    primary_type: "restaurant",
    types: ["restaurant"],
    business_status: "OPERATIONAL",
    website: null, // no website → scanWebsite short-circuits, no network
    opening_hours: { periods: [] },
    photos: null,
    stored_photo_urls: ["https://cdn/hero.jpg"],
    is_servable: false,
    business_authoring_inputs: { tier1: { name: "Test Venue" } },
    business_gallery_urls: [], // no gallery → no image fetches
    business_recommend_edit_count: 0,
    fetched_via: "business_authored",
    review_count: null,
    rating: null,
    generative_summary: null,
  };
  const { client, writes } = makeFakeClient({
    rows: { place_pool: place },
    lists: { signal_definitions: [{ id: "date_night", label: "Date night" }] },
  });
  const restore = stubGemini({
    bio: "A warm bistro with a candlelit courtyard and natural wine.",
    facets: { serves_dinner: true },
    photo_analysis: null,
    consistency: null,
  });
  try {
    // deno-lint-ignore no-explicit-any
    const res = await handleTier2(client as any, BRAND as any, VENUE as any, {
      action: "run_tier2_pipeline",
      brand_id: BRAND.id,
      venue_id: VENUE.id,
      place_pool_id: PLACE_ID,
      tier2: {},
    });
    assertEquals(res.status, 200);
  } finally {
    restore();
  }
  const updates = placeUpdates(writes);
  assertEquals(updates.length, 1);
  const payload = updates[0];
  assert(!("ai_signal_scores" in payload), "SUBMIT must NOT write ai_signal_scores (D-2)");
  // The bio-draft IS staged for the client to show/edit.
  const inputs = payload.business_authoring_inputs as Record<string, unknown>;
  const pending = inputs.pending_ai_outputs as Record<string, unknown>;
  assertEquals(pending.generated_bio, "A warm bistro with a candlelit courtyard and natural wine.");
});

// ── T-1290-2: handleEvaluateSignals (approve) writes ai_signal_scores + facets ─
Deno.test("T-1290-2: evaluate_signals at approve writes ai_signal_scores (16-signal) + facet columns", async () => {
  const place: Record<string, unknown> = {
    id: PLACE_ID,
    name: "Test Venue",
    website: null,
    business_authoring_inputs: { tier1: { name: "Test Venue" }, tier2: {} },
    business_gallery_urls: [],
    generative_summary: "Applied pitch.",
  };
  const { client, writes } = makeFakeClient({
    rows: { place_pool: place, brands: { id: BRAND.id, name: "Test Brand" } },
    lists: { signal_definitions: [{ id: "date_night", label: "Date night" }] },
  });
  const restore = stubGemini({
    facets: { serves_dinner: true },
    photo_analysis: null,
    evaluations: [{ signal_id: "date_night", score_0_to_100: 82, inappropriate_for: false, reasoning: "candlelit" }],
    consistency: null,
  });
  try {
    // deno-lint-ignore no-explicit-any
    const res = await handleEvaluateSignals(client as any, {
      action: "evaluate_signals",
      brand_id: BRAND.id,
      venue_id: VENUE.id,
      place_pool_id: PLACE_ID,
    });
    assertEquals(res.status, 200);
  } finally {
    restore();
  }
  const updates = placeUpdates(writes);
  assertEquals(updates.length, 1);
  const payload = updates[0];
  assert("ai_signal_scores" in payload, "approve MUST write ai_signal_scores");
  const scores = payload.ai_signal_scores as Record<string, Record<string, unknown>>;
  assertEquals(scores.date_night.score_0_to_100, 82);
  assertEquals(scores.date_night.prompt_version, "v4");
  // AI-inferred facet columns are applied here (replacing the retired confirm step).
  assertEquals(payload.serves_dinner, true);
});

// ── T-1290-3: requireServiceRole gate (evaluate_signals is service-role only) ─
Deno.test("T-1290-3: requireServiceRole rejects a user token, accepts the service key", async () => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc-role-secret-1290");

  const userReq = new Request("https://x/", {
    method: "POST",
    headers: { Authorization: "Bearer a-user-access-token" },
  });
  const rejected = await requireServiceRole(userReq);
  assert(rejected instanceof Response, "a non-service token must be rejected");
  assertEquals((rejected as Response).status, 401);

  const svcReq = new Request("https://x/", {
    method: "POST",
    headers: { Authorization: "Bearer svc-role-secret-1290" },
  });
  const accepted = await requireServiceRole(svcReq);
  assert(!(accepted instanceof Response), "the service-role key must be accepted");
  assert("serviceClient" in (accepted as { serviceClient: unknown }), "returns a service client");
});
