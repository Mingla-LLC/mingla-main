// Issue #3504 — the Admin Refund operations page went dark because this
// function answered the browser's CORS preflight with 405, so the browser never
// sent the POST behind it.
//
// This test drives the REAL handler, not the source text. A source-text grep
// would have passed against the broken version (it already contained the word
// "OPTIONS" nowhere near a branch, and any future edit could reorder the
// branches while keeping the string). Only calling the handler proves the
// preflight is answered before the method check.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { corsHeaders } from "../../_shared/cors.ts";
import { createAdminSourceRefundOperationsHandler } from "../index.ts";

// The handler must never reach authorization for a preflight, so a resolver
// that throws proves the OPTIONS branch runs first.
const explodingResolver = () => {
  throw new Error("PREFLIGHT_REACHED_AUTHORIZATION");
};

function preflight(): Request {
  return new Request(
    "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/admin-source-refund-operations",
    {
      method: "OPTIONS",
      headers: {
        origin: "https://admin.usemingla.com",
        "access-control-request-method": "POST",
        "access-control-request-headers":
          "authorization, x-client-info, apikey, content-type",
      },
    },
  );
}

Deno.test("#3504 the browser preflight is answered, not rejected with 405", async () => {
  const handler = createAdminSourceRefundOperationsHandler(explodingResolver);
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

Deno.test("#3504 the preflight carries the CORS headers the browser needs", async () => {
  const handler = createAdminSourceRefundOperationsHandler(explodingResolver);
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

Deno.test("#3504 a real response still carries CORS so the page can read it", async () => {
  // A POST from an unauthenticated caller: the shortest path that produces a
  // real (non-preflight) response. The browser drops any cross-origin response
  // without Access-Control-Allow-Origin, so the page must see it on this too.
  const handler = createAdminSourceRefundOperationsHandler(() =>
    Promise.resolve({ userId: null, isActiveAdmin: false })
  );
  const response = await handler(
    new Request(
      "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/admin-source-refund-operations",
      {
        method: "POST",
        headers: {
          origin: "https://admin.usemingla.com",
          "content-type": "application/json",
        },
        body: JSON.stringify({ mode: "list", limit: 50 }),
      },
    ),
  );

  assertEquals(response.status, 401);
  assertEquals(
    response.headers.get("access-control-allow-origin"),
    corsHeaders["Access-Control-Allow-Origin"],
  );
  assertEquals(
    response.headers.get("cache-control"),
    "no-store, private",
  );
  await response.text();
});

Deno.test("#3504 genuinely unsupported methods still get 405", async () => {
  const handler = createAdminSourceRefundOperationsHandler(explodingResolver);
  for (const method of ["GET", "PUT", "DELETE"]) {
    const response = await handler(
      new Request(
        "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/admin-source-refund-operations",
        { method },
      ),
    );
    assertEquals(response.status, 405, `${method} should still be refused`);
    assertEquals(
      (await response.json()).error,
      "method_not_allowed",
      `${method} should still say method_not_allowed`,
    );
  }
});

Deno.test("#3504 a POST is still authorized — the preflight fix opened no door", async () => {
  // Signed in, but NOT an active admin: must still be refused 403, proving the
  // OPTIONS branch did not become a bypass for real calls.
  const handler = createAdminSourceRefundOperationsHandler(() =>
    Promise.resolve({
      userId: "35040000-0000-4000-8000-000000000001",
      isActiveAdmin: false,
    })
  );
  const response = await handler(
    new Request(
      "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/admin-source-refund-operations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "list", limit: 50 }),
      },
    ),
  );
  assertEquals(response.status, 403);
  assertEquals((await response.json()).error, "not_authorized");
});
