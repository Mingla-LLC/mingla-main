/**
 * #4273 polish — the send snapshot (T-1 .. T-5 of the spec).
 *
 *
 * Driven through the real send paths: processClaimedCampaigns -> dispatchByKind
 * -> sendEmail / sendSms, and sendPushCampaign with a stubbed provider. The
 * Supabase client is a recording fake, so "before the first recipient" is the
 * order of recorded writes, not an assumption.
 */
// MINGLA-INVARIANT: I-4273-SNAPSHOT-WRITTEN-BEFORE-DELIVERY | issue #4273 | marketing-send writes a campaign's send snapshot once (UPDATE ... WHERE sent_snapshot IS NULL), after the empty-content guards and before the first recipient, and a failed write never stops the send.
// MINGLA-INVARIANT: I-4273-SNAPSHOT-NO-RECIPIENT-DATA | issue #4273 | The send snapshot never carries a recipient contact, name, user id, unsubscribe link, per-recipient tracking id or the brand's contact address.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FakeTime } from "https://deno.land/std@0.224.0/testing/time.ts";
import { processClaimedCampaigns } from "./index.ts";
import { sendPushCampaign } from "./pushCampaign.ts";
import { SAMPLE_TRACKING_ID, smsEncoding } from "./sentSnapshot.ts";
import {
  composeSmsBody,
  computeSegments,
  smsAdapter,
} from "../_shared/adapters/smsAdapter.ts";
import {
  BRAND_CAMPAIGN_PUSH_CATEGORY,
  renderBrandReachMessage,
} from "../_shared/brandReachMessages.ts";

const CAMPAIGN_ID = "42730000-0000-4000-8000-0000000000c1";
const BRAND_ID = "42730000-0000-4000-8000-0000000000b1";
const AUDIENCE_ID = "42730000-0000-4000-8000-0000000000a1";
const ACCOUNT_ID = "42730000-0000-4000-8000-0000000000d1";
const EVENT_ID = "42730000-0000-4000-8000-0000000000e1";
const GUEST_EMAIL = "real.guest@guestmail.net";
const GUEST_PHONE = "+2348031104273";
const BRAND_CONTACT = "owner-inbox@brand.example";

interface Write {
  table: string;
  op: "insert" | "update" | "upsert" | "delete";
  payload: unknown;
  filters: Array<[string, string, unknown]>;
}

interface FakeOptions {
  snapshotError?: boolean;
}

