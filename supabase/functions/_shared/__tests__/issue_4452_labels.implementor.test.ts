// MINGLA-INVARIANT: I-4452-LEAD-LABEL-REQUIRED | issue #4452 | every Lead and booked call written by forms, Book-a-call or tools carries lead_label, and its event-id prefix matches the label.
// MINGLA-INVARIANT: I-4452-LEAD-PREFIX-PER-LABEL | issue #4452 | each lead and goal kind has its own event-id prefix, and the retry parser maps each prefix back to its own kind (never host_lead).
/**
 * #4452 §4 lead labels (T-4.1, T-4.2a–e, T-4.3, T-4.3b, T-4.4, T-4.9; SC-42–50, 61).
 * Hermetic: the real fireAdConversion and the real four senders over the
 * in-memory table client, with fetch captured.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ConversionSendInput,
  resolveSenderConnection,
  type SenderConnection,
  type SenderResult,
} from "../adConversionFire.ts";
import {
  CALL_KIND_FOR_LABEL,
  HOST_FUNNEL_EVENT_ID_PREFIX,
  HOST_FUNNEL_EVENT_TYPE,
  HOST_FUNNEL_GOOGLE_KIND,
  LEAD_KIND_FOR_LABEL,
  parseHostFunnelEventId,
} from "../adEventCatalog.ts";
import { sendGoogleConversion } from "../googleConversionUpload.ts";
import {
  callBookedEventId,
  labelledLeadEventId,
  parseHostAdContext,
  recordCallBooked,
  recordHostLead,
  recordLabelledLead,
} from "../hostFunnelConversion.ts";
import { sendMetaConversion } from "../metaCapi.ts";
import { buildRedditConversionBody } from "../redditCapi.ts";
import { sendSnapConversion } from "../snapCapi.ts";
import { sendTikTokConversion } from "../tiktokEvents.ts";
import { hostFakeDb } from "./hostFunnelFakeDb.issue4238.ts";
import { capturePurchaseBodies } from "./issue_4452_purchase_payloads.capture.ts";

const SUB = "4452aaaa-0000-4000-8000-000000000001";
const BOOK = "4452bbbb-0000-4000-8000-000000000002";
const req = new Request("https://fn/", { headers: { "user-agent": "UA/4452", "x-forwarded-for": "203.0.113.7" } });
const ad = parseHostAdContext({ fbc: "fb.1.9.FORM", fbp: "fb.1.9.FBP", ttp: "TTP", scid: "SCID", tracking_opt_out: false, page_url: "https://usemingla.com/creators" }, req)!;

/** Real senders, with each request body captured per channel. */
function capturing() {
  const bodies: Record<string, unknown> = {};
  const inputs: ConversionSendInput[] = [];
  const fetchFor = (channel: string) => (_u: string | URL | Request, init?: RequestInit) => {
    bodies[channel] = JSON.parse(String(init?.body ?? "null"));
    return Promise.resolve(new Response('{"events_received":1,"code":0}', { status: 200 }));
  };
  const conn = (c: SenderConnection): SenderConnection => ({ ...c, pixelId: "PIXEL", tokenEnvVar: "TOKEN" });
  const wrap = (channel: SenderResult["channel"]) => (input: ConversionSendInput, c: SenderConnection): Promise<SenderResult> => {
    inputs.push(input);
    const deps = { getToken: () => "token", fetchImpl: fetchFor(channel) as typeof fetch };
    if (channel === "meta") return sendMetaConversion(input, conn(c), deps);
    if (channel === "tiktok") return sendTikTokConversion(input, conn(c), deps);
    if (channel === "snap") return sendSnapConversion(input, conn(c), deps);
    if (channel === "reddit") {
      bodies.reddit = buildRedditConversionBody(input);
      return Promise.resolve({ channel, status: "sent" });
    }
    return sendGoogleConversion(input, c, { requestImpl: () => { throw new Error("no google upload expected"); } } as never);
  };
  return {
    bodies,
    inputs,
    fire: {
      senders: { meta: wrap("meta"), tiktok: wrap("tiktok"), snap: wrap("snap"), reddit: wrap("reddit"), google: wrap("google") },
    },
  };
}

function db() {
  return hostFakeDb({
    form_submissions: [{ id: SUB, email: "ada@example.org", phone_e164: "+2348012345678" }],
    book_call_leads: [
      { id: BOOK, booking_key: "gcal:4452", audience: "creator", email: "ada@example.org", phone_e164: "+2348012345678", form_submission_id: null },
    ],
    ad_attribution_touches: [],
    ad_connections: [
      { platform: "google", lane: "consumer", extra: { conversion_action_resource: "customers/1/conversionActions/PURCHASE", conversion_actions: { host_lead: "customers/1/conversionActions/HOSTLEAD" } } },
    ],
  });
}

