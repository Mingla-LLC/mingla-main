// #4490 P3 — venue-check-in: take the balance at the venue (money rights are
// checked in the database for the verified staff member) and show the
// guest's own balance pay link.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type CheckInClient, createVenueCheckInHandler } from "./index.ts";

const VENUE = "00000000-4490-4000-8000-0000000000a1";
const GROUP = "00000000-4490-4000-8000-0000000000e1";
const STAFF = "00000000-4490-4000-8000-0000000000f1";
const TOKEN = "Q".repeat(43);

type Call = { name: string; params: Record<string, unknown> };

function client(
  calls: Call[],
  result: (name: string) => { data: unknown; error: unknown },
): () => CheckInClient {
  return () => ({
    rpc: (name, params) => {
      // TEST-MOD-APPROVED #4490 (08-O5 part A): the PIN gate answers "not a Till device" for these accounts, as the database does.
      if (name === "issue_4490_pin_gate") return Promise.resolve({ data: false, error: null });
      calls.push({ name, params });
      return Promise.resolve(result(name) as { data: unknown; error: null });
    },
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: STAFF } }, error: null }),
    },
  });
}

function req(body: Record<string, unknown>): Request {
  return new Request("http://local/venue-check-in", {
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
    BUSINESS_WEB_ORIGIN: "http://127.0.0.1:8491",
    SUPABASE_URL: "http://kong:8000",
  } as Record<string, string>)[name];

Deno.test("take_balance records money taken at the venue for the verified staff member", async () => {
  const calls: Call[] = [];
  const handle = createVenueCheckInHandler({
    env,
    client: client(
      calls,
      () => ({
        data: { paymentId: "x", balanceMinor: 0, replayed: false },
        error: null,
      }),
    ),
  });
  const res = await handle(req({
    action: "take_balance",
    venueId: VENUE,
    groupId: GROUP,
    amountMinor: 7525000,
    method: "cash",
    idempotencyKey: "take-balance-123",
  }));
  assertEquals(res.status, 200);
  assertEquals(calls[0].name, "issue_4490_record_offline_payment_for");
  assertEquals(calls[0].params.p_user_id, STAFF);
  assertEquals(calls[0].params.p_amount_minor, 7525000);
  assertEquals(calls[0].params.p_method, "cash");
});

Deno.test("take_balance refuses a bad amount or method, and maps money-rights refusals", async () => {
  const calls: Call[] = [];
  const handle = createVenueCheckInHandler({
    env,
    client: client(
      calls,
      () => ({
        data: null,
        error: { message: "not_authorized", code: "42501" },
      }),
    ),
  });
  for (
    const bad of [{ amountMinor: 0, method: "cash" }, {
      amountMinor: 100,
      method: "tap",
    }]
  ) {
    const res = await handle(
      req({
        action: "take_balance",
        venueId: VENUE,
        groupId: GROUP,
        idempotencyKey: "k-12345678",
        ...bad,
      }),
    );
    assertEquals(res.status, 400);
  }
  assertEquals(calls.length, 0);
  const res = await handle(req({
    action: "take_balance",
    venueId: VENUE,
    groupId: GROUP,
    amountMinor: 100,
    method: "transfer",
    idempotencyKey: "k-12345678",
  }));
  assertEquals(res.status, 403);
  assertEquals((await res.json()).code, "not_authorized");
});

Deno.test("balance_link shows the guest's own pay link (token in the fragment), or says it is unavailable", async () => {
  for (const token of [TOKEN, null]) {
    const calls: Call[] = [];
    const handle = createVenueCheckInHandler({
      env,
      client: client(calls, () => ({
        data: {
          groupId: GROUP,
          tokenHashHex: "ab".repeat(32),
          balanceMinor: 7525000,
          currencyCode: "NGN",
        },
        error: null,
      })),
      rederiveToken: (input) => {
        assertEquals(input.storedHashHex, "ab".repeat(32));
        return Promise.resolve(token);
      },
    });
    const res = await handle(
      req({ action: "balance_link", venueId: VENUE, groupId: GROUP }),
    );
    if (token) {
      assertEquals(res.status, 200);
      const data = (await res.json()).data;
      assertEquals(
        data.payUrl,
        `http://127.0.0.1:8491/visit/${GROUP}#t=${TOKEN}`,
      );
      assertEquals(data.balanceMinor, 7525000);
      assertEquals(calls[0].params.p_user_id, STAFF);
    } else {
      assertEquals(res.status, 409);
      assert((await res.json()).code === "balance_link_unavailable");
    }
  }
});
