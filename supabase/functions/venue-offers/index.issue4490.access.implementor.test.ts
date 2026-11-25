// #4490 P3 — venue-offers booking access (adversarial).
//
// A signed-in user is accepted only for a booking that is theirs (bought
// signed in: user_id / booked_by_user_id). A booking bought signed-out can be
// opened, paid, confirmed or cancelled only with its booking token, whoever is
// signed in. The fake database below lets every RPC through, as the broken
// database check did, so these tests fail unless the edge function refuses
// the stranger itself.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  callerOwnsBooking,
  createVenueOffersHandler,
  resetVenueOffersRateLimitForTests,
  type ServiceClient,
} from "./index.ts";
import { venueOfferTokenHashHex } from "../_shared/venueOfferBookingToken.ts";

const GROUP = "00000000-4490-4000-8000-0000000000c1";
const STRANGER = "00000000-4490-4000-8000-0000000000e5";
const OWNER = "00000000-4490-4000-8000-0000000000e6";
const TOKEN = "T".repeat(43);
const PREVIEW = "00000000-4490-4000-8000-0000000000d1";

type Call = { name: string; params: Record<string, unknown> };

function permissiveClient(
  calls: Call[],
  userId: string,
  group: Record<string, unknown> | null,
): () => ServiceClient {
  return () => ({
    rpc: (name, params) => {
      // TEST-MOD-APPROVED #4490 (Explorer W1): the #4490 rollout flag reads are not
      // part of what these cases pin; they are answered "off" and not recorded.
      if (name === "issue_4490_flag_on") {
        return Promise.resolve({ data: false, error: null });
      }
      calls.push({ name, params });
      // Simulates a database that answers for anybody.
      return Promise.resolve({
        data: {
          groupId: GROUP,
          guest: { name: "Tolu", email: "tolu@example.test" },
          passes: [{ qrPayload: "mingla:v1:vpass:x:sig:y" }],
        },
        error: null,
      });
    },
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () =>
          Promise.resolve({
            data: table === "stay_reservation_groups" ? group : null,
            error: null,
          }),
      };
      return chain;
    },
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: userId } }, error: null }),
    },
  });
}

const jwtFor = (sub: string) =>
  `x.${
    btoa(JSON.stringify({ role: "authenticated", sub })).replace(/=+$/, "")
  }.y`;

function post(body: Record<string, unknown>, jwt: string): Request {
  return new Request("http://local/venue-offers", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });
}

const GUEST_BOOKING = {
  user_id: null,
  booked_by_user_id: null,
  offer_kind: "entry",
};

const ACTIONS: Array<Record<string, unknown>> = [
  { action: "get", groupId: GROUP },
  {
    action: "pay",
    groupId: GROUP,
    idempotencyKey: "pay-key-12345678",
    expectedVersion: 3,
  },
  { action: "confirm_return", groupId: GROUP },
  { action: "cancel_preview", groupId: GROUP },
  {
    action: "cancel",
    groupId: GROUP,
    previewIds: [PREVIEW],
    previewHash: "a".repeat(64),
    idempotencyKey: "cancel-key-1234",
  },
];

Deno.test("S1: a signed-in stranger without the token cannot read, pay, confirm or cancel a signed-out booking", async () => {
  for (const body of ACTIONS) {
    resetVenueOffersRateLimitForTests();
    const calls: Call[] = [];
    const handle = createVenueOffersHandler({
      client: permissiveClient(calls, STRANGER, GUEST_BOOKING),
      env: () => undefined,
    });
    const res = await handle(post(body, jwtFor(STRANGER)));
    assertEquals(res.status, 404, `${body.action} must be refused`);
    assertEquals((await res.json()).code, "offer_booking_not_found");
    assertEquals(calls.length, 0, `${body.action} must not reach the database`);
  }
});

Deno.test("S1: a stranger is refused even for a booking that another signed-in user bought", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({
    client: permissiveClient(calls, STRANGER, {
      user_id: OWNER,
      booked_by_user_id: OWNER,
      offer_kind: "entry",
    }),
    env: () => undefined,
  });
  const res = await handle(
    post({ action: "get", groupId: GROUP }, jwtFor(STRANGER)),
  );
  assertEquals(res.status, 404);
  assertEquals(calls.length, 0);
});

Deno.test("S1: an unknown booking id or a Stays booking is refused for a signed-in caller", async () => {
  for (
    const group of [null, {
      user_id: STRANGER,
      booked_by_user_id: null,
      offer_kind: null,
    }]
  ) {
    resetVenueOffersRateLimitForTests();
    const calls: Call[] = [];
    const handle = createVenueOffersHandler({
      client: permissiveClient(calls, STRANGER, group),
      env: () => undefined,
    });
    const res = await handle(
      post({ action: "get", groupId: GROUP }, jwtFor(STRANGER)),
    );
    assertEquals(res.status, 404);
    assertEquals(calls.length, 0);
  }
});

Deno.test("the booking's own signed-in buyer opens it without a token", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({
    client: permissiveClient(calls, OWNER, {
      user_id: OWNER,
      booked_by_user_id: null,
      offer_kind: "entry",
    }),
    env: () => undefined,
  });
  const res = await handle(
    post({ action: "get", groupId: GROUP }, jwtFor(OWNER)),
  );
  assertEquals(res.status, 200);
  assertEquals(calls[0].name, "issue_4490_get_offer_booking");
  assertEquals(calls[0].params.p_user_id, OWNER);
  assertEquals(calls[0].params.p_token_hash, null);
});

Deno.test("a signed-in user holding the booking token opens a signed-out booking (token decides)", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({
    client: permissiveClient(calls, STRANGER, GUEST_BOOKING),
    env: () => undefined,
  });
  const res = await handle(
    post({ action: "get", groupId: GROUP, token: TOKEN }, jwtFor(STRANGER)),
  );
  assertEquals(res.status, 200);
  assertEquals(
    calls[0].params.p_token_hash,
    `\\x${await venueOfferTokenHashHex(TOKEN)}`,
  );
});

Deno.test("callerOwnsBooking: only user_id / booked_by_user_id of a venue booking match", async () => {
  const check = (group: Record<string, unknown> | null, user: string) =>
    callerOwnsBooking(permissiveClient([], user, group)(), GROUP, user);
  assert(!(await check(GUEST_BOOKING, STRANGER)));
  assert(
    await check({
      user_id: OWNER,
      booked_by_user_id: null,
      offer_kind: "entry",
    }, OWNER),
  );
  assert(
    await check({
      user_id: null,
      booked_by_user_id: OWNER,
      offer_kind: "group_package",
    }, OWNER),
  );
  assert(
    !(await check(
      { user_id: OWNER, booked_by_user_id: null, offer_kind: null },
      OWNER,
    )),
  );
  assert(!(await check(null, OWNER)));
});
