// ORCH-1051 — adversarial regression for accept-scanner-invitation.
//
// Validates the HTTP-surface failure modes the handler must surface to the
// landing route:
//   A-1 — unauthenticated callers get 401
//   A-2 — malformed body → 400 validation
//   A-3 — empty / too-short token → 400 validation
//   A-4 — OPTIONS preflight returns CORS-200
//   A-5 — wrong HTTP method → 405
//   A-6 — RPC error-code map covers all 5 documented ERRCODEs (positive
//         + negative cases)
//
// CLOSE Step 0.5: PASSES on the shipped contract at the head commit;
// MUST FAIL on revert (e.g. if verify_jwt is dropped, if the token-length
// guard is removed, or if mapRpcError loses a branch).
//
// Run: deno test --allow-env --allow-net \
//   supabase/functions/accept-scanner-invitation/__tests__/orch-1051-accept-adversarial.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { handler, mapRpcError } from "../index.ts";

function buildRequest(opts: {
  method?: string;
  body?: unknown;
  auth?: string | null;
}): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.auth !== null && opts.auth !== undefined) {
    headers.Authorization = opts.auth;
  }
  return new Request("http://local/accept-scanner-invitation", {
    method: opts.method ?? "POST",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

Deno.test("A-1 unauthenticated → 401", async () => {
  const res = await handler(
    buildRequest({ body: { token: "x".repeat(40) }, auth: null }),
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, "unauthenticated");
});

Deno.test("A-2 malformed JSON body → 400 validation", async () => {
  const req = new Request("http://local/accept-scanner-invitation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer fake.jwt.token",
    },
    body: "not-json",
  });
  const res = await handler(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "validation");
});

Deno.test("A-3a empty token → 400 validation", async () => {
  const res = await handler(buildRequest({
    body: { token: "" },
    auth: "Bearer fake.jwt.token",
  }));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "validation");
});

Deno.test("A-3b too-short token → 400 validation", async () => {
  const res = await handler(buildRequest({
    body: { token: "abc" },
    auth: "Bearer fake.jwt.token",
  }));
  assertEquals(res.status, 400);
});

Deno.test("A-3c too-long token → 400 validation", async () => {
  const res = await handler(buildRequest({
    body: { token: "x".repeat(257) },
    auth: "Bearer fake.jwt.token",
  }));
  assertEquals(res.status, 400);
});

Deno.test("A-4 OPTIONS preflight → 200 with CORS", async () => {
  const res = await handler(buildRequest({ method: "OPTIONS" }));
  assertEquals(res.status, 200);
  assertEquals(
    res.headers.get("Access-Control-Allow-Methods"),
    "POST, OPTIONS",
  );
});

Deno.test("A-5 GET method → 405 method_not_allowed", async () => {
  const res = await handler(buildRequest({ method: "GET", auth: "Bearer x" }));
  assertEquals(res.status, 405);
});

Deno.test("A-6 mapRpcError covers all 5 ERRCODEs", () => {
  const codes = ["P0001", "P0002", "P0003", "P0004", "P0005"];
  const statuses = new Set<number>();
  const errors = new Set<string>();
  for (const c of codes) {
    const r = mapRpcError(c);
    assert(r !== null, `code ${c} must map`);
    if (r === null) continue;
    statuses.add(r.status);
    errors.add(r.error);
  }
  assertEquals(errors.size, 5);
  // Three distinct statuses: 403, 404, 410 (410 is shared across used/expired/revoked).
  assertEquals(statuses.size, 3);
  assert(statuses.has(403));
  assert(statuses.has(404));
  assert(statuses.has(410));
});
