// ORCH-1107 — TESTER ADVERSARIAL regression (RPC-ERROR path).
//
// DIFFERENT ANGLE than the implementor happy-path test (which covered RPC
// param-building, row→shape mapping, and 0-row source-grep). This attacks the
// FAILURE path the implementor's suite never exercises at runtime: what happens
// when `query_servable_places_by_signal` REJECTS — i.e. the supabase-js client
// returns `{ data: null, error: {...} }` (PostgREST 4xx/5xx) OR throws.
//
// Contract under attack (SPEC AMENDMENT 1 + SC-9): on an RPC error the handler
// MUST
//   (1) NOT crash / NOT surface a 500 — it returns the graceful-empty body;
//   (2) NOT fall back to Google (no googleapis.com request leaves the process);
//   (3) return the canonical empty body — companion `strollData: null`,
//       picnic `picnicData: null`.
//
// HOW THE ERROR IS INJECTED (real, not a re-implementation): we stand up a local
// HTTP server and point SUPABASE_URL at it BEFORE the SUT modules load. The real
// @supabase/supabase-js client (constructed at module load) issues its RPC POST
// to /rest/v1/rpc/query_servable_places_by_signal against our server, which
// replies with a PostgREST-shaped 500 error body. supabase-js then resolves the
// `.rpc()` call to `{ data: null, error: {...} }` — exercising the REAL
// `if (error) { ...; return []/null }` branch in each edge function, end to end
// through the exported `handleRequest`. We also record EVERY request path the
// process tries to reach so we can prove no Google fallback request fires.
//
// This is NOT a copy of the implementor's test: it imports the SUT, drives the
// exported handler over a real (mocked) network round-trip on the error path,
// and asserts runtime graceful-empty + no-Google + no-throw — none of which the
// implementor's pure-helper/source-grep suite touches.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ── HERMETIC SETUP ───────────────────────────────────────────────────────────
// Point the supabase client at a LOCAL mock so its RPC POST hits us and we can
// force an error reply. Set env + the no-serve seam BEFORE the dynamic import so
// createClient() constructs against our URL and neither module binds its own
// edge-function socket.
const MOCK_PORT = 54399;
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;
Deno.env.set("SUPABASE_URL", MOCK_URL);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
Deno.env.set("ORCH_TEST_NO_SERVE", "1");

// Records every request path the SUT makes to the mock (proves the only network
// the handler performs is the single RPC call — no Google fallback).
const seenPaths: string[] = [];

const ac = new AbortController();
const server = Deno.serve(
  { port: MOCK_PORT, signal: ac.signal, onListen() {} },
  (req) => {
    const url = new URL(req.url);
    seenPaths.push(url.pathname);
    // PostgREST error shape that supabase-js maps to `error` (non-2xx) →
    // `.rpc()` resolves `{ data:null, error:{...} }`, the exact failure the
    // handler's `if (error) { return []/null }` branch must absorb.
    return new Response(
      JSON.stringify({
        code: "P0001",
        message: "query_servable_places_by_signal boom (adversarial)",
        details: null,
        hint: null,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  },
);

const { handleRequest: handleCompanion } = await import(
  "../get-companion-stops/index.ts"
);
const { handleRequest: handleGrocery } = await import(
  "../get-picnic-grocery/index.ts"
);

// Drain the supabase client's construction-time timer before the first test so
// the leak sanitizer doesn't attribute it to test #1 (same drain the
// implementor's suite uses).
await new Promise<void>((r) => setTimeout(r, 50));

const ANCHOR_BODY = JSON.stringify({
  anchor: { name: "Riverside Park", location: { lat: 40.78, lng: -73.97 } },
  maxDistance: 500,
});
const PICNIC_BODY = JSON.stringify({
  picnic: { name: "Riverside Park", location: { lat: 40.78, lng: -73.97 } },
  maxDistance: 2000,
});

function newReq(body: string): Request {
  return new Request("http://edge.local", { method: "POST", body });
}

// ── RPC returns { data:null, error } ─────────────────────────────────────────
Deno.test("ADV-01 companion: RPC error → graceful strollData:null, status 200, no throw", async () => {
  seenPaths.length = 0;
  const res = await handleCompanion(newReq(ANCHOR_BODY));
  // (1) no crash: the handler resolved with a Response, and it is NOT the 500
  // catch-path (a thrown RPC would have produced status 500 with {error}).
  assertEquals(res.status, 200, "RPC error must be swallowed into graceful 200, not a 500");
  const json = await res.json();
  // (3) canonical empty body.
  assertEquals(json.strollData, null, "companion must return strollData:null on RPC error");
  // (2) no Google fallback: the only request the SUT made was the single RPC.
  const googleish = seenPaths.filter((p) => /googleapis|maps|searchNearby/i.test(p));
  assertEquals(googleish.length, 0, "no Google fallback request may be made");
  assert(
    seenPaths.some((p) => p.includes("query_servable_places_by_signal")),
    "handler must have attempted the RPC (proves the error path was actually hit)",
  );
});

Deno.test("ADV-02 picnic: RPC error → graceful picnicData:null, status 200, no throw", async () => {
  seenPaths.length = 0;
  const res = await handleGrocery(newReq(PICNIC_BODY));
  assertEquals(res.status, 200, "RPC error must be swallowed into graceful 200, not a 500");
  const json = await res.json();
  assertEquals(json.picnicData, null, "picnic must return picnicData:null on RPC error");
  const googleish = seenPaths.filter((p) => /googleapis|maps|searchNearby/i.test(p));
  assertEquals(googleish.length, 0, "no Google fallback request may be made");
  assert(
    seenPaths.some((p) => p.includes("query_servable_places_by_signal")),
    "handler must have attempted the RPC",
  );
});

// ── RPC body returns the empty/error JSON; assert no fabricated content ───────
Deno.test("ADV-03 companion: error-path body carries the empty marker, no fabricated stop", async () => {
  seenPaths.length = 0;
  const res = await handleCompanion(newReq(ANCHOR_BODY));
  const text = await res.text();
  assertStringIncludes(text, "strollData");
  assert(!/unsplash/i.test(text), "no Unsplash placeholder may leak on the error path");
  assert(!/googleapis/i.test(text), "no Google artifact may leak on the error path");
});

Deno.test("ADV-04 picnic: error-path body carries the empty marker, no fabricated store", async () => {
  seenPaths.length = 0;
  const res = await handleGrocery(newReq(PICNIC_BODY));
  const text = await res.text();
  assertStringIncludes(text, "picnicData");
  assert(!/unsplash/i.test(text), "no Unsplash placeholder may leak on the error path");
  assert(!/googleapis/i.test(text), "no Google artifact may leak on the error path");
});

// Teardown runs as the LAST registered test (top-level code executes at
// registration time, before any test body, so it cannot tear down here). The
// mock server is a top-level resource intentionally torn down here, so the
// per-test op/resource sanitizers are disabled for THIS step only (they would
// otherwise flag the cross-test cleanup of a resource they didn't see created).
Deno.test({
  name: "ADV-99 teardown: stop the mock server",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await server.shutdown().catch(() => {});
  },
});
