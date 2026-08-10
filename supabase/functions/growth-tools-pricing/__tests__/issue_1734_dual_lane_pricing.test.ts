// ISSUE-1734 — dual-lane suite for the PRICING engine (tool value
// 'experiences'; sibling-suite rule). Per-engine deltas: app happy path,
// `{type:"venue"}` subject ACCEPTED here (standing pricing checks, P-40) with
// server-side ownership (foreign venue → 403), competitor subject REJECTED
// (venues-only), cap 15 (env key "pricing"), cache subject isolation, web
// byte-stability, timeout wiring.
//
// Run: deno test --allow-read --allow-env --allow-net \
//   supabase/functions/growth-tools-pricing/__tests__/issue_1734_dual_lane_pricing.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  BRAND_A,
  installStub,
  post,
  PRICING_INPUT,
  PRICING_SYNTH_PAYLOAD,
  TOKEN_A,
  twoBrandWorld,
  USER_A,
  VENUE_A,
  VENUE_B,
} from "../../growth-tools-run/__tests__/harness_1734.ts";
import { handler } from "../index.ts";

function appRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: "run",
    lane: "app",
    brand_id: BRAND_A,
    input: { ...PRICING_INPUT },
    ...overrides,
  };
}

const GEMINI_OK = {
  structuredPayload: PRICING_SYNTH_PAYLOAD,
  groundedPayload: {},
  groundedStatus: 200,
};

Deno.test("pricing app happy path — identity row + schema_version; venue subject stamped", async () => {
  const stub = installStub({ ...twoBrandWorld(), gemini: GEMINI_OK });
  try {
    const r = await post(handler, appRun({ subject: { type: "venue", id: VENUE_A } }), TOKEN_A);
    assertEquals(r.status, 200);
    assert(typeof r.body.run_id === "string");
    assertEquals(r.body.report.meta.schema_version, 1);
    const row = stub.state.toolLeads[0];
    assertEquals(row.tool, "experiences");
    assertEquals(row.lane, "app");
    assertEquals(row.user_id, USER_A);
    assertEquals(row.brand_id, BRAND_A);
    assertEquals(row.subject_ref, `venue:${VENUE_A}`, "P-40: venue subject accepted on 'experiences'");
    assertEquals(row.pid, null);
    assertEquals(row.utm, null);
    assertEquals(row.ip_hash, null);
    assertEquals(stub.state.statusLog[row.id], ["created", "report_ready"]);
  } finally {
    stub.restore();
  }
});

Deno.test("pricing subject rules — foreign venue → 403 no row; competitor subject → 400 (venues-only)", async () => {
  const stub = installStub({ ...twoBrandWorld(), gemini: GEMINI_OK });
  try {
    const foreign = await post(handler, appRun({ subject: { type: "venue", id: VENUE_B } }), TOKEN_A);
    assertEquals(foreign.status, 403, "brand-B's venue id must not stamp brand-A history");
    const competitor = await post(
      handler,
      appRun({ subject: { type: "competitor", id: VENUE_A } }),
      TOKEN_A,
    );
    assertEquals(competitor.status, 400, "competitor subjects are venues-tool-only (P-40)");
    assertEquals(stub.state.toolLeads.length, 0);
  } finally {
    stub.restore();
  }
});

Deno.test("pricing quota — cap 15 ('pricing' env key): the 16th distinct run → 429 scope:brand", async () => {
  const seeded = Array.from({ length: 15 }, (_, i) => ({
    id: crypto.randomUUID(),
    tool: "experiences",
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
  } finally {
    stub.restore();
  }
});

Deno.test("pricing cache — subject-aware: same input under venue:A vs subjectless never cross-serves", async () => {
  const stub = installStub({ ...twoBrandWorld(), gemini: GEMINI_OK });
  try {
    const first = await post(handler, appRun({ subject: { type: "venue", id: VENUE_A } }), TOKEN_A);
    assertEquals(first.status, 200);
    const subjectless = await post(handler, appRun(), TOKEN_A);
    assertEquals(subjectless.status, 200);
    assertEquals(subjectless.body.cached ?? false, false, "no cross-subject serve (P-42)");
    const recheck = await post(handler, appRun({ subject: { type: "venue", id: VENUE_A } }), TOKEN_A);
    assertEquals(recheck.status, 200);
    assertEquals(recheck.body.cached, true);
    assertEquals(recheck.body.run_id, first.body.run_id);
    assertEquals(stub.state.toolLeads.length, 2);
  } finally {
    stub.restore();
  }
});

Deno.test("pricing web lane byte-stable — pid/utm persisted, lane='web'", async () => {
  const stub = installStub({ ...twoBrandWorld(), gemini: GEMINI_OK });
  try {
    const r = await post(handler, {
      action: "run",
      input: { ...PRICING_INPUT },
      pid: "tool_pricing",
      utm: { source: "ig" },
    }, undefined, { "x-forwarded-for": "3.3.3.3" });
    assertEquals(r.status, 200);
    const row = stub.state.toolLeads[0];
    assertEquals(row.lane, "web");
    assertEquals(row.pid, "tool_pricing");
    assert(typeof row.ip_hash === "string");
    assertEquals(r.body.report.meta.schema_version, 1);
  } finally {
    stub.restore();
  }
});

Deno.test("pricing T-B1 wiring — aborted passes → 502 reason:timeout, row failed", async () => {
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
