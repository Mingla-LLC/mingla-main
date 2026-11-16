// #4452 retest 1 (tester, adversarial): forms-submit after rework cb4ffb0446.
//
// Different angle from the implementor's RW-1..RW-4 (one wrong value per known field):
// - ADV-F1 seeded random STRUCTURAL fuzz: 600 whole bodies and answer objects built from
//   random nested JSON (prototype keys, unicode, deep nesting, huge numbers, mixed
//   arrays), sent as submit AND track. Every reply is < 500, carries CORS, and has the
//   {error} shape when it is a 4xx. Nothing malformed reaches forms_submit_core.
// - ADV-F2 prototype keys inside answers (`__proto__`, `constructor`, `toString`) never
//   crash the validator or leak onto Object.prototype.
// - ADV-F3 the CORS-safe net: when the database throws an unforeseen error on submit,
//   the reply is 500 {error:"server"} with CORS and NO internal message in the body.
// - ADV-F4 the kill switch stops submit and track alike (503, nothing written), and a
//   disallowed origin is refused before anything is read.
// - ADV-F5 the track limiter keys on the first forwarded hop: 60 pass, the 61st is 429,
//   the window frees after a minute; a track write failure never fails the page.
//
// Fails on revert: deleting the answers-shape guard (`!body.answers || typeof
// body.answers !== "object" || Array.isArray(body.answers)`) makes ADV-F1 see a 500
// for answers = null; deleting the kill-switch move above the track branch makes ADV-F4
// see a 200 for track.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hostFakeDb } from "../_shared/__tests__/hostFunnelFakeDb.issue4238.ts";
import { CREATORS_DEF } from "../_shared/__tests__/issue_4452_forms_contract_vectors.ts";
import { handleFormsRequest, MIN_FILL_MS, resetTrackLimiter, type SubmitDb, TRACK_PER_IP_MINUTE } from "./submit.ts";

const FORM = "4452f000-0000-4000-8000-0000000000af";
const ORIGIN = "https://usemingla.com";

function makeDb(over: Partial<SubmitDb> = {}) {
  const cores: unknown[] = [];
  const tracked: unknown[] = [];
  const ad = hostFakeDb({ ad_attribution_touches: [], ad_connections: [], form_submissions: [] });
  const db: SubmitDb = {
    adClient: ad.client,
    loadForm: () => Promise.resolve({ id: FORM, key: "creators-join", audience: "creator", status: "live", template: "creators", version: 1, definition: CREATORS_DEF }),
    countAttempts: () => Promise.resolve({ form10m: 0, ip24h: 0 }),
    recordAttempt: () => Promise.resolve(),
    submitCore: (p) => {
      cores.push(p);
      return Promise.resolve({ replay: false, deduped: false, submission_id: crypto.randomUUID(), lead_on: false, run_id: null });
    },
    setLeadEvent: () => Promise.resolve(),
    trackEvent: (p) => {
      tracked.push(p);
      return Promise.resolve();
    },
    ...over,
  };
  return { db, cores, tracked };
}

