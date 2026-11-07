// Issue #4276: the place judging and scoring functions answer only the service role
// or an active admin. The anon key and a signed-in user who isn't an admin are refused
// before anything is read or written; an admin and the service key get through to the
// function's own request checks.
//
// MINGLA-INVARIANT: I-4276-PLACE-JUDGING-ADMIN-OR-SERVICE | issue #4276 | run-bouncer, run-pre-photo-bouncer and run-signal-scorer answer only the service role or a current admin
//
// The admin check is the database's is_admin_user(), asked as the caller, the same check
// every admin surface uses (#3537); no direct admin_users query.
//
// FAILS-ON-REVERT: delete the authorizePlaceJudgingCaller lines from any of the three
// functions and its "refused" test fails (the anon key reaches the body check and gets
// 400, not 401). Put back the direct admin_users query and the admin test fails (the
// admin is refused 403, and is_admin_user is never asked).

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SERVICE = "service-key";
const ANON = "anon-key";
Deno.env.set("SUPABASE_URL", "http://local.test");
Deno.env.set("SUPABASE_ANON_KEY", ANON);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE);

const seen: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const request = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(request.url);
  seen.push(`${request.method} ${url.pathname}`);
  if (url.pathname === "/auth/v1/user") {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (token === "admin-token") return Promise.resolve(Response.json({ id: "a1", email: "admin@local.test", aud: "authenticated" }));
    if (token === "user-token") return Promise.resolve(Response.json({ id: "u1", email: "someone@local.test", aud: "authenticated" }));
    // What the auth server says about the anon key: a valid JWT with no user.
    if (token === ANON) return Promise.resolve(Response.json({ msg: "invalid claim: missing sub claim" }, { status: 403 }));
    return Promise.resolve(Response.json({ msg: "invalid JWT" }, { status: 401 }));
  }
  if (url.pathname === "/rest/v1/rpc/is_admin_user") {
    // The database answers for the caller its token names (auth.uid()).
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    return Promise.resolve(Response.json(token === "admin-token"));
  }
  if (url.pathname === "/rest/v1/admin_users") {
    // A direct table query is not the canonical check; it never says yes here.
    return Promise.resolve(Response.json([]));
  }
  return Promise.resolve(Response.json([]));
}) as typeof fetch;

const bouncer = await import("../../run-bouncer/index.ts");
const prePhoto = await import("../../run-pre-photo-bouncer/index.ts");
const scorer = await import("../../run-signal-scorer/index.ts");

const post = (token: string | null, body: Record<string, unknown>) =>
  new Request("http://local.test/x", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const opts = { sanitizeOps: false, sanitizeResources: false };
// Anything past the auth check: place reads, scores, signal definitions.
const pastAuth = () => seen.filter((s) => !s.includes("/auth/v1/") && !s.endsWith("/rest/v1/rpc/is_admin_user"));

// An empty body: a caller who gets through is stopped by the function's own check (400),
// so an accepted call proves the gate let it in without judging or scoring anything.
const FUNCTIONS = [
  ["run-bouncer", bouncer.handler, "Provide city_id or all_cities=true"],
  ["run-pre-photo-bouncer", prePhoto.handler, "Provide city_id or all_cities=true"],
  ["run-signal-scorer", scorer.handler, "signal_id is required"],
] as const;

for (const [name, handler, bodyError] of FUNCTIONS) {
  Deno.test({ name: `${name}: the anon key, a non-admin user, a wrong token and no token are refused`, ...opts, fn: async () => {
    for (const [token, want] of [[ANON, 401], ["user-token", 403], ["wrong-token", 401], [null, 401]] as const) {
      seen.length = 0;
      // A real city-wide body: refused callers must not get anywhere near it.
      const res = await handler(post(token, { all_cities: true, signal_id: "s1" }));
      assertEquals(res.status, want, `${name} with ${token ?? "no token"}`);
      await res.body?.cancel();
      assertEquals(pastAuth(), [], `${name}: nothing read or written for ${token ?? "no token"}`);
      // A signed-in non-admin is refused because is_admin_user said no, not by accident.
      if (token === "user-token") assert(seen.includes("POST /rest/v1/rpc/is_admin_user"), `${name}: is_admin_user asked`);
    }
  } });

  Deno.test({ name: `${name}: an active admin and the service role are let in`, ...opts, fn: async () => {
    for (const token of ["admin-token", SERVICE]) {
      seen.length = 0;
      const res = await handler(post(token, {}));
      assertEquals(res.status, 400, `${name} with ${token === SERVICE ? "the service key" : "an admin"}`);
      assertEquals((await res.json()).error, bodyError);
      if (token === "admin-token") {
        assert(seen.includes("POST /rest/v1/rpc/is_admin_user"), `${name}: the admin passed through is_admin_user`);
        assert(!seen.some((s) => s.includes("/rest/v1/admin_users")), `${name}: no direct admin_users query`);
      }
    }
    // The service key needs no user lookup at all.
    seen.length = 0;
    const res = await handler(post(SERVICE, {}));
    await res.body?.cancel();
    assertEquals(seen.filter((s) => s.includes("/auth/v1/")), []);
    assert(true);
  } });
}

addEventListener("unload", () => {
  globalThis.fetch = realFetch;
});
