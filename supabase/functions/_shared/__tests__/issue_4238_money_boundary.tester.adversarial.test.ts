// MINGLA-INVARIANT: I-4238-HOST-SALE-NEVER-BUYER-REVENUE | issue #4238 | a host's first ticket sale is never reported to an ad network as a buyer purchase (no Purchase / CompletePayment / PURCHASE name, no Google upload), never carries af_revenue to AppsFlyer, and is posted to AppsFlyer exactly once even when two finalize paths fire at the same moment.
/**
 * #4238 tester adversarial (W3-3 / W3-5 / W6-2), a different angle from the
 * implementor's happy paths (issue_4238_host_funnel_fire.test.ts (h),
 * issue_4238_first_sale_paystack.test.ts):
 *
 *   (a) the worst case for the money boundary: the host has a web context,
 *       a GRANTED Google gclid touch and every Google conversion action
 *       configured (purchase included). Their first sale still never reaches
 *       an ad network under a buyer-purchase name and never uploads to Google;
 *   (b) the AppsFlyer post for that sale has no af_revenue / af_currency;
 *   (c) the Stripe webhook and the Paystack status poll (or the hourly
 *       retry) firing the same host_sale:<owner> at the same moment post
 *       mingla_host_first_sale once, not twice.
 *
 * Fails on revert of: the host-kind branch in channelEventName (host kinds
 * fall back to the buyer purchase names), the plain-values AppsFlyer body in
 * postHostFirstSaleAppsFlyer, or the atomic claim in claimAppsFlyerSend.
 * Hermetic: in-memory rows, captured senders, captured AppsFlyer poster.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AppsFlyerPostFn,
  type ConversionSendInput,
  fireAdConversion,
  type SenderResult,
} from "../adConversionFire.ts";
import { hostFakeDb } from "./hostFunnelFakeDb.issue4238.ts";

const OWNER = "5b1f6a2e-4238-4f00-8a00-00000000a001";
const CLICK = "7c2d8e3f-4238-4a00-9b00-00000000a002";
const SALE_ID = `host_sale:${OWNER}`;

/** Buyer-purchase names on every network (adConversionFire CHANNEL_EVENT_NAME). */
const BUYER_PURCHASE_NAMES = new Set([
  "Purchase",
  "CompletePayment",
  "PURCHASE",
]);

function seed() {
  return hostFakeDb({
    creator_accounts: [{
      id: OWNER,
      email: "host@example.com",
      phone_e164: "+447700900123",
    }],
    ad_match_contexts: [{
      subject_type: "host_user",
      subject_id: OWNER,
      click_id: CLICK,
      fbp: "fb.1.1.222",
      fbc: null,
      ttp: null,
      scid: null,
      client_ip: "203.0.113.10",
      client_user_agent: "UA/2",
      ad_tracking_opt_out: false,
      event_source_url: "https://host.usemingla.com/",
      surface: "web",
    }],
    // A granted Google click: the strongest pull towards a Google upload.
    ad_attribution_touches: [{
      id: "touch-g",
      click_id: CLICK,
      network: "google",
      external_click_id: "Cj0KCQ-test-gclid",
      external_click_id_type: "gclid",
      created_at: new Date().toISOString(),
      consent_state: "granted",
    }],
    ad_connections: [
      { platform: "meta", lane: "consumer", extra: { dataset_id: "ds-1" } },
      {
        platform: "tiktok",
        lane: "consumer",
        extra: { pixel_code: "TT-CODE" },
      },
      { platform: "snapchat", lane: "consumer", extra: { pixel_id: "snap-1" } },
      {
        platform: "reddit",
        lane: "consumer",
        extra: { reddit_pixel_id: "rd-1" },
      },
      {
        platform: "google",
        lane: "consumer",
        extra: {
          conversion_action_resource: "customers/1/conversionActions/1",
          conversion_actions: {
            purchase: "customers/1/conversionActions/1",
            free_signup: "customers/1/conversionActions/2",
            host_lead: "customers/1/conversionActions/3",
            host_signup: "customers/1/conversionActions/4",
          },
        },
      },
    ],
  });
}

