// ORCH-1045 — INDEPENDENT tester adversarial regression (mingla-tester, not the
// implementor). DIFFERENT ANGLE from submit_happy/submit_adversarial: those two
// exercise only the PURE validateLead/buildNotifyEmail branches and the
// OPTIONS/405/malformed-JSON wiring — they NEVER reach the insert → idempotency
// → notify control flow because no Supabase env is configured (the happy test
// even asserts it "reaches DB layer" by getting a 500).
//
// This test drives the FULL handler with a faked Supabase REST + Resend backend
// (via globalThis.fetch, the established edge-fn test pattern, e.g.
// event-cover-pexels-search/index.test.ts) to attack the SIDE-EFFECT invariants
// the implementor's tests leave unverified:
//
//   SC-8 / T-05  email-once idempotency: a 23505 unique-violation on the
//                lower(email) index → 200 { already_on_list } AND **zero**
//                Resend calls (the second submit must NOT re-email Seth).
//   SC-4         a NEW lead (clean insert) → 200 { created } AND **exactly one**
//                Resend POST to api.resend.com/emails, addressed to
//                seth@usemingla.com.
//   T-06         notify-non-fatal: Resend returning 500 must NOT fail the
//                request — the lead is already persisted → still 200 { created }.
//   §3.3.3       a non-unique INSERT error (e.g. 23514 check violation surfaced
//                at the DB) → 500 { server } and NO email (not swallowed as
//                success, not mis-mapped to already_on_list).
//   §3.3.5       throttle: when BETA_LEAD_IP_SALT is set and the in-window count
//                is >= 5, return 429 BEFORE any insert or email.
//
// These MUST FAIL on revert if: the 23505→already_on_list branch is removed, the
// "notify only on created" guard is dropped (would double-email on resubmit),
// the notify failure is made fatal, the non-unique-error mapping regresses, or
// the throttle short-circuit is removed.
//
// Run: /Users/sethogieva/.deno/bin/deno test --allow-env --allow-net \
//   supabase/functions/beta-access-lead-submit/__tests__/submit_handler_sideeffects.tester.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { handler } from "../index.ts";

const GOOD = {
  brandType: "restaurant",
  brandName: "The Corner Table",
  contactName: "Ada",
  city: "Lagos",
  email: "owner@thecornertable.com",
  consent: true,
  source: "organiser_marketing_hero",
};

interface FakeBackendOpts {
  /** Response to return for the table INSERT (POST /rest/v1/beta_access_leads). */
  insert: Response;
  /** Response to return for the throttle HEAD count (GET ... select=id head). */
  count?: Response;
  /** Response to return for the Resend POST (api.resend.com/emails). */
  resend?: Response;
}

interface FetchLog {
  insertCalls: number;
  countCalls: number;
  resendCalls: number;
  resendBodies: string[];
}

/**
 * Installs a globalThis.fetch that routes:
 *   - api.resend.com/emails           → opts.resend
 *   - /rest/v1/beta_access_leads + POST → opts.insert
 *   - /rest/v1/beta_access_leads + GET  → opts.count (throttle head-count)
 * and records call counts. Returns { restore, log }.
 */
