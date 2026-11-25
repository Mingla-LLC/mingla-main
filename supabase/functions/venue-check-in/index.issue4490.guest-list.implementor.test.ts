import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type CheckInClient, createVenueCheckInHandler } from "./index.ts";
import { venueOfferTokenHashHex } from "../_shared/venueOfferBookingToken.ts";

const VENUE = "00000000-4490-4000-8000-0000000000a1";
const ENTRY = "00000000-4490-4000-8000-0000000000b1";
const STAFF = "00000000-4490-4000-8000-0000000000c1";
const GROUP = "00000000-4490-4000-8000-0000000000d1";
const TOKEN = "T".repeat(43);
type Call = { name: string; params: Record<string, unknown> };

function client(calls: Call[], data: unknown): () => CheckInClient {
  return () => ({
    rpc: (name, params) => {
      // TEST-MOD-APPROVED #4490 (08-O5 part A): the PIN gate answers "not a Till device" for these accounts, as the database does.
      if (name === "issue_4490_pin_gate") return Promise.resolve({ data: false, error: null });
      calls.push({ name, params });
      return Promise.resolve({ data, error: null });
    },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: STAFF } }, error: null }) },
  });
}
function req(body: Record<string, unknown>): Request {
  return new Request("http://local/venue-check-in", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer staff.jwt.sig" },
    body: JSON.stringify(body),
  });
}
const env = (name: string) => ({
  BUSINESS_WEB_ORIGIN: "http://127.0.0.1:8491",
  SUPABASE_URL: "http://kong:8000",
  "app.qr_token_pepper": "p".repeat(40),
} as Record<string, string>)[name];

Deno.test("guest-list admit passes the verified scanner and bounded count", async () => {
  const calls: Call[] = [];
  const res = await createVenueCheckInHandler({ client: client(calls, { result: "admitted" }), env })(req({
    action: "admit_guest_list", venueId: VENUE, entryId: ENTRY, count: 3,
    scannerUserId: "00000000-0000-4000-8000-000000000666",
  }));
  assertEquals(res.status, 200);
  assertEquals(calls[0], {
    name: "issue_4490_admit_guest_list",
    params: { p_venue_id: VENUE, p_entry_id: ENTRY, p_count: 3, p_scanner_user_id: STAFF },
  });
});

Deno.test("reduced pay-link sale stores only the booking-token hash and returns a fragment link", async () => {
  const calls: Call[] = [];
  const res = await createVenueCheckInHandler({
    client: client(calls, { replayed: false, booking: { groupId: GROUP } }), env,
    newGroupId: () => GROUP,
    issueToken: () => Promise.resolve({ token: TOKEN, derived: true }),
  })(req({
    action: "sell_guest_list", venueId: VENUE, entryId: ENTRY, count: 2,
    method: "pay_link", idempotencyKey: "list-sale-1",
    buyer: { name: "Ada", email: "ada@example.test" },
  }));
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(calls[0].name, "issue_4490_guest_list_gate_sale");
  assertEquals(calls[0].params.p_scanner_user_id, STAFF);
  assertEquals(calls[0].params.p_buyer_token_hash, `\\x${await venueOfferTokenHashHex(TOKEN)}`);
  assertEquals(body.data.payUrl, `http://127.0.0.1:8491/visit/${GROUP}#t=${TOKEN}`);
});

Deno.test("invalid list ids and counts never reach PostgreSQL", async () => {
  const calls: Call[] = [];
  const run = createVenueCheckInHandler({ client: client(calls, {}), env });
  assertEquals((await run(req({ action: "admit_guest_list", venueId: VENUE, entryId: "nope" }))).status, 400);
  assertEquals((await run(req({
    action: "sell_guest_list", venueId: VENUE, entryId: ENTRY, count: 12,
    method: "cash", idempotencyKey: "list-sale-2",
  }))).status, 400);
  assertEquals(calls.length, 0);
});

Deno.test("#4490 08-O1 fix 2: an arrival already on an open Till check is refused at the gate in words, not a 500", async () => {
  const run = createVenueCheckInHandler({
    client: () => ({
      // TEST-MOD-APPROVED #4490 (08-O5 part A): the PIN gate answers "not a Till device".
      rpc: (name: string) => Promise.resolve(name === "issue_4490_pin_gate" ? { data: false, error: null } : { data: null, error: { message: "guest_list_entry_on_check", code: "PT409" } }),
      auth: { getUser: () => Promise.resolve({ data: { user: { id: STAFF } }, error: null }) },
    }),
    env,
  });
  const res = await run(req({
    action: "sell_guest_list", venueId: VENUE, entryId: ENTRY, count: 1,
    method: "cash", idempotencyKey: "list-sale-3",
  }));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).code, "guest_list_entry_on_check");
});
