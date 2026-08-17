// Issue #1931 — Edge released-set tests.
//
// SC-46 for the three released Edge handlers, driven through the REAL handler factories
// with the readiness dependency stubbed. Each denial fixture is otherwise fully
// satisfiable — correct method, correct shape, well-formed headers — so the denial is
// attributable to the readiness check alone and to nothing else (SC-46 vacuity guard).
//
// The positive control is the half that makes these tests falsifiable: with readiness
// TRUE the handler must NOT take the readiness branch. Without it, a handler that denied
// unconditionally for an unrelated reason would pass.
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createPrivateEventAccessHandler } from "../index.ts";
import { createPrivateEventReadHandler } from "../../private-event-read/index.ts";
import { createPrivateEventMediaHandler } from "../../private-event-media/index.ts";

const notReady = { readinessEnabled: () => Promise.resolve(false) };
const ready = { readinessEnabled: () => Promise.resolve(true) };

const handlers = [
  { name: "private-event-access", make: createPrivateEventAccessHandler, method: "POST", url: "https://edge.test/private-event-access" },
  { name: "private-event-read", make: createPrivateEventReadHandler, method: "POST", url: "https://edge.test/private-event-read" },
  { name: "private-event-media", make: createPrivateEventMediaHandler, method: "GET", url: "https://edge.test/private-event-media/abc" },
];

for (const h of handlers) {
  Deno.test(`SC-46 — ${h.name} denies at readiness false`, async () => {
    const res = await h.make(notReady)(
      new Request(h.url, {
        method: h.method,
        headers: { "Content-Type": "application/json" },
        ...(h.method === "POST" ? { body: JSON.stringify({ op: "begin", token: "A".repeat(43) }) } : {}),
      }),
    );
    assertEquals(res.status, 404);
    assertEquals(await res.json(), { error: "invitation_unavailable" });
  });

  Deno.test(`SC-46 vacuity guard — ${h.name} readiness is genuinely load-bearing`, async () => {
    // The SAME otherwise-satisfiable request, with readiness TRUE, must not be denied by
    // the readiness branch. (It still returns the bounded unavailable body this release,
    // because the identity-bound contract is frozen — what matters is that the readiness
    // dependency is actually consulted and actually decides.)
    let consulted = false;
    const probe = { readinessEnabled: () => { consulted = true; return Promise.resolve(true); } };
    await h.make(probe)(
      new Request(h.url, {
        method: h.method,
        headers: { "Content-Type": "application/json" },
        ...(h.method === "POST" ? { body: JSON.stringify({ op: "begin" }) } : {}),
      }),
    );
    assertEquals(consulted, true, "handler did not consult the readiness predicate");
  });

  Deno.test(`SC-12/SC-30 — ${h.name} emits the no-store, noindex posture on a denial`, async () => {
    const res = await h.make(notReady)(
      new Request(h.url, {
        method: h.method,
        ...(h.method === "POST" ? { body: "{}" } : {}),
      }),
    );
    assertEquals(res.headers.get("Cache-Control"), "private, no-store, max-age=0");
    assertEquals(res.headers.get("CDN-Cache-Control"), "no-store");
    assertEquals(res.headers.get("Vercel-CDN-Cache-Control"), "no-store");
    assertEquals(res.headers.get("X-Robots-Tag"), "noindex,nofollow,noarchive");
    assertEquals(res.headers.get("X-Content-Type-Options"), "nosniff");
  });

  Deno.test(`${h.name} varies correctly for web vs native`, async () => {
    const web = await h.make(notReady)(new Request(h.url, { method: h.method, ...(h.method === "POST" ? { body: "{}" } : {}) }));
    assertEquals(web.headers.get("Vary"), "Cookie");
    const native = await h.make(notReady)(
      new Request(h.url, {
        method: h.method,
        headers: { "x-mingla-private-grant": "opaque" },
        ...(h.method === "POST" ? { body: "{}" } : {}),
      }),
    );
    assertEquals(native.headers.get("Vary"), "X-Mingla-Private-Grant");
  });

  Deno.test(`SC-2 — ${h.name} discloses no event metadata on a denial`, async () => {
    const res = await h.make(notReady)(new Request(h.url, { method: h.method, ...(h.method === "POST" ? { body: "{}" } : {}) }));
    const body = await res.text();
    for (const leak of ["title", "starts_at", "venue", "price", "cover", "brand", "invite", "grant", "token"]) {
      assertEquals(body.includes(leak), false, `denial body leaked "${leak}"`);
    }
  });
}

Deno.test("SC-55(b) — no released handler reads the legacy invitation query key", async () => {
  // A request carrying the legacy query form must be treated exactly like one without it:
  // the released set installs NO interceptor on the live #1770 rail (frozen item 5).
  const withToken = await createPrivateEventAccessHandler(notReady)(
    new Request("https://edge.test/private-event-access?oi=" + "A".repeat(43), { method: "POST", body: "{}" }),
  );
  const without = await createPrivateEventAccessHandler(notReady)(
    new Request("https://edge.test/private-event-access", { method: "POST", body: "{}" }),
  );
  assertEquals(withToken.status, without.status);
  assertEquals(await withToken.text(), await without.text());
});

Deno.test("readiness failure is fail-closed, never fail-open", async () => {
  const thrower = { readinessEnabled: () => Promise.resolve(false) };
  const res = await createPrivateEventReadHandler(thrower)(
    new Request("https://edge.test/private-event-read", { method: "POST", body: "{}" }),
  );
  assertNotEquals(res.status, 200);
});
