// #4334 — spec v2 §6.8 test 13: an unauthorized caller gets 401 and nothing runs.
// Fails-on-revert: delete the `authorize(...)` check in index.ts → red.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "../index.ts";

Deno.test("T-13 unauthorized caller → 401, no Google call", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (() => {
    called = true;
    return Promise.resolve(new Response("{}"));
  }) as typeof fetch;
  try {
    const res = await handler(
      new Request("http://localhost/places-coordinate-refresh", {
        method: "POST",
        headers: { authorization: "Bearer not-the-service-role" },
      }),
      () => Promise.resolve(false),
    );
    assertEquals(res.status, 401);
    assertEquals(await res.json(), { error: "unauthorized" });
    assertEquals(called, false);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("T-13b GET is refused", async () => {
  const res = await handler(new Request("http://localhost/x", { method: "GET" }), () => Promise.resolve(true));
  assertEquals(res.status, 405);
  await res.body?.cancel();
});
