// Issue #3510 — `source-refund-action` rejected every non-POST request before
// considering OPTIONS, so the browser's CORS preflight got 405 and the real
// POST was never sent. The page would have failed with a blank error that reads
// like a permissions problem.
//
// It was LATENT, not live: `requestSourceRefundAction` is exported at
// mingla-business/src/services/sourceRefundService.ts:40 and nothing calls it
// yet. The identical shape in the admin pair WAS live and took the Admin Refund
// operations page offline in production (#3504, PR #3506). This is the trap
// waiting for whoever wires up the first screen.
//
// These drive the REAL handler. A test that mocks `supabase.functions.invoke`
// structurally cannot see a method check — the mock answers before any method
// is examined — which is exactly how this survived having tests at all.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { ticketCorsHeaders } from "../../_shared/ticketCheckout.ts";
import { createSourceRefundActionHandler } from "../index.ts";

const ENDPOINT =
  "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/source-refund-action";
const ORIGIN = "https://business.usemingla.com";

const handler = createSourceRefundActionHandler();

// Exactly what supabase-js attaches, which is what forces the preflight.
const INVOKE_HEADERS = "authorization, x-client-info, apikey, content-type";

function preflight(): Request {
  return new Request(ENDPOINT, {
    method: "OPTIONS",
    headers: {
      origin: ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers": INVOKE_HEADERS,
    },
  });
}

Deno.test("#3510 the preflight is answered, not refused as a bad method", async () => {
  const res = await handler(preflight());
  assertEquals(res.status, 200);
  assert(
    res.status !== 405,
    "405 to the preflight stops the browser sending the POST at all",
  );
  assertEquals(
    res.headers.get("access-control-allow-origin"),
    ticketCorsHeaders["Access-Control-Allow-Origin"],
  );
});

Deno.test("#3510 the preflight allows every header supabase-js sends", async () => {
  const res = await handler(preflight());
  // Without this the test passes on the broken version: a 405 carries
  // ticketCorsHeaders too, so the header assertions below are satisfied by a
  // refusal. Establish the preflight was ANSWERED before reading its headers.
  assertEquals(res.status, 200, "the preflight must be answered, not refused");
  const allowed = res.headers.get("access-control-allow-headers")
    ?.toLowerCase() ?? "";
  for (const header of INVOKE_HEADERS.split(",").map((h) => h.trim())) {
    assert(
      allowed.includes(header),
      `the browser sends "${header}"; a preflight that omits it fails the real POST`,
    );
  }
  const methods = res.headers.get("access-control-allow-methods")
    ?.toUpperCase() ?? "";
  assert(methods.includes("POST"), "the real request is a POST");
});

// The half that is easy to get wrong while the preflight looks correct: a
// preflight advertising one header set while real responses carry another
// passes the preflight and then fails the response the page has to read.
Deno.test("#3510 the preflight advertises what real responses actually carry", async () => {
  const pre = await handler(preflight());
  // Same trap as above: the 405 carries the same headers, so without this the
  // comparison is trivially satisfied by the broken version.
  assertEquals(pre.status, 200, "the preflight must be answered, not refused");
  const real = await handler(
    new Request(ENDPOINT, { method: "GET", headers: { origin: ORIGIN } }),
  );
  for (
    const header of [
      "access-control-allow-origin",
      "access-control-allow-headers",
      "access-control-allow-methods",
    ]
  ) {
    assertEquals(
      pre.headers.get(header),
      real.headers.get(header),
      `${header} differs between the preflight and a real response`,
    );
  }
});

Deno.test("#3510 genuinely unsupported methods are still refused", async () => {
  for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
    const res = await handler(
      new Request(ENDPOINT, { method, headers: { origin: ORIGIN } }),
    );
    assertEquals(res.status, 405, `${method} must still be refused`);
    assertEquals(await res.json(), { error: "method_not_allowed" });
  }
});

// Answering the preflight must not have opened anything. An unauthenticated
// POST still stops at the auth gate, before the body is even read.
Deno.test("#3510 an unauthenticated POST is still refused", async () => {
  const res = await handler(
    new Request(ENDPOINT, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        refundId: "00000000-0000-4000-8000-000000000000",
        action: "retry",
        reason: "a valid looking reason",
      }),
    }),
  );
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "not_authenticated" });
});
