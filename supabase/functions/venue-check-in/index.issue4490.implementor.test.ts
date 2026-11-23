// #4490 P2-3 — venue-check-in edge function: verified scanner identity, the
// pepper, pay-by-code link, safe error codes.
import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type CheckInClient,
  createVenueCheckInHandler,
  safeCode,
} from "./index.ts";
import { venueOfferTokenHashHex } from "../_shared/venueOfferBookingToken.ts";

const VENUE = "00000000-4490-4000-8000-0000000000a1";
const PASS = "00000000-4490-4000-8000-0000000000b1";
const LOG = "00000000-4490-4000-8000-0000000000c1";
const OFFER = "00000000-4490-4000-8000-0000000000d1";
const GROUP = "00000000-4490-4000-8000-0000000000e1";
const STAFF = "00000000-4490-4000-8000-0000000000f1";
const PEPPER = "p".repeat(40);
const TOKEN = "Q".repeat(43);

type Call = { name: string; params: Record<string, unknown> };

function client(
  calls: Call[],
  result: (name: string) => { data: unknown; error: unknown },
  user: string | null = STAFF,
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
        Promise.resolve({
          data: { user: user ? { id: user } : null },
          error: user ? null : new Error("bad"),
        }),
    },
  });
}

function req(body: Record<string, unknown>, jwt = "staff.jwt.sig"): Request {
  return new Request("http://local/venue-check-in", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });
}

const env = (name: string) =>
  ({
    "app.qr_token_pepper": PEPPER,
    BUSINESS_WEB_ORIGIN: "http://127.0.0.1:8491",
    SUPABASE_URL: "http://kong:8000",
  } as Record<string, string>)[name];

Deno.test("scan passes the verified user, never one from the body, and the pepper", async () => {
  const calls: Call[] = [];
  const handler = createVenueCheckInHandler({
    env,
    client: client(
      calls,
      () => ({ data: { result: "admitted", admitted: 3 }, error: null }),
    ),
  });
  const res = await handler(req({
    action: "scan",
    venueId: VENUE,
    qrPayload: `mingla:v1:vpass:${PASS}:sig:${"a".repeat(64)}`,
    idChecked: true,
    scannerUserId: "00000000-0000-4000-8000-000000000666",
  }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).data.result, "admitted");
  assertEquals(calls[0].name, "issue_4490_check_in_scan");
  assertEquals(calls[0].params.p_scanner_user_id, STAFF);
  assertEquals(calls[0].params.p_qr_pepper, PEPPER);
  assertEquals(calls[0].params.p_id_checked, true);
});

Deno.test("no or bad JWT is refused before any RPC", async () => {
  const calls: Call[] = [];
  const handler = createVenueCheckInHandler({
    env,
    client: client(calls, () => ({ data: null, error: null }), null),
  });
  const res = await handler(req({ action: "list", venueId: VENUE }));
  assertEquals(res.status, 401);
  assertEquals(calls.length, 0);
  const none = await createVenueCheckInHandler({
    env,
    client: client(calls, () => ({ data: null, error: null })),
  })(
    new Request("http://local", { method: "POST", body: "{}" }),
  );
  assertEquals(none.status, 401);
});

Deno.test("list, admit and undo call their RPCs with the scanner", async () => {
  const calls: Call[] = [];
  const handler = createVenueCheckInHandler({
    env,
    client: client(calls, () => ({ data: { ok: true }, error: null })),
  });
  assertEquals(
    (await handler(
      req({ action: "list", venueId: VENUE, localDate: "2026-11-19" }),
    )).status,
    200,
  );
  assertEquals(
    (await handler(
      req({ action: "admit", venueId: VENUE, passId: PASS, count: 2 }),
    )).status,
    200,
  );
  assertEquals(
    (await handler(req({ action: "undo", venueId: VENUE, logId: LOG }))).status,
    200,
  );
  assertEquals(calls.map((c) => c.name), [
    "issue_4490_check_in_list",
    "issue_4490_check_in_admit",
    "issue_4490_check_in_undo",
  ]);
  assert(calls.every((c) => c.params.p_scanner_user_id === STAFF));
  assertEquals(
    (await handler(req({ action: "admit", venueId: VENUE, passId: "nope" })))
      .status,
    400,
  );
});

Deno.test("sell by pay-by-code makes a booking token, stores only its hash, and returns the pay link", async () => {
  const calls: Call[] = [];
  const handler = createVenueCheckInHandler({
    env,
    client: client(
      calls,
      () => ({
        data: {
          replayed: false,
          method: "pay_link",
          booking: { groupId: GROUP },
        },
        error: null,
      }),
    ),
    newGroupId: () => GROUP,
    issueToken: () => Promise.resolve({ token: TOKEN, derived: true }),
  });
  const res = await handler(req({
    action: "sell",
    venueId: VENUE,
    offeringId: OFFER,
    method: "pay_link",
    idempotencyKey: "gate-key-1",
    lines: [{ priceOptionId: OFFER, guests: 1 }],
    buyer: { name: "Phone payer", email: "p@example.test" },
  }));
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(
    body.data.payUrl,
    `http://127.0.0.1:8491/visit/${GROUP}#t=${TOKEN}`,
  );
  assertEquals(calls[0].params.p_group_id, GROUP);
  assertEquals(
    calls[0].params.p_buyer_token_hash,
    `\\x${await venueOfferTokenHashHex(TOKEN)}`,
  );
  assertFalse(JSON.stringify(calls).includes(TOKEN));
});

Deno.test("cash sale sends no token; refusals map to plain codes", async () => {
  const calls: Call[] = [];
  const handler = createVenueCheckInHandler({
    env,
    client: client(
      calls,
      () => ({
        data: null,
        error: {
          code: "PT409",
          message: "offer_sold_out",
          details: '{"remaining":0}',
        },
      }),
    ),
  });
  const res = await handler(req({
    action: "sell",
    venueId: VENUE,
    offeringId: OFFER,
    method: "cash",
    idempotencyKey: "gate-key-2",
    lines: [{ priceOptionId: OFFER, guests: 2 }],
  }));
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { code: "offer_sold_out", remaining: 0 });
  assertEquals(calls[0].params.p_buyer_token_hash, null);
  assertEquals(
    safeCode({ message: "relation x does not exist" }),
    "check_in_failed",
  );
  assertEquals(
    safeCode({ message: "check_in_undo_too_late" }),
    "check_in_undo_too_late",
  );
});
