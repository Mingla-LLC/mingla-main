// MINGLA-INVARIANT: I-4238-HOST-FUNNEL-ONCE-FIRE | issue #4238 | a host-funnel conversion (host lead, sign-up, first publish, first sale) is sent at most once per subject with its deterministic event_id, never while the subject's ads choice is off, and never as a website event when the subject has no web context.
/**
 * #4238 W3-3 (D7). Hermetic: an in-memory table client, captured senders.
 *   (a) host_signup with a web context + a granted Meta touch → Meta HostSignUp,
 *       event_id host_signup:<uid>, fbc from the context, the email hash;
 *   (b) no context → every channel skipped/no_web_context, nothing sent;
 *   (c) the context's ads choice off → nothing sent;
 *   (d) a book-a-call lead → Meta Lead with the /schedule URL; Snap SIGN_UP;
 *   (e) first publish → Snap and Google get nothing (no_channel_event);
 *   (f) a native (Host app) context → no_web_context;
 *   (g) a second fire sends nothing; the retry input rebuilds the host event;
 *   (h) the first sale carries value and currency.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ConversionSendInput,
  fireAdConversion,
  type SenderResult,
} from "../adConversionFire.ts";
import { conversionRetryInput } from "../adConversionRetry.ts";
import type { AdConversionRetryRow } from "../adConversionRetry.ts";
import { recordHostLead } from "../hostFunnelConversion.ts";
import { hostFakeDb } from "./hostFunnelFakeDb.issue4238.ts";

// #4452 B20: a real (non-test) person; the fake answers inbound_lead_is_test false for it.
const REAL_CONTACT = { email: "ada@example.org", name: "Ada Okafor" };

const UID = "5b1f6a2e-4238-4f00-8a00-000000000001";
const CLICK = "7c2d8e3f-4238-4a00-9b00-000000000002";

function capture() {
  const sent: Array<ConversionSendInput & { channel: string }> = [];
  const sender =
    (channel: SenderResult["channel"]) =>
    (input: ConversionSendInput): Promise<SenderResult> => {
      sent.push({ ...input, channel });
      return Promise.resolve({ channel, status: "sent" });
    };
  return {
    sent,
    deps: {
      senders: {
        meta: sender("meta"),
        tiktok: sender("tiktok"),
        snap: sender("snap"),
        reddit: sender("reddit"),
        google: sender("google"),
      },
    },
  };
}

function seed(opts: {
  context?: Record<string, unknown> | null;
  touchConsent?: string;
  row?: Record<string, unknown>;
}) {
  return hostFakeDb({
    creator_accounts: [{ id: UID, email: " Host@Example.com ", phone_e164: "+2348031234567" }],
    ad_match_contexts: opts.context === null ? [] : [{
      subject_type: "host_user",
      subject_id: UID,
      click_id: CLICK,
      fbp: "fb.1.1.111",
      fbc: "fb.1.1731000000000.T4238H",
      ttp: "ttp-1",
      scid: "scid-1",
      client_ip: "203.0.113.9",
      client_user_agent: "UA/1",
      ad_tracking_opt_out: false,
      event_source_url: "https://host.usemingla.com/auth",
      surface: "web",
      ...(opts.context ?? {}),
    }],
    ad_attribution_touches: [{
      id: "touch-1",
      click_id: CLICK,
      network: "meta",
      external_click_id: "T4238H",
      external_click_id_type: "fbclid",
      created_at: new Date().toISOString(),
      consent_state: opts.touchConsent ?? "granted",
    }],
    ad_connections: [
      { platform: "meta", lane: "consumer", extra: { dataset_id: "ds-1" } },
      { platform: "snapchat", lane: "consumer", extra: { pixel_id: "snap-1" } },
      { platform: "google", lane: "consumer", extra: { conversion_actions: { host_signup: "customers/1/conversionActions/9" } } },
    ],
    ad_conversions: [{
      event_id: `host_signup:${UID}`,
      event_type: "host_signup",
      event_name: "HostSignUp",
      surface: "web",
      lane: "consumer",
      meta_capi_status: "pending",
      tiktok_events_status: "pending",
      snap_capi_status: "pending",
      reddit_capi_status: "pending",
      google_ads_status: "pending",
      created_at: new Date().toISOString(),
      ...(opts.row ?? {}),
    }],
  });
}

const signupEvent = {
  kind: "host_signup" as const,
  eventId: `host_signup:${UID}`,
  subjectType: "host_user" as const,
  subjectId: UID,
};

Deno.test("#4238 W3-3 (a) a host sign-up with a web context sends HostSignUp with the shared event id", async () => {
  const db = seed({});
  const { sent, deps } = capture();
  const res = await fireAdConversion(db.client, { hostEvent: signupEvent }, deps);
  assert(res.ok);
  const meta = sent.find((s) => s.channel === "meta");
  assert(meta, "meta was sent");
  assertEquals(meta.eventName, "HostSignUp");
  assertEquals(meta.eventId, `host_signup:${UID}`);
  assertEquals(meta.fbc, "fb.1.1731000000000.T4238H");
  assertEquals(meta.fbp, "fb.1.1.111");
  assertEquals(meta.clientIpAddress, "203.0.113.9");
  assertEquals(meta.eventSourceUrl, "https://host.usemingla.com/auth");
  assertEquals(meta.valueCents, null);
  assert(meta.hashedEmail && /^[0-9a-f]{64}$/.test(meta.hashedEmail));
  assertEquals(sent.find((s) => s.channel === "tiktok")?.eventName, "HostSignUp");
  assertEquals(sent.find((s) => s.channel === "reddit")?.eventName, "HostSignUp");
  // Step 0 Z3: Snap has no custom web event in use; a host sign-up is SIGN_UP.
  assertEquals(sent.find((s) => s.channel === "snap")?.eventName, "SIGN_UP");
  // No Google click on the touch: Google is attempted with the host_signup
  // action and the sender (stubbed here) receives it; the real sender skips it.
  const row = db.row("ad_conversions", (r) => r.event_id === `host_signup:${UID}`);
  assertEquals(row?.meta_capi_status, "sent");
  assertEquals(row?.shared_with_platforms, true);
  assertEquals(row?.touch_id ?? null, null, "a trigger-queued row keeps its first insert");
});

Deno.test("#4238 W3-3 (b) no web context: recorded, every channel skipped/no_web_context, nothing sent", async () => {
  const db = seed({ context: null });
  const { sent, deps } = capture();
  const res = await fireAdConversion(db.client, { hostEvent: signupEvent }, deps);
  assertEquals(sent.length, 0);
  assertEquals(res.results?.length, 5);
  assert(res.results?.every((r) => r.status === "skipped" && r.reason === "no_web_context"));
  const row = db.row("ad_conversions", (r) => r.event_id === `host_signup:${UID}`);
  assertEquals(row?.meta_capi_status, "skipped");
  assertEquals(row?.google_ads_status, "skipped");
  assertEquals(row?.shared_with_platforms, false);
});

Deno.test("#4238 W3-3 (c) the host's ads choice off sends nothing", async () => {
  const db = seed({ context: { ad_tracking_opt_out: true } });
  const { sent, deps } = capture();
  await fireAdConversion(db.client, { hostEvent: signupEvent }, deps);
  assertEquals(sent.length, 0);
  const row = db.row("ad_conversions", (r) => r.event_id === `host_signup:${UID}`);
  assertEquals(row?.meta_capi_status, "skipped");
  assertEquals(row?.shared_with_platforms, false);
});

Deno.test("#4238 W3-3 (c2) a rejected touch consent sends nothing", async () => {
  const db = seed({ touchConsent: "rejected" });
  const { sent, deps } = capture();
  await fireAdConversion(db.client, { hostEvent: signupEvent }, deps);
  assertEquals(sent.length, 0);
});

Deno.test("#4238 W3-3 (d) a book-a-call lead sends Meta Lead with the /schedule URL, Snap SIGN_UP", async () => {
  const LEAD = "9d3e0f1a-4238-4b00-8c00-000000000003";
  const db = hostFakeDb({
    book_call_leads: [{ id: LEAD, email: "venue@example.com", audience: "host" }],
    ad_attribution_touches: [],
    ad_connections: [{ platform: "meta", lane: "consumer", extra: { dataset_id: "ds-1" } }],
  });
  const { sent, deps } = capture();
  const req = new Request("https://x/", {
    headers: { "x-forwarded-for": "198.51.100.4, 10.0.0.1", "user-agent": "UA/2" },
  });
  const { parseHostAdContext } = await import("../hostFunnelConversion.ts");
  const ad = parseHostAdContext({
    fbp: "fb.1.2.222",
    fbc: "fb.1.2.LEAD",
    tracking_opt_out: false,
    page_url: "https://usemingla.com/schedule?utm_source=meta",
  }, req);
  assert(ad);
  const eventId = await recordHostLead(db.client, { subjectId: LEAD, ad, contact: REAL_CONTACT }, deps);
  assertEquals(eventId, `lead:${LEAD}`);
  const meta = sent.find((s) => s.channel === "meta");
  assertEquals(meta?.eventName, "Lead");
  assertEquals(meta?.eventId, `lead:${LEAD}`);
  assertEquals(meta?.eventSourceUrl, "https://usemingla.com/schedule?utm_source=meta");
  assertEquals(meta?.clientIpAddress, "198.51.100.4");
  assertEquals(sent.find((s) => s.channel === "snap")?.eventName, "SIGN_UP");
  assertEquals(sent.find((s) => s.channel === "tiktok")?.eventName, "Lead");
  const row = db.row("ad_conversions", (r) => r.event_id === `lead:${LEAD}`);
  assertEquals(row?.event_type, "lead");
  // A replayed lead resolves to the same event id and sends nothing again.
  const before = sent.length;
  await recordHostLead(db.client, { subjectId: LEAD, ad, contact: REAL_CONTACT }, deps);
  assertEquals(sent.length, before);
});

Deno.test("#4238 W3-3 (e) a first publish sends nothing to Snap or Google", async () => {
  const db = seed({
    row: {
      event_id: `host_publish:${UID}`,
      event_type: "host_first_publish",
      event_name: "HostFirstEventPublished",
      brand_id: "brand-1",
      mingla_event_id: "event-1",
    },
  });
  const { sent, deps } = capture();
  const res = await fireAdConversion(db.client, {
    hostEvent: {
      kind: "host_first_publish",
      eventId: `host_publish:${UID}`,
      subjectType: "host_user",
      subjectId: UID,
    },
  }, deps);
  assertEquals(sent.map((s) => s.channel).sort(), ["meta", "reddit", "tiktok"]);
  assertEquals(sent.find((s) => s.channel === "meta")?.eventName, "HostFirstEventPublished");
  assertEquals(sent.find((s) => s.channel === "meta")?.brandId, "brand-1");
  const skipped = res.results?.filter((r) => r.status === "skipped").map((r) => `${r.channel}:${r.reason}`).sort();
  assertEquals(skipped, ["google:no_channel_event", "snap:no_channel_event"]);
});

Deno.test("#4238 W3-3 (f) a native (Host app) context is not a website: no_web_context", async () => {
  const db = seed({ context: { surface: "ios" } });
  const { sent, deps } = capture();
  const res = await fireAdConversion(db.client, { hostEvent: signupEvent }, deps);
  assertEquals(sent.length, 0);
  assert(res.results?.every((r) => r.reason === "no_web_context"));
});

Deno.test("#4238 W3-3 (g) a second fire sends nothing; the retry rebuilds the host event", async () => {
  const db = seed({});
  const { sent, deps } = capture();
  await fireAdConversion(db.client, { hostEvent: signupEvent }, deps);
  const first = sent.length;
  const again = await fireAdConversion(db.client, { hostEvent: signupEvent }, deps);
  assertEquals(sent.length, first);
  assertEquals(again.deduped, true);
  const retry = conversionRetryInput({
    event_id: `lead:tool:abc-123`,
    order_id: null,
    stay_group_id: null,
    event_type: "lead",
    surface: "web",
    lane: "consumer",
  } as unknown as AdConversionRetryRow);
  assertEquals(retry.hostEvent, {
    kind: "host_lead",
    subjectType: "lead",
    subjectId: "tool:abc-123",
    eventId: "lead:tool:abc-123",
  });
  const purchase = conversionRetryInput({
    event_id: "order-1",
    order_id: "order-1",
    event_type: "purchase",
    surface: "web",
    lane: "consumer",
  } as unknown as AdConversionRetryRow);
  assertEquals(purchase.orderId, "order-1");
  assertEquals(purchase.hostEvent, undefined);
});

Deno.test("#4238 W3-3 (h) the first sale carries value and currency", async () => {
  const db = seed({});
  const { sent, deps } = capture();
  await fireAdConversion(db.client, {
    hostEvent: {
      kind: "host_first_sale",
      eventId: `host_sale:${UID}`,
      subjectType: "host_user",
      subjectId: UID,
      valueCents: 450000,
      currency: "NGN",
      brandId: "brand-1",
    },
  }, deps);
  const meta = sent.find((s) => s.channel === "meta");
  assertEquals(meta?.eventName, "HostFirstTicketSold");
  assertEquals(meta?.valueCents, 450000);
  assertEquals(meta?.currency, "NGN");
  const row = db.row("ad_conversions", (r) => r.event_id === `host_sale:${UID}`);
  assertEquals(row?.event_type, "host_first_sale");
  assertEquals(row?.value_cents, 450000);
});
