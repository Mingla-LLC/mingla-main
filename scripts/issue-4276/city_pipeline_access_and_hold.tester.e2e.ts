// Issue #4276 tester adversarial: access refusals and the score backlog hold, against the
// real handlers, real PostgREST and a replayed database. Providers are stubbed; anything
// leaving the machine fails the run. Run like run-city-pipeline-e2e.sh, with this file as
// the test path (same env vars).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const REST = Deno.env.get("ISSUE_4276_E2E_POSTGREST")!;
const SECRET = Deno.env.get("ISSUE_4276_E2E_JWT_SECRET")!;
const PSQL = Deno.env.get("ISSUE_4276_E2E_PSQL")!;
const FUNCTIONS_URL = Deno.env.get("SUPABASE_URL")!;

const CITY = "42769000-0000-4000-a000-000000000001";
const ADMIN = "42769000-0000-4000-e000-000000000001";
const OLD_AI = "42769000-0000-4000-b000-000000000001"; // servable, AI result from before the hold date
const SIGNAL = "drinks";

const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
const jwt = (role: string) => create({ alg: "HS256", typ: "JWT" }, { role, exp: getNumericDate(3600) }, key);
const SERVICE_KEY = await jwt("service_role");
const ANON_KEY = await jwt("anon");
// A second, equally valid service-role JWT that is not byte-identical to the env key.
const OTHER_SERVICE_JWT = await create({ alg: "HS256", typ: "JWT" }, { role: "service_role", iss: "other", exp: getNumericDate(7200) }, key);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("SUPABASE_ANON_KEY", ANON_KEY);

async function sql(statement: string): Promise<string> {
  const out = await new Deno.Command("psql", { args: [PSQL, "-v", "ON_ERROR_STOP=1", "-Atq", "-c", statement], stdout: "piped", stderr: "piped" }).output();
  if (!out.success) throw new Error(`psql: ${new TextDecoder().decode(out.stderr)}\n${statement}`);
  return new TextDecoder().decode(out.stdout).trim();
}

const leaks: string[] = [];
const realFetch = globalThis.fetch;
const handlers = new Map<string, (req: Request) => Response | Promise<Response>>();
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(request.url);
  const path = url.pathname;
  if (path.startsWith("/rest/v1")) {
    return realFetch(`${REST}${path.replace("/rest/v1", "")}${url.search}`, {
      method: request.method, headers: request.headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
    });
  }
  if (path === "/auth/v1/user") {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (token === "admin-token") return Response.json({ id: ADMIN, email: "tester-admin@local.test", aud: "authenticated" });
    if (token === "inactive-admin-token") return Response.json({ id: crypto.randomUUID(), email: "tester-inactive@local.test", aud: "authenticated" });
    if (token === "user-token") return Response.json({ id: crypto.randomUUID(), email: "someone@local.test", aud: "authenticated" });
    return Response.json({ message: "invalid" }, { status: 401 });
  }
  if (url.host === "deno.land" && path.endsWith(".wasm")) return realFetch(request);
  if (url.protocol === "file:") return realFetch(request);
  leaks.push(request.url);
  throw new Error(`tester: refused to reach ${request.url}`);
}) as typeof fetch;

const root = new URL("../../supabase/functions/", import.meta.url);
async function load(name: string, exportName?: string) {
  const mod = await import(new URL(`${name}/index.ts`, root).href);
  handlers.set(name, exportName ? mod[exportName] : (globalThis as unknown as Record<string, (r: Request) => Response>).__issue4276ServeHandler);
}
await load("admin-seed-places", "httpHandler");
await load("run-city-pipeline", "httpHandler");
await load("run-pre-photo-bouncer", "handler");
await load("run-bouncer", "handler");
await load("run-signal-scorer", "handler");

async function call(fn: string, body: Record<string, unknown>, token: string | null) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  const res = await handlers.get(fn)!(new Request(`${FUNCTIONS_URL}/functions/v1/${fn}`, { method: "POST", headers, body: JSON.stringify(body) }));
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 200) }; }
  return { status: res.status, body: parsed };
}

const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test({ name: "setup", ...opts, fn: async () => {
  await sql(`
    delete from public.place_scores where place_id = '${OLD_AI}';
    delete from public.place_pool where id = '${OLD_AI}';
    delete from public.seeding_cities where id = '${CITY}';
    delete from public.admin_users where email in ('tester-admin@local.test','tester-inactive@local.test');
    insert into public.admin_users (id, email, status) values ('${ADMIN}', 'tester-admin@local.test', 'active');
    insert into public.admin_users (email, status) values ('tester-inactive@local.test', 'revoked');
    insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng, coverage_radius_km, status, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng)
      values ('${CITY}', 'tester-city', 'Tester City', 'Testland', 'TL', 20, 20, 5, 'seeded', 19.99, 19.99, 20.01, 20.01);
    insert into public.place_pool (id, google_place_id, name, lat, lng, city_id, is_active, is_servable, rating, review_count, types, primary_type, ai_signal_scores)
      values ('${OLD_AI}', 'tester-old-ai', 'Old AI bar', 20, 20, '${CITY}', true, true, 4.5, 300, array['bar'], 'bar',
        jsonb_build_object('${SIGNAL}', jsonb_build_object('score_0_to_100', 99, 'inappropriate_for', false, 'reasoning', 'old', 'evaluated_at', '2026-09-01T00:00:00Z', 'prompt_version','v4','model','gemini-3.6-flash')));
  `);
}});

