// MINGLA-INVARIANT: I-4238-HOST-FUNNEL-ONCE-ATTACH | issue #4238 | host-attribution-attach resolves the host only from the JWT, links the click touch to that host once, answers new_host exactly once per host from the server's sign-up row, and fires host_signup only while it is pending.
/**
 * #4238 W3-3 + W4-3. Hermetic: the real handler, an in-memory table client and
 * captured senders (no network).
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { ConversionSendInput, SenderResult } from "../_shared/adConversionFire.ts";
import { hostFakeDb } from "../_shared/__tests__/hostFunnelFakeDb.issue4238.ts";
import { handleAttach } from "./index.ts";

const UID = "1a2b3c4d-4238-4c00-8d00-000000000011";
const OTHER = "1a2b3c4d-4238-4c00-8d00-000000000099";
const CLICK = "2b3c4d5e-4238-4d00-8e00-000000000022";

function setup(opts: { signupRow?: boolean } = {}) {
  const db = hostFakeDb({
    creator_accounts: [{ id: UID, email: "host@example.com" }],
    ad_attribution_touches: [
      { id: "t-1", click_id: CLICK, network: "meta", external_click_id: "FB1", consent_state: "granted", user_id: null, created_at: new Date().toISOString() },
    ],
    ad_connections: [{ platform: "meta", lane: "consumer", extra: { dataset_id: "ds" } }],
    ad_conversions: opts.signupRow === false ? [] : [{
      event_id: `host_signup:${UID}`,
      event_type: "host_signup",
      event_name: "HostSignUp",
      surface: "web",
      lane: "consumer",
      // The M-2 trigger's row: every channel pending (the column defaults).
      meta_capi_status: "pending",
      tiktok_events_status: "pending",
      snap_capi_status: "pending",
      reddit_capi_status: "pending",
      google_ads_status: "pending",
      created_at: new Date().toISOString(),
    }],
  });
  db.addUser("jwt-host", UID);
  const sent: ConversionSendInput[] = [];
  const sender = (channel: SenderResult["channel"]) =>
  (input: ConversionSendInput): Promise<SenderResult> => {
    sent.push(input);
    return Promise.resolve({ channel, status: "sent" });
  };
  const deps = {
    db: db.client,
    waitUntil: null,
    fire: {
      senders: {
        meta: sender("meta"),
        tiktok: sender("tiktok"),
        snap: sender("snap"),
        reddit: sender("reddit"),
        google: sender("google"),
      },
    },
  };
  return { db, sent, deps };
}

const post = (body: unknown, token: string | null = "jwt-host") =>
  new Request("https://fn/host-attribution-attach", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.7",
      "user-agent": "HostWeb/1",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

Deno.test("#4238 attach: no JWT or a bad JWT is 401 and writes nothing", async () => {
  const { db, deps } = setup();
  assertEquals((await handleAttach(post({}, null), deps)).status, 401);
  assertEquals((await handleAttach(post({}, "forged"), deps)).status, 401);
  assertEquals(db.tables.ad_match_contexts?.length ?? 0, 0);
});

Deno.test("#4238 attach: a body user id is ignored; the touch is linked once; new_host once; host_signup fires", async () => {
  const { db, sent, deps } = setup();
  const res = await handleAttach(post({
    user_id: OTHER,
    subject_id: OTHER,
    click_id: CLICK,
    fbp: "fb.1.1.1",
    fbc: "fb.1.1.FB1",
    tracking_opt_out: false,
    page_url: "https://host.usemingla.com/auth?fbclid=FB1",
  }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { ok: true, host_signup_event_id: `host_signup:${UID}`, new_host: true });
  const ctx = db.tables.ad_match_contexts ?? [];
  assertEquals(ctx.length, 1);
  assertEquals(ctx[0].subject_id, UID);
  assertEquals(ctx[0].client_ip, "203.0.113.7");
  assertEquals(ctx[0].surface, "web");
  assertEquals(db.row("ad_attribution_touches", (r) => r.id === "t-1")?.user_id, UID);
  const meta = sent.find((s) => s.eventName === "HostSignUp");
  assert(meta, "host_signup was fired");
  assertEquals(meta.eventId, `host_signup:${UID}`);

  // Second sign-in: not new, nothing re-sent, and a touch already linked to
  // someone (here another account) is never re-linked.
  const touch = db.row("ad_attribution_touches", (r) => r.id === "t-1");
  if (touch) touch.user_id = OTHER;
  const before = sent.length;
  const again = await (await handleAttach(post({ click_id: CLICK }), deps)).json();
  assertEquals(again.new_host, false);
  assertEquals(sent.length, before);
  assertEquals((db.tables.ad_match_contexts ?? []).length, 1);
  assertEquals(db.row("ad_attribution_touches", (r) => r.id === "t-1")?.user_id, OTHER);
});

Deno.test("#4238 attach: a host who signed up before #4238 (no sign-up row) is never new", async () => {
  const { deps, sent } = setup({ signupRow: false });
  const body = await (await handleAttach(post({ click_id: CLICK }), deps)).json();
  assertEquals(body, { ok: true, host_signup_event_id: null, new_host: false });
  assertEquals(sent.length, 0);
});

Deno.test("#4238 W4-3 attach: a Host app sign-in stores install attribution, no cookies, sends nothing", async () => {
  const { db, sent, deps } = setup();
  const body = await (await handleAttach(post({
    surface: "ios",
    click_id: CLICK,
    fbp: "fb.1.1.1",
    install_attribution: { media_source: "Facebook Ads", campaign: "host-lagos", af_sub1: "cmp:host-lagos", junk: "x" },
  }), deps)).json();
  assertEquals(body.new_host, true);
  const ctx = (db.tables.ad_match_contexts ?? [])[0];
  assertEquals(ctx.surface, "ios");
  assertEquals(ctx.click_id, null);
  assertEquals(ctx.fbp, null);
  assertEquals(ctx.install_attribution, { media_source: "Facebook Ads", campaign: "host-lagos", af_sub1: "cmp:host-lagos" });
  assertEquals(sent.length, 0);
  assertEquals(db.row("ad_conversions", (r) => r.event_id === `host_signup:${UID}`)?.meta_capi_status, "skipped");
});

Deno.test("#4238 attach: when the context cannot be written, new_host is unknown (null)", async () => {
  const { db, deps } = setup();
  const broken = {
    ...db.client,
    from: (table: string) =>
      table === "ad_match_contexts"
        ? {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: null, error: { message: "relation does not exist" } }),
              }),
            }),
          }),
        }
        : db.client.from(table),
  };
  const body = await (await handleAttach(post({}), { ...deps, db: broken })).json();
  assertEquals(body.new_host, null);
});

Deno.test("#4238 attach: ads off stores the opt-out only and sends nothing", async () => {
  const { db, sent, deps } = setup();
  await handleAttach(post({ tracking_opt_out: true, click_id: CLICK, fbp: "fb.1.1.1" }), deps);
  const ctx = (db.tables.ad_match_contexts ?? [])[0];
  assertEquals(ctx.ad_tracking_opt_out, true);
  assertEquals(ctx.click_id, null);
  assertEquals(ctx.fbp, null);
  assertEquals(sent.length, 0);
});
