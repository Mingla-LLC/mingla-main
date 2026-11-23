// #4490 spec 08 O1 — venue-till edge function: verified identity only, the
// server prices every round (the body's prices are ignored), held rounds,
// replay safety, send pushes, the one payment path, and safe error codes.
import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createVenueTillHandler,
  type TillClient,
  tillSafeCode,
} from "./index.ts";

const VENUE = "00000000-4490-4000-8000-0000000000a1";
const OTHER_VENUE = "00000000-4490-4000-8000-0000000000a2";
const BRAND = "00000000-4490-4000-8000-0000000000b0";
const SALE = "00000000-4490-4000-8000-0000000000c1";
const SESSION = "00000000-4490-4000-8000-0000000000c2";
const MENU = "00000000-4490-4000-8000-0000000000d1";
const ITEM = "00000000-4490-4000-8000-0000000000d2";
const STAFF = "00000000-4490-4000-8000-0000000000f1";
const PAYMENT = "00000000-4490-4000-8000-0000000000e1";
const REQ = "00000000-4490-4000-8000-0000000000e2";

type Row = Record<string, unknown>;
type Call = { name: string; params: Record<string, unknown> };

// A tiny in-memory stand-in for the supabase-js query builder.
function fakeDb(tables: Record<string, Row[]>) {
  const inserts: Array<{ table: string; rows: Row[] }> = [];
  const updates: Array<{ table: string; patch: Row; filters: Array<[string, unknown]> }> = [];
  function from(table: string) {
    const filters: Array<[string, unknown, "eq" | "in"]> = [];
    let mode: "select" | "insert" | "update" = "select";
    let payload: Row[] | Row | null = null;
    const rows = () =>
      (tables[table] ?? []).filter((r) =>
        filters.every(([c, v, op]) =>
          op === "eq" ? r[c] === v : (v as unknown[]).includes(r[c])
        )
      );
    const run = () => {
      if (mode === "insert") {
        const list = Array.isArray(payload) ? payload : [payload as Row];
        inserts.push({ table, rows: list });
        const withIds = list.map((r, i) => ({ id: r.id ?? `${table}-${i}`, ...r }));
        tables[table] = [...(tables[table] ?? []), ...withIds];
        return { data: withIds, error: null };
      }
      if (mode === "update") {
        updates.push({ table, patch: payload as Row, filters: filters.map(([c, v]) => [c, v]) });
        for (const r of rows()) Object.assign(r, payload);
        return { data: null, error: null };
      }
      return { data: rows(), error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (c: string, v: unknown) => {
        filters.push([c, v, "eq"]);
        return builder;
      },
      in: (c: string, v: unknown[]) => {
        filters.push([c, v, "in"]);
        return builder;
      },
      insert: (p: Row[] | Row) => {
        mode = "insert";
        payload = p;
        return builder;
      },
      update: (p: Row) => {
        mode = "update";
        payload = p;
        return builder;
      },
      maybeSingle: () => {
        const r = run();
        const list = (r.data ?? []) as Row[];
        return Promise.resolve({ data: list[0] ?? null, error: null });
      },
      single: () => {
        const r = run();
        return Promise.resolve({ data: ((r.data ?? []) as Row[])[0], error: null });
      },
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return builder;
  }
  return { from, inserts, updates };
}

function makeClient(opts: {
  calls: Call[];
  rpc: (name: string, params: Record<string, unknown>) => { data: unknown; error: unknown };
  user?: string | null;
  tables?: Record<string, Row[]>;
}) {
  const db = fakeDb(opts.tables ?? baseTables());
  const user = opts.user === undefined ? STAFF : opts.user;
  const client: TillClient = {
    from: db.from,
    rpc: (name: string, params: Record<string, unknown>) => {
      // TEST-MOD-APPROVED #4490 (08-O5 part A): the PIN gate answers "not a Till device" for these accounts, as the database does.
      if (name === "issue_4490_pin_gate") return Promise.resolve({ data: false, error: null });
      opts.calls.push({ name, params });
      return Promise.resolve(opts.rpc(name, params));
    },
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: user ? { id: user } : null },
          error: user ? null : new Error("bad"),
        }),
    },
  };
  return { client, db };
}

