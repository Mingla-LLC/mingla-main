// #4490 spec 08 O4 — venue-till: split bill, shares paid through the existing
// paths, staff-started sessions, "Add 30 min", seating a table, and the
// charge-to-room seam. The edge validates shapes and routes; the server
// computes every share, price and claim (proved in the pg17 suites).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createVenueTillHandler,
  type TillClient,
  tillFailure,
} from "./index.ts";

const VENUE = "00000000-4490-4000-8000-0000000006a1";
const BRAND = "00000000-4490-4000-8000-0000000006b0";
const SALE = "00000000-4490-4000-8000-0000000006c1";
const STAFF = "00000000-4490-4000-8000-0000000006f1";
const PAYMENT = "00000000-4490-4000-8000-0000000006e1";
const REQ = "00000000-4490-4000-8000-0000000006e9";

type Row = Record<string, unknown>;
type RpcAnswer = { data: unknown; error: unknown };

function world(
  rpcAnswer: (name: string, params: Row) => RpcAnswer,
  tables: Record<string, Row[]> = {},
) {
  const calls: Array<{ name: string; params: Row }> = [];
  const all: Record<string, Row[]> = {
    venue_till_sales: [{
      id: SALE,
      venue_id: VENUE,
      brand_id: BRAND,
      session_id: "s",
      qr_spot_id: null,
      currency: "NGN",
      state: "open",
      version: 3,
      check_label: "Ada",
    }],
    ...tables,
  };
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const rows = () =>
      (all[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      maybeSingle: () =>
        Promise.resolve({ data: rows()[0] ?? null, error: null }),
    };
    return b;
  };
  const client: TillClient = {
    auth: {
      getUser: (jwt: string) =>
        Promise.resolve(
          jwt === "staff-jwt"
            ? { data: { user: { id: STAFF } }, error: null }
            : { data: null, error: { message: "bad" } },
        ),
    },
    from,
    rpc: (name: string, params: Row) => {
      // TEST-MOD-APPROVED #4490 (08-O5 part A): the PIN gate answers "not a Till device" for these accounts, as the database does.
      if (name === "issue_4490_pin_gate") return Promise.resolve({ data: false, error: null });
      calls.push({ name, params });
      return Promise.resolve(rpcAnswer(name, params));
    },
  };
  const env: Record<string, string> = {
    SUPABASE_URL: "http://127.0.0.1:57521",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    BUSINESS_WEB_ORIGIN: "http://localhost:8491",
  };
  const handler = createVenueTillHandler({
    client: () => client,
    env: (n) => env[n],
    notifyPlaced: () => Promise.resolve(),
  });
  return { handler, calls };
}

const post = (body: Row) =>
  new Request("http://x/venue-till", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer staff-jwt",
    },
    body: JSON.stringify({ venueId: VENUE, ...body }),
  });

const SHARE = "00000000-4490-4000-8000-0000000006d1";
const ITEM = "00000000-4490-4000-8000-0000000006d2";
const LINE = "00000000-4490-4000-8000-0000000006d3";
const OFFER = "00000000-4490-4000-8000-0000000006d4";
const SPOT = "00000000-4490-4000-8000-0000000006d5";
const BOOKING = "00000000-4490-4000-8000-0000000006d6";

const okAnswer = (name: string): RpcAnswer => ({
  data: name === "issue_4490_till_pay_share" ||
      name === "issue_4490_till_take_payment"
    ? {
      paymentId: PAYMENT,
      replayed: false,
      method: "cash",
      amountMinor: 1000,
      tipMinor: 0,
      state: "paid",
      sale: { id: SALE },
    }
    : { id: SALE, version: 4 },
  error: null,
});

Deno.test("O4-E1 a share is paid through pay_share with the same money facts (cash and own machine)", async () => {
  for (const action of ["pay_cash", "pay_own_machine"]) {
    const { handler, calls } = world(okAnswer);
    const res = await handler(post({
      action,
      saleId: SALE,
      shareId: SHARE,
      amountMinor: 1000,
      tipMinor: 0,
      cashGivenMinor: action === "pay_cash" ? 1000 : undefined,
      clientRequestId: REQ,
      expectedVersion: 3,
    }));
    assertEquals(res.status, 200);
    const call = calls.find((c) => c.name.startsWith("issue_4490_till_"))!;
    assertEquals(call.name, "issue_4490_till_pay_share");
    assertEquals([
      call.params.p_share_id,
      call.params.p_amount_minor,
      call.params.p_expected_version,
      call.params.p_client_request_id,
    ], [SHARE, 1000, 3, REQ]);
  }
  // No share: the whole-check path, unchanged.
  const { handler, calls } = world(okAnswer);
  await handler(
    post({
      action: "pay_cash",
      saleId: SALE,
      amountMinor: 1000,
      tipMinor: 0,
      cashGivenMinor: 1000,
      clientRequestId: REQ,
      expectedVersion: 3,
    }),
  );
  assertEquals(
    calls.map((c) => c.name).includes("issue_4490_till_take_payment"),
    true,
  );
  assertEquals(calls.some((c) => "p_share_id" in c.params), false);
});