const FNS: Array<[string, Record<string, unknown>]> = [
  ["run-bouncer", { city_id: CITY, max_rows: 1 }],
  ["run-pre-photo-bouncer", { city_id: CITY, max_rows: 1 }],
  ["run-signal-scorer", { signal_id: SIGNAL, place_ids: [OLD_AI] }],
  ["run-city-pipeline", { action: "status" }],
  ["admin-seed-places", { action: "coverage_check", cityId: CITY }],
];

Deno.test({ name: "every pipeline function refuses no token, the anon key, a non-admin and a revoked admin", ...opts, fn: async () => {
  const before = await sql(`select count(*) from public.place_scores where place_id = '${OLD_AI}'`);
  for (const [fn, body] of FNS) {
    const none = await call(fn, body, null);
    const anon = await call(fn, body, ANON_KEY);
    const user = await call(fn, body, "user-token");
    const revoked = await call(fn, body, "inactive-admin-token");
    console.log(`${fn}: none=${none.status} anon=${anon.status} user=${user.status} revoked=${revoked.status}`);
    assert(none.status === 401 || none.status === 403, `${fn} no token -> ${none.status}`);
    assert(anon.status === 401 || anon.status === 403, `${fn} anon -> ${anon.status} ${JSON.stringify(anon.body)}`);
    assert(user.status === 401 || user.status === 403, `${fn} user -> ${user.status}`);
    assert(revoked.status === 401 || revoked.status === 403, `${fn} revoked admin -> ${revoked.status}`);
  }
  assertEquals(await sql(`select count(*) from public.place_scores where place_id = '${OLD_AI}'`), before, "a refused call wrote nothing");
}});

Deno.test({ name: "admins and the service key pass", ...opts, fn: async () => {
  for (const [fn, body] of FNS) {
    if (fn === "run-signal-scorer") continue; // scored separately below
    const admin = await call(fn, body, "admin-token");
    console.log(`${fn}: admin=${admin.status} ${JSON.stringify(admin.body).slice(0, 120)}`);
    assert(admin.status !== 401 && admin.status !== 403, `${fn} admin refused ${admin.status}`);
  }
  for (const fn of ["run-bouncer", "run-pre-photo-bouncer"]) {
    const svc = await call(fn, { city_id: CITY, max_rows: 1 }, SERVICE_KEY);
    console.log(`${fn}: service=${svc.status}`);
    assertEquals(svc.status, 200);
  }
  const tick = await call("run-city-pipeline", { action: "tick" }, SERVICE_KEY);
  console.log(`run-city-pipeline tick service=${tick.status}`);
  assertEquals(tick.status, 200);
  const adminTick = await call("run-city-pipeline", { action: "tick" }, "admin-token");
  assertEquals(adminTick.status, 403, "tick is service only");
  // Observation, not an assertion: a valid service_role JWT that is not the exact env string.
  const other = await call("run-bouncer", { city_id: CITY, max_rows: 1 }, OTHER_SERVICE_JWT);
  console.log(`run-bouncer with a different valid service_role JWT -> ${other.status}`);
}});

Deno.test({ name: "the scorer refuses every city-wide shape for every caller", ...opts, fn: async () => {
  const shapes: Array<Record<string, unknown>> = [
    { signal_id: SIGNAL, city_id: CITY },
    { signal_id: SIGNAL, all_cities: true },
    { signal_id: SIGNAL, place_ids: [], city_id: CITY },
    { signal_id: SIGNAL, place_ids: [], all_cities: true },
    { signal_id: SIGNAL, place_ids: [] },
    { signal_id: SIGNAL },
    { signal_id: SIGNAL, include_held: true },
    { signal_id: SIGNAL, include_held: true, place_ids: [] },
    { signal_id: SIGNAL, include_held: true, city_id: CITY },
    { signal_id: SIGNAL, place_ids: "not-an-array", city_id: CITY },
    { signal_id: SIGNAL, place_ids: null, all_cities: true },
  ];
  for (const token of [SERVICE_KEY, "admin-token"]) {
    for (const body of shapes) {
      const r = await call("run-signal-scorer", body, token);
      console.log(`scorer ${token === SERVICE_KEY ? "service" : "admin"} ${JSON.stringify(body)} -> ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
      assert(r.status === 400 || r.status === 409, `accepted ${JSON.stringify(body)} -> ${r.status}`);
    }
  }
  assertEquals(await sql(`select count(*) from public.place_scores where place_id = '${OLD_AI}'`), "0");
}});

Deno.test({ name: "the rescore selector never offers a pre-hold AI result", ...opts, fn: async () => {
  assertEquals(await sql(`select count(*) from public.pg_meta_orch_1009_sub_d_select_stale_pairs(100000) where place_id = '${OLD_AI}'`), "0");
}});

// #4276 rework: was an observation (the scorer blended a pre-hold AI result by id).
Deno.test({ name: "scoring by place id leaves a pre-hold AI result untouched and says so", ...opts, fn: async () => {
  // The bouncer calls above re-judge the place (no photos, no website); put it back.
  await sql(`update public.place_pool set is_servable = true where id = '${OLD_AI}'`);
  const r = await call("run-signal-scorer", { signal_id: SIGNAL, place_ids: [OLD_AI] }, SERVICE_KEY);
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assertEquals(r.body.held_old_result, 1);
  assertEquals(await sql(`select count(*) from public.place_scores where place_id = '${OLD_AI}' and signal_id = '${SIGNAL}'`), "0");
  assertEquals(leaks, []);
}});
