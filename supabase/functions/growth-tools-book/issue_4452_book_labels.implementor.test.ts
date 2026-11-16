// #4452 §4.6 Book-a-call labels (T-4.6a–f; SC-51–56) and the consent box (A1-T-11; A1-SC-30).
// Hermetic: the real recordBookingConversions / resolveFormLink over the
// in-memory table client with captured senders, plus the real parsers.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { ConversionSendInput, SenderResult } from "../_shared/adConversionFire.ts";
import { parseHostAdContext } from "../_shared/hostFunnelConversion.ts";
import { hostFakeDb } from "../_shared/__tests__/hostFunnelFakeDb.issue4238.ts";
import { recordBookingConversions, resolveFormLink } from "./bookingAdLead.ts";
import { parseBookingContext, parseBookingExtras } from "./bookingContext.ts";
import { buildBookingLead } from "./bookingLead.ts";

const BOOK = "4452e000-0000-4000-8000-000000000001";
const SUB = "4452e000-0000-4000-8000-0000000000aa";
const config = { supabaseUrl: "https://x", serviceKey: "k" };
const req = new Request("https://fn/", { headers: { "user-agent": "UA/1" } });
const ad = parseHostAdContext({ fbc: "fb.1.1.BOOK", tracking_opt_out: false, page_url: "https://usemingla.com/schedule" }, req);

function setup(audience: "host" | "creator" | "local", sub?: Record<string, unknown>) {
  const rpc: Array<[string, unknown]> = [];
  const db = hostFakeDb({
    book_call_leads: [{ id: BOOK, booking_key: "gcal:4452", audience, email: "Ada@Example.org" }],
    form_submissions: sub ? [sub] : [],
    ad_attribution_touches: [],
    ad_connections: [],
  });
  const client = db.client as Record<string, unknown>;
  client.rpc = (name: string, args: unknown) => (rpc.push([name, args]), Promise.resolve({ data: 1, error: null }));
  const sent: ConversionSendInput[] = [];
  const sender = (channel: SenderResult["channel"]) => (input: ConversionSendInput): Promise<SenderResult> => {
    sent.push(input);
    return Promise.resolve({ channel, status: "sent" });
  };
  const fire = { senders: { meta: sender("meta"), tiktok: sender("tiktok"), snap: sender("snap"), reddit: sender("reddit"), google: sender("google") } };
  return { db, sent, fire, rpc };
}

Deno.test("T-4.6a SC-51 a direct host booking keeps lead:<id> byte-identical and adds host_call:<id>", async () => {
  const h = setup("host");
  const out = await recordBookingConversions("gcal:4452", "host", ad, null, config, { db: h.db.client, fire: h.fire });
  assertEquals(out.leadEventId, `lead:${BOOK}`);
  assertEquals(out.goalEventId, `host_call:${BOOK}`);
  const row = h.db.row("book_call_leads", (r) => r.id === BOOK);
  assertEquals(row?.lead_event_id, `lead:${BOOK}`);
  assertEquals(row?.goal_event_id, `host_call:${BOOK}`);
});

Deno.test("T-4.6b SC-52 a creator booking fires creator_lead: and creator_call:; a local one local_lead: and local_call:", async () => {
  const c = setup("creator");
  const oc = await recordBookingConversions("gcal:4452", "creator", ad, null, config, { db: c.db.client, fire: c.fire });
  assertEquals([oc.leadEventId, oc.goalEventId], [`creator_lead:${BOOK}`, `creator_call:${BOOK}`]);
  assertEquals(c.db.row("ad_conversions", (r) => r.event_id === `creator_call:${BOOK}`)?.event_type, "call_booked");
  const l = setup("local");
  const ol = await recordBookingConversions("gcal:4452", "local", ad, null, config, { db: l.db.client, fire: l.fire });
  assertEquals([ol.leadEventId, ol.goalEventId], [`local_lead:${BOOK}`, `local_call:${BOOK}`]);
  assertEquals(c.rpc[0][0], "forms_booking_stops_runs", "a booking stops the person's follow-ups");
});

