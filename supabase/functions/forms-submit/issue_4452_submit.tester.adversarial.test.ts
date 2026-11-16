// #4452 tester (L3) adversarial suite: angles the implementor's submit, labels and
// schedule tests do not cover. Hermetic: the real handler, contract, catalogue,
// senders and schedule twin; no network.
//
// ADV-S1  malformed bodies (array, string, null answers, a NaN or string t_open_ms, a
//         whitespace honeypot) never reach the SQL core.
// ADV-S2  answers just under the 32 KB body cap but over the 16 KB answers cap are refused
//         after validation, before the core.
// ADV-S3  prototype-shaped answer keys (__proto__, constructor) are refused as unknown.
// ADV-S4  the analytics track action drops anything that looks like an email or a phone.
// ADV-S5  every lead/call event-id prefix is unique and never a prefix of another, and
//         build -> parse round-trips the kind and subject for every label and subject shape.
// ADV-S6  a retry rebuilt from the stored event id carries the same label fields.
// ADV-S7  Google: each new kind maps to its OWN conversion action, never host_lead or purchase.
// ADV-S8  booked-call payloads per platform: Meta/TikTok Schedule, Snap RESERVE, Reddit
//         CUSTOM CallBooked; TikTok never gets content_type for a lead or a call.
// ADV-S9  the TS schedule twin lands on the same instants as forms_next_local_time across
//         DST and odd-offset zones (the SQL suite pins the same vectors).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hostFakeDb } from "../_shared/__tests__/hostFunnelFakeDb.issue4238.ts";
import { CREATORS_DEF } from "../_shared/__tests__/issue_4452_forms_contract_vectors.ts";
import { type ConversionSendInput, labelFields } from "../_shared/adConversionFire.ts";
import {
  CALL_KIND_FOR_LABEL,
  HOST_FUNNEL_EVENT_ID_PREFIX,
  HOST_FUNNEL_EVENT_NAMES,
  HOST_FUNNEL_GOOGLE_KIND,
  HOST_FUNNEL_LABEL,
  LEAD_KIND_FOR_LABEL,
  type LeadLabel,
  parseHostFunnelEventId,
  type ServerHostFunnelKind,
} from "../_shared/adEventCatalog.ts";
import { nextLocalTime } from "../_shared/formsSchedule.ts";
import { GOOGLE_CONVERSION_KINDS } from "../_shared/googleConversionUpload.ts";
import { callBookedEventId, labelledLeadEventId } from "../_shared/hostFunnelConversion.ts";
import { sendMetaConversion } from "../_shared/metaCapi.ts";
import { buildRedditConversionBody } from "../_shared/redditCapi.ts";
import { sendSnapConversion } from "../_shared/snapCapi.ts";
import { sendTikTokConversion } from "../_shared/tiktokEvents.ts";
import { handleFormsRequest, MIN_FILL_MS, type SubmitDb } from "./submit.ts";

const FORM = "4452f000-0000-4000-8000-0000000000ad";
const ORIGIN = "https://usemingla.com";

function makeDb() {
  const cores: Array<Record<string, unknown>> = [];
  const tracked: Array<Record<string, unknown>> = [];
  const ad = hostFakeDb({ ad_attribution_touches: [], ad_connections: [], form_submissions: [] });
  const db: SubmitDb = {
    adClient: ad.client,
    loadForm: () => Promise.resolve({
      id: FORM, key: "creators-join", audience: "creator", status: "live", template: "creators", version: 1, definition: CREATORS_DEF,
    }),
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
  };
  return { db, cores, tracked };
}

