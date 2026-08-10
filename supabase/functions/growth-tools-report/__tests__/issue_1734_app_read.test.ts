// ISSUE-1734 — growth-tools-report's AUTHENTICATED app branch (P-26, amended
// P-43 + OQ-U1). Runs the REAL `handler` against the harness. Covers:
//
//   T-A4 / T-SR3  leak check: no app-lane response at ANY status contains
//         report_token / email / ip_hash / pid / utm — and the DB select-list
//         itself is allowlisted (asserted on the intercepted request URL)
//   read-by-run_id: created / failed / report_ready bodies (+ input, OQ-U1)
//   read-by-client_ref: newest attempt resolves (P-27 resume)
//   T-A3  cross-brand: brand B on brand A's run → 403 (by run_id AND by
//         client_ref); a web row (NULL brand_id) → 403; missing → 404
//   T-SR1 (read half) latest-by-subject: newest + include_previous returns
//         both, newest first — the client-side diff contract (P-49)
//   T-SR3 empty state: a never-run subject → 200 {status:"none"} — NOT 404
//   T-S1  (read half) a LEGACY report without meta.schema_version still reads
//   selector exclusivity → 400; forged JWT → 401; web token branch untouched
//
// fails-on-revert: widening APP_READ_COLUMNS turns the select-list assert red;
// deleting the row.brand_id equality turns the cross-brand 403s red; swapping
// the subject empty-state to 404 turns T-SR3 red.
//
// Run: deno test --allow-read --allow-env --allow-net \
//   supabase/functions/growth-tools-report/__tests__/issue_1734_app_read.test.ts

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
  TOKEN_B,
  twoBrandWorld,
  USER_A,
  VENUE_A,
} from "../../growth-tools-run/__tests__/harness_1734.ts";
import { handler } from "../index.ts";

const READY_ID = "aaaa1111-1111-4111-8111-aaaaaaaa1111";
const CREATED_ID = "bbbb2222-2222-4222-8222-bbbbbbbb2222";
const FAILED_ID = "cccc3333-3333-4333-8333-cccccccc3333";
const LEGACY_ID = "dddd4444-4444-4444-8444-dddddddd4444";
const WEB_ID = "eeee5555-5555-4555-8555-eeeeeeee5555";
const CLIENT_REF = "ffff6666-6666-4666-8666-ffffffff6666";
const SUBJECT = `venue:${VENUE_A}`;

// Sentinel secrets that must NEVER leak into an app-lane response.
const SECRET_TOKEN = "secret-report-token-should-never-leak-0123456789";
const SECRET_EMAIL = "leaky-lead@example.com";
const SECRET_IP = "secret-ip-hash-never-leak";
const SECRET_PID = "secret-pid-never-leak";

function appRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    tool: "venues",
    status: "report_ready",
    input: {
      name: "Owned Venue",
      city: "Test City",
      website: "https://o.example",
    },
    report: {
      scores: { grade: "B", overall: 72 },
      meta: { schema_version: 1 },
    },
    lane: "app",
    user_id: USER_A,
    brand_id: BRAND_A,
    input_hash: "h",
    client_ref: null,
    subject_ref: null,
    pid: null,
    utm: null,
    ip_hash: null,
    email: null,
    report_token: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function seed(): Record<string, unknown>[] {
  return [
    appRow({
      id: READY_ID,
      client_ref: CLIENT_REF,
      subject_ref: SUBJECT,
      // Poison the row with web-lane secrets so ANY leak is visible. (A real
      // app row never carries these; the leak check must hold regardless.)
      report_token: SECRET_TOKEN,
      email: SECRET_EMAIL,
      ip_hash: SECRET_IP,
      pid: SECRET_PID,
      created_at: new Date(Date.now() - 1_000).toISOString(),
    }),
    appRow({
      id: CREATED_ID,
      status: "created",
      report: null,
      created_at: new Date(Date.now() - 2_000).toISOString(),
    }),
    appRow({
      id: FAILED_ID,
      status: "failed",
      report: null,
      created_at: new Date(Date.now() - 3_000).toISOString(),
    }),
    appRow({
      id: LEGACY_ID,
      subject_ref: SUBJECT,
      report: { scores: { grade: "C", overall: 60 } }, // NO meta.schema_version — legacy
      created_at: new Date(Date.now() - 60_000).toISOString(),
    }),
    {
      id: WEB_ID,
      tool: "venues",
      status: "emailed",
      input: { name: "Web Venue" },
      report: { web: true },
      lane: "web",
      user_id: null,
      brand_id: null,
      pid: "tool_venues",
      utm: null,
      ip_hash: SECRET_IP,
      email: SECRET_EMAIL,
      report_token: SECRET_TOKEN,
      created_at: new Date().toISOString(),
    },
  ];
}

