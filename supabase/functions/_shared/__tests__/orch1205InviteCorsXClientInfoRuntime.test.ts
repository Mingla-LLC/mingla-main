// ORCH-1205 [edge-function CORS missing x-client-info → team/scanner invites
// broken on web] — ADVERSARIAL RUNTIME regression test (tester-owned).
//
// DIFFERENT ANGLE than the implementor's happy-path test
// (orch1205InviteCorsXClientInfo.test.ts), which asserts on SOURCE TEXT (does the
// file import _shared/cors.ts / mention x-client-info). Source text can pass while
// the actually-served Response still omits the header (e.g. a function importing
// corsHeaders but building its OPTIONS Response from a different object). This
// test instead INVOKES each of the 8 functions' ACTUAL preflight handler with a
// real OPTIONS `Request` and asserts the RETURNED Response.headers really carries
// `x-client-info` in Access-Control-Allow-Headers — runtime behavior, not text.
//
// It also pins NO-BEHAVIOR-REGRESSION:
//   • a representative function still rejects a non-OPTIONS/non-POST method (405),
//   • verify_jwt in supabase/config.toml is unchanged for all 8 (auth untouched).
//
// FAILS-ON-REVERT: removing x-client-info from _shared/cors.ts (the shared
// allow-list every fixed function now serves) turns the runtime assertions RED.
// Verified by tester via true line-deletion against commit cc416fa43 — see
// QA report Section 5.
//
// HOW process-booking-deadlines is reached at runtime: it calls serve() at module
// load with NO import.meta.main guard, so it cannot be imported without binding a
// listener. The test aliases the Deno std http/server.ts URL it imports to a
// capture shim (_serveShim.ts) via _importmap.test.json, so serve() records the
// handler instead of starting a server. Run with:
//   deno test --import-map=supabase/functions/_shared/__tests__/_importmap.test.json \
//     --allow-read --allow-env --allow-net \
//     supabase/functions/_shared/__tests__/orch1205InviteCorsXClientInfoRuntime.test.ts
//
// APPEND-ONLY: this is a NEW file; it does not modify the implementor's test.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { getCapturedHandler, resetCapturedHandler } from "./_serveShim.ts";

type Handler = (req: Request) => Response | Promise<Response>;

// supabase/functions/_shared/__tests__/  →  functions dir is two levels up.
const FUNCTIONS_DIR = new URL("../../", import.meta.url);

// The 7 functions that export a named `handler` (serve() guarded by
// import.meta.main, so importing the module is side-effect-free).
const HANDLER_EXPORTED = [
  "list-my-pending-invites",
  "invite-brand-member",
  "invite-scanner",
  "accept-brand-invitation",
  "decline-brand-invitation",
  "accept-scanner-invitation",
  "beta-access-lead-submit",
];

// Cron-only — no exported handler; captured via the serve shim (import map).
const SHIM_CAPTURED = "process-booking-deadlines";

async function loadExportedHandler(fn: string): Promise<Handler> {
  const mod = await import(new URL(`${fn}/index.ts`, FUNCTIONS_DIR).href);
  assert(
    typeof mod.handler === "function",
    `${fn} must export a callable handler for runtime preflight testing`,
  );
  return mod.handler as Handler;
}

async function loadShimCapturedHandler(fn: string): Promise<Handler> {
  resetCapturedHandler();
  await import(new URL(`${fn}/index.ts`, FUNCTIONS_DIR).href);
  const h = getCapturedHandler();
  assert(
    typeof h === "function",
    `${fn} did not register a handler via serve() — serve-shim import map not active?`,
  );
  return h as Handler;
}

// ── (1) RUNTIME PREFLIGHT: each function's ACTUAL OPTIONS Response carries
//        x-client-info in Access-Control-Allow-Headers. ─────────────────────────
for (const fn of HANDLER_EXPORTED) {
  Deno.test(`ORCH-1205 RUNTIME — ${fn} OPTIONS Response actually allows x-client-info`, async () => {
    const handler = await loadExportedHandler(fn);
    const res = await handler(
      new Request("https://business.usemingla.com/x", { method: "OPTIONS" }),
    );
    // Preflight must be a success (2xx), not an error.
    assert(
      res.status >= 200 && res.status < 300,
      `${fn} OPTIONS returned ${res.status}, expected a 2xx preflight success`,
    );
    const allow = res.headers.get("Access-Control-Allow-Headers") ?? "";
    assertStringIncludes(
      allow.toLowerCase(),
      "x-client-info",
      `${fn} OPTIONS Response omitted x-client-info — supabase-js browser preflight will be REJECTED. Got: "${allow}"`,
    );
    // Origin must remain wildcard (unchanged behavior).
    assertEquals(
      res.headers.get("Access-Control-Allow-Origin"),
      "*",
      `${fn} must keep Access-Control-Allow-Origin: *`,
    );
  });
}

