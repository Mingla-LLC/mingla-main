// ISSUE-1734 [platform ADDENDUM §S10/§S11] — subject plumbing + competitor
// watch CRUD on the venues engine. Runs the REAL `handler` against the harness
// stub. Covers:
//
//   T-SR1  venue-subject runs stamp subject_ref 'venue:<id>' (write half; the
//          latest-read half lives in the growth-tools-report suite)
//   T-SR2  subject forgery: brand-B venue / brand-B competitor → 403, no row;
//          a client-sent raw `subject_ref` STRING is IGNORED (server-derived
//          only); malformed subject → 400
//   T-SR5  cache subject isolation: identical input under different subjects
//          never cross-serves (venue:X vs subjectless vs re-run venue:X)
//   T-CW1  watch lifecycle happy path: add → list (latest:null) → grade via
//          {type:"competitor"} (input taken FROM THE WATCH ROW) → list shows
//          latest.grade/overall/schema_version → identical re-check is
//          cached:true (no quota) → remove → list empty (SC-12)
//   T-CW5  remove ORPHANS the run history: tool_leads rows survive the delete
//          (append-only, P-48)
//   T-CW3  cross-brand + anon CRUD: brand-A member on brand-B venue →
//          403 / 403 / 403; web-lane watch_add → the existing 400 validation
//   T-CW4  dedup: same website twice on one venue → 409 duplicate_competitor;
//          cap: 5 rows → 6th add → 409 watch_limit
//   + app-lane search runs the P-3 chain (forged → 401; member → 200)
//
// fails-on-revert: deleting resolveRunSubject's ownership check turns T-SR2
// red; deleting the subject predicate in the cache lookup turns T-SR5 red;
// deleting the watch_remove ownership equality turns T-CW3 red; deleting the
// P-41 input-from-watch-row override turns T-CW1's graded-input assert red.
//
// Run: deno test --allow-read --allow-env --allow-net \
//   supabase/functions/growth-tools-run/__tests__/issue_1734_subject_watch.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  BRAND_A,
  BRAND_B,
  installStub,
  post,
  TOKEN_A,
  twoBrandWorld,
  USER_A,
  VENUE_A,
  VENUE_B,
  VENUES_INPUT,
  VENUES_PASS1_PAYLOAD,
} from "./harness_1734.ts";
import { handler } from "../index.ts";

const COMPETITOR_SITE = "https://rival-venue.example";

function appRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: "run",
    lane: "app",
    brand_id: BRAND_A,
    input: { ...VENUES_INPUT },
    ...overrides,
  };
}

Deno.test("T-SR1 — venue-subject run stamps server-composed subject_ref 'venue:<id>'", async () => {
  const stub = installStub({
    ...twoBrandWorld(),
    gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
  });
  try {
    const r = await post(handler, appRun({ subject: { type: "venue", id: VENUE_A } }), TOKEN_A);
    assertEquals(r.status, 200);
    assertEquals(stub.state.toolLeads.length, 1);
    assertEquals(stub.state.toolLeads[0].subject_ref, `venue:${VENUE_A}`);
  } finally {
    stub.restore();
  }
});

Deno.test("T-SR2 — foreign subjects → 403 + no row; raw subject_ref string ignored; malformed → 400", async () => {
  const stub = installStub({
    ...twoBrandWorld(),
    toolCompetitors: [{
      id: crypto.randomUUID(),
      brand_id: BRAND_B,
      venue_listing_id: VENUE_B,
      name: "B Rival",
      city: "Test City",
      website: COMPETITOR_SITE,
      place_pool_id: null,
      created_by: "someone",
      created_at: new Date().toISOString(),
    }],
    gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
  });
  try {
    // Brand-B venue id under brand-A auth → 403, no row (pollution guard).
    const foreignVenue = await post(
      handler,
      appRun({ subject: { type: "venue", id: VENUE_B } }),
      TOKEN_A,
    );
    assertEquals(foreignVenue.status, 403);
    // Brand-B competitor id → 403, no row.
    const foreignComp = await post(
      handler,
      appRun({ subject: { type: "competitor", id: stub.state.toolCompetitors[0].id } }),
      TOKEN_A,
    );
    assertEquals(foreignComp.status, 403);
    assertEquals(stub.state.toolLeads.length, 0, "no row on any subject rejection");

    // A raw client-sent subject_ref STRING is ignored — server-derived only.
    const rawString = await post(
      handler,
      appRun({ subject_ref: `venue:${VENUE_B}` }),
      TOKEN_A,
    );
    assertEquals(rawString.status, 200);
    assertEquals(
      stub.state.toolLeads[stub.state.toolLeads.length - 1].subject_ref,
      null,
      "client subject_ref string never stored (P-41)",
    );

    // Malformed subject objects → 400 validation ('event' accepted by NO v1 run path).
    for (
      const bad of [
        { type: "event", id: VENUE_A },
        { type: "venue", id: "not-a-uuid" },
        "venue:string",
      ]
    ) {
      const r = await post(handler, appRun({ subject: bad }), TOKEN_A);
      assertEquals(r.status, 400, `subject ${JSON.stringify(bad)} must 400`);
    }
  } finally {
    stub.restore();
  }
});