const goodAnswers = () => ({
  name: "Ada Okafor", email: "ada@example.org", phone: { country: "NG", dial: "+234", number: "801 234 5678" },
  what_do_you_make: "Photo", your_main_social: { platform: "instagram", value: "@ada" }, city: { label: "Lagos, Nigeria" }, consent: true,
});
const body = (over: Record<string, unknown> = {}) => ({
  action: "submit", idempotency_key: crypto.randomUUID(), form_id: FORM, answers: goodAnswers(), placement: "inline",
  page_url: "https://usemingla.com/creators", time_zone: "Africa/Lagos", hp: "", t_open_ms: MIN_FILL_MS + 4000, ...over,
});
const post = (b: unknown) =>
  new Request("https://fn/forms-submit", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": "198.51.100.9" },
    body: typeof b === "string" ? b : JSON.stringify(b),
  });
const run = (db: SubmitDb, b: unknown) => handleFormsRequest(post(b), { db, env: () => undefined, fire: {}, log: () => {} });

Deno.test("ADV-S1 malformed bodies and bot traps never reach the core", async () => {
  const m = makeDb();
  for (const bad of ["[]", '"submit"', "null", "{"]) {
    assertEquals((await run(m.db, bad)).status, 400, `raw ${bad}`);
  }
  for (const answers of [null, [], "ada@example.org", 42]) {
    const res = await run(m.db, body({ answers }));
    assert(res.status >= 400, `answers ${JSON.stringify(answers)} -> ${res.status}`);
  }
  // Bots: a whitespace honeypot, a string or NaN fill time, a missing fill time. 200 with no core call.
  for (const over of [{ hp: " " }, { t_open_ms: "99999" }, { t_open_ms: null }, { t_open_ms: undefined }]) {
    const res = await run(m.db, body(over));
    assertEquals(res.status, 200, JSON.stringify(over));
    assertEquals((await res.json()).lead_event_id, null);
  }
  assertEquals(m.cores.length, 0, "no malformed or bot body reached forms_submit_core");
});

Deno.test("ADV-S2 answers over 16 KB inside a body under 32 KB are refused before the core", async () => {
  const m = makeDb();
  // Pad a free-text-like value the contract allows to grow: the name is capped, so pad the city label.
  const answers = { ...goodAnswers(), city: { label: "Lagos, Nigeria", note: "x".repeat(20_000) } };
  const raw = JSON.stringify(body({ answers }));
  assert(raw.length < 32 * 1024 && raw.length > 16_384, `body ${raw.length} bytes`);
  const res = await run(m.db, raw);
  assertEquals(res.status, 400);
  assertEquals(m.cores.length, 0);
});

Deno.test("ADV-S3 prototype-shaped answer keys are refused, never merged", async () => {
  const m = makeDb();
  const raw = JSON.stringify(body()).replace('"consent":true', '"consent":true,"__proto__":{"admin":true},"constructor":"x"');
  const res = await run(m.db, raw);
  assert([400, 409].includes(res.status), `status ${res.status}`);
  assertEquals(m.cores.length, 0);
  assertEquals(({} as Record<string, unknown>).admin, undefined, "Object.prototype untouched");
});

Deno.test("ADV-S4 track drops email- and phone-looking props and unknown events", async () => {
  const m = makeDb();
  const visit = crypto.randomUUID();
  const t = (over: Record<string, unknown>) =>
    run(m.db, { action: "track", event: "form_step", form_id: FORM, visit_id: visit, placement: "inline", step: 2, ...over });
  assertEquals((await t({ props: { field: "email", value: "ada@example.org", phone: "+2348012345678", ok: "fine", n: 3 } })).status, 200);
  assertEquals((await t({ event: "form_submitted_fake" })).status, 400);
  assertEquals((await t({ step: 1e9 })).status, 200);
  const props = m.tracked[0].props as Record<string, unknown>;
  assertEquals(props, { field: "email", ok: "fine", n: 3 });
  assertEquals(m.tracked[1].step, null, "an out-of-range step is dropped");
  assert(!JSON.stringify(m.tracked).includes("@"));
});

