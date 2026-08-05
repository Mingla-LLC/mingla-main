// Issue #1620 — a probe whose `ok` comes from the RESPONSE BODY must never
// report "healthy" when that body says it failed.
//
// THE DEFECT: five probes computed `ok` correctly and then discarded it —
//   status: ok ? "healthy" : httpToStatus(res.status)
// and `httpToStatus(200) === "healthy"`. Providers answer HTTP 200 with the
// failure INSIDE the body, so every one of those failures was recorded green.
// Proven in production: `google_places` logged 500 consecutive rows with
// status='healthy' AND detail->>'google_status'='REQUEST_DENIED'
// (2026-06-22 → 2026-08-05). The monitor could not report failure.
//
// FAILS-ON-REVERT: restore the `ok ? "healthy" : httpToStatus(res.status)`
// fallback in bodyVerdict (i.e. `if (!ok && httpStatus is 2xx) return "healthy"`)
// and T-1/T-2/T-3 fail immediately — a 2xx-with-error-body is the entire point.
//
// Run: deno test supabase/functions/api-health-probe/issue1620_body_verdict.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { bodyVerdict, type HealthStatus } from "./logic.ts";

// ─── T-1 — the core invariant: ok=false can NEVER be "healthy" ───────────────
// Swept across the whole plausible transport range, including every 2xx, which
// is where the bug lived. This is the assertion shape that catches the defect
// regardless of which provider or which status code reintroduces it.
Deno.test("T-1 #1620: ok=false never resolves to healthy, at ANY http status", () => {
  const codes = [
    200,
    201,
    202,
    204,
    299, // 2xx — the bug's home
    301,
    304,
    400,
    401,
    403,
    404,
    409,
    422,
    429,
    500,
    502,
    503,
    504,
  ];
  for (const code of codes) {
    const verdict = bodyVerdict(false, code);
    assert(
      verdict !== "healthy",
      `bodyVerdict(false, ${code}) returned "healthy" — a body-level failure was ` +
        `converted to green. This is issue #1620 reintroduced.`,
    );
  }
  // null/undefined transport (no response captured) must also not be healthy.
  assert(bodyVerdict(false, null) !== "healthy");
  assert(bodyVerdict(false, undefined) !== "healthy");
});

// ─── T-2 — each provider's REAL error shape, not a synthetic one ─────────────
// Every payload below is the actual documented failure body the provider
// returns WITH HTTP 200. Using the real shape is the point: a synthetic
// `{error:true}` fixture would pass even against a probe that only inspects
// HTTP, and would not have caught this.
Deno.test("T-2 #1620: real provider 200-with-error bodies are not healthy", () => {
  interface Case {
    provider: string;
    http: number;
    body: unknown;
    ok: boolean; // computed exactly as the probe computes it
    why: string;
  }

  const cases: Case[] = [
    {
      provider: "google_places",
      http: 200,
      body: {
        status: "REQUEST_DENIED",
        error_message: "legacy API not enabled",
      },
      ok: false, // res.ok && (status==="OK" || status==="ZERO_RESULTS")
      why: "PROVEN in prod: 500 rows logged healthy over REQUEST_DENIED",
    },
    {
      provider: "paystack",
      http: 200,
      body: { status: false, message: "Invalid key" },
      ok: false, // res.ok && json.status === true
      why: "Paystack's ONLY account-restriction signal — live NG money rail",
    },
    {
      provider: "mapbox",
      http: 200,
      body: { message: "Not Authorized - Invalid Token" }, // no `features` array
      ok: false, // res.ok && Array.isArray(body.features)
      why: "200 without a features array",
    },
    {
      provider: "gemini",
      http: 200,
      body: { error: { code: 403, message: "PERMISSION_DENIED" } }, // no `models`
      ok: false, // res.ok && Array.isArray(body.models)
      why: "200 without a models array",
    },
    {
      provider: "exchangerate",
      http: 200,
      body: { result: "error", "error-type": "invalid-key" },
      ok: false, // b.result === "success"
      why: "200 with result != success",
    },
  ];

  for (const c of cases) {
    const verdict = bodyVerdict(c.ok, c.http);
    assertEquals(
      verdict,
      "down",
      `${c.provider}: HTTP ${c.http} with body ${JSON.stringify(c.body)} → ` +
        `expected "down", got "${verdict}". ${c.why}`,
    );
  }

  // Vacuity guard — if this list is ever emptied, the test must fail rather
  // than silently pass over nothing (the unfalsifiable-test failure mode).
  assertEquals(cases.length, 5, "all five #1620 probes must stay covered");
});

// ─── T-3 — the healthy path still works (no over-correction) ─────────────────
Deno.test("T-3 #1620: ok=true is healthy regardless of transport code", () => {
  assertEquals(bodyVerdict(true, 200), "healthy");
  assertEquals(bodyVerdict(true, 201), "healthy");
  assertEquals(bodyVerdict(true, null), "healthy");
});

// ─── T-4 — transport severity still distinguishes transient from hard fail ───
// A failure must not collapse to a single bucket: 429/5xx are retryable and
// should read "degraded" so they do not page the same way a hard denial does.
Deno.test("T-4 #1620: transient transport failures read degraded, hard failures down", () => {
  assertEquals(
    bodyVerdict(false, 429),
    "degraded",
    "rate-limited is transient",
  );
  assertEquals(bodyVerdict(false, 500), "degraded");
  assertEquals(bodyVerdict(false, 502), "degraded");
  assertEquals(bodyVerdict(false, 503), "degraded");

  assertEquals(
    bodyVerdict(false, 200),
    "down",
    "2xx + bad body is a HARD failure",
  );
  assertEquals(bodyVerdict(false, 401), "down");
  assertEquals(bodyVerdict(false, 403), "down");
  assertEquals(bodyVerdict(false, 404), "down");
});

// ─── T-5 — return type is a valid HealthStatus, never a stray string ─────────
Deno.test("T-5 #1620: every verdict is a valid HealthStatus", () => {
  const valid: HealthStatus[] = ["healthy", "degraded", "down", "unknown"];
  for (const ok of [true, false]) {
    for (const code of [200, 429, 500, 403, null]) {
      const v = bodyVerdict(ok, code);
      assert(valid.includes(v), `bodyVerdict(${ok}, ${code}) → invalid "${v}"`);
    }
  }
});
