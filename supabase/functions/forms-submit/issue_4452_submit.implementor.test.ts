// #4452 forms-submit (T-3.1–3.14; SC-26–40). Hermetic: the real handler and the
// MINGLA-INVARIANT: I-4452-CONSENT-ONLY-TRUE | issue #4452 | marketing_consent is true only for a JSON boolean true; a string 'true' or a missing box is false (T-3.10).
// real shared contract over an in-memory SubmitDb; the Lead goes through the real
// recordLabelledLead into the in-memory ad tables with captured senders.
// MINGLA-INVARIANT: I-4452-TEST-LEADS-NEVER-SENT | issue #4452 | a lead whose email or name public.inbound_lead_is_test marks as test or internal stores no match context, fires no ad conversion and answers lead_event_id null (forms-submit, growth-tools-gate, growth-tools-book); the check fails closed.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { ConversionSendInput, SenderResult } from "../_shared/adConversionFire.ts";
import { hostFakeDb, type HostFakeDbOptions } from "../_shared/__tests__/hostFunnelFakeDb.issue4238.ts";
import { CREATORS_DEF } from "../_shared/__tests__/issue_4452_forms_contract_vectors.ts";
import { handleFormsRequest, type LiveForm, MIN_FILL_MS, type SubmitDb } from "./submit.ts";

const FORM = "4452f000-0000-4000-8000-000000000001";
const ORIGIN = "https://usemingla.com";

function makeDb(form: Partial<LiveForm> = {}, adOptions: HostFakeDbOptions = {}) {
  const attempts: Array<{ outcome: string; formId: string | null }> = [];
  const cores: Array<Record<string, unknown>> = [];
  const leadEvents: Record<string, string> = {};
  const ad = hostFakeDb({ ad_attribution_touches: [], ad_connections: [], form_submissions: [] }, adOptions);
  let core: (p: Record<string, unknown>) => Record<string, unknown> = (p) => ({
    replay: false, deduped: false, submission_id: "4452s000-0000-4000-8000-00000000000" + cores.length,
    lead_on: true, goal: "call_booked", run_id: null, form_key: "creators-join", p,
  });
  const db: SubmitDb = {
    adClient: ad.client,
    loadForm: () => Promise.resolve({
      id: FORM, key: "creators-join", audience: "creator", status: "live", template: "creators", version: 3,
      definition: CREATORS_DEF, ...form,
    }),
    countAttempts: () => Promise.resolve({
      form10m: attempts.filter((a) => ["accepted", "deduped"].includes(a.outcome)).length,
      ip24h: attempts.filter((a) => ["accepted", "deduped"].includes(a.outcome)).length,
    }),
    recordAttempt: (_h, formId, outcome) => {
      attempts.push({ outcome, formId });
      return Promise.resolve();
    },
    submitCore: (p) => {
      cores.push(p);
      return Promise.resolve(core(p));
    },
    setLeadEvent: (sub, id) => {
      leadEvents[sub] = id;
      return Promise.resolve();
    },
    trackEvent: () => Promise.resolve(),
  };
  return { db, attempts, cores, leadEvents, ad, setCore: (f: typeof core) => (core = f) };
}

const sent: ConversionSendInput[] = [];
const sender = (channel: SenderResult["channel"]) => (input: ConversionSendInput): Promise<SenderResult> => {
  sent.push(input);
  return Promise.resolve({ channel, status: "sent" });
};
const fire = { senders: { meta: sender("meta"), tiktok: sender("tiktok"), snap: sender("snap"), reddit: sender("reddit"), google: sender("google") } };

function answers(over: Record<string, unknown> = {}) {
  return {
    name: "Ada Okafor", email: "ada@example.org",
    phone: { country: "NG", dial: "+234", number: "801 234 5678" }, what_do_you_make: "Photo",
    your_main_social: { platform: "instagram", value: "@ada.films" }, city: { label: "Lagos, Nigeria", country: "NG" },
    consent: true, ...over,
  };
}

