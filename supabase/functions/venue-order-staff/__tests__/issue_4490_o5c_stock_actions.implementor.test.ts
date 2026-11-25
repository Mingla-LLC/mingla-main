// #4490 spec 08 O5 part C — venue-order-staff's stock actions, the one
// orderable rule in loadMenuSnapshot, and the guest's sold-out message.
// Run: deno test --allow-env --allow-read --no-check \
//   supabase/functions/venue-order-staff/__tests__/issue_4490_o5c_stock_actions.implementor.test.ts
import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleStockAction,
  STOCK_ACTIONS,
  STOCK_STATUS,
} from "../stockActions.ts";
import {
  isMissingStockColumn,
  loadMenuSnapshot,
  menuItemOrderable,
} from "../../_shared/venueOrderCore.ts";
import { renderCategoryMessage } from "../../_shared/notifyTemplates.ts";

const VENUE = "44900615-0000-4000-9000-0000000000a1";
const OTHER_VENUE = "44900615-0000-4000-9000-0000000000b1";
const ITEM = "44900615-0000-4000-b000-000000000011";
const ORDER = "44900615-0000-4000-e000-000000000001";
const LINE = "44900615-0000-4000-f000-000000000001";
const USER = "44900615-0000-4000-8000-000000000001";
const MEMBER = "44900615-0000-4000-8000-000000000002";
const TOKEN = "a".repeat(64);

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status });

type Answer = {
  data?: unknown;
  error?: { code?: string; message?: string; details?: string } | null;
};

/** A fake service client: rpc answers by name; one venue_orders read. */
function client(opts: {
  gated?: boolean;
  answers?: Record<string, Answer>;
  orderVenue?: string | null;
} = {}) {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const rpc = (name: string, params: Record<string, unknown>) => {
    calls.push({ name, params });
    if (name === "issue_4490_pin_gate") {
      return Promise.resolve({ data: opts.gated === true, error: null });
    }
    if (name === "issue_4490_pin_session_resolve") {
      return Promise.resolve({
        data: {
          ok: true,
          memberUserId: MEMBER,
          sessionId: "s1",
          memberId: "m1",
        },
        error: null,
      });
    }
    if (name === "issue_4490_stock_item_venue") {
      return Promise.resolve({ data: VENUE, error: null });
    }
    const a = opts.answers?.[name] ?? {};
    return Promise.resolve({ data: a.data ?? {}, error: a.error ?? null });
  };
  return {
    calls,
    rpc,
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: opts.orderVenue === null
                ? null
                : { id: ORDER, venue_id: opts.orderVenue ?? VENUE },
              error: null,
            }),
        }),
      }),
    }),
  };
}

const run = (
  c: ReturnType<typeof client>,
  action: string,
  body: Record<string, unknown>,
) =>
  handleStockAction(c, action, { venueId: VENUE, ...body }, {
    userId: USER,
    jwt: "jwt",
  }, respond);

Deno.test("K5C-E1 the five actions, and stock_set runs as the signed-in member", async () => {
  assertEquals([...STOCK_ACTIONS].sort(), [
    "order_sold_out",
    "sold_out_resolve",
    "station_sold_out",
    "station_stock",
    "stock_set",
  ]);
  const c = client({
    answers: {
      issue_4490_stock_set: {
        data: { menuItemId: ITEM, stockLeft: 2, tracked: true },
      },
    },
  });
  const res = await run(c, "stock_set", {
    menuItemId: ITEM,
    count: 2,
    warnAt: 1,
  });
  assertEquals(res.status, 200);
  const call = c.calls.find((x) => x.name === "issue_4490_stock_set")!;
  assertEquals(call.params, {
    p_item_id: ITEM,
    p_count: 2,
    p_warn_at: 1,
    p_actor: USER,
    p_device_user: USER,
  });
  assertEquals((await res.json()).stock.stockLeft, 2);
});

Deno.test("K5C-E2 stop tracking sends count null and drops the warning level", async () => {
  const c = client();
  await run(c, "stock_set", { menuItemId: ITEM, count: null, warnAt: 3 });
  const call = c.calls.find((x) => x.name === "issue_4490_stock_set")!;
  assertEquals(call.params.p_count, null);
  assertEquals(call.params.p_warn_at, null);
});

