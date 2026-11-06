// Issue #4276 acceptance: a city runs from box to final score with the browser closed,
// surviving pause, resume and a stale batch. Real Postgres, real PostgREST, the real
// edge function handlers and the real cron SQL. Google, Serper, Gemini and Storage are
// stubbed. Any request to anywhere else fails the run, so nothing paid can happen.
//
// Run with scripts/issue-4276/run-city-pipeline-e2e.sh. CI has no PostgREST lane, so this
// runs by hand; the pg and Deno suites beside the conductor cover what CI can reach.
//
// FAILS-ON-REVERT: take include_held out of the scorer and the score stage writes no
// row, so the final-score assertions fail. Take the claim out of run_next_batch and the
// stale search is never picked up, so the stage never finishes. Verified by replacing each.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const REST = Deno.env.get("ISSUE_4276_E2E_POSTGREST")!;
const SECRET = Deno.env.get("ISSUE_4276_E2E_JWT_SECRET")!;
const PSQL = Deno.env.get("ISSUE_4276_E2E_PSQL")!;
const FUNCTIONS_URL = Deno.env.get("SUPABASE_URL")!;

const CITY = "42764000-0000-4000-a000-000000000001";
const ADMIN = "42764000-0000-4000-e000-000000000001";
const LIVE = "42764000-0000-4000-b000-000000000001";
const BACKLOG = "42764000-0000-4000-b000-000000000002";
const CONTROL = "42764000-0000-4000-b000-000000000003";
const SIGNAL = "drinks";
const BOX = { sw: { lat: 10, lng: 10 }, ne: { lat: 10.004, lng: 10.004 } };

const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(SECRET),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"],
);
const jwt = (role: string) => create({ alg: "HS256", typ: "JWT" }, { role, exp: getNumericDate(3600) }, key);
const SERVICE_KEY = await jwt("service_role");
const ANON_KEY = await jwt("anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("SUPABASE_ANON_KEY", ANON_KEY);

// ── SQL ─────────────────────────────────────────────────────────────────────
async function sql(statement: string): Promise<string> {
  const out = await new Deno.Command("psql", {
    args: [PSQL, "-v", "ON_ERROR_STOP=1", "-Atq", "-c", statement],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) throw new Error(`psql: ${new TextDecoder().decode(out.stderr)}\n${statement}`);
  return new TextDecoder().decode(out.stdout).trim();
}

// ── Providers ───────────────────────────────────────────────────────────────
const calls = { google_search: 0, google_media: 0, google_geocode: 0, serper: 0, gemini: 0, storage: 0, unknown: [] as string[] };

// 1x1 PNG
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

function fakePlace(id: string, lat: number, lng: number, withWebsite: boolean) {
  return {
    id,
    displayName: { text: `Stub ${id}` },
    formattedAddress: "1 Stub Road",
    location: { latitude: lat, longitude: lng },
    types: ["bar", "establishment"],
    primaryType: "bar",
    primaryTypeDisplayName: { text: "Bar" },
    businessStatus: "OPERATIONAL",
    rating: 4.6,
    userRatingCount: 240,
    photos: [{ name: `places/${id}/photos/p1`, widthPx: 800, heightPx: 600 }],
    websiteUri: withWebsite ? `https://stub.test/${id}` : undefined,
    regularOpeningHours: {
      openNow: true,
      periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 23, minute: 0 } }],
      weekdayDescriptions: ["Monday: 9 AM to 11 PM"],
    },
    servesCocktails: true,
    servesBeer: true,
    liveMusic: true,
  };
}

const placesFor = (center: { latitude: number; longitude: number }, radius: number, config: string) => {
  // One config caps at the full radius, so a split has to happen, once.
  const capped = config.includes("cocktail_bar") && radius >= 700;
  const n = capped ? 20 : 1;
  return Array.from({ length: n }, (_, i) => {
    // A capped search keeps finding the same places, so the world stays small.
    const id = capped
      ? `gp-capped-${i}`
      : `gp-${center.latitude.toFixed(5)}-${center.longitude.toFixed(5)}-${radius}-${config.slice(0, 12)}-${i}`;
    // Every fifth place has no website, so the no-website rule has something to do.
    return fakePlace(id, 10.002 + i * 0.0001, 10.002, i % 5 !== 4);
  });
};

let serperDown = false;
let onNextSearch: (() => Promise<void>) | null = null;