function body(over: Record<string, unknown> = {}) {
  return {
    action: "submit", idempotency_key: crypto.randomUUID(), form_id: FORM, form_version: 3, answers: answers(),
    placement: "inline", spot_key: "after-steps", page_url: "https://usemingla.com/creators?utm_source=meta",
    utm: { source: "meta", campaign: "creators-lagos-nov" }, time_zone: "Africa/Lagos",
    ad: { fbc: "fb.1.1.X", tracking_opt_out: false, page_url: "https://usemingla.com/creators" },
    hp: "", t_open_ms: MIN_FILL_MS + 5000, ...over,
  };
}

function post(b: unknown, origin = ORIGIN, extra: Record<string, string> = {}) {
  return new Request("https://fn/forms-submit", {
    method: "POST",
    headers: { origin, "content-type": "application/json", "x-forwarded-for": "198.51.100.4, 10.0.0.1", ...extra },
    body: typeof b === "string" ? b : JSON.stringify(b),
  });
}

function deps(db: SubmitDb, env: Record<string, string> = {}, logs: string[] = []) {
  return { db, env: (n: string) => env[n], fire, log: (l: string) => logs.push(l) };
}

Deno.test("T-3.1 SC-26 a valid submit returns 200 with a submission id; the core runs once", async () => {
  const m = makeDb();
  const res = await handleFormsRequest(post(body()), deps(m.db));
  const out = await res.json();
  assertEquals(res.status, 200);
  assert(out.ok && typeof out.submission_id === "string");
  assertEquals(m.cores.length, 1);
  assertEquals(out.goal, "call_booked");
});

Deno.test("T-3.10 SC-36 consent is true only for a JSON true; a string 'true' or a missing box is false", async () => {
  for (const [value, want] of [[true, true], ["true", false], [undefined, false]] as const) {
    const m = makeDb();
    await handleFormsRequest(post(body({ answers: answers({ consent: value }) })), deps(m.db));
    assertEquals(m.cores[0].consent, want, `consent ${String(value)}`);
    if (want) assertEquals(m.cores[0].consent_text, CREATORS_DEF.fields.find((f) => f.type === "consent")?.label);
    else assertEquals(m.cores[0].consent_text, null);
  }
});

Deno.test("T-3.2 SC-27 a replayed key returns the stored submission and fires nothing new", async () => {
  const m = makeDb();
  m.setCore(() => ({ replay: true, deduped: false, submission_id: "4452s000-0000-4000-8000-0000000000aa", lead_event_id: "creator_lead:form:x" }));
  const before = sent.length;
  const res = await handleFormsRequest(post(body()), deps(m.db));
  const out = await res.json();
  assertEquals(out.submission_id, "4452s000-0000-4000-8000-0000000000aa");
  assertEquals(out.lead_event_id, "creator_lead:form:x");
  assertEquals(sent.length, before, "no second Lead");
});

Deno.test("T-3.3 SC-28 a deduped resubmit fires no second Lead", async () => {
  const m = makeDb();
  m.setCore(() => ({ replay: false, deduped: true, submission_id: "4452s000-0000-4000-8000-0000000000bb", lead_event_id: "creator_lead:form:bb", lead_on: true }));
  const before = sent.length;
  const out = await (await handleFormsRequest(post(body()), deps(m.db))).json();
  assertEquals(out.deduped, true);
  assertEquals(out.lead_event_id, "creator_lead:form:bb");
  assertEquals(sent.length, before);
  assertEquals(m.attempts.at(-1)?.outcome, "deduped");
});

Deno.test("T-4.1 a new creator submission fires creator_lead:form:<id> and stores it", async () => {
  const m = makeDb();
  const out = await (await handleFormsRequest(post(body()), deps(m.db))).json();
  assertEquals(out.lead_event_id, `creator_lead:form:${out.submission_id}`);
  assertEquals(m.leadEvents[out.submission_id], out.lead_event_id);
  assertEquals(m.ad.row("ad_conversions", (r) => r.event_id === out.lead_event_id)?.lead_label, "creator");
});