const goodAnswers = (): Record<string, unknown> => ({
  name: "Ada Okafor", email: "ada@example.org", phone: { country: "NG", dial: "+234", number: "801 234 5678" },
  what_do_you_make: "Photo", your_main_social: { platform: "instagram", value: "@ada" }, city: { label: "Lagos, Nigeria" }, consent: true,
});
const goodBody = (): Record<string, unknown> => ({
  action: "submit", idempotency_key: crypto.randomUUID(), form_id: FORM, answers: goodAnswers(), placement: "inline",
  page_url: "https://usemingla.com/creators", time_zone: "Africa/Lagos", hp: "", t_open_ms: MIN_FILL_MS + 4000,
});
const trackBody = (): Record<string, unknown> => ({
  action: "track", event: "form_viewed", form_id: FORM, visit_id: crypto.randomUUID(), placement: "inline",
  page_url: "https://usemingla.com/creators",
});
const req = (b: unknown, ip = "198.51.100.77", origin = ORIGIN) =>
  new Request("https://fn/forms-submit", {
    method: "POST",
    headers: { origin, "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof b === "string" ? b : JSON.stringify(b),
  });

// Mulberry32: a deterministic PRNG so a failure is reproducible from the seed.
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const KEYS = ["__proto__", "constructor", "toString", "name", "email", "phone", "answers", "form_id", "action", "é😀", "", "0", "a".repeat(300)];
function randomJson(r: () => number, depth: number): unknown {
  const pick = Math.floor(r() * (depth > 6 ? 7 : 10));
  switch (pick) {
    case 0: return null;
    case 1: return r() > 0.5;
    case 2: return [0, -0, 1e308, -1e308, 2 ** 53 + 1, 0.1, NaN][Math.floor(r() * 7)];
    case 3: return ["", "x", "ada@example.org", "😀".repeat(50), "\u0000", "<script>", "x".repeat(4000)][Math.floor(r() * 7)];
    case 4: return crypto.randomUUID();
    case 5: return "submit";
    case 6: return "track";
    case 7: return Array.from({ length: Math.floor(r() * 4) }, () => randomJson(r, depth + 1));
    default: {
      const o: Record<string, unknown> = {};
      for (let i = 0; i < Math.floor(r() * 5); i++) o[KEYS[Math.floor(r() * KEYS.length)]] = randomJson(r, depth + 1);
      return o;
    }
  }
}

async function expectShaped(res: Response, label: string): Promise<number> {
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGIN, `CORS on ${label}`);
  const text = await res.text();
  assert(res.status < 500, `${label} -> ${res.status} ${text.slice(0, 200)}`);
  if (res.status >= 400) assertEquals(typeof JSON.parse(text).error, "string", `${label} has the {error} shape`);
  return res.status;
}

Deno.test("ADV-F1 seeded structural fuzz: whole bodies and answers, submit and track, never a 5xx", async () => {
  resetTrackLimiter();
  const r = prng(4452);
  const m = makeDb();
  let n = 0;
  for (let i = 0; i < 200; i++) {
    // A whole random body (any top-level shape, including arrays and scalars).
    const whole = JSON.stringify(randomJson(r, 0));
    await expectShaped(await handleFormsRequest(req(whole, `203.0.113.${i % 250}`), { db: m.db, env: () => undefined, fire: {}, log: () => {} }), `whole#${i} ${whole.slice(0, 60)}`);
    // A valid envelope with random answers.
    const sub = { ...goodBody(), answers: randomJson(r, 1) };
    await expectShaped(await handleFormsRequest(req(sub, `203.0.113.${i % 250}`), { db: m.db, env: () => undefined, fire: {}, log: () => {} }), `answers#${i}`);
    // A track envelope with random extra fields over the real ones.
    const tr = { ...trackBody(), ...(randomJson(r, 1) as Record<string, unknown> ?? {}), action: "track" };
    await expectShaped(await handleFormsRequest(req(tr, `192.0.2.${i % 250}`), { db: m.db, env: () => undefined, fire: {}, log: () => {} }), `track#${i}`);
    n += 3;
  }
  assertEquals(n, 600);
  for (const p of m.cores as Array<Record<string, unknown>>) {
    assert(p.answers && typeof p.answers === "object" && !Array.isArray(p.answers), "only object answers reach the core");
  }
});

