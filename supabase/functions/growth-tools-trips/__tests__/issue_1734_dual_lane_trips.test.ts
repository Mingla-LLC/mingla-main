// ISSUE-1734 — dual-lane suite for the TRIPS engine (sibling-suite rule: the
// shared helper changed, so every engine gets its own runtime proof). Covers
// the per-engine deltas: app happy path (lane row + schema_version), NO
// subject in v1 (design r26), forged JWT rejection, cap 15, cache hit, web
// byte-stability, and the timeout wiring.
//
// Run: deno test --allow-read --allow-env --allow-net \
//   supabase/functions/growth-tools-trips/__tests__/issue_1734_dual_lane_trips.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  BRAND_A,
  installStub,
  post,
  TOKEN_A,
  TRIPS_SYNTH_PAYLOAD,
  tripsInput,
  twoBrandWorld,
  USER_A,
  VENUE_A,
} from "../../growth-tools-run/__tests__/harness_1734.ts";
import { handler } from "../index.ts";

function appRun(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    action: "run",
    lane: "app",
    brand_id: BRAND_A,
    input: tripsInput(),
    ...overrides,
  };
}

const GEMINI_OK = {
  structuredPayload: TRIPS_SYNTH_PAYLOAD,
  groundedPayload: {},
  groundedStatus: 200,
};

Deno.test("trips app happy path — identity row + schema_version + inline report", async () => {
  const stub = installStub({ ...twoBrandWorld(), gemini: GEMINI_OK });
  try {
    const r = await post(handler, appRun(), TOKEN_A);
    assertEquals(r.status, 200);
    assert(typeof r.body.run_id === "string");
    assertEquals(r.body.report.meta.schema_version, 1);
    const row = stub.state.toolLeads[0];
    assertEquals(row.tool, "trips");
    assertEquals(row.lane, "app");
    assertEquals(row.user_id, USER_A);
    assertEquals(row.brand_id, BRAND_A);
    assertEquals(row.pid, null);
    assertEquals(row.utm, null);
    assertEquals(row.ip_hash, null);
    assertEquals(row.subject_ref, null);
    assertEquals(stub.state.statusLog[row.id], ["created", "report_ready"]);
  } finally {
    stub.restore();
  }
});

Deno.test("trips accept NO subject in v1 (design r26) → 400; forged JWT → 401 + zero rows/calls", async () => {
  const stub = installStub({ ...twoBrandWorld(), gemini: GEMINI_OK });
  try {
    const withSubject = await post(
      handler,
      appRun({ subject: { type: "venue", id: VENUE_A } }),
      TOKEN_A,
    );
    assertEquals(withSubject.status, 400);
    const forged = await post(handler, appRun(), "forged");
    assertEquals(forged.status, 401);
    assertEquals(stub.state.toolLeads.length, 0);
    assertEquals(
      stub.state.geminiCalls.structured + stub.state.geminiCalls.grounded,
      0,
    );
  } finally {
    stub.restore();
  }
});

Deno.test("trips quota — cap 15: the 16th distinct run → 429 scope:brand", async () => {
  const seeded = Array.from({ length: 15 }, (_, i) => ({
    id: crypto.randomUUID(),
    tool: "trips",
    status: "report_ready",
    input: {},
    lane: "app",
    user_id: USER_A,
    brand_id: BRAND_A,
    input_hash: `d-${i}`,
    subject_ref: null,
    ip_hash: null,
    created_at: new Date(Date.now() - i * 1000).toISOString(),
  }));
  const stub = installStub({
    ...twoBrandWorld(),
    toolLeads: seeded,
    gemini: GEMINI_OK,
  });
  try {
    const r = await post(handler, appRun(), TOKEN_A);
    assertEquals(r.status, 429);
    assertEquals(r.body.error, "rate_limited");
    assertEquals(r.body.scope, "brand");
    assertEquals(stub.state.toolLeads.length, 15);
  } finally {
    stub.restore();
  }
});

Deno.test("trips cache — identical input → cached:true, same run_id, no new row", async () => {
  const stub = installStub({ ...twoBrandWorld(), gemini: GEMINI_OK });
  try {
    const input = tripsInput();
    const first = await post(handler, appRun({ input }), TOKEN_A);
    assertEquals(first.status, 200);
    const second = await post(handler, appRun({ input }), TOKEN_A);
    assertEquals(second.status, 200);
    assertEquals(second.body.cached, true);
    assertEquals(second.body.run_id, first.body.run_id);
    assertEquals(stub.state.toolLeads.length, 1);
  } finally {
    stub.restore();
  }
});

Deno.test("trips web lane byte-stable — pid/utm persisted, lane='web'", async () => {
  const stub = installStub({ ...twoBrandWorld(), gemini: GEMINI_OK });
  try {
    const r = await post(
      handler,
      {
        action: "run",
        input: tripsInput(),
        pid: "tool_trips",
        utm: { source: "ig" },
      },
      undefined,
      { "x-forwarded-for": "4.4.4.4" },
    );
    assertEquals(r.status, 200);
    const row = stub.state.toolLeads[0];
    assertEquals(row.lane, "web");
    assertEquals(row.pid, "tool_trips");
    assert(typeof row.ip_hash === "string");
    assertEquals(r.body.report.meta.schema_version, 1);
  } finally {
    stub.restore();
  }
});

Deno.test("trips T-B1 wiring — aborted passes → 502 reason:timeout, row failed", async () => {
  const stub = installStub({
    ...twoBrandWorld(),
    gemini: { abortGrounded: true, abortStructured: true },
  });
  try {
    const r = await post(handler, appRun(), TOKEN_A);
    assertEquals(r.status, 502);
    assertEquals(r.body.error, "generation_failed");
    assertEquals(r.body.reason, "timeout");
    assertEquals(stub.state.statusLog[stub.state.toolLeads[0].id], [
      "created",
      "failed",
    ]);
  } finally {
    stub.restore();
  }
});
