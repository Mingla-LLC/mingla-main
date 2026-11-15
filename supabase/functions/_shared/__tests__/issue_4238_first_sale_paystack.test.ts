// MINGLA-INVARIANT: I-4238-FIRST-SALE-BOTH-PROVIDERS | issue #4238 | a brand's first paid online sale fires the host first-sale signals (AppsFlyer mingla_host_first_sale and the host_sale:<owner> ad conversion) exactly once, whichever processor took it, and never for a brand that had already sold.
/**
 * #4238 W3-5 (D11). Hermetic: the real fireHostFirstTicketSold and
 * fireAdConversion over an in-memory table client, captured senders and a
 * captured AppsFlyer poster.
 *   (a) Paystack: no prior sale → host_sale:<owner> fired once; AppsFlyer left
 *       pending (no secrets in that path) and posted once by the retry; a second
 *       webhook delivery fires nothing;
 *   (b) a brand with a prior paid order: milestone stamped, nothing fired;
 *   (c) Stripe (poster injected): mingla_host_first_sale with
 *       milestone=first_ticket_sold now, no revenue;
 *   (d) wiring: both routers call the helper; only Stripe injects the poster.
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
import {
  type AdConversionRetryRow,
  conversionRetryInput,
} from "../adConversionRetry.ts";
import { fireHostFirstTicketSold } from "../hostFirstSale.ts";
import { hostFakeDb } from "./hostFunnelFakeDb.issue4238.ts";

const OWNER = "6e7f8091-4238-4f00-8a00-000000000055";
const BRAND = "brand-4238-w35";

function setup(priorOrders: Array<Record<string, unknown>> = []) {
  const db = hostFakeDb({
    brands: [{ id: BRAND, account_id: OWNER }],
    events: [{ id: "ev-1", brand_id: BRAND }, { id: "ev-2", brand_id: BRAND }],
    orders: [
      { id: "order-now", event_id: "ev-1", payment_status: "paid", source: "online_checkout" },
      ...priorOrders,
    ],
    creator_accounts: [{ id: OWNER, email: "host@example.com" }],
    ad_match_contexts: [],
    ad_attribution_touches: [],
    ad_connections: [],
    brand_appsflyer_milestones: [],
  });
  const sent: ConversionSendInput[] = [];
  const sender = (channel: SenderResult["channel"]) =>
  (input: ConversionSendInput): Promise<SenderResult> => {
    sent.push(input);
    return Promise.resolve({ channel, status: "sent" });
  };
  const posts: Parameters<AppsFlyerPostFn>[0][] = [];
  const postAppsFlyer: AppsFlyerPostFn = (input) => {
    posts.push(input);
    return Promise.resolve(true);
  };
  const senders = {
    meta: sender("meta"),
    tiktok: sender("tiktok"),
    snap: sender("snap"),
    reddit: sender("reddit"),
    google: sender("google"),
  };
  return { db, sent, posts, postAppsFlyer, senders };
}

const sale = (provider: "stripe" | "paystack") => ({
  brandId: BRAND,
  orderId: "order-now",
  amountCents: 450000,
  currency: "ngn",
  provider,
  eventTimeMs: 1_763_000_000_000,
});

Deno.test("#4238 W3-5 (a) a Paystack first sale fires once; AppsFlyer is posted once by the retry", async () => {
  const { db, posts, postAppsFlyer, senders } = setup();
  assertEquals(await fireHostFirstTicketSold(db.client, sale("paystack"), { senders }), "fired");
  const row = db.row("ad_conversions", (r) => r.event_id === `host_sale:${OWNER}`);
  assert(row, "the host_sale row exists");
  assertEquals(row.event_type, "host_first_sale");
  assertEquals(row.value_cents, 450000);
  assertEquals(row.currency, "NGN");
  assertEquals(row.appsflyer_status, "pending", "no secrets in the Paystack path");
  assertEquals(posts.length, 0);
  // A native-only host has no web context: the ad platforms are skipped.
  assertEquals(row.meta_capi_status, "skipped");
  assertEquals(db.row("brand_appsflyer_milestones", (r) => r.brand_id === BRAND)?.first_ticket_sold_at != null, true);

  // Second webhook delivery / status poll: nothing more.
  assertEquals(await fireHostFirstTicketSold(db.client, sale("paystack"), { senders }), "already_claimed");

  // The hourly retry (it injects the poster) posts mingla_host_first_sale once.
  const retryRow = { ...row } as unknown as AdConversionRetryRow;
  await fireAdConversion(db.client, conversionRetryInput(retryRow), { senders, postAppsFlyer });
  await fireAdConversion(db.client, conversionRetryInput(retryRow), { senders, postAppsFlyer });
  assertEquals(posts.length, 1);
  assertEquals(posts[0].eventName, "mingla_host_first_sale");
  assertEquals(posts[0].userId, OWNER);
  assertEquals(posts[0].app, "business");
  assertEquals(posts[0].eventValues?.provider, "paystack");
  assertEquals(posts[0].eventValues?.ticket_gross_minor, 450000);
  assertEquals(posts[0].eventValues?.ticket_gross, 4500);
  assertEquals("af_revenue" in (posts[0].eventValues ?? {}), false);
  assertEquals(db.row("ad_conversions", (r) => r.event_id === `host_sale:${OWNER}`)?.appsflyer_status, "sent");
});

Deno.test("#4238 W3-5 (a2) a web-attributed host's first sale also reaches the ad platforms", async () => {
  const { db, sent, senders } = setup();
  db.tables.ad_match_contexts.push({
    subject_type: "host_user",
    subject_id: OWNER,
    surface: "web",
    fbp: "fb.1.1.1",
    ad_tracking_opt_out: false,
  });
  await fireHostFirstTicketSold(db.client, sale("paystack"), { senders });
  const meta = sent.find((s) => s.eventName === "HostFirstTicketSold");
  assert(meta);
  assertEquals(meta.eventId, `host_sale:${OWNER}`);
  assertEquals(meta.valueCents, 450000);
});

Deno.test("#4238 W3-5 (b) a brand that already sold stamps the milestone and fires nothing", async () => {
  const { db, sent, posts, postAppsFlyer, senders } = setup([
    { id: "order-old", event_id: "ev-2", payment_status: "refunded", source: "online_checkout" },
  ]);
  assertEquals(await fireHostFirstTicketSold(db.client, sale("paystack"), { senders, postAppsFlyer }), "not_first");
  assertEquals(db.row("ad_conversions", (r) => r.event_id === `host_sale:${OWNER}`), undefined);
  assertEquals(sent.length + posts.length, 0);
  assert(db.row("brand_appsflyer_milestones", (r) => r.brand_id === BRAND)?.first_ticket_sold_at);
  // A door sale is not an online sale: it does not count as a prior sale.
  const door = setup([{ id: "order-door", event_id: "ev-2", payment_status: "paid", source: "door" }]);
  assertEquals(await fireHostFirstTicketSold(door.db.client, sale("paystack"), { senders: door.senders }), "fired");
});

Deno.test("#4238 W3-5 (c) Stripe posts mingla_host_first_sale now (milestone first_ticket_sold), never revenue", async () => {
  const { db, posts, postAppsFlyer, senders } = setup();
  assertEquals(await fireHostFirstTicketSold(db.client, sale("stripe"), { senders, postAppsFlyer }), "fired");
  assertEquals(posts.length, 1);
  assertEquals(posts[0].eventName, "mingla_host_first_sale");
  assertEquals(posts[0].eventValues?.milestone, "first_ticket_sold");
  assertEquals(posts[0].eventValues?.provider, "stripe");
  assertEquals("af_revenue" in (posts[0].eventValues ?? {}), false);
  assertEquals(db.row("ad_conversions", (r) => r.event_id === `host_sale:${OWNER}`)?.appsflyer_status, "sent");
  assertEquals(await fireHostFirstTicketSold(db.client, sale("stripe"), { senders, postAppsFlyer }), "already_claimed");
  assertEquals(posts.length, 1);
});

Deno.test("#4238 W3-5 (d) both routers call the helper; only Stripe injects the AppsFlyer poster", async () => {
  const paystack = await Deno.readTextFile(new URL("../paystackWebhookRouter.ts", import.meta.url));
  const stripe = await Deno.readTextFile(new URL("../stripeWebhookRouter.ts", import.meta.url));
  const helper = await Deno.readTextFile(new URL("../hostFirstSale.ts", import.meta.url));
  assert(/fireHostFirstTicketSold\(supabase as never, \{[\s\S]*?provider: "paystack"/.test(paystack));
  assert(paystack.indexOf("fireHostFirstTicketSold(") > paystack.indexOf("await fireAdConversion(supabase as never"));
  assert(/fireHostFirstTicketSold\(supabase as never, \{[\s\S]*?provider: "stripe"[\s\S]*?\}, \{ postAppsFlyer: postAppsFlyerS2SEvent \}\)/.test(stripe));
  assert(!stripe.includes('eventName: "mingla_host_first_sale"'), "Stripe no longer posts it inline");
  assert(!/from "\.\/appsFlyerS2S\.ts"/.test(helper), "the helper never imports the secret reader");
});
