// Issue #4276: run-signal-scorer refuses city-wide scoring (city_id or all_cities) for
// every caller, admin and service key alike, while older Intelligence results are held
// back from live decks. Scoring by place id still runs.
//
// MINGLA-INVARIANT: I-4276-NO-CITY-WIDE-SCORING-WHILE-HELD | issue #4276 | No cron job asks run-signal-scorer for city-wide scoring while older results are held, and the scorer refuses it for every caller
//
// FAILS-ON-REVERT: delete the city_wide_scoring_paused branch from run-signal-scorer and
// the refusal tests fail: the request reaches signal_definitions and scores.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SERVICE = "service-key";
Deno.env.set("SUPABASE_URL", "http://local.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE);

const seen: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const request = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(request.url);
  seen.push(`${request.method} ${url.pathname}`);
  if (url.pathname === "/auth/v1/user") {
    return Promise.resolve(Response.json({ id: "a1", email: "admin@local.test", aud: "authenticated" }));
  }
  if (url.pathname === "/rest/v1/admin_users") return Promise.resolve(Response.json([{ id: "admin-row" }]));
  // Anything past the gate: an unknown signal, so a let-through request stops at 404.
  return Promise.resolve(Response.json([]));
}) as typeof fetch;

const scorer = await import("../../run-signal-scorer/index.ts");

const post = (token: string, body: Record<string, unknown>) =>
  new Request("http://local.test/x", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const opts = { sanitizeOps: false, sanitizeResources: false };
const scored = () => seen.filter((s) => s.includes("/rest/v1/signal_definitions") || s.includes("/rest/v1/place_"));

for (const [who, token] of [["the service key", SERVICE], ["an admin", "admin-token"]] as const) {
  for (const body of [{ signal_id: "s1", all_cities: true }, { signal_id: "s1", city_id: "c1" }, { signal_id: "s1", city_id: "c1", place_ids: [] }]) {
    Deno.test({ name: `${who}: ${JSON.stringify(body)} is refused, nothing is read or scored`, ...opts, fn: async () => {
      seen.length = 0;
      const res = await scorer.handler(post(token, body));
      assertEquals(res.status, 409);
      const out = await res.json();
      assertEquals(out.code, "city_wide_scoring_paused");
      assertEquals(scored(), []);
    } });
  }

  Deno.test({ name: `${who}: scoring by place id still goes through`, ...opts, fn: async () => {
    seen.length = 0;
    const res = await scorer.handler(post(token, { signal_id: "s1", place_ids: ["p1"], city_id: "c1" }));
    // Past the gate: it looked the signal up (an unknown one here).
    assertEquals(res.status, 404);
    await res.body?.cancel();
    assertEquals(scored().length > 0, true);
  } });
}

Deno.test({ name: "no scope at all asks for place_ids", ...opts, fn: async () => {
  const res = await scorer.handler(post(SERVICE, { signal_id: "s1" }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Provide place_ids");
} });

addEventListener("unload", () => {
  globalThis.fetch = realFetch;
});
