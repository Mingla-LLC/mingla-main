// ISSUE-1734 [growth-tools shared platform] — TESTER adversarial suite.
// Independent of the implementor's happy-path suites; attacks DIFFERENT angles
// than issue_1734_dual_lane_run / _subject_watch / _app_read. Runs the REAL
// `handler` against the shared harness stub. Every case below is an attack the
// implementor's suites do NOT already make:
//
//   TT-1  Lane spoofing by CASE/TYPE games — P-2 is body-EXPLICIT and STRICT
//         (`lane === "app"`). "APP" / "App" / " app" / true / ["app"] / 1 must
//         ALL fall through to the WEB lane: an unauthenticated request with any
//         of them runs anonymously (200, lane='web'), never 401 and never the
//         app pipeline. (If isAppLane were ever loosened to a case-insensitive
//         or truthy match, a bare `lane:"APP"` would start 401-ing — this
//         locks the strict equality.)
//   TT-2  Wrong Authorization SCHEME on an app-lane run — `Authorization:
//         Basic …` (not Bearer) with lane:"app" → 401, zero rows, zero model
//         calls. The implementor tests "no header" and "forged token"; a
//         non-Bearer scheme is the third door and must also fail closed.
//   TT-3  Identity FORGERY on a WRITE — watch_add carrying a client `created_by`
//         (and a client `brand_id`-shaped competitor field) stores the VERIFIED
//         userId, never the client value (P-46: created_by = the P-3 userId).
//   TT-4  Cross-brand LATEST-JOIN leak in watch_list (COMMS-0136 join angle) —
//         brand A's watch row + a report_ready tool_leads row that carries the
//         SAME `competitor:<id>` subject but belongs to brand B → watch_list
//         for brand A must show `latest:null`, never brand B's grade. Binds to
//         the `.eq("brand_id", auth.brandId)` predicate on the latest lookup.
//   TT-5  Client-sent `subject_ref` STRING with NO `subject` object on a run →
//         ignored entirely; the row stores subject_ref = NULL (server-derived
//         only, P-41). Distinct from T-SR2, which sends a `subject` object too.
//   TT-6  watch_remove distinguishes missing (404) from foreign-but-existing
//         (403) and never deletes across brands (ownership on the delete
//         success path, P-5).
//
// fails-on-revert (tester-verified by true line deletion):
//   • TT-3 goes RED if `created_by: auth.userId` in handleWatchAdd is changed
//     to read the client field — verified at 9decc95ce.
//   • TT-4 goes RED if the `.eq("brand_id", auth.brandId)` predicate on the
//     watch_list latest lookup is deleted.
//
// Run: deno test --allow-read --allow-env --allow-net \
//   supabase/functions/growth-tools-run/__tests__/issue_1734_tester_adversarial.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  BRAND_A,
  BRAND_B,
  installStub,
  post,
  TOKEN_A,
  twoBrandWorld,
  USER_A,
  VENUE_A,
  VENUES_INPUT,
  VENUES_PASS1_PAYLOAD,
} from "./harness_1734.ts";
import { handler } from "../index.ts";

// ── TT-1: lane case/type spoofing never enters the app lane ──────────────────
Deno.test("TT-1 — lane case/type games ('APP','App',' app',true,[..],1) fall through to WEB, no auth required", async () => {
  const spoofs: unknown[] = ["APP", "App", "aPP", " app", "app ", true, ["app"], 1, {}];
  for (const laneVal of spoofs) {
    const stub = installStub({
      ...twoBrandWorld(),
      gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
    });
    try {
      // No Bearer at all. If any of these were treated as the app lane, the
      // request would 401. The ONLY correct outcome is a normal WEB run.
      const r = await post(handler, {
        action: "run",
        lane: laneVal,
        input: { ...VENUES_INPUT },
        pid: "tool_venues",
      });
      assertEquals(
        r.status,
        200,
        `lane=${JSON.stringify(laneVal)} must be WEB (200), got ${r.status}`,
      );
      assertEquals(stub.state.toolLeads.length, 1);
      assertEquals(
        stub.state.toolLeads[0].lane,
        "web",
        `lane=${JSON.stringify(laneVal)} must persist lane='web'`,
      );
      // web attribution kept — proves it took the real web path, not a no-op.
      assertEquals(stub.state.toolLeads[0].pid, "tool_venues");
    } finally {
      stub.restore();
    }
  }
});

// ── TT-2: a non-Bearer Authorization scheme on an app run fails closed ───────
Deno.test("TT-2 — Authorization: Basic (wrong scheme) + lane:'app' → 401, zero rows, zero model calls", async () => {
  const stub = installStub({
    ...twoBrandWorld(),
    gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
  });
  try {
    const r = await post(
      handler,
      { action: "run", lane: "app", brand_id: BRAND_A, input: { ...VENUES_INPUT } },
      undefined,
      { Authorization: "Basic dXNlcjpwYXNz" },
    );
    assertEquals(r.status, 401, "a non-Bearer scheme is not a credential");
    assertEquals(r.body.error, "unauthenticated");
    assertEquals(stub.state.toolLeads.length, 0, "no row on rejection");
    assertEquals(
      stub.state.geminiCalls.structured + stub.state.geminiCalls.grounded,
      0,
      "no model call on rejection",
    );
  } finally {
    stub.restore();
  }
});

