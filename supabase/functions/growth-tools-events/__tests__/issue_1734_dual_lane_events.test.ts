// ISSUE-1734 — dual-lane suite for the EVENTS engine (sibling of the venues
// suite; the ad-engine sibling-suite rule analog: the shared helper changed,
// so every engine gets its own runtime proof). Covers the per-engine deltas:
//   • app happy path: lane='app' row, NULL pid/utm/ip_hash, verified ids,
//     meta.schema_version:1, cap 25 default (T-A1/T-S1 slice for events)
//   • NO subject accepted on this tool in v1 (P-40) → 400
//   • forged JWT → 401, zero rows, zero Gemini calls (T-A2 slice)
//   • quota: 25 seeded rows → 429 scope:brand (T-Q1 slice, events cap)
//   • cache hit → cached:true, same run_id (T-C1 slice)
//   • web lane byte-stable: pid/utm persisted, lane='web' (T-W2 slice)
//   • T-B1 wiring: aborted grounded+structured → 502 reason:timeout, row failed
//
// Run: deno test --allow-read --allow-env --allow-net \
//   supabase/functions/growth-tools-events/__tests__/issue_1734_dual_lane_events.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  BRAND_A,
  eventsInput,
  EVENTS_SYNTH_PAYLOAD,
  installStub,
  post,
  TOKEN_A,
  twoBrandWorld,
  USER_A,
  VENUE_A,
} from "../../growth-tools-run/__tests__/harness_1734.ts";
import { handler } from "../index.ts";

function appRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: "run",
    lane: "app",
    brand_id: BRAND_A,
    input: eventsInput(),
    ...overrides,
  };
}

const GEMINI_OK = {
  structuredPayload: EVENTS_SYNTH_PAYLOAD,
  groundedPayload: {}, // research parses {} → empty findings (fallback source)
  groundedStatus: 200,
};

Deno.test("events app happy path — identity row + schema_version + inline report", async () => {
  const stub = installStub({ ...twoBrandWorld(), gemini: GEMINI_OK });
  try {
    const r = await post(handler, appRun(), TOKEN_A);
    assertEquals(r.status, 200);
    assert(typeof r.body.run_id === "string");
    assertEquals(r.body.report.meta.schema_version, 1);
    const row = stub.state.toolLeads[0];
    assertEquals(row.tool, "events");
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

Deno.test("events accepts NO subject in v1 (P-40) → 400; forged JWT → 401 + zero rows/calls", async () => {
  const stub = installStub({ ...twoBrandWorld(), gemini: GEMINI_OK });
  try {
    const withSubject = await post(
      handler,
      appRun({ subject: { type: "venue", id: VENUE_A } }),
      TOKEN_A,
    );
    assertEquals(withSubject.status, 400, "gate runs are subjectless; 'event:' is reserved");
    const forged = await post(handler, appRun(), "forged");
    assertEquals(forged.status, 401);
    assertEquals(stub.state.toolLeads.length, 0);
    assertEquals(stub.state.geminiCalls.structured + stub.state.geminiCalls.grounded, 0);
  } finally {
    stub.restore();
  }
});

Deno.test("events quota — cap 25: the 26th distinct run → 429 scope:brand", async () => {
  const seeded = Array.from({ length: 25 }, (_, i) => ({
    id: crypto.randomUUID(),
    tool: "events",
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
  const stub = installStub({ ...twoBrandWorld(), toolLeads: seeded, gemini: GEMINI_OK });
  try {
    const r = await post(handler, appRun(), TOKEN_A);
    assertEquals(r.status, 429);
    assertEquals(r.body.error, "rate_limited");
    assertEquals(r.body.scope, "brand");
    assertEquals(stub.state.toolLeads.length, 25);
  } finally {
    stub.restore();
  }
});

Deno.test("events cache — identical input → cached:true, same run_id, no new row", async () => {
  const stub = installStub({ ...twoBrandWorld(), gemini: GEMINI_OK });
  try {
    const input = eventsInput();
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

Deno.test("events web lane byte-stable — pid/utm persisted, lane='web'", async () => {
  const stub = installStub({ ...twoBrandWorld(), gemini: GEMINI_OK });
  try {
    const r = await post(handler, {
      action: "run",
      input: eventsInput(),
      pid: "tool_events",
      utm: { source: "tiktok" },
    }, "sb-anon-key-bearer", { "x-forwarded-for": "5.5.5.5" });
    assertEquals(r.status, 200);
    const row = stub.state.toolLeads[0];
    assertEquals(row.lane, "web");
    assertEquals(row.pid, "tool_events");
    assertEquals(row.utm.source, "tiktok");
    assert(typeof row.ip_hash === "string");
    assertEquals(r.body.report.meta.schema_version, 1, "P-11 stamps the web lane too");
  } finally {
    stub.restore();
  }
});

Deno.test("events T-B1 wiring — aborted passes → 502 reason:timeout, row failed", async () => {
  const stub = installStub({
    ...twoBrandWorld(),
    gemini: { abortGrounded: true, abortStructured: true },
  });
  try {
    const r = await post(handler, appRun(), TOKEN_A);
    assertEquals(r.status, 502);
    assertEquals(r.body.error, "generation_failed");
    assertEquals(r.body.reason, "timeout");
    assertEquals(stub.state.statusLog[stub.state.toolLeads[0].id], ["created", "failed"]);
  } finally {
    stub.restore();
  }
});
