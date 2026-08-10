// ISSUE-1734 [growth-tools shared platform] — IMPLEMENTOR regression suite for
// the venues engine's dual-lane behavior. Runs the REAL `handler` against the
// harness stub (in-memory PostgREST/GoTrue/Gemini). Covers, per SPEC §7 + §9:
//
//   T-A1  app happy path: {run_id, report} + row with lane='app', verified
//         user_id/brand_id, input_hash, client_ref, NULL pid/utm/email/ip_hash,
//         meta.schema_version:1 (SC-2, SC-8)
//   T-A2  forged/expired JWT → 401, ZERO rows, ZERO Gemini calls (P-4 — never
//         downgraded to anonymous); non-member brand → 403, zero rows;
//         membership RPC error → 500 fail-closed
//   T-W2  web request CARRYING a Bearer header, no lane field → processed as
//         the web lane; lane='web' row; pid/utm persisted (SC-1 slice)
//   T-C1  identical input within 24h → cached:true, SAME run_id, no new row,
//         no external calls, quota untouched (SC-4)
//   T-C2  cache expiry/miss: >24h-old ready row (clock-shifted) → fresh run
//   T-A3  (cache angle) brand B re-running brand A's exact input → MISS —
//         never serves A's row (SC-4 "only for the owning brand")
//   T-Q1  cap boundary: 10 seeded app rows → the 11th run → 429
//         {error:"rate_limited", scope:"brand"}; web 429 body has NO scope
//   T-Q2  lane counter isolation: 10 web rows on one IP never block the brand;
//         10 app rows never block that IP's web budget (SC-3)
//   T-Q3  quota-count DB error → run proceeds (fail-open) + structured
//         "[growth-tools] app-quota-count-failed" log line
//   T-B1  (wiring) aborted structured pass → 502 {error:"generation_failed",
//         reason:"timeout"}, row 'failed' (SC-7); non-abort upstream failure →
//         reason:"upstream_failed"
//
// fails-on-revert: deleting the lane branch in handleRun turns T-A1 red
// (no lane column written, pid persisted); deleting the 401-not-downgrade
// (P-3 chain) turns T-A2 red (an anonymous row would be written); deleting the
// NULL-ip_hash posture turns T-Q2 red; deleting the cache lookup turns T-C1
// red; deleting `reason` on the timeout path turns T-B1 red.
//
// Run: deno test --allow-read --allow-env --allow-net \
//   supabase/functions/growth-tools-run/__tests__/issue_1734_dual_lane_run.test.ts

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
  VENUES_INPUT,
  VENUES_PASS1_PAYLOAD,
} from "./harness_1734.ts";
import { handler, hashIp } from "../index.ts";

const CLIENT_REF = "12345678-1234-4123-8123-123456789abc";

function appRunBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    action: "run",
    lane: "app",
    brand_id: BRAND_A,
    input: { ...VENUES_INPUT },
    client_ref: CLIENT_REF,
    ...overrides,
  };
}

Deno.test("T-A1 — app happy path: verified identity row + inline report + schema_version", async () => {
  const stub = installStub({
    ...twoBrandWorld(),
    gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
  });
  try {
    const r = await post(handler, appRunBody(), TOKEN_A);
    assertEquals(r.status, 200);
    assert(typeof r.body.run_id === "string", "returns run_id");
    assert(
      r.body.report && typeof r.body.report === "object",
      "returns inline report",
    );
    assertEquals(
      r.body.report.meta.schema_version,
      1,
      "P-11: meta.schema_version stamped",
    );

    assertEquals(stub.state.toolLeads.length, 1);
    const row = stub.state.toolLeads[0];
    assertEquals(row.lane, "app");
    assertEquals(row.user_id, USER_A, "user_id from auth.getUser, not client");
    assertEquals(row.brand_id, BRAND_A);
    assertEquals(row.client_ref, CLIENT_REF);
    assert(
      typeof row.input_hash === "string" && row.input_hash.length === 64,
      "sha256 input_hash",
    );
    assertEquals(row.pid, null, "P-7: pid NULL on app rows");
    assertEquals(row.utm, null, "P-7: utm NULL on app rows");
    assertEquals(row.ip_hash, null, "P-9: ip_hash NULL on app rows");
    assertEquals(row.subject_ref, null, "no subject sent → NULL");
    assertEquals(
      row.email ?? null,
      null,
      "email never written on the app lane",
    );
    assertEquals(stub.state.statusLog[row.id], ["created", "report_ready"]);
  } finally {
    stub.restore();
  }
});