// ── TT-3: created_by cannot be spoofed by the client on a write ──────────────
Deno.test("TT-3 — watch_add stores the VERIFIED userId, ignoring a client-sent created_by", async () => {
  const stub = installStub({ ...twoBrandWorld() });
  try {
    const evilUser = "99999999-9999-4999-8999-999999999999";
    const r = await post(
      handler,
      {
        action: "watch_add",
        lane: "app",
        brand_id: BRAND_A,
        venue_listing_id: VENUE_A,
        competitor: {
          name: "Rival Bar",
          city: "Test City",
          website: "https://rival-adv.example",
        },
        // Forgery attempts — both must be ignored:
        created_by: evilUser,
        brand_id_spoof: BRAND_B,
      },
      TOKEN_A,
    );
    assertEquals(r.status, 200);
    assertEquals(stub.state.toolCompetitors.length, 1);
    const row = stub.state.toolCompetitors[0];
    assertEquals(
      row.created_by,
      USER_A,
      "created_by MUST be the P-3 verified userId, never the client field",
    );
    assert(row.created_by !== evilUser, "client created_by must not win");
    assertEquals(row.brand_id, BRAND_A, "brand_id is the verified brand");
  } finally {
    stub.restore();
  }
});

// ── TT-4: watch_list latest-join can never surface another brand's report ────
Deno.test("TT-4 — watch_list latest-join is brand-scoped: brand B's report on the same subject never leaks to brand A", async () => {
  const world = twoBrandWorld();
  const CID = "abcdabcd-1111-4111-8111-abcdabcdabcd";
  const stub = installStub({
    ...world,
    // Brand A watches a competitor on its own venue.
    toolCompetitors: [
      {
        id: CID,
        brand_id: BRAND_A,
        venue_listing_id: VENUE_A,
        name: "Watched Rival",
        city: "Test City",
        website: "https://watched.example",
        place_pool_id: null,
        created_by: USER_A,
        created_at: new Date().toISOString(),
      },
    ],
    // A report_ready run for the SAME competitor subject — but owned by BRAND B.
    // (Simulates a poisoned/cross-brand row; the join must never pick it up.)
    toolLeads: [
      {
        id: crypto.randomUUID(),
        tool: "venues",
        status: "report_ready",
        input: {},
        report: { scores: { grade: "A", overall: 99 }, meta: { schema_version: 1 } },
        lane: "app",
        user_id: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
        brand_id: BRAND_B,
        input_hash: "x",
        subject_ref: `competitor:${CID}`,
        pid: null,
        utm: null,
        ip_hash: null,
        email: null,
        created_at: new Date().toISOString(),
      },
    ],
  });
  try {
    const r = await post(
      handler,
      {
        action: "watch_list",
        lane: "app",
        brand_id: BRAND_A,
        venue_listing_id: VENUE_A,
      },
      TOKEN_A,
    );
    assertEquals(r.status, 200);
    assertEquals(r.body.competitors.length, 1);
    assertEquals(
      r.body.competitors[0].latest,
      null,
      "brand B's grade for the same subject must NOT appear in brand A's list (COMMS-0136 join)",
    );
  } finally {
    stub.restore();
  }
});

// ── TT-5: a client-sent subject_ref STRING (no subject object) is ignored ────
Deno.test("TT-5 — top-level subject_ref string with NO subject object → ignored; row stores subject_ref=NULL", async () => {
  const stub = installStub({
    ...twoBrandWorld(),
    gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
  });
  try {
    const r = await post(
      handler,
      {
        action: "run",
        lane: "app",
        brand_id: BRAND_A,
        input: { ...VENUES_INPUT },
        // No `subject` object — only a forged raw string. Must be server-blind.
        subject_ref: "competitor:00000000-0000-4000-8000-000000000000",
      },
      TOKEN_A,
    );
    assertEquals(r.status, 200);
    assertEquals(stub.state.toolLeads.length, 1);
    assertEquals(
      stub.state.toolLeads[0].subject_ref,
      null,
      "a client subject_ref string is never stored (server-derived only, P-41)",
    );
  } finally {
    stub.restore();
  }
});

// ── TT-6: watch_remove — missing=404, foreign-but-existing=403, no cross delete ─
Deno.test("TT-6 — watch_remove: missing id → 404; another brand's existing row → 403 and is NOT deleted", async () => {
  const world = twoBrandWorld();
  const FOREIGN_CID = "dcdcdcdc-3333-4333-8333-dcdcdcdcdcdc";
  const stub = installStub({
    ...world,
    // A watch row that belongs to BRAND B (on brand B's venue).
    toolCompetitors: [
      {
        id: FOREIGN_CID,
        brand_id: BRAND_B,
        venue_listing_id: "ffffffff-6666-4666-8666-ffffffffffff", // VENUE_B
        name: "B's Rival",
        city: "Test City",
        website: "https://bs-rival.example",
        place_pool_id: null,
        created_by: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
        created_at: new Date().toISOString(),
      },
    ],
  });
  try {
    // Missing id → 404.
    const missing = await post(
      handler,
      {
        action: "watch_remove",
        lane: "app",
        brand_id: BRAND_A,
        id: "11111111-2222-4222-8222-111111111111",
      },
      TOKEN_A,
    );
    assertEquals(missing.status, 404);

    // Brand A tries to remove brand B's existing row → 403, row survives.
    const foreign = await post(
      handler,
      { action: "watch_remove", lane: "app", brand_id: BRAND_A, id: FOREIGN_CID },
      TOKEN_A,
    );
    assertEquals(foreign.status, 403, "cannot delete another brand's watch row");
    assertEquals(
      stub.state.toolCompetitors.length,
      1,
      "foreign row must NOT be deleted",
    );
    assertEquals(stub.state.toolCompetitors[0].id, FOREIGN_CID);
  } finally {
    stub.restore();
  }
});