function installFakeBackend(opts: FakeBackendOpts): {
  restore: () => void;
  log: FetchLog;
} {
  const prior = globalThis.fetch;
  const log: FetchLog = {
    insertCalls: 0,
    countCalls: 0,
    resendCalls: 0,
    resendBodies: [],
  };
  globalThis.fetch = (async (
    input: URL | RequestInfo,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    const method = (init?.method ??
      (input instanceof Request ? input.method : "GET")).toUpperCase();

    if (url.includes("api.resend.com/emails")) {
      log.resendCalls++;
      if (init?.body) log.resendBodies.push(String(init.body));
      return opts.resend ?? new Response(JSON.stringify({ id: "re_x" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/beta_access_leads")) {
      if (method === "POST") {
        log.insertCalls++;
        return opts.insert;
      }
      // GET / HEAD count for the throttle window.
      log.countCalls++;
      return opts.count ??
        new Response("[]", {
          status: 200,
          headers: { "Content-Range": "0-0/0", "Content-Type": "application/json" },
        });
    }
    // Any other call (auth/token refresh etc.) → benign 200.
    return new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = prior; }, log };
}

function postGood(): Request {
  return new Request("https://x/beta-access-lead-submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify(GOOD),
  });
}

// Service-role env so the handler builds a real client (its REST calls are faked).
function withEnv(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const prevUrl = Deno.env.get("SUPABASE_URL");
    const prevKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const prevResend = Deno.env.get("RESEND_API_KEY");
    const prevSalt = Deno.env.get("BETA_LEAD_IP_SALT");
    Deno.env.set("SUPABASE_URL", "https://fake.supabase.co");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc_fake");
    Deno.env.set("RESEND_API_KEY", "re_fake_key");
    // No salt by default → throttle skipped (fail-open). Individual tests set it.
    Deno.env.delete("BETA_LEAD_IP_SALT");
    try {
      await fn();
    } finally {
      prevUrl ? Deno.env.set("SUPABASE_URL", prevUrl) : Deno.env.delete("SUPABASE_URL");
      prevKey ? Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", prevKey) : Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
      prevResend ? Deno.env.set("RESEND_API_KEY", prevResend) : Deno.env.delete("RESEND_API_KEY");
      prevSalt ? Deno.env.set("BETA_LEAD_IP_SALT", prevSalt) : Deno.env.delete("BETA_LEAD_IP_SALT");
    }
  };
}

// ── SC-4: new lead → created + exactly ONE notify email to seth@usemingla.com ──
Deno.test(
  "ADV new lead inserts → 200 created AND exactly one Resend email to seth@",
  withEnv(async () => {
    const { restore, log } = installFakeBackend({
      // Successful insert → supabase-js returns 201 with empty body (no error).
      insert: new Response(null, { status: 201 }),
    });
    try {
      const res = await handler(postGood());
      assertEquals(res.status, 200);
      assertEquals(await res.json(), { ok: true, status: "created" });
      assertEquals(log.insertCalls, 1, "exactly one insert");
      assertEquals(log.resendCalls, 1, "exactly one notify email on a new lead");
      assert(
        log.resendBodies[0].includes("seth@usemingla.com"),
        "notify must be addressed to seth@usemingla.com",
      );
    } finally {
      restore();
    }
  }),
);

// ── SC-8 / T-05: resubmit (23505) → already_on_list AND NO second email ────────
Deno.test(
  "ADV duplicate email (23505) → 200 already_on_list AND ZERO Resend emails",
  withEnv(async () => {
    // supabase-js maps a PostgREST 409 with code 23505 to error.code === '23505'.
    const conflict = new Response(
      JSON.stringify({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "beta_access_leads_email_lower_uidx"',
        details: null,
        hint: null,
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
    const { restore, log } = installFakeBackend({ insert: conflict });
    try {
      const res = await handler(postGood());
      assertEquals(res.status, 200);
      assertEquals(await res.json(), { ok: true, status: "already_on_list" });
      assertEquals(log.insertCalls, 1, "insert attempted once");
      assertEquals(
        log.resendCalls,
        0,
        "a resubmit must NOT re-email Seth (idempotent notify-once)",
      );
    } finally {
      restore();
    }
  }),
);

// ── T-06: Resend 500 is non-fatal — the persisted lead still returns created ──
Deno.test(
  "ADV Resend 500 is non-fatal → still 200 created (lead already saved)",
  withEnv(async () => {
    const { restore, log } = installFakeBackend({
      insert: new Response(null, { status: 201 }),
      resend: new Response(
        JSON.stringify({ name: "internal_error", message: "boom", statusCode: 500 }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      ),
    });
    try {
      const res = await handler(postGood());
      assertEquals(res.status, 200, "email failure must NOT fail the request");
      assertEquals(await res.json(), { ok: true, status: "created" });
      assertEquals(log.insertCalls, 1);
      assertEquals(log.resendCalls, 1, "notify was attempted");
    } finally {
      restore();
    }
  }),
);

// ── §3.3.3: a NON-unique insert error → 500 server, NO email, not mis-mapped ──
Deno.test(
  "ADV non-unique insert error (not 23505) → 500 server AND ZERO emails",
  withEnv(async () => {
    const checkViolation = new Response(
      JSON.stringify({
        code: "23514", // check_violation — NOT the unique index
        message: 'new row violates check constraint "beta_access_leads_email_check"',
        details: null,
        hint: null,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
    const { restore, log } = installFakeBackend({ insert: checkViolation });
    try {
      const res = await handler(postGood());
      assertEquals(res.status, 500, "a real DB error must surface, not be swallowed");
      assertEquals(await res.json(), { ok: false, error: "server" });
      assertEquals(
        log.resendCalls,
        0,
        "no notify email when the lead was NOT persisted",
      );
    } finally {
      restore();
    }
  }),
);

// ── §3.3.5: throttle short-circuits BEFORE insert + email when count >= max ────
Deno.test(
  "ADV throttle: >=5 in-window → 429 rate_limited, NO insert, NO email",
  withEnv(async () => {
    Deno.env.set("BETA_LEAD_IP_SALT", "test-salt"); // enable the throttle path
    const { restore, log } = installFakeBackend({
      // Should never be reached, but provide a benign insert anyway.
      insert: new Response(null, { status: 201 }),
      // Throttle head-count returns 5 in-window (>= THROTTLE_MAX) via Content-Range.
      count: new Response(null, {
        status: 200,
        headers: { "Content-Range": "0-4/5" },
      }),
    });
    try {
      const res = await handler(postGood());
      assertEquals(res.status, 429);
      assertEquals(await res.json(), { ok: false, error: "rate_limited" });
      assertEquals(log.insertCalls, 0, "throttle must short-circuit before insert");
      assertEquals(log.resendCalls, 0, "throttle must short-circuit before email");
      assertEquals(log.countCalls, 1, "throttle did query the window count");
    } finally {
      restore();
    }
  }),
);