Deno.test("K5C-E3 bad counts are refused before any write", async () => {
  for (const count of [-1, 1.5, 100000, "3"]) {
    const c = client();
    const res = await run(c, "stock_set", { menuItemId: ITEM, count });
    assertEquals(res.status, 400);
    assertFalse(c.calls.some((x) => x.name === "issue_4490_stock_set"));
  }
});

Deno.test("K5C-E4 a Till device needs a PIN session for stock_set, resolve and the order read", async () => {
  for (const action of ["stock_set", "sold_out_resolve", "order_sold_out"]) {
    const c = client({ gated: true });
    const res = await run(c, action, {
      menuItemId: ITEM,
      orderId: ORDER,
      orderItemIds: [LINE],
      resolution: "swap",
      swapMenuItemId: ITEM,
      requestId: "req-12345678",
    });
    assertEquals(res.status, 401, action);
    assertEquals((await res.json()).error, "pin_session_required");
    assertFalse(
      c.calls.some((x) =>
        x.name.startsWith("issue_4490_stock_set") || x.name.includes("sold_out")
      ),
      action,
    );
  }
});

Deno.test("K5C-E5 in a PIN session the member acts, the device is recorded", async () => {
  const c = client({ gated: true });
  const res = await run(c, "stock_set", {
    menuItemId: ITEM,
    count: 4,
    staffSession: TOKEN,
  });
  assertEquals(res.status, 200);
  const call = c.calls.find((x) => x.name === "issue_4490_stock_set")!;
  assertEquals(call.params.p_actor, MEMBER);
  assertEquals(call.params.p_device_user, USER);
});

Deno.test("K5C-E6 the station actions run as the signed-in account (a Till device as itself)", async () => {
  const c = client({ gated: true });
  const list = await run(c, "station_stock", { station: "kitchen" });
  assertEquals(list.status, 200);
  const mark = await run(c, "station_sold_out", { menuItemId: ITEM, on: true });
  assertEquals(mark.status, 200);
  assertEquals(
    c.calls.find((x) => x.name === "issue_4490_station_sold_out")!.params,
    { p_item_id: ITEM, p_on: true, p_actor: USER },
  );
  assertFalse(c.calls.some((x) => x.name === "issue_4490_pin_session_resolve"));
});

Deno.test("K5C-E7 an order at another venue is not found; nothing resolves", async () => {
  const c = client({ orderVenue: OTHER_VENUE });
  const res = await run(c, "sold_out_resolve", {
    orderId: ORDER,
    orderItemIds: [LINE],
    resolution: "refund",
    requestId: "req-12345678",
  });
  assertEquals(res.status, 404);
  assertFalse(
    c.calls.some((x) => x.name === "issue_4490_order_sold_out_resolve"),
  );
});

Deno.test("K5C-E8 resolve passes the request key, and refund on a Till device needs a fresh PIN", async () => {
  const c = client();
  const res = await run(c, "sold_out_resolve", {
    orderId: ORDER,
    orderItemIds: [LINE],
    resolution: "swap",
    swapMenuItemId: ITEM,
    requestId: "req-12345678",
  });
  assertEquals(res.status, 200);
  const call = c.calls.find((x) =>
    x.name === "issue_4490_order_sold_out_resolve"
  )!;
  assertEquals(call.params.p_key, "sold_out:req-12345678");
  assertEquals(call.params.p_resolution, "swap");
  const d = client({ gated: true });
  const refused = await run(d, "sold_out_resolve", {
    orderId: ORDER,
    orderItemIds: [LINE],
    resolution: "refund",
    requestId: "req-12345678",
    staffSession: TOKEN,
  });
  assertEquals(refused.status, 403);
  assertEquals((await refused.json()).error, "pin_step_up_required");
  assertFalse(
    d.calls.some((x) => x.name === "issue_4490_order_sold_out_resolve"),
  );
});