Deno.test("O4-E2 a malformed share id is refused before any money call", async () => {
  const { handler, calls } = world(okAnswer);
  const res = await handler(
    post({
      action: "pay_cash",
      saleId: SALE,
      shareId: "nope",
      amountMinor: 1000,
      tipMinor: 0,
      cashGivenMinor: 1000,
      clientRequestId: REQ,
      expectedVersion: 3,
    }),
  );
  assertEquals([res.status, (await res.json()).code], [
    400,
    "till_invalid_payload",
  ]);
  assertEquals(calls.length, 0);
});

Deno.test("O4-E3 set_split: even sends {count}, by item sends the units (never an amount), none clears; bad shapes refused", async () => {
  const w1 = world(okAnswer);
  let res = await w1.handler(
    post({
      action: "set_split",
      saleId: SALE,
      mode: "even",
      count: 3,
      expectedVersion: 3,
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(w1.calls[0].params, {
    p_sale_id: SALE,
    p_mode: "even",
    p_shares: { count: 3 },
    p_actor: STAFF,
    p_expected_version: 3,
  });
  const w2 = world(okAnswer);
  res = await w2.handler(
    post({
      action: "set_split",
      saleId: SALE,
      mode: "by_item",
      expectedVersion: 3,
      shares: [
        { items: [{ orderItemId: ITEM, units: 2, amountMinor: 1 }] },
        { items: [{ lineId: LINE, units: 1 }] },
      ],
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(w2.calls[0].params.p_shares, [{
    items: [{ orderItemId: ITEM, units: 2 }],
  }, { items: [{ lineId: LINE, units: 1 }] }]);
  const w3 = world(okAnswer);
  res = await w3.handler(
    post({
      action: "set_split",
      saleId: SALE,
      mode: "none",
      expectedVersion: 3,
    }),
  );
  assertEquals([res.status, w3.calls[0].params.p_mode], [200, "none"]);
  for (
    const bad of [
      { mode: "even", count: 1 },
      { mode: "even", count: 21 },
      { mode: "by_item", shares: [{ items: [] }] },
      {
        mode: "by_item",
        shares: [{ items: [{ orderItemId: ITEM, lineId: LINE, units: 1 }] }, {
          items: [{ lineId: LINE, units: 1 }],
        }],
      },
      {
        mode: "by_item",
        shares: [{ items: [{ orderItemId: ITEM, units: 0 }] }, {
          items: [{ lineId: LINE, units: 1 }],
        }],
      },
    ]
  ) {
    const w = world(okAnswer);
    res = await w.handler(
      post({ action: "set_split", saleId: SALE, expectedVersion: 3, ...bad }),
    );
    assertEquals([res.status, (await res.json()).code], [
      400,
      "till_split_invalid",
    ]);
    assertEquals(w.calls.length, 0);
  }
  const w4 = world(okAnswer);
  res = await w4.handler(
    post({ action: "set_split", saleId: SALE, mode: "even", count: 2 }),
  );
  assertEquals([res.status, (await res.json()).code], [
    400,
    "till_invalid_payload",
  ]);
});

Deno.test("O4-E4 every O4 refusal is a known code with the right status", async () => {
  const cases: Array<[string, string, number]> = [
    ["till_split_active", "PT409", 409],
    ["till_share_paid", "PT409", 409],
    ["till_share_paying", "PT409", 409],
    ["till_split_after_part_payment", "PT409", 409],
    ["till_split_even_only", "PT409", 409],
    ["till_split_invalid", "22023", 400],
    ["till_room_not_ready", "PT409", 409],
    ["offer_space_taken", "PT409", 409],
    ["offer_staff_start_off", "PT409", 409],
    ["deposit_already_used", "PT409", 409],
    ["till_booking_not_found", "P0002", 404],
    ["till_booking_other_table", "PT409", 409],
    ["till_booking_not_seatable", "PT409", 409],
    ["offer_length_invalid", "22023", 400],
  ];
  for (const [message, code, status] of cases) {
    const res = tillFailure({ message, code });
    assertEquals([res.status, (await res.json()).code], [status, message]);
  }
  // T13: the next booking's unit and time reach the Till.
  const res = tillFailure({
    message: "offer_space_taken",
    code: "PT409",
    details: JSON.stringify({
      unitName: "Pool table 1",
      nextAt: "2026-11-23T20:00:00+00:00",
    }),
  });
  assertEquals(await res.json(), {
    code: "offer_space_taken",
    unitName: "Pool table 1",
    nextAt: "2026-11-23T20:00:00+00:00",
  });
});

Deno.test("O4-E5 charge to room is refused by the server path (till_room_not_ready) and never succeeds", async () => {
  const { handler, calls } = world((name) =>
    name === "issue_4490_till_take_payment"
      ? { data: null, error: { message: "till_room_not_ready", code: "PT409" } }
      : okAnswer(name)
  );
  const res = await handler(
    post({ action: "pay_room", saleId: SALE, expectedVersion: 3 }),
  );
  assertEquals([res.status, (await res.json()).code], [
    409,
    "till_room_not_ready",
  ]);
  assertEquals(calls[0].params.p_method, "room");
  // Even if a database ever answered, the edge still refuses.
  const w = world(okAnswer);
  const res2 = await w.handler(
    post({ action: "pay_room", saleId: SALE, expectedVersion: 3 }),
  );
  assertEquals([res2.status, (await res2.json()).code], [
    409,
    "till_room_not_ready",
  ]);
});

Deno.test("O4-E6 seat, start_session and extend_session pass shapes through; no money in the body", async () => {
  let w = world(okAnswer);
  let res = await w.handler(
    post({
      action: "seat",
      spotId: SPOT,
      partySize: 4,
      reservationId: BOOKING,
      idempotencyKey: "seat-key-0001",
      amountMinor: 99,
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(w.calls[0].name, "issue_4490_till_seat");
  assertEquals(w.calls[0].params, {
    p_venue_id: VENUE,
    p_actor: STAFF,
    p_spot_id: SPOT,
    p_party_size: 4,
    p_reservation_id: BOOKING,
    p_label: null,
    p_server: null,
    p_idempotency_key: "seat-key-0001",
  });
  w = world(okAnswer);
  res = await w.handler(
    post({
      action: "start_session",
      saleId: SALE,
      offeringId: OFFER,
      minutes: 60,
      idempotencyKey: "start-key-0001",
      expectedVersion: 3,
    }),
  );
  assertEquals(res.status, 200);
  assertEquals([
    w.calls[0].name,
    w.calls[0].params.p_minutes,
    w.calls[0].params.p_space_id,
  ], ["issue_4490_till_start_session", 60, null]);
  w = world(okAnswer);
  res = await w.handler(
    post({
      action: "extend_session",
      saleId: SALE,
      lineId: LINE,
      minutes: 30,
      idempotencyKey: "extend-key-0001",
      expectedVersion: 3,
    }),
  );
  assertEquals(res.status, 200);
  assertEquals([
    w.calls[0].name,
    w.calls[0].params.p_line_id,
    w.calls[0].params.p_minutes,
  ], ["issue_4490_till_extend_session", LINE, 30]);
  for (
    const bad of [
      { action: "seat", spotId: "x", idempotencyKey: "seat-key-0002" },
      {
        action: "seat",
        spotId: SPOT,
        partySize: 0,
        idempotencyKey: "seat-key-0003",
      },
      {
        action: "start_session",
        saleId: SALE,
        offeringId: OFFER,
        minutes: 5,
        idempotencyKey: "start-key-0002",
        expectedVersion: 3,
      },
      {
        action: "start_session",
        saleId: SALE,
        offeringId: OFFER,
        minutes: 60,
        idempotencyKey: "start-key-0003",
      },
      {
        action: "extend_session",
        saleId: SALE,
        lineId: LINE,
        minutes: 300,
        idempotencyKey: "extend-key-0002",
        expectedVersion: 3,
      },
    ]
  ) {
    w = world(okAnswer);
    res = await w.handler(post(bad));
    assertEquals([res.status, (await res.json()).code], [
      400,
      "till_invalid_payload",
    ]);
    assertEquals(w.calls.length, 0);
  }
});

Deno.test("O4-E7 a share's scan / tap start prices the share (prepare_share), not the whole check", async () => {
  for (const action of ["pay_code_create", "pay_tap_start"]) {
    const { handler, calls } = world((name) =>
      name === "issue_4490_till_card_prepare_share"
        ? { data: null, error: { message: "till_share_paying", code: "PT409" } }
        : okAnswer(name)
    );
    const res = await handler(
      post({
        action,
        saleId: SALE,
        shareId: SHARE,
        tipMinor: 0,
        clientRequestId: REQ,
        expectedVersion: 3,
        platform: "ios",
      }),
    );
    assertEquals([res.status, (await res.json()).code], [
      409,
      "till_share_paying",
    ]);
    const prep = calls.find((c) => c.name.includes("card_prepare"))!;
    assertEquals([
      prep.name,
      prep.params.p_share_id,
      prep.params.p_expected_version,
    ], ["issue_4490_till_card_prepare_share", SHARE, 3]);
    assertEquals(
      calls.some((c) => c.name === "issue_4490_till_card_prepare"),
      false,
    );
  }
});
