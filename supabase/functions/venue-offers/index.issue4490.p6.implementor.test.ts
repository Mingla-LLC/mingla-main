// #4490 P6 — venue-offers memberships: join with no account (the member token
// is returned once; only its SHA-256 reaches the database), the member's own
// read and actions need the member token or the member's own account, the
// member price rides on a quote, and the by-the-hour day line states its price
// rule.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createVenueOffersHandler,
  hourPricing,
  resetVenueOffersRateLimitForTests,
  type ServiceClient,
} from "./index.ts";
import { venueOfferTokenHashHex } from "../_shared/venueOfferBookingToken.ts";

const PLAN = "00000000-4490-4000-8000-0000000000c6";
const SUB = "00000000-4490-4000-8000-0000000000d6";
const OTHER_SUB = "00000000-4490-4000-8000-0000000000e6";
const OFFER = "00000000-4490-4000-8000-0000000000a6";
const WINDOW = "00000000-4490-4000-8000-0000000000b6";
const QUOTE = "00000000-4490-4000-8000-0000000000f6";
const USER = "00000000-4490-4000-8000-0000000000aa";
const TOKEN = "m".repeat(43);
const CART = "c".repeat(40);
const b64 = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(
    /\//g,
    "_",
  );
const ANON = `${b64({ alg: "HS256" })}.${b64({ role: "anon" })}.sig`;
const USER_JWT = `${b64({ alg: "HS256" })}.${
  b64({ role: "authenticated", sub: USER })
}.sig`;

type Call = { name: string; params: Record<string, unknown> };

function fake(
  calls: Call[],
  result: (name: string, params: Record<string, unknown>) => {
    data: unknown;
    error: unknown;
  },
  opts: { user?: string | null; storedHash?: string | null } = {},
): () => ServiceClient {
  return () => ({
    rpc: (name, params) => {
      // TEST-MOD-APPROVED #4490 (Explorer W1): the #4490 rollout flag reads are not
      // part of what these cases pin; they are answered "off" and not recorded.
      if (name === "issue_4490_flag_on") {
        return Promise.resolve({ data: false, error: null });
      }
      calls.push({ name, params });
      return Promise.resolve(
        result(name, params) as { data: unknown; error: null },
      );
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: { member_token_hash: opts.storedHash ?? null },
              error: null,
            }),
        }),
      }),
    }),
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: opts.user ? { id: opts.user } : null },
          error: opts.user ? null : { message: "no" },
        }),
    },
  });
}