Deno.test("T-SR5 — cache subject isolation: identical input under different subjects never cross-serves", async () => {
  const stub = installStub({
    ...twoBrandWorld(),
    gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
  });
  try {
    // Run 1: venue:A subject.
    const first = await post(handler, appRun({ subject: { type: "venue", id: VENUE_A } }), TOKEN_A);
    assertEquals(first.status, 200);
    // Run 2: SAME input, NO subject → must MISS (fresh row).
    const second = await post(handler, appRun(), TOKEN_A);
    assertEquals(second.status, 200);
    assertEquals(second.body.cached ?? false, false, "subjectless run never serves a subject row");
    assertEquals(stub.state.toolLeads.length, 2);
    // Run 3: SAME input, venue:A again → HIT on run 1.
    const third = await post(handler, appRun({ subject: { type: "venue", id: VENUE_A } }), TOKEN_A);
    assertEquals(third.status, 200);
    assertEquals(third.body.cached, true);
    assertEquals(third.body.run_id, first.body.run_id);
    assertEquals(stub.state.toolLeads.length, 2, "the hit inserted nothing");
  } finally {
    stub.restore();
  }
});

Deno.test("T-CW1 + T-CW5 — watch lifecycle: add → list → grade (input FROM the watch row) → cached re-check → remove orphans runs", async () => {
  const stub = installStub({
    ...twoBrandWorld(),
    gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
  });
  try {
    // add
    const add = await post(handler, {
      action: "watch_add",
      lane: "app",
      brand_id: BRAND_A,
      venue_listing_id: VENUE_A,
      competitor: { name: "Rival Venue", city: "Test City", website: COMPETITOR_SITE },
    }, TOKEN_A);
    assertEquals(add.status, 200);
    const compId = add.body.competitor.id as string;
    assertEquals(stub.state.toolCompetitors[0].created_by, USER_A, "created_by = verified userId");

    // list → latest null
    const list1 = await post(handler, {
      action: "watch_list",
      lane: "app",
      brand_id: BRAND_A,
      venue_listing_id: VENUE_A,
    }, TOKEN_A);
    assertEquals(list1.status, 200);
    assertEquals(list1.body.competitors.length, 1);
    assertEquals(list1.body.competitors[0].latest, null);

    // grade: input comes FROM THE WATCH ROW (client sends none) — P-41.
    const grade = await post(handler, {
      action: "run",
      lane: "app",
      brand_id: BRAND_A,
      subject: { type: "competitor", id: compId },
    }, TOKEN_A);
    assertEquals(grade.status, 200);
    const gradedRow = stub.state.toolLeads[stub.state.toolLeads.length - 1];
    assertEquals(gradedRow.subject_ref, `competitor:${compId}`);
    assertEquals(gradedRow.input.name, "Rival Venue", "engine input taken from the watch row");
    assertEquals(gradedRow.input.website, `${COMPETITOR_SITE}/`, "watch-row website (normalized)");

    // list → latest carries grade/overall/schema_version (plucked, not the full report)
    const list2 = await post(handler, {
      action: "watch_list",
      lane: "app",
      brand_id: BRAND_A,
      venue_listing_id: VENUE_A,
    }, TOKEN_A);
    assertEquals(list2.status, 200);
    const latest = list2.body.competitors[0].latest;
    assertEquals(latest.run_id, grade.body.run_id);
    assertEquals(latest.grade, "B");
    assertEquals(latest.overall, 72);
    assertEquals(latest.schema_version, 1);
    assertEquals("fixes" in latest, false, "the full report is never bulk-shipped in a list");

    // identical re-check within 24h → cached, no new row (quota untouched)
    const recheck = await post(handler, {
      action: "run",
      lane: "app",
      brand_id: BRAND_A,
      subject: { type: "competitor", id: compId },
    }, TOKEN_A);
    assertEquals(recheck.status, 200);
    assertEquals(recheck.body.cached, true);
    assertEquals(recheck.body.run_id, grade.body.run_id);

    // remove → list empty; the run rows SURVIVE (T-CW5, append-only P-48)
    const rowsBefore = stub.state.toolLeads.length;
    const remove = await post(handler, {
      action: "watch_remove",
      lane: "app",
      brand_id: BRAND_A,
      id: compId,
    }, TOKEN_A);
    assertEquals(remove.status, 200);
    assertEquals(remove.body.ok, true);
    const list3 = await post(handler, {
      action: "watch_list",
      lane: "app",
      brand_id: BRAND_A,
      venue_listing_id: VENUE_A,
    }, TOKEN_A);
    assertEquals(list3.body.competitors.length, 0);
    assertEquals(stub.state.toolLeads.length, rowsBefore, "run history is NEVER deleted");
  } finally {
    stub.restore();
  }
});