Deno.test("T-A2 — forged JWT → 401, no row, no Gemini; non-member → 403; RPC error → 500 fail-closed", async () => {
  const stub = installStub({
    ...twoBrandWorld(),
    gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
  });
  try {
    // Forged/expired token.
    const forged = await post(handler, appRunBody(), "forged-token");
    assertEquals(forged.status, 401);
    assertEquals(forged.body.error, "unauthenticated");
    // No Bearer at all.
    const bare = await post(handler, appRunBody());
    assertEquals(bare.status, 401);
    // Valid token, foreign brand.
    const foreign = await post(
      handler,
      appRunBody({ brand_id: BRAND_B }),
      TOKEN_A,
    );
    assertEquals(foreign.status, 403);
    assertEquals(foreign.body.error, "forbidden");
    // P-4: rejected, never downgraded — zero rows, zero model calls.
    assertEquals(
      stub.state.toolLeads.length,
      0,
      "no row written on any rejection",
    );
    assertEquals(
      stub.state.geminiCalls.structured + stub.state.geminiCalls.grounded,
      0,
      "no Gemini call on any rejection",
    );
  } finally {
    stub.restore();
  }
  // Membership RPC error → 500 (fail closed, P-3 step 4).
  const stub2 = installStub({
    users: { [TOKEN_A]: USER_A },
    membership: () => "error",
    gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
  });
  try {
    const r = await post(handler, appRunBody(), TOKEN_A);
    assertEquals(r.status, 500);
    assertEquals(r.body.error, "server");
    assertEquals(stub2.state.toolLeads.length, 0);
  } finally {
    stub2.restore();
  }
});

Deno.test("T-W2 — Bearer-carrying web request (no lane) still runs anonymously as lane='web'", async () => {
  const stub = installStub({
    ...twoBrandWorld(),
    gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
  });
  try {
    const r = await post(
      handler,
      {
        action: "run",
        input: { ...VENUES_INPUT },
        pid: "tool_venues",
        utm: { source: "ig" },
      },
      "sb-anon-key-just-like-the-marketing-transport-sends",
      { "x-forwarded-for": "9.9.9.9" },
    );
    assertEquals(r.status, 200);
    assert(typeof r.body.run_id === "string");
    assertEquals(stub.state.toolLeads.length, 1);
    const row = stub.state.toolLeads[0];
    assertEquals(
      row.lane,
      "web",
      "header presence NEVER selects the lane (P-2)",
    );
    assertEquals(row.pid, "tool_venues", "web pid persisted as before");
    assertEquals(row.utm.source, "ig", "web utm persisted as before");
    assertEquals(row.user_id ?? null, null);
    assertEquals(row.brand_id ?? null, null);
    assertEquals(
      row.ip_hash,
      await hashIp("9.9.9.9"),
      "web ip hash persisted as before",
    );
    assertEquals(
      r.body.report.meta.schema_version,
      1,
      "P-11 stamps BOTH lanes",
    );
  } finally {
    stub.restore();
  }
});

Deno.test("T-C1 — identical input within 24h → cached:true, same run_id, no insert, no model call, no quota", async () => {
  const stub = installStub({
    ...twoBrandWorld(),
    gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
  });
  try {
    const first = await post(handler, appRunBody(), TOKEN_A);
    assertEquals(first.status, 200);
    const callsAfterFirst = stub.state.geminiCalls.structured +
      stub.state.geminiCalls.grounded;
    const second = await post(handler, appRunBody(), TOKEN_A);
    assertEquals(second.status, 200);
    assertEquals(second.body.cached, true, "P-22: cache hit flagged");
    assertEquals(
      second.body.run_id,
      first.body.run_id,
      "SAME run_id re-served",
    );
    assertEquals(stub.state.toolLeads.length, 1, "no second row inserted");
    assertEquals(
      stub.state.geminiCalls.structured + stub.state.geminiCalls.grounded,
      callsAfterFirst,
      "zero external calls on the cache hit",
    );
  } finally {
    stub.restore();
  }
});

