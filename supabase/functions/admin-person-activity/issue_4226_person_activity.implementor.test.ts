// #4226 Phase 2 — admin-person-activity: admin only, PostHog read on the
// server, honest "not connected" answer when the secrets are missing.
import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildQueries,
  DEFAULT_POSTHOG_HOST,
  type Deps,
  handle,
  parseScreens,
  parseSummary,
  readConfig,
  SCREEN_LIMIT,
} from "./index.ts";

const USER = "42262000-0000-4000-a000-000000000013";
const CONFIG = { apiKey: "phx_test", projectId: "12345", host: "https://us.posthog.com" };

function deps(options: {
  admin?: boolean;
  signedIn?: boolean;
  config?: typeof CONFIG | null;
  fetch?: Deps["fetch"];
  calls?: Array<{ url: string; body: Record<string, unknown>; auth: string | null }>;
} = {}): Deps {
  return {
    config: () => (options.config === undefined ? CONFIG : options.config),
    userClient: () => ({
      auth: {
        getUser: () =>
          Promise.resolve({ data: { user: options.signedIn === false ? null : { id: "admin" } }, error: null }),
      },
      rpc: (fn: string) => Promise.resolve({ data: fn === "is_admin_user" ? options.admin !== false : null, error: null }),
    }),
    fetch: options.fetch ?? ((url, init) => {
      const body = JSON.parse(init.body);
      options.calls?.push({ url, body, auth: init.headers.Authorization ?? null });
      const isScreens = String(body.query?.query ?? "").includes("$screen'");
      return Promise.resolve(new Response(JSON.stringify({
        results: isScreens
          ? [["Explore deck", "explorer", "2026-11-17T09:12:00Z"], ["Event editor", "host", "2026-11-16 20:40:00.000"]]
          : [[7, "2026-11-17T09:12:00Z"]],
      }), { status: 200 }));
    }),
  };
}

function post(body: unknown, auth = "Bearer jwt") {
  return new Request("https://x/admin-person-activity", {
    method: "POST",
    headers: auth ? { authorization: auth, "content-type": "application/json" } : { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("A-01 no bearer is 401; a signed-in non-admin is 403", async () => {
  assertEquals((await handle(post({ user_id: USER }, ""), deps())).status, 401);
  assertEquals((await handle(post({ user_id: USER }), deps({ signedIn: false }))).status, 401);
  assertEquals((await handle(post({ user_id: USER }), deps({ admin: false }))).status, 403);
});

Deno.test("A-02 a bad user id is refused before any PostHog call", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
  const res = await handle(post({ user_id: "x' OR 1=1 --" }), deps({ calls }));
  assertEquals(res.status, 400);
  assertEquals(calls.length, 0);
});

Deno.test("A-03 secrets missing: configured false, never an empty list", async () => {
  const res = await handle(post({ user_id: USER }), deps({ config: null }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { configured: false });
  assertEquals(readConfig({}), null);
  assertEquals(readConfig({ apiKey: "k" }), null);
  assertEquals(readConfig({ apiKey: "k", projectId: "99" }), { apiKey: "k", projectId: "99", host: DEFAULT_POSTHOG_HOST });
  assertEquals(readConfig({ apiKey: "k", projectId: "99", host: "https://eu.posthog.com/" })?.host, "https://eu.posthog.com");
  assertEquals(readConfig({ apiKey: "k", projectId: "99", host: "http://evil.example" }), null);
  assertEquals(readConfig({ apiKey: "k", projectId: "not-a-number" }), null);
});

Deno.test("A-04 an admin gets screens, sessions and last event; the id is a placeholder value", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
  const res = await handle(post({ user_id: USER.toUpperCase() }), deps({ calls }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.configured, true);
  assertEquals(body.sessions_30d, 7);
  assertEquals(body.last_event_at, "2026-11-17T09:12:00.000Z");
  assertEquals(body.screens, [
    { name: "Explore deck", app: "explorer", at: "2026-11-17T09:12:00.000Z" },
    { name: "Event editor", app: "host", at: "2026-11-16T20:40:00.000Z" },
  ]);
  assertEquals(calls.length, 2);
  for (const call of calls) {
    assertEquals(call.url, "https://us.posthog.com/api/projects/12345/query/");
    assertEquals(call.auth, "Bearer phx_test");
    const query = call.body.query as { query: string; values: Record<string, string> };
    assertEquals(query.values.user_id, USER);
    assert(!query.query.includes(USER), "the id is never spliced into the HogQL text");
  }
  assert(!JSON.stringify(body).includes("phx_test"), "the key never reaches the browser");
});

Deno.test("A-05 PostHog failing is a 502, not an empty list", async () => {
  const res = await handle(
    post({ user_id: USER }),
    deps({ fetch: () => Promise.resolve(new Response("boom", { status: 500 })) }),
  );
  assertEquals(res.status, 502);
  assertEquals((await res.json()).error, "activity_unavailable");
});

Deno.test("A-06 parsing caps screens at 50 and drops rows without a time", () => {
  const many = Array.from({ length: 80 }, (_, i) => [`S${i}`, "explorer", "2026-11-17T09:12:00Z"]);
  assertEquals(parseScreens({ results: many }).length, SCREEN_LIMIT);
  assertEquals(parseScreens({ results: [[null, null, null], ["", null, "2026-11-01T00:00:00Z"]] }), [
    { name: "Unnamed screen", app: null, at: "2026-11-01T00:00:00.000Z" },
  ]);
  assertEquals(parseSummary({ results: [] }), { sessions_30d: 0, last_event_at: null });
  assertEquals(parseSummary(null), { sessions_30d: 0, last_event_at: null });
  const q = buildQueries(USER);
  assert(q.screens.query.includes("LIMIT 50"));
  assert(q.screens.query.includes("INTERVAL 30 DAY"));
});