Deno.test("T-4.6c SC-53 a booking from the form fires no Lead and creator_call:<booking> on the form's click", async () => {
  const sub = { id: SUB, email: "ada@example.org", lead_label: "creator", created_at: new Date().toISOString(), is_test: false };
  const h = setup("creator", sub);
  const link = await resolveFormLink(SUB, "ADA@example.org", config, { db: h.db.client });
  assertEquals(link, { id: SUB, label: "creator" });
  const out = await recordBookingConversions("gcal:4452", "creator", ad, link, config, { db: h.db.client, fire: h.fire });
  assertEquals(out.leadEventId, null);
  assertEquals(out.goalEventId, `creator_call:${BOOK}`);
  assert(!h.sent.some((s) => s.eventName === "Lead"), "no second Lead");
  assertEquals((h.rpc[0][1] as Record<string, unknown>).p_submission_id, SUB, "the submission's run stops");
});

Deno.test("T-4.6d SC-54 a form_submission_id with another email, 9 days old, or a test is not linked", async () => {
  const other = setup("creator", { id: SUB, email: "someone@else.org", lead_label: "creator", created_at: new Date().toISOString() });
  assertEquals(await resolveFormLink(SUB, "ada@example.org", config, { db: other.db.client }), null);
  const old = setup("creator", { id: SUB, email: "ada@example.org", lead_label: "creator", created_at: new Date(Date.now() - 9 * 86_400_000).toISOString() });
  assertEquals(await resolveFormLink(SUB, "ada@example.org", config, { db: old.db.client }), null);
  const test = setup("creator", { id: SUB, email: "ada@example.org", lead_label: "creator", created_at: new Date().toISOString(), is_test: true });
  assertEquals(await resolveFormLink(SUB, "ada@example.org", config, { db: test.db.client }), null);
});

Deno.test("T-4.6e SC-55 Creators and Locals need a valid phone (field phone); Host does not", () => {
  assertEquals(parseBookingExtras({}, "creator"), { ok: false, field: "phone" });
  assertEquals(parseBookingExtras({ phone: { country: "NG", dial: "+234", number: "12" } }, "local"), { ok: false, field: "phone" });
  const ok = parseBookingExtras({ phone: { country: "IE", dial: "+353", number: "(0)87 123 4567" } }, "creator");
  assert(ok.ok && ok.extras.phoneE164 === "+353871234567");
  assert(parseBookingExtras({}, "host").ok, "a host booking without a phone is fine");
});

Deno.test("T-4.6f SC-56 the booking row stores utm_source and utm_campaign from the page", () => {
  const ctx = parseBookingContext({ audience: "creator", city: "Lagos", social_platform: "instagram", social_handle: "@ada", makes: "video" });
  assert(ctx.ok);
  const ex = parseBookingExtras({ phone: "+2348012345678", utm: { source: "meta", campaign: "creators-lagos-nov" }, click_source: "meta" }, "creator");
  assert(ex.ok);
  const row = buildBookingLead({ eventId: "e", startMs: Date.parse("2026-11-20T10:00Z"), name: "Ada", email: "ada@example.org", venue: "",
    source: "", context: ctx.context, extras: ex.extras, formSubmissionId: null });
  assertEquals([row.utm_source, row.utm_campaign, row.click_source, row.phone_e164], ["meta", "creators-lagos-nov", "meta", "+2348012345678"]);
});

Deno.test("A1-T-11 A1-SC-30 the consent box: strict true ticks it; anything else leaves it off", () => {
  const on = parseBookingExtras({ marketing_consent: true }, "host");
  assert(on.ok && on.extras.marketingConsent && on.extras.consentText !== null);
  for (const v of ["true", 1, undefined, false]) {
    const off = parseBookingExtras({ marketing_consent: v }, "host");
    assert(off.ok && off.extras.marketingConsent === false && off.extras.consentText === null, String(v));
  }
  const ctx = parseBookingContext({ audience: "host", icp: "restaurants", social_platform: "instagram", social_handle: "@x" });
  assert(ctx.ok && on.ok);
  const row = buildBookingLead({ eventId: "e", startMs: 0, name: "Ada", email: "a@example.org", venue: "", source: "", context: ctx.context, extras: on.extras });
  assertEquals(row.marketing_consent, true);
  assert(typeof row.consent_at === "string");
});