Deno.test("T-C2 — cache miss when the only matching row is >24h old → fresh run consumes quota", async () => {
  const stub = installStub({
    ...twoBrandWorld(),
    gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
  });
  try {
    const first = await post(handler, appRunBody(), TOKEN_A);
    assertEquals(first.status, 200);
    // Clock-shift the stored row out of the 24h window.
    stub.state.toolLeads[0].created_at = new Date(Date.now() - 25 * 3600_000)
      .toISOString();
    const second = await post(handler, appRunBody(), TOKEN_A);
    assertEquals(second.status, 200);
    assertEquals(
      second.body.cached ?? false,
      false,
      "no cache flag on a fresh run",
    );
    assertEquals(stub.state.toolLeads.length, 2, "fresh row inserted");
  } finally {
    stub.restore();
  }
});

Deno.test("T-A3 (cache angle) — brand B with brand A's exact input is a MISS, never A's row", async () => {
  const stub = installStub({
    ...twoBrandWorld(),
    gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
  });
  try {
    const a = await post(handler, appRunBody(), TOKEN_A);
    assertEquals(a.status, 200);
    const b = await post(
      handler,
      appRunBody({ brand_id: BRAND_B, client_ref: undefined }),
      TOKEN_B,
    );
    assertEquals(b.status, 200);
    assertEquals(
      b.body.cached ?? false,
      false,
      "cross-brand cache serve is forbidden (P-5)",
    );
    assert(b.body.run_id !== a.body.run_id, "brand B gets its OWN run");
    assertEquals(stub.state.toolLeads.length, 2);
  } finally {
    stub.restore();
  }
});

function seededAppRows(n: number, tool = "venues"): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    id: crypto.randomUUID(),
    tool,
    status: "report_ready",
    input: {},
    report: { ok: true },
    lane: "app",
    user_id: USER_A,
    brand_id: BRAND_A,
    input_hash: `distinct-${i}`,
    subject_ref: null,
    pid: null,
    utm: null,
    ip_hash: null,
    email: null,
    created_at: new Date(Date.now() - i * 60_000).toISOString(),
  }));
}

Deno.test("T-Q1 — 11th distinct-input app run past the cap → 429 scope:brand; web 429 stays bare", async () => {
  const stub = installStub({
    ...twoBrandWorld(),
    toolLeads: seededAppRows(10),
    gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
  });
  try {
    const r = await post(handler, appRunBody(), TOKEN_A);
    assertEquals(r.status, 429);
    assertEquals(r.body.error, "rate_limited");
    assertEquals(r.body.scope, "brand", "additive scope field on the app lane");
    assertEquals(stub.state.toolLeads.length, 10, "no row past the cap");
  } finally {
    stub.restore();
  }
  // Web lane 429 body is unchanged (no scope field).
  const ip = "8.8.4.4";
  const ipHash = await hashIp(ip);
  const webRows = Array.from({ length: 10 }, (_, i) => ({
    id: crypto.randomUUID(),
    tool: "venues",
    status: "report_ready",
    input: {},
    lane: "web",
    ip_hash: ipHash,
    created_at: new Date(Date.now() - i * 60_000).toISOString(),
  }));
  const stub2 = installStub({
    ...twoBrandWorld(),
    toolLeads: webRows,
    gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
  });
  try {
    const r = await post(
      handler,
      { action: "run", input: { ...VENUES_INPUT } },
      undefined,
      {
        "x-forwarded-for": ip,
      },
    );
    assertEquals(r.status, 429);
    assertEquals(r.body.error, "rate_limited");
    assertEquals(
      "scope" in r.body,
      false,
      "web 429 body byte-stable — no scope field",
    );
  } finally {
    stub2.restore();
  }
});