Deno.test("K5C-E8b a refused step-up PIN says how many tries are left (or when the lock ends); a right one runs as the approver", async () => {
  const base = {
    orderId: ORDER,
    orderItemIds: [LINE],
    resolution: "refund",
    requestId: "req-12345678",
    staffSession: TOKEN,
  };
  const wrong = client({
    gated: true,
    answers: {
      issue_4490_pin_approve: {
        data: { ok: false, reason: "wrong", triesLeft: 2 },
      },
    },
  });
  const w = await run(wrong, "sold_out_resolve", {
    ...base,
    stepUp: { pin: "482613" },
  });
  assertEquals(w.status, 403);
  assertEquals(await w.json(), {
    code: "pin_wrong",
    triesLeft: 2,
    error: "pin_wrong",
  });
  assertFalse(
    wrong.calls.some((x) => x.name === "issue_4490_order_sold_out_resolve"),
  );
  const locked = client({
    gated: true,
    answers: {
      issue_4490_pin_approve: {
        data: {
          ok: false,
          reason: "locked",
          lockedUntil: "2026-11-24T21:19:00Z",
        },
      },
    },
  });
  const l = await run(locked, "sold_out_resolve", {
    ...base,
    stepUp: { pin: "482613" },
  });
  assertEquals((await l.json()).lockedUntil, "2026-11-24T21:19:00Z");
  const right = client({
    gated: true,
    answers: {
      issue_4490_pin_approve: {
        data: {
          ok: true,
          approverUserId: "44900615-0000-4000-8000-0000000000aa",
          approvalId: "a1",
        },
      },
      issue_4490_order_sold_out_resolve: {
        data: { resolution: "refund", refundMinor: 440000 },
      },
    },
  });
  const r = await run(right, "sold_out_resolve", {
    ...base,
    stepUp: { pin: "482613" },
  });
  assertEquals(r.status, 200);
  const call = right.calls.find((x) =>
    x.name === "issue_4490_order_sold_out_resolve"
  )!;
  assertEquals(call.params.p_actor, "44900615-0000-4000-8000-0000000000aa");
});

Deno.test("K5C-E9 refusals map to their code (with the item), unknown ones to internal_error", async () => {
  const c = client({
    answers: {
      issue_4490_order_sold_out_resolve: {
        error: {
          code: "PT409",
          message: "item_sold_out",
          details: JSON.stringify({ itemName: "Asun", left: 0 }),
        },
      },
    },
  });
  const res = await run(c, "sold_out_resolve", {
    orderId: ORDER,
    orderItemIds: [LINE],
    resolution: "swap",
    swapMenuItemId: ITEM,
    requestId: "req-12345678",
  });
  assertEquals(res.status, 409);
  assertEquals(await res.json(), {
    error: "item_sold_out",
    itemName: "Asun",
    left: 0,
  });
  const d = client({
    answers: {
      issue_4490_order_sold_out_resolve: {
        error: { code: "XX000", message: "boom secret" },
      },
    },
  });
  const raw = await run(d, "sold_out_resolve", {
    orderId: ORDER,
    orderItemIds: [LINE],
    resolution: "refund",
    requestId: "req-12345678",
  });
  assertEquals(raw.status, 500);
  assertEquals(await raw.json(), { error: "internal_error" });
  for (
    const code of [
      "sold_out_refund_once",
      "sold_out_already_resolved",
      "sold_out_swap_dearer",
      "stock_write_refused",
    ]
  ) {
    if (code === "stock_write_refused") {
      assertEquals(STOCK_STATUS[code], undefined);
    } else assertEquals(STOCK_STATUS[code], 409);
  }
});

Deno.test("K5C-R1 the one orderable rule (same truth table as issue_4490_menu_item_orderable)", () => {
  assert(menuItemOrderable({ is_available: true, stock_count: null }));
  assert(menuItemOrderable({ is_available: true }));
  assert(menuItemOrderable({ is_available: true, stock_count: 1 }));
  assertFalse(menuItemOrderable({ is_available: true, stock_count: 0 }));
  assertFalse(menuItemOrderable({ is_available: false, stock_count: null }));
  assertFalse(menuItemOrderable({ is_available: false, stock_count: 5 }));
});

Deno.test("K5C-R2 the deploy-order matcher is narrow (42703 naming stock_count only)", () => {
  assert(
    isMissingStockColumn({
      code: "42703",
      message: "column menu_items.stock_count does not exist",
    }),
  );
  assertFalse(
    isMissingStockColumn({
      code: "42703",
      message: "column menu_items.other does not exist",
    }),
  );
  assertFalse(
    isMissingStockColumn({ code: "57014", message: "stock_count timeout" }),
  );
  assertFalse(isMissingStockColumn(null));
});