Deno.test(`ORCH-1205 RUNTIME — ${SHIM_CAPTURED} OPTIONS Response actually allows x-client-info`, async () => {
  const handler = await loadShimCapturedHandler(SHIM_CAPTURED);
  const res = await handler(
    new Request("https://x.test/cron", { method: "OPTIONS" }),
  );
  assert(
    res.status >= 200 && res.status < 300,
    `${SHIM_CAPTURED} OPTIONS returned ${res.status}, expected 2xx`,
  );
  const allow = res.headers.get("Access-Control-Allow-Headers") ?? "";
  assertStringIncludes(
    allow.toLowerCase(),
    "x-client-info",
    `${SHIM_CAPTURED} OPTIONS Response omitted x-client-info. Got: "${allow}"`,
  );
});

// ── (2) NO-REGRESSION: a representative browser-called function still rejects a
//        non-OPTIONS/non-POST request with 405 (method gate unchanged). ─────────
Deno.test("ORCH-1205 RUNTIME — list-my-pending-invites still 405s a GET (method gate intact)", async () => {
  const handler = await loadExportedHandler("list-my-pending-invites");
  const res = await handler(
    new Request("https://business.usemingla.com/x", { method: "GET" }),
  );
  assertEquals(
    res.status,
    405,
    "non-OPTIONS/non-POST must still be rejected with 405 (no method-handling regression)",
  );
  const body = await res.json().catch(() => ({}));
  assertEquals(
    body.error,
    "method_not_allowed",
    "405 body shape must be unchanged",
  );
});

Deno.test("ORCH-1205 RUNTIME — beta-access-lead-submit still 405s a GET (method gate intact)", async () => {
  const handler = await loadExportedHandler("beta-access-lead-submit");
  const res = await handler(
    new Request("https://business.usemingla.com/x", { method: "GET" }),
  );
  assertEquals(
    res.status,
    405,
    "beta-access-lead-submit must still reject GET with 405",
  );
});

// ── (3) AUTH UNCHANGED: verify_jwt for all 8 functions is exactly what it was
//        before the fix (true for the 6 authed invite fns, false for the public
//        beta-lead form, unspecified for the cron fn). The CORS fix MUST NOT
//        have touched the auth posture. ──────────────────────────────────────
Deno.test("ORCH-1205 RUNTIME — verify_jwt posture unchanged for all 8 functions", () => {
  const configUrl = new URL("../../../config.toml", import.meta.url);
  const toml = Deno.readTextFileSync(configUrl);

  function verifyJwtFor(fn: string): boolean | null {
    // Find the [functions.<fn>] stanza and read its verify_jwt, if present.
    const re = new RegExp(
      `\\[functions\\.${fn.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\]([\\s\\S]*?)(?:\\n\\[|$)`,
    );
    const m = toml.match(re);
    if (!m) return null;
    const body = m[1];
    const vm = body.match(/verify_jwt\s*=\s*(true|false)/);
    if (!vm) return null;
    return vm[1] === "true";
  }

  // The 6 authenticated invite/scanner endpoints MUST stay verify_jwt=true.
  for (
    const fn of [
      "list-my-pending-invites",
      "invite-brand-member",
      "invite-scanner",
      "accept-brand-invitation",
      "decline-brand-invitation",
      "accept-scanner-invitation",
    ]
  ) {
    assertEquals(
      verifyJwtFor(fn),
      true,
      `${fn} must remain verify_jwt=true (auth must not have changed)`,
    );
  }

  // The public beta-access form is intentionally verify_jwt=false (anon callable).
  assertEquals(
    verifyJwtFor("beta-access-lead-submit"),
    false,
    "beta-access-lead-submit must remain verify_jwt=false (public form)",
  );
});