const handlers = new Map<string, (req: Request) => Response | Promise<Response>>();
const realFetch = globalThis.fetch;

function routeFunction(name: string, input: Request): Promise<Response> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`no handler loaded for ${name}`);
  return Promise.resolve(handler(input));
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(request.url);
  const path = url.pathname;

  if (path.startsWith("/rest/v1")) {
    return realFetch(`${REST}${path.replace("/rest/v1", "")}${url.search}`, {
      method: request.method,
      headers: request.headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
    });
  }
  if (path.startsWith("/functions/v1/")) return routeFunction(path.split("/")[3], request);
  if (path === "/auth/v1/user") {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (token === "admin-token") return Response.json({ id: ADMIN, email: "e2e-admin@local.test", aud: "authenticated" });
    if (token === "user-token") return Response.json({ id: crypto.randomUUID(), email: "someone@local.test", aud: "authenticated" });
    return Response.json({ message: "invalid" }, { status: 401 });
  }
  if (path.startsWith("/storage/v1")) {
    calls.storage++;
    if (path.includes("/object/public/") || request.method === "GET") return new Response(PNG, { headers: { "content-type": "image/png" } });
    return Response.json({ Key: path, Id: crypto.randomUUID() });
  }
  if (url.host === "places.googleapis.com") {
    if (path.endsWith(":searchNearby")) {
      calls.google_search++;
      // Google fails the first search of all: the level goes on, and a later round runs it.
      if (calls.google_search === 1) return new Response("try later", { status: 500 });
      const hook = onNextSearch;
      onNextSearch = null;
      if (hook) await hook();
      const body = JSON.parse(await request.text());
      const circle = body.locationRestriction.circle;
      return Response.json({ places: placesFor(circle.center, circle.radius, (body.includedTypes ?? ["all"]).join("_")) });
    }
    if (path.endsWith("/media")) {
      calls.google_media++;
      return new Response(PNG, { headers: { "content-type": "image/png" } });
    }
    return Response.json({ id: "x", photos: [{ name: "places/x/photos/p1", widthPx: 800, heightPx: 600 }] });
  }
  if (url.host === "maps.googleapis.com") {
    calls.google_geocode++;
    return Response.json({
      status: "OK",
      results: [{
        formatted_address: "E2E City",
        types: ["locality", "political"],
        geometry: {
          location: { lat: 10.01, lng: 10.01 },
          viewport: { southwest: BOX.sw, northeast: BOX.ne },
        },
      }],
    });
  }
  if (url.host === "google.serper.dev") {
    calls.serper++;
    if (serperDown) return new Response(JSON.stringify({ message: "Not enough credits" }), { status: 400 });
    return Response.json({
      reviews: [{ id: `r-${crypto.randomUUID()}`, snippet: "Lovely bar", rating: 5, isoDate: "2026-10-01T00:00:00Z" }],
    });
  }
  if (url.host === "generativelanguage.googleapis.com") {
    calls.gemini++;
    const body = JSON.parse(await request.text());
    return Response.json({
      candidates: [{
        finishReason: "STOP",
        content: {
          parts: [{
            functionCall: {
              name: body.tools[0].function_declarations[0].name,
              args: { evaluations: [{ signal_id: SIGNAL, score_0_to_100: 95, inappropriate_for: false, reasoning: "Great bar" }] },
            },
          }],
        },
      }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 0 },
    });
  }
  // imagescript fetches its own wasm when it loads. Not a provider.
  if (url.host === "deno.land" && path.endsWith(".wasm")) return realFetch(request);
  if (url.protocol === "file:") return realFetch(request);
  if (url.host.endsWith(".test")) return new Response(PNG, { headers: { "content-type": "image/png" } });
  calls.unknown.push(request.url);
  throw new Error(`E2E: refused to reach ${request.url}`);
}) as typeof fetch;

// ── Load the real functions ─────────────────────────────────────────────────
const root = new URL("../../supabase/functions/", import.meta.url);
async function load(name: string, exportName?: string) {
  const mod = await import(new URL(`${name}/index.ts`, root).href);
  if (exportName) {
    handlers.set(name, mod[exportName]);
    return;
  }
  const g = globalThis as unknown as Record<string, (req: Request) => Response>;
  handlers.set(name, g.__issue4276ServeHandler);
}
await load("admin-seed-places", "httpHandler");
await load("backfill-place-photos", "handler");
await load("backfill-place-photo-thumbs", "handler");
await load("run-place-intelligence-trial", "httpHandler");
await load("run-city-pipeline", "httpHandler");
await load("run-pre-photo-bouncer", "handler");
await load("run-bouncer", "handler");
await load("run-signal-scorer", "handler");