const LABELS: LeadLabel[] = ["host", "creator", "local"];
const SUBJECTS = ["4452cccc-0000-4000-8000-000000000003", "form:4452dddd-0000-4000-8000-000000000004", "tool:4452eeee-0000-4000-8000-000000000005",
  "form:creator_lead:odd"];

Deno.test("ADV-S5 every prefix is unique and round-trips for each label and subject shape", () => {
  const prefixes = Object.values(HOST_FUNNEL_EVENT_ID_PREFIX);
  for (const a of prefixes) for (const b of prefixes) if (a !== b) assert(!b.startsWith(a), `${a} is a prefix of ${b}`);
  for (const label of LABELS) {
    for (const s of SUBJECTS) {
      const lead = parseHostFunnelEventId(labelledLeadEventId(label, s));
      assertEquals(lead, { kind: LEAD_KIND_FOR_LABEL[label], subjectType: "lead", subjectId: s });
      const call = parseHostFunnelEventId(callBookedEventId(label, s));
      assertEquals(call, { kind: CALL_KIND_FOR_LABEL[label], subjectType: "lead", subjectId: s });
    }
  }
  assertEquals(parseHostFunnelEventId("creator_lead:"), null, "an empty subject is never parsed");
  assertEquals(parseHostFunnelEventId("Creator_lead:x"), null, "prefixes are case-sensitive");
});

Deno.test("ADV-S6 a retry rebuilt from its event id keeps the same label fields", () => {
  for (const label of LABELS) {
    for (const kind of [LEAD_KIND_FOR_LABEL[label], CALL_KIND_FOR_LABEL[label]]) {
      const id = kind.endsWith("_lead") ? labelledLeadEventId(label, SUBJECTS[1]) : callBookedEventId(label, SUBJECTS[0]);
      const parsed = parseHostFunnelEventId(id)!;
      assertEquals(labelFields({ hostKind: parsed.kind }), labelFields({ hostKind: kind }));
      assertEquals(HOST_FUNNEL_LABEL[parsed.kind]?.label, label);
    }
  }
  assertEquals(labelFields({ hostKind: "host_signup" as ServerHostFunnelKind }), {}, "an unlabelled kind sends no label");
});

Deno.test("ADV-S7 each new kind has its own Google action and never falls back", () => {
  for (const kind of ["creator_lead", "local_lead", "host_call_booked", "creator_call_booked", "local_call_booked"] as const) {
    assertEquals(HOST_FUNNEL_GOOGLE_KIND[kind], kind);
    assert(GOOGLE_CONVERSION_KINDS[kind], `${kind} is provisionable`);
  }
  const calls = ["host_call_booked", "creator_call_booked", "local_call_booked"] as const;
  for (const k of calls) assertEquals(GOOGLE_CONVERSION_KINDS[k].category, "BOOK_APPOINTMENT");
  for (const k of ["creator_lead", "local_lead"] as const) assertEquals(GOOGLE_CONVERSION_KINDS[k].category, "SUBMIT_LEAD_FORM");
});

function callInput(kind: ServerHostFunnelKind, name: string): ConversionSendInput {
  return {
    eventName: name, eventId: callBookedEventId("creator", SUBJECTS[0]), eventTimeMs: 1_763_280_000_000, eventSourceUrl: "https://usemingla.com/schedule/creators",
    hashedEmail: "e".repeat(64), hashedPhone: null, fbc: null, fbp: null, clientIp: "203.0.113.1", clientUserAgent: "UA",
    ...labelFields({ hostKind: kind, leadSource: "book_a_call" }),
  } as unknown as ConversionSendInput;
}

