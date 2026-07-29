// ISSUE-1354 [Admin: see all free-tool submissions] — TESTER adversarial
// regression test for the founder-notify hook. DIFFERENT ANGLE from the
// implementor's happy-path test (issue_1354_admin_notify.test.ts), which asserts
// builder CONTENT and STATIC source regexes. This one RUNS the real `handler`
// with a stubbed fetch (only api.resend.com is intercepted; the supabase-js DB
// calls are answered by a scripted stub that controls the PRIOR row status), and
// asserts the RUNTIME notify semantics:
//
//   1. Double-gate → no double-notify: a re-gate whose PRIOR status is
//      `gated_email` (or `emailed`) dispatches ZERO founder emails (the
//      idempotency guard is the prior-status read), while the visitor still gets
//      exactly one email and HTTP 200 — the anonymous-run partition proved by the
//      absence of any founder send on the non-`report_ready` transitions.
//   2. First gate (prior `report_ready`) → EXACTLY ONE founder email to
//      seth@usemingla.com, reply_to = the lead, and the visitor email + HTTP 200
//      are untouched.
//   3. Best-effort: when the founder-notify Resend call THROWS, the visitor email
//      still fires and the gate still returns HTTP 200 (a notify failure can never
//      degrade the visitor path).
//   4. Injection defense: buildLeadNotifyEmail HTML-escapes a hostile lead email
//      so it cannot inject markup into the founder email body.
//
// fails-on-revert: deleting the notify block drops the founder send on the first
// gate (test 2 fails: 0 !== 1) and the best-effort send (test 3 fails). Weakening
// the guard so it fires on every gate makes the re-gate emit a founder send
// (test 1 fails: 1 !== 0). Dropping escapeHtml on the email makes test 4 fail.
//
// Run: deno test --allow-read --allow-env --allow-net \
//   supabase/functions/growth-tools-gate/__tests__/issue_1354_notify_idempotency_adversarial.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { buildLeadNotifyEmail, handler } from "../index.ts";

Deno.env.set("SUPABASE_URL", "https://stub.local");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub-service-role-key");
Deno.env.set("RESEND_API_KEY", "stub-resend-key");

const RUN_ID = "11111111-2222-4333-8444-555555555555";
const LEAD_EMAIL = "orch1354-adv+t1@usemingla.com";
const FOUNDER = "seth@usemingla.com";
const VENUES_REPORT = { scores: { grade: "B", overall: 78 }, venue: { name: "Adversarial Venue" } };

type Sent = { to: unknown; reply_to: unknown; subject: unknown };
const realFetch = globalThis.fetch;

// Drives one gate POST with a scripted PRIOR status; returns the HTTP result and
// the founder/visitor send tallies observed on the stubbed Resend endpoint.
async function driveGate(
  priorStatus: string,
  opts: { throwNotify?: boolean } = {},
): Promise<{ httpStatus: number; body: string; founder: Sent[]; visitor: Sent[] }> {
  const sends: Sent[] = [];
  const scriptedRow = {
    id: RUN_ID,
    tool: "venues",
    status: priorStatus,
    report: VENUES_REPORT,
    report_token: null,
    email: priorStatus === "report_ready" ? null : LEAD_EMAIL,
  };

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url.includes("api.resend.com")) {
      const b = init?.body ? JSON.parse(String(init.body)) : {};
      sends.push({ to: b.to, reply_to: b.reply_to, subject: b.subject });
      const isFounder = Array.isArray(b.to) && b.to[0] === FOUNDER;
      if (isFounder && opts.throwNotify) return Promise.reject(new Error("simulated resend outage"));
      return Promise.resolve(new Response(JSON.stringify({ id: "msg" }), { status: 200 }));
    }
    if (method === "GET") {
      return Promise.resolve(
        new Response(JSON.stringify(scriptedRow), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }
    if (method === "HEAD") return Promise.resolve(new Response(null, { status: 200, headers: { "Content-Range": "*/0" } }));
    if (method === "PATCH") return Promise.resolve(new Response(null, { status: 204 }));
    return realFetch(input as never, init);
  }) as typeof fetch;

  try {
    const res = await handler(
      new Request("https://stub.local/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: RUN_ID, email: LEAD_EMAIL, origin: "https://usemingla.com" }),
      }),
    );
    const body = await res.text();
    return {
      httpStatus: res.status,
      body,
      founder: sends.filter((s) => Array.isArray(s.to) && (s.to as unknown[])[0] === FOUNDER),
      visitor: sends.filter((s) => Array.isArray(s.to) && (s.to as unknown[])[0] === LEAD_EMAIL),
    };
  } finally {
    globalThis.fetch = realFetch;
  }
}

Deno.test("ISSUE-1354 adversarial — re-gate (prior gated_email) → ZERO founder notify, visitor still served", async () => {
  const r = await driveGate("gated_email");
  assertEquals(r.founder.length, 0, "a re-gate must NOT re-notify the founder");
  assertEquals(r.visitor.length, 1, "the visitor must still receive exactly one email");
  assertEquals(r.httpStatus, 200);
});

Deno.test("ISSUE-1354 adversarial — re-gate (prior emailed) → ZERO founder notify", async () => {
  const r = await driveGate("emailed");
  assertEquals(r.founder.length, 0, "an already-emailed re-gate must NOT re-notify the founder");
  assertEquals(r.httpStatus, 200);
});

Deno.test("ISSUE-1354 adversarial — first gate (prior report_ready) → EXACTLY ONE founder notify, reply_to = lead", async () => {
  const r = await driveGate("report_ready");
  assertEquals(r.founder.length, 1, "the report_ready transition must notify the founder exactly once");
  assertEquals(r.visitor.length, 1, "the visitor must still receive exactly one email");
  assertEquals((r.founder[0].reply_to as string), LEAD_EMAIL, "founder reply_to must be the lead email");
  assert(String(r.founder[0].subject).includes("Venue Website Grader"), "subject must name the friendly tool");
  assert(String(r.founder[0].subject).includes(LEAD_EMAIL), "subject must carry the lead email");
  assertEquals(r.httpStatus, 200);
});

Deno.test("ISSUE-1354 adversarial — best-effort: a founder-notify Resend outage does NOT degrade the visitor path", async () => {
  const r = await driveGate("report_ready", { throwNotify: true });
  assertEquals(r.visitor.length, 1, "the visitor email must fire even when the notify throws");
  assertEquals(r.httpStatus, 200, "the gate must still return 200 when the notify throws");
  assertEquals(r.body, '{"ok":true}');
});

Deno.test("ISSUE-1354 adversarial — buildLeadNotifyEmail HTML-escapes a hostile lead email (no markup injection)", () => {
  const out = buildLeadNotifyEmail({
    tool: "venues",
    email: 'evil@x.com"><script>alert(1)</script>',
    report: {},
    reportLink: "https://usemingla.com/tools/venues/report?id=1&t=2",
    adminUrl: "https://admin.usemingla.com/#/tool-leads",
    whenIso: "2026-07-29T12:00:00.000Z",
  });
  assert(!out.bodyHtml.includes("<script>"), "raw <script> must NOT survive into the HTML body");
  assert(out.bodyHtml.includes("&lt;script&gt;"), "the hostile email must be HTML-escaped");
});
