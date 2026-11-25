// #4490 spec 08 O4 fix round 1 — venue-till: "Close check" for a check the
// table deposit fully pays (O4-T2) and the "in use until" detail of a refused
// staff start (O4-T4). The edge validates and routes; the server decides
// (proved in issue_4490_ops_o4_fix1.implementor.pg17.test.sql).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createVenueTillHandler,
  TILL_SAFE_CODES,
  type TillClient,
  tillFailure,
} from "./index.ts";

const VENUE = "00000000-4490-4000-8000-0000000008a1";
const BRAND = "00000000-4490-4000-8000-0000000008b0";
const SALE = "00000000-4490-4000-8000-0000000008c1";
const STAFF = "00000000-4490-4000-8000-0000000008f1";

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

const answer = (_name: string): RpcAnswer => ({
  data: { id: SALE, version: 5, state: "paid", closed: true, replayed: false },
  error: null,
});

Deno.test("O4F1-E1 close_covered sends the sale, the verified member and the version to the server close", async () => {
  const { handler, calls } = world(answer);
  const res = await handler(
    post({ action: "close_covered", saleId: SALE, expectedVersion: 4 }),
  );
  assertEquals(res.status, 200);
  assertEquals(calls, [{
    name: "issue_4490_till_close_covered",
    params: { p_sale_id: SALE, p_actor: STAFF, p_expected_version: 4 },
  }]);
});

Deno.test("O4F1-E2 close_covered without a version, or for another venue's sale, never reaches the server", async () => {
  const { handler, calls } = world(answer);
  const noVersion = await handler(
    post({ action: "close_covered", saleId: SALE }),
  );
  assertEquals([noVersion.status, (await noVersion.json()).code], [
    400,
    "till_invalid_payload",
  ]);
  const other = await handler(post({
    action: "close_covered",
    saleId: "00000000-4490-4000-8000-0000000008c9",
    expectedVersion: 4,
  }));
  assertEquals([other.status, (await other.json()).code], [
    404,
    "till_sale_not_found",
  ]);
  assertEquals(calls.length, 0);
});

Deno.test("O4F1-E3 the server's refusals of a close reach the Till as their own codes", async () => {
  for (
    const [message, code, status] of [
      ["till_close_not_covered", "PT409", 409],
      ["till_check_changed", "PT409", 409],
      ["not_authorized", "42501", 403],
    ] as const
  ) {
    const { handler } = world(() => ({ data: null, error: { message, code } }));
    const res = await handler(
      post({ action: "close_covered", saleId: SALE, expectedVersion: 4 }),
    );
    assertEquals([res.status, (await res.json()).code], [status, message]);
  }
  assertEquals(TILL_SAFE_CODES.includes("till_close_not_covered"), true);
});

Deno.test("O4F1-E4 a staff start refused on a unit in use carries when it frees up", async () => {
  const res = tillFailure({
    message: "offer_space_taken",
    code: "PT409",
    details: JSON.stringify({
      unitName: "Pool table 1",
      freeAt: "2026-11-23T14:00:00+00:00",
      nextAt: null,
    }),
  });
  assertEquals([res.status, await res.json()], [409, {
    code: "offer_space_taken",
    unitName: "Pool table 1",
    freeAt: "2026-11-23T14:00:00+00:00",
  }]);
});