Deno.test("ADV-S8 booked-call payloads: Schedule, RESERVE, CUSTOM CallBooked, and no TikTok content_type", async () => {
  const kind: ServerHostFunnelKind = "creator_call_booked";
  const names = HOST_FUNNEL_EVENT_NAMES[kind];
  assertEquals(names, { meta: "Schedule", tiktok: "Schedule", snap: "RESERVE", reddit: "CallBooked" });
  const lead = HOST_FUNNEL_EVENT_NAMES.creator_lead;
  assertEquals(lead.snap, "SIGN_UP", "a creator lead stays SIGN_UP on Snap");
  const bodies: Record<string, unknown> = {};
  const deps = (ch: string) => ({
    getToken: () => "t",
    fetchImpl: ((_u: unknown, init?: RequestInit) => {
      bodies[ch] = JSON.parse(String(init?.body));
      return Promise.resolve(new Response('{"events_received":1,"code":0}', { status: 200 }));
    }) as typeof fetch,
  });
  const conn = { pixelId: "P", tokenEnvVar: "T" } as never;
  await sendMetaConversion(callInput(kind, names.meta!), conn, deps("meta"));
  await sendTikTokConversion(callInput(kind, names.tiktok!), conn, deps("tiktok"));
  await sendSnapConversion(callInput(kind, names.snap!), conn, deps("snap"));
  const reddit = buildRedditConversionBody(callInput(kind, names.reddit!)) as Record<string, unknown>;
  const s = JSON.stringify;
  assert(s(bodies.meta).includes('"event_name":"Schedule"') && s(bodies.meta).includes('"content_category":"creator_call"'), s(bodies.meta));
  assert(s(bodies.meta).includes('"lead_source":"book_a_call"'));
  assert(s(bodies.tiktok).includes('"content_category":"creator_call"'), s(bodies.tiktok));
  assert(!s(bodies.tiktok).includes("content_type"), "TikTok never gets content_type for a call");
  assert(s(bodies.snap).includes('"RESERVE"') && s(bodies.snap).includes('"event_tag":"creator_call"'), s(bodies.snap));
  assert(s(reddit).includes('"tracking_type":"CUSTOM"') && s(reddit).includes('"custom_event_name":"CallBooked"'), s(reddit));
  assert(s(reddit).includes('"category":"creator_call"') && s(reddit).includes('"item_count":1'), s(reddit));
  assert(!s([bodies, reddit]).includes("ada@"), "no raw email in any payload");
});

Deno.test("ADV-S9 the TS schedule twin matches the SQL DST vectors", () => {
  const at = (iso: string) => Date.parse(iso);
  const cases: Array<[string, string, number, "hours" | "days" | "weeks", boolean, boolean, string]> = [
    ["2026-03-07T20:00:00Z", "America/New_York", 1, "days", true, false, "2026-03-08T14:00:00Z"],
    ["2026-03-28T12:00:00Z", "Europe/London", 1, "days", true, false, "2026-03-29T09:00:00Z"],
    ["2026-03-27T15:00:00Z", "Europe/Dublin", 1, "days", true, true, "2026-03-30T09:00:00Z"],
    ["2026-11-16T12:00:00Z", "Asia/Kolkata", 2, "days", true, false, "2026-11-18T04:30:00Z"],
    ["2026-11-16T12:00:00Z", "Asia/Kathmandu", 1, "days", true, false, "2026-11-17T04:15:00Z"],
    ["2026-11-15T12:00:00Z", "Australia/Lord_Howe", 1, "days", true, false, "2026-11-15T23:00:00Z"],
    ["2026-11-01T05:30:00Z", "America/New_York", 1, "hours", false, false, "2026-11-01T06:30:00Z"],
    ["2026-10-21T09:00:00Z", "Europe/London", 1, "weeks", true, false, "2026-10-28T10:00:00Z"],
    ["2026-11-14T18:00:00Z", "Africa/Lagos", 2, "days", true, false, "2026-11-16T09:00:00Z"],
  ];
  for (const [from, tz, n, unit, at10, skip, want] of cases) {
    assertEquals(new Date(nextLocalTime(at(from), tz, n, unit, at10, skip)).toISOString(), new Date(want).toISOString(), `${tz} ${from} +${n}${unit}`);
  }
});