function baseTables(): Record<string, Row[]> {
  return {
    venue_till_sales: [{
      id: SALE,
      venue_id: VENUE,
      brand_id: BRAND,
      session_id: SESSION,
      qr_spot_id: null,
      currency: "NGN",
      state: "open",
      version: 3,
      check_label: null,
    }],
    venue_orders: [],
    venue_order_items: [],
    venue_order_item_modifiers: [],
    venue_ordering_settings: [{ venue_id: VENUE, service_charge_bps: 1000 }],
    menu_items: [{
      id: ITEM,
      menu_id: MENU,
      brand_id: BRAND,
      name: "Chapman",
      price_cents: 250000,
      currency: "NGN",
      is_available: true,
      discounts_allowed: true,
    }],
    menus: [{
      id: MENU,
      venue_id: VENUE,
      is_active: true,
      service_window_start: null,
      service_window_end: null,
      service_days: null,
    }],
    menu_modifier_groups: [],
    menu_modifiers: [],
    brand_venue_timezones: [],
    venue_listings: [{ id: VENUE, brand_id: BRAND, timezone: "Africa/Lagos" }],
    brands: [{ id: BRAND, timezone: "Africa/Lagos" }],
  };
}

function req(body: Record<string, unknown>, jwt: string | null = "staff.jwt.sig"): Request {
  return new Request("http://local/venue-till", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const env = (name: string) =>
  ({ SUPABASE_URL: "http://kong:8000", SUPABASE_SERVICE_ROLE_KEY: "service-key" } as Record<string, string>)[name];

const saleProjection = { id: SALE, version: 4, state: "open", lines: [] };

Deno.test("O1-E1 no bearer, a bad bearer or the service key itself is refused before any RPC", async () => {
  for (const jwt of [null, "service-key"]) {
    const calls: Call[] = [];
    const { client } = makeClient({ calls, rpc: () => ({ data: null, error: null }) });
    const res = await createVenueTillHandler({ env, client: () => client })(
      req({ action: "checks", venueId: VENUE }, jwt),
    );
    assertEquals(res.status, 401);
    assertEquals(calls.length, 0);
  }
  const calls: Call[] = [];
  const { client } = makeClient({ calls, rpc: () => ({ data: null, error: null }), user: null });
  const res = await createVenueTillHandler({ env, client: () => client })(
    req({ action: "checks", venueId: VENUE }),
  );
  assertEquals(res.status, 401);
  assertEquals(calls.length, 0);
});

Deno.test("O1-E2 open passes the verified user, never one from the body", async () => {
  const calls: Call[] = [];
  const { client } = makeClient({ calls, rpc: () => ({ data: saleProjection, error: null }) });
  const res = await createVenueTillHandler({ env, client: () => client })(req({
    action: "open",
    venueId: VENUE,
    label: "Ada",
    idempotencyKey: "open-key-0001",
    actor: "00000000-0000-4000-8000-000000000666",
  }));
  assertEquals(res.status, 200);
  assertEquals(calls[0].name, "issue_4490_till_open");
  assertEquals(calls[0].params.p_actor, STAFF);
  assertEquals(calls[0].params.p_label, "Ada");
  assertEquals((await res.json()).data.sale.id, SALE);
});

Deno.test("O1-E3 add_menu prices on the server, inserts a held venue_collected round, ignores body prices", async () => {
  const calls: Call[] = [];
  const { client, db } = makeClient({
    calls,
    rpc: (name) =>
      name === "issue_4490_can_sell"
        ? { data: true, error: null }
        : name === "pg_venue_order_next_pickup_code"
        ? { data: "104", error: null }
        : { data: saleProjection, error: null },
  });
  const res = await createVenueTillHandler({ env, client: () => client })(req({
    action: "add_menu",
    venueId: VENUE,
    saleId: SALE,
    send: false,
    idempotencyKey: "round-key-0001",
    expectedVersion: 3,
    lines: [{ menuItemId: ITEM, quantity: 2, modifierIds: [], notes: "no ice", priceMinor: 1 }],
  }));
  assertEquals(res.status, 200);
  const order = db.inserts.find((i) => i.table === "venue_orders")!.rows[0];
  assertEquals(order.subtotal_cents, 500000);
  assertEquals(order.service_charge_cents, 50000);
  assertEquals(order.total_cents, 550000);
  assertEquals(order.money_path, "venue_collected");
  assertEquals(order.fulfillment_status, "held");
  assertEquals(order.mingla_fee_cents, 0);
  assertEquals(order.tip_cents, 0);
  assertEquals(order.taken_by_user_id, STAFF);
  assertEquals(order.pickup_code, "104");
  assertEquals((order.metadata as Row).till_sale_id, SALE);
  const items = db.inserts.find((i) => i.table === "venue_order_items")!.rows;
  assertEquals(items[0].unit_price_cents, 250000);
  assertEquals(items[0].notes, "no ice");
  const attach = calls.find((c) => c.name === "issue_4490_till_attach_round")!;
  assertEquals(attach.params.p_expected_version, 3);
  assertFalse(calls.some((c) => c.name === "issue_4490_till_send"));
});

Deno.test("O1-E4 a replayed add_menu re-attaches the existing round and inserts nothing", async () => {
  const calls: Call[] = [];
  const tables = baseTables();
  tables.venue_orders.push({
    id: "00000000-4490-4000-8000-0000000000aa",
    venue_id: VENUE,
    idempotency_key: `till:${SALE}:round-key-0001`,
  });
  const { client, db } = makeClient({
    calls,
    tables,
    rpc: (name) => name === "issue_4490_can_sell" ? { data: true, error: null } : { data: saleProjection, error: null },
  });
  const res = await createVenueTillHandler({ env, client: () => client })(req({
    action: "add_menu",
    venueId: VENUE,
    saleId: SALE,
    send: false,
    idempotencyKey: "round-key-0001",
    lines: [{ menuItemId: ITEM, quantity: 2, modifierIds: [] }],
  }));
  assertEquals(res.status, 200);
  assertEquals(db.inserts.length, 0);
  assertEquals((await res.json()).data.replayed, true);
  const attach = calls.find((c) => c.name === "issue_4490_till_attach_round")!;
  assertEquals(attach.params.p_order_id, "00000000-4490-4000-8000-0000000000aa");
});

Deno.test("O1-E5 add_menu with send fires the new-order push for each sent round", async () => {
  const calls: Call[] = [];
  const pushed: string[] = [];
  const { client } = makeClient({
    calls,
    rpc: (name) =>
      name === "issue_4490_can_sell"
        ? { data: true, error: null }
        : name === "pg_venue_order_next_pickup_code"
        ? { data: "105", error: null }
        : name === "issue_4490_till_send"
        ? { data: { ...saleProjection, sentOrderIds: ["r1", "r2"] }, error: null }
        : { data: saleProjection, error: null },
  });
  const res = await createVenueTillHandler({
    env,
    client: () => client,
    notifyPlaced: (_c, id) => {
      pushed.push(id);
      return Promise.resolve();
    },
  })(req({
    action: "add_menu",
    venueId: VENUE,
    saleId: SALE,
    send: true,
    idempotencyKey: "round-key-0002",
    lines: [{ menuItemId: ITEM, quantity: 1, modifierIds: [] }],
  }));
  assertEquals(res.status, 200);
  assertEquals(pushed, ["r1", "r2"]);
});

Deno.test("O1-E6 a sale of another venue is not found; an item that cannot be ordered is named", async () => {
  const calls: Call[] = [];
  const { client } = makeClient({
    calls,
    rpc: (name) => name === "issue_4490_can_sell" ? { data: true, error: null } : { data: saleProjection, error: null },
  });
  const handler = createVenueTillHandler({ env, client: () => client });
  const res = await handler(req({
    action: "void",
    venueId: OTHER_VENUE,
    saleId: SALE,
    lineId: ITEM,
    reason: "mistake",
    expectedVersion: 3,
  }));
  assertEquals(res.status, 404);
  assertEquals((await res.json()).code, "till_sale_not_found");

  const tables = baseTables();
  (tables.menu_items[0] as Row).is_available = false;
  const second = makeClient({
    calls,
    tables,
    rpc: (name) => name === "issue_4490_can_sell" ? { data: true, error: null } : { data: saleProjection, error: null },
  });
  const res2 = await createVenueTillHandler({ env, client: () => second.client })(req({
    action: "add_menu",
    venueId: VENUE,
    saleId: SALE,
    idempotencyKey: "round-key-0003",
    lines: [{ menuItemId: ITEM, quantity: 1, modifierIds: [] }],
  }));
  assertEquals(res2.status, 409);
  const body = await res2.json();
  assertEquals(body.code, "till_item_not_orderable");
  assertEquals(body.item, "Chapman");
});

Deno.test("O1-E7 pay_cash sends amount, tip, cash given, the verified user and the version to the one payment RPC", async () => {
  const calls: Call[] = [];
  const { client } = makeClient({
    calls,
    rpc: () => ({
      data: { paymentId: PAYMENT, changeMinor: 75000, replayed: false, sale: saleProjection },
      error: null,
    }),
  });
  const res = await createVenueTillHandler({ env, client: () => client })(req({
    action: "pay_cash",
    venueId: VENUE,
    saleId: SALE,
    amountMinor: 525000,
    tipMinor: 0,
    cashGivenMinor: 600000,
    clientRequestId: REQ,
    expectedVersion: 7,
  }));
  assertEquals(res.status, 200);
  const pay = calls.find((c) => c.name === "issue_4490_till_take_payment")!;
  assertEquals(pay.params, {
    p_sale_id: SALE,
    p_method: "cash",
    p_amount_minor: 525000,
    p_tip_minor: 0,
    p_cash_given_minor: 600000,
    p_actor: STAFF,
    p_device_user: STAFF,
    p_client_request_id: REQ,
    p_expected_version: 7,
  });
  assertEquals((await res.json()).data.changeMinor, 75000);
});

Deno.test("O1-E8 payments without a version, with a transfer method, or above the cap never reach the database", async () => {
  const calls: Call[] = [];
  const { client } = makeClient({ calls, rpc: () => ({ data: null, error: null }) });
  const handler = createVenueTillHandler({ env, client: () => client });
  const noVersion = await handler(req({
    action: "pay_own_machine",
    venueId: VENUE,
    saleId: SALE,
    amountMinor: 1000,
    tipMinor: 0,
    clientRequestId: REQ,
  }));
  assertEquals(noVersion.status, 400);
  const transfer = await handler(req({
    action: "pay_transfer",
    venueId: VENUE,
    saleId: SALE,
    amountMinor: 1000,
  }));
  assertEquals((await transfer.json()).code, "unknown_action");
  const huge = await handler(req({
    action: "pay_own_machine",
    venueId: VENUE,
    saleId: SALE,
    amountMinor: 2147483647,
    tipMinor: 1,
    clientRequestId: REQ,
    expectedVersion: 1,
  }));
  assertEquals((await huge.json()).code, "till_payment_too_large");
  assertFalse(calls.some((c) => c.name === "issue_4490_till_take_payment"));
});

Deno.test("O1-E9 database refusals map to safe codes and statuses; raw text never leaks", async () => {
  const cases: Array<[{ message: string; code: string }, number, string]> = [
    [{ message: "till_check_changed", code: "PT409" }, 409, "till_check_changed"],
    [{ message: "till_void_needs_money_rights", code: "42501" }, 403, "till_void_needs_money_rights"],
    [{ message: "till_not_enabled", code: "P0001" }, 422, "till_not_enabled"],
    [{ message: "duplicate key value violates unique constraint \"x\"", code: "23505" }, 500, "till_failed"],
  ];
  for (const [error, status, code] of cases) {
    const calls: Call[] = [];
    const { client } = makeClient({ calls, rpc: () => ({ data: null, error }) });
    const res = await createVenueTillHandler({ env, client: () => client })(
      req({ action: "checks", venueId: VENUE }),
    );
    assertEquals(res.status, status);
    const body = await res.json();
    assertEquals(body.code, code);
    assertFalse(JSON.stringify(body).includes("duplicate key"));
  }
  assertEquals(tillSafeCode({ message: "offer_amount_over_balance" }), "offer_amount_over_balance");
  assertEquals(tillSafeCode({ message: "something else" }), "till_failed");
});

Deno.test("O1-E10 a refund for a payment of another venue is refused before the refund RPC", async () => {
  const calls: Call[] = [];
  const tables = baseTables();
  tables.venue_till_payments = [{ id: PAYMENT, sale_id: SALE, venue_till_sales: { venue_id: OTHER_VENUE } }];
  const { client } = makeClient({ calls, tables, rpc: () => ({ data: {}, error: null }) });
  const res = await createVenueTillHandler({ env, client: () => client })(req({
    action: "refund",
    venueId: VENUE,
    paymentId: PAYMENT,
    amountMinor: 1000,
    tipMinor: 0,
    reason: "wrong_item",
    clientRequestId: REQ,
  }));
  assertEquals(res.status, 404);
  assertFalse(calls.some((c) => c.name === "issue_4490_till_refund"));
});

Deno.test("O1-E11 quote returns the server's sale; card totals are not offered before O2", async () => {
  const calls: Call[] = [];
  const { client } = makeClient({
    calls,
    rpc: (name) => name === "issue_4490_can_sell" ? { data: true, error: null } : { data: saleProjection, error: null },
  });
  const res = await createVenueTillHandler({ env, client: () => client })(
    req({ action: "quote", venueId: VENUE, saleId: SALE }),
  );
  const body = await res.json();
  assertEquals(body.data.cardTotalMinor, null);
  assertEquals(body.data.sale.id, SALE);
  assert(calls.some((c) => c.name === "issue_4490_till_sale_projection"));
});