function makeFake(state: { writes: Write[]; rpcs: string[] }, opts: FakeOptions = {}) {
  const audienceRow = {
    id: AUDIENCE_ID,
    brand_id: BRAND_ID,
    query_definition: { kind: "all_brand_people", brand_id: BRAND_ID },
  };
  const brandRow = {
    id: BRAND_ID,
    name: "Lantern Room",
    slug: "lantern-room",
    contact_email: BRAND_CONTACT,
    cover_media_url: "https://cdn.example/cover.jpg",
    cover_media_type: "image",
  };
  const eventRow = {
    id: EVENT_ID,
    title: "Rooftop Night",
    location_text: "Lagos",
    cover_media_url: null,
    cover_media_type: null,
    master_start_at: "2026-12-05T20:00:00Z",
    master_end_at: "2026-12-05T23:00:00Z",
    master_timezone: "Africa/Lagos",
    slug: "rooftop-night",
    brand_id: BRAND_ID,
  };
  const builder = (table: string) => {
    const filters: Array<[string, string, unknown]> = [];
    let op: Write["op"] | "select" = "select";
    let payload: unknown = null;
    const record = () => {
      if (op !== "select") state.writes.push({ table, op, payload, filters });
    };
    const result = (): { data: unknown; error: unknown } => {
      if (op === "update" && table === "marketing_campaigns" &&
        (payload as Record<string, unknown>).sent_snapshot !== undefined && opts.snapshotError) {
        return { data: null, error: { message: "permission denied" } };
      }
      if (op === "upsert" && table === "marketing_messages") {
        return { data: { id: "msg-1" }, error: null };
      }
      if (op !== "select") {
        return { data: op === "update" ? { id: "msg-1", ...(payload as object) } : null, error: null };
      }
      if (table === "marketing_audiences") return { data: audienceRow, error: null };
      if (table === "brands") {
        return filters.some(([m]) => m === "in")
          ? { data: [{ id: BRAND_ID, slug: brandRow.slug }], error: null }
          : { data: brandRow, error: null };
      }
      if (table === "events_with_master_date_view") return { data: [eventRow], error: null };
      if (table === "marketing_messages") {
        return filters.some(([, c]) => c === "recipient_phone")
          ? { data: null, error: null }
          : { data: [], error: null };
      }
      return { data: null, error: null };
    };
    const chain: Record<string, unknown> = {};
    for (const method of ["eq", "in", "is", "neq", "or", "order", "range", "limit"]) {
      chain[method] = (column: string, value: unknown) => {
        filters.push([method, column, value]);
        return chain;
      };
    }
    chain.select = () => chain;
    chain.insert = (p: unknown) => { op = "insert"; payload = p; record(); return chain; };
    chain.update = (p: unknown) => { op = "update"; payload = p; record(); return chain; };
    chain.upsert = (p: unknown) => { op = "upsert"; payload = p; record(); return chain; };
    chain.delete = () => { op = "delete"; record(); return chain; };
    chain.maybeSingle = () => Promise.resolve(result());
    chain.single = () => Promise.resolve(result());
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject);
    return chain;
  };
  return {
    from: (table: string) => builder(table),
    rpc: (name: string) => {
      state.rpcs.push(name);
      if (name === "biz_marketing_book_send_audience") {
        return Promise.resolve({
          data: {
            brand_id: BRAND_ID,
            reach: { total: 1, reachable_email: 1, reachable_sms: 1 },
            rows: [{
              contact_key: GUEST_EMAIL,
              display_name: "Real Guest",
              first_name: "Realname",
              raw_email: GUEST_EMAIL,
              raw_phone: GUEST_PHONE,
              order_count: 1,
              total_spend_minor: 5000,
              total_spend_currency: "USD",
              last_event_id: null,
              last_event_name: "Their Last Party",
              last_purchase_at: null,
              email_marketing_ok: true,
              sms_marketing_ok: true,
            }],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function campaign(channel: "email" | "sms", payload: Record<string, unknown>) {
  return {
    id: CAMPAIGN_ID,
    account_id: ACCOUNT_ID,
    brand_id: BRAND_ID,
    audience_id: AUDIENCE_ID,
    channel,
    // deno-lint-ignore no-explicit-any
    channel_payload: payload as any,
    name: "Snapshot under test",
    scheduled_for: null,
  };
}

const snapshotWrites = (writes: Write[]) =>
  writes.filter((w) =>
    w.table === "marketing_campaigns" && w.op === "update" &&
    (w.payload as Record<string, unknown>).sent_snapshot !== undefined
  );
const firstRecipientWrite = (writes: Write[]) =>
  writes.findIndex((w) => w.table === "marketing_messages" && w.op !== "delete");

function assertNoContacts(json: string) {
  for (const forbidden of [GUEST_EMAIL, GUEST_PHONE, "Realname", "Their Last Party", BRAND_CONTACT, "/unsubscribe", "unsub"]) {
    assert(!json.includes(forbidden), `snapshot leaked ${forbidden}: ${json}`);
  }
  const uuids = json.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
  for (const id of uuids) {
    assert(id === SAMPLE_TRACKING_ID || id === EVENT_ID, `snapshot carried an id: ${id}`);
  }
}

// ── T-1 ─────────────────────────────────────────────────────────────────────
Deno.test("#4273 T-1 an email campaign writes one snapshot, before the first recipient", async () => {
  const state = { writes: [] as Write[], rpcs: [] as string[] };
  Deno.env.set("UNSUBSCRIBE_TOKEN_SECRET", "issue-4273-test-secret-not-a-real-key-0123456789");
  const summary = await processClaimedCampaigns(
    makeFake(state),
    // deno-lint-ignore no-explicit-any
    [campaign("email", {
      kind: "email",
      subject: "Hi {first_name}, {brand_name} is back",
      body_html: `<p>Hi {first_name}. See you at {next_event_name}.</p>{{event:${EVENT_ID}}}`,
      body_text: "x",
      embedded_events: [EVENT_ID],
    })] as any,
    { live: false, resendApiKey: "re_test_key" },
  );
  assertEquals(summary.failed, 0, JSON.stringify(summary.errors));
  const writes = snapshotWrites(state.writes);
  assertEquals(writes.length, 1, "exactly one snapshot write");
  assert(
    state.writes.indexOf(writes[0]) < firstRecipientWrite(state.writes),
    "the snapshot lands before the first marketing_messages row",
  );
  assert(
    writes[0].filters.some(([m, c, v]) => m === "is" && c === "sent_snapshot" && v === null),
    "the write is guarded WHERE sent_snapshot IS NULL",
  );
  // deno-lint-ignore no-explicit-any
  const snap = (writes[0].payload as any).sent_snapshot;
  assertEquals(snap.v, 1);
  assertEquals(snap.kind, "email");
  assertEquals(snap.from_display, "Lantern Room");
  assertEquals(snap.from_address, "lanternroom@campaigns.usemingla.com");
  assertEquals(snap.reply_to_is_brand, true);
  assertEquals(snap.header_image_url, "https://cdn.example/cover.jpg");
  assertEquals(snap.subject, "Hi {first_name}, {brand_name} is back");
  assertEquals(snap.campaign_variables.next_event_name, "Rooftop Night");
  assertEquals(snap.campaign_variables.brand_name, "Lantern Room");
  assertEquals(snap.per_guest_tokens, ["first_name", "event_name", "previous_event_name"]);
  assertEquals(snap.embedded_events.length, 1);
  assertEquals(snap.embedded_events[0].title, "Rooftop Night");
  assertStringIncludes(snap.embedded_events[0].url, "/e/lantern-room/rooftop-night");
  assertStringIncludes(String(snap.follow_url), "lantern-room");
  assertNoContacts(JSON.stringify(snap));
});

// ── T-2 ─────────────────────────────────────────────────────────────────────
Deno.test("#4273 T-2 an SMS snapshot is the adapter's text with one sample link, and its segments", async () => {
  const state = { writes: [] as Write[], rpcs: [] as string[] };
  const realSend = smsAdapter.send;
  const sent: Array<{ message: string; stopFooterOwnLine?: boolean }> = [];
  // 13:00 in Lagos: inside the marketing send window.
  const time = new FakeTime(new Date("2026-11-09T12:00:00Z"));
  smsAdapter.send = (input) => {
    sent.push({ message: input.message, stopFooterOwnLine: input.stopFooterOwnLine });
    return Promise.resolve({
      ok: true,
      status: "sent",
      providerMessageId: "SM-test",
      provider: "termii",
      segments: computeSegments(composeSmsBody(input.message, input.stopFooterOwnLine === true)),
      // deno-lint-ignore no-explicit-any
    } as any);
  };
  try {
    const summary = await processClaimedCampaigns(
      makeFake(state),
      // deno-lint-ignore no-explicit-any
      [campaign("sms", {
        kind: "sms",
        body: "Lantern Room: doors at 9. Tickets https://tix.example/rooftop now.",
        include_follow_cta: true,
      })] as any,
      { live: true, resendApiKey: "re_test_key" },
    );
    assertEquals(summary.failed, 0, JSON.stringify(summary.errors));
  } finally {
    smsAdapter.send = realSend;
    time.restore();
  }
  assertEquals(sent.length, 1, "one text handed to the adapter");
  assertEquals(sent[0].stopFooterOwnLine, true);
  const writes = snapshotWrites(state.writes);
  assertEquals(writes.length, 1);
  assert(state.writes.indexOf(writes[0]) < firstRecipientWrite(state.writes));
  // deno-lint-ignore no-explicit-any
  const snap = (writes[0].payload as any).sent_snapshot;
  assertEquals(snap.kind, "sms");
  // SC-5: the adapter's own text with the guest's tracking id swapped for the sample.
  const guestIds = sent[0].message.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
  assert(guestIds.length >= 1, "the real text carried a short link");
  let swapped = sent[0].message;
  for (const id of guestIds) swapped = swapped.replaceAll(id, SAMPLE_TRACKING_ID);
  assertEquals(snap.wire_text, composeSmsBody(swapped, true));
  assertStringIncludes(snap.wire_text, "Reply STOP to opt out.");
  assertStringIncludes(snap.wire_text, "Follow Lantern Room: https://usemingla.com/m/" + SAMPLE_TRACKING_ID);
  const upsert = state.writes.find((w) =>
    w.table === "marketing_messages" && w.op === "upsert" &&
    (w.payload as Record<string, unknown>).status === "queued"
  );
  assertEquals(snap.segments, (upsert?.payload as Record<string, unknown>).segments);
  assertEquals(snap.encoding, "GSM-7");
  assertEquals(snap.links_shortened, true);
  assertEquals(snap.follow_included, true);
  assertEquals(snap.body_as_authored, "Lantern Room: doors at 9. Tickets https://tix.example/rooftop now.");
  assertNoContacts(JSON.stringify(snap).replace("https://tix.example/rooftop", ""));
});

Deno.test("#4273 T-2b the encoding probe matches the provider's GSM-7 table", () => {
  assertEquals(smsEncoding("Doors at 9 [late] €5", false), "GSM-7");
  assertEquals(smsEncoding("Doors at 9 \u{1F389}", false), "UCS-2");
  assertEquals(smsEncoding("Doors at 9", true), "MMS");
});

// ── T-3 ─────────────────────────────────────────────────────────────────────
Deno.test("#4273 T-3 a push snapshot holds one rendered push per reason, as each guest got it", async () => {
  const writes: Write[] = [];
  const payloads: Array<Record<string, unknown>> = [];
  const client = {
    rpc: () =>
      Promise.resolve({
        data: {
          brandName: "Lantern Room",
          brandSlug: "lantern-room",
          eventSlug: null,
          body: "Doors at 9 tonight.",
          title: "Rooftop is back",
          work: [
            { messageId: "m-1", userId: "42730000-0000-4000-8000-0000000000f1", reason: "follower" },
            { messageId: "m-2", userId: "42730000-0000-4000-8000-0000000000f2", reason: "book" },
            { messageId: "m-3", userId: "42730000-0000-4000-8000-0000000000f3", reason: "follower" },
          ],
        },
        error: null,
      }),
    from: (table: string) => {
      const filters: Array<[string, string, unknown]> = [];
      const chain: Record<string, unknown> = {};
      chain.update = (payload: unknown) => {
        writes.push({ table, op: "update", payload, filters });
        return chain;
      };
      chain.eq = (c: string, v: unknown) => { filters.push(["eq", c, v]); return chain; };
      chain.is = (c: string, v: unknown) => { filters.push(["is", c, v]); return chain; };
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ error: null });
      return chain;
    },
  };
  const outcome = await sendPushCampaign(client, { id: CAMPAIGN_ID, brand_id: BRAND_ID }, (_c, input) => {
    payloads.push(input.payload as Record<string, unknown>);
    return Promise.resolve({
      success: true,
      notificationId: null,
      deliveries: [{ channel: "push", status: "sent" }],
      // deno-lint-ignore no-explicit-any
    } as any);
  });
  assertEquals(outcome.delivered, 3);
  const snaps = snapshotWrites(writes);
  assertEquals(snaps.length, 1);
  assert(writes.indexOf(snaps[0]) < writes.findIndex((w) => w.table === "marketing_push_messages"));
  // deno-lint-ignore no-explicit-any
  const snap = (snaps[0].payload as any).sent_snapshot;
  assertEquals(snap.kind, "push");
  assertEquals(snap.title, "Rooftop is back");
  assertEquals(snap.variants.map((v: { reason: string }) => v.reason), ["follower", "book"]);
  for (const variant of snap.variants) {
    const payload = payloads.find((p) => p.reason === variant.reason);
    assert(payload !== undefined);
    const rendered = renderBrandReachMessage(BRAND_CAMPAIGN_PUSH_CATEGORY, payload).push;
    assertEquals({ title: variant.title, body: variant.body }, rendered);
  }
  assertStringIncludes(String(snap.deep_link), "/b/lantern-room");
  assert(!JSON.stringify(snap).includes("0000000000f1"), "no user id in the push snapshot");
});

// ── T-4 ─────────────────────────────────────────────────────────────────────
Deno.test("#4273 T-4 a refused campaign writes no snapshot", async () => {
  for (const [channel, payload] of [
    ["email", { kind: "email", subject: "Hi", body_html: "" }],
    ["email", { kind: "email", subject: "", body_html: "<p>Doors at 9</p>" }],
    ["sms", { kind: "sms", body: "   " }],
  ] as const) {
    const state = { writes: [] as Write[], rpcs: [] as string[] };
    const summary = await processClaimedCampaigns(
      makeFake(state),
      // deno-lint-ignore no-explicit-any
      [campaign(channel, payload)] as any,
      { live: false, resendApiKey: "re_test_key" },
    );
    assertEquals(summary.failed, 1);
    assertEquals(snapshotWrites(state.writes).length, 0, `${channel} refused must not snapshot`);
  }
  const pushWrites: Write[] = [];
  let threw = false;
  try {
    await sendPushCampaign({
      rpc: () => Promise.resolve({ data: { brandName: "B", brandSlug: null, eventSlug: null, body: " ", work: [{ messageId: "m", userId: "u", reason: "follower" }] }, error: null }),
      from: (table: string) => ({ update: (p: unknown) => { pushWrites.push({ table, op: "update", payload: p, filters: [] }); return { eq: () => ({}) }; } }),
    }, { id: CAMPAIGN_ID, brand_id: BRAND_ID }, () => Promise.reject(new Error("never")));
  } catch (error) {
    threw = String(error).includes("push_body_empty");
  }
  assert(threw, "an empty push is refused");
  assertEquals(pushWrites.length, 0);
});

// ── T-5 ─────────────────────────────────────────────────────────────────────
Deno.test("#4273 T-5 a failed snapshot write is logged and the send goes on", async () => {
  const state = { writes: [] as Write[], rpcs: [] as string[] };
  const errors: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    Deno.env.set("UNSUBSCRIBE_TOKEN_SECRET", "issue-4273-test-secret-not-a-real-key-0123456789");
    const summary = await processClaimedCampaigns(
      makeFake(state, { snapshotError: true }),
      // deno-lint-ignore no-explicit-any
      [campaign("email", { kind: "email", subject: "Doors", body_html: "<p>Doors at 9</p>", embedded_events: [] })] as any,
      { live: false, resendApiKey: "re_test_key" },
    );
    assertEquals(summary.failed, 0);
    assertEquals(summary.preview_skipped, 1, "the guest was still processed");
  } finally {
    console.error = realError;
  }
  assert(errors.some((line) => line.includes("[#4273] sent_snapshot_write_failed")), errors.join("\n"));
});