Deno.test("ADV-F2 prototype keys in answers never crash or pollute", async () => {
  const m = makeDb();
  for (const raw of [
    `{"__proto__":{"polluted":true},"name":"Ada Okafor","email":"ada@example.org"}`,
    `{"constructor":{"prototype":{"polluted":true}},"email":"x"}`,
    `{"toString":"nope","hasOwnProperty":1,"email":"ada@example.org"}`,
  ]) {
    const body = `{"action":"submit","idempotency_key":"${crypto.randomUUID()}","form_id":"${FORM}","answers":${raw},"placement":"inline","page_url":"https://usemingla.com/creators","time_zone":"Africa/Lagos","hp":"","t_open_ms":${MIN_FILL_MS + 4000}}`;
    await expectShaped(await handleFormsRequest(req(body), { db: m.db, env: () => undefined, fire: {}, log: () => {} }), raw.slice(0, 40));
  }
  assertEquals(({} as Record<string, unknown>).polluted, undefined, "Object.prototype untouched");
});

Deno.test("ADV-F3 an unforeseen database error is 500 {error:server} with CORS and no internal detail", async () => {
  const secret = "relation public.form_submissions_secret_internal does not exist";
  const m = makeDb({ submitCore: () => Promise.reject(new TypeError(secret)) });
  const logs: string[] = [];
  const res = await handleFormsRequest(req(goodBody()), { db: m.db, env: () => undefined, fire: {}, log: (l) => logs.push(l) });
  assertEquals(res.status, 500);
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGIN);
  const text = await res.text();
  assertEquals(JSON.parse(text).error, "server");
  assert(!text.includes("form_submissions_secret_internal"), "no internal message in the reply");
});

Deno.test("ADV-F4 the kill switch stops submit and track; a foreign origin is refused first", async () => {
  resetTrackLimiter();
  const m = makeDb();
  const env = (k: string) => (k === "FORMS_KILL_SWITCH" ? "1" : undefined);
  for (const b of [goodBody(), trackBody()]) {
    const res = await handleFormsRequest(req(b), { db: m.db, env, fire: {}, log: () => {} });
    assertEquals(res.status, 503, `kill switch on ${b.action}`);
    assertEquals((await res.json()).error, "paused");
  }
  assertEquals(m.cores.length + m.tracked.length, 0, "nothing written while paused");
  const foreign = await handleFormsRequest(req(trackBody(), "198.51.100.1", "https://evil.example"), { db: m.db, env: () => undefined, fire: {}, log: () => {} });
  assertEquals(foreign.status, 403);
  assertEquals(foreign.headers.get("access-control-allow-origin"), null);
  assertEquals(m.tracked.length, 0);
});

Deno.test("ADV-F5 track: 60 a minute per first hop, the window frees, write failures never fail the page", async () => {
  resetTrackLimiter();
  let clock = 1_800_000_000_000;
  const m = makeDb();
  const deps = { db: m.db, env: () => undefined, fire: {}, log: () => {}, now: () => clock };
  // The first hop is the key: the same client behind different proxies is one bucket.
  for (let i = 0; i < TRACK_PER_IP_MINUTE; i++) {
    const res = await handleFormsRequest(req(trackBody(), `198.51.100.200, 10.0.0.${i % 9}`), deps);
    assert(res.status < 300, `event ${i + 1} -> ${res.status}`);
    await res.body?.cancel();
  }
  const over = await handleFormsRequest(req(trackBody(), "198.51.100.200"), deps);
  assertEquals(over.status, 429);
  assertEquals(over.headers.get("access-control-allow-origin"), ORIGIN);
  assertEquals(m.tracked.length, TRACK_PER_IP_MINUTE, "the 61st is not written");
  clock += 61_000;
  const later = await handleFormsRequest(req(trackBody(), "198.51.100.200"), deps);
  assert(later.status < 300, `after the window -> ${later.status}`);
  await later.body?.cancel();
  // A failing track write is swallowed for the page (analytics never fails the visit).
  const broken = makeDb({ trackEvent: () => Promise.reject(new Error("db down")) });
  const res = await handleFormsRequest(req(trackBody(), "198.51.100.201"), { ...deps, db: broken.db });
  assert(res.status < 300, `broken track write -> ${res.status}`);
  await res.body?.cancel();
});