/** A PostgREST-shaped fake: menu_items selects naming stock_count answer 42703 when `old`. */
function snapshotClient(old: boolean, rows: Array<Record<string, unknown>>) {
  const selects: string[] = [];
  const table = (name: string) => ({
    select: (cols: string) => {
      if (name === "menu_items") selects.push(cols);
      const result = () => {
        if (name === "menu_items") {
          if (old && cols.includes("stock_count")) {
            return {
              data: null,
              error: {
                code: "42703",
                message: "column menu_items.stock_count does not exist",
              },
            };
          }
          return {
            data: rows.map((r) => (old ? { ...r, stock_count: undefined } : r)),
            error: null,
          };
        }
        if (name === "menus") {
          return {
            data: [{
              id: "m1",
              venue_id: VENUE,
              is_active: true,
              service_window_start: null,
              service_window_end: null,
              service_days: null,
            }],
            error: null,
          };
        }
        return { data: [], error: null };
      };
      const chain: Record<string, unknown> = {
        in: () => Promise.resolve(result()),
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      return chain;
    },
  });
  return {
    selects,
    from: table,
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
}

Deno.test("K5C-R3 loadMenuSnapshot: untracked rows unchanged; a sold-out item is not orderable; no column = today's rule", async () => {
  const rows = [
    {
      id: "i1",
      menu_id: "m1",
      brand_id: "b1",
      name: "Jollof",
      price_cents: 500000,
      currency: "NGN",
      is_available: true,
      stock_count: null,
    },
    {
      id: "i2",
      menu_id: "m1",
      brand_id: "b1",
      name: "Soup",
      price_cents: 550000,
      currency: "NGN",
      is_available: true,
      stock_count: 0,
    },
    {
      id: "i3",
      menu_id: "m1",
      brand_id: "b1",
      name: "Asun",
      price_cents: 400000,
      currency: "NGN",
      is_available: true,
      stock_count: 3,
    },
    {
      id: "i4",
      menu_id: "m1",
      brand_id: "b1",
      name: "Off",
      price_cents: 400000,
      currency: "NGN",
      is_available: false,
      stock_count: null,
    },
  ];
  const input = {
    brandId: "b1",
    servingVenueId: VENUE,
    servingMenuId: null,
    menuItemIds: ["i1", "i2", "i3", "i4"],
  };
  const fresh = snapshotClient(false, rows);
  const now = await loadMenuSnapshot(fresh, input);
  assertEquals([...now.orderableItemIds].sort(), ["i1", "i3"]);
  assertEquals(fresh.selects.length, 1);
  const old = snapshotClient(true, rows);
  const before = await loadMenuSnapshot(old, input);
  // Without the column every item is untracked: the rule is today's (is_available).
  assertEquals([...before.orderableItemIds].sort(), ["i1", "i2", "i3"]);
  assertEquals(old.selects.length, 2);
  assertFalse(old.selects[1].includes("stock_count"));
});

Deno.test("K5C-N1 the guest is told: swap (same price), swap with money back, refund — one SMS segment each", () => {
  const base = {
    venue_name: "Palm & Pepper",
    item_name: "Goat pepper soup",
    currency: "NGN",
    message_link_display: "usemingla.com/r/ABCDEFGH",
  };
  const same = renderCategoryMessage("buyer_venue_order_sold_out", {
    ...base,
    outcome: "swap",
    swap_name: "Asun",
    refund_minor: 0,
  });
  const back = renderCategoryMessage("buyer_venue_order_sold_out", {
    ...base,
    outcome: "swap",
    swap_name: "Moi moi",
    refund_minor: 200000,
  });
  const refund = renderCategoryMessage("buyer_venue_order_sold_out", {
    ...base,
    outcome: "refund",
    refund_minor: 550000,
  });
  for (const m of [same, back, refund]) {
    // The item name is shortened when the outcome needs the room (one segment).
    assert(m.sms.startsWith("Mingla: Palm & Pepper: Goat pep"), m.sms);
    assert(m.sms.includes(" sold out after you paid. "), m.sms);
    assert(m.sms.length <= 160, `${m.sms.length}: ${m.sms}`);
    assert(m.sms.includes("usemingla.com/r/ABCDEFGH"), m.sms);
  }
  assert(same.sms.includes("Swapped for Asun"));
  assert(back.email.body.includes("swapped it for Moi moi"));
  assert(back.email.body.includes("5 to 10 working days"));
  assert(refund.email.body.includes("on its way back to your card"));
  const long = renderCategoryMessage("buyer_venue_order_sold_out", {
    ...base,
    venue_name: "A very long venue name that goes on and on and on",
    item_name: "An extremely long dish name with many words in it",
    outcome: "swap",
    swap_name: "Another rather long dish name here",
    refund_minor: 123456789,
  });
  assert(long.sms.length <= 160, `${long.sms.length}: ${long.sms}`);
});