Deno.test("T-CW3 — cross-brand watch CRUD → 403×3; web-lane watch_add → existing 400 validation", async () => {
  const foreignCompId = crypto.randomUUID();
  const stub = installStub({
    ...twoBrandWorld(),
    toolCompetitors: [{
      id: foreignCompId,
      brand_id: BRAND_B,
      venue_listing_id: VENUE_B,
      name: "B Rival",
      city: "Test City",
      website: COMPETITOR_SITE,
      place_pool_id: null,
      created_by: "someone",
      created_at: new Date().toISOString(),
    }],
  });
  try {
    const list = await post(handler, {
      action: "watch_list",
      lane: "app",
      brand_id: BRAND_A,
      venue_listing_id: VENUE_B,
    }, TOKEN_A);
    assertEquals(list.status, 403, "brand-A member cannot list brand-B's venue watch");
    const add = await post(handler, {
      action: "watch_add",
      lane: "app",
      brand_id: BRAND_A,
      venue_listing_id: VENUE_B,
      competitor: { name: "X", city: "Test City", website: "https://x.example" },
    }, TOKEN_A);
    assertEquals(add.status, 403);
    const remove = await post(handler, {
      action: "watch_remove",
      lane: "app",
      brand_id: BRAND_A,
      id: foreignCompId,
    }, TOKEN_A);
    assertEquals(remove.status, 403, "ownership on the remove success path too (P-5)");
    assertEquals(stub.state.toolCompetitors.length, 1, "brand-B's row untouched");

    // Web lane: the action name is unknown → the byte-stable 400 contract.
    const web = await post(handler, {
      action: "watch_add",
      venue_listing_id: VENUE_A,
      competitor: { name: "X", city: "Y", website: "https://x.example" },
    });
    assertEquals(web.status, 400);
    assertEquals(web.body.error, "validation");
  } finally {
    stub.restore();
  }
});

Deno.test("T-CW4 — dedup 409 duplicate_competitor; cap 409 watch_limit on the 6th", async () => {
  const five = Array.from({ length: 5 }, (_, i) => ({
    id: crypto.randomUUID(),
    brand_id: BRAND_A,
    venue_listing_id: VENUE_A,
    name: `Rival ${i}`,
    city: "Test City",
    website: `https://rival-${i}.example`,
    place_pool_id: null,
    created_by: USER_A,
    created_at: new Date().toISOString(),
  }));
  const stub = installStub({ ...twoBrandWorld(), toolCompetitors: five.slice(0, 1) });
  try {
    // Same website twice on one venue → 409 duplicate_competitor.
    const dup = await post(handler, {
      action: "watch_add",
      lane: "app",
      brand_id: BRAND_A,
      venue_listing_id: VENUE_A,
      competitor: { name: "Rival Again", city: "Test City", website: "https://RIVAL-0.example " },
    }, TOKEN_A);
    assertEquals(dup.status, 409);
    assertEquals(dup.body.error, "duplicate_competitor");
  } finally {
    stub.restore();
  }
  const stub2 = installStub({ ...twoBrandWorld(), toolCompetitors: five });
  try {
    const sixth = await post(handler, {
      action: "watch_add",
      lane: "app",
      brand_id: BRAND_A,
      venue_listing_id: VENUE_A,
      competitor: { name: "One Too Many", city: "Test City", website: "https://sixth.example" },
    }, TOKEN_A);
    assertEquals(sixth.status, 409);
    assertEquals(sixth.body.error, "watch_limit");
    assertEquals(stub2.state.toolCompetitors.length, 5, "cap holds");
  } finally {
    stub2.restore();
  }
});

Deno.test("app-lane search runs the P-3 chain first; anonymous search byte-stable", async () => {
  const stub = installStub({ ...twoBrandWorld() });
  try {
    const forged = await post(handler, {
      action: "search",
      lane: "app",
      brand_id: BRAND_A,
      q: "stub",
    }, "forged");
    assertEquals(forged.status, 401);
    const ok = await post(handler, {
      action: "search",
      lane: "app",
      brand_id: BRAND_A,
      q: "stub",
    }, TOKEN_A);
    assertEquals(ok.status, 200);
    assert(Array.isArray(ok.body.results));
    // Anonymous search unchanged.
    const anon = await post(handler, { action: "search", q: "stub" });
    assertEquals(anon.status, 200);
    assert(Array.isArray(anon.body.results));
  } finally {
    stub.restore();
  }
});