Deno.test("T-4.1 SC-42 a creator form Lead: event id creator_lead:form:<id>, lead_label creator, event_type lead", async () => {
  const d = db();
  const c = capturing();
  const id = await recordLabelledLead(d.client, { label: "creator", subjectId: `form:${SUB}`, ad, source: "creators-join" }, c.fire);
  assertEquals(id, `creator_lead:form:${SUB}`);
  const row = d.row("ad_conversions", (r) => r.event_id === id);
  assertEquals(row?.lead_label, "creator");
  assertEquals(row?.event_type, "lead");
  assert(c.inputs.length >= 4, "the senders ran");
});

Deno.test("T-4.2a–d SC-43–46 each platform receives the creator label in its own field", async () => {
  const d = db();
  const c = capturing();
  await recordLabelledLead(d.client, { label: "creator", subjectId: `form:${SUB}`, ad, source: "creators-join" }, c.fire);
  const meta = (c.bodies.meta as { data: Array<Record<string, any>> }).data[0];
  assertEquals(meta.event_name, "Lead");
  assertEquals(meta.custom_data.content_category, "creator_lead");
  assertEquals(meta.custom_data.content_name, "Creator lead");
  assertEquals(meta.custom_data.lead_source, "creators-join");
  const tt = (c.bodies.tiktok as { data: Array<Record<string, any>> }).data[0];
  assertEquals(tt.event, "Lead");
  assertEquals(tt.properties.content_category, "creator_lead");
  assertEquals("content_type" in tt.properties, false, "D-1: never content_type");
  const snapBody = c.bodies.snap as { data: Array<Record<string, any>> };
  const snap = snapBody.data[0];
  assertEquals(snap.event_name, "SIGN_UP");
  assertEquals(snap.custom_data.content_category, "creator_lead");
  assertEquals(snap.custom_data.event_tag, "creator_lead");
  const rd = (c.bodies.reddit as { data: { events: Array<Record<string, any>> } }).data.events[0];
  assertEquals(rd.type.tracking_type, "LEAD"); // v3 upper-case standard type (redditEventType, #4238 Z5)
  assertEquals(rd.metadata.products[0].category, "creator_lead");
  assertEquals(rd.metadata.item_count, 1);
  assertEquals(rd.metadata.conversion_id, `creator_lead:form:${SUB}`);
});

Deno.test("T-4.2e SC-47 a purchase payload is byte-identical to origin/main for all four senders", async () => {
  const golden = JSON.parse(await Deno.readTextFile(new URL("./fixtures/issue_4452_purchase_payloads.golden.json", import.meta.url)));
  const now = await capturePurchaseBodies(new URL("../", import.meta.url).href.replace(/\/$/, ""));
  assertEquals(JSON.stringify(now), JSON.stringify(golden));
});

Deno.test("T-4.3 SC-48 with only host_lead configured, a creator_lead records Google pending_config and never uploads (no fallback)", async () => {
  const d = db();
  const conn = await resolveSenderConnection(d.client, "google", "consumer", "creator_lead");
  assertEquals(conn.conversionActionResource, null, "never the purchase alias, never host_lead");
  let uploads = 0;
  const res = await sendGoogleConversion({ eventId: "x", eventName: "Lead", externalClickId: "GCLID" } as ConversionSendInput, conn, {
    requestImpl: () => { uploads += 1; return Promise.resolve({}) as never; },
    resolveClient: () => { uploads += 1; return Promise.resolve({}) as never; },
  } as never);
  assertEquals(res, { channel: "google", status: "failed", reason: "pending_config" });
  assertEquals(uploads, 0);
  // host_lead still resolves to its own action.
  assertEquals((await resolveSenderConnection(d.client, "google", "consumer", "host_lead")).conversionActionResource, "customers/1/conversionActions/HOSTLEAD");
  for (const kind of ["creator_lead", "local_lead", "host_call_booked", "creator_call_booked", "local_call_booked"] as const) {
    assertEquals(HOST_FUNNEL_GOOGLE_KIND[kind], kind, `${kind} maps to its own Google kind`);
  }
});

Deno.test("T-4.3b SC-49 with no Google click the status is no_google_click", async () => {
  const res = await sendGoogleConversion({ eventId: "x", eventName: "Lead", externalClickId: null } as unknown as ConversionSendInput,
    { pixelId: null, tokenEnvVar: null, conversionActionResource: "customers/1/conversionActions/HOSTLEAD" });
  assertEquals(res.reason, "no_google_click");
});

Deno.test("T-4.4 SC-50 the retry lane parses each prefix back to its own kind and subject", () => {
  assertEquals(parseHostFunnelEventId(`creator_lead:form:${SUB}`), { kind: "creator_lead", subjectType: "lead", subjectId: `form:${SUB}` });
  assertEquals(parseHostFunnelEventId(`local_lead:${BOOK}`)?.kind, "local_lead");
  assertEquals(parseHostFunnelEventId(`lead:tool:${SUB}`), { kind: "host_lead", subjectType: "lead", subjectId: `tool:${SUB}` });
  assertEquals(parseHostFunnelEventId(`creator_call:${BOOK}`), { kind: "creator_call_booked", subjectType: "lead", subjectId: BOOK });
  assertEquals(parseHostFunnelEventId(`host_call:${BOOK}`)?.kind, "host_call_booked");
  const prefixes = Object.values(HOST_FUNNEL_EVENT_ID_PREFIX);
  assertEquals(new Set(prefixes).size, prefixes.length, "every prefix is unique");
  for (const p of prefixes) {
    for (const q of prefixes) if (p !== q) assert(!p.startsWith(q), `${p} must not start with ${q}`);
  }
  assertEquals(HOST_FUNNEL_EVENT_TYPE.creator_call_booked, "call_booked");
  assertEquals(LEAD_KIND_FOR_LABEL.local, "local_lead");
  assertEquals(CALL_KIND_FOR_LABEL.host, "host_call_booked");
});

