// Issue #3504 — the sibling of the Refund operations queue loader. Every action
// button on `admin.usemingla.com/#/refund-operations` (retry, escalate, resolve,
// and the needs-attention recipient recovery flow) goes through this function,
// and it carried the same two-part CORS break: the browser's preflight was
// answered 405 before any OPTIONS handling, and real responses carried no
// Access-Control-Allow-Origin for the page to read.
//
// This test drives the REAL handler. A source-text grep would have passed
// against the broken version, so only calling the handler and inspecting the
// Response proves the preflight is answered before the method check.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { corsHeaders } from "../../_shared/cors.ts";
import { createAdminSourceRefundActionHandler } from "../index.ts";

const ENDPOINT =
  "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/admin-source-refund-action";

// A preflight must never reach authorization, so a resolver that throws proves
// the OPTIONS branch runs first.
const explodingResolver = () => {
  throw new Error("PREFLIGHT_REACHED_AUTHORIZATION");
};

function preflight(): Request {
  return new Request(ENDPOINT, {
    method: "OPTIONS",
    headers: {
      origin: "https://admin.usemingla.com",
      "access-control-request-method": "POST",
      "access-control-request-headers":
        "authorization, x-client-info, apikey, content-type",
    },
  });
}

function actionPost(): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: {
      origin: "https://admin.usemingla.com",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      refundId: "35040000-0000-4000-8000-000000000002",
      action: "escalate",
      reason: "issue 3504 regression probe",
    }),
  });
}

Deno.test("#3504 action preflight is answered, not rejected with 405", async () => {
  const handler = createAdminSourceRefundActionHandler(explodingResolver);
  const response = await handler(preflight());

  assert(
    response.status !== 405,
    "preflight answered 405 — the browser will never send the POST",
  );
  assert(
    response.status >= 200 && response.status < 300,
    `preflight must succeed, got ${response.status}`,
  );
  await response.text();
});

Deno.test("#3504 action preflight carries the CORS headers the browser needs", async () => {
  const handler = createAdminSourceRefundActionHandler(explodingResolver);
  const response = await handler(preflight());

  assertEquals(
    response.headers.get("access-control-allow-origin"),
    corsHeaders["Access-Control-Allow-Origin"],
  );
  const allowed = new Set(
    (response.headers.get("access-control-allow-headers") ?? "")
      .split(",")
      .map((header) => header.trim().toLowerCase())
      .filter(Boolean),
  );
  for (
    const header of ["authorization", "x-client-info", "apikey", "content-type"]
  ) {
    assert(allowed.has(header), `preflight omitted ${header}`);
  }
  assert(
    (response.headers.get("access-control-allow-methods") ?? "")
      .toUpperCase()
      .includes("POST"),
    "preflight did not allow POST",
  );
  await response.text();
});

Deno.test("#3504 an action response still carries CORS so the page can read it", async () => {
  // Unauthenticated POST: the shortest path to a real (non-preflight) response.
  // The browser drops any cross-origin response without
  // Access-Control-Allow-Origin, so the page must see it on this too.
  const handler = createAdminSourceRefundActionHandler(() =>
    Promise.resolve({ userId: null, userEmail: null, isActiveAdmin: false })
  );
  const response = await handler(actionPost());

  assertEquals(response.status, 401);
  assertEquals(
    response.headers.get("access-control-allow-origin"),
    corsHeaders["Access-Control-Allow-Origin"],
  );
  assertEquals(response.headers.get("cache-control"), "no-store, private");
  await response.text();
});

Deno.test("#3504 action: genuinely unsupported methods still get 405", async () => {
  const handler = createAdminSourceRefundActionHandler(explodingResolver);
  for (const method of ["GET", "PUT", "DELETE"]) {
    const response = await handler(new Request(ENDPOINT, { method }));
    assertEquals(response.status, 405, `${method} should still be refused`);
    assertEquals(
      (await response.json()).error,
      "method_not_allowed",
      `${method} should still say method_not_allowed`,
    );
  }
});

Deno.test("#3504 action: a POST is still authorized — the preflight fix opened no door", async () => {
  // Signed in, but NOT an active admin: must still be refused 403, proving the
  // OPTIONS branch did not become a bypass for real calls.
  const handler = createAdminSourceRefundActionHandler(() =>
    Promise.resolve({
      userId: "35040000-0000-4000-8000-000000000001",
      userEmail: "not-an-admin@usemingla.com",
      isActiveAdmin: false,
    })
  );
  const response = await handler(actionPost());
  assertEquals(response.status, 403);
  assertEquals((await response.json()).error, "not_authorized");
});