function appRead(body: Record<string, unknown>, token = TOKEN_A) {
  return post(handler, { lane: "app", brand_id: BRAND_A, ...body }, token);
}

function assertNoLeak(body: unknown) {
  const s = JSON.stringify(body);
  assert(!s.includes(SECRET_TOKEN), "report_token must never leak");
  assert(!s.includes(SECRET_EMAIL), "email must never leak");
  assert(!s.includes(SECRET_IP), "ip_hash must never leak");
  assert(!s.includes(SECRET_PID), "pid must never leak");
}

Deno.test("read-by-run_id — created/failed/ready bodies + T-A4 leak check + allowlisted select-list", async () => {
  const stub = installStub({ ...twoBrandWorld(), toolLeads: seed() });
  try {
    const ready = await appRead({ run_id: READY_ID });
    assertEquals(ready.status, 200);
    assertEquals(ready.body.status, "report_ready");
    assertEquals(ready.body.report.scores.grade, "B");
    assertEquals(ready.body.input.name, "Owned Venue", "OQ-U1: input returned");
    assertNoLeak(ready.body);

    const created = await appRead({ run_id: CREATED_ID });
    assertEquals(created.status, 200);
    assertEquals(created.body.status, "created");
    assertNoLeak(created.body);

    const failed = await appRead({ run_id: FAILED_ID });
    assertEquals(failed.status, 200);
    assertEquals(failed.body.status, "failed");
    assertEquals(failed.body.reason, "failed");
    assertNoLeak(failed.body);

    // The DB select-list itself is allowlisted — no forbidden column is even
    // requested (I-PROPOSED-1734-TOKEN-FLOW-UNTOUCHED enforcement point).
    const selects = stub.state.requests
      .filter((r) =>
        r.method === "GET" && r.url.includes("/rest/v1/tool_leads")
      )
      .map((r) =>
        decodeURIComponent(new URL(r.url).searchParams.get("select") ?? "")
      );
    assert(selects.length > 0, "tool_leads reads observed");
    // NOT a substring check (a `select=*` widening would sail past
    // `includes` — the unfalsifiable-test class): every requested column must
    // be a member of the exact OQ-U1 allowlist, and `*` is rejected outright.
    const ALLOWED = new Set([
      "id",
      "status",
      "report",
      "input",
      "brand_id",
      "created_at",
    ]);
    for (const sel of selects) {
      assert(
        sel !== "*" && sel.length > 0,
        "select-list must be explicit, never *",
      );
      for (const col of sel.split(",").map((c) => c.trim())) {
        assert(
          ALLOWED.has(col),
          `select-list column '${col}' is outside the P-26/OQ-U1 allowlist (got: ${sel})`,
        );
      }
    }
  } finally {
    stub.restore();
  }
});

Deno.test("read-by-client_ref — newest attempt resolves (P-27 resume)", async () => {
  const stub = installStub({ ...twoBrandWorld(), toolLeads: seed() });
  try {
    const r = await appRead({ client_ref: CLIENT_REF });
    assertEquals(r.status, 200);
    assertEquals(r.body.status, "report_ready");
    assertNoLeak(r.body);
  } finally {
    stub.restore();
  }
});