Deno.test("T-4.6a SC-51 a host lead keeps lead:<id> (recordHostLead is a wrapper)", async () => {
  const d = db();
  const c = capturing();
  assertEquals(labelledLeadEventId("host", BOOK), `lead:${BOOK}`);
  const id = await recordHostLead(d.client, { subjectId: BOOK, ad }, c.fire);
  assertEquals(id, `lead:${BOOK}`);
  assertEquals(d.row("ad_conversions", (r) => r.event_id === id)?.lead_label, "host");
});

Deno.test("T-4.9 SC-61 the tools gate Lead carries content_category host_lead and keeps lead:tool:<id>", async () => {
  const d = hostFakeDb({ tool_leads: [{ id: SUB, email: "v@example.org" }], ad_attribution_touches: [], ad_connections: [] });
  const c = capturing();
  const id = await recordLabelledLead(d.client, { label: "host", subjectId: `tool:${SUB}`, ad, source: "tool:venues" }, c.fire);
  assertEquals(id, `lead:tool:${SUB}`);
  const meta = (c.bodies.meta as { data: Array<Record<string, any>> }).data[0];
  assertEquals(meta.custom_data.content_category, "host_lead");
  assertEquals(meta.custom_data.lead_source, "tool:venues");
});

Deno.test("§4.5 a booked call: <label>_call:<booking>, Schedule / RESERVE / CUSTOM CallBooked, lead_label set", async () => {
  const d = db();
  const c = capturing();
  await recordLabelledLead(d.client, { label: "creator", subjectId: BOOK, ad }, c.fire);
  const id = await recordCallBooked(d.client, { label: "creator", bookingId: BOOK, source: "book_a_call" }, c.fire);
  assertEquals(id, callBookedEventId("creator", BOOK));
  assertEquals(id, `creator_call:${BOOK}`);
  const row = d.row("ad_conversions", (r) => r.event_id === id);
  assertEquals(row?.event_type, "call_booked");
  assertEquals(row?.lead_label, "creator");
  const sched = c.inputs.filter((i) => i.eventId === id);
  assertEquals(sched.find((i) => i.eventName === "Schedule")?.contentCategory, "creator_call");
  assert(sched.some((i) => i.eventName === "RESERVE"), "Snap RESERVE");
  const rd = (c.bodies.reddit as { data: { events: Array<Record<string, any>> } }).data.events[0];
  assertEquals(rd.type, { tracking_type: "CUSTOM", custom_event_name: "CallBooked" });
  // Credited to the lead's click: the booking's own context (stored by its Lead) was read.
  assert(sched.some((i) => i.fbc === "fb.1.9.FORM"), "the call uses the lead's stored click context");
});

Deno.test("§4.5 a booking from a form reads the submission's match context (form:<id>)", async () => {
  const d = hostFakeDb({
    form_submissions: [{ id: SUB, email: "ada@example.org" }],
    book_call_leads: [{ id: BOOK, booking_key: "gcal:f", audience: "creator", email: "ada@example.org", form_submission_id: SUB }],
    ad_attribution_touches: [],
    ad_connections: [],
  });
  const c = capturing();
  await recordLabelledLead(d.client, { label: "creator", subjectId: `form:${SUB}`, ad }, c.fire);
  const before = c.inputs.length;
  await recordCallBooked(d.client, { label: "creator", bookingId: BOOK }, c.fire);
  const call = c.inputs.slice(before);
  assert(call.length > 0 && call.every((i) => i.eventId === `creator_call:${BOOK}`));
  assert(call.some((i) => i.fbc === "fb.1.9.FORM"), "the in-form booking is tied to the form's ad click");
});

Deno.test("SC-58 ads off: no browser ids stored, the server row exists, nothing is shared", async () => {
  const d = db();
  const c = capturing();
  const off = parseHostAdContext({ fbc: "fb.1.9.NOPE", tracking_opt_out: true, page_url: "https://usemingla.com/creators" }, req);
  const id = await recordLabelledLead(d.client, { label: "creator", subjectId: `form:${SUB}`, ad: off }, c.fire);
  const ctx = d.row("ad_match_contexts", (r) => r.subject_id === `form:${SUB}`);
  assertEquals(ctx?.ad_tracking_opt_out, true);
  assertEquals(ctx?.fbc ?? null, null);
  assert(d.row("ad_conversions", (r) => r.event_id === id), "the server Lead row exists");
  assertEquals(c.inputs.filter((i) => i.fbc === "fb.1.9.NOPE").length, 0);
});
