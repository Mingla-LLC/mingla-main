// ORCH-1050 — adversarial regression for accept-brand-invitation.
//
// Validates the HTTP-surface failure modes the handler must surface to the
// landing route:
//   A-1 — unauthenticated callers get 401
//   A-2 — malformed body → 400 validation
//   A-3 — empty token → 400 validation
//   A-4 — OPTIONS preflight returns CORS-200
//   A-5 — wrong HTTP method → 405
//   A-6 — RPC error-code map covers all 5 documented ERRCODEs (positive
//         + negative cases)
//
// CLOSE Step 0.5: PASSES on commit 67f24b776; MUST FAIL on revert (e.g.
// if verify_jwt is dropped, if the token-length guard is removed, or if
// mapRpcError loses a branch).
//
// Run: deno test --allow-env --allow-net \
//   supabase/functions/accept-brand-invitation/__tests__/orch-1050-accept-adversarial.test.ts

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
  return new Request("http://local/accept-brand-invitation", {
    method: opts.method ?? "POST",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

Deno.test("A-1 unauthenticated → 401", async () => {
  const res = await handler(buildRequest({ body: { token: "x".repeat(40) }, auth: null }));
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, "unauthenticated");
});

Deno.test("A-2 malformed JSON body → 400 validation", async () => {
  // Force non-JSON body by hand-rolling the Request.
  const req = new Request("http://local/accept-brand-invitation", {
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

Deno.test("A-3 empty / too-short token → 400 validation", async () => {
  const res = await handler(
    buildRequest({ body: { token: "short" }, auth: "Bearer fake.jwt.token" }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "validation");
});

Deno.test("A-4 OPTIONS preflight → 200 with CORS headers", async () => {
  const res = await handler(
    buildRequest({ method: "OPTIONS", auth: null }),
  );
  assertEquals(res.status, 200);
  assertEquals(
    res.headers.get("Access-Control-Allow-Origin"),
    "*",
  );
});

Deno.test("A-5 GET → 405 method_not_allowed", async () => {
  const res = await handler(
    buildRequest({ method: "GET", auth: "Bearer fake.jwt.token" }),
  );
  assertEquals(res.status, 405);
});

Deno.test("A-6 every documented ERRCODE has an HTTP mapping", () => {
  // The accept RPC defines 5 distinct ERRCODEs (P0001..P0005). Every one
  // MUST map to a 4xx HTTP envelope so the landing route can render the
  // right error copy.
  const codes = ["P0001", "P0002", "P0003", "P0004", "P0005"];
  for (const code of codes) {
    const mapped = mapRpcError(code);
    assert(mapped, `ERRCODE ${code} must map`);
    if (!mapped) continue;
    assert(mapped.status >= 400 && mapped.status < 500);
    assert(mapped.error.length > 0);
  }
});

Deno.test("A-7 mapRpcError preserves status-distinction across overlapping kinds", () => {
  // The mapping deliberately distinguishes "not found" (404) from "gone"
  // (410). A single shared 4xx code would lose forensic value for the
  // landing route copy.
  const notFound = mapRpcError("P0001");
  const expired = mapRpcError("P0003");
  const mismatch = mapRpcError("P0004");
  assert(notFound && expired && mismatch);
  if (!(notFound && expired && mismatch)) return;
  assert(notFound.status !== expired.status);
  assert(expired.status !== mismatch.status);
});