Deno.test("T-Q2 — lane counter isolation: web rows never enter the brand count; app rows never enter the IP count", async () => {
  const ip = "7.7.7.7";
  const ipHash = await hashIp(ip);
  // 10 web rows on one synthetic IP — the brand's app quota must NOT see them.
  const webRows = Array.from({ length: 10 }, (_, i) => ({
    id: crypto.randomUUID(),
    tool: "venues",
    status: "report_ready",
    input: {},
    lane: "web",
    ip_hash: ipHash,
    created_at: new Date(Date.now() - i * 60_000).toISOString(),
  }));
  const stub = installStub({
    ...twoBrandWorld(),
    toolLeads: webRows,
    gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
  });
  try {
    // Even sent WITH the shared IP header, the app lane never consults it.
    const r = await post(handler, appRunBody(), TOKEN_A, {
      "x-forwarded-for": ip,
    });
    assertEquals(r.status, 200, "10 web rows on the IP do not block the brand");
  } finally {
    stub.restore();
  }
  // 10 app rows (ip_hash NULL) — the web IP budget must NOT see them.
  const stub2 = installStub({
    ...twoBrandWorld(),
    toolLeads: seededAppRows(10),
    gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
  });
  try {
    const r = await post(
      handler,
      { action: "run", input: { ...VENUES_INPUT } },
      undefined,
      {
        "x-forwarded-for": ip,
      },
    );
    assertEquals(r.status, 200, "10 app rows do not block the web IP");
  } finally {
    stub2.restore();
  }
});

Deno.test("T-Q3 — quota-count DB error → fail-open run + structured app-quota-count-failed log", async () => {
  const stub = installStub({
    ...twoBrandWorld(),
    quotaCountError: true,
    gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
  });
  const logged: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map((a) => String(a)).join(" "));
  };
  try {
    const r = await post(handler, appRunBody(), TOKEN_A);
    assertEquals(r.status, 200, "P-23: fail-OPEN on a counter read error");
    assert(
      logged.some((l) => l.includes("app-quota-count-failed")),
      "structured log line emitted (observably fail-open)",
    );
  } finally {
    console.error = realError;
    stub.restore();
  }
});

Deno.test("T-B1 (wiring) — aborted structured pass → 502 reason:timeout, row failed; HTTP failure → reason:upstream_failed", async () => {
  const stub = installStub({
    ...twoBrandWorld(),
    gemini: { abortStructured: true },
  });
  try {
    const r = await post(handler, appRunBody(), TOKEN_A);
    assertEquals(r.status, 502);
    assertEquals(
      r.body.error,
      "generation_failed",
      "web-visible error string unchanged",
    );
    assertEquals(r.body.reason, "timeout", "P-25: honest additive reason");
    assertEquals(stub.state.toolLeads.length, 1);
    assertEquals(stub.state.statusLog[stub.state.toolLeads[0].id], [
      "created",
      "failed",
    ]);
  } finally {
    stub.restore();
  }
  const stub2 = installStub({
    ...twoBrandWorld(),
    gemini: { structuredStatus: 500 },
  });
  try {
    const r = await post(handler, appRunBody(), TOKEN_A);
    assertEquals(r.status, 502);
    assertEquals(r.body.error, "generation_failed");
    assertEquals(r.body.reason, "upstream_failed");
  } finally {
    stub2.restore();
  }
});

Deno.test("client_ref must be a UUID when present → 400 validation", async () => {
  const stub = installStub({
    ...twoBrandWorld(),
    gemini: { structuredPayload: VENUES_PASS1_PAYLOAD },
  });
  try {
    const r = await post(
      handler,
      appRunBody({ client_ref: "not-a-uuid" }),
      TOKEN_A,
    );
    assertEquals(r.status, 400);
    assertEquals(r.body.error, "validation");
    assertEquals(stub.state.toolLeads.length, 0);
  } finally {
    stub.restore();
  }
});
