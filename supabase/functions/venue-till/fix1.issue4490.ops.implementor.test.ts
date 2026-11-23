// #4490 spec 08 O1 fix round 1 — venue-till: every refusal the payment path
// reaches answers a mapped code (never a 500), an offer line is refunded by
// line (its booking is cancelled in the database), and the Till lists who may
// take a check over. Identity is always the verified user.
import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createVenueTillHandler,
  TILL_SAFE_CODES,
  type TillClient,
} from "./index.ts";

const VENUE = "00000000-4490-4000-8000-0000000000a1";
const OTHER_VENUE = "00000000-4490-4000-8000-0000000000a2";
const SALE = "00000000-4490-4000-8000-0000000000c1";
const LINE = "00000000-4490-4000-8000-0000000000c3";
const STAFF = "00000000-4490-4000-8000-0000000000f1";
const BODY_USER = "00000000-4490-4000-8000-0000000000f9";
const REQ = "00000000-4490-4000-8000-0000000000e2";

type Row = Record<string, unknown>;
type Call = { name: string; params: Record<string, unknown> };

function client(opts: {
  calls: Call[];
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => { data: unknown; error: unknown };
  tables?: Record<string, Row[]>;
}): TillClient {
  const tables = opts.tables ?? {};
  return {
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (c: string, v: unknown) => {
          filters.push([c, v]);
          return builder;
        },
        maybeSingle: () =>
          Promise.resolve({
            data: (tables[table] ?? []).find((r) =>
              filters.every(([c, v]) => r[c] === v)
            ) ?? null,
            error: null,
          }),
      };
      return builder;
    },
    rpc: (name: string, params: Record<string, unknown>) => {
      // TEST-MOD-APPROVED #4490 (08-O5 part A): the PIN gate answers "not a Till device" for these accounts, as the database does.
      if (name === "issue_4490_pin_gate") return Promise.resolve({ data: false, error: null });
      opts.calls.push({ name, params });
      return Promise.resolve(opts.rpc(name, params));
    },
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: STAFF } }, error: null }),
    },
  };
}

function req(body: Record<string, unknown>): Request {
  return new Request("http://local/venue-till", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer staff.jwt.sig",
    },
    body: JSON.stringify(body),
  });
}

const env = (name: string) =>
  ({
    SUPABASE_URL: "http://kong:8000",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  } as Record<string, string>)[name];

const saleTables = (): Record<string, Row[]> => ({
  venue_till_sales: [{
    id: SALE,
    venue_id: VENUE,
    brand_id: "b",
    session_id: "s",
    qr_spot_id: null,
    currency: "NGN",
    state: "open",
    version: 3,
    check_label: null,
  }],
});

Deno.test("F1-E1 every refusal the tester's payment run reached maps to a safe code, never a 500", async () => {
  const cases: Array<[{ message: string; code: string }, number]> = [
    [{ message: "guest_list_arrived_invalid", code: "PT409" }, 409],
    [{ message: "guest_list_arrived_invalid", code: "22023" }, 400],
    [{ message: "offer_option_unavailable", code: "P0002" }, 404],
    [{ message: "offer_guests_out_of_range", code: "22023" }, 400],
    [{ message: "till_hold_lapsed", code: "PT409" }, 409],
    [{ message: "till_tab_settled_on_pad", code: "PT409" }, 409],
    [{ message: "till_round_settled_elsewhere", code: "PT409" }, 409],
  ];
  for (const [error, status] of cases) {
    const calls: Call[] = [];
    const res = await createVenueTillHandler({
      env,
      client: () =>
        client({
          calls,
          tables: saleTables(),
          rpc: () => ({ data: null, error }),
        }),
    })(req({
      action: "pay_cash",
      venueId: VENUE,
      saleId: SALE,
      amountMinor: 537500,
      tipMinor: 0,
      cashGivenMinor: 537500,
      clientRequestId: REQ,
      expectedVersion: 3,
    }));
    assertEquals(res.status, status, error.message);
    assertEquals((await res.json()).code, error.message);
  }
  for (
    const code of [
      "guest_list_entry_on_check",
      "till_refund_line_invalid",
      "till_line_not_paid",
    ]
  ) {
    assert((TILL_SAFE_CODES as readonly string[]).includes(code), code);
  }
});

Deno.test("F1-E2 an offer line is refunded by line, as the verified user, with no amount from the body", async () => {
  const calls: Call[] = [];
  const tables = {
    venue_till_lines: [{ id: LINE, venue_till_sales: { venue_id: VENUE } }],
  };
  const res = await createVenueTillHandler({
    env,
    client: () =>
      client({
        calls,
        tables,
        rpc: () => ({
          data: { replayed: false, refundedMinor: 537500 },
          error: null,
        }),
      }),
  })(
    req({
      action: "refund",
      venueId: VENUE,
      lineId: LINE,
      reason: "Guest asked",
      clientRequestId: REQ,
      actor: BODY_USER,
    }),
  );
  assertEquals(res.status, 200);
  const call = calls.find((c) => c.name === "issue_4490_till_refund_line");
  assert(call);
  assertEquals(call.params, {
    p_line_id: LINE,
    p_actor: STAFF,
    p_device_user: STAFF,
    p_reason: "Guest asked",
    p_client_request_id: REQ,
  });
  assertFalse(calls.some((c) => c.name === "issue_4490_till_refund"));
});

Deno.test("F1-E3 a line of another venue, or a line refund carrying an amount, never reaches the database", async () => {
  const calls: Call[] = [];
  const other = {
    venue_till_lines: [{
      id: LINE,
      venue_till_sales: { venue_id: OTHER_VENUE },
    }],
  };
  const handler = createVenueTillHandler({
    env,
    client: () =>
      client({ calls, tables: other, rpc: () => ({ data: {}, error: null }) }),
  });
  const res = await handler(
    req({
      action: "refund",
      venueId: VENUE,
      lineId: LINE,
      reason: "x",
      clientRequestId: REQ,
    }),
  );
  assertEquals(res.status, 404);
  const withAmount = await handler(
    req({
      action: "refund",
      venueId: VENUE,
      lineId: LINE,
      reason: "x",
      clientRequestId: REQ,
      amountMinor: 1,
    }),
  );
  assertEquals(withAmount.status, 400);
  assertEquals(calls.length, 0);
});

Deno.test("F1-E4 servers lists who may take a check over, for the verified user only", async () => {
  const calls: Call[] = [];
  const res = await createVenueTillHandler({
    env,
    client: () =>
      client({
        calls,
        rpc: () => ({
          data: [{ userId: STAFF, name: "Ada", openChecks: 1 }],
          error: null,
        }),
      }),
  })(req({ action: "servers", venueId: VENUE, actor: BODY_USER }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).data.servers[0].userId, STAFF);
  assertEquals(calls[0], {
    name: "issue_4490_till_servers",
    params: { p_venue_id: VENUE, p_actor: STAFF },
  });
});
