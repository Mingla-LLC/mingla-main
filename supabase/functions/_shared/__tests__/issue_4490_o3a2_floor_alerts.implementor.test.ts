// #4490 spec 08 O3 part A2 — floor alerts on the shared notify rail:
//   T4 "New order" and escalation rung 1 also reach the venue's Kitchen / bar
//      and Till-device logins (that venue only), de-duplicated, one dispatch
//      per person; rungs 2 and 3 unchanged.
//   T5 the person who sent a Till round (and the check's server) is told when
//      a station marks it ready; guest orders get no push.
//   T7 rung 1 for a sent Till round also tells its sender, without guest lines.
// Deploy order: before migration 20281203604490 the floor read is missing and
// the brand roles are told exactly as before.
//
// FAILS-ON-REVERT: drop the floor recipients from fireVenueOrderPlaced and N1
// fails; drop fireVenueOrderReady's sender read and N4 fails; drop the sender
// from rung 1 and N3 fails; let a floor read error throw and N2 fails.
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  fireVenueOrderEscalation,
  fireVenueOrderPlaced,
  fireVenueOrderReady,
  tillRoundSenders,
  venueOrderReadyCopy,
} from "../venueOrderNotify.ts";
import { handleStationAction } from "../../venue-order-staff/stationActions.ts";

const BRAND = "44900a00-0000-4000-9000-000000000010";
const VENUE_A = "44900a00-0000-4000-9000-0000000000a1";
const VENUE_B = "44900a00-0000-4000-9000-0000000000b1";
const ORDER = "44900a00-0000-4000-e000-000000000001";
const OWNER = "44900a00-0000-4000-8000-000000000001";
const MANAGER = "44900a00-0000-4000-8000-00000000000e";
const KITCHEN_A = "44900a00-0000-4000-8000-000000000002";
const DEVICE_A = "44900a00-0000-4000-8000-000000000005";
const KITCHEN_B = "44900a00-0000-4000-8000-000000000009";
const SELLER = "44900a00-0000-4000-8000-000000000003";
const SERVER = "44900a00-0000-4000-8000-000000000007";

type Row = Record<string, unknown>;

