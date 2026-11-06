// Issue #4276: functions the conductor reaches with the service key still refuse
// everyone else. A signed-in user who isn't an admin gets 403, a wrong token 401, and
// the service key opens only the actions the conductor needs.
//
// MINGLA-INVARIANT: I-4276-CONDUCTOR-SERVICE-KEY-NARROW | issue #4276 | The service key opens only the conductor's actions, and a user or wrong token is refused as before
//
// FAILS-ON-REVERT: drop the action list from either function and the "other actions" tests
// pass the key through. Make the conductor branch skip the token match and a wrong token
// gets in. Verified by replacing each.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SERVICE = "service-key";
Deno.env.set("SUPABASE_URL", "http://local.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE);
Deno.env.set("GEMINI_API_KEY", "x");
Deno.env.set("SERPER_API_KEY", "x");
Deno.env.set("GOOGLE_MAPS_API_KEY", "x");

const seen: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const request = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(request.url);
  // imagescript loads its own wasm on import.
  if (url.pathname.endsWith(".wasm")) return realFetch(request);
  seen.push(`${request.method} ${url.pathname}`);
  if (url.pathname === "/auth/v1/user") {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    return Promise.resolve(
      token === "user-token"
        ? Response.json({ id: "u1", email: "someone@local.test", aud: "authenticated" })
        : Response.json({ message: "invalid" }, { status: 401 }),
    );
  }
  // Nobody here is an admin, and every read comes back empty.
  if (url.pathname === "/rest/v1/admin_users") {
    return Promise.resolve(Response.json([]));
  }
  return Promise.resolve(Response.json([]));
}) as typeof fetch;

const photos = await import("../../backfill-place-photos/index.ts");
const intel = await import("../../run-place-intelligence-trial/index.ts");
const conductor = await import("../index.ts");

const post = (token: string, body: Record<string, unknown>) =>
  new Request("http://local.test/x", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const opts = { sanitizeOps: false, sanitizeResources: false };
const writes = () => seen.filter((s) => !s.startsWith("GET ") && !s.includes("/auth/v1/"));

for (const [name, handler, action] of [
  ["backfill-place-photos", photos.handler, "create_run"],
  ["backfill-place-photos", photos.handler, "run_next_batch"],
  ["run-place-intelligence-trial", intel.httpHandler, "start_run"],
  ["run-place-intelligence-trial", intel.httpHandler, "pause_run"],
  ["run-place-intelligence-trial", intel.httpHandler, "resume_run"],
] as const) {
  Deno.test({ name: `${name} ${action}: a non-admin user and a wrong token are refused`, ...opts, fn: async () => {
    seen.length = 0;
    const user = await handler(post("user-token", { action, cityId: "c", city_id: "c", run_id: "r", runId: "r" }));
    assertEquals(user.status, 403);
    await user.body?.cancel();
    const wrong = await handler(post("wrong-token", { action, cityId: "c", city_id: "c", run_id: "r", runId: "r" }));
    assertEquals(wrong.status, 401);
    await wrong.body?.cancel();
    assertEquals(writes(), [], "nothing was written for either");
  } });
}

Deno.test({ name: "the service key doesn't open actions the conductor doesn't use", ...opts, fn: async () => {
  for (const [handler, action] of [
    [photos.handler, "skip_batch"],
    [photos.handler, "pause_run"],
    [intel.httpHandler, "admin_reeval_place"],
    [intel.httpHandler, "fetch_reviews"],
  ] as const) {
    seen.length = 0;
    const res = await handler(post(SERVICE, { action, runId: "r", batchId: "b", place_pool_id: "p" }));
    assertEquals(res.status, 401, `${action} went to the user check, which has no such user`);
    await res.body?.cancel();
    assertEquals(writes(), []);
  }
} });

Deno.test({ name: "run-place-intelligence-trial needs the service key to name an active admin", ...opts, fn: async () => {
  const none = await intel.httpHandler(post(SERVICE, { action: "pause_run", run_id: "r" }));
  assertEquals(none.status, 403);
  await none.body?.cancel();
  const stranger = await intel.httpHandler(post(SERVICE, { action: "pause_run", run_id: "r", admin_id: "stranger" }));
  assertEquals(stranger.status, 403);
  await stranger.body?.cancel();
} });

Deno.test({ name: "conductor: tick takes only the service key", ...opts, fn: async () => {
  for (const [token, want] of [["user-token", 403], ["wrong-token", 403]] as const) {
    const res = await conductor.httpHandler(post(token, { action: "tick" }));
    assertEquals(res.status, want);
    await res.body?.cancel();
  }
} });

Deno.test({ name: "conductor: starting, approving and resuming need a signed-in admin, never the service key", ...opts, fn: async () => {
  for (const action of ["start", "approve", "resume", "pause", "cancel", "rules_only", "settings", "assign_no_city"]) {
    const asKey = await conductor.httpHandler(post(SERVICE, { action, cityId: "c", runId: "r", spendLimitUsd: 5 }));
    assertEquals(asKey.status, 401, `${action} with the service key`);
    await asKey.body?.cancel();
    const asUser = await conductor.httpHandler(post("user-token", { action, cityId: "c", runId: "r", spendLimitUsd: 5 }));
    assertEquals(asUser.status, 403, `${action} as a non-admin`);
    await asUser.body?.cancel();
  }
  assert(true);
} });

addEventListener("unload", () => {
  globalThis.fetch = realFetch;
});