function capture() {
  const sent: Array<ConversionSendInput & { channel: string }> = [];
  const sender =
    (channel: SenderResult["channel"]) =>
    (input: ConversionSendInput): Promise<SenderResult> => {
      sent.push({ ...input, channel });
      return Promise.resolve({ channel, status: "sent" });
    };
  const afPosts: Array<Parameters<AppsFlyerPostFn>[0]> = [];
  const postAppsFlyer: AppsFlyerPostFn = async (input) => {
    // Yield, so a concurrent fire can interleave before this post resolves.
    await new Promise((resolve) => setTimeout(resolve, 0));
    afPosts.push(input);
    return true;
  };
  return {
    sent,
    afPosts,
    deps: {
      senders: {
        meta: sender("meta"),
        tiktok: sender("tiktok"),
        snap: sender("snap"),
        reddit: sender("reddit"),
        google: sender("google"),
      },
      postAppsFlyer,
    },
  };
}

const saleEvent = {
  kind: "host_first_sale" as const,
  eventId: SALE_ID,
  subjectType: "host_user" as const,
  subjectId: OWNER,
  valueCents: 125000,
  currency: "GBP",
  brandId: "brand-a",
  provider: "stripe" as const,
};

Deno.test("#4238 tester (a) a host's first sale never reaches an ad network as a buyer purchase, even with a granted Google click", async () => {
  const db = seed();
  const { sent, deps } = capture();
  const res = await fireAdConversion(db.client, { hostEvent: saleEvent }, deps);
  assert(res.ok, `fire failed: ${res.reason}`);

  const purchaseNamed = sent.filter((s) =>
    BUYER_PURCHASE_NAMES.has(s.eventName)
  );
  assertEquals(
    purchaseNamed.map((s) => `${s.channel}:${s.eventName}`),
    [],
    "a host first sale was sent under a buyer purchase name",
  );
  assertEquals(
    sent.filter((s) => s.channel === "google").length,
    0,
    "a host first sale was uploaded to Google (it has no Google action of its own)",
  );
  const row = db.row("ad_conversions", (r) => r.event_id === SALE_ID);
  assertEquals(row?.event_type, "host_first_sale");
  assertEquals(row?.google_ads_status, "skipped");
  assert(
    !BUYER_PURCHASE_NAMES.has(String(row?.event_name)),
    `row event_name is a buyer purchase name: ${row?.event_name}`,
  );
});

Deno.test("#4238 tester (b) the host first-sale AppsFlyer post carries no revenue", async () => {
  const db = seed();
  const { afPosts, deps } = capture();
  await fireAdConversion(db.client, { hostEvent: saleEvent }, deps);
  assertEquals(afPosts.length, 1);
  const post = afPosts[0];
  assertEquals(post.app, "business");
  assertEquals(post.eventName, "mingla_host_first_sale");
  const values = post.eventValues ?? {};
  assert(
    !("af_revenue" in values),
    "af_revenue on a host first sale counts host gross as Mingla revenue",
  );
  assert(!("af_currency" in values), "af_currency rides only with af_revenue");
  assertEquals(values.ticket_gross_minor, 125000);
});

Deno.test("#4238 tester (c) two finalize paths firing the same first sale at once post AppsFlyer once", async () => {
  const db = seed();
  const { afPosts, deps } = capture();
  await Promise.all([
    fireAdConversion(db.client, { hostEvent: saleEvent }, deps),
    fireAdConversion(db.client, {
      hostEvent: { ...saleEvent, provider: "paystack" as const },
    }, deps),
  ]);
  assertEquals(
    afPosts.length,
    1,
    "mingla_host_first_sale was posted more than once for one host",
  );
  const row = db.row("ad_conversions", (r) => r.event_id === SALE_ID);
  assertEquals(row?.appsflyer_status, "sent");
});