function world(opts: { floorError?: { code: string; message: string }; order?: Row; sale?: Row | null } = {}) {
  const rpcs: Array<{ name: string; args: Row }> = [];
  const roleQueries: string[][] = [];
  const client = {
    rpc: (name: string, args: Row) => {
      rpcs.push({ name, args });
      if (name === "issue_4490_venue_floor_user_ids") {
        if (opts.floorError) return Promise.resolve({ data: null, error: opts.floorError });
        // The same Kitchen / bar profile exists at both venues; each venue answers its own.
        const ids = args.p_venue_id === VENUE_A ? [KITCHEN_A, DEVICE_A, OWNER] : [KITCHEN_B];
        return Promise.resolve({ data: ids, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      let roles: string[] = [];
      const answer = () => {
        if (table === "brand_team_members") {
          roleQueries.push(roles);
          const all = [{ user_id: OWNER, role: "brand_owner" }, { user_id: MANAGER, role: "event_manager" }];
          return { data: all.filter((r) => roles.includes(r.role)), error: null };
        }
        if (table === "venue_orders") {
          return { data: opts.order ?? { id: ORDER, brand_id: BRAND, venue_id: VENUE_A, session_id: "s1", source: "staff", taken_by_user_id: SELLER }, error: null };
        }
        if (table === "venue_till_sales") return { data: opts.sale === undefined ? { id: "sale1", server_user_id: SERVER } : opts.sale, error: null };
        return { data: null, error: null };
      };
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q, is: () => q, not: () => q,
        in: (_c: string, v: string[]) => ((roles = v), q),
        maybeSingle: () => Promise.resolve(answer()),
        then: (resolve: (v: unknown) => void) => resolve(answer()),
      };
      return q;
    },
  };
  return { client, rpcs, roleQueries };
}

async function withDispatch(run: () => Promise<void>): Promise<Row[]> {
  const sent: Row[] = [];
  const realFetch = globalThis.fetch;
  Deno.env.set("SUPABASE_URL", "http://local.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body ?? "{}")));
    return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
  }
  return sent;
}

const placed = (venueId: string) => ({
  orderId: ORDER, brandId: BRAND, venueId, currency: "NGN", totalCents: 550000, itemCount: 2, spotLabel: "Table 4",
});

Deno.test("N1 T4: New order reaches brand roles AND that venue's Kitchen / bar and Till-device logins, once each", async () => {
  const w = world();
  const sent = await withDispatch(() => fireVenueOrderPlaced(w.client, placed(VENUE_A)));
  const users = sent.map((s) => s.userId).sort();
  assertEquals(users, [DEVICE_A, KITCHEN_A, MANAGER, OWNER].sort(), "owner listed twice is told once");
  assertEquals(new Set(sent.map((s) => s.idempotencyKey)).size, 4);
  for (const s of sent) {
    assertEquals(s.idempotencyKey, `business.venue_order_placed:${ORDER}:${s.userId}`);
    assertEquals(s.type, "business.venue_order_placed");
    assertEquals(s.title, "New order · Table 4");
    assert(!("roles" in s));
  }
  assertEquals(w.rpcs[0].args, { p_brand_id: BRAND, p_venue_id: VENUE_A, p_caps: ["venue.kitchen", "restaurant.manage_orders"] });
  assert(!users.includes(KITCHEN_B), "the same profile at another venue is not told");
});

Deno.test("N1b T4: an order at venue B tells B's kitchen, never A's", async () => {
  const w = world();
  const sent = await withDispatch(() => fireVenueOrderPlaced(w.client, placed(VENUE_B)));
  const users = sent.map((s) => s.userId);
  assert(users.includes(KITCHEN_B));
  assert(!users.includes(KITCHEN_A) && !users.includes(DEVICE_A));
});

Deno.test("N2 deploy order: no floor read yet (PGRST202) or a failed read -> the brand roles are told exactly as before", async () => {
  for (const code of ["PGRST202", "42883", "57014"]) {
    const w = world({ floorError: { code, message: "x" } });
    const sent = await withDispatch(() => fireVenueOrderPlaced(w.client, placed(VENUE_A)));
    assertEquals(sent.map((s) => s.userId).sort(), [MANAGER, OWNER].sort(), code);
    for (const s of sent) assertEquals(s.idempotencyKey, `business.venue_order_placed:${ORDER}:${s.userId}`);
  }
});

Deno.test("N3 T4 + T7: rung 1 adds floor staff and a Till round's sender; rungs 2 and 3 are unchanged", async () => {
  const base = { orderId: ORDER, brandId: BRAND, venueId: VENUE_A, venueName: "Palm", unackedSeconds: 180, currency: "NGN", totalCents: 1, spotLabel: "Table 6" };
  let w = world();
  let sent = await withDispatch(() => fireVenueOrderEscalation(w.client, { ...base, rung: 1, tillRound: true, takenByUserId: SELLER }));
  assertEquals(sent.map((s) => s.userId).sort(), [DEVICE_A, KITCHEN_A, MANAGER, OWNER, SELLER].sort());
  for (const s of sent) assertEquals(s.idempotencyKey, `business.venue_order_unacknowledged:${ORDER}:1:${s.userId}`);
  assertEquals(sent[0].body, "3 min and the kitchen hasn't accepted it yet.");
  w = world();
  sent = await withDispatch(() => fireVenueOrderEscalation(w.client, { ...base, rung: 1 }));
  assertEquals(sent.map((s) => s.userId).sort(), [DEVICE_A, KITCHEN_A, MANAGER, OWNER].sort(), "guest order rung 1: roles + floor, no sender");
  assertEquals(sent[0].body, "3 min and nobody has picked it up yet. Tap to acknowledge.");
  for (const rung of [2, 3] as const) {
    w = world();
    sent = await withDispatch(() => fireVenueOrderEscalation(w.client, { ...base, rung, tillRound: true, takenByUserId: SELLER }));
    assertEquals(w.rpcs.filter((r) => r.name === "issue_4490_venue_floor_user_ids").length, 0, `rung ${rung} reads no floor staff`);
    assert(!sent.some((s) => s.userId === SELLER || s.userId === KITCHEN_A), `rung ${rung} unchanged`);
    assert(!String(sent[0]?.body ?? "").includes("guest"), "a Till round never mentions a guest");
  }
  w = world();
  sent = await withDispatch(() => fireVenueOrderEscalation(w.client, { ...base, rung: 2 }));
  assert(String(sent[0].body).includes("The guest has been told"), "the guest-order rung 2 words are unchanged");
});

Deno.test("N4 T5: ready tells the sender and the check's server once each; a guest order tells nobody", async () => {
  let w = world();
  let sent = await withDispatch(async () => {
    assertEquals(await fireVenueOrderReady(w.client, { orderId: ORDER, station: "kitchen", destination: "Table 6", itemCount: 3 }), 2);
  });
  assertEquals(sent.map((s) => s.userId).sort(), [SELLER, SERVER].sort());
  assertEquals(sent[0].type, "business.venue_order_ready");
  assertEquals(sent[0].title, "Ready · Table 6");
  assertEquals(sent[0].body, "Kitchen: 3 items to take out.");
  assertEquals((sent[0].pushOverrides as Row).collapseId, `venue_order_ready:${ORDER}:kitchen`);
  assertEquals(sent[0].idempotencyKey, `business.venue_order_ready:${ORDER}:kitchen:${sent[0].userId}`);
  w = world({ sale: { id: "sale1", server_user_id: SELLER } });
  sent = await withDispatch(() => fireVenueOrderReady(w.client, { orderId: ORDER, station: "bar", destination: "Bar", itemCount: 1 }).then(() => undefined));
  assertEquals(sent.map((s) => s.userId), [SELLER], "sender = server: told once");
  w = world({ order: { id: ORDER, brand_id: BRAND, venue_id: VENUE_A, session_id: "s2", source: "guest_qr", taken_by_user_id: null } });
  sent = await withDispatch(() => fireVenueOrderReady(w.client, { orderId: ORDER, station: "kitchen", destination: "Table 2", itemCount: 1 }).then(() => undefined));
  assertEquals(sent.length, 0);
  assertEquals(venueOrderReadyCopy({ orderId: ORDER, station: "bar", destination: "Booth 2", itemCount: 1 }).body, "Bar: 1 item to take out.");
});

Deno.test("N5 T5: the station action tells on the first ready only, and a push failure never fails the tap", async () => {
  const respond = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status });
  const ticket = { orderId: ORDER, station: "kitchen", state: "ready", destination: "Table 6", lines: [{ quantity: 2 }, { quantity: 1, voided: true }] };
  const calls: unknown[] = [];
  const client = (data: unknown) => ({ rpc: () => Promise.resolve({ data, error: null }) });
  await handleStationAction(client({ already: false, ticket }), "ticket_ready", { orderId: ORDER, station: "kitchen" }, SELLER, respond, (i) => (calls.push(i), Promise.resolve()));
  assertEquals(calls, [{ orderId: ORDER, station: "kitchen", destination: "Table 6", itemCount: 2 }]);
  await handleStationAction(client({ already: true, ticket }), "ticket_ready", { orderId: ORDER, station: "kitchen" }, SELLER, respond, (i) => (calls.push(i), Promise.resolve()));
  await handleStationAction(client({ already: false, ticket: { ...ticket, state: "cooking" } }), "item_ready", { orderItemId: ORDER }, SELLER, respond, (i) => (calls.push(i), Promise.resolve()));
  assertEquals(calls.length, 1, "no push on a repeat or while the ticket is still cooking");
  await handleStationAction(client({ already: false, ticket }), "item_ready", { orderItemId: ORDER }, SELLER, respond, (i) => (calls.push(i), Promise.resolve()));
  assertEquals(calls.length, 2, "the last line through item_ready tells too");
  const res = await handleStationAction(client({ already: false, ticket }), "ticket_ready", { orderId: ORDER, station: "kitchen" }, SELLER, respond, () => Promise.reject(new Error("push down")));
  assertEquals(res.status, 200);
});

Deno.test("N6 T7: the sweep finds Till rounds and their senders among the scanned rows; a failed read drops only the extra", async () => {
  const rows = [
    { id: "o1", source: "staff", money_path: "venue_collected", sent_at: "2026-11-23T10:00:00Z", taken_by_user_id: SELLER },
    { id: "o2", source: "guest_qr", money_path: "mingla", sent_at: null, taken_by_user_id: null },
    { id: "o3", source: "staff", money_path: "venue_collected", sent_at: null, taken_by_user_id: SELLER },
  ];
  const q: Record<string, unknown> = {};
  Object.assign(q, { select: () => q, in: () => Promise.resolve({ data: rows, error: null }) });
  const map = await tillRoundSenders({ from: () => q }, ["o1", "o2", "o3"]);
  assertEquals([...map.entries()], [["o1", SELLER]]);
  const bad: Record<string, unknown> = {};
  Object.assign(bad, { select: () => bad, in: () => Promise.resolve({ data: null, error: { code: "42703" } }) });
  assertEquals((await tillRoundSenders({ from: () => bad }, ["o1"])).size, 0);
});