Deno.test("T-3.4 SC-30 a filled honeypot or a too-fast fill: 200, nothing saved, no Lead", async () => {
  for (const over of [{ hp: "bot@x.com" }, { t_open_ms: 300 }, { t_open_ms: -5 }, { t_open_ms: "9999" }]) {
    const m = makeDb();
    const before = sent.length;
    const res = await handleFormsRequest(post(body(over)), deps(m.db));
    const out = await res.json();
    assertEquals(res.status, 200);
    assertEquals(out.ok, true);
    assertEquals(m.cores.length, 0, JSON.stringify(over));
    assertEquals(sent.length, before);
    assertEquals(m.attempts.map((a) => a.outcome), ["bot"]);
  }
});

Deno.test("T-3.5 SC-31 the 6th accepted submit in 10 minutes from one IP is 429", async () => {
  const m = makeDb();
  for (let i = 0; i < 5; i++) assertEquals((await handleFormsRequest(post(body()), deps(m.db))).status, 200);
  const res = await handleFormsRequest(post(body()), deps(m.db));
  assertEquals(res.status, 429);
  assertEquals((await res.json()).error, "rate_limited");
});

Deno.test("T-3.6 SC-32 a foreign origin gets 403 and no ACAO; usemingla.com is echoed", async () => {
  const m = makeDb();
  const bad = await handleFormsRequest(post(body(), "https://evil.example"), deps(m.db));
  assertEquals(bad.status, 403);
  assertEquals(bad.headers.get("access-control-allow-origin"), null);
  assertEquals(m.cores.length, 0);
  const good = await handleFormsRequest(post(body()), deps(m.db));
  assertEquals(good.headers.get("access-control-allow-origin"), ORIGIN);
  const preview = await handleFormsRequest(post(body(), "https://mingla-marketing-abc123-mingla.vercel.app"), deps(m.db));
  assertEquals(preview.headers.get("access-control-allow-origin"), "https://mingla-marketing-abc123-mingla.vercel.app");
  const opt = await handleFormsRequest(new Request("https://fn/", { method: "OPTIONS", headers: { origin: ORIGIN } }), deps(m.db));
  assertEquals(opt.status, 200);
});

Deno.test("T-3.7 SC-33 an archived form is 410 form_closed", async () => {
  const m = makeDb({ status: "archived" });
  const res = await handleFormsRequest(post(body()), deps(m.db));
  assertEquals(res.status, 410);
  assertEquals((await res.json()).error, "form_closed");
});

Deno.test("T-3.8 SC-34 an answer key unknown to the live version is 409 form_changed", async () => {
  const m = makeDb();
  const res = await handleFormsRequest(post(body({ answers: answers({ old_field: "x" }) })), deps(m.db));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, "form_changed");
  assertEquals(m.cores.length, 0);
});

Deno.test("T-3.9 SC-35 a typo domain is refused server side with code typo and the page's message", async () => {
  const m = makeDb();
  const res = await handleFormsRequest(post(body({ answers: answers({ email: "ada@gmial.com" }) })), deps(m.db));
  assertEquals(res.status, 400);
  const out = await res.json();
  assertEquals(out.fields, [{ key: "email", code: "typo", message: "Did you mean gmail.com?", suggestion: "ada@gmail.com" }]);
});

Deno.test("T-3.13 SC-39 logs never contain an @", async () => {
  const logs: string[] = [];
  const m = makeDb();
  await handleFormsRequest(post(body()), deps(m.db, {}, logs));
  await handleFormsRequest(post(body({ hp: "x" })), deps(m.db, {}, logs));
  await handleFormsRequest(post(body({ answers: answers({ email: "ada@gmial.com" }) })), deps(m.db, {}, logs));
  assert(logs.length >= 2);
  assert(logs.every((l) => !l.includes("@")), logs.join("\n"));
});

Deno.test("T-3.14 SC-40 FORMS_KILL_SWITCH=1 returns 503 paused and writes nothing", async () => {
  const m = makeDb();
  const res = await handleFormsRequest(post(body()), deps(m.db, { FORMS_KILL_SWITCH: "1" }));
  assertEquals(res.status, 503);
  assertEquals((await res.json()).error, "paused");
  assertEquals(m.cores.length + m.attempts.length, 0);
});

Deno.test("§3.2 the Book-a-call extra questions never fire their own Lead", async () => {
  const m = makeDb();
  const before = sent.length;
  const out = await (await handleFormsRequest(post(body({ placement: "book_call_details" })), deps(m.db))).json();
  assertEquals(out.lead_event_id, null);
  assertEquals(sent.length, before);
});