Deno.test("T-A3 — cross-brand read → 403 on run_id AND client_ref; web row → 403; missing → 404", async () => {
  const stub = installStub({ ...twoBrandWorld(), toolLeads: seed() });
  try {
    const byId = await post(handler, {
      lane: "app",
      brand_id: BRAND_B,
      run_id: READY_ID,
    }, TOKEN_B);
    assertEquals(byId.status, 403, "brand B must not read brand A's run");
    const byRef = await post(
      handler,
      { lane: "app", brand_id: BRAND_B, client_ref: CLIENT_REF },
      TOKEN_B,
    );
    assertEquals(byRef.status, 403);
    const webRow = await appRead({ run_id: WEB_ID });
    assertEquals(
      webRow.status,
      403,
      "a web row (NULL brand_id) can never match",
    );
    const missing = await appRead({
      run_id: "99999999-9999-4999-8999-999999999999",
    });
    assertEquals(missing.status, 404);
  } finally {
    stub.restore();
  }
});

Deno.test("T-SR1 (read) — latest-by-subject newest-first; include_previous returns both; T-S1 legacy row reads", async () => {
  const stub = installStub({ ...twoBrandWorld(), toolLeads: seed() });
  try {
    const latest = await appRead({ tool: "venues", subject_ref: SUBJECT });
    assertEquals(latest.status, 200);
    assertEquals(latest.body.status, "report_ready");
    assertEquals(latest.body.run_id, READY_ID, "newest first");
    assertEquals("previous" in latest.body, false);
    assertNoLeak(latest.body);

    const both = await appRead({
      tool: "venues",
      subject_ref: SUBJECT,
      include_previous: true,
    });
    assertEquals(both.status, 200);
    assertEquals(both.body.run_id, READY_ID);
    assertEquals(
      both.body.previous.run_id,
      LEGACY_ID,
      "prior report for the diff (P-49)",
    );
    // T-S1 read half: the legacy row has NO meta.schema_version and still serves.
    assertEquals(both.body.previous.report.scores.grade, "C");
    assertEquals(both.body.previous.report.meta ?? null, null);
    assertNoLeak(both.body);
  } finally {
    stub.restore();
  }
});

Deno.test("T-SR3 — never-run subject → 200 {status:'none'}, NOT 404; cross-brand subject probe is empty", async () => {
  const stub = installStub({ ...twoBrandWorld(), toolLeads: seed() });
  try {
    const none = await appRead({
      tool: "venues",
      subject_ref: "venue:00000000-0000-4000-8000-000000000000",
    });
    assertEquals(none.status, 200);
    assertEquals(none.body.status, "none");
    // Brand B probing brand A's subject: keyed by B's brand → structurally empty.
    const probe = await post(
      handler,
      { lane: "app", brand_id: BRAND_B, tool: "venues", subject_ref: SUBJECT },
      TOKEN_B,
    );
    assertEquals(probe.status, 200);
    assertEquals(
      probe.body.status,
      "none",
      "no oracle: foreign subjects read as never-run",
    );
  } finally {
    stub.restore();
  }
});

Deno.test("selector exclusivity → 400; forged JWT → 401; malformed subject_ref → 400", async () => {
  const stub = installStub({ ...twoBrandWorld(), toolLeads: seed() });
  try {
    const both = await appRead({ run_id: READY_ID, client_ref: CLIENT_REF });
    assertEquals(both.status, 400);
    const nothing = await appRead({});
    assertEquals(nothing.status, 400);
    const forged = await post(handler, {
      lane: "app",
      brand_id: BRAND_A,
      run_id: READY_ID,
    }, "forged");
    assertEquals(forged.status, 401);
    const badRef = await appRead({
      tool: "venues",
      subject_ref: "venue:not-a-uuid",
    });
    assertEquals(badRef.status, 400);
    const badTool = await appRead({ tool: "nope", subject_ref: SUBJECT });
    assertEquals(badTool.status, 400);
  } finally {
    stub.restore();
  }
});

Deno.test("web token branch untouched — valid token 200, wrong token 403, no lane field ever needed", async () => {
  const stub = installStub({ ...twoBrandWorld(), toolLeads: seed() });
  try {
    const ok = await post(handler, { run_id: WEB_ID, token: SECRET_TOKEN });
    assertEquals(ok.status, 200);
    assertEquals(ok.body.report.web, true);
    const bad = await post(handler, {
      run_id: WEB_ID,
      token: "y".repeat(SECRET_TOKEN.length),
    });
    assertEquals(bad.status, 403);
  } finally {
    stub.restore();
  }
});
