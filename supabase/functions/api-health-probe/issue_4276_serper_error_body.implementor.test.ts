// Issue #4276 S4: a failed Serper check keeps what Serper said.
//
// FAILS-ON-REVERT: probeSerper's `detail: {}` loses the body. The source check below
// fails if it comes back.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mvRefreshNearLimit, serperErrorDetail } from "./logic.ts";

Deno.test("the depletion body is stored and recognised", () => {
  const d = serperErrorDetail(400, '{"message":"Not enough credits","statusCode":400}');
  assertEquals(d.http_status, 400);
  assertEquals(d.not_enough_credits, true);
  assert(d.error_body.includes("Not enough credits"));
});

Deno.test("another failure is stored and is not called depletion", () => {
  assertEquals(serperErrorDetail(403, "Unauthorized").not_enough_credits, false);
  assertEquals(serperErrorDetail(500, "x".repeat(2000)).error_body.length, 500);
});

Deno.test("probeSerper reads the failed response's body", () => {
  const source = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
  const body = source.slice(source.indexOf("async function probeSerper"), source.indexOf("async function probePexels"));
  assert(body.includes("serperErrorDetail(res.status, await res.text())"));
});

// #4276: the refresh slot comes from the cron schedule (20280418004276). An unreadable
// schedule gives a null slot, and a null slot never warns.
Deno.test("the place list refresh warns against the real slot, and not at all when it is unknown", () => {
  assertEquals(mvRefreshNearLimit({ max_seconds: 400, interval_seconds: 1800 }), false);
  assertEquals(mvRefreshNearLimit({ max_seconds: 400, interval_seconds: 600 }), true);
  assertEquals(mvRefreshNearLimit({ max_seconds: 4000, interval_seconds: null }), false);
});
