// #4452 rework 1: forms-submit never crashes on malformed input (P0-4), and the track
// action obeys the kill switch and a per-IP limit (P2-11).
//
// RW-1 fuzzes every top-level field and every answer value with wrong JSON types.
//      Every response is a 4xx in the spec's shape ({error: string}), carries the CORS
//      header, and nothing malformed reaches forms_submit_core.
// RW-2 a database failure we did not foresee is a 500 {error:"server"} WITH CORS,
//      never a thrown handler (a bare 500 with no CORS header).
// RW-3 FORMS_KILL_SWITCH=1 stops track: 503 paused and no funnel row.
// RW-4 track is limited per salted IP: the 61st event in a minute is 429 and not written;
//      another IP is unaffected.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hostFakeDb } from "../_shared/__tests__/hostFunnelFakeDb.issue4238.ts";
import { CREATORS_DEF } from "../_shared/__tests__/issue_4452_forms_contract_vectors.ts";
import { handleFormsRequest, MIN_FILL_MS, resetTrackLimiter, type SubmitDb, TRACK_PER_IP_MINUTE } from "./submit.ts";

const FORM = "4452f000-0000-4000-8000-0000000000ad";
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
const req = (b: unknown, ip = "198.51.100.9") =>
  new Request("https://fn/forms-submit", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof b === "string" ? b : JSON.stringify(b),
  });

const WRONG: unknown[] = [null, true, 0, -1, 1e308, "", "x", "x".repeat(5000), [], [1, 2], {}, { a: { b: [null] } }];

async function expectShaped(res: Response, label: string): Promise<number> {
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGIN, `CORS on ${label}`);
  const body = await res.json();
  assert(res.status < 500, `${label} -> ${res.status} ${JSON.stringify(body)}`);
  if (res.status >= 400) assertEquals(typeof body.error, "string", `${label} has the {error} shape`);
  return res.status;
}

Deno.test("RW-1 every malformed field and answer shape is a 4xx with CORS, never a crash", async () => {
  const m = makeDb();
  const env = () => undefined;
  let cases = 0;
  for (const k of ["action", "idempotency_key", "form_id", "answers", "placement", "page_url", "time_zone", "hp", "t_open_ms", "ad", "utm", "referrer", "spot_key", "block_id"]) {
    for (const v of WRONG) {
      const b = { ...goodBody(), [k]: v };
      await expectShaped(await handleFormsRequest(req(b), { db: m.db, env, fire: {}, log: () => {} }), `${k}=${JSON.stringify(v)?.slice(0, 30)}`);
      cases++;
    }
  }
  for (const k of Object.keys(goodAnswers())) {
    for (const v of WRONG) {
      const b = { ...goodBody(), answers: { ...goodAnswers(), [k]: v } };
      await expectShaped(await handleFormsRequest(req(b), { db: m.db, env, fire: {}, log: () => {} }), `answers.${k}=${JSON.stringify(v)?.slice(0, 30)}`);
      cases++;
    }
  }
  for (const raw of ["[]", "null", "42", '"s"', "{", "{\"action\":\"submit\",\"answers\":null}", "\u0000", ""]) {
    const s = await expectShaped(await handleFormsRequest(req(raw), { db: m.db, env, fire: {}, log: () => {} }), `raw ${raw}`);
    assertEquals(s, 400, `raw ${raw}`);
    cases++;
  }
  // Answers that are not a plain object are refused before validation, every time.
  for (const answers of [null, [], "ada@example.org", 42, true]) {
    const res = await handleFormsRequest(req({ ...goodBody(), answers }), { db: m.db, env, fire: {}, log: () => {} });
    assertEquals(res.status, 400, `answers ${JSON.stringify(answers)}`);
    assertEquals((await res.json()).error, "validation");
  }
  assert(cases > 200, `fuzzed ${cases} shapes`);
  for (const c of m.cores) {
    const p = c as Record<string, unknown>;
    assert(p.answers && typeof p.answers === "object" && !Array.isArray(p.answers), "only object answers reach the core");
  }
});

Deno.test("RW-2 an unforeseen failure is a 500 {error:'server'} with CORS", async () => {
  const m = makeDb({ loadForm: () => Promise.reject(new Error("form_read_failed")) });
  const res = await handleFormsRequest(req(goodBody()), { db: m.db, env: () => undefined, fire: {}, log: () => {} });
  assertEquals(res.status, 500);
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGIN);
  assertEquals(await res.json(), { error: "server" });
});

const track = (over: Record<string, unknown> = {}) => ({
  action: "track", event: "form_viewed", form_id: FORM, visit_id: crypto.randomUUID(), placement: "inline", ...over,
});

Deno.test("RW-3 the kill switch stops track too", async () => {
  resetTrackLimiter();
  const m = makeDb();
  const res = await handleFormsRequest(req(track()), { db: m.db, env: (n) => (n === "FORMS_KILL_SWITCH" ? "1" : undefined), fire: {}, log: () => {} });
  assertEquals(res.status, 503);
  assertEquals((await res.json()).error, "paused");
  assertEquals(m.tracked.length, 0);
});

Deno.test("RW-4 track is rate limited per IP; another IP is unaffected", async () => {
  resetTrackLimiter();
  const m = makeDb();
  const t0 = 1_800_000_000_000;
  const deps = { db: m.db, env: () => undefined, fire: {}, log: () => {}, now: () => t0 };
  for (let i = 0; i < TRACK_PER_IP_MINUTE; i++) assertEquals((await handleFormsRequest(req(track(), "203.0.113.7"), deps)).status, 200);
  const over = await handleFormsRequest(req(track(), "203.0.113.7"), deps);
  assertEquals(over.status, 429);
  assertEquals((await over.json()).error, "rate_limited");
  assertEquals(m.tracked.length, TRACK_PER_IP_MINUTE, "the limited event is not written");
  assertEquals((await handleFormsRequest(req(track(), "203.0.113.8"), deps)).status, 200);
  // A minute later the window has moved.
  const later = { ...deps, now: () => t0 + 61_000 };
  assertEquals((await handleFormsRequest(req(track(), "203.0.113.7"), later)).status, 200);
  resetTrackLimiter();
});
