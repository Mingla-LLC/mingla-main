// #4490 spec 08 O3 fix 5 (O3-S3) — venue-till: a request id already used on the
// check for a different payment or refund is answered with its own code
// (till_request_reused, 409; plain words in the Host's tillCopy.ts), never as
// success; and a payment answer carries the amount the server RECORDED (the
// RPC's facts; for a database that predates the fix, the payment row), never
// the caller's numbers.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createVenueTillHandler,
  TILL_SAFE_CODES,
  type TillClient,
  tillFailure,
} from "./index.ts";

const VENUE = "00000000-4490-4000-8000-0000000005a1";
const BRAND = "00000000-4490-4000-8000-0000000005b0";
const SALE = "00000000-4490-4000-8000-0000000005c1";
const STAFF = "00000000-4490-4000-8000-0000000005f1";
const PAYMENT = "00000000-4490-4000-8000-0000000005e1";
const PAYMENT_2 = "00000000-4490-4000-8000-0000000005e2";
const REQ = "00000000-4490-4000-8000-0000000005e9";

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

const cash = (amountMinor: number) => ({
  action: "pay_cash",
  saleId: SALE,
  amountMinor,
  tipMinor: 0,
  cashGivenMinor: amountMinor,
  clientRequestId: REQ,
  expectedVersion: 3,
});

const reused = {
  data: null,
  error: { message: "till_request_reused", code: "PT409" },
};

Deno.test("O3F5-E1 till_request_reused is a known code and maps to 409 with that code (the Host shows its own words)", async () => {
  assertEquals(
    (TILL_SAFE_CODES as readonly string[]).includes("till_request_reused"),
    true,
  );
  const res = tillFailure({ message: "till_request_reused", code: "PT409" });
  assertEquals([res.status, (await res.json()).code], [
    409,
    "till_request_reused",
  ]);
});

Deno.test("O3F5-E2 pay_cash: the same id with another amount is refused 409 till_request_reused, never 'success'", async () => {
  const w = world((name) =>
    name === "issue_4490_till_take_payment"
      ? reused
      : { data: null, error: null }
  );
  const res = await w.handler(post(cash(175000)));
  const body = await res.json();
  assertEquals([res.status, body.code, body.kind], [
    409,
    "till_request_reused",
    undefined,
  ]);
});

Deno.test("O3F5-E3 both refund forms pass the refusal through as 409 till_request_reused", async () => {
  const w = world((name) => {
    if (
      name === "issue_4490_till_refund" ||
      name === "issue_4490_till_refund_line" ||
      name === "issue_4490_till_card_start" ||
      name === "issue_4490_till_mint_carrier_refund"
    ) {
      return reused;
    }
    if (name === "issue_4490_till_card_prepare") {
      return {
        data: {
          version: 3,
          currency: "NGN",
          amountMinor: 1,
          serviceChargeMinor: 0,
          sentOrderIds: [],
        },
        error: null,
      };
    }
    return { data: null, error: null };
  }, {
    venue_till_payments: [{
      id: PAYMENT,
      sale_id: SALE,
      method: "cash",
      venue_till_sales: { venue_id: VENUE },
    }],
    venue_till_lines: [{
      id: PAYMENT_2,
      venue_till_sales: { venue_id: VENUE },
    }],
  });
  const refund = await w.handler(post({
    action: "refund",
    paymentId: PAYMENT,
    amountMinor: 60000,
    tipMinor: 0,
    reason: "Guest asked",
    restock: false,
    clientRequestId: REQ,
  }));
  assertEquals([refund.status, (await refund.json()).code], [
    409,
    "till_request_reused",
  ]);
  const line = await w.handler(
    post({
      action: "refund",
      lineId: PAYMENT_2,
      reason: "Guest asked",
      clientRequestId: REQ,
    }),
  );
  assertEquals([line.status, (await line.json()).code], [
    409,
    "till_request_reused",
  ]);
});

Deno.test("O3F5-E4 pay_cash answers the amount the server recorded (a replay: the original 1,000.00), not the 1,750.00 sent", async () => {
  const w = world((name) =>
    name === "issue_4490_till_take_payment"
      ? {
        data: {
          paymentId: PAYMENT,
          replayed: true,
          method: "cash",
          amountMinor: 100000,
          tipMinor: 0,
          state: "paid",
          changeMinor: 0,
          sale: { lines: [] },
        },
        error: null,
      }
      : { data: null, error: null }
  );
  const res = await w.handler(post(cash(175000)));
  const { data } = await res.json();
  assertEquals(res.status, 200);
  assertEquals(
    [
      data.paymentId,
      data.method,
      data.amountMinor,
      data.tipMinor,
      data.state,
      data.replayed,
    ],
    [PAYMENT, "cash", 100000, 0, "paid", true],
  );
});

Deno.test("O3F5-E5 edge before its migration: the RPC answer has no facts, so they come from the payment row; no row gives nulls, never the body's amount", async () => {
  const answer = () => ({
    data: {
      paymentId: PAYMENT,
      replayed: false,
      changeMinor: 0,
      sale: { lines: [] },
    },
    error: null,
  });
  const withRow = world(
    (name) =>
      name === "issue_4490_till_take_payment"
        ? answer()
        : { data: null, error: null },
    {
      venue_till_payments: [{
        id: PAYMENT,
        method: "cash",
        amount_minor: 100000,
        tip_minor: 0,
        state: "paid",
      }],
    },
  );
  const a = await (await withRow.handler(post(cash(100000)))).json();
  assertEquals([
    a.data.amountMinor,
    a.data.tipMinor,
    a.data.method,
    a.data.state,
  ], [100000, 0, "cash", "paid"]);
  const noRow = world((name) =>
    name === "issue_4490_till_take_payment"
      ? answer()
      : { data: null, error: null }
  );
  const res = await noRow.handler(post(cash(175000)));
  const b = await res.json();
  assertEquals([res.status, b.data.amountMinor, b.data.tipMinor], [
    200,
    null,
    null,
  ]);
});