function post(body: Record<string, unknown>, auth = ANON): Request {
  return new Request("http://local/venue-offers", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${auth}` },
    body: JSON.stringify(body),
  });
}

Deno.test("join with no account: the member token is returned once, only its hash is stored", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({
    client: fake(calls, () => ({
      data: { subscriptionId: SUB, status: "pending", replayed: false },
      error: null,
    })),
    newSubscriptionId: () => SUB,
    issueMemberToken: () => Promise.resolve({ token: TOKEN, derived: true }),
  });
  const res = await handle(post({
    action: "membership_join",
    planId: PLAN,
    member: { name: "Amaka Eze", email: "amaka@example.test", ignored: "x" },
    cartKey: CART,
    idempotencyKey: "join-key-0001",
  }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.memberToken, TOKEN);
  assertEquals(body.data.memberPath, `/visit/plan/${SUB}`);
  assertEquals(calls[0].name, "issue_4490_membership_join");
  assertEquals(
    calls[0].params.p_member_token_hash,
    `\\x${await venueOfferTokenHashHex(TOKEN)}`,
  );
  assertEquals(calls[0].params.p_member, {
    name: "Amaka Eze",
    email: "amaka@example.test",
  });
  assertEquals(calls[0].params.p_user_id, null);
  assert(!JSON.stringify(calls[0].params).includes(TOKEN));
});

Deno.test("a repeated join rebuilds the first member's token (never a new one)", async () => {
  resetVenueOffersRateLimitForTests();
  const handle = createVenueOffersHandler({
    client: fake([], () => ({
      data: { subscriptionId: OTHER_SUB, replayed: true },
      error: null,
    }), { storedHash: "\\xabc" }),
    newSubscriptionId: () => SUB,
    issueMemberToken: () => Promise.resolve({ token: TOKEN, derived: true }),
    rederiveMemberToken: (input) =>
      Promise.resolve(
        input.subscriptionId === OTHER_SUB && input.storedHashHex === "\\xabc"
          ? "first".padEnd(43, "f")
          : null,
      ),
  });
  const res = await handle(post({
    action: "membership_join",
    planId: PLAN,
    member: { name: "Amaka", email: "amaka@example.test" },
    cartKey: CART,
    idempotencyKey: "join-key-0001",
  }));
  const body = await res.json();
  assertEquals(body.data.memberToken, "first".padEnd(43, "f"));
  assertEquals(body.data.memberPath, `/visit/plan/${OTHER_SUB}`);
});

Deno.test("join without a cart key or account is refused before the database", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const res = await createVenueOffersHandler({
    client: fake(calls, () => ({ data: null, error: null })),
  })(post({
    action: "membership_join",
    planId: PLAN,
    member: { name: "A", email: "a@example.test" },
    idempotencyKey: "join-key-0002",
  }));
  assertEquals(res.status, 400);
  assertEquals(calls.length, 0);
});

Deno.test("the member read needs the member token, or the member's own account", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({
    client: fake(calls, () => ({ data: { status: "active" }, error: null }), {
      user: USER,
    }),
  });
  const noToken = await handle(post({ action: "membership_get", subscriptionId: SUB }));
  assertEquals(noToken.status, 401);
  assertEquals((await noToken.json()).code, "membership_token_required");
  assertEquals(calls.length, 0);

  const withToken = await handle(post({
    action: "membership_get",
    subscriptionId: SUB,
    token: TOKEN,
  }));
  assertEquals(withToken.status, 200);
  assertEquals(calls[0].params.p_token_hash, `\\x${await venueOfferTokenHashHex(TOKEN)}`);
  assertEquals(calls[0].params.p_user_id, null);

  const signedIn = await handle(post({ action: "membership_get", subscriptionId: SUB }, USER_JWT));
  assertEquals(signedIn.status, 200);
  assertEquals(calls[1].params.p_token_hash, null);
  assertEquals(calls[1].params.p_user_id, USER);
});

Deno.test("a stranger's token: the database answers not found and the edge says so", async () => {
  resetVenueOffersRateLimitForTests();
  const handle = createVenueOffersHandler({
    client: fake([], () => ({
      data: null,
      error: { code: "P0002", message: "membership_not_found" },
    })),
  });
  const res = await handle(post({
    action: "membership_leave",
    subscriptionId: SUB,
    token: "s".repeat(43),
    idempotencyKey: "leave-key-001",
  }));
  assertEquals(res.status, 404);
  assertEquals((await res.json()).code, "membership_not_found");
});

Deno.test("member actions map to leave / stay / pause / resume", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({
    client: fake(calls, () => ({ data: { status: "active" }, error: null })),
  });
  for (const [action, expected] of [
    ["membership_leave", "leave"],
    ["membership_stay", "stay"],
    ["membership_pause", "pause"],
    ["membership_resume", "resume"],
  ]) {
    const res = await handle(post({
      action,
      subscriptionId: SUB,
      token: TOKEN,
      idempotencyKey: `${action}-key`,
    }));
    assertEquals(res.status, 200);
    assertEquals(calls.at(-1)?.params.p_action, expected);
  }
  const noKey = await handle(post({ action: "membership_pause", subscriptionId: SUB, token: TOKEN }));
  assertEquals(noKey.status, 400);
});

Deno.test("a quote with a membership asks for the member price and keeps the hour block", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({
    client: fake(calls, (name) =>
      name === "issue_4490_quote_offer"
        ? {
          data: { quoteId: QUOTE, totalMinor: 2580000, hour: { minutes: 120 } },
          error: null,
        }
        : {
          data: {
            quoteId: "00000000-4490-4000-8000-0000000000f7",
            totalMinor: 0,
            member: { applied: true, roomHoursUsed: 2 },
          },
          error: null,
        }),
  });
  const res = await handle(post({
    action: "quote",
    offeringId: OFFER,
    windowId: WINDOW,
    lines: [{ guests: 2 }],
    cartKey: CART,
    idempotencyKey: "quote-key-001",
    membership: { subscriptionId: SUB, token: TOKEN },
  }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.totalMinor, 0);
  assertEquals(body.data.hour, { minutes: 120 });
  assertEquals(body.data.member.roomHoursUsed, 2);
  assertEquals(calls[1].name, "issue_4490_member_quote");
  assertEquals(calls[1].params.p_quote_id, QUOTE);
  assertEquals(calls[1].params.p_token_hash, `\\x${await venueOfferTokenHashHex(TOKEN)}`);
  assertEquals(calls[1].params.p_use_credits, true);
});

Deno.test("a signed-out member price needs the member token", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const res = await createVenueOffersHandler({
    client: fake(calls, () => ({ data: {}, error: null })),
  })(post({
    action: "quote",
    offeringId: OFFER,
    windowId: WINDOW,
    lines: [{ guests: 2 }],
    cartKey: CART,
    idempotencyKey: "quote-key-002",
    membership: { subscriptionId: SUB },
  }));
  assertEquals(res.status, 400);
  assertEquals(calls.length, 0);
});

Deno.test("the by-the-hour day line states its price rule", async () => {
  resetVenueOffersRateLimitForTests();
  assertEquals(hourPricing({ stepMinutes: 30, minMinutes: 60 }), {
    rule: "per_minute_pro_rata",
    formula: "pricePerHourMinor * minutes / 60, rounded half up",
    billableStepMinutes: 30,
    minBillableMinutes: 60,
  });
  assertEquals(hourPricing({ status: "closed" }), null);
  const res = await createVenueOffersHandler({
    client: fake([], () => ({
      data: { status: "open", stepMinutes: 60, minMinutes: null, starts: [] },
      error: null,
    })),
  })(post({ action: "hour_day", offeringId: OFFER, date: "2026-11-21" }));
  const body = await res.json();
  assertEquals(body.data.pricing.billableStepMinutes, 60);
  assertEquals(body.data.pricing.minBillableMinutes, 60);
});

Deno.test("the guest hire read carries Hours you set (no internal rule id)", async () => {
  const { publicHireDetail } = await import("./index.ts");
  const detail = publicHireDetail({
    rows: [],
    hoursYouSet: {
      ruleId: "00000000-4490-4000-8000-0000000000ff",
      weekdays: [0, 1, 2],
      startTime: "10:00",
      endTime: "17:00",
      pastMidnight: false,
      minMinutes: 120,
      maxMinutes: null,
      stepMinutes: 30,
    },
  });
  assertEquals(detail?.hoursYouSet, {
    weekdays: [0, 1, 2],
    startTime: "10:00",
    endTime: "17:00",
    pastMidnight: false,
    minMinutes: 120,
    maxMinutes: null,
    stepMinutes: 30,
  });
  assert(!JSON.stringify(detail).includes("ruleId"));
  assertEquals(publicHireDetail({ rows: [] })?.hoursYouSet, null);
});
