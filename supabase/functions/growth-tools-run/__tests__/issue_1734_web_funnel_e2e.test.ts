// ISSUE-1734 T-W1 — the anonymous web funnel END-TO-END, byte-stable
// (I-PROPOSED-1734-WEB-FUNNEL-UNCHANGED / SC-1): run → gate → email → token →
// report, driven through the REAL three handlers sharing ONE harness state
// (mocked Gemini/Resend). Asserts:
//   • statuses created → report_ready → gated_email → emailed, in order
//   • pid/utm/ip_hash persisted on the web row exactly as before
//   • the emailed link keeps the /tools/venues/report?id=…&t=… shape
//   • growth-tools-report's {run_id, token} branch resolves the report;
//     a wrong token still 403s
//   • meta.schema_version:1 is stamped on the web lane too (T-S1 stamp half)
//
// fails-on-revert: reverting the lane branch (web insert carrying app fields)
// breaks the row asserts; reverting the gate's web path or the token compare
// turns the chain red; reverting P-11 turns the schema_version assert red.
//
// Run: deno test --allow-read --allow-env --allow-net \
//   supabase/functions/growth-tools-run/__tests__/issue_1734_web_funnel_e2e.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { installStub, post, VENUES_INPUT, VENUES_PASS1_PAYLOAD } from "./harness_1734.ts";
import { handler as runHandler, hashIp } from "../index.ts";
import { handler as gateHandler } from "../../growth-tools-gate/index.ts";
import { handler as reportHandler } from "../../growth-tools-report/index.ts";

Deno.test("T-W1 — anonymous run → gate → email → token → report, statuses + attribution + link shape", async () => {
  const stub = installStub({
    gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
  });
  try {
    // 1. Anonymous run (no lane field; pid/utm/origin as the marketing site sends).
    const run = await post(runHandler, {
      action: "run",
      input: { ...VENUES_INPUT },
      pid: "tool_venues",
      utm: { source: "ig", campaign: "bio" },
      origin: "https://usemingla.com",
    }, undefined, { "x-forwarded-for": "6.6.6.6" });
    assertEquals(run.status, 200);
    const runId = run.body.run_id as string;
    assert(typeof runId === "string");
    assertEquals(run.body.report.meta.schema_version, 1, "P-11 stamps the web lane too");

    const row = stub.state.toolLeads[0];
    assertEquals(row.lane, "web");
    assertEquals(row.pid, "tool_venues");
    assertEquals(row.utm.source, "ig");
    assertEquals(row.ip_hash, await hashIp("6.6.6.6"));
    assertEquals(row.user_id ?? null, null);
    assertEquals(row.brand_id ?? null, null);

    // 2. Gate: capture the email, mint the token, send both emails.
    const gate = await post(gateHandler, {
      run_id: runId,
      email: "lead@example.com",
      origin: "https://usemingla.com",
    });
    assertEquals(gate.status, 200);
    assertEquals(gate.body.ok, true);
    assertEquals(row.email, "lead@example.com");
    const token = row.report_token as string;
    assert(typeof token === "string" && token.length >= 32, "token minted");

    // Visitor email carries the tokenized link with the exact path shape.
    const visitorSend = stub.state.resendSends.find((s) =>
      Array.isArray(s.to) && s.to[0] === "lead@example.com"
    );
    assert(visitorSend, "visitor email sent");
    const linkRe = new RegExp(
      `https://usemingla\\.com/tools/venues/report\\?id=${runId}&t=${token}`,
    );
    assert(
      linkRe.test(String(visitorSend.text)),
      "emailed link keeps the /tools/venues/report?id=…&t=… shape",
    );
    // Founder notify fired once (report_ready → gated_email transition).
    const founderSends = stub.state.resendSends.filter((s) =>
      Array.isArray(s.to) && s.to[0] === "seth@usemingla.com"
    );
    assertEquals(founderSends.length, 1);

    // 3. Full status chain, in order (SC-1).
    assertEquals(stub.state.statusLog[runId], [
      "created",
      "report_ready",
      "gated_email",
      "emailed",
    ]);

    // 4. Report by token (the web branch — untouched).
    const report = await post(reportHandler, { run_id: runId, token });
    assertEquals(report.status, 200);
    assertEquals(report.body.report.meta.schema_version, 1);
    // Wrong token still 403s (constant-time compare path).
    const wrong = await post(reportHandler, { run_id: runId, token: "x".repeat(token.length) });
    assertEquals(wrong.status, 403);
    assertEquals(wrong.body.error, "forbidden");
  } finally {
    stub.restore();
  }
});
