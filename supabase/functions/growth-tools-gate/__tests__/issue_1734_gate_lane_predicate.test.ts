// ISSUE-1734 T-W3 — the gate REFUSES app-lane rows (P-30,
// I-PROPOSED-1734-NOTIFY-WEB-GATE-ONLY). NEW file (append-only safe; the
// existing 1354 suites are untouched). Runs the REAL gate `handler` against
// the shared harness. Asserts, on a lane='app' report_ready row:
//   • POST {run_id, email} → 404 not_found (the lane='web' predicate excludes it)
//   • ZERO Resend calls (no visitor email, no founder notify)
//   • the row is UNCHANGED (no email captured, no token minted, no status move)
// and, on a lane='web' row, the gate behaves exactly as before (200, token,
// both emails) — so the predicate narrows app rows only.
//
// fails-on-revert: deleting the `.eq("lane", "web")` predicate makes the app
// row gate successfully (200 + notify + token) → every assert here turns red.
//
// Run: deno test --allow-read --allow-env --allow-net \
//   supabase/functions/growth-tools-gate/__tests__/issue_1734_gate_lane_predicate.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  BRAND_A,
  installStub,
  post,
  USER_A,
  VENUES_PASS1_PAYLOAD,
} from "../../growth-tools-run/__tests__/harness_1734.ts";
import { handler } from "../index.ts";

const APP_ROW_ID = "11111111-aaaa-4aaa-8aaa-111111111111";
const WEB_ROW_ID = "22222222-bbbb-4bbb-8bbb-222222222222";

function seedRows() {
  return [
    {
      id: APP_ROW_ID,
      tool: "venues",
      status: "report_ready",
      input: { name: "App Venue" },
      report: { ...VENUES_PASS1_PAYLOAD, venue: { name: "App Venue" } },
      lane: "app",
      user_id: USER_A,
      brand_id: BRAND_A,
      input_hash: "h1",
      subject_ref: null,
      pid: null,
      utm: null,
      ip_hash: null,
      email: null,
      report_token: null,
      created_at: new Date().toISOString(),
    },
    {
      id: WEB_ROW_ID,
      tool: "venues",
      status: "report_ready",
      input: { name: "Web Venue" },
      report: { ...VENUES_PASS1_PAYLOAD, venue: { name: "Web Venue" } },
      lane: "web",
      user_id: null,
      brand_id: null,
      pid: "tool_venues",
      utm: null,
      ip_hash: "somehash",
      email: null,
      report_token: null,
      created_at: new Date().toISOString(),
    },
  ];
}

Deno.test("T-W3 — gate on an app row → 404, ZERO Resend calls, row byte-unchanged", async () => {
  const stub = installStub({ toolLeads: seedRows() });
  try {
    const before = JSON.stringify(
      stub.state.toolLeads.find((r) => r.id === APP_ROW_ID),
    );
    const r = await post(handler, {
      run_id: APP_ROW_ID,
      email: "attacker@example.com",
      origin: "https://usemingla.com",
    });
    assertEquals(
      r.status,
      404,
      "P-30: the lane='web' predicate refuses app rows",
    );
    assertEquals(r.body.error, "not_found");
    assertEquals(
      stub.state.resendSends.length,
      0,
      "no visitor email, no founder notify",
    );
    const after = JSON.stringify(
      stub.state.toolLeads.find((row) => row.id === APP_ROW_ID),
    );
    assertEquals(
      after,
      before,
      "no email captured, no token minted, no status move",
    );
  } finally {
    stub.restore();
  }
});

Deno.test("T-W3 control — a web row still gates exactly as before (200 + token + both emails)", async () => {
  const stub = installStub({ toolLeads: seedRows() });
  try {
    const r = await post(handler, {
      run_id: WEB_ROW_ID,
      email: "lead@example.com",
      origin: "https://usemingla.com",
    });
    assertEquals(r.status, 200);
    assertEquals(r.body.ok, true);
    const row = stub.state.toolLeads.find((x) => x.id === WEB_ROW_ID)!;
    assertEquals(row.email, "lead@example.com");
    assert(
      typeof row.report_token === "string" && row.report_token.length >= 32,
    );
    assertEquals(stub.state.statusLog[WEB_ROW_ID], [
      "report_ready",
      "gated_email",
      "emailed",
    ]);
    const visitor = stub.state.resendSends.filter((s) =>
      Array.isArray(s.to) && s.to[0] === "lead@example.com"
    );
    const founder = stub.state.resendSends.filter((s) =>
      Array.isArray(s.to) && s.to[0] === "seth@usemingla.com"
    );
    assertEquals(visitor.length, 1);
    assertEquals(founder.length, 1);
  } finally {
    stub.restore();
  }
});