async function callAdmin(action: string, body: Record<string, unknown> = {}, token = "admin-token") {
  const res = await handlers.get("run-city-pipeline")!(new Request(`${FUNCTIONS_URL}/functions/v1/run-city-pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  }));
  return { status: res.status, body: await res.json() };
}

/** One minute of pg_cron: the real kickers, then whatever they posted. */
async function cronMinute(): Promise<number> {
  await sql("select public.tg_kick_city_pipeline(); select public.tg_kick_pending_trial_runs();");
  const posted = await sql("delete from public.e2e_kicks returning url || ' ' || body::text");
  const lines = posted ? posted.split("\n") : [];
  for (const line of lines) {
    const [url, ...rest] = line.split(" ");
    const res = await fetch(new URL(new URL(url).pathname, FUNCTIONS_URL), {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: rest.join(" "),
    });
    const text = await res.text();
    if (res.status >= 400) console.error(`  kick ${url} -> ${res.status} ${text.slice(0, 300)}`);
  }
  // The worker's self-invoke needs the edge runtime. A real minute would age these.
  await sql(`update public.place_intelligence_runs set last_heartbeat_at = now() - interval '5 minutes', last_kicked_at = now() - interval '5 minutes' where status = 'running'`);
  return lines.length;
}

async function runRow(id: string) {
  return JSON.parse(await sql(`select to_jsonb(r) from public.city_pipeline_runs r where id = '${id}'`));
}

async function runUntil(id: string, want: (r: Record<string, unknown>) => boolean, label: string, max = 400) {
  for (let i = 0; i < max; i++) {
    const row = await runRow(id);
    if (want(row)) return row;
    if (["failed", "cancelled"].includes(row.status)) throw new Error(`${label}: run ended ${row.status}: ${row.last_error}`);
    if (row.status === "paused" && !want(row)) throw new Error(`${label}: paused ${row.pause_reason} ${JSON.stringify(row.pause_detail)}`);
    await cronMinute();
  }
  const row = await runRow(id);
  throw new Error(`${label}: gave up at stage ${row.current_stage} status ${row.status} error ${row.last_error}`);
}

const health = (service: string, status: string, http = 200) =>
  sql(`insert into public.api_health_checks (service_key, layer, status, http_status, checked_at) values ('${service}', 'synthetic', '${status}', ${http}, now())`);

const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test({ name: "a city runs from box to final score with no browser, through pause, resume and a stale search", ...opts, fn: async () => {
  // ── The world before the run. A previous run's rows go first. ──
  await sql(`
    delete from public.e2e_kicks;
    delete from public.city_pipeline_runs where city_id = '${CITY}';
    delete from public.place_intelligence_trial_runs where city_id = '${CITY}';
    delete from public.place_intelligence_runs where city_id = '${CITY}';
    delete from public.place_external_reviews where place_pool_id in (select id from public.place_pool where city_id = '${CITY}');
    delete from public.place_review_fetch_state where place_id in (select id from public.place_pool where city_id = '${CITY}');
    delete from public.place_scores where place_id in (select id from public.place_pool where city_id = '${CITY}');
    delete from public.place_pool where city_id = '${CITY}';
    delete from public.photo_backfill_runs where city = 'E2E City';
    delete from public.seeding_cities where id = '${CITY}';
    delete from public.admin_users where id = '${ADMIN}';
    update public.signal_definitions set current_version_id = null where id = '${SIGNAL}';
    delete from public.signal_definition_versions where id = '42764000-0000-4000-9000-000000000001';
    delete from public.signal_definitions where id = '${SIGNAL}';
    delete from public.api_health_checks where service_key in ('google_places', 'gemini', 'serper');
  `);
  await sql(`
    insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, status)
      values ('${CITY}', 'gp-e2e-city', 'E2E City', 'Testland', 'TL', 10.01, 10.01, ${BOX.sw.lat}, ${BOX.sw.lng}, ${BOX.ne.lat}, ${BOX.ne.lng}, 'draft');
    insert into public.admin_users (id, email, status) values ('${ADMIN}', 'e2e-admin@local.test', 'active');
    insert into public.signal_definitions (id, label, kind, is_active) values ('${SIGNAL}', 'Drinks', 'type-grounded', true);
    insert into public.signal_definition_versions (id, signal_id, version_label, config)
      values ('42764000-0000-4000-9000-000000000001', '${SIGNAL}', 'v1',
        '{"min_rating":0,"min_reviews":0,"bypass_rating":5,"field_weights":{},"scale":{"rating_multiplier":2,"rating_cap":10,"reviews_log_multiplier":2,"reviews_cap":10},"text_patterns":{},"cap":200,"clamp_min":0,"ai_blend_weight":0.6}'::jsonb);
    update public.signal_definitions set current_version_id = '42764000-0000-4000-9000-000000000001' where id = '${SIGNAL}';
    -- A live place, an old AI result held back by S2, and a twin with no AI at all.
    insert into public.place_pool (id, google_place_id, name, lat, lng, types, primary_type, is_active, is_servable, city_id, stored_photo_urls, fetched_via, rating, review_count, website, ai_signal_scores)
      values
      ('${LIVE}', 'gp-e2e-live', 'Live', 10.01, 10.01, array['bar'], 'bar', true, true, '${CITY}', array['https://x.test/1.jpg'], 'nearby_search', 4.6, 240, 'https://x.test', null),
      ('${BACKLOG}', 'gp-e2e-backlog', 'Backlog', 10.01, 10.01, array['bar'], 'bar', true, true, '${CITY}', array['https://x.test/1.jpg'], 'nearby_search', 4.6, 240, 'https://x.test',
        '{"drinks":{"score_0_to_100":99,"inappropriate_for":false,"reasoning":"old","evaluated_at":"2026-06-01T00:00:00Z","prompt_version":"v4","model":"m"}}'::jsonb),
      ('${CONTROL}', 'gp-e2e-control', 'Control', 10.01, 10.01, array['bar'], 'bar', true, true, '${CITY}', array['https://x.test/1.jpg'], 'nearby_search', 4.6, 240, 'https://x.test', null);
    insert into public.place_scores (place_id, signal_id, score, contributions, signal_version_id, scored_at)
      values ('${LIVE}', '${SIGNAL}', 41, '{}'::jsonb, '42764000-0000-4000-9000-000000000001', now()),
             ('${BACKLOG}', '${SIGNAL}', 42, '{}'::jsonb, '42764000-0000-4000-9000-000000000001', now());
  `);
  const liveBefore = await sql(`select is_servable, serving_hold, ai_signal_scores, name, website from public.place_pool where id = '${LIVE}'`);
  for (const s of ["google_places", "gemini"]) await health(s, "healthy");
  serperDown = true;
  await health("serper", "down", 400);

  // ── Cron with nothing started does nothing, whatever the time ──
  const idle = await cronMinute();
  assertEquals(idle, 0, "an idle cron posts nothing");
  assertEquals(calls.google_search, 0);

  // ── A person who isn't an admin can't start it, nor can the service key ──
  assertEquals((await callAdmin("start", { cityId: CITY, spendLimitUsd: 50 }, "user-token")).status, 403);
  assertEquals((await callAdmin("start", { cityId: CITY, spendLimitUsd: 50 }, "nonsense")).status, 401);
  assertEquals((await callAdmin("start", { cityId: CITY, spendLimitUsd: 50 }, SERVICE_KEY)).status, 401);

  // ── Serper's state shows before any spend ──
  const preview = await callAdmin("preview", { cityId: CITY });
  assertEquals(preview.status, 200, JSON.stringify(preview.body));
  assertEquals(preview.body.unhealthy.intelligence[0].provider, "serper");
  assertEquals(calls.google_search, 0, "a preview spends nothing");

  const started = await callAdmin("start", { cityId: CITY, spendLimitUsd: 0.05 });
  assertEquals(started.status, 200, JSON.stringify(started.body));
  const id = started.body.runId;

  // ── The limit stops it before the first search, and raising it is a person's choice ──
  let row = await runUntil(id, (r) => r.status === "paused", "spend limit");
  assertEquals(row.pause_reason, "spend_limit", JSON.stringify(row.pause_detail));
  assertEquals(calls.google_search, 0, "nothing spent past the limit");
  assertEquals((await callAdmin("resume", { runId: id, spendLimitUsd: 50 })).status, 200);

  // ── The first split level stops and asks, with real numbers ──
  row = await runUntil(id, (r) => r.status === "awaiting_approval", "first approval");
  assertEquals(row.current_stage, "split");
  assertEquals(row.pause_reason, "split_sample");
  assert(Number(row.pause_detail.numbers.searches) > 0, "the approval carries real numbers");
  const searchesBefore = calls.google_search;
  assert(searchesBefore > 0, "the base searches ran");
  await cronMinute();
  await cronMinute();
  assertEquals(calls.google_search, searchesBefore, "nothing is spent while waiting");

  // ── A stale approval can't start a different plan ──
  assertEquals((await callAdmin("approve", { runId: id, key: "split:9:9" })).status, 409);

  // ── Mid-level, a second worker dies holding a search, and a person pauses ──
  let stale = "";
  let pauseStatus = 0;
  onNextSearch = async () => {
    stale = await sql(`
      update public.seeding_batches b set status = 'running', started_at = now() - interval '10 minutes', claim_token = gen_random_uuid()
       where id = (select id from public.seeding_batches where run_id = (select (cursor ->> 'seeding_run_id')::uuid from public.city_pipeline_stages where run_id = '${id}' and stage = 'split') and status = 'pending' order by batch_index limit 1)
       returning id`);
    pauseStatus = (await callAdmin("pause", { runId: id })).status;
  };
  assertEquals((await callAdmin("approve", { runId: id, key: row.pause_detail.key })).status, 200);
  await cronMinute();
  assertEquals(pauseStatus, 200, "the pause during a tick is accepted");
  assert(stale, "a search was left for the dead worker to hold");
  assertEquals((await runRow(id)).status, "paused");
  const pausedSearches = calls.google_search;
  await cronMinute();
  await cronMinute();
  assertEquals(calls.google_search, pausedSearches, "a paused run spends nothing");
  assertEquals((await callAdmin("resume", { runId: id })).status, 200);

  // Later split levels ask too.
  for (let i = 0; i < 6; i++) {
    // Reaching the Intelligence stage isn't the end of this loop: under load a tick can
    // run out of time right after moving into it, so wait for the gate's decision.
    row = await runUntil(id, (r) => r.status === "awaiting_approval" || r.status === "paused", "split levels");
    if (row.status !== "awaiting_approval") break;
    assertEquals((await callAdmin("approve", { runId: id, key: row.pause_detail.key })).status, 200);
  }

  const reclaimed = JSON.parse(await sql(`select to_jsonb(b) from public.seeding_batches b where id = '${stale}'`));
  assertEquals(reclaimed.status, "completed", "the dead worker's search was reclaimed");
  assertEquals(reclaimed.reclaim_count, 1);

  // ── Searching counts what it did, once ──
  const counts = await sql(`select count(*) filter (where b.status <> 'completed'), count(*) filter (where b.status = 'completed') from public.seeding_batches b where b.city_id = '${CITY}'`);
  // The search Google failed stays failed on its level, and a later round ran it again.
  const failedOnce = await sql(`select count(*) from public.seeding_batches b where b.city_id = '${CITY}' and b.status <> 'completed' and b.error_message like 'Google API 500%'`);
  assertEquals(counts.split("|")[0], failedOnce, "nothing unfinished except that one record");
  assertEquals(failedOnce, "1");

  // ── Serper is out of credits: the run stops before sending Serper one request ──
  assertEquals(row.status, "paused", `expected the provider pause, got ${row.status} at ${row.current_stage}: ${row.last_error}`);
  assertEquals(row.pause_reason, "provider_unhealthy", JSON.stringify(row.pause_detail));
  assertEquals(row.pause_detail.providers[0].provider, "serper");
  assertEquals(calls.serper, 0, "no paid call to a provider we knew was down");
  assertEquals(calls.gemini, 0);

  // ── Nothing new has reached a serving path ──
  const heldCount = Number(await sql(`select count(*) from public.place_pool where city_id = '${CITY}' and serving_hold and held_final_check_passed`));
  assert(heldCount > 0, "places passed the final check and wait");
  assertEquals(
    await sql(`select count(*) from public.place_pool where city_id = '${CITY}' and serving_hold and is_servable is true`),
    "0",
  );
  assertEquals(
    await sql(`select count(*) from public.place_pool where city_id = '${CITY}' and serving_hold and is_servable is true`),
    "0",
  );
  const rejectedNoWebsite = await sql(`select count(*) from public.place_pool where city_id = '${CITY}' and serving_hold and held_final_check_passed is false and pre_photo_bouncer_reason like '%no_website%'`);
  assert(Number(rejectedNoWebsite) > 0, "the no-website rule still rejects");

  // ── The provider recovers; a person resumes ──
  serperDown = false;
  await health("serper", "healthy");
  assertEquals((await callAdmin("resume", { runId: id })).status, 200);
  row = await runUntil(id, (r) => r.status === "complete", "to the end", 800);

  assert(calls.serper > 0 && calls.gemini > 0, "Intelligence ran");
  assertEquals(calls.unknown, [], "nothing tried to leave");

  // ── Final scores: real AI, not rules, and now serving ──
  const released = JSON.parse(await sql(`
    select to_jsonb(x) from (
      select p.id, p.is_servable, p.serving_hold, s.score, s.ai_signal_scores_at
      from public.place_pool p join public.place_scores s on s.place_id = p.id and s.signal_id = '${SIGNAL}'
      where p.city_id = '${CITY}' and p.fetched_via = 'nearby_search' and p.id not in ('${LIVE}', '${BACKLOG}', '${CONTROL}')
      order by p.id limit 1
    ) x`));
  assertEquals(released.is_servable, true);
  assertEquals(released.serving_hold, false);
  assert(released.ai_signal_scores_at, "the final score used the AI result");

  // The twin with no AI, scored by the same scorer, must differ: the AI moved the score.
  const twin = await handlers.get("run-signal-scorer")!(new Request(`${FUNCTIONS_URL}/x`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ signal_id: SIGNAL, place_ids: [CONTROL] }),
  }));
  assertEquals(twin.status, 200);
  const twinScore = Number(await sql(`select score from public.place_scores where place_id = '${CONTROL}' and signal_id = '${SIGNAL}'`));
  assert(Number(released.score) !== twinScore, `AI blended ${released.score} must differ from rules ${twinScore}`);

  const visible = await sql(`select count(*) from public.query_servable_places_by_signal('${SIGNAL}', 0, 10.01, 10.01, 50000, '{}', 500) q where q.place_id = '${released.id}'`);
  assertEquals(visible, "1", "a finished place serves");

  assertEquals(await sql(`select count(*) from public.place_pool where city_id = '${CITY}' and serving_hold`), "0", "nothing left held");

  // ── Live places and the S2 hold ──
  assertEquals(await sql(`select is_servable, serving_hold, ai_signal_scores, name, website from public.place_pool where id = '${LIVE}'`), liveBefore);
  assertEquals(await sql(`select score from public.place_scores where place_id = '${LIVE}' and signal_id = '${SIGNAL}'`), "41", "a live place's score is untouched");
  assertEquals(await sql(`select score from public.place_scores where place_id = '${BACKLOG}' and signal_id = '${SIGNAL}'`), "42", "the held backlog stays held");
  assertEquals(await sql(`select count(*) from public.pg_meta_orch_1009_sub_d_select_stale_pairs(500) where place_id = '${BACKLOG}'`), "0");

  // ── The ledger matches the records ──
  const ledger = row.result.spend;
  const googleSpent = Number(await sql(`select sum(total_cost_usd) from public.seeding_runs where city_id = '${CITY}'`));
  const googleRow = ledger.rows.filter((r: Record<string, unknown>) => r.provider === "google" && (r.stage === "fill" || r.stage === "split"))
    .reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.actual_usd), 0);
  assert(Math.abs(googleSpent - googleRow) < 0.001, `ledger ${googleRow} vs records ${googleSpent}`);
  assert(Number(ledger.serper_requests) > 0);
  assertEquals(ledger.serper_cost_known, false, "no invented Serper rate");
  assert(row.result.search.checks.noUnfinishedSearch === true, JSON.stringify(row.result.search));
  assert(row.result.search.checks.completenessCheckOnRecord === true);
  console.log(`  ok: searches=${calls.google_search} media=${calls.google_media} serper=${calls.serper} gemini=${calls.gemini} ledger=$${ledger.known_actual_usd} places released=${heldCount}`);
} });