Deno.test("§3.2 a page on a foreign host is dropped (page_path /); the first forwarded hop is the IP", async () => {
  const m = makeDb();
  await handleFormsRequest(post(body({ page_url: "https://evil.example/creators" })), deps(m.db));
  assertEquals(m.cores[0].page_path, "/");
});

Deno.test("§3.2 ads off: no click source, ads_allowed false, the server Lead row still exists", async () => {
  const m = makeDb();
  const out = await (await handleFormsRequest(post(body({ ad: { fbc: "fb.1.NOPE", tracking_opt_out: true } })), deps(m.db))).json();
  assertEquals(m.cores[0].ads_allowed, false);
  assertEquals(m.cores[0].click_source, null);
  assert(m.ad.row("ad_conversions", (r) => r.event_id === out.lead_event_id));
  assertEquals(m.ad.row("ad_match_contexts", (r) => r.subject_id === `form:${out.submission_id}`)?.fbc ?? null, null);
});

Deno.test("§3 a body over 32 KB is 400", async () => {
  const m = makeDb();
  const res = await handleFormsRequest(post(JSON.stringify(body({ answers: answers({ about: "x".repeat(33 * 1024) }) }))), deps(m.db));
  assertEquals(res.status, 400);
  assertEquals(m.cores.length, 0);
});

// #4452 B20: a test or internal person is never sent to an ad platform. The rule
// is public.inbound_lead_is_test (the fake stands in for it by email).
// FAILS-ON-REVERT: removing the leadIsTestOrInternal guard from recordLabelledLead
// (or the contact this handler passes) fails the first and third tests.
Deno.test("B20 an internal email sends no Lead: no context, no conversion, lead_event_id null", async () => {
  const m = makeDb({}, { testLeadEmails: ["ada@usemingla.com"] });
  const res = await handleFormsRequest(post(body({ answers: answers({ email: "ada@usemingla.com" }) })), deps(m.db));
  assertEquals(res.status, 200);
  const out = await res.json();
  assertEquals(out.lead_event_id, null, "a null id means the page fires no browser Lead");
  assertEquals(m.ad.tables.ad_conversions?.length ?? 0, 0);
  assertEquals(m.ad.tables.ad_match_contexts?.length ?? 0, 0);
  assertEquals(m.leadEvents[out.submission_id], undefined);
  assertEquals(m.ad.rpcCalls.filter((c) => c.name === "inbound_lead_is_test").map((c) => c.args),
    [{ p_email: "ada@usemingla.com", p_name: "Ada Okafor" }], "the SQL rule reads the submitted email and name");
});

Deno.test("B20 a normal email still sends its labelled Lead", async () => {
  const m = makeDb({}, { testLeadEmails: ["ada@usemingla.com"] });
  const out = await (await handleFormsRequest(post(body()), deps(m.db))).json();
  assertEquals(out.lead_event_id, `creator_lead:form:${out.submission_id}`);
  assert(m.ad.row("ad_conversions", (r) => r.event_id === out.lead_event_id));
});

Deno.test("B20 the test-lead check fails closed: when it cannot answer, nothing is sent", async () => {
  const m = makeDb({}, { testLeadCheckError: true });
  const out = await (await handleFormsRequest(post(body()), deps(m.db))).json();
  assertEquals(out.lead_event_id, null);
  assertEquals(m.ad.tables.ad_conversions?.length ?? 0, 0);
});

Deno.test("B20 a real visitor with ads off keeps today's opt-out-only server Lead", async () => {
  const m = makeDb({}, { testLeadEmails: ["ada@usemingla.com"] });
  const out = await (await handleFormsRequest(post(body({ ad: { tracking_opt_out: true } })), deps(m.db))).json();
  assertEquals(out.lead_event_id, `creator_lead:form:${out.submission_id}`);
  const ctx = m.ad.row("ad_match_contexts", (r) => r.subject_id === `form:${out.submission_id}`);
  assertEquals([ctx?.ad_tracking_opt_out, ctx?.fbc, ctx?.client_ip], [true, null, null]);
});
